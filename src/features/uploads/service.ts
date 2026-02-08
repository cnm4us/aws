import { enhanceUploadRow } from '../../utils/enhance'
import { buildUploadThumbKey } from '../../utils/uploadThumb'
import { buildUploadEditProxyKey } from '../../utils/uploadEditProxy'
import { ForbiddenError, NotFoundError, DomainError, ValidationError } from '../../core/errors'
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
import * as audioFavoritesRepo from '../audio-favorites/repo'
import * as uploadPrefsRepo from '../upload-prefs/repo'
import { TERMS_UPLOAD_KEY, TERMS_UPLOAD_VERSION } from '../../config'
import { buildUploadAudioEnvelopeKey } from '../../utils/uploadAudioEnvelope'
import { buildUploadFreezeFrameKey } from '../../utils/uploadFreezeFrame'
import { UPLOADS_CDN_DOMAIN, UPLOADS_CDN_SIGNED_URL_TTL_SECONDS, UPLOADS_CLOUDFRONT_KEY_PAIR_ID, UPLOADS_CLOUDFRONT_PRIVATE_KEY_PEM_BASE64 } from '../../config'
import { buildCloudFrontSignedUrl } from '../../utils/cloudfrontSignedUrl'
import { librarySourceValueSet } from '../../config/librarySources'

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
  const isSystemLibrary = Number((row as any).is_system_library || 0) === 1

  // System audio and system library videos are selectable by any logged-in user.
  if (!((isSystem && kind === 'audio') || (isSystemLibrary && kind === 'video'))) {
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

  const isSystemLibrary = Number((row as any).is_system_library || 0) === 1
  if (!isSystemLibrary) {
    const ownerId = row.user_id != null ? Number(row.user_id) : null
    const isOwner = ownerId != null && ownerId === Number(ctx.userId)
    const checker = await resolveChecker(Number(ctx.userId))
    const isAdmin = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY, { checker })
    if (!isOwner && !isAdmin) throw new ForbiddenError()
  }

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
        const ownerId = row?.user_id != null ? Number(row.user_id) : null
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

async function ensureEditProxyEnqueued(uploadRow: any, ctx: ServiceContext): Promise<void> {
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
          WHERE type = 'upload_edit_proxy_v1'
            AND status IN ('pending','processing')
            AND JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.uploadId')) = ?
          ORDER BY id DESC
          LIMIT 1`,
        [String(uploadId)]
      )
      alreadyQueued = (rows as any[]).length > 0
    } catch {}
    if (alreadyQueued) return

    await enqueueJob('upload_edit_proxy_v1', {
      uploadId,
      userId: userIdForJob,
      video: { bucket: String(uploadRow.s3_bucket), key: String(uploadRow.s3_key) },
      outputBucket: String(UPLOAD_BUCKET),
      outputKey: buildUploadEditProxyKey(uploadId),
      longEdgePx: 540,
      fps: 30,
      gop: 8,
    })
  } catch {
    // best-effort
  }
}

function uploadsCdnConfigured(): boolean {
  return Boolean(
    String(UPLOADS_CDN_DOMAIN || '').trim() &&
      String(UPLOADS_CLOUDFRONT_KEY_PAIR_ID || '').trim() &&
      String(UPLOADS_CLOUDFRONT_PRIVATE_KEY_PEM_BASE64 || '').trim()
  )
}

function encodeS3KeyForUrl(key: string): string {
  const raw = String(key || '').replace(/^\/+/, '')
  return raw
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

function signUploadsCdnUrl(key: string): { url: string; expiresAt: number } {
  if (!uploadsCdnConfigured()) throw new DomainError('cdn_not_configured')
  const expiresAt = Math.floor(Date.now() / 1000) + UPLOADS_CDN_SIGNED_URL_TTL_SECONDS
  const privateKeyPem = Buffer.from(String(UPLOADS_CLOUDFRONT_PRIVATE_KEY_PEM_BASE64), 'base64').toString('utf8')
  const url = `https://${String(UPLOADS_CDN_DOMAIN).trim()}/${encodeS3KeyForUrl(key)}`
  return {
    url: buildCloudFrontSignedUrl({
      url,
      keyPairId: String(UPLOADS_CLOUDFRONT_KEY_PAIR_ID).trim(),
      privateKeyPem,
      expiresEpochSeconds: expiresAt,
    }),
    expiresAt,
  }
}

