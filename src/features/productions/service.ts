import { can, resolveChecker } from '../../security/permissions'
import { PERM } from '../../security/perm'
import { enhanceUploadRow } from '../../utils/enhance'
import { OUTPUT_BUCKET } from '../../config'
import { getPool } from '../../db'
import { startProductionRender } from '../../services/productionRunner'
import * as repo from './repo'
import { type ProductionRecord } from './types'
import { NotFoundError, ForbiddenError, DomainError } from '../../core/errors'
import * as logoConfigsSvc from '../logo-configs/service'
import { s3 } from '../../services/s3'
import { DeleteObjectsCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, type _Object } from '@aws-sdk/client-s3'

function mapProduction(row: any): ProductionRecord {
  return {
    id: Number(row.id),
    upload_id: Number(row.upload_id),
    user_id: Number(row.user_id),
    name: row.name ? String(row.name) : null,
    status: String(row.status) as any,
    config: row.config ? safeJson(row.config) : null,
    output_prefix: row.output_prefix ? String(row.output_prefix) : null,
    mediaconvert_job_id: row.mediaconvert_job_id ? String(row.mediaconvert_job_id) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    created_at: String(row.created_at),
    started_at: row.started_at ? String(row.started_at) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    upload: row.upload_id
      ? {
          id: Number(row.upload_id),
          original_filename: row.original_filename ? String(row.original_filename) : '',
          modified_filename: row.modified_filename ? String(row.modified_filename) : (row.original_filename ? String(row.original_filename) : ''),
          description: row.upload_description != null ? String(row.upload_description) : null,
          status: row.upload_status ? String(row.upload_status) : '',
          size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
          width: row.width != null ? Number(row.width) : null,
          height: row.height != null ? Number(row.height) : null,
          created_at: row.upload_created_at ? String(row.upload_created_at) : '',
        }
      : undefined,
  }
}

function safeJson(input: any) {
  if (!input) return null
  if (typeof input === 'object') return input
  try { return JSON.parse(String(input)) } catch { return null }
}

