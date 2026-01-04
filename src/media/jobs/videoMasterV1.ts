import { UPLOAD_BUCKET } from '../../config'
import type { VideoMasterV1Input } from '../../features/media-jobs/types'
import { createMp4WithFrozenFirstFrame, createMp4WithTitleImageIntro } from '../../services/ffmpeg/introPipeline'

export async function runVideoMasterV1Job(
  input: VideoMasterV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
) {
  const uploadBucket = input.outputBucket || UPLOAD_BUCKET
  const dateYmd = String(input.dateYmd || new Date().toISOString().slice(0, 10))
  const productionUlid = String(input.productionUlid || '')
  const originalLeaf = String(input.originalLeaf || 'video.mp4')
  const legacyIntroSeconds = input.introSeconds != null ? Number(input.introSeconds) : 0
  const intro =
    input.intro && typeof input.intro === 'object'
      ? (input.intro as any)
      : (Number.isFinite(legacyIntroSeconds) && legacyIntroSeconds > 0
          ? { kind: 'freeze_first_frame', seconds: Math.round(legacyIntroSeconds) }
          : null)

  if (!intro || !intro.kind) throw new Error('missing_intro')
  if (String(intro.kind) === 'title_image') {
    const holdSeconds = Number((intro as any).holdSeconds || 0)
    const titleImage = (intro as any).titleImage
    if (!titleImage || !titleImage.bucket || !titleImage.key) throw new Error('missing_title_image')
    const out = await createMp4WithTitleImageIntro({
      uploadBucket,
      dateYmd,
      productionUlid,
      originalLeaf,
      video: input.video,
      titleImage,
      holdSeconds,
      logPaths,
    })
    return { output: out, intro: { kind: 'title_image', uploadId: Number((intro as any).uploadId), holdSeconds: Math.round(holdSeconds) } }
  }

  const introSeconds = Number((intro as any).seconds || legacyIntroSeconds || 0)
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
