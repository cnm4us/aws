import type { ImageVariantUsage, ImageVariantFormat } from '../../config'

export type UploadImageVariantStatus = 'ready' | 'failed'

export type UploadImageVariantRow = {
  id: number
  upload_id: number
  profile_key: string
  variant_usage?: string | null
  usage?: string | null
  format: string
  width: number | null
  height: number | null
  size_bytes: number | null
  s3_bucket: string
  s3_key: string
  etag: string | null
  status: UploadImageVariantStatus
  error_code: string | null
  last_generated_at: string
  created_at: string
  updated_at: string
}

export type UploadImageVariant = {
  id: number
  uploadId: number
  profileKey: string
  usage: ImageVariantUsage
  format: ImageVariantFormat
  width: number | null
  height: number | null
  sizeBytes: number | null
  s3Bucket: string
  s3Key: string
  etag: string | null
  status: UploadImageVariantStatus
  errorCode: string | null
  lastGeneratedAt: string
  createdAt: string
  updatedAt: string
}

export type UpsertUploadImageVariantInput = {
  uploadId: number
  profileKey: string
  usage: ImageVariantUsage
  format: ImageVariantFormat
  width: number | null
  height: number | null
  sizeBytes: number | null
  s3Bucket: string
  s3Key: string
  etag?: string | null
  status?: UploadImageVariantStatus
  errorCode?: string | null
  lastGeneratedAt?: string | null
}
