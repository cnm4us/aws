import { getPool } from '../../db'
import { s3 } from '../../services/s3'
import type { UploadFreezeFrameV1Input } from '../../features/media-jobs/types'
import { createUploadFreezeFramePng } from '../../services/ffmpeg/freezeFramePipeline'
import { s3ObjectExists } from '../../services/s3ObjectExists'

export async function runUploadFreezeFrameV1Job(
  input: UploadFreezeFrameV1Input,
  _logPaths?: { stdoutPath?: string; stderrPath?: string }
): Promise<{ output: { bucket: string; key: string; s3Url: string; sizeBytes: number }; skipped?: boolean }> {
  const freezeUploadId = Number(input.freezeUploadId)
  const uploadBucket = String(input.outputBucket || '')
  const outKey = String(input.outputKey || '')
  if (!uploadBucket || !outKey) throw new Error('missing_output_pointer')

  const db = getPool()
  try {
    if (freezeUploadId > 0) {
      await db.query(`UPDATE uploads SET status='processing' WHERE id = ? AND status IN ('queued','uploaded','failed')`, [freezeUploadId])
    }
  } catch {}

  // Idempotency: if image already exists, skip re-rendering.
  const exists = await s3ObjectExists({
    s3,
    bucket: uploadBucket,
    key: outKey,
    objectKind: 'freeze_frame_image',
    attrs: { 'app.operation': 'mediajobs.attempt.process' },
  })
  if (exists.exists) {
    try {
      if (freezeUploadId > 0) {
        await db.query(
          `UPDATE uploads
              SET status='completed',
                  content_type=COALESCE(content_type,'image/png'),
                  uploaded_at=COALESCE(uploaded_at,CURRENT_TIMESTAMP)
            WHERE id = ?`,
          [freezeUploadId]
        )
      }
    } catch {}
    return { output: { bucket: uploadBucket, key: outKey, s3Url: `s3://${uploadBucket}/${outKey}`, sizeBytes: 0 }, skipped: true }
  }

  const longEdgePx = Math.max(64, Math.min(2160, Math.round(Number(input.longEdgePx || 1080))))
  const atSeconds = Math.max(0, Number(input.atSeconds || 0))
  const result = await createUploadFreezeFramePng({
    proxy: input.proxy,
    atSeconds,
    uploadBucket,
    outKey,
    longEdgePx,
  })

  try {
    if (freezeUploadId > 0) {
      await db.query(
        `UPDATE uploads
            SET status='completed',
                content_type='image/png',
                size_bytes=COALESCE(?, size_bytes),
                uploaded_at=COALESCE(uploaded_at,CURRENT_TIMESTAMP)
          WHERE id = ?`,
        [result.sizeBytes, freezeUploadId]
      )
    }
  } catch {}

  return { output: { ...result } }
}
