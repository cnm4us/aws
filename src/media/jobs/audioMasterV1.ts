import { UPLOAD_BUCKET } from '../../config'
import type { AudioMasterV1Input } from '../../features/media-jobs/types'
import { burnScreenTitleIntoMp4, createMuxedMp4WithLoopedMixedAudio, createMuxedMp4WithLoopedReplacementAudio, downloadS3ObjectToFile, uploadFileToS3, ymdToFolder } from '../../services/ffmpeg/audioPipeline'
import { createMp4WithFrozenFirstFrame, createMp4WithTitleImageIntro } from '../../services/ffmpeg/introPipeline'
import { burnPngOverlaysIntoMp4, downloadOverlayPngToFile, probeVideoDisplayDimensions, withTempDir } from '../../services/ffmpeg/visualPipeline'
import { spliceMp4Local, trimMp4Local } from '../../services/ffmpeg/trimPipeline'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'

export async function runAudioMasterV1Job(
  input: AudioMasterV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
) {
  const uploadBucket = input.outputBucket || UPLOAD_BUCKET
  const mode = String(input.mode || 'mix').toLowerCase() === 'replace' ? 'replace' : 'mix'
  const dateYmd = String(input.dateYmd || new Date().toISOString().slice(0, 10))
  const productionUlid = String(input.productionUlid || '')
  const originalLeaf = String(input.originalLeaf || 'video.mp4')

  const normalizeAudio = Boolean(input.normalizeAudio)
  const normalizeTargetLkfs = Number.isFinite(Number(input.normalizeTargetLkfs)) ? Number(input.normalizeTargetLkfs) : -16
  const videoHighpassEnabled = Boolean((input as any).videoHighpassEnabled)
  const videoHighpassHz = Number.isFinite(Number((input as any).videoHighpassHz)) ? Number((input as any).videoHighpassHz) : 80

  const appendLog = (msg: string) => {
    try {
      const line = `[audio_master_v1] ${new Date().toISOString()} ${msg}\n`
      if (logPaths?.stderrPath) fs.appendFileSync(logPaths.stderrPath, line)
      else if (logPaths?.stdoutPath) fs.appendFileSync(logPaths.stdoutPath, line)
    } catch {}
  }

  let videoPtr = input.video
  let videoDurationSeconds =
    input.videoDurationSeconds != null && Number.isFinite(Number(input.videoDurationSeconds)) ? Number(input.videoDurationSeconds) : null

  const edit = (input as any).edit && typeof (input as any).edit === 'object' ? (input as any).edit : null
  const rangesRaw = edit && Array.isArray((edit as any).ranges) ? ((edit as any).ranges as any[]) : null
  const ranges =
    rangesRaw && rangesRaw.length
      ? rangesRaw
          .map((r) => ({
            start: r && (r as any).start != null ? Number((r as any).start) : NaN,
            end: r && (r as any).end != null ? Number((r as any).end) : NaN,
          }))
          .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end))
      : null
  const trimStartRaw = edit && (edit as any).trimStartSeconds != null ? Number((edit as any).trimStartSeconds) : null
  const trimEndRaw = edit && (edit as any).trimEndSeconds != null ? Number((edit as any).trimEndSeconds) : null
  const trimStart = trimStartRaw != null && Number.isFinite(trimStartRaw) ? Math.max(0, trimStartRaw) : null
  const trimEnd = trimEndRaw != null && Number.isFinite(trimEndRaw) ? Math.max(0, trimEndRaw) : null
  if ((ranges && ranges.length) || trimStart != null || trimEnd != null) {
    const startSeconds = trimStart != null ? trimStart : 0
    const endSeconds = trimEnd != null ? trimEnd : null
    const folder = ymdToFolder(dateYmd)
    const key = `video-trim/${folder}/${productionUlid}/${randomUUID()}/${originalLeaf}`
    const t0 = Date.now()
    appendLog(`trim:start start=${startSeconds} end=${endSeconds == null ? 'null' : String(endSeconds)}`)
    const trimmedPtr = await withTempDir('bacs-audio-master-trim-', async (tmpDir) => {
      const inPath = path.join(tmpDir, 'in.mp4')
      const outPath = path.join(tmpDir, 'trim.mp4')
      await downloadS3ObjectToFile(videoPtr.bucket, videoPtr.key, inPath)
      const { durationSeconds: trimmedDuration } = ranges && ranges.length
        ? await spliceMp4Local({ inPath, outPath, ranges, logPaths })
        : await trimMp4Local({ inPath, outPath, startSeconds, endSeconds, logPaths })
      await uploadFileToS3(uploadBucket, key, outPath, 'video/mp4')
      if (trimmedDuration != null && Number.isFinite(trimmedDuration) && trimmedDuration > 0) videoDurationSeconds = trimmedDuration
      return { bucket: uploadBucket, key, s3Url: `s3://${uploadBucket}/${key}` }
    })
    appendLog(`trim:done ms=${Date.now() - t0} s3Url=${trimmedPtr.s3Url}`)
    videoPtr = { bucket: trimmedPtr.bucket, key: trimmedPtr.key }
  }

  const legacyIntroSecondsRaw = input.introSeconds != null ? Number(input.introSeconds) : 0
  const legacyIntroSeconds = Number.isFinite(legacyIntroSecondsRaw) ? Math.max(0, Math.min(30, Math.round(legacyIntroSecondsRaw))) : 0
  const intro = input.intro && typeof input.intro === 'object'
    ? (input.intro as any)
    : (legacyIntroSeconds > 0 ? { kind: 'freeze_first_frame', seconds: legacyIntroSeconds } : null)
  if (intro && intro.kind) {
    if (String(intro.kind) === 'title_image') {
      const holdSecondsRaw = intro.holdSeconds != null ? Number(intro.holdSeconds) : 0
      const holdSeconds = Number.isFinite(holdSecondsRaw) ? Math.round(holdSecondsRaw) : 0
      const titleImage = intro.titleImage
      if (!titleImage || !titleImage.bucket || !titleImage.key) throw new Error('missing_title_image')
      const t0 = Date.now()
      appendLog(`intro_title:start holdSeconds=${holdSeconds}`)
      const mastered = await createMp4WithTitleImageIntro({
        uploadBucket,
        dateYmd,
        productionUlid,
        originalLeaf,
        video: videoPtr,
        titleImage,
        holdSeconds,
        logPaths,
      })
      appendLog(`intro_title:done ms=${Date.now() - t0} s3Url=${mastered.s3Url}`)
      videoPtr = { bucket: mastered.bucket, key: mastered.key }
      if (videoDurationSeconds != null) videoDurationSeconds = videoDurationSeconds + holdSeconds
    } else if (String(intro.kind) === 'freeze_first_frame') {
      const introSecondsRaw = intro.seconds != null ? Number(intro.seconds) : legacyIntroSeconds
      const introSeconds = Number.isFinite(introSecondsRaw) ? Math.max(0, Math.min(30, Math.round(introSecondsRaw))) : 0
      if (introSeconds > 0) {
        const t0 = Date.now()
        appendLog(`intro_freeze:start seconds=${introSeconds}`)
        const frozen = await createMp4WithFrozenFirstFrame({
          uploadBucket,
          dateYmd,
          productionUlid,
          originalLeaf,
          video: videoPtr,
          freezeSeconds: introSeconds,
          logPaths,
        })
        appendLog(`intro_freeze:done ms=${Date.now() - t0} s3Url=${frozen.s3Url}`)
        videoPtr = { bucket: frozen.bucket, key: frozen.key }
        if (videoDurationSeconds != null) videoDurationSeconds = videoDurationSeconds + introSeconds
      }
    }
  }

  if (mode === 'mix') {
    try {
      const t0 = Date.now()
      appendLog(`mix:start`)
      const out = await createMuxedMp4WithLoopedMixedAudio({
        uploadBucket,
        dateYmd,
        productionUlid,
        originalLeaf,
        videoDurationSeconds,
        video: videoPtr,
        audio: input.music,
        videoGainDb: Number(input.videoGainDb || 0),
        musicGainDb: Number(input.musicGainDb || -18),
        audioDurationSeconds: input.audioDurationSeconds == null ? null : Number(input.audioDurationSeconds),
        audioFadeEnabled: input.audioFadeEnabled !== false,
        duckingEnabled: input.duckingMode !== 'none',
        duckingMode: input.duckingMode,
        duckingGate: input.duckingGate,
        duckingAmountDb: Number(input.duckingAmountDb || 12),
        openerCutFadeBeforeSeconds: input.openerCutFadeBeforeSeconds == null ? null : Number(input.openerCutFadeBeforeSeconds),
        openerCutFadeAfterSeconds: input.openerCutFadeAfterSeconds == null ? null : Number(input.openerCutFadeAfterSeconds),
        normalizeAudio,
        normalizeTargetLkfs,
        videoHighpassEnabled,
        videoHighpassHz,
        logPaths,
      })
      appendLog(`mix:done ms=${Date.now() - t0} s3Url=${out.s3Url}`)
      const final = await maybeApplyVisualOverlays({
        uploadBucket,
        dateYmd,
        productionUlid,
        originalLeaf,
        masteredS3Url: out.s3Url,
        videoDurationSeconds,
        timeline: (input as any).timeline ?? null,
        logo: (input as any).logo,
        lowerThirdImage: (input as any).lowerThirdImage,
        screenTitle: input.screenTitle ?? null,
        logPaths,
      })
      return { output: final || out, intro: intro && intro.kind ? intro : null, normalize: { enabled: normalizeAudio, targetLkfs: normalizeTargetLkfs } }
    } catch {
      // fall back to replace
      appendLog(`mix:failed falling back to replace`)
    }
  }

  const t0 = Date.now()
  appendLog(`replace:start`)
  const out = await createMuxedMp4WithLoopedReplacementAudio({
    uploadBucket,
    dateYmd,
    productionUlid,
    originalLeaf,
    videoDurationSeconds,
    video: videoPtr,
    audio: input.music,
    musicGainDb: Number(input.musicGainDb || -18),
    audioDurationSeconds: input.audioDurationSeconds == null ? null : Number(input.audioDurationSeconds),
    audioFadeEnabled: input.audioFadeEnabled !== false,
    normalizeAudio,
    normalizeTargetLkfs,
    videoHighpassEnabled,
    videoHighpassHz,
    logPaths,
  })
  appendLog(`replace:done ms=${Date.now() - t0} s3Url=${out.s3Url}`)
  const final = await maybeApplyVisualOverlays({
    uploadBucket,
    dateYmd,
    productionUlid,
    originalLeaf,
    masteredS3Url: out.s3Url,
    videoDurationSeconds,
    timeline: (input as any).timeline ?? null,
    logo: (input as any).logo,
    lowerThirdImage: (input as any).lowerThirdImage,
    screenTitle: input.screenTitle ?? null,
    logPaths,
  })
  return { output: final || out, intro: intro && intro.kind ? intro : null, normalize: { enabled: normalizeAudio, targetLkfs: normalizeTargetLkfs } }
}

