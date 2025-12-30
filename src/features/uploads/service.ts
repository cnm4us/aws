import { enhanceUploadRow } from '../../utils/enhance'
import { ForbiddenError, NotFoundError, DomainError } from '../../core/errors'
import * as repo from './repo'
import * as pubsSvc from '../publications/service'
import * as spacesRepo from '../spaces/repo'
import { can, resolveChecker } from '../../security/permissions'
import { PERM } from '../../security/perm'
import { getPool } from '../../db'
import { s3 } from '../../services/s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { randomUUID } from 'crypto'
import { OUTPUT_BUCKET, UPLOAD_BUCKET, MAX_UPLOAD_MB, UPLOAD_PREFIX } from '../../config'
import { sanitizeFilename, pickExtension, nowDateYmd, buildUploadKey } from '../../utils/naming'
import { DeleteObjectsCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, type _Object } from '@aws-sdk/client-s3'
import { clampLimit } from '../../core/pagination'

export type ServiceContext = { userId?: number | null }

export async function list(
  params: { status?: string; kind?: 'video' | 'logo' | 'audio'; userId?: number; spaceId?: number; cursorId?: number; limit?: number; includePublications?: boolean },
  ctx: ServiceContext
) {
  let rows: any[] = []
  try {
    rows = await repo.list({
      status: params.status,
      kind: params.kind,
      userId: params.userId,
      spaceId: params.spaceId,
      cursorId: params.cursorId,
      limit: clampLimit(params.limit, 50, 1, 500),
    })
  } catch (e: any) {
    const msg = String(e?.message || '')
    // Backward compatibility when `uploads.kind` is not deployed yet.
    if (msg.includes('Unknown column') && msg.includes('kind')) {
      if (params.kind && params.kind !== 'video') return []
      rows = await repo.list({
        status: params.status,
        userId: params.userId,
        spaceId: params.spaceId,
        cursorId: params.cursorId,
        limit: clampLimit(params.limit, 50, 1, 500),
      } as any)
    } else {
      throw e
    }
  }
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

  // Include a Global Feed entry when a global space candidate exists and the user has
  // global publish permission.
  const canPublishGlobal = await can(currentUserId, PERM.FEED_PUBLISH_GLOBAL, { checker })
  if (canPublishGlobal) {
    const globalCandidate = await spacesRepo.findGlobalSpaceCandidate()
    if (globalCandidate && !spaces.some((s) => s.id === globalCandidate.id)) {
      spaces.push({
        id: Number(globalCandidate.id),
        name: String(globalCandidate.name || 'Global Feed'),
        slug: String(globalCandidate.slug || 'global'),
        type: String(globalCandidate.type || 'channel'),
      })
    }
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

export async function createSignedUpload(input: {
  filename: string
  contentType?: string
  sizeBytes?: number
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  modifiedFilename?: string
  description?: string
  kind?: 'video' | 'logo' | 'audio'
  ownerUserId?: number | null
}, ctx: ServiceContext): Promise<{ id: number; key: string; bucket: string; post: any }> {
  const filename = String(input.filename)
  const contentType = input.contentType
  const sizeBytes = input.sizeBytes
  const width = input.width ?? null
  const height = input.height ?? null
  const durationSeconds = input.durationSeconds ?? null
  const providedModified = (input.modifiedFilename || '').trim()
  const modifiedFilename = providedModified.length ? providedModified : filename
  const rawDescription = (input.description || '').trim()
  const description = rawDescription.length ? rawDescription : null
  const safe = sanitizeFilename(filename)
  const lowerCt = String(contentType || '').toLowerCase()
  const extFromName = ((safe || '').match(/\.[^.]+$/) || [''])[0].toLowerCase()
  const { ymd: dateYmd, folder: datePrefix } = nowDateYmd()
  const basePrefix = UPLOAD_PREFIX ? (UPLOAD_PREFIX.endsWith('/') ? UPLOAD_PREFIX : UPLOAD_PREFIX + '/') : ''
  const kind = input.kind || 'video'

  // Basic file type validation per kind (best-effort: uses content-type when present, otherwise file extension).
  const allowed =
    kind === 'video'
      ? (lowerCt ? lowerCt.startsWith('video/') : false) || ['.mp4', '.webm', '.mov'].includes(extFromName)
      : kind === 'logo'
        ? (lowerCt ? lowerCt.startsWith('image/') : false) || ['.png', '.jpg', '.jpeg', '.svg'].includes(extFromName)
        : (lowerCt ? lowerCt.startsWith('audio/') : false) || ['.mp3', '.wav', '.aac', '.m4a', '.mp4', '.ogg', '.opus'].includes(extFromName)
  if (!allowed) {
    const err: any = new DomainError('invalid_file_type', 'invalid_file_type', 400)
    err.detail = { kind, contentType: contentType || null, ext: extFromName || null }
    throw err
  }

  const ext = pickExtension(contentType, safe)
  const assetUuid = randomUUID()
  const key = buildUploadKey(basePrefix, datePrefix, assetUuid, ext, kind)

  const db = getPool()
  let result: any
  try {
    ;[result] = await db.query(
      `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed', ?)`,
      [
        UPLOAD_BUCKET,
        key,
        filename,
        modifiedFilename,
        description,
        contentType ?? null,
        sizeBytes ?? null,
        width ?? null,
        height ?? null,
        durationSeconds ?? null,
        assetUuid,
        dateYmd,
        kind,
      ]
    )
  } catch (e: any) {
    const msg = String(e?.message || '')
    // Backward compatibility for environments where the `uploads.kind` column isn't deployed yet.
    if (msg.includes('Unknown column') && msg.includes('kind')) {
      ;[result] = await db.query(
        `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed')`,
        [
          UPLOAD_BUCKET,
          key,
          filename,
          modifiedFilename,
          description,
          contentType ?? null,
          sizeBytes ?? null,
          width ?? null,
          height ?? null,
          durationSeconds ?? null,
          assetUuid,
          dateYmd,
        ]
      )
    } else {
      throw e
    }
  }
  const id = Number((result as any).insertId)

  // Determine owner: prefer session user; otherwise explicit ownerUserId (admin token flow)
  const ownerId = ctx.userId ?? (input.ownerUserId ?? null)
  if (ownerId) {
    try {
      const [sp] = await db.query(`SELECT id FROM spaces WHERE type='personal' AND owner_user_id = ? LIMIT 1`, [ownerId])
      const spaceId = (sp as any[]).length ? Number((sp as any[])[0].id) : null
      await db.query(
        `UPDATE uploads
            SET user_id = ?,
                space_id = COALESCE(?, space_id),
                origin_space_id = COALESCE(?, origin_space_id)
          WHERE id = ?`,
        [ownerId, spaceId, spaceId, id]
      )
    } catch {}
  }

  const maxBytes = MAX_UPLOAD_MB * 1024 * 1024
  const basePrefixCond = basePrefix || ''
  const conditions: any[] = [
    ['content-length-range', 1, maxBytes],
    ['starts-with', '$key', basePrefixCond],
  ]
  const fields: Record<string, string> = { key, success_action_status: '201' }
  if (contentType) fields['Content-Type'] = contentType
  fields['x-amz-meta-original-filename'] = filename

  // Add a best-effort guardrail on Content-Type category when provided.
  if (contentType) {
    if (kind === 'video' && lowerCt.startsWith('video/')) conditions.push(['starts-with', '$Content-Type', 'video/'])
    if (kind === 'logo' && lowerCt.startsWith('image/')) conditions.push(['starts-with', '$Content-Type', 'image/'])
    if (kind === 'audio' && lowerCt.startsWith('audio/')) conditions.push(['starts-with', '$Content-Type', 'audio/'])
  }

  const presigned = await createPresignedPost(s3, {
    Bucket: UPLOAD_BUCKET,
    Key: key,
    Conditions: conditions,
    Fields: fields,
    Expires: 60 * 5,
  })

  return { id, key, bucket: UPLOAD_BUCKET, post: presigned }
}

export async function markComplete(input: { id: number; etag?: string; sizeBytes?: number }, _ctx: ServiceContext): Promise<{ ok: true }> {
  const db = getPool()
  await db.query(
    `UPDATE uploads
       SET status = 'uploaded', uploaded_at = CURRENT_TIMESTAMP,
           etag = COALESCE(?, etag), size_bytes = COALESCE(?, size_bytes)
     WHERE id = ?`,
    [input.etag ?? null, input.sizeBytes ?? null, input.id]
  )
  return { ok: true }
}
