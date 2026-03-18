import { DomainError } from '../../core/errors'
import {
  IMAGE_VARIANT_PROFILE_BY_KEY,
  type ImageVariantProfile,
  type ImageVariantUsage,
  type ImageVariantFormat,
} from '../../config'
import * as repo from './repo'
import type {
  UpsertUploadImageVariantInput,
  UploadImageVariant,
  UploadImageVariantRow,
  UploadImageVariantStatus,
} from './types'

const ALLOWED_USES: readonly ImageVariantUsage[] = ['message_bg', 'graphic_overlay', 'logo', 'lower_third']
const ALLOWED_FORMATS: readonly ImageVariantFormat[] = ['webp', 'png']

function normalizeUploadId(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('invalid_upload_id', 'invalid_upload_id', 400)
  return Math.round(n)
}

function normalizeUsage(raw: any): ImageVariantUsage {
  const value = String(raw || '').trim().toLowerCase()
  if ((ALLOWED_USES as readonly string[]).includes(value)) return value as ImageVariantUsage
  throw new DomainError('invalid_variant_usage', 'invalid_variant_usage', 400)
}

function normalizeFormat(raw: any): ImageVariantFormat {
  const value = String(raw || '').trim().toLowerCase()
  if ((ALLOWED_FORMATS as readonly string[]).includes(value)) return value as ImageVariantFormat
  throw new DomainError('invalid_variant_format', 'invalid_variant_format', 400)
}

function normalizeProfileKey(raw: any): string {
  const value = String(raw || '').trim()
  if (!value) throw new DomainError('invalid_profile_key', 'invalid_profile_key', 400)
  if (!IMAGE_VARIANT_PROFILE_BY_KEY.has(value)) throw new DomainError('unknown_profile_key', 'unknown_profile_key', 400)
  return value
}

function normalizeNullableInt(raw: any, key: string): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return Math.round(n)
}

function normalizeString(raw: any, key: string, max: number): string {
  const value = String(raw || '').trim()
  if (!value || value.length > max) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return value
}

function normalizeStatus(raw: any): UploadImageVariantStatus {
  const value = String(raw || 'ready').trim().toLowerCase()
  return value === 'failed' ? 'failed' : 'ready'
}