function normalizeUploadStatus(status: any): string {
  return String(status || '').toLowerCase()
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

function normalizeProductionOutputPrefix(prefix: string): string {
  let p = String(prefix || '')
  if (!p.endsWith('/')) p += '/'
  p = p.replace(/(?:portrait|landscape)\/$/, '')
  if (!p.endsWith('/')) p += '/'
  return p
}

async function loadAssetUploadOrThrow(
  uploadId: number,
  currentUserId: number,
  opts: { expectedKind: 'logo' | 'audio'; allowAdmin: boolean; requireReadyStatus?: boolean }
) {
  const row = await repo.loadUpload(uploadId)
  if (!row) {
    const code = `${opts.expectedKind}_upload_not_found`
    throw new DomainError(code, code, 404)
  }
  const kind = String((row as any).kind || '').toLowerCase()
  if (kind !== opts.expectedKind) {
    const code = `invalid_${opts.expectedKind}_upload_kind`
    throw new DomainError(code, code, 400)
  }
  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(currentUserId)
  if (!isOwner && !opts.allowAdmin) throw new ForbiddenError()
  if (opts.requireReadyStatus !== false) {
    const st = normalizeUploadStatus(row.status)
    if (st !== 'uploaded' && st !== 'completed') {
      const code = `invalid_${opts.expectedKind}_upload_state`
      throw new DomainError(code, code, 422)
    }
  }
  return row
}

export async function list(currentUserId: number, targetUserId?: number) {
  const qUser = targetUserId ?? currentUserId
  const checker = await resolveChecker(currentUserId)
  const isAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  if (!isAdmin && qUser !== currentUserId) throw new ForbiddenError()
  const rows = await repo.listForUser(qUser)
  return rows.map((row) => {
    const rec = mapProduction(row)
    try {
      const enhancedUpload = enhanceUploadRow({
        s3_key: row.upload_s3_key,
        output_prefix: row.upload_output_prefix,
        original_filename: row.original_filename,
        width: row.width,
        height: row.height,
        profile: row.upload_profile,
      })
      if (rec.upload) {
        ;(rec.upload as any).poster_portrait_cdn = enhancedUpload.poster_portrait_cdn
        ;(rec.upload as any).poster_cdn = enhancedUpload.poster_cdn
        ;(rec.upload as any).poster_portrait_s3 = enhancedUpload.poster_portrait_s3
        ;(rec.upload as any).poster_s3 = enhancedUpload.poster_s3
        ;(rec.upload as any).cdn_master = enhancedUpload.cdn_master
        ;(rec.upload as any).s3_master = enhancedUpload.s3_master
      }
    } catch {}
    return rec
  })
}

export async function get(id: number, currentUserId: number) {
  const row = await repo.getWithUpload(id)
  if (!row) throw new NotFoundError('not_found')
  const ownerId = Number(row.user_id)
  const isOwner = ownerId === currentUserId
  const checker = await resolveChecker(currentUserId)
  const isAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  if (!isOwner && !isAdmin) throw new ForbiddenError()
  const rec = mapProduction(row)
  try {
    const enhancedUpload = enhanceUploadRow({
      s3_key: row.upload_s3_key,
      output_prefix: row.upload_output_prefix,
      original_filename: row.original_filename,
      width: row.width,
      height: row.height,
      profile: row.upload_profile,
    })
    if (rec.upload) {
      ;(rec.upload as any).poster_portrait_cdn = enhancedUpload.poster_portrait_cdn
      ;(rec.upload as any).poster_cdn = enhancedUpload.poster_cdn
      ;(rec.upload as any).poster_portrait_s3 = enhancedUpload.poster_portrait_s3
      ;(rec.upload as any).poster_s3 = enhancedUpload.poster_s3
      ;(rec.upload as any).cdn_master = enhancedUpload.cdn_master
      ;(rec.upload as any).s3_master = enhancedUpload.s3_master
    }
  } catch {}
  return rec
}

export async function create(
  input: {
    uploadId: number
    name?: string | null
    profile?: string | null
    quality?: string | null
    sound?: string | null
    config?: any
    musicUploadId?: number | null
    logoUploadId?: number | null
    logoConfigId?: number | null
  },
  currentUserId: number
) {
  const upload = await repo.loadUpload(input.uploadId)
  if (!upload) throw new NotFoundError('upload_not_found')
  if ((upload as any).source_deleted_at) {
    throw new DomainError('source_deleted', 'source_deleted', 409)
  }
  const upStatus = String(upload.status || '').toLowerCase()
  if (upStatus !== 'uploaded' && upStatus !== 'completed') {
    throw new ForbiddenError('invalid_state')
  }
  const ownerId = upload.user_id != null ? Number(upload.user_id) : null
  const isOwner = ownerId === currentUserId
  const checker = await resolveChecker(currentUserId)
  const canProduceAny = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  if (!isOwner && !canProduceAny) throw new ForbiddenError()

  // Validate referenced enhancement assets early (so we fail fast with clear 4xx errors).
  // Ownership rule: must be owned by the producing user unless site admin (VIDEO_DELETE_ANY).
  if (input.logoUploadId != null) {
    await loadAssetUploadOrThrow(Number(input.logoUploadId), currentUserId, { expectedKind: 'logo', allowAdmin: canProduceAny })
  }
  if (input.musicUploadId != null) {
    await loadAssetUploadOrThrow(Number(input.musicUploadId), currentUserId, { expectedKind: 'audio', allowAdmin: canProduceAny })
  }

  const baseConfig = input.config && typeof input.config === 'object' ? input.config : {}
  const mergedConfig: any = { ...baseConfig }
  if (input.musicUploadId !== undefined) mergedConfig.musicUploadId = input.musicUploadId
  if (input.logoUploadId !== undefined) mergedConfig.logoUploadId = input.logoUploadId
  if (input.logoConfigId !== undefined) {
    if (input.logoConfigId == null) {
      mergedConfig.logoConfigId = null
      mergedConfig.logoConfigSnapshot = null
    } else {
      const cfg = await logoConfigsSvc.getActiveForUser(Number(input.logoConfigId), currentUserId)
      mergedConfig.logoConfigId = cfg.id
      mergedConfig.logoConfigSnapshot = {
        id: cfg.id,
        name: cfg.name,
        position: cfg.position,
        sizePctWidth: cfg.sizePctWidth,
        opacityPct: cfg.opacityPct,
        timingRule: cfg.timingRule,
        timingSeconds: cfg.timingSeconds,
        fade: cfg.fade,
        insetXPreset: (cfg as any).insetXPreset ?? null,
        insetYPreset: (cfg as any).insetYPreset ?? null,
      }
    }
  }

  const { jobId, outPrefix, productionId } = await startProductionRender({
    upload,
    userId: currentUserId,
    name: input.name ?? null,
    profile: input.profile ?? null,
    quality: input.quality ?? null,
    sound: input.sound ?? null,
    config: mergedConfig,
  })
  if (input.name) {
    try { await repo.updateProductionNameIfEmpty(productionId, input.name) } catch {}
  }
  const row = await repo.getWithUpload(productionId)
  if (!row) throw new NotFoundError('not_found')
  const production = mapProduction(row)
  return { production, jobId, output: { bucket: OUTPUT_BUCKET, prefix: outPrefix } }
}

// Wrapper used by legacy /api/publish route.
// Preserves historical permission semantics: allow owner, site admin, global/video publish, or space publish/approve on the upload's space.
export async function createForPublishRoute(input: { uploadId: number; profile?: string | null; quality?: string | null; sound?: string | null; config?: any }, currentUserId: number) {
  const upload = await repo.loadUpload(input.uploadId)
  if (!upload) throw new NotFoundError('upload_not_found')
  const upStatus = String((upload as any).status || '').toLowerCase()
  if (upStatus !== 'uploaded' && upStatus !== 'completed') {
    throw new ForbiddenError('invalid_state')
  }
  const ownerId = upload.user_id != null ? Number(upload.user_id) : null
  const spaceId = (upload as any).space_id != null ? Number((upload as any).space_id) : null
  const checker = await resolveChecker(currentUserId)

  const allowed =
    (ownerId != null && ownerId === currentUserId && (await can(currentUserId, PERM.VIDEO_PUBLISH_OWN, { ownerId, checker }))) ||
    (await can(currentUserId, PERM.VIDEO_PUBLISH_SPACE, { checker })) ||
    (spaceId != null && (await can(currentUserId, PERM.VIDEO_PUBLISH_SPACE, { spaceId, checker }))) ||
    (await can(currentUserId, PERM.VIDEO_APPROVE, { checker })) ||
    (await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker }))

  if (!allowed) throw new ForbiddenError()

  const { jobId, outPrefix, productionId } = await startProductionRender({
    upload,
    userId: currentUserId,
    name: null,
    profile: input.profile ?? null,
    quality: input.quality ?? null,
    sound: input.sound ?? null,
    config: input.config,
  })
  const row = await repo.getWithUpload(productionId)
  if (!row) throw new NotFoundError('not_found')
  const production = mapProduction(row)
  return { production, jobId, output: { bucket: OUTPUT_BUCKET, prefix: outPrefix } }
}

export async function remove(id: number, currentUserId: number): Promise<{ ok: true }> {
  const row = await repo.getWithUpload(id)
  if (!row) throw new NotFoundError('not_found')

  const ownerId = Number(row.user_id)
  const isOwner = ownerId === currentUserId
  const checker = await resolveChecker(currentUserId)
  const isAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  if (!isOwner && !isAdmin) throw new ForbiddenError()

  const pubsCount = await repo.countSpacePublicationsForProduction(id)
  if (pubsCount > 0) {
    const err: any = new DomainError('production_has_publications', 'production_has_publications', 409)
    err.detail = { activePublications: pubsCount }
    throw err
  }

  const outPrefixRaw = row.output_prefix ? String(row.output_prefix) : null
  if (outPrefixRaw) {
    const prefix = normalizeProductionOutputPrefix(outPrefixRaw)
    const del = await deletePrefix(OUTPUT_BUCKET, prefix)
    if (del.errors.length) {
      const err: any = new DomainError('s3_delete_failed', 's3_delete_failed', 502)
      err.detail = del
      throw err
    }
  }

  // Safe now: no publications should reference this production.
  const db = getPool()
  await db.query(`DELETE FROM productions WHERE id = ?`, [id])
  return { ok: true }
}