export async function getUploadSignedCdnUrl(
  uploadId: number,
  params: { kind: 'file' | 'thumb' | 'edit_proxy' } | undefined,
  ctx: ServiceContext
): Promise<{ url: string; expiresAt: number }> {
  if (!ctx.userId) throw new ForbiddenError()
  if (!uploadsCdnConfigured()) throw new DomainError('cdn_not_configured')
  const kind = params?.kind
  if (!kind) throw new DomainError('bad_request')

  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')

  const rowKind = String(row.kind || 'video').toLowerCase()
  const isSystem = Number((row as any).is_system || 0) === 1
  const isSystemLibrary = Number((row as any).is_system_library || 0) === 1

  // Permission checks (mirror the stream endpoints).
  if (!((isSystem && rowKind === 'audio') || (isSystemLibrary && rowKind === 'video'))) {
    const ownerId = row.user_id != null ? Number(row.user_id) : null
    const isOwner = ownerId != null && ownerId === Number(ctx.userId)
    const checker = await resolveChecker(Number(ctx.userId))
    const isAdmin = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY, { checker })
    if (!isOwner && !isAdmin) throw new ForbiddenError()
  }

  let key = ''
  if (kind === 'file') {
    key = String(row.s3_key || '')
    if (!key) throw new NotFoundError('not_found')
  } else if (kind === 'edit_proxy') {
    if (rowKind !== 'video') throw new NotFoundError('not_found')
    key = buildUploadEditProxyKey(uploadId)
    // Ensure exists or enqueue.
    try {
      await s3.send(new HeadObjectCommand({ Bucket: String(UPLOAD_BUCKET), Key: key }))
    } catch (e: any) {
      const status = Number(e?.$metadata?.httpStatusCode || 0)
      const name = String(e?.name || e?.Code || '')
      const isMissing = status === 404 || name === 'NotFound' || name === 'NoSuchKey'
      if (!isMissing) throw e
      await ensureEditProxyEnqueued(row, ctx)
      throw new NotFoundError('not_found')
    }
  } else if (kind === 'thumb') {
    if (rowKind !== 'video') throw new NotFoundError('not_found')
    key = buildUploadThumbKey(uploadId)
    try {
      await s3.send(new HeadObjectCommand({ Bucket: String(UPLOAD_BUCKET), Key: key }))
    } catch (e: any) {
      const status = Number(e?.$metadata?.httpStatusCode || 0)
      const name = String(e?.name || e?.Code || '')
      const isMissing = status === 404 || name === 'NotFound' || name === 'NoSuchKey'
      if (!isMissing) throw e
      await ensureThumbEnqueued(row, ctx)
      throw new NotFoundError('not_found')
    }
  } else {
    throw new DomainError('bad_request')
  }

  return signUploadsCdnUrl(key)
}

async function readBodyText(body: any): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of body as any) {
    if (!chunk) continue
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
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
    const isAudio = kind === 'audio'
    const isNarrationAudio = isAudio && String(uploadRow?.s3_key || '').includes('audio/narration/')
    if (kind !== 'video' && !isAudio) return

    const userIdForJob = ownerId != null && Number.isFinite(ownerId) && ownerId > 0 ? ownerId : (ctx.userId != null ? Number(ctx.userId) : null)
    if (!userIdForJob) return

    const proxyBucket = isAudio ? String(uploadRow?.s3_bucket || '') : String(UPLOAD_BUCKET)
    const proxyKey = isAudio ? String(uploadRow?.s3_key || '') : buildUploadEditProxyKey(uploadId)
    if (!proxyBucket || !proxyKey) return
    if (!isAudio) {
      // Require the edit proxy to exist before enqueuing (video only).
      try {
        await s3.send(new HeadObjectCommand({ Bucket: String(UPLOAD_BUCKET), Key: proxyKey }))
      } catch {
        return
      }
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
      proxy: { bucket: proxyBucket, key: proxyKey },
      outputBucket: String(UPLOAD_BUCKET),
      outputKey: buildUploadAudioEnvelopeKey(uploadId),
      intervalSeconds: 0.1,
    })
  } catch {
    // best-effort
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

export async function requestUploadThumbRefresh(
  uploadId: number,
  params: { timeSeconds: number },
  ctx: ServiceContext
): Promise<{ status: 'queued' | 'pending' }> {
  if (!ctx.userId) throw new ForbiddenError()
  if (!MEDIA_JOBS_ENABLED) throw new DomainError('media_jobs_disabled', 'media_jobs_disabled', 503)

  const id = Number(uploadId)
  if (!Number.isFinite(id) || id <= 0) throw new DomainError('bad_id', 'bad_id', 400)
  const timeSeconds = Number(params?.timeSeconds)
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new DomainError('bad_time', 'bad_time', 400)

  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  const kind = String(row.kind || 'video').toLowerCase()
  if (kind !== 'video') throw new NotFoundError('not_found')
  if (row?.source_deleted_at) throw new NotFoundError('not_found')

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const checker = await resolveChecker(Number(ctx.userId))
  const isAdmin = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY, { checker })
  const isOwner = ownerId != null && ownerId === Number(ctx.userId)
  if (!isAdmin && !isOwner) throw new ForbiddenError()

  const bucket = String(row.s3_bucket || '')
  const key = String(row.s3_key || '')
  if (!bucket || !key) throw new NotFoundError('not_found')

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
      [String(id)]
    )
    alreadyQueued = (rows as any[]).length > 0
  } catch {}
  if (alreadyQueued) return { status: 'pending' }

  await enqueueJob('upload_thumb_v1', {
    uploadId: id,
    userId: Number(ctx.userId),
    video: { bucket, key },
    outputBucket: String(UPLOAD_BUCKET),
    outputKey: buildUploadThumbKey(id),
    longEdgePx: 640,
    seekSeconds: timeSeconds,
    force: true,
  })

  return { status: 'queued' }
}

