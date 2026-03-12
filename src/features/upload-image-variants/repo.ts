import { getPool } from '../../db'
import type { UploadImageVariantRow, UploadImageVariantStatus } from './types'

export async function upsert(input: {
  uploadId: number
  profileKey: string
  variantUsage: string
  format: string
  width: number | null
  height: number | null
  sizeBytes: number | null
  s3Bucket: string
  s3Key: string
  etag: string | null
  status: UploadImageVariantStatus
  errorCode: string | null
  lastGeneratedAt: string | null
}): Promise<void> {
  const db = getPool()
  await db.query(
    `INSERT INTO upload_image_variants
      (
        upload_id, profile_key, variant_usage, format, width, height, size_bytes,
        s3_bucket, s3_key, etag, status, error_code, last_generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      ON DUPLICATE KEY UPDATE
        variant_usage = VALUES(variant_usage),
        format = VALUES(format),
        width = VALUES(width),
        height = VALUES(height),
        size_bytes = VALUES(size_bytes),
        s3_bucket = VALUES(s3_bucket),
        s3_key = VALUES(s3_key),
        etag = VALUES(etag),
        status = VALUES(status),
        error_code = VALUES(error_code),
        last_generated_at = COALESCE(VALUES(last_generated_at), last_generated_at),
        updated_at = CURRENT_TIMESTAMP`,
    [
      input.uploadId,
      input.profileKey,
      input.variantUsage,
      input.format,
      input.width,
      input.height,
      input.sizeBytes,
      input.s3Bucket,
      input.s3Key,
      input.etag,
      input.status,
      input.errorCode,
      input.lastGeneratedAt,
    ]
  )
}

export async function listByUploadId(
  uploadId: number,
  params?: { status?: UploadImageVariantStatus | null; variantUsage?: string | null }
): Promise<UploadImageVariantRow[]> {
  const db = getPool()
  const where: string[] = ['upload_id = ?']
  const args: any[] = [uploadId]
  if (params?.status) {
    where.push('status = ?')
    args.push(params.status)
  }
  if (params?.variantUsage) {
    where.push('variant_usage = ?')
    args.push(params.variantUsage)
  }
  const [rows] = await db.query(
    `SELECT *
       FROM upload_image_variants
      WHERE ${where.join(' AND ')}
      ORDER BY profile_key ASC, id DESC`,
    args
  )
  return rows as any[]
}

export async function getByUploadAndProfile(uploadId: number, profileKey: string): Promise<UploadImageVariantRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT *
       FROM upload_image_variants
      WHERE upload_id = ? AND profile_key = ?
      LIMIT 1`,
    [uploadId, profileKey]
  )
  return ((rows as any[])[0] as UploadImageVariantRow) || null
}
