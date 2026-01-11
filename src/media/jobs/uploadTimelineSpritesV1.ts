import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { s3 } from '../../services/s3'
import type { UploadTimelineSpritesV1Input } from '../../features/media-jobs/types'
import { createUploadTimelineSpritesJpeg } from '../../services/ffmpeg/timelinePipeline'

export async function runUploadTimelineSpritesV1Job(
  input: UploadTimelineSpritesV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
): Promise<{
  manifest: { bucket: string; key: string; s3Url: string }
  sprites: Array<{ bucket: string; key: string; s3Url: string }>
  durationSeconds: number
  skipped?: boolean
}> {
  const bucket = String(input.outputBucket || '')
  const manifestKey = String(input.manifestKey || '')
  if (!bucket || !manifestKey) throw new Error('missing_output_pointer')

  // Idempotency: if manifest already exists, skip re-rendering.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: manifestKey }))
    return {
      manifest: { bucket, key: manifestKey, s3Url: `s3://${bucket}/${manifestKey}` },
      sprites: [],
      durationSeconds: 0,
      skipped: true,
    }
  } catch (e: any) {
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    const name = String(e?.name || e?.Code || '')
    if (!(status === 404 || name === 'NotFound' || name === 'NoSuchKey')) {
      throw e
    }
  }

  const intervalSeconds = Math.max(1, Math.min(5, Math.round(Number(input.intervalSeconds || 1))))
  const tileW = Math.max(32, Math.min(320, Math.round(Number(input.tileW || 96))))
  const tileH = Math.max(32, Math.min(320, Math.round(Number(input.tileH || 54))))
  const cols = Math.max(1, Math.min(30, Math.round(Number(input.cols || 10))))
  const rows = Math.max(1, Math.min(30, Math.round(Number(input.rows || 6))))
  const perSprite = Math.max(1, Math.min(600, Math.round(Number(input.perSprite || cols * rows))))

  return await createUploadTimelineSpritesJpeg({
    uploadId: Number(input.uploadId),
    proxy: input.proxy,
    outputBucket: bucket,
    manifestKey,
    spritePrefix: String(input.spritePrefix || ''),
    intervalSeconds,
    tileW,
    tileH,
    cols,
    rows,
    perSprite,
    logPaths,
  })
}

