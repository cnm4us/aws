import { s3 } from '../../services/s3'
import type { UploadThumbV1Input } from '../../features/media-jobs/types'
import { createUploadThumbJpeg } from '../../services/ffmpeg/thumbPipeline'
import { s3ObjectExists } from '../../services/s3ObjectExists'

export async function runUploadThumbV1Job(
  input: UploadThumbV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
): Promise<{ output: { bucket: string; key: string; s3Url: string }; skipped?: boolean; ffmpegCommands?: string[]; metricsInput?: any }> {
  const bucket = String(input.outputBucket || '')
  const key = String(input.outputKey || '')
  if (!bucket || !key) throw new Error('missing_output_pointer')
  const ffmpegCommands: string[] = []
  const force = Boolean(input.force)

  // Idempotency: if thumb already exists, skip re-rendering.
  if (!force) {
    const exists = await s3ObjectExists({
      s3,
      bucket,
      key,
      objectKind: 'upload_thumb',
      attrs: { 'app.operation': 'mediajobs.attempt.process' },
    })
    if (exists.exists) {
      return { output: { bucket, key, s3Url: `s3://${bucket}/${key}` }, skipped: true, ffmpegCommands }
    }
  }

  const longEdgePx = Math.max(64, Math.min(2048, Math.round(Number(input.longEdgePx || 640))))
  const result = await createUploadThumbJpeg({
    uploadBucket: bucket,
    uploadId: Number(input.uploadId),
    video: input.video,
    outKey: key,
    longEdgePx,
    seekSeconds: input.seekSeconds,
    logPaths: logPaths ? { ...logPaths, commandLog: ffmpegCommands } : undefined,
  })
  return { output: { bucket: result.bucket, key: result.key, s3Url: result.s3Url }, ffmpegCommands, metricsInput: result.metricsInput }
}
