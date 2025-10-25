import { can } from '../../security/permissions'
import { enhanceUploadRow } from '../../utils/enhance'
import { OUTPUT_BUCKET } from '../../config'
import { startProductionRender } from '../../services/productionRunner'
import * as repo from './repo'
import { type ProductionRecord } from './types'
import { NotFoundError, ForbiddenError } from '../../core/errors'

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

export async function list(currentUserId: number, targetUserId?: number) {
  const qUser = targetUserId ?? currentUserId
  const isAdmin = await can(currentUserId, 'video:delete_any')
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
  const isAdmin = await can(currentUserId, 'video:delete_any')
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
    }
  } catch {}
  return rec
}

export async function create(input: { uploadId: number; name?: string | null; profile?: string | null; quality?: string | null; sound?: string | null; config?: any }, currentUserId: number) {
  const upload = await repo.loadUpload(input.uploadId)
  if (!upload) throw new NotFoundError('upload_not_found')
  const upStatus = String(upload.status || '').toLowerCase()
  if (upStatus !== 'uploaded' && upStatus !== 'completed') {
    throw new ForbiddenError('invalid_state')
  }
  const ownerId = upload.user_id != null ? Number(upload.user_id) : null
  const isOwner = ownerId === currentUserId
  const canProduceAny = await can(currentUserId, 'video:delete_any')
  if (!isOwner && !canProduceAny) throw new ForbiddenError()

  const { jobId, outPrefix, productionId } = await startProductionRender({
    upload,
    userId: currentUserId,
    name: input.name ?? null,
    profile: input.profile ?? null,
    quality: input.quality ?? null,
    sound: input.sound ?? null,
    config: input.config,
  })
  if (input.name) {
    try { await repo.updateProductionNameIfEmpty(productionId, input.name) } catch {}
  }
  const row = await repo.getWithUpload(productionId)
  if (!row) throw new NotFoundError('not_found')
  const production = mapProduction(row)
  return { production, jobId, output: { bucket: OUTPUT_BUCKET, prefix: outPrefix } }
}

