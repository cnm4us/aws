import { enhanceUploadRow } from '../../utils/enhance'
import { buildUploadThumbKey } from '../../utils/uploadThumb'
import { buildUploadEditProxyKey } from '../../utils/uploadEditProxy'
import { ForbiddenError, NotFoundError, DomainError } from '../../core/errors'
import * as repo from './repo'
import * as pubsSvc from '../publications/service'
import * as logoConfigsSvc from '../logo-configs/service'
import * as spacesRepo from '../spaces/repo'
import { can, resolveChecker } from '../../security/permissions'
import { PERM } from '../../security/perm'
import { getPool } from '../../db'
import { s3 } from '../../services/s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { randomUUID } from 'crypto'
import { MEDIA_JOBS_ENABLED, OUTPUT_BUCKET, UPLOAD_BUCKET, MAX_UPLOAD_MB, UPLOAD_PREFIX } from '../../config'
import { sanitizeFilename, pickExtension, nowDateYmd, buildUploadKey } from '../../utils/naming'
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, type _Object } from '@aws-sdk/client-s3'
import { clampLimit } from '../../core/pagination'
import { enqueueJob } from '../media-jobs/service'
import * as prodRepo from '../productions/repo'
import * as audioTagsRepo from '../audio-tags/repo'
import { TERMS_UPLOAD_KEY, TERMS_UPLOAD_VERSION } from '../../config'
import { buildUploadTimelineManifestKey, buildUploadTimelineSpriteKey, buildUploadTimelineSpritePrefix } from '../../utils/uploadTimelineSprites'
import { buildUploadAudioEnvelopeKey } from '../../utils/uploadAudioEnvelope'

export type ServiceContext = { userId?: number | null; ip?: string | null; userAgent?: string | null }

export async function list(
  params: { status?: string; kind?: 'video' | 'logo' | 'audio' | 'image'; imageRole?: string; userId?: number; spaceId?: number; cursorId?: number; limit?: number; includePublications?: boolean; includeProductions?: boolean },
  ctx: ServiceContext
) {
  const statusParam = params.status ? String(params.status) : undefined
  const statuses = statusParam
    ? statusParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  const statusList = statuses.length ? statuses : undefined

  let rows: any[] = []
  try {
    rows = await repo.list({
      status: statusList,
      kind: params.kind,
      imageRole: params.imageRole,
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
        status: statusList,
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
  const includeProds = Boolean(params.includeProductions)
  const userId = ctx.userId && Number.isFinite(ctx.userId) ? Number(ctx.userId) : null
  const requestedUserId = params.userId != null && Number.isFinite(params.userId) ? Number(params.userId) : null

  // Only include production details when the caller is authenticated and requesting their own uploads list.
  const canIncludeProductions = includeProds && userId != null && requestedUserId != null && userId === requestedUserId

  let productionsByUploadId = new Map<number, any[]>()
  if (canIncludeProductions && rows.length) {
    try {
      const uploadIds = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0)
      const prodRows = await prodRepo.listSummariesForUploadIds(userId, uploadIds)
      for (const p of prodRows) {
        const uploadId = Number((p as any).upload_id)
        if (!Number.isFinite(uploadId) || uploadId <= 0) continue
        const list = productionsByUploadId.get(uploadId) || []
        list.push({
          id: Number((p as any).id),
          name: (p as any).name != null ? String((p as any).name) : null,
          status: (p as any).status != null ? String((p as any).status) : null,
          created_at: (p as any).created_at ?? null,
          started_at: (p as any).started_at ?? null,
          completed_at: (p as any).completed_at ?? null,
        })
        productionsByUploadId.set(uploadId, list)
      }
    } catch (e) {
      // swallow; list still works without productions
    }
  }
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
    if (canIncludeProductions) {
      ;(enhanced as any).productions = productionsByUploadId.get(Number(row.id)) || []
    }
    return enhanced
  }))
  return result
}

export async function get(id: number, params: { includePublications?: boolean; includeProductions?: boolean }, ctx: ServiceContext) {
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  const enhanced = enhanceUploadRow(row)
  const includePubs = Boolean(params.includePublications)
  const includeProds = Boolean(params.includeProductions)
  const userId = ctx.userId && Number.isFinite(ctx.userId) ? Number(ctx.userId) : null
  if (includePubs && userId) {
    try {
      const pubs = await pubsSvc.listByUploadDto(Number(row.id), { userId })
      ;(enhanced as any).publications = pubs
    } catch (e) {
      // swallow permission errors; keep base upload data
    }
  }
  if (includeProds && userId != null) {
    try {
      const ownerId = row.user_id != null ? Number(row.user_id) : null
      if (ownerId != null && ownerId === userId) {
        const prodRows = await prodRepo.listSummariesForUploadIds(userId, [Number(row.id)])
        ;(enhanced as any).productions = prodRows
          .filter((p) => Number((p as any).upload_id) === Number(row.id))
          .map((p) => ({
            id: Number((p as any).id),
            name: (p as any).name != null ? String((p as any).name) : null,
            status: (p as any).status != null ? String((p as any).status) : null,
            created_at: (p as any).created_at ?? null,
            started_at: (p as any).started_at ?? null,
            completed_at: (p as any).completed_at ?? null,
          }))
      }
    } catch (e) {
      // swallow; keep base upload data
    }
  }
  return enhanced
}