async function maybeApplyVisualOverlays(opts: {
  uploadBucket: string
  dateYmd: string
  productionUlid: string
  originalLeaf: string
  masteredS3Url: string
  videoDurationSeconds: number | null
  timeline: any
  logo: any
  lowerThirdImage: any
  screenTitle: any
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}): Promise<{ bucket: string; key: string; s3Url: string } | null> {
  const timelineOverlaysRaw =
    opts.timeline && typeof opts.timeline === 'object' && Array.isArray((opts.timeline as any).overlays)
      ? (((opts.timeline as any).overlays as any[]) || [])
      : []
  const hasTimelineOverlays = Boolean(timelineOverlaysRaw.length)
  const hasLowerThird = Boolean(opts.lowerThirdImage && opts.lowerThirdImage.image && opts.lowerThirdImage.image.bucket && opts.lowerThirdImage.image.key)
  const hasLogo = Boolean(opts.logo && opts.logo.image && opts.logo.image.bucket && opts.logo.image.key)
  const hasScreenTitle = Boolean(opts.screenTitle && opts.screenTitle.text && opts.screenTitle.preset)
  if (!hasTimelineOverlays && !hasLowerThird && !hasLogo && !hasScreenTitle) return null

  const s3 = masteredS3UrlToPtr(opts.masteredS3Url)
  if (!s3) return null

  return await withTempDir('bacs-audio-master-visual-', async (tmpDir) => {
    const inPath = path.join(tmpDir, 'in.mp4')
    const afterOverlays = path.join(tmpDir, 'overlays.mp4')
    const afterTitle = path.join(tmpDir, 'title.mp4')
    const lowerPath = path.join(tmpDir, 'lower.png')
    const logoPath = path.join(tmpDir, 'logo.png')

    await downloadS3ObjectToFile(s3.bucket, s3.key, inPath)
    const dims = await probeVideoDisplayDimensions(inPath)

    const overlays: any[] = []
    if (hasTimelineOverlays) {
      for (let i = 0; i < Math.min(20, timelineOverlaysRaw.length); i++) {
        const ov = timelineOverlaysRaw[i] || {}
        const img = ov.image
        if (!img || !img.bucket || !img.key) continue
        const pngPath = path.join(tmpDir, `timeline_${i}.png`)
        await downloadOverlayPngToFile(img, pngPath)
        const imgW = Number(ov.width || 0)
        const imgH = Number(ov.height || 0)
        const startSeconds = Number(ov.startSeconds)
        const endSeconds = Number(ov.endSeconds)
        if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) continue
        overlays.push({
          pngPath,
          imgW,
          imgH,
          mode: 'full_frame_cover',
          startSeconds,
          endSeconds,
          cfg: { opacityPct: 100 },
        })
      }
    }
    if (hasLowerThird) {
      await downloadOverlayPngToFile(opts.lowerThirdImage.image, lowerPath)
      const imgW = Number(opts.lowerThirdImage.width || 0)
      const imgH = Number(opts.lowerThirdImage.height || 0)
      const snap = opts.lowerThirdImage.config || {}
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
      await downloadOverlayPngToFile(opts.logo.image, logoPath)
      const imgW = Number(opts.logo.width || 0)
      const imgH = Number(opts.logo.height || 0)
      const snap = opts.logo.config || {}
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
        videoDurationSeconds: opts.videoDurationSeconds,
        overlays,
        logPaths: opts.logPaths,
      })
    } else {
      fs.copyFileSync(inPath, afterOverlays)
    }

    const finalPath = hasScreenTitle
      ? (await (async () => {
          await burnScreenTitleIntoMp4({
            inPath: afterOverlays,
            outPath: afterTitle,
            screenTitle: opts.screenTitle,
            videoDurationSeconds: opts.videoDurationSeconds,
            logPaths: opts.logPaths,
          })
          return afterTitle
        })())
      : afterOverlays

    const folder = ymdToFolder(opts.dateYmd)
    const key = `mastered/${folder}/${opts.productionUlid}/${randomUUID()}/${opts.originalLeaf}`
    await uploadFileToS3(opts.uploadBucket, key, finalPath, 'video/mp4')
    return { bucket: opts.uploadBucket, key, s3Url: `s3://${opts.uploadBucket}/${key}` }
  })
}

function masteredS3UrlToPtr(url: string): { bucket: string; key: string } | null {
  const u = String(url || '')
  if (!u.startsWith('s3://')) return null
  const rest = u.slice('s3://'.length)
  const idx = rest.indexOf('/')
  if (idx <= 0) return null
  const bucket = rest.slice(0, idx)
  const key = rest.slice(idx + 1)
  if (!bucket || !key) return null
  return { bucket, key }
}

function clampFloorPct(n: any): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 1
  return Math.max(1, Math.min(100, Math.floor(v)))
}
