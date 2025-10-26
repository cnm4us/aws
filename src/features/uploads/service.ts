import { enhanceUploadRow } from '../../utils/enhance'
import { ForbiddenError, NotFoundError, DomainError } from '../../core/errors'
import * as repo from './repo'
import * as pubsSvc from '../publications/service'
import { can, resolveChecker } from '../../security/permissions'
import { PERM } from '../../security/perm'
import { getPool } from '../../db'
import { s3 } from '../../services/s3'
import { OUTPUT_BUCKET, UPLOAD_BUCKET } from '../../config'
import { DeleteObjectsCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, type _Object } from '@aws-sdk/client-s3'
import { clampLimit } from '../../core/pagination'

export type ServiceContext = { userId?: number | null }

export async function list(params: { status?: string; userId?: number; spaceId?: number; cursorId?: number; limit?: number; includePublications?: boolean }, ctx: ServiceContext) {
  const rows = await repo.list({
    status: params.status,
    userId: params.userId,
    spaceId: params.spaceId,
    cursorId: params.cursorId,
    limit: clampLimit(params.limit, 50, 1, 500),
  })
  const includePubs = Boolean(params.includePublications)
  const userId = ctx.userId && Number.isFinite(ctx.userId) ? Number(ctx.userId) : null
  const result = await Promise.all(rows.map(async (row) => {
    const enhanced = enhanceUploadRow(row)
    if (includePubs && userId) {
      try {
        const pubs = await pubsSvc.listByUploadDto(Number(row.id), { userId })
        ;(enhanced as any).publications = pubs
      } catch (e) {
        // Intentionally swallow permission errors to preserve list behavior
      }
    }
    return enhanced
  }))
  return result
}

export async function get(id: number, params: { includePublications?: boolean }, ctx: ServiceContext) {
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  const enhanced = enhanceUploadRow(row)
  const includePubs = Boolean(params.includePublications)
  const userId = ctx.userId && Number.isFinite(ctx.userId) ? Number(ctx.userId) : null
  if (includePubs && userId) {
    try {
      const pubs = await pubsSvc.listByUploadDto(Number(row.id), { userId })
      ;(enhanced as any).publications = pubs
    } catch (e) {
      // swallow permission errors; keep base upload data
    }
  }
  return enhanced
}

export async function getPublishOptions(uploadId: number, ctx: ServiceContext) {
  if (!ctx.userId) throw new ForbiddenError()
  const basic = await repo.getBasicForPublishOptions(uploadId)
  if (!basic) throw new NotFoundError('not_found')
  const currentUserId = Number(ctx.userId)
  const ownerId = basic.user_id
  const originSpaceId = basic.origin_space_id

  const checker = await resolveChecker(currentUserId)
  const allowedOwner = ownerId != null && (await can(currentUserId, PERM.VIDEO_PUBLISH_OWN, { ownerId, checker }))
  const allowedOrigin = originSpaceId ? await can(currentUserId, PERM.VIDEO_PUBLISH_SPACE, { spaceId: originSpaceId, checker }) : false
  const allowedAdmin = await can(currentUserId, PERM.VIDEO_PUBLISH_SPACE, { checker })
  if (!allowedOwner && !allowedOrigin && !allowedAdmin) {
    throw new ForbiddenError()
  }

  const spaces: { id: number; name: string; slug: string; type: string }[] = []

  if (ownerId != null) {
    const personal = await repo.findPersonalSpaceForOwner(ownerId)
    if (personal) spaces.push(personal)
  }

  const publishable = await repo.listSpacesUserCanPublish(currentUserId)
  for (const row of publishable) {
    if (!spaces.some((s) => s.id === row.id)) spaces.push(row)
  }

  return {
    uploadId,
    spaces: spaces.map((s) => ({ id: s.id, name: s.name, slug: s.slug, type: s.type })),
  }
}

type DeleteSummary = { bucket: string; prefix: string; deleted: number; batches: number; samples: string[]; errors: string[] }

