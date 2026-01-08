import { UPLOAD_BUCKET } from '../../config'
import type { VideoMasterV1Input } from '../../features/media-jobs/types'
import { createMp4WithFrozenFirstFrame, createMp4WithTitleImageIntro } from '../../services/ffmpeg/introPipeline'
import { renderScreenTitleOverlayPngsToS3 } from '../../services/ffmpeg/audioPipeline'

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

  let out = null as any
  let masteredVideoPtr = input.video
  let durationSeconds =
    input.videoDurationSeconds != null && Number.isFinite(Number(input.videoDurationSeconds)) && Number(input.videoDurationSeconds) > 0
      ? Number(input.videoDurationSeconds)
      : null

  if (intro && intro.kind) {
    if (String(intro.kind) === 'title_image') {
      const holdSeconds = Number((intro as any).holdSeconds || 0)
      const titleImage = (intro as any).titleImage
      if (!titleImage || !titleImage.bucket || !titleImage.key) throw new Error('missing_title_image')
      out = await createMp4WithTitleImageIntro({
        uploadBucket,
        dateYmd,
        productionUlid,
        originalLeaf,
        video: input.video,
        titleImage,
        holdSeconds,
        logPaths,
      })
      masteredVideoPtr = { bucket: out.bucket, key: out.key }
      if (durationSeconds != null) durationSeconds = durationSeconds + Math.round(holdSeconds)
    } else if (String(intro.kind) === 'freeze_first_frame') {
      const introSeconds = Number((intro as any).seconds || legacyIntroSeconds || 0)
      out = await createMp4WithFrozenFirstFrame({
        uploadBucket,
        dateYmd,
        productionUlid,
        originalLeaf,
        video: input.video,
        freezeSeconds: introSeconds,
        logPaths,
      })
      masteredVideoPtr = { bucket: out.bucket, key: out.key }
      if (durationSeconds != null) durationSeconds = durationSeconds + Math.round(introSeconds)
    }
  }

  // No intro requested; treat input video as the base master.
  if (!out) {
    out = { bucket: masteredVideoPtr.bucket, key: masteredVideoPtr.key, s3Url: `s3://${masteredVideoPtr.bucket}/${masteredVideoPtr.key}` }
  }

  const screenTitleOverlays =
    input.screenTitle && input.screenTitle.text && (input.screenTitle as any).preset
      ? await renderScreenTitleOverlayPngsToS3({
          uploadBucket,
          dateYmd,
          productionUlid,
          screenTitle: input.screenTitle as any,
          logPaths,
        })
      : null

  const introMeta = intro && intro.kind
    ? (String(intro.kind) === 'title_image'
        ? { kind: 'title_image', uploadId: Number((intro as any).uploadId), holdSeconds: Math.round(Number((intro as any).holdSeconds || 0)) }
        : { kind: 'freeze_first_frame', seconds: Math.round(Number((intro as any).seconds || legacyIntroSeconds || 0)) })
    : null

  return { output: out, intro: introMeta, screenTitleOverlays }
}