export async function getUploadFileStream(
  uploadId: number,
  opts: { range?: string } | undefined,
  ctx: ServiceContext
): Promise<{ contentType: string | null; body: any; contentLength?: number | null; contentRange?: string | null }> {
  if (!ctx.userId) throw new ForbiddenError()
  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')

  const kind = String(row.kind || 'video').toLowerCase()
  const isSystem = Number((row as any).is_system || 0) === 1

  // System audio is selectable by any logged-in user.
  if (!(isSystem && kind === 'audio')) {
    const ownerId = row.user_id != null ? Number(row.user_id) : null
    const isOwner = ownerId != null && ownerId === Number(ctx.userId)
    const checker = await resolveChecker(Number(ctx.userId))
    const isAdmin = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY, { checker })
    if (!isOwner && !isAdmin) throw new ForbiddenError()
  }

  const bucket = String(row.s3_bucket || UPLOAD_BUCKET || '')
  const key = String(row.s3_key || '')
  if (!bucket || !key) throw new NotFoundError('not_found')

  const range = opts?.range ? String(opts.range) : undefined
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(range ? { Range: range } : {}) }))
  return {
    contentType: row.content_type != null ? String(row.content_type) : (resp.ContentType ? String(resp.ContentType) : null),
    body: resp.Body,
    contentLength: resp.ContentLength != null ? Number(resp.ContentLength) : (row.size_bytes != null ? Number(row.size_bytes) : null),
    contentRange: (resp as any).ContentRange != null ? String((resp as any).ContentRange) : null,
  }
}

export async function getUploadEditProxyStream(
  uploadId: number,
  opts: { range?: string } | undefined,
  ctx: ServiceContext
): Promise<{ contentType: string | null; body: any; contentLength?: number | null; contentRange?: string | null }> {
  if (!ctx.userId) throw new ForbiddenError()
  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')

  const kind = String(row.kind || 'video').toLowerCase()
  if (kind !== 'video') throw new NotFoundError('not_found')

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(ctx.userId)
  const checker = await resolveChecker(Number(ctx.userId))
  const isAdmin = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY, { checker })
  if (!isOwner && !isAdmin) throw new ForbiddenError()

  const bucket = String(UPLOAD_BUCKET || '')
  const key = buildUploadEditProxyKey(Number(uploadId))
  if (!bucket || !key) throw new NotFoundError('not_found')

  const range = opts?.range ? String(opts.range) : undefined
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(range ? { Range: range } : {}) }))
    return {
      contentType: resp.ContentType ? String(resp.ContentType) : 'video/mp4',
      body: resp.Body,
      contentLength: resp.ContentLength != null ? Number(resp.ContentLength) : null,
      contentRange: (resp as any).ContentRange != null ? String((resp as any).ContentRange) : null,
    }
  } catch (e: any) {
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    const name = String(e?.name || e?.Code || '')
    const isMissing = status === 404 || name === 'NotFound' || name === 'NoSuchKey'
    if (!isMissing) throw e

    // Best-effort: enqueue proxy generation on-demand (covers existing uploads created before this feature).
    try {
      const sourceDeletedAt = (row as any).source_deleted_at != null ? String((row as any).source_deleted_at) : null
      if (MEDIA_JOBS_ENABLED && !sourceDeletedAt) {
        let alreadyQueued = false
        try {
          const db = getPool()
          const [rows] = await db.query(
            `SELECT id
               FROM media_jobs
              WHERE type = 'upload_edit_proxy_v1'
                AND status IN ('pending','processing')
                AND JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.uploadId')) = ?
              ORDER BY id DESC
              LIMIT 1`,
            [String(row.id)]
          )
          alreadyQueued = (rows as any[]).length > 0
        } catch {}

        if (!alreadyQueued) {
          await enqueueJob('upload_edit_proxy_v1', {
            uploadId: Number(row.id),
            userId: ownerId != null && Number.isFinite(ownerId) && ownerId > 0 ? Number(ownerId) : Number(ctx.userId),
            video: { bucket: String(row.s3_bucket), key: String(row.s3_key) },
            outputBucket: String(UPLOAD_BUCKET),
            outputKey: buildUploadEditProxyKey(Number(row.id)),
            longEdgePx: 540,
            fps: 30,
            gop: 8,
          })
        }
      }
    } catch {}

    throw new NotFoundError('not_found')
  }
}

