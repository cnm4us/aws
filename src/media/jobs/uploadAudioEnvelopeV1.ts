import { s3 } from '../../services/s3'
import type { UploadAudioEnvelopeV1Input } from '../../features/media-jobs/types'
import { createUploadAudioEnvelopeJson } from '../../services/ffmpeg/audioEnvelopePipeline'
import { s3ObjectExists } from '../../services/s3ObjectExists'

export async function runUploadAudioEnvelopeV1Job(
  input: UploadAudioEnvelopeV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
): Promise<{ output: { bucket: string; key: string; s3Url: string }; intervalSeconds: number; durationSeconds: number; hasAudio: boolean; pointCount: number; skipped?: boolean; metricsInput?: any }> {
  const bucket = String(input.outputBucket || '')
  const key = String(input.outputKey || '')
  if (!bucket || !key) throw new Error('missing_output_pointer')

  // Idempotency: if envelope already exists, skip re-rendering.
  const exists = await s3ObjectExists({
    s3,
    bucket,
    key,
    objectKind: 'upload_audio_envelope',
    attrs: { 'app.operation': 'mediajobs.attempt.process' },
  })
  if (exists.exists) {
    return { output: { bucket, key, s3Url: `s3://${bucket}/${key}` }, intervalSeconds: 0.1, durationSeconds: 0, hasAudio: true, pointCount: 0, skipped: true }
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
