import { UPLOAD_BUCKET } from '../../config'
import type { VideoMasterV1Input } from '../../features/media-jobs/types'
import { createMp4WithFrozenFirstFrame } from '../../services/ffmpeg/introPipeline'

export async function runVideoMasterV1Job(
  input: VideoMasterV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
) {
  const uploadBucket = input.outputBucket || UPLOAD_BUCKET
  const dateYmd = String(input.dateYmd || new Date().toISOString().slice(0, 10))
  const productionUlid = String(input.productionUlid || '')
  const originalLeaf = String(input.originalLeaf || 'video.mp4')
  const introSeconds = Number(input.introSeconds || 0)

  const out = await createMp4WithFrozenFirstFrame({
    uploadBucket,
    dateYmd,
    productionUlid,
    originalLeaf,
    video: input.video,
    freezeSeconds: introSeconds,
    logPaths,
  })
  return { output: out, intro: { kind: 'freeze_first_frame', seconds: Math.round(introSeconds) } }
}