async function readBodyText(body: any): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of body as any) {
    if (!chunk) continue
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function ensureTimelineSpritesEnqueued(uploadRow: any, ctx: ServiceContext): Promise<void> {
  try {
    if (!MEDIA_JOBS_ENABLED) return
    const uploadId = Number(uploadRow?.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return
    const ownerId = uploadRow?.user_id != null ? Number(uploadRow.user_id) : null
    const sourceDeletedAt = uploadRow?.source_deleted_at != null ? String(uploadRow.source_deleted_at) : null
    if (sourceDeletedAt) return

    // Only video uploads have edit proxies/timelines.
    const kind = String(uploadRow?.kind || 'video').toLowerCase()
    if (kind !== 'video') return

    // Require the edit proxy to exist before enqueuing.
    const proxyKey = buildUploadEditProxyKey(uploadId)
    try {
      await s3.send(new HeadObjectCommand({ Bucket: String(UPLOAD_BUCKET), Key: proxyKey }))
    } catch {
      return
    }

    let alreadyQueued = false
    try {
      const db = getPool()
      const [rows] = await db.query(
        `SELECT id
           FROM media_jobs
          WHERE type = 'upload_timeline_sprites_v1'
            AND status IN ('pending','processing')
            AND JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.uploadId')) = ?
          ORDER BY id DESC
          LIMIT 1`,
        [String(uploadId)]
      )
      alreadyQueued = (rows as any[]).length > 0
    } catch {}
    if (alreadyQueued) return

    const userIdForJob = ownerId != null && Number.isFinite(ownerId) && ownerId > 0 ? ownerId : (ctx.userId != null ? Number(ctx.userId) : null)
    if (!userIdForJob) return

    await enqueueJob('upload_timeline_sprites_v1', {
      uploadId,
      userId: userIdForJob,
      proxy: { bucket: String(UPLOAD_BUCKET), key: proxyKey },
      outputBucket: String(UPLOAD_BUCKET),
      manifestKey: buildUploadTimelineManifestKey(uploadId),
      spritePrefix: buildUploadTimelineSpritePrefix(uploadId),
      intervalSeconds: 1,
      tileW: 96,
      tileH: 54,
      cols: 10,
      rows: 6,
      perSprite: 60,
    })
  } catch {
    // best-effort
  }
}

async function ensureAudioEnvelopeEnqueued(uploadRow: any, ctx: ServiceContext): Promise<void> {
  try {
    if (!MEDIA_JOBS_ENABLED) return
    const uploadId = Number(uploadRow?.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return
    const ownerId = uploadRow?.user_id != null ? Number(uploadRow.user_id) : null
    const sourceDeletedAt = uploadRow?.source_deleted_at != null ? String(uploadRow.source_deleted_at) : null
    if (sourceDeletedAt) return

    const kind = String(uploadRow?.kind || 'video').toLowerCase()
    if (kind !== 'video') return

    const userIdForJob = ownerId != null && Number.isFinite(ownerId) && ownerId > 0 ? ownerId : (ctx.userId != null ? Number(ctx.userId) : null)
    if (!userIdForJob) return

    // Require the edit proxy to exist before enqueuing.
    const proxyKey = buildUploadEditProxyKey(uploadId)
    try {
      await s3.send(new HeadObjectCommand({ Bucket: String(UPLOAD_BUCKET), Key: proxyKey }))
    } catch {
      return
    }

    let alreadyQueued = false
    try {
      const db = getPool()
      const [rows] = await db.query(
        `SELECT id
           FROM media_jobs
          WHERE type = 'upload_audio_envelope_v1'
            AND status IN ('pending','processing')
            AND JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.uploadId')) = ?
          ORDER BY id DESC
          LIMIT 1`,
        [String(uploadId)]
      )
      alreadyQueued = (rows as any[]).length > 0
    } catch {}
    if (alreadyQueued) return

    await enqueueJob('upload_audio_envelope_v1', {
      uploadId,
      userId: userIdForJob,
      proxy: { bucket: String(UPLOAD_BUCKET), key: proxyKey },
      outputBucket: String(UPLOAD_BUCKET),
      outputKey: buildUploadAudioEnvelopeKey(uploadId),
      intervalSeconds: 0.1,
    })
  } catch {
    // best-effort
  }
}

export async function getUploadTimelineManifest(
  uploadId: number,
  ctx: ServiceContext
): Promise<any> {
  if (!ctx.userId) throw new ForbiddenError()
  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')

  const kind = String(row.kind || 'video').toLowerCase()
  if (kind !== 'video') throw new NotFoundError('not_found')

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(ctx.userId)
  const checker = await resolveChecker(Number(ctx.userId))
  const isAdmin = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY, { checker })
  if (!isOwner && !isAdmin) throw new ForbiddenError()

  const bucket = String(UPLOAD_BUCKET || '')
  const key = buildUploadTimelineManifestKey(uploadId)
  if (!bucket || !key) throw new NotFoundError('not_found')

  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const txt = await readBodyText(resp.Body as any)
    return JSON.parse(txt || '{}')
  } catch (e: any) {
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    const name = String(e?.name || e?.Code || '')
    const isMissing = status === 404 || name === 'NotFound' || name === 'NoSuchKey'
    if (!isMissing) throw e
    await ensureTimelineSpritesEnqueued(row, ctx)
    throw new NotFoundError('not_found')
  }
}

async function ensureThumbEnqueued(uploadRow: any, ctx: ServiceContext): Promise<void> {
  try {
    if (!MEDIA_JOBS_ENABLED) return
    const uploadId = Number(uploadRow?.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return
    const sourceDeletedAt = uploadRow?.source_deleted_at != null ? String(uploadRow.source_deleted_at) : null
    if (sourceDeletedAt) return

    const kind = String(uploadRow?.kind || 'video').toLowerCase()
    const isSystem = Number(uploadRow?.is_system || 0) === 1
    if (isSystem || kind !== 'video') return

    const ownerId = uploadRow?.user_id != null ? Number(uploadRow.user_id) : null
    const userIdForJob =
      ownerId != null && Number.isFinite(ownerId) && ownerId > 0 ? ownerId : (ctx.userId != null ? Number(ctx.userId) : null)
    if (!userIdForJob) return

    let alreadyQueued = false
    try {
      const db = getPool()
      const [rows] = await db.query(
        `SELECT id
           FROM media_jobs
          WHERE type = 'upload_thumb_v1'
            AND status IN ('pending','processing')
            AND JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.uploadId')) = ?
          ORDER BY id DESC
          LIMIT 1`,
        [String(uploadId)]
      )
      alreadyQueued = (rows as any[]).length > 0
    } catch {}
    if (alreadyQueued) return

    await enqueueJob('upload_thumb_v1', {
      uploadId,
      userId: userIdForJob,
      video: { bucket: String(uploadRow.s3_bucket), key: String(uploadRow.s3_key) },
      outputBucket: String(UPLOAD_BUCKET),
      outputKey: buildUploadThumbKey(uploadId),
      longEdgePx: 640,
    })
  } catch {
    // Best-effort: thumbnails are optional and UI can fall back.
  }
}

export async function getUploadAudioEnvelope(
  uploadId: number,
  ctx: ServiceContext
): Promise<{ status: 'ready'; envelope: any } | { status: 'pending' }> {
  if (!ctx.userId) throw new ForbiddenError()
  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')

  const kind = String(row.kind || 'video').toLowerCase()
  if (kind !== 'video') throw new NotFoundError('not_found')

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(ctx.userId)
  const checker = await resolveChecker(Number(ctx.userId))
  const isAdmin = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY, { checker })
  if (!isOwner && !isAdmin) throw new ForbiddenError()

  const bucket = String(UPLOAD_BUCKET || '')
  const key = buildUploadAudioEnvelopeKey(uploadId)
  if (!bucket || !key) throw new NotFoundError('not_found')

  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const txt = await readBodyText(resp.Body as any)
    const json = JSON.parse(txt || '{}')
    return { status: 'ready', envelope: json }
  } catch (e: any) {
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    const name = String(e?.name || e?.Code || '')
    const isMissing = status === 404 || name === 'NotFound' || name === 'NoSuchKey'
    if (!isMissing) throw e
    await ensureAudioEnvelopeEnqueued(row, ctx)
    return { status: 'pending' }
  }
}