export async function getUploadAudioEnvelope(
  uploadId: number,
  ctx: ServiceContext
): Promise<{ status: 'ready'; envelope: any } | { status: 'pending' }> {
  if (!ctx.userId) throw new ForbiddenError()
  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')

  const kind = String(row.kind || 'video').toLowerCase()
  const isAudio = kind === 'audio'
  if (kind !== 'video' && !isAudio) throw new NotFoundError('not_found')

  const isSystem = Number((row as any).is_system || 0) === 1
  if (!(isSystem && isAudio)) {
    const ownerId = row.user_id != null ? Number(row.user_id) : null
    const isOwner = ownerId != null && ownerId === Number(ctx.userId)
    const checker = await resolveChecker(Number(ctx.userId))
    const isAdmin = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY, { checker })
    if (!isOwner && !isAdmin) throw new ForbiddenError()
  }

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

export async function requestFreezeFrameUpload(
  uploadId: number,
  input: { atSeconds: number; longEdgePx?: number },
  ctx: ServiceContext
): Promise<{ status: 'completed' | 'pending'; freezeUploadId: number; key: string; bucket: string }> {
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

  const sourceDeletedAt = (row as any).source_deleted_at != null ? String((row as any).source_deleted_at) : null
  if (sourceDeletedAt) throw new DomainError('source_deleted', 'source_deleted', 409)

  const bucket = String(UPLOAD_BUCKET || '')
  const proxyKey = buildUploadEditProxyKey(Number(uploadId))
  if (!bucket || !proxyKey) throw new NotFoundError('not_found')

  // Ensure the edit proxy exists; if missing, enqueue generation and return pending.
  let proxyExists = false
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: proxyKey }))
    proxyExists = true
  } catch (e: any) {
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    const name = String(e?.name || e?.Code || '')
    const isMissing = status === 404 || name === 'NotFound' || name === 'NoSuchKey'
    if (!isMissing) throw e
    await ensureEditProxyEnqueued(row, ctx)
  }
  if (!proxyExists) {
    return { status: 'pending', freezeUploadId: 0, key: '', bucket: '' }
  }

  const atSecondsRaw = Number(input?.atSeconds ?? 0)
  const atSeconds = Number.isFinite(atSecondsRaw) ? Math.max(0, atSecondsRaw) : 0
  const longEdgePxRaw = input?.longEdgePx != null ? Number(input.longEdgePx) : 1080
  const longEdgePx = Number.isFinite(longEdgePxRaw) ? Math.max(64, Math.min(2160, Math.round(longEdgePxRaw))) : 1080

  const outKey = buildUploadFreezeFrameKey({ uploadId: Number(uploadId), atSeconds, longEdgePx })

  const db = getPool()
  // Create (or reuse) a derived upload row for the freeze-frame image.
  const [res] = await db.query(
    `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, content_type, kind, image_role, status, user_id, created_at)
     VALUES (?, ?, 'freeze_frame.png', NULL, 'image/png', 'image', 'freeze_frame', 'queued', ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [bucket, outKey, ownerId]
  )
  const freezeUploadId = Number((res as any).insertId)

  // If the image already exists in S3, mark completed and return.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: outKey }))
    try {
      await db.query(
        `UPDATE uploads
            SET status='completed', uploaded_at=COALESCE(uploaded_at, CURRENT_TIMESTAMP)
          WHERE id = ?`,
        [freezeUploadId]
      )
    } catch {}
    return { status: 'completed', freezeUploadId, key: outKey, bucket }
  } catch (e: any) {
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    const name = String(e?.name || e?.Code || '')
    const isMissing = status === 404 || name === 'NotFound' || name === 'NoSuchKey'
    if (!isMissing) throw e
  }

  // Best-effort: avoid duplicate in-flight jobs for this derived upload.
  try {
    const [rows] = await db.query(
      `SELECT id
         FROM media_jobs
        WHERE type = 'upload_freeze_frame_v1'
          AND status IN ('pending','processing')
          AND JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.freezeUploadId')) = ?
        ORDER BY id DESC
        LIMIT 1`,
      [String(freezeUploadId)]
    )
    if ((rows as any[]).length === 0) {
      await enqueueJob('upload_freeze_frame_v1', {
        freezeUploadId,
        uploadId: Number(uploadId),
        userId: ownerId != null && Number.isFinite(ownerId) && ownerId > 0 ? ownerId : Number(ctx.userId),
        proxy: { bucket, key: proxyKey },
        atSeconds,
        outputBucket: bucket,
        outputKey: outKey,
        longEdgePx,
      })
    }
  } catch {
    await enqueueJob('upload_freeze_frame_v1', {
      freezeUploadId,
      uploadId: Number(uploadId),
      userId: ownerId != null && Number.isFinite(ownerId) && ownerId > 0 ? ownerId : Number(ctx.userId),
      proxy: { bucket, key: proxyKey },
      atSeconds,
      outputBucket: bucket,
      outputKey: outKey,
      longEdgePx,
    })
  }

  return { status: 'pending', freezeUploadId, key: outKey, bucket }
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
        const favSet = await audioFavoritesRepo.listFavoriteUploadIdsForUser(Number(ctx.userId), uploadIds)
	      return rows.map((row) => {
	        const enhanced: any = enhanceUploadRow(row)
	        const id = Number((row as any).id)
	        const tags = tagMap.get(id) || { genreTagIds: [], moodTagIds: [], themeTagIds: [], instrumentTagIds: [] }
	        enhanced.genreTagIds = tags.genreTagIds
	        enhanced.moodTagIds = tags.moodTagIds
	        enhanced.themeTagIds = tags.themeTagIds
	        enhanced.instrumentTagIds = tags.instrumentTagIds
          enhanced.is_favorite = favSet.has(id)
	        return enhanced
	      })
		  } catch (e: any) {
		    const msg = String(e?.message || '')
		    // Backward compatibility when `uploads.is_system` is not deployed yet.
		    if (msg.includes('Unknown column') && msg.includes('is_system')) return []
		    throw e
		  }
	}

export async function searchSystemAudioByTags(
  input: {
    genreTagIds?: number[]
    moodTagIds?: number[]
    themeTagIds?: number[]
    instrumentTagIds?: number[]
    favoriteOnly?: boolean
    cursorId?: number
    limit?: number
  },
  ctx: ServiceContext
) {
  if (!ctx.userId) throw new ForbiddenError()

  const normalizeIds = (ids: any): number[] => {
    const raw = Array.isArray(ids) ? ids : []
    const cleaned = raw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    return Array.from(new Set(cleaned)).slice(0, 50)
  }
  const genreTagIds = normalizeIds(input?.genreTagIds)
  const moodTagIds = normalizeIds(input?.moodTagIds)
  const themeTagIds = normalizeIds(input?.themeTagIds)
  const instrumentTagIds = normalizeIds(input?.instrumentTagIds)

  const anyFilters = Boolean(genreTagIds.length || moodTagIds.length || themeTagIds.length || instrumentTagIds.length)
  if (!anyFilters && !input?.favoriteOnly) return await listSystemAudio({ cursorId: input?.cursorId, limit: input?.limit }, ctx)

  const lim = clampLimit(input?.limit, 50, 1, 200)
  const cursorId = input?.cursorId && Number.isFinite(input.cursorId) ? Number(input.cursorId) : undefined

  const db = getPool()
  const where: string[] = []
  const args: any[] = []

  where.push(`u.kind = 'audio'`)
  where.push(`u.is_system = 1`)
  where.push(`u.status IN ('uploaded','completed')`)
  if (cursorId) {
    where.push(`u.id < ?`)
    args.push(cursorId)
  }
  if (input?.favoriteOnly) {
    where.push(`EXISTS (SELECT 1 FROM user_audio_favorites f WHERE f.user_id = ? AND f.upload_id = u.id)`)
    args.push(Number(ctx.userId))
  }

  const addAxisExists = (kind: string, ids: number[]) => {
    if (!ids.length) return
    const placeholders = ids.map(() => '?').join(', ')
    where.push(
      `EXISTS (
        SELECT 1
          FROM upload_audio_tags uat
          JOIN audio_tags t ON t.id = uat.tag_id
         WHERE uat.upload_id = u.id
           AND t.archived_at IS NULL
           AND t.kind = ?
           AND t.id IN (${placeholders})
      )`
    )
    args.push(kind, ...ids)
  }

  addAxisExists('genre', genreTagIds)
  addAxisExists('mood', moodTagIds)
  addAxisExists('theme', themeTagIds)
  addAxisExists('instrument', instrumentTagIds)

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [rows] = await db.query(`SELECT u.* FROM uploads u ${whereSql} ORDER BY u.id DESC LIMIT ?`, [...args, lim])
  const uploadIds = (rows as any[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0)
  const tagMap = await audioTagsRepo.listTagAssignmentsForUploadIds(uploadIds)
  const favSet = await audioFavoritesRepo.listFavoriteUploadIdsForUser(Number(ctx.userId), uploadIds)
  return (rows as any[]).map((row) => {
    const enhanced: any = enhanceUploadRow(row)
    const id = Number((row as any).id)
    const tags = tagMap.get(id) || { genreTagIds: [], moodTagIds: [], themeTagIds: [], instrumentTagIds: [] }
    enhanced.genreTagIds = tags.genreTagIds
    enhanced.moodTagIds = tags.moodTagIds
    enhanced.themeTagIds = tags.themeTagIds
    enhanced.instrumentTagIds = tags.instrumentTagIds
    enhanced.is_favorite = favSet.has(id)
    return enhanced
  })
}

export async function setSystemAudioFavorite(
  input: { uploadId: number; favorite: boolean },
  ctx: ServiceContext
): Promise<{ ok: true; uploadId: number; favorite: boolean }> {
  if (!ctx.userId) throw new ForbiddenError()
  const uploadId = Number(input.uploadId)
  if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('bad_id')
  const favorite = Boolean(input.favorite)

  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')
  if (String((row as any).kind || '').toLowerCase() !== 'audio') throw new ForbiddenError()
  if (Number((row as any).is_system || 0) !== 1) throw new ForbiddenError()

  await audioFavoritesRepo.setFavorite(Number(ctx.userId), uploadId, favorite)
  return { ok: true, uploadId, favorite }
}

type VideoSortKey =
  | 'newest'
  | 'oldest'
  | 'name_asc'
  | 'name_desc'
  | 'duration_asc'
  | 'duration_desc'
  | 'size_asc'
  | 'size_desc'
  | 'recent'

function normalizeVideoSort(raw: any): VideoSortKey {
  const s = String(raw || '').trim().toLowerCase()
  switch (s) {
    case 'oldest':
    case 'name_asc':
    case 'name_desc':
    case 'duration_asc':
    case 'duration_desc':
    case 'size_asc':
    case 'size_desc':
    case 'recent':
      return s as VideoSortKey
    default:
      return 'newest'
  }
}

function videoSourceRoleWhereSql(): string {
  // Plan 68: prefer `video_role='source'`, else infer from s3_key.
  return `(
    u.video_role = 'source'
    OR (u.video_role IS NULL AND u.s3_key NOT REGEXP '(^|/)renders/')
  )`
}

export async function listUserVideoAssets(
  input: {
    q?: string
    sort?: string
    favoritesOnly?: boolean
    includeRecent?: boolean
    limit?: number
  },
  ctx: ServiceContext
): Promise<{ recent: any[]; items: any[] }> {
  if (!ctx.userId) throw new ForbiddenError()
  const userId = Number(ctx.userId)
  if (!Number.isFinite(userId) || userId <= 0) throw new ForbiddenError()

  const q = String(input?.q || '').trim().slice(0, 200)
  const sort = normalizeVideoSort(input?.sort)
  const favoritesOnly = Boolean(input?.favoritesOnly)
  const includeRecent = Boolean(input?.includeRecent)
  const lim = clampLimit(input?.limit, 200, 1, 500)

  const db = getPool()
  const where: string[] = []
  const args: any[] = []

  where.push(`u.kind = 'video'`)
  where.push(videoSourceRoleWhereSql())
  where.push(`u.status IN ('uploaded','completed')`)
  where.push(`u.source_deleted_at IS NULL`)
  where.push(`u.user_id = ?`)
  args.push(userId)

  if (q) {
    where.push(
      `(COALESCE(u.modified_filename, u.original_filename) LIKE ? OR u.description LIKE ? OR u.original_filename LIKE ?)`
    )
    const like = `%${q}%`
    args.push(like, like, like)
  }

  const joinSql = `LEFT JOIN user_upload_prefs p ON p.user_id = ? AND p.upload_id = u.id`
  const joinArgs = [userId]

  if (favoritesOnly) where.push(`COALESCE(p.is_favorite, 0) = 1`)

  const orderBy = (() => {
    switch (sort) {
      case 'oldest':
        return `u.id ASC`
      case 'name_asc':
        return `COALESCE(u.modified_filename, u.original_filename) ASC, u.id DESC`
      case 'name_desc':
        return `COALESCE(u.modified_filename, u.original_filename) DESC, u.id DESC`
      case 'duration_asc':
        return `COALESCE(u.duration_seconds, 0) ASC, u.id DESC`
      case 'duration_desc':
        return `COALESCE(u.duration_seconds, 0) DESC, u.id DESC`
      case 'size_asc':
        return `COALESCE(u.size_bytes, 0) ASC, u.id DESC`
      case 'size_desc':
        return `COALESCE(u.size_bytes, 0) DESC, u.id DESC`
      case 'recent':
        return `p.last_used_at DESC, u.id DESC`
      case 'newest':
      default:
        return `u.id DESC`
    }
  })()

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [rows] = await db.query(
    `SELECT u.*, COALESCE(p.is_favorite, 0) AS is_favorite, p.last_used_at
       FROM uploads u
       ${joinSql}
       ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ?`,
    [...joinArgs, ...args, lim]
  )

  const enhanced = (rows as any[]).map((row) => {
    const out: any = enhanceUploadRow(row)
    out.is_favorite = Number((row as any).is_favorite || 0) === 1
    out.last_used_at = (row as any).last_used_at == null ? null : String((row as any).last_used_at)
    return out
  })

  const shouldIncludeRecent = includeRecent && !q && !favoritesOnly && sort !== 'recent'
  if (!shouldIncludeRecent) return { recent: [], items: enhanced }

  const [recentRows] = await db.query(
    `SELECT u.*, COALESCE(p.is_favorite, 0) AS is_favorite, p.last_used_at
       FROM uploads u
       JOIN user_upload_prefs p ON p.user_id = ? AND p.upload_id = u.id
      WHERE u.kind = 'video'
        AND ${videoSourceRoleWhereSql()}
        AND u.status IN ('uploaded','completed')
        AND u.source_deleted_at IS NULL
        AND u.user_id = ?
        AND p.last_used_at IS NOT NULL
      ORDER BY p.last_used_at DESC
      LIMIT 10`,
    [userId, userId]
  )
  const recent = (recentRows as any[]).map((row) => {
    const out: any = enhanceUploadRow(row)
    out.is_favorite = Number((row as any).is_favorite || 0) === 1
    out.last_used_at = (row as any).last_used_at == null ? null : String((row as any).last_used_at)
    return out
  })

  return { recent, items: enhanced }
}

export async function setVideoAssetFavorite(
  input: { uploadId: number; favorite: boolean },
  ctx: ServiceContext
): Promise<{ ok: true; uploadId: number; favorite: boolean }> {
  if (!ctx.userId) throw new ForbiddenError()
  const userId = Number(ctx.userId)
  const uploadId = Number(input.uploadId)
  if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('bad_id')

  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')
  if (String((row as any).kind || 'video').toLowerCase() !== 'video') throw new ForbiddenError()
  if ((row as any).source_deleted_at) throw new ForbiddenError()
  const ownerId = (row as any).user_id != null ? Number((row as any).user_id) : null
  if (ownerId == null || ownerId !== userId) throw new ForbiddenError()

  const inferredRole = (() => {
    const roleRaw = (row as any).video_role != null ? String((row as any).video_role).trim().toLowerCase() : ''
    const keyRaw = (row as any).s3_key != null ? String((row as any).s3_key) : ''
    if (roleRaw === 'source' || roleRaw === 'export') return roleRaw
    return /(^|\/)renders\//.test(keyRaw) ? 'export' : 'source'
  })()
  if (inferredRole !== 'source') throw new ForbiddenError()

  await uploadPrefsRepo.setFavorite(userId, uploadId, Boolean(input.favorite))
  return { ok: true, uploadId, favorite: Boolean(input.favorite) }
}

export async function markVideoAssetUsed(
  input: { uploadId: number },
  ctx: ServiceContext
): Promise<{ ok: true; uploadId: number }> {
  if (!ctx.userId) throw new ForbiddenError()
  const userId = Number(ctx.userId)
  const uploadId = Number(input.uploadId)
  if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('bad_id')

  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')
  if (String((row as any).kind || 'video').toLowerCase() !== 'video') throw new ForbiddenError()
  if ((row as any).source_deleted_at) throw new ForbiddenError()
  const ownerId = (row as any).user_id != null ? Number((row as any).user_id) : null
  if (ownerId == null || ownerId !== userId) throw new ForbiddenError()

  const inferredRole = (() => {
    const roleRaw = (row as any).video_role != null ? String((row as any).video_role).trim().toLowerCase() : ''
    const keyRaw = (row as any).s3_key != null ? String((row as any).s3_key) : ''
    if (roleRaw === 'source' || roleRaw === 'export') return roleRaw
    return /(^|\/)renders\//.test(keyRaw) ? 'export' : 'source'
  })()
  if (inferredRole !== 'source') throw new ForbiddenError()

  await uploadPrefsRepo.markUsed(userId, uploadId)
  return { ok: true, uploadId }
}

type GraphicSortKey = 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'size_asc' | 'size_desc' | 'recent'

function normalizeGraphicSort(raw: any): GraphicSortKey {
  const s = String(raw || '').trim().toLowerCase()
  switch (s) {
    case 'oldest':
    case 'name_asc':
    case 'name_desc':
    case 'size_asc':
    case 'size_desc':
    case 'recent':
      return s as GraphicSortKey
    default:
      return 'newest'
  }
}

export async function listUserGraphicAssets(
  input: {
    q?: string
    sort?: string
    favoritesOnly?: boolean
    includeRecent?: boolean
    limit?: number
  },
  ctx: ServiceContext
): Promise<{ recent: any[]; items: any[] }> {
  if (!ctx.userId) throw new ForbiddenError()
  const userId = Number(ctx.userId)
  if (!Number.isFinite(userId) || userId <= 0) throw new ForbiddenError()

  const q = String(input?.q || '').trim().slice(0, 200)
  const sort = normalizeGraphicSort(input?.sort)
  const favoritesOnly = Boolean(input?.favoritesOnly)
  const includeRecent = Boolean(input?.includeRecent)
  const lim = clampLimit(input?.limit, 200, 1, 500)

  const db = getPool()
  const where: string[] = []
  const args: any[] = []

  where.push(`u.kind = 'image'`)
  where.push(`LOWER(COALESCE(u.image_role, '')) = 'overlay'`)
  where.push(`u.status IN ('uploaded','completed')`)
  where.push(`u.source_deleted_at IS NULL`)
  where.push(`u.user_id = ?`)
  args.push(userId)

  if (q) {
    where.push(
      `(COALESCE(u.modified_filename, u.original_filename) LIKE ? OR u.description LIKE ? OR u.original_filename LIKE ?)`
    )
    const like = `%${q}%`
    args.push(like, like, like)
  }

  const joinSql = `LEFT JOIN user_upload_prefs p ON p.user_id = ? AND p.upload_id = u.id`
  const joinArgs = [userId]

  if (favoritesOnly) where.push(`COALESCE(p.is_favorite, 0) = 1`)

  const orderBy = (() => {
    switch (sort) {
      case 'oldest':
        return `u.id ASC`
      case 'name_asc':
        return `COALESCE(u.modified_filename, u.original_filename) ASC, u.id DESC`
      case 'name_desc':
        return `COALESCE(u.modified_filename, u.original_filename) DESC, u.id DESC`
      case 'size_asc':
        return `COALESCE(u.size_bytes, 0) ASC, u.id DESC`
      case 'size_desc':
        return `COALESCE(u.size_bytes, 0) DESC, u.id DESC`
      case 'recent':
        return `p.last_used_at DESC, u.id DESC`
      case 'newest':
      default:
        return `u.id DESC`
    }
  })()

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [rows] = await db.query(
    `SELECT u.*, COALESCE(p.is_favorite, 0) AS is_favorite, p.last_used_at
       FROM uploads u
       ${joinSql}
       ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ?`,
    [...joinArgs, ...args, lim]
  )

  const enhanced = (rows as any[]).map((row) => {
    const out: any = enhanceUploadRow(row)
    out.is_favorite = Number((row as any).is_favorite || 0) === 1
    out.last_used_at = (row as any).last_used_at == null ? null : String((row as any).last_used_at)
    return out
  })

  const shouldIncludeRecent = includeRecent && !q && !favoritesOnly && sort !== 'recent'
  if (!shouldIncludeRecent) return { recent: [], items: enhanced }

  const [recentRows] = await db.query(
    `SELECT u.*, COALESCE(p.is_favorite, 0) AS is_favorite, p.last_used_at
       FROM uploads u
       JOIN user_upload_prefs p ON p.user_id = ? AND p.upload_id = u.id
      WHERE u.kind = 'image'
        AND LOWER(COALESCE(u.image_role, '')) = 'overlay'
        AND u.status IN ('uploaded','completed')
        AND u.source_deleted_at IS NULL
        AND u.user_id = ?
        AND p.last_used_at IS NOT NULL
      ORDER BY p.last_used_at DESC
      LIMIT 10`,
    [userId, userId]
  )
  const recent = (recentRows as any[]).map((row) => {
    const out: any = enhanceUploadRow(row)
    out.is_favorite = Number((row as any).is_favorite || 0) === 1
    out.last_used_at = (row as any).last_used_at == null ? null : String((row as any).last_used_at)
    return out
  })

  return { recent, items: enhanced }
}

export async function setGraphicAssetFavorite(
  input: { uploadId: number; favorite: boolean },
  ctx: ServiceContext
): Promise<{ ok: true; uploadId: number; favorite: boolean }> {
  if (!ctx.userId) throw new ForbiddenError()
  const userId = Number(ctx.userId)
  const uploadId = Number(input.uploadId)
  if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('bad_id')

  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')
  if (String((row as any).kind || '').toLowerCase() !== 'image') throw new ForbiddenError()
  if (String((row as any).image_role || '').toLowerCase() !== 'overlay') throw new ForbiddenError()
  if ((row as any).source_deleted_at) throw new ForbiddenError()
  const ownerId = (row as any).user_id != null ? Number((row as any).user_id) : null
  if (ownerId == null || ownerId !== userId) throw new ForbiddenError()

  await uploadPrefsRepo.setFavorite(userId, uploadId, Boolean(input.favorite))
  return { ok: true, uploadId, favorite: Boolean(input.favorite) }
}

export async function markGraphicAssetUsed(
  input: { uploadId: number },
  ctx: ServiceContext
): Promise<{ ok: true; uploadId: number }> {
  if (!ctx.userId) throw new ForbiddenError()
  const userId = Number(ctx.userId)
  const uploadId = Number(input.uploadId)
  if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('bad_id')

  const row = await repo.getById(uploadId)
  if (!row) throw new NotFoundError('not_found')
  if (String((row as any).kind || '').toLowerCase() !== 'image') throw new ForbiddenError()
  if (String((row as any).image_role || '').toLowerCase() !== 'overlay') throw new ForbiddenError()
  if ((row as any).source_deleted_at) throw new ForbiddenError()
  const ownerId = (row as any).user_id != null ? Number((row as any).user_id) : null
  if (ownerId == null || ownerId !== userId) throw new ForbiddenError()

  await uploadPrefsRepo.markUsed(userId, uploadId)
  return { ok: true, uploadId }
}

export async function listSummariesByIds(
  input: { ids: number[] },
  ctx: ServiceContext
): Promise<{ items: Array<{ id: number; original_filename: string; modified_filename: string | null; duration_seconds: number | null }> }> {
  if (!ctx.userId) throw new ForbiddenError()
  const ids = Array.isArray(input.ids) ? input.ids : []
  const cleaned = ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
  if (!cleaned.length) return { items: [] }
  const uniq = Array.from(new Set(cleaned)).slice(0, 50)

  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, original_filename, modified_filename, duration_seconds
       FROM uploads
      WHERE id IN (?)
        AND (user_id = ? OR user_id IS NULL)
      ORDER BY id ASC`,
    [uniq, Number(ctx.userId)]
  )
  const items = (rows as any[]).map((r) => ({
    id: Number(r.id),
    original_filename: String(r.original_filename || ''),
    modified_filename: r.modified_filename == null ? null : String(r.modified_filename),
    duration_seconds:
      r.duration_seconds == null || r.duration_seconds === ''
        ? null
        : (Number.isFinite(Number(r.duration_seconds)) ? Number(r.duration_seconds) : null),
  }))
  return { items }
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
  sourceOrg?: string
  systemLibrary?: boolean
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
  const rawSourceOrg = (input.sourceOrg || '').trim().toLowerCase()
  const sourceOrg = rawSourceOrg.length ? rawSourceOrg.slice(0, 64) : null
  const systemLibrary = Boolean(input.systemLibrary)
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
  const ownerUserId = input.ownerUserId != null && Number.isFinite(input.ownerUserId) ? Number(input.ownerUserId) : (actorId ?? null)

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
  if (systemLibrary) {
    // System library videos are curated by site_admin only.
    if (kind !== 'video') throw new DomainError('invalid_library_kind', 'invalid_library_kind', 400)
    const ok = await can(actorId!, PERM.VIDEO_DELETE_ANY).catch(() => false)
    if (!ok) throw new ForbiddenError()
    if (sourceOrg && !librarySourceValueSet.has(sourceOrg)) {
      const err: any = new DomainError('invalid_source_org', 'invalid_source_org', 400)
      err.detail = { sourceOrg }
      throw err
    }
  }

  if (kind === 'image') {
    // First role shipped: title_page. Keep a tight allowlist for now.
    if (imageRole && imageRole !== 'title_page' && imageRole !== 'lower_third' && imageRole !== 'overlay') {
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
      `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status, kind, image_role, is_system, user_id, is_system_library, source_org)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?, ?, ?, ?, ?)`,
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
        ownerUserId,
        systemLibrary ? 1 : 0,
        systemLibrary ? sourceOrg : null,
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
        `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status, kind, is_system, user_id, is_system_library, source_org)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?, ?, ?, ?)`,
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
          ownerUserId,
          systemLibrary ? 1 : 0,
          systemLibrary ? sourceOrg : null,
        ]
      )
    } else if (msg.includes('Unknown column') && msg.includes('is_system')) {
      ;[result] = await db.query(
        `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status, kind, user_id)
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
          ownerUserId,
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
    const isSystemLibrary = Number((prev as any).is_system_library || 0) === 1
    const sourceDeletedAt = (prev as any).source_deleted_at != null ? String((prev as any).source_deleted_at) : null
	    if (!sourceDeletedAt && kind === 'video' && ownerUserId && prevStatus !== 'uploaded') {
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
        // For system library videos, enqueue transcription as soon as upload completes.
        if (isSystemLibrary) {
          try {
            await enqueueJob('assemblyai_upload_transcript_v1', {
              uploadId: Number(prev.id),
              userId: ownerUserId,
            })
          } catch {
            // best-effort
          }
        }
	    }

    // Narration (voice memo) uploads: generate an audio envelope from the audio file itself.
    try {
      const key = String((prev as any).s3_key || '')
      const isNarrationAudio = kind === 'audio' && key.includes('audio/narration/')
      if (!isSystem && !sourceDeletedAt && isNarrationAudio && ownerUserId && prevStatus !== 'uploaded') {
        await enqueueJob('upload_audio_envelope_v1', {
          uploadId: Number(prev.id),
          userId: ownerUserId,
          proxy: { bucket: String((prev as any).s3_bucket || ''), key },
          outputBucket: String(UPLOAD_BUCKET),
          outputKey: buildUploadAudioEnvelopeKey(Number(prev.id)),
          intervalSeconds: 0.1,
        })
      }
    } catch {
      // best-effort
    }
	  }

  return { ok: true }
}
