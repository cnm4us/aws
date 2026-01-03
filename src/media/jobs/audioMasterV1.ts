import { UPLOAD_BUCKET } from '../../config'
import type { AudioMasterV1Input } from '../../features/media-jobs/types'
import { createMuxedMp4WithLoopedMixedAudio, createMuxedMp4WithLoopedReplacementAudio } from '../../services/ffmpeg/audioPipeline'

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

  if (mode === 'mix') {
    try {
      const out = await createMuxedMp4WithLoopedMixedAudio({
        uploadBucket,
        dateYmd,
        productionUlid,
        originalLeaf,
        videoDurationSeconds: input.videoDurationSeconds,
        video: input.video,
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
      return { output: out, normalize: { enabled: normalizeAudio, targetLkfs: normalizeTargetLkfs } }
    } catch {
      // fall back to replace
    }
  }

  const out = await createMuxedMp4WithLoopedReplacementAudio({
    uploadBucket,
    dateYmd,
    productionUlid,
    originalLeaf,
    videoDurationSeconds: input.videoDurationSeconds,
    video: input.video,
    audio: input.music,
    musicGainDb: Number(input.musicGainDb || -18),
    audioDurationSeconds: input.audioDurationSeconds == null ? null : Number(input.audioDurationSeconds),
    audioFadeEnabled: input.audioFadeEnabled !== false,
    normalizeAudio,
    normalizeTargetLkfs,
    logPaths,
  })
  return { output: out, normalize: { enabled: normalizeAudio, targetLkfs: normalizeTargetLkfs } }
}
