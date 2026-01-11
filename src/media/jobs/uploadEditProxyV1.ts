import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { s3 } from '../../services/s3'
import type { UploadEditProxyV1Input } from '../../features/media-jobs/types'
import { createUploadEditProxyMp4 } from '../../services/ffmpeg/proxyPipeline'

export async function runUploadEditProxyV1Job(
  input: UploadEditProxyV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
): Promise<{ output: { bucket: string; key: string; s3Url: string }; skipped?: boolean }> {
  const bucket = String(input.outputBucket || '')
  const key = String(input.outputKey || '')
  if (!bucket || !key) throw new Error('missing_output_pointer')

  // Idempotency: if proxy already exists, skip re-rendering.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { output: { bucket, key, s3Url: `s3://${bucket}/${key}` }, skipped: true }
  } catch (e: any) {
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    const name = String(e?.name || e?.Code || '')
    if (!(status === 404 || name === 'NotFound' || name === 'NoSuchKey')) {
      throw e
    }
  }

  const longEdgePx = Math.max(160, Math.min(1080, Math.round(Number(input.longEdgePx || 540))))
  const fps = Math.max(15, Math.min(60, Math.round(Number(input.fps || 30))))
  const gop = Math.max(2, Math.min(300, Math.round(Number(input.gop || 8))))

  const result = await createUploadEditProxyMp4({
    uploadBucket: bucket,
    uploadId: Number(input.uploadId),
    video: input.video,
    outKey: key,
    longEdgePx,
    fps,
    gop,
    logPaths,
  })
  return { output: result }
}

