import { UPLOAD_BUCKET } from '../../config'
import type { AudioMasterV1Input } from '../../features/media-jobs/types'
import { createMuxedMp4WithLoopedMixedAudio, createMuxedMp4WithLoopedReplacementAudio } from '../../services/ffmpeg/audioPipeline'
import { createMp4WithFrozenFirstFrame } from '../../services/ffmpeg/introPipeline'
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

  const introSecondsRaw = input.introSeconds != null ? Number(input.introSeconds) : 0
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
        logPaths,
      })
      appendLog(`mix:done ms=${Date.now() - t0} s3Url=${out.s3Url}`)
      return { output: out, intro: introSeconds > 0 ? { kind: 'freeze_first_frame', seconds: introSeconds } : null, normalize: { enabled: normalizeAudio, targetLkfs: normalizeTargetLkfs } }
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
    logPaths,
  })
  appendLog(`replace:done ms=${Date.now() - t0} s3Url=${out.s3Url}`)
  return { output: out, intro: introSeconds > 0 ? { kind: 'freeze_first_frame', seconds: introSeconds } : null, normalize: { enabled: normalizeAudio, targetLkfs: normalizeTargetLkfs } }
}