async function deletePrefix(bucket: string, prefix: string): Promise<DeleteSummary> {
  let token: string | undefined = undefined
  let totalDeleted = 0
  let batches = 0
  const samples: string[] = []
  const errors: string[] = []
  do {
    let list: ListObjectsV2CommandOutput
    try {
      list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
    } catch (e: any) {
      errors.push(`list:${bucket}:${prefix}:${String(e?.name || e?.Code || e)}:${String(e?.message || e)}`)
      break
    }
    const contents = list.Contents ?? []
    if (contents.length) {
      const Objects = contents.map((o: _Object) => ({ Key: o.Key! }))
      for (let i = 0; i < Math.min(10, contents.length); i++) {
        const k = contents[i]?.Key; if (k && samples.length < 10) samples.push(String(k))
      }
      try {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects, Quiet: true } }))
      } catch (e: any) {
        errors.push(`delete:${bucket}:${prefix}:${String(e?.name || e?.Code || e)}:${String(e?.message || e)}`)
        break
      }
      totalDeleted += Objects.length
      batches += 1
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (token)
  return { bucket, prefix, deleted: totalDeleted, batches, samples, errors }
}

function extractUuidDirPrefix(pathStr: string): string | null {
  try {
    const p = String(pathStr)
    const m = p.match(/(^|\/)\d{4}-\d{2}\/\d{2}\/([0-9a-fA-F-]{36})\//)
    if (!m) return null
    const idx = p.indexOf(m[0])
    if (idx < 0) return null
    return p.slice(0, idx + m[0].length)
  } catch { return null }
}

export async function remove(id: number, currentUserId: number): Promise<{ ok: true }> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [id])
  const u = (rows as any[])[0]
  if (!u) throw new NotFoundError('not_found')

  const checker = await resolveChecker(currentUserId)
  const ownerId = u.user_id ? Number(u.user_id) : null
  const spaceId = u.space_id ? Number(u.space_id) : null
  const allowed =
    (ownerId && (await can(currentUserId, PERM.VIDEO_DELETE_OWN, { ownerId, checker }))) ||
    (await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })) ||
    (spaceId && (await can(currentUserId, PERM.VIDEO_UNPUBLISH_SPACE, { spaceId, checker })))
  if (!allowed) throw new ForbiddenError()

  let delUp: DeleteSummary | null = null
  try {
    if (u.s3_key) {
      const key: string = String(u.s3_key)
      const byRegex = extractUuidDirPrefix(key)
      let dirPrefix = byRegex
      if (!dirPrefix) {
        const lastSlash = key.lastIndexOf('/')
        dirPrefix = lastSlash > 0 ? key.slice(0, lastSlash + 1) : key
      }
      if (dirPrefix) { delUp = await deletePrefix(UPLOAD_BUCKET, dirPrefix) }
    }
  } catch (e) { /* ignore */ }

  let delOut: DeleteSummary | null = null
  try {
    if (u.output_prefix) {
      let outPrefix: string = String(u.output_prefix)
      if (!outPrefix.endsWith('/')) outPrefix += '/'
      const byRegex = extractUuidDirPrefix(outPrefix)
      let uuidDir = byRegex || outPrefix
      if (!byRegex) uuidDir = uuidDir.replace(/(?:portrait|landscape)\/$/, '')
      delOut = await deletePrefix(OUTPUT_BUCKET, uuidDir)
    }
  } catch (e) { /* ignore */ }

  const hadErr = (delUp && delUp.errors.length) || (delOut && delOut.errors.length)
  if (hadErr) {
    try {
      const detail = {
        s3_key: u.s3_key,
        output_prefix: u.output_prefix,
        size_bytes: u.size_bytes,
        s3_ops: [ delUp, delOut ].filter(Boolean),
      }
      await db.query(`INSERT INTO action_log (user_id, action, resource_type, resource_id, detail) VALUES (?, 'delete_error', 'upload', ?, ?)`, [currentUserId, id, JSON.stringify(detail)])
    } catch {}
    const err: any = new DomainError('s3_delete_failed', 's3_delete_failed', 502)
    err.detail = { up: delUp, out: delOut }
    throw err
  }

  await db.query(`DELETE FROM uploads WHERE id = ?`, [id])
  try {
    const detail = {
      s3_key: u.s3_key,
      output_prefix: u.output_prefix,
      size_bytes: u.size_bytes,
      s3_ops: [ delUp, delOut ].filter(Boolean),
    }
    await db.query(`INSERT INTO action_log (user_id, action, resource_type, resource_id, detail) VALUES (?, 'delete', 'upload', ?, ?)`, [currentUserId, id, JSON.stringify(detail)])
  } catch {}
  return { ok: true }
}