export async function getUploadTimelineSpriteStream(
  uploadId: number,
  startSecond: number,
  ctx: ServiceContext
): Promise<{ contentType: string | null; body: any; contentLength?: number | null }> {
  if (!ctx.userId) throw new ForbiddenError()
  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')

  const kind = String(row.kind || 'video').toLowerCase()
  if (kind !== 'video') throw new NotFoundError('not_found')

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(ctx.userId)
  const checker = await resolveChecker(Number(ctx.userId))
  const isAdmin = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY, { checker })
  if (!isOwner && !isAdmin) throw new ForbiddenError()

  const bucket = String(UPLOAD_BUCKET || '')
  const key = buildUploadTimelineSpriteKey(uploadId, startSecond)
  if (!bucket || !key) throw new NotFoundError('not_found')

  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return {
      contentType: resp.ContentType ? String(resp.ContentType) : 'image/jpeg',
      body: resp.Body,
      contentLength: resp.ContentLength != null ? Number(resp.ContentLength) : null,
    }
  } catch (e: any) {
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    const name = String(e?.name || e?.Code || '')
    const isMissing = status === 404 || name === 'NotFound' || name === 'NoSuchKey'
    if (!isMissing) throw e
    await ensureTimelineSpritesEnqueued(row, ctx)
    throw new NotFoundError('not_found')
  }
}

