import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { s3 } from '../../services/s3'
import type { UploadThumbV1Input } from '../../features/media-jobs/types'
import { createUploadThumbJpeg } from '../../services/ffmpeg/thumbPipeline'

export async function runUploadThumbV1Job(
  input: UploadThumbV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
): Promise<{ output: { bucket: string; key: string; s3Url: string }; skipped?: boolean }> {
  const bucket = String(input.outputBucket || '')
  const key = String(input.outputKey || '')
  if (!bucket || !key) throw new Error('missing_output_pointer')

  // Idempotency: if thumb already exists, skip re-rendering.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { output: { bucket, key, s3Url: `s3://${bucket}/${key}` }, skipped: true }
  } catch (e: any) {
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    const name = String(e?.name || e?.Code || '')
    if (!(status === 404 || name === 'NotFound' || name === 'NoSuchKey')) {
      // Unexpected (permissions/infra) - bubble up so the job can retry.
      throw e
    }
  }

  const longEdgePx = Math.max(64, Math.min(2048, Math.round(Number(input.longEdgePx || 640))))
  const result = await createUploadThumbJpeg({
    uploadBucket: bucket,
    uploadId: Number(input.uploadId),
    video: input.video,
    outKey: key,
    longEdgePx,
    logPaths: logPaths ? { ...logPaths, commandLog: [] } : undefined,
  })
  return { output: result }
}
