import { getPool } from '../../db'

export type ProductionCaptionsRow = {
  id: number
  production_id: number
  provider: string
  transcript_id: string | null
  format: string
  language: string
  s3_bucket: string
  s3_key: string
  status: 'ready' | 'failed'
  created_at: string
  updated_at: string
}

export async function upsertProductionCaptions(input: {
  productionId: number
  provider: string
  transcriptId: string | null
  format: string
  language: string
  bucket: string
  key: string
  status: 'ready' | 'failed'
}) {
  const db = getPool()
  await db.query(
    `INSERT INTO production_captions (production_id, provider, transcript_id, format, language, s3_bucket, s3_key, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       provider = VALUES(provider),
       transcript_id = VALUES(transcript_id),
       format = VALUES(format),
       language = VALUES(language),
       s3_bucket = VALUES(s3_bucket),
       s3_key = VALUES(s3_key),
       status = VALUES(status),
       updated_at = NOW()`,
    [
      Number(input.productionId),
      String(input.provider || 'assemblyai'),
      input.transcriptId != null ? String(input.transcriptId) : null,
      String(input.format || 'vtt'),
      String(input.language || 'en'),
      String(input.bucket || ''),
      String(input.key || ''),
      String(input.status || 'ready'),
    ]
  )
}

export async function getByProductionId(productionId: number): Promise<ProductionCaptionsRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM production_captions WHERE production_id = ? LIMIT 1`, [Number(productionId)])
  const row = (rows as any[])[0]
  if (!row) return null
  return row as any
}