export async function getUploadThumbStream(
  uploadId: number,
  ctx: ServiceContext
): Promise<{ contentType: string; body: any; contentLength?: number | null }> {
  if (!ctx.userId) throw new ForbiddenError()
  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')

  const kind = String(row.kind || 'video').toLowerCase()
  const isSystem = Number((row as any).is_system || 0) === 1

  // System audio is selectable by any logged-in user (not relevant for thumbs, but keep parity).
  if (!(isSystem && kind === 'audio')) {
    const ownerId = row.user_id != null ? Number(row.user_id) : null
    const isOwner = ownerId != null && ownerId === Number(ctx.userId)
    const checker = await resolveChecker(Number(ctx.userId))
    const isAdmin = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY, { checker })
    if (!isOwner && !isAdmin) throw new ForbiddenError()
  }

  // Only video uploads have thumbnails.
  if (kind !== 'video') throw new NotFoundError('not_found')

  const bucket = String(UPLOAD_BUCKET || '')
  const key = buildUploadThumbKey(Number(uploadId))

  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return {
      contentType: resp.ContentType ? String(resp.ContentType) : 'image/jpeg',
      body: resp.Body,
      contentLength: resp.ContentLength != null ? Number(resp.ContentLength) : null,
    }
  } catch (e: any) {
    const name = String(e?.name || e?.Code || '')
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    if (status === 404 || name === 'NoSuchKey' || name === 'NotFound') {
      await ensureThumbEnqueued(row, ctx)
      throw new NotFoundError('not_found')
    }
    throw e
  }
}

export async function getUploadThumbFallbackUrl(uploadId: number, ctx: ServiceContext): Promise<string | null> {
  if (!ctx.userId) throw new ForbiddenError()
  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')

  const kind = String(row.kind || 'video').toLowerCase()
  if (kind !== 'video') return null

  const isSystem = Number((row as any).is_system || 0) === 1
  if (!isSystem) {
    const ownerId = row.user_id != null ? Number(row.user_id) : null
    const isOwner = ownerId != null && ownerId === Number(ctx.userId)
    const checker = await resolveChecker(Number(ctx.userId))
    const isAdmin = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY, { checker })
    if (!isOwner && !isAdmin) throw new ForbiddenError()
  }

  const enhanced: any = enhanceUploadRow(row as any)
  const url =
    enhanced.poster_portrait_cdn ||
    enhanced.poster_landscape_cdn ||
    enhanced.poster_cdn ||
    enhanced.poster_portrait_s3 ||
    enhanced.poster_landscape_s3 ||
    enhanced.poster_s3 ||
    null
  return url ? String(url) : null
}

export async function listSystemAudio(
  params: { cursorId?: number; limit?: number } | undefined,
  ctx: ServiceContext
) {
  if (!ctx.userId) throw new ForbiddenError()

  const lim = clampLimit(params?.limit, 50, 1, 200)
  const cursorId = params?.cursorId && Number.isFinite(params.cursorId) ? Number(params.cursorId) : undefined

	  try {
	    const rows = await repo.list({
	      status: ['uploaded', 'completed'],
	      kind: 'audio',
	      isSystem: true,
	      cursorId,
	      limit: lim,
	    })
      const uploadIds = rows.map((r) => Number((r as any).id)).filter((n) => Number.isFinite(n) && n > 0)
      const tagMap = await audioTagsRepo.listTagAssignmentsForUploadIds(uploadIds)
      return rows.map((row) => {
        const enhanced: any = enhanceUploadRow(row)
        const id = Number((row as any).id)
        const tags = tagMap.get(id) || { genreTagIds: [], moodTagIds: [], themeTagIds: [], instrumentTagIds: [] }
        enhanced.genreTagIds = tags.genreTagIds
        enhanced.moodTagIds = tags.moodTagIds
        enhanced.themeTagIds = tags.themeTagIds
        enhanced.instrumentTagIds = tags.instrumentTagIds
        return enhanced
      })
	  } catch (e: any) {
	    const msg = String(e?.message || '')
	    // Backward compatibility when `uploads.is_system` is not deployed yet.
	    if (msg.includes('Unknown column') && msg.includes('is_system')) return []
	    throw e
	  }
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

export async function updateMetadata(
  id: number,
  input: { modifiedFilename?: string | null; description?: string | null },
  ctx: ServiceContext
) {
  if (!ctx.userId) throw new ForbiddenError()
  const currentUserId = Number(ctx.userId)

  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [id])
  const u = (rows as any[])[0]
  if (!u) throw new NotFoundError('not_found')

  const checker = await resolveChecker(currentUserId)
  const ownerId = u.user_id ? Number(u.user_id) : null
  const allowed =
    (ownerId && (await can(currentUserId, PERM.VIDEO_EDIT_OWN, { ownerId, checker }))) ||
    (await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker }))
  if (!allowed) throw new ForbiddenError()

  const rawName = input.modifiedFilename != null ? String(input.modifiedFilename) : ''
  const modifiedFilename = rawName.trim().length ? rawName.trim() : null
  const rawDescription = input.description != null ? String(input.description) : ''
  const description = rawDescription.trim().length ? rawDescription.trim() : null

  if (modifiedFilename && modifiedFilename.length > 512) {
    const err: any = new DomainError('invalid_name', 'invalid_name', 400)
    err.detail = { max: 512 }
    throw err
  }
  if (description && description.length > 2000) {
    const err: any = new DomainError('invalid_description', 'invalid_description', 400)
    err.detail = { max: 2000 }
    throw err
  }

  await db.query(`UPDATE uploads SET modified_filename = ?, description = ? WHERE id = ?`, [
    modifiedFilename,
    description,
    id,
  ])

  try {
    await db.query(
      `INSERT INTO action_log (user_id, action, resource_type, resource_id, detail)
       VALUES (?, 'update_metadata', 'upload', ?, ?)`,
      [currentUserId, id, JSON.stringify({ modified_filename: modifiedFilename, description })]
    )
  } catch {}

  const updated = await repo.getById(id)
  if (!updated) throw new NotFoundError('not_found')
  return enhanceUploadRow(updated)
}

