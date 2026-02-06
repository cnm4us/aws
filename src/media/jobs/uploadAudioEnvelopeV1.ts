import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { s3 } from '../../services/s3'
import type { UploadAudioEnvelopeV1Input } from '../../features/media-jobs/types'
import { createUploadAudioEnvelopeJson } from '../../services/ffmpeg/audioEnvelopePipeline'

export async function runUploadAudioEnvelopeV1Job(
  input: UploadAudioEnvelopeV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
): Promise<{ output: { bucket: string; key: string; s3Url: string }; intervalSeconds: number; durationSeconds: number; hasAudio: boolean; pointCount: number; skipped?: boolean; metricsInput?: any }> {
  const bucket = String(input.outputBucket || '')
  const key = String(input.outputKey || '')
  if (!bucket || !key) throw new Error('missing_output_pointer')

  // Idempotency: if envelope already exists, skip re-rendering.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { output: { bucket, key, s3Url: `s3://${bucket}/${key}` }, intervalSeconds: 0.1, durationSeconds: 0, hasAudio: true, pointCount: 0, skipped: true }
  } catch (e: any) {
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    const name = String(e?.name || e?.Code || '')
    if (!(status === 404 || name === 'NotFound' || name === 'NoSuchKey')) throw e
  }

  const intervalSeconds = Math.max(0.1, Math.min(1, Math.round(Number(input.intervalSeconds || 0.1) * 10) / 10))
  const result = await createUploadAudioEnvelopeJson({
    uploadId: Number(input.uploadId),
    proxy: input.proxy,
    outputBucket: bucket,
    outputKey: key,
    intervalSeconds,
    logPaths,
  })

  return {
    output: result.output,
    intervalSeconds: result.envelope.intervalSeconds,
    durationSeconds: result.envelope.durationSeconds,
    hasAudio: result.envelope.hasAudio,
    pointCount: Array.isArray(result.envelope.points) ? result.envelope.points.length : 0,
    metricsInput: result.metricsInput,
  }
}