function mapRow(row: UploadImageVariantRow): UploadImageVariant {
  const profile = IMAGE_VARIANT_PROFILE_BY_KEY.get(String(row.profile_key || ''))
  const usageRaw = row.variant_usage ?? row.usage
  const usage = profile?.usage || normalizeUsage(usageRaw)
  const formatRaw = String(row.format || '').toLowerCase()
  const format: ImageVariantFormat = (ALLOWED_FORMATS as readonly string[]).includes(formatRaw)
    ? (formatRaw as ImageVariantFormat)
    : (profile?.format || 'webp')

  return {
    id: Number(row.id),
    uploadId: Number(row.upload_id),
    profileKey: String(row.profile_key || ''),
    usage,
    format,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    s3Bucket: String(row.s3_bucket || ''),
    s3Key: String(row.s3_key || ''),
    etag: row.etag == null ? null : String(row.etag),
    status: row.status === 'failed' ? 'failed' : 'ready',
    errorCode: row.error_code == null ? null : String(row.error_code),
    lastGeneratedAt: String(row.last_generated_at || ''),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

export async function upsertVariant(input: UpsertUploadImageVariantInput): Promise<void> {
  const uploadId = normalizeUploadId(input.uploadId)
  const profileKey = normalizeProfileKey(input.profileKey)
  const usage = normalizeUsage(input.usage)
  const format = normalizeFormat(input.format)
  const width = normalizeNullableInt(input.width, 'width')
  const height = normalizeNullableInt(input.height, 'height')
  const sizeBytes = normalizeNullableInt(input.sizeBytes, 'size_bytes')
  const s3Bucket = normalizeString(input.s3Bucket, 's3_bucket', 255)
  const s3Key = normalizeString(input.s3Key, 's3_key', 1024)
  const status = normalizeStatus(input.status)
  const errorCode = input.errorCode == null ? null : String(input.errorCode || '').trim().slice(0, 64) || null
  const etag = input.etag == null ? null : String(input.etag || '').trim().slice(0, 128) || null
  const lastGeneratedAt = input.lastGeneratedAt == null || String(input.lastGeneratedAt).trim() === ''
    ? null
    : String(input.lastGeneratedAt).trim()

  await repo.upsert({
    uploadId,
    profileKey,
    variantUsage: usage,
    format,
    width,
    height,
    sizeBytes,
    s3Bucket,
    s3Key,
    etag,
    status,
    errorCode,
    lastGeneratedAt,
  })
}

export async function listVariantsByUpload(
  uploadIdRaw: number,
  params?: { status?: UploadImageVariantStatus | null; usage?: ImageVariantUsage | null }
): Promise<UploadImageVariant[]> {
  const uploadId = normalizeUploadId(uploadIdRaw)
  const usage = params?.usage ? normalizeUsage(params.usage) : null
  const status = params?.status || null
  const rows = await repo.listByUploadId(uploadId, { status, variantUsage: usage })
  return rows.map(mapRow)
}

export async function getVariantByProfile(uploadIdRaw: number, profileKeyRaw: string): Promise<UploadImageVariant | null> {
  const uploadId = normalizeUploadId(uploadIdRaw)
  const profileKey = normalizeProfileKey(profileKeyRaw)
  const row = await repo.getByUploadAndProfile(uploadId, profileKey)
  return row ? mapRow(row) : null
}

function scoreVariant(params: {
  variant: UploadImageVariant
  profile: ImageVariantProfile | null
  usage: ImageVariantUsage
  orientation: 'portrait' | 'landscape' | null
  targetDpr: 1 | 2
}): number {
  const { variant, profile, usage, orientation, targetDpr } = params
  if (variant.status !== 'ready') return -10_000
  if (variant.usage !== usage) return -5_000
  if (!profile) return -500

  let score = 0
  if (orientation) {
    if (profile.orientation === orientation) score += 40
    else if (profile.orientation == null) score += 10
    else score -= 25
  } else if (profile.orientation == null) {
    score += 8
  }

  if (profile.dpr === targetDpr) score += 30
  else if (profile.dpr != null) score += Math.max(0, 20 - Math.abs(profile.dpr - targetDpr) * 15)

  if (variant.sizeBytes != null && variant.sizeBytes > 0) {
    score += Math.max(0, 10 - Math.log10(Math.max(1, variant.sizeBytes / 1024)))
  }
  return score
}

export async function selectBestVariantForUsage(params: {
  uploadId: number
  usage: ImageVariantUsage
  orientation?: 'portrait' | 'landscape' | null
  dpr?: number | null
}): Promise<{ variant: UploadImageVariant; profile: ImageVariantProfile | null } | null> {
  const uploadId = normalizeUploadId(params.uploadId)
  const usage = normalizeUsage(params.usage)
  const orientation = params.orientation === 'portrait' || params.orientation === 'landscape' ? params.orientation : null
  const dprNumber = Number(params.dpr || 1)
  const targetDpr: 1 | 2 = Number.isFinite(dprNumber) && dprNumber >= 1.5 ? 2 : 1

  const variants = await listVariantsByUpload(uploadId, { status: 'ready', usage })
  if (!variants.length) return null

  const ranked = variants
    .map((v) => {
      const profile = IMAGE_VARIANT_PROFILE_BY_KEY.get(v.profileKey) || null
      return {
        variant: v,
        profile,
        score: scoreVariant({ variant: v, profile, usage, orientation, targetDpr }),
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const aDpr = a.profile?.dpr || 0
      const bDpr = b.profile?.dpr || 0
      if (bDpr !== aDpr) return bDpr - aDpr
      return a.variant.profileKey.localeCompare(b.variant.profileKey)
    })

  const best = ranked[0]
  if (!best || best.score < -1000) return null
  return { variant: best.variant, profile: best.profile }
}
