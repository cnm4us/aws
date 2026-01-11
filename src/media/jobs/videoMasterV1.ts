import { UPLOAD_BUCKET } from '../../config'
import type { VideoMasterV1Input } from '../../features/media-jobs/types'
import { createMp4WithFrozenFirstFrame, createMp4WithTitleImageIntro } from '../../services/ffmpeg/introPipeline'
import { burnScreenTitleIntoMp4, downloadS3ObjectToFile, uploadFileToS3, ymdToFolder } from '../../services/ffmpeg/audioPipeline'
import { burnPngOverlaysIntoMp4, downloadOverlayPngToFile, probeVideoDisplayDimensions, withTempDir } from '../../services/ffmpeg/visualPipeline'
import { trimMp4Local } from '../../services/ffmpeg/trimPipeline'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'

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

  const edit = (input as any).edit && typeof (input as any).edit === 'object' ? (input as any).edit : null
  const trimStartRaw = edit && (edit as any).trimStartSeconds != null ? Number((edit as any).trimStartSeconds) : null
  const trimEndRaw = edit && (edit as any).trimEndSeconds != null ? Number((edit as any).trimEndSeconds) : null
  const trimStart = trimStartRaw != null && Number.isFinite(trimStartRaw) ? Math.max(0, trimStartRaw) : null
  const trimEnd = trimEndRaw != null && Number.isFinite(trimEndRaw) ? Math.max(0, trimEndRaw) : null
  if (trimStart != null || trimEnd != null) {
    const startSeconds = trimStart != null ? trimStart : 0
    const endSeconds = trimEnd != null ? trimEnd : null
    const folder = ymdToFolder(dateYmd)
    const key = `video-trim/${folder}/${productionUlid}/${randomUUID()}/${originalLeaf}`
    out = await withTempDir('bacs-video-master-trim-', async (tmpDir) => {
      const inPath = path.join(tmpDir, 'in.mp4')
      const outPath = path.join(tmpDir, 'trim.mp4')
      await downloadS3ObjectToFile(masteredVideoPtr.bucket, masteredVideoPtr.key, inPath)
      const { durationSeconds: trimmedDuration } = await trimMp4Local({
        inPath,
        outPath,
        startSeconds,
        endSeconds,
        logPaths,
      })
      await uploadFileToS3(uploadBucket, key, outPath, 'video/mp4')
      if (trimmedDuration != null && Number.isFinite(trimmedDuration) && trimmedDuration > 0) durationSeconds = trimmedDuration
      return { bucket: uploadBucket, key, s3Url: `s3://${uploadBucket}/${key}` }
    })
    masteredVideoPtr = { bucket: out.bucket, key: out.key }
  }

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
        video: masteredVideoPtr,
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
        video: masteredVideoPtr,
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

  const hasLowerThird = Boolean(input.lowerThirdImage && input.lowerThirdImage.image && input.lowerThirdImage.image.bucket && input.lowerThirdImage.image.key)
  const hasLogo = Boolean(input.logo && input.logo.image && input.logo.image.bucket && input.logo.image.key)
  const hasScreenTitle = Boolean(input.screenTitle && input.screenTitle.text && (input.screenTitle as any).preset)

  if (hasLowerThird || hasLogo || hasScreenTitle) {
    const folder = ymdToFolder(dateYmd)
    const key = `video-master/${folder}/${productionUlid}/${randomUUID()}/${originalLeaf}`

    out = await withTempDir('bacs-video-master-visual-', async (tmpDir) => {
      const inPath = path.join(tmpDir, 'in.mp4')
      const afterOverlays = path.join(tmpDir, 'overlays.mp4')
      const afterTitle = path.join(tmpDir, 'title.mp4')
      const lowerPath = path.join(tmpDir, 'lower.png')
      const logoPath = path.join(tmpDir, 'logo.png')

      await downloadS3ObjectToFile(masteredVideoPtr.bucket, masteredVideoPtr.key, inPath)
      const dims = await probeVideoDisplayDimensions(inPath)

      const overlays: any[] = []
      if (hasLowerThird) {
        await downloadOverlayPngToFile((input.lowerThirdImage as any).image, lowerPath)
        const imgW = Number((input.lowerThirdImage as any).width || 0)
        const imgH = Number((input.lowerThirdImage as any).height || 0)
        const snap = (input.lowerThirdImage as any).config || {}
        const sizeMode = String(snap.sizeMode || 'pct').toLowerCase() === 'match_image' ? 'match_image' : 'pct'
        const baselineWidth = Number(snap.baselineWidth) === 1920 ? 1920 : 1080
        const pctFromBaseline = imgW > 0 ? (imgW / baselineWidth) * 100 : null
        const pctNoUpscale = imgW > 0 ? (imgW / dims.width) * 100 : null
        const pctUsed =
          sizeMode === 'match_image' && pctFromBaseline != null && pctNoUpscale != null
            ? Math.min(pctFromBaseline, pctNoUpscale, 100)
            : Number(snap.sizePctWidth || 82)
        overlays.push({
          pngPath: lowerPath,
          imgW,
          imgH,
          cfg: {
            position: 'bottom_center',
            sizePctWidth: clampFloorPct(pctUsed),
            opacityPct: snap.opacityPct != null ? Number(snap.opacityPct) : 100,
            timingRule: String(snap.timingRule || 'first_only').toLowerCase() === 'entire' ? 'entire' : 'first_only',
            timingSeconds: snap.timingSeconds != null ? Number(snap.timingSeconds) : 10,
            fade: snap.fade != null ? String(snap.fade) : 'none',
            insetXPreset: snap.insetXPreset ?? null,
            insetYPreset: snap.insetYPreset ?? 'medium',
          },
        })
      }

      if (hasLogo) {
        await downloadOverlayPngToFile((input.logo as any).image, logoPath)
        const imgW = Number((input.logo as any).width || 0)
        const imgH = Number((input.logo as any).height || 0)
        const snap = (input.logo as any).config || {}
        overlays.push({
          pngPath: logoPath,
          imgW,
          imgH,
          cfg: {
            position: snap.position != null ? String(snap.position) : 'bottom_right',
            sizePctWidth: snap.sizePctWidth != null ? Number(snap.sizePctWidth) : 15,
            opacityPct: snap.opacityPct != null ? Number(snap.opacityPct) : 35,
            timingRule: snap.timingRule != null ? String(snap.timingRule) : 'entire',
            timingSeconds: snap.timingSeconds != null ? Number(snap.timingSeconds) : null,
            fade: snap.fade != null ? String(snap.fade) : 'none',
            insetXPreset: snap.insetXPreset ?? null,
            insetYPreset: snap.insetYPreset ?? null,
          },
        })
      }

      if (overlays.length) {
        await burnPngOverlaysIntoMp4({
          inPath,
          outPath: afterOverlays,
          videoDurationSeconds: durationSeconds,
          overlays,
          logPaths,
        })
      } else {
        fs.copyFileSync(inPath, afterOverlays)
      }

      const finalPath = hasScreenTitle
        ? (await (async () => {
            await burnScreenTitleIntoMp4({
              inPath: afterOverlays,
              outPath: afterTitle,
              screenTitle: input.screenTitle as any,
              videoDurationSeconds: durationSeconds,
              logPaths,
            })
            return afterTitle
          })())
        : afterOverlays

      await uploadFileToS3(uploadBucket, key, finalPath, 'video/mp4')
      return { bucket: uploadBucket, key, s3Url: `s3://${uploadBucket}/${key}` }
    })

    masteredVideoPtr = { bucket: out.bucket, key: out.key }
  }

  const introMeta = intro && intro.kind
    ? (String(intro.kind) === 'title_image'
        ? { kind: 'title_image', uploadId: Number((intro as any).uploadId), holdSeconds: Math.round(Number((intro as any).holdSeconds || 0)) }
        : { kind: 'freeze_first_frame', seconds: Math.round(Number((intro as any).seconds || legacyIntroSeconds || 0)) })
    : null

  return { output: out, intro: introMeta }
}

function clampFloorPct(n: any): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 1
  return Math.max(1, Math.min(100, Math.floor(v)))
}