export async function deleteSourceVideo(id: number, currentUserId: number): Promise<{ ok: true; alreadyDeleted?: true }> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [id])
  const u = (rows as any[])[0]
  if (!u) throw new NotFoundError('not_found')

  const kind = String(u.kind || 'video').toLowerCase()
  if (kind !== 'video') {
    const err: any = new DomainError('invalid_kind', 'invalid_kind', 400)
    err.detail = { expected: 'video', got: kind }
    throw err
  }

  if (u.source_deleted_at) return { ok: true, alreadyDeleted: true }

  const checker = await resolveChecker(currentUserId)
  const ownerId = u.user_id ? Number(u.user_id) : null
  const allowed =
    (ownerId && (await can(currentUserId, PERM.VIDEO_DELETE_OWN, { ownerId, checker }))) ||
    (await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker }))
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

  if (delUp && delUp.errors.length) {
    const err: any = new DomainError('s3_delete_failed', 's3_delete_failed', 502)
    err.detail = delUp
    throw err
  }

  await db.query(`UPDATE uploads SET source_deleted_at = NOW() WHERE id = ? AND source_deleted_at IS NULL`, [id])
  try {
    await db.query(
      `INSERT INTO action_log (user_id, action, resource_type, resource_id, detail)
       VALUES (?, 'delete_source', 'upload', ?, ?)`,
      [currentUserId, id, JSON.stringify({ s3_key: u.s3_key, s3_ops: delUp ? [delUp] : [] })]
    )
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
  artist?: string
  genreTagIds?: number[]
  moodTagIds?: number[]
  themeTagIds?: number[]
  instrumentTagIds?: number[]
  licenseSourceId?: number | null
  termsAccepted?: boolean
  kind?: 'video' | 'logo' | 'audio' | 'image'
  imageRole?: string | null
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
  const rawArtist = (input.artist || '').trim()
  const artist = rawArtist.length ? rawArtist.slice(0, 255) : null
  const safe = sanitizeFilename(filename)
  const lowerCt = String(contentType || '').toLowerCase()
  const extFromName = ((safe || '').match(/\.[^.]+$/) || [''])[0].toLowerCase()
  const { ymd: dateYmd, folder: datePrefix } = nowDateYmd()
  const basePrefix = UPLOAD_PREFIX ? (UPLOAD_PREFIX.endsWith('/') ? UPLOAD_PREFIX : UPLOAD_PREFIX + '/') : ''
  const kind = input.kind || 'video'
  const imageRoleRaw = input.imageRole != null ? String(input.imageRole).trim().toLowerCase() : ''
  const imageRole = imageRoleRaw ? imageRoleRaw : null
  const actorId = ctx.userId != null && Number.isFinite(ctx.userId) ? Number(ctx.userId) : null
  const db = getPool()
  const isSystem = kind === 'audio'
    ? (() => {
        if (!actorId) throw new ForbiddenError()
        return 1
      })()
    : 0

  if (actorId) {
    try {
      const [rows] = await db.query(
        `SELECT id
           FROM user_terms_acceptances
          WHERE user_id = ?
            AND terms_key = ?
            AND terms_version = ?
          LIMIT 1`,
        [actorId, TERMS_UPLOAD_KEY, TERMS_UPLOAD_VERSION]
      )
      const accepted = (rows as any[]).length > 0
      if (!accepted) {
        const ok = Boolean(input.termsAccepted)
        if (!ok) throw new DomainError('terms_required', 'terms_required', 400)
        const ip = ctx.ip != null ? String(ctx.ip).slice(0, 64) : null
        const ua = ctx.userAgent != null ? String(ctx.userAgent).slice(0, 512) : null
        await db.query(
          `INSERT IGNORE INTO user_terms_acceptances (user_id, terms_key, terms_version, accepted_ip, user_agent)
           VALUES (?, ?, ?, ?, ?)`,
          [actorId, TERMS_UPLOAD_KEY, TERMS_UPLOAD_VERSION, ip, ua]
        )
      }
    } catch (e: any) {
      const msg = String(e?.message || '')
      // Backward compatibility when the acceptances table isn't deployed yet.
      if (msg.includes('Table') && msg.includes('user_terms_acceptances')) {
        // ignore
      } else {
        throw e
      }
    }
  }

  if (kind === 'audio') {
    // System audio is curated by site_admin only (copyright risk).
    const ok = await can(actorId!, PERM.VIDEO_DELETE_ANY).catch(() => false)
    if (!ok) throw new ForbiddenError()
  }

  if (kind === 'image') {
    // First role shipped: title_page. Keep a tight allowlist for now.
    if (imageRole && imageRole !== 'title_page' && imageRole !== 'lower_third') {
      const err: any = new DomainError('invalid_image_role', 'invalid_image_role', 400)
      err.detail = { imageRole }
      throw err
    }
  }

  // Basic file type validation per kind (best-effort: uses content-type when present, otherwise file extension).
  const isLowerThirdImage = kind === 'image' && imageRole === 'lower_third'
  const allowed =
    kind === 'video'
      ? (lowerCt ? lowerCt.startsWith('video/') : false) || ['.mp4', '.webm', '.mov'].includes(extFromName)
      : kind === 'logo'
        ? (lowerCt ? ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(lowerCt) : false) || ['.png', '.jpg', '.jpeg', '.webp'].includes(extFromName)
        : kind === 'image'
          ? isLowerThirdImage
            ? (lowerCt ? lowerCt === 'image/png' : false) || extFromName === '.png'
            : (lowerCt ? ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(lowerCt) : false) || ['.png', '.jpg', '.jpeg', '.webp'].includes(extFromName)
        : (lowerCt ? lowerCt.startsWith('audio/') : false) || ['.mp3', '.wav', '.aac', '.m4a', '.mp4', '.ogg', '.opus'].includes(extFromName)
  if (!allowed) {
    const err: any = new DomainError('invalid_file_type', 'invalid_file_type', 400)
    err.detail = { kind, contentType: contentType || null, ext: extFromName || null }
    throw err
  }
  if ((kind === 'logo' || kind === 'image') && (lowerCt.includes('svg') || extFromName === '.svg')) {
    const err: any = new DomainError('invalid_file_type', 'invalid_file_type', 400)
    err.detail = { kind, contentType: contentType || null, ext: extFromName || null, reason: 'svg_not_allowed' }
    throw err
  }

  const ext = pickExtension(contentType, safe)
  const assetUuid = randomUUID()
  const key = buildUploadKey(basePrefix, datePrefix, assetUuid, ext, kind)

  let result: any
  try {
    ;[result] = await db.query(
      `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status, kind, image_role, is_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?, ?)`,
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
        imageRole,
        isSystem,
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
    } else if (msg.includes('Unknown column') && msg.includes('image_role')) {
      ;[result] = await db.query(
        `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status, kind, is_system)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?)`,
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
          isSystem,
        ]
      )
    } else if (msg.includes('Unknown column') && msg.includes('is_system')) {
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
    } else {
      throw e
    }
  }
  const id = Number((result as any).insertId)

  if (kind === 'audio' && artist) {
    try {
      await db.query(`UPDATE uploads SET artist = ? WHERE id = ?`, [artist, id])
    } catch (e: any) {
      const msg = String(e?.message || '')
      // Backward compatibility when `uploads.artist` isn't deployed yet.
      if (!(msg.includes('Unknown column') && msg.includes('artist'))) throw e
    }
  }

  if (kind === 'audio') {
    const genreIds = Array.isArray(input.genreTagIds) ? input.genreTagIds : []
    const moodIds = Array.isArray(input.moodTagIds) ? input.moodTagIds : []
    const themeIds = Array.isArray(input.themeTagIds) ? input.themeTagIds : []
    const instrumentIds = Array.isArray(input.instrumentTagIds) ? input.instrumentTagIds : []
    const requested = Array.from(
      new Set(
        [...genreIds, ...moodIds, ...themeIds, ...instrumentIds]
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    )
    if (requested.length) {
      try {
        const [rows] = await db.query(`SELECT id FROM audio_tags WHERE archived_at IS NULL AND id IN (?)`, [requested])
        const okIds = new Set((rows as any[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0))
        const invalid = requested.filter((n) => !okIds.has(n))
        if (invalid.length) {
          const err: any = new DomainError('invalid_audio_tags', 'invalid_audio_tags', 400)
          err.detail = { invalidTagIds: invalid }
          throw err
        }
        await audioTagsRepo.replaceUploadTags(id, requested)
      } catch (e: any) {
        const msg = String(e?.message || '')
        // Backward compatibility when tag tables aren't deployed yet.
        if ((msg.includes('Table') && msg.includes('audio_tags')) || (msg.includes('Table') && msg.includes('upload_audio_tags'))) {
          // ignore
        } else {
          throw e
        }
      }
    }
  }

  if (kind === 'audio') {
    const licenseSourceId = input.licenseSourceId != null ? Number(input.licenseSourceId) : null
    if (!licenseSourceId || !Number.isFinite(licenseSourceId) || licenseSourceId <= 0) {
      const err: any = new DomainError('license_source_required', 'license_source_required', 400)
      throw err
    }
    try {
      const [rows] = await db.query(`SELECT id FROM license_sources WHERE id = ? AND kind = 'audio' AND archived_at IS NULL LIMIT 1`, [licenseSourceId])
      if (!(rows as any[]).length) {
        const err: any = new DomainError('invalid_license_source', 'invalid_license_source', 400)
        err.detail = { licenseSourceId }
        throw err
      }
      await db.query(`UPDATE uploads SET license_source_id = ? WHERE id = ?`, [licenseSourceId, id])
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('Unknown column') && msg.includes('license_source_id')) {
        // ignore
      } else if (msg.includes('Table') && msg.includes('license_sources')) {
        // ignore
      } else {
        throw e
      }
    }
  }

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

    // First-time convenience: ensure the user has at least one logo configuration once they upload a logo.
    if (kind === 'logo') {
      try { await logoConfigsSvc.ensureDefaultForUser(Number(ownerId)) } catch {}
    }
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
    if ((kind === 'logo' || kind === 'image') && ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(lowerCt)) {
      conditions.push(['starts-with', '$Content-Type', 'image/'])
    }
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
  const prev = await repo.getById(Number(input.id))
  if (!prev) throw new NotFoundError('not_found')
  await db.query(
    `UPDATE uploads
       SET status = 'uploaded', uploaded_at = CURRENT_TIMESTAMP,
           etag = COALESCE(?, etag), size_bytes = COALESCE(?, size_bytes)
     WHERE id = ?`,
    [input.etag ?? null, input.sizeBytes ?? null, input.id]
  )

  // Generate source thumbnails asynchronously (Plan 39).
  // Only enqueue when transitioning into uploaded; avoid re-enqueueing on redundant calls.
  if (MEDIA_JOBS_ENABLED) {
    const prevStatus = String((prev as any).status || '').toLowerCase()
    const kind = String((prev as any).kind || 'video').toLowerCase()
    const ownerUserId = (prev as any).user_id != null ? Number((prev as any).user_id) : null
    const isSystem = Number((prev as any).is_system || 0) === 1
    const sourceDeletedAt = (prev as any).source_deleted_at != null ? String((prev as any).source_deleted_at) : null
	    if (!isSystem && !sourceDeletedAt && kind === 'video' && ownerUserId && prevStatus !== 'uploaded') {
	      try {
	        await enqueueJob('upload_thumb_v1', {
	          uploadId: Number(prev.id),
	          userId: ownerUserId,
	          video: { bucket: String(prev.s3_bucket), key: String(prev.s3_key) },
	          outputBucket: String(UPLOAD_BUCKET),
	          outputKey: buildUploadThumbKey(Number(prev.id)),
	          longEdgePx: 640,
	        })
	      } catch (e) {
	        // Best-effort: thumbnails are optional and UI falls back.
	      }
	      try {
	        await enqueueJob('upload_edit_proxy_v1', {
	          uploadId: Number(prev.id),
	          userId: ownerUserId,
	          video: { bucket: String(prev.s3_bucket), key: String(prev.s3_key) },
	          outputBucket: String(UPLOAD_BUCKET),
	          outputKey: buildUploadEditProxyKey(Number(prev.id)),
	          longEdgePx: 540,
	          fps: 30,
	          gop: 8,
	        })
	      } catch (e) {
	        // Best-effort: proxy is optional; editor can show a "generating" state.
	      }
	    }
	  }

  return { ok: true }
}
