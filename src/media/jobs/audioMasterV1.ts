import { UPLOAD_BUCKET } from '../../config'
import type { AudioMasterV1Input } from '../../features/media-jobs/types'
import { createMuxedMp4WithLoopedMixedAudio, createMuxedMp4WithLoopedReplacementAudio } from '../../services/ffmpeg/audioPipeline'
import { createMp4WithFrozenFirstFrame, createMp4WithTitleImageIntro } from '../../services/ffmpeg/introPipeline'
import fs from 'fs'

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
      return { output: out, intro: intro && intro.kind ? intro : null, normalize: { enabled: normalizeAudio, targetLkfs: normalizeTargetLkfs } }
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
  return { output: out, intro: intro && intro.kind ? intro : null, normalize: { enabled: normalizeAudio, targetLkfs: normalizeTargetLkfs } }
}
