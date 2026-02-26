import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { getPool } from '../../db'
import { CREATE_VIDEO_BG_COLOR, MEDIA_CONVERT_NORMALIZE_AUDIO, UPLOAD_BUCKET, UPLOAD_PREFIX } from '../../config'
import { buildExportKey, nowDateYmd } from '../../utils/naming'
import { downloadS3ObjectToFile, runFfmpeg, uploadFileToS3 } from '../../services/ffmpeg/audioPipeline'
import { burnPngOverlaysIntoMp4, probeVideoDisplayDimensions } from '../../services/ffmpeg/visualPipeline'
import { probeMediaInfo } from '../../services/ffmpeg/metrics'

type FfmpegLogPaths = { stdoutPath?: string; stderrPath?: string; commandLog?: string[]; commandLabel?: string }

type Clip = {
  id: string
  uploadId: number
  startSeconds?: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  audioEnabled?: boolean
  boostDb?: number
  bgFillStyle?: 'none' | 'blur' | 'color' | 'image'
  bgFillBrightness?: 'light3' | 'light2' | 'light1' | 'neutral' | 'dim1' | 'dim2' | 'dim3'
  bgFillDim?: 'light' | 'medium' | 'strong'
  bgFillBlur?: 'soft' | 'medium' | 'strong' | 'very_strong'
  bgFillColor?: string
  bgFillImageUploadId?: number | null
  freezeStartSeconds?: number
  freezeEndSeconds?: number
}
type Graphic = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  // Optional placement fields. When absent, the graphic is treated as legacy full-frame cover.
  fitMode?: 'cover_full' | 'contain_transparent'
  sizePctWidth?: number
  position?:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'middle_left'
    | 'middle_center'
    | 'middle_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right'
  insetXPx?: number
  insetYPx?: number
  // Optional presentation effects (v1).
  borderWidthPx?: 0 | 2 | 4 | 6
  borderColor?: string
  fade?: 'none' | 'in' | 'out' | 'in_out'
  fadeDurationMs?: number
  // Optional motion effects (v1.1).
  animate?: 'none' | 'slide_in' | 'slide_out' | 'slide_in_out' | 'doc_reveal'
  animateDurationMs?: number
}
type Still = { id: string; uploadId: number; startSeconds: number; endSeconds: number; sourceClipId?: string }
type VideoOverlayStill = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  sourceVideoOverlayId?: string
  sizePctWidth?: number
  position?:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'middle_left'
    | 'middle_center'
    | 'middle_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right'
}
type VideoOverlay = {
  id: string
  uploadId: number
  // Absolute placement on the timeline; when omitted, defaults to sequential placement after the previous overlay.
  startSeconds?: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  sizePctWidth: number
  position:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'middle_left'
    | 'middle_center'
    | 'middle_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right'
  audioEnabled?: boolean
  boostDb?: number
  plateStyle?: 'none' | 'thin' | 'medium' | 'thick' | 'band'
  plateColor?: string
  plateOpacityPct?: number
}
type Logo = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  sizePctWidth?: number
  position?:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'middle_left'
    | 'middle_center'
    | 'middle_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right'
    // Legacy fallback.
    | 'center'
  opacityPct?: number
  fade?: 'none' | 'in' | 'out' | 'in_out'
  insetXPx?: number
  insetYPx?: number
}
type LowerThird = { id: string; uploadId: number; startSeconds: number; endSeconds: number; configId: number; configSnapshot: any }
type ScreenTitle = { id: string; startSeconds: number; endSeconds: number; presetId: number | null; presetSnapshot: any | null; text?: string; renderUploadId: number | null }
type AudioTrack = { uploadId: number; audioConfigId: number; startSeconds: number; endSeconds: number }
type MusicMode = 'opener_cutoff' | 'replace' | 'mix' | 'mix_duck'
type MusicLevel = 'quiet' | 'medium' | 'loud'
type DuckingIntensity = 'min' | 'medium' | 'max'
type AudioSegment = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  sourceStartSeconds?: number
  audioEnabled?: boolean
  musicMode?: MusicMode
  musicLevel?: MusicLevel
  duckingIntensity?: DuckingIntensity
  // Legacy only; ignored by Create Video export audio logic.
  audioConfigId?: number
}
type Narration = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  sourceStartSeconds?: number
  audioEnabled?: boolean
  boostDb?: number
  // Legacy only; ignored when boostDb is present.
  gainDb?: number
  visualizer?: {
    enabled?: boolean
    style?: 'wave_line' | 'wave_fill' | 'spectrum_bars'
    fgColor?: string
    bgColor?: string | 'transparent'
    opacity?: number
    scale?: 'linear' | 'log'
  }
}

function normalizeBoostDb(raw: unknown): number {
  const boostAllowed = new Set([0, 3, 6, 9])
  const n = raw == null ? 0 : Number(raw)
  const rounded = Number.isFinite(n) ? Math.round(n) : 0
  return boostAllowed.has(rounded) ? rounded : 0
}

function normalizeNarrationVisualizerConfig(raw: any): {
  enabled: boolean
  style: 'wave_line' | 'wave_fill' | 'spectrum_bars'
  fgColor: string
  gradientEnabled?: boolean
  gradientStart?: string
  gradientEnd?: string
  gradientMode?: 'vertical' | 'horizontal'
  clipMode?: 'none' | 'rect'
  clipInsetPct?: number
  clipHeightPct?: number
  bgColor: string | 'transparent'
  opacity: number
  scale: 'linear' | 'log'
} {
  const styleRaw = String(raw?.style || 'wave_line').trim().toLowerCase()
  const styleAllowed = new Set(['wave_line', 'wave_fill', 'spectrum_bars', 'radial_bars'])
  const mappedStyle = styleRaw === 'radial_bars' ? 'spectrum_bars' : styleRaw
  const style = styleAllowed.has(styleRaw) ? (mappedStyle as any) : 'wave_line'
  const scaleRaw = String(raw?.scale || 'linear').trim().toLowerCase()
  const scale = scaleRaw === 'log' ? 'log' : 'linear'
  const fgColor = normalizeHexColor(raw?.fgColor, '#d4af37')
  const gradientEnabled = raw?.gradientEnabled === true
  const gradientStart = normalizeHexColor(raw?.gradientStart, fgColor)
  const gradientEnd = normalizeHexColor(raw?.gradientEnd, '#f7d774')
  const gradientModeRaw = String(raw?.gradientMode || 'vertical').trim().toLowerCase()
  const gradientMode = gradientModeRaw === 'horizontal' ? 'horizontal' : 'vertical'
  const clipModeRaw = String(raw?.clipMode || 'none').trim().toLowerCase()
  const clipMode = clipModeRaw === 'rect' ? 'rect' : 'none'
  const clipInsetRaw = Number(raw?.clipInsetPct)
  const clipInsetPct = Number.isFinite(clipInsetRaw) ? clamp(clipInsetRaw, 0, 40) : 6
  const clipHeightRaw = Number(raw?.clipHeightPct)
  const clipHeightPct = Number.isFinite(clipHeightRaw) ? clamp(clipHeightRaw, 10, 100) : 100
  const bgRaw = String(raw?.bgColor || 'transparent').trim().toLowerCase()
  const bgColor = bgRaw === 'transparent' ? 'transparent' : normalizeHexColor(bgRaw, '#000000')
  const opacityRaw = Number(raw?.opacity)
  const opacity = Number.isFinite(opacityRaw) ? clamp(opacityRaw, 0, 1) : 1
  const enabled = raw?.enabled === true
  return { enabled, style, fgColor, gradientEnabled, gradientStart, gradientEnd, gradientMode, clipMode, clipInsetPct, clipHeightPct, bgColor, opacity, scale }
}

function hexToFfmpegColor(hex: string): string {
  const s = String(hex || '').trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(s)) return '0x000000'
  return `0x${s.replace('#', '')}`
}

function musicGainDbForLevel(level: MusicLevel): number {
  // Initial guess; adjust after real-world testing.
  switch (level) {
    case 'quiet':
      return -24
    case 'loud':
      return -12
    case 'medium':
    default:
      return -18
  }
}

function duckingAmountDbForIntensity(intensity: DuckingIntensity): number {
  // Initial guess; adjust after real-world testing.
  switch (intensity) {
    case 'min':
      return 6
    case 'max':
      return 18
    case 'medium':
    default:
      return 12
  }
}

function buildMusicAudioConfig(input: { mode: MusicMode; level: MusicLevel; duckingIntensity?: DuckingIntensity }): any {
  const musicGainDb = musicGainDbForLevel(input.level)
  if (input.mode === 'replace') {
    return {
      mode: 'replace',
      videoGainDb: 0,
      musicGainDb,
      duckingEnabled: false,
      duckingMode: 'none',
      duckingGate: 'normal',
      duckingAmountDb: 12,
      audioFadeEnabled: true,
    }
  }
  if (input.mode === 'mix') {
    return {
      mode: 'mix',
      videoGainDb: 0,
      musicGainDb,
      duckingEnabled: false,
      duckingMode: 'none',
      duckingGate: 'normal',
      duckingAmountDb: 12,
      audioFadeEnabled: true,
    }
  }
  if (input.mode === 'mix_duck') {
    const intensity = input.duckingIntensity || 'medium'
    return {
      mode: 'mix',
      videoGainDb: 0,
      musicGainDb,
      duckingEnabled: true,
      duckingMode: 'rolling',
      duckingGate: 'normal',
      duckingAmountDb: duckingAmountDbForIntensity(intensity as DuckingIntensity),
      audioFadeEnabled: true,
    }
  }
  // opener_cutoff: abrupt cut when any ON voice is detected (base/overlay/narration) in the already-mixed timeline audio.
  return {
    mode: 'mix',
    videoGainDb: 0,
    musicGainDb,
    duckingEnabled: true,
    duckingMode: 'abrupt',
    duckingGate: 'normal',
    duckingAmountDb: 12,
    openerCutFadeBeforeSeconds: 1,
    openerCutFadeAfterSeconds: 1,
    audioFadeEnabled: true,
  }
}

export type CreateVideoExportV1Input = {
  projectId: number
  userId: number
  timeline: {
    version: 'create_video_v1'
    timelineBackgroundMode?: 'none' | 'color' | 'image'
    timelineBackgroundColor?: string
    timelineBackgroundUploadId?: number | null
    clips: Clip[]
    stills?: Still[]
    videoOverlays?: VideoOverlay[]
    videoOverlayStills?: VideoOverlayStill[]
    graphics?: Graphic[]
    guidelines?: number[]
    logos?: Logo[]
    lowerThirds?: LowerThird[]
    screenTitles?: ScreenTitle[]
    narration?: Narration[]
    audioSegments?: AudioSegment[]
    audioTrack?: AudioTrack | null
  }
}

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

function clamp(n: number, min: number, max: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, v))
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const p = spawn(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    let out = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.on('close', (code) => {
      if (code !== 0) return resolve(false)
      resolve(Boolean(String(out || '').trim()))
    })
    p.on('error', () => resolve(false))
  })
}

async function probeDurationSeconds(filePath: string): Promise<number | null> {
  return await new Promise<number | null>((resolve) => {
    const p = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    let out = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.on('close', (code) => {
      if (code !== 0) return resolve(null)
      const v = Number(String(out || '').trim())
      if (!Number.isFinite(v) || v <= 0) return resolve(null)
      resolve(v)
    })
    p.on('error', () => resolve(null))
  })
}

async function detectInitialNonSilenceSeconds(
  filePath: string,
  gate: 'sensitive' | 'normal' | 'strict',
  opts?: { maxAnalyzeSeconds?: number }
): Promise<number | null> {
  if (!(await hasAudioStream(filePath))) return null

  const noiseDb = gate === 'sensitive' ? '-50dB' : (gate === 'strict' ? '-38dB' : '-44dB')
  const minNonSilenceSeconds = 0.12
  const maxAnalyzeSecondsRaw = opts?.maxAnalyzeSeconds != null ? Number(opts.maxAnalyzeSeconds) : null
  const maxAnalyzeSeconds =
    maxAnalyzeSecondsRaw != null && Number.isFinite(maxAnalyzeSecondsRaw)
      ? Math.max(3, Math.min(180, maxAnalyzeSecondsRaw))
      : 30

  return await new Promise<number | null>((resolve) => {
    const args = [
      '-hide_banner',
      '-t',
      String(maxAnalyzeSeconds),
      '-i',
      filePath,
      '-vn',
      '-af',
      `silencedetect=n=${noiseDb}:d=${minNonSilenceSeconds.toFixed(2)}`,
      '-f',
      'null',
      '-',
    ]
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    p.stderr.on('data', (d) => { stderr += String(d) })
    p.on('close', (code) => {
      if (code !== 0) return resolve(0)
      const hasSilenceStart = /silence_start:\s*([0-9.]+)/.test(stderr)
      const m = stderr.match(/silence_end:\s*([0-9.]+)/)
      if (!m) return resolve(hasSilenceStart ? null : 0)
      const v = Number(m[1])
      if (!Number.isFinite(v) || v < 0) return resolve(0)
      resolve(v)
    })
    p.on('error', () => resolve(0))
  })
}

function thresholdForGate(gate: string): number {
  if (gate === 'sensitive') return 0.06
  if (gate === 'strict') return 0.10
  return 0.08 // normal
}

async function applyAudioTrackToMp4(opts: {
  inMp4Path: string
  outMp4Path: string
  audioPath: string
  audioConfig: any
  trackStartSeconds: number
  trackEndSeconds: number
  normalizeAudio?: boolean
  logPaths?: FfmpegLogPaths
}) {
  const cfg = opts.audioConfig || {}
  const mode = String(cfg.mode || 'mix').toLowerCase() === 'replace' ? 'replace' : 'mix'
  const vDb = Math.round(Number.isFinite(Number(cfg.videoGainDb)) ? Number(cfg.videoGainDb) : 0)
  const mDb = Math.round(Number.isFinite(Number(cfg.musicGainDb)) ? Number(cfg.musicGainDb) : -18)
  const vVol = `${vDb}dB`
  const mVol = `${mDb}dB`
  const duckingMode = String(cfg.duckingMode || 'none').toLowerCase()
  const duckingGate = String(cfg.duckingGate || 'normal').toLowerCase()
  const duckingEnabled = Boolean(cfg.duckingEnabled) && mode === 'mix' && duckingMode !== 'none'
  const duckingAmountDb = Math.max(0, Math.min(24, Math.round(Number.isFinite(Number(cfg.duckingAmountDb)) ? Number(cfg.duckingAmountDb) : 12)))

  const videoDurRaw = await probeDurationSeconds(opts.inMp4Path)
  const videoDur = videoDurRaw != null && Number.isFinite(videoDurRaw) && videoDurRaw > 0 ? videoDurRaw : null
  const startSeconds = roundToTenth(Math.max(0, Number(opts.trackStartSeconds || 0)))
  const endSeconds = roundToTenth(Math.max(0, Number(opts.trackEndSeconds || 0)))
  if (!(endSeconds > startSeconds)) throw new Error('invalid_audio_track_range')
  const spanLen = Math.max(0, endSeconds - startSeconds)

  const durCapRaw = cfg.audioDurationSeconds != null ? Number(cfg.audioDurationSeconds) : null
  const durCap = durCapRaw != null && Number.isFinite(durCapRaw) && durCapRaw > 0 ? durCapRaw : null
  const clipLen = roundToTenth(durCap != null ? Math.min(spanLen, durCap) : spanLen)
  if (!(clipLen > 0.05)) throw new Error('invalid_audio_track_duration')

  const fadeEnabled = cfg.audioFadeEnabled !== false
  const fadeBase = 0.35
  const fadeDur = fadeEnabled ? Math.max(0.05, Math.min(fadeBase, clipLen / 2)) : 0
  const fadeOutStart = Math.max(0, clipLen - fadeDur)
  const fadeFilters = fadeDur > 0
    ? `,afade=t=in:st=0:d=${fadeDur.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDur.toFixed(2)}`
    : ''

  const delayMs = Math.max(0, Math.round(startSeconds * 1000))
  const delayFilter = delayMs > 0 ? `,adelay=${delayMs}:all=1` : ''

  const normalizeEnabled = opts.normalizeAudio == null ? Boolean(MEDIA_CONVERT_NORMALIZE_AUDIO) : Boolean(opts.normalizeAudio)
  const targetLkfs = -16
  const useDurTrim = normalizeEnabled && videoDur != null
  const durTrim = useDurTrim ? `,atrim=0:${videoDur!.toFixed(6)},asetpts=N/SR/TB` : ''
  const normSuffix = normalizeEnabled ? `,loudnorm=I=${targetLkfs}:TP=-1.5:LRA=11` : ''

  const args: string[] = ['-i', opts.inMp4Path, '-stream_loop', '-1', '-i', opts.audioPath]

  const musicChain = `[1:a]volume=${mVol},atrim=0:${clipLen.toFixed(3)},asetpts=N/SR/TB${fadeFilters}${delayFilter},apad[musicfull]`

  let outLabel = '[out]'

  if (mode === 'replace') {
    const filter = `${musicChain};[musicfull]alimiter=limit=0.98${normSuffix}${durTrim}${outLabel}`
    args.push('-filter_complex', filter, '-map', '0:v:0', '-map', outLabel)
  } else {
    const origChain = `[0:a]volume=${vVol},apad[orig]`
    let musicProcessed = '[music]'

    let musicProcessChain = ''
    if (duckingEnabled && duckingMode === 'rolling') {
      const threshold = thresholdForGate(duckingGate)
      const ratio = Math.max(2, Math.min(20, 1 + Math.round(duckingAmountDb / 2)))
      const attack = 20
      const release = 250
      musicProcessChain = `${musicChain};[musicfull][0:a]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1[mduck];[mduck]volume=${mVol}[music]`
    } else if (duckingEnabled && duckingMode === 'abrupt') {
      const analyzeWindow = durCap != null ? Math.max(5, Math.min(60, durCap + 10)) : 30
      const cutAt = await detectInitialNonSilenceSeconds(opts.inMp4Path, (duckingGate as any) || 'normal', { maxAnalyzeSeconds: analyzeWindow })
      const beforeRaw = cfg.openerCutFadeBeforeSeconds != null ? Number(cfg.openerCutFadeBeforeSeconds) : null
      const afterRaw = cfg.openerCutFadeAfterSeconds != null ? Number(cfg.openerCutFadeAfterSeconds) : null
      const before = beforeRaw != null && Number.isFinite(beforeRaw) ? Math.max(0, Math.min(3, beforeRaw)) : null
      const after = afterRaw != null && Number.isFinite(afterRaw) ? Math.max(0, Math.min(3, afterRaw)) : null
      const beforeSec = before == null && after == null ? 0.5 : (before ?? 0)
      const afterSec = after ?? 0

      const relativeCutRaw = cutAt == null ? null : cutAt - startSeconds
      const relativeCut = relativeCutRaw != null ? Math.max(0, relativeCutRaw) : null

      if (relativeCut != null && relativeCut <= 0.05) {
        musicProcessChain = `${musicChain};[musicfull]volume=0[music]`
      } else if (relativeCut != null) {
        const endRaw = relativeCut + afterSec
        const endCut = Math.min(clipLen, Math.max(0, endRaw))
        const fadeStart = Math.max(0, relativeCut - beforeSec)
        const fadeEnd = Math.min(endCut, relativeCut + afterSec)
        const fadeDuration = Math.max(0, Math.min(beforeSec + afterSec, Math.max(0, fadeEnd - fadeStart)))
        const cutFade = fadeDuration > 0 ? `,afade=t=out:st=${fadeStart.toFixed(2)}:d=${fadeDuration.toFixed(2)}` : ''
        const clippedDelayMs = delayMs
        const clippedDelay = clippedDelayMs > 0 ? `,adelay=${clippedDelayMs}:all=1` : ''

        // Rebuild music stream with truncation around cutoff, then pad to full length.
        const m = `[1:a]volume=${mVol},atrim=0:${endCut.toFixed(3)},asetpts=N/SR/TB${cutFade}${clippedDelay},apad[music]`
        musicProcessChain = m
        musicProcessed = '[music]'
      } else {
        musicProcessChain = `${musicChain};[musicfull]volume=${mVol}[music]`
      }
    } else {
      musicProcessChain = `${musicChain};[musicfull]volume=${mVol}[music]`
    }

    const mix = `${origChain};${musicProcessChain};[orig]${musicProcessed}amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98${normSuffix}${durTrim}${outLabel}`
    args.push('-filter_complex', mix, '-map', '0:v:0', '-map', outLabel)
  }

  args.push(
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    opts.outMp4Path
  )
  if (!useDurTrim) args.splice(args.length - 1, 0, '-shortest')
  await runFfmpeg(args, opts.logPaths)
}

async function applyAudioSegmentsToMp4(opts: {
  inMp4Path: string
  outMp4Path: string
  audioPath: string
  audioConfig: any
  segments: Array<{ startSeconds: number; endSeconds: number; sourceStartSeconds: number }>
  normalizeAudio?: boolean
  logPaths?: FfmpegLogPaths
}) {
  const segs = Array.isArray(opts.segments) ? opts.segments : []
  if (!segs.length) {
    fs.copyFileSync(opts.inMp4Path, opts.outMp4Path)
    return
  }

  const cfg = opts.audioConfig || {}
  const mode = String(cfg.mode || 'mix').toLowerCase() === 'replace' ? 'replace' : 'mix'
  const vDb = Math.round(Number.isFinite(Number(cfg.videoGainDb)) ? Number(cfg.videoGainDb) : 0)
  const mDb = Math.round(Number.isFinite(Number(cfg.musicGainDb)) ? Number(cfg.musicGainDb) : -18)
  const vVol = `${vDb}dB`
  const mVol = `${mDb}dB`
  const duckingMode = String(cfg.duckingMode || 'none').toLowerCase()
  const duckingGate = String(cfg.duckingGate || 'normal').toLowerCase()
  const duckingEnabled = Boolean(cfg.duckingEnabled) && mode === 'mix' && duckingMode !== 'none'
  const duckingAmountDb = Math.max(0, Math.min(24, Math.round(Number.isFinite(Number(cfg.duckingAmountDb)) ? Number(cfg.duckingAmountDb) : 12)))

  const videoDurRaw = await probeDurationSeconds(opts.inMp4Path)
  const videoDur = videoDurRaw != null && Number.isFinite(videoDurRaw) && videoDurRaw > 0 ? videoDurRaw : null

  const durCapRaw = cfg.audioDurationSeconds != null ? Number(cfg.audioDurationSeconds) : null
  const durCap = durCapRaw != null && Number.isFinite(durCapRaw) && durCapRaw > 0 ? durCapRaw : null

  const fadeEnabled = cfg.audioFadeEnabled !== false
  const fadeBase = 0.35

  const normalizeEnabled = opts.normalizeAudio == null ? Boolean(MEDIA_CONVERT_NORMALIZE_AUDIO) : Boolean(opts.normalizeAudio)
  const targetLkfs = -16
  const useDurTrim = normalizeEnabled && videoDur != null
  const durTrim = useDurTrim ? `,atrim=0:${videoDur!.toFixed(6)},asetpts=N/SR/TB` : ''
  const normSuffix = normalizeEnabled ? `,loudnorm=I=${targetLkfs}:TP=-1.5:LRA=11` : ''

  const args: string[] = ['-i', opts.inMp4Path, '-stream_loop', '-1', '-i', opts.audioPath]

  const segChains: string[] = []
  const segLabels: string[] = []
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const startSeconds = roundToTenth(Math.max(0, Number(s.startSeconds || 0)))
    const endSeconds = roundToTenth(Math.max(0, Number(s.endSeconds || 0)))
    if (!(endSeconds > startSeconds)) continue
    const spanLen = Math.max(0, endSeconds - startSeconds)
    const clipLen = roundToTenth(durCap != null ? Math.min(spanLen, durCap) : spanLen)
    if (!(clipLen > 0.05)) continue

    const fadeDur = fadeEnabled ? Math.max(0.05, Math.min(fadeBase, clipLen / 2)) : 0
    const fadeOutStart = Math.max(0, clipLen - fadeDur)
    const fadeFilters =
      fadeDur > 0
        ? `,afade=t=in:st=0:d=${fadeDur.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDur.toFixed(2)}`
        : ''

    const delayMs = Math.max(0, Math.round(startSeconds * 1000))
    const delayFilter = delayMs > 0 ? `,adelay=${delayMs}:all=1` : ''

    const srcStart = roundToTenth(Math.max(0, Number(s.sourceStartSeconds || 0)))
    const label = `mseg${i}`
    segChains.push(
      `[1:a]volume=${mVol},atrim=start=${srcStart.toFixed(3)}:duration=${clipLen.toFixed(3)},asetpts=N/SR/TB${fadeFilters}${delayFilter},apad[${label}]`
    )
    segLabels.push(`[${label}]`)
  }
  if (!segLabels.length) {
    fs.copyFileSync(opts.inMp4Path, opts.outMp4Path)
    return
  }

  const musicBaseChain =
    segLabels.length === 1
      ? `${segChains.join(';')};${segLabels[0]}anull[musicfull]`
      : `${segChains.join(';')};${segLabels.join('')}amix=inputs=${segLabels.length}:duration=longest:dropout_transition=0:normalize=0[musicfull]`

  let outLabel = '[out]'

  if (mode === 'replace') {
    const filter = `${musicBaseChain};[musicfull]alimiter=limit=0.98${normSuffix}${durTrim}${outLabel}`
    args.push('-filter_complex', filter, '-map', '0:v:0', '-map', outLabel)
  } else {
    const origChain = `[0:a]volume=${vVol},apad[orig]`
    let musicProcessed = '[musicfull]'
    let musicProcessChain = musicBaseChain

    if (duckingEnabled && duckingMode === 'rolling') {
      const threshold = thresholdForGate(duckingGate)
      const ratio = Math.max(2, Math.min(20, 1 + Math.round(duckingAmountDb / 2)))
      const attack = 20
      const release = 250
      musicProcessChain = `${musicBaseChain};[musicfull][0:a]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1[music]`
      musicProcessed = '[music]'
    } else if (duckingEnabled && duckingMode === 'abrupt') {
      // Opener cut-off mode assumes a single "continuous" audio span; for multi-segment tracks,
      // fall back to a straight mix (no abrupt cut) for now.
      if (segs.length === 1) {
        const analyzeWindow = durCap != null ? Math.max(5, Math.min(60, durCap + 10)) : 30
        const cutAt = await detectInitialNonSilenceSeconds(opts.inMp4Path, (duckingGate as any) || 'normal', { maxAnalyzeSeconds: analyzeWindow })
        const beforeRaw = cfg.openerCutFadeBeforeSeconds != null ? Number(cfg.openerCutFadeBeforeSeconds) : null
        const afterRaw = cfg.openerCutFadeAfterSeconds != null ? Number(cfg.openerCutFadeAfterSeconds) : null
        const before = beforeRaw != null && Number.isFinite(beforeRaw) ? Math.max(0, Math.min(3, beforeRaw)) : null
        const after = afterRaw != null && Number.isFinite(afterRaw) ? Math.max(0, Math.min(3, afterRaw)) : null
        const beforeSec = before == null && after == null ? 0.5 : (before ?? 0)
        const afterSec = after ?? 0

        const only = segs[0]
        const startSeconds = roundToTenth(Math.max(0, Number(only.startSeconds || 0)))
        const endSeconds = roundToTenth(Math.max(0, Number(only.endSeconds || 0)))
        const spanLen = Math.max(0, endSeconds - startSeconds)
        const clipLen = roundToTenth(durCap != null ? Math.min(spanLen, durCap) : spanLen)
        const relativeCutRaw = cutAt == null ? null : cutAt - startSeconds
        const relativeCut = relativeCutRaw != null ? Math.max(0, relativeCutRaw) : null

        if (relativeCut != null && relativeCut <= 0.05) {
          musicProcessChain = `${musicBaseChain};[musicfull]volume=0[music]`
          musicProcessed = '[music]'
        } else if (relativeCut != null) {
          const endRaw = relativeCut + afterSec
          const endCut = Math.min(clipLen, Math.max(0, endRaw))
          const fadeStart = Math.max(0, relativeCut - beforeSec)
          const fadeEnd = Math.min(endCut, relativeCut + afterSec)
          const fadeDuration = Math.max(0, Math.min(beforeSec + afterSec, Math.max(0, fadeEnd - fadeStart)))
          const cutFade = fadeDuration > 0 ? `,afade=t=out:st=${fadeStart.toFixed(2)}:d=${fadeDuration.toFixed(2)}` : ''
          const delayMs = Math.max(0, Math.round(startSeconds * 1000))
          const clippedDelay = delayMs > 0 ? `,adelay=${delayMs}:all=1` : ''

          const srcStart = roundToTenth(Math.max(0, Number((only as any).sourceStartSeconds || 0)))
          const m = `[1:a]volume=${mVol},atrim=start=${srcStart.toFixed(3)}:duration=${endCut.toFixed(3)},asetpts=N/SR/TB${cutFade}${clippedDelay},apad[music]`
          musicProcessChain = m
          musicProcessed = '[music]'
        }
      }
    }

    const mix = `${origChain};${musicProcessChain};[orig]${musicProcessed}amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98${normSuffix}${durTrim}${outLabel}`
    args.push('-filter_complex', mix, '-map', '0:v:0', '-map', outLabel)
  }

  args.push(
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    opts.outMp4Path
  )
  if (!useDurTrim) args.splice(args.length - 1, 0, '-shortest')
  await runFfmpeg(args, opts.logPaths)
}

async function applyNarrationSegmentsToMp4(opts: {
  inMp4Path: string
  outMp4Path: string
  segments: Array<{ audioPath: string; startSeconds: number; endSeconds: number; sourceStartSeconds: number; gainDb: number }>
  logPaths?: FfmpegLogPaths
}) {
  const segs = Array.isArray(opts.segments) ? opts.segments : []
  if (!segs.length) {
    fs.copyFileSync(opts.inMp4Path, opts.outMp4Path)
    return
  }

  const normalizeEnabled = Boolean(MEDIA_CONVERT_NORMALIZE_AUDIO)
  const targetLkfs = -16
  const videoDurRaw = await probeDurationSeconds(opts.inMp4Path)
  const videoDur = videoDurRaw != null && Number.isFinite(videoDurRaw) && videoDurRaw > 0 ? videoDurRaw : null
  const useDurTrim = normalizeEnabled && videoDur != null
  const durTrim = useDurTrim ? `,atrim=0:${videoDur!.toFixed(6)},asetpts=N/SR/TB` : ''
  const normSuffix = normalizeEnabled ? `,loudnorm=I=${targetLkfs}:TP=-1.5:LRA=11` : ''

  const baseHasAudio = await hasAudioStream(opts.inMp4Path)
  const args: string[] = ['-i', opts.inMp4Path]
  let baseAudioInputIndex = 0
  if (!baseHasAudio) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
    baseAudioInputIndex = 1
  }
  for (const s of segs) args.push('-i', s.audioPath)

  const baseChain = `[${baseAudioInputIndex}:a]apad[base]`
  const segChains: string[] = []
  const segLabels: string[] = []
  const segInputStart = baseHasAudio ? 1 : 2
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const inputIndex = segInputStart + i
    const startSeconds = clamp(roundToTenth(Number(s.startSeconds || 0)), 0, 20 * 60)
    const endSeconds = clamp(roundToTenth(Number(s.endSeconds || 0)), 0, 20 * 60)
    const clipLen = roundToTenth(Math.max(0, endSeconds - startSeconds))
    if (!(clipLen > 0.05)) continue
    const srcStart = clamp(roundToTenth(Number((s as any).sourceStartSeconds || 0)), 0, 20 * 60)
    const srcEnd = roundToTenth(Math.max(0, srcStart + clipLen))
    const delayMs = Math.max(0, Math.round(startSeconds * 1000))
    const delayFilter = delayMs > 0 ? `,adelay=${delayMs}:all=1` : ''
    const gainDb = Number.isFinite(Number(s.gainDb)) ? Number(s.gainDb) : 0
    const label = `nar${i}`
    segChains.push(
      `[${inputIndex}:a]atrim=start=${srcStart.toFixed(3)}:end=${srcEnd.toFixed(3)},asetpts=N/SR/TB${delayFilter},volume=${gainDb}dB,apad[${label}]`
    )
    segLabels.push(`[${label}]`)
  }

  const mixInputs = ['[base]', ...segLabels].join('')
  const mixCount = 1 + segLabels.length
  const filter = `${baseChain};${segChains.join(';')};${mixInputs}amix=inputs=${mixCount}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98${normSuffix}${durTrim}[out]`
  args.push('-filter_complex', filter, '-map', '0:v:0', '-map', '[out]')
  args.push(
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    opts.outMp4Path
  )
  if (!useDurTrim) args.splice(args.length - 1, 0, '-shortest')
  await runFfmpeg(args, opts.logPaths)
}

function even(n: number): number {
  const v = Math.max(2, Math.round(n))
  return v % 2 === 0 ? v : v - 1
}

function normalizeFfmpegColor(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return 'black'
  if (/^0x[0-9a-fA-F]{6,8}$/.test(raw)) return raw
  const m = raw.match(/^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/)
  if (m) return `0x${m[1]}${m[2] || ''}`
  return raw
}

function normalizeHexColor(input: unknown, fallback = '#000000'): string {
  const raw = String(input == null ? fallback : input).trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(raw)) return fallback
  return raw.startsWith('#') ? raw : `#${raw}`
}

function computeTargetDims(firstW: number, firstH: number): { w: number; h: number } {
  const maxLongEdge = 1080
  const longEdge = Math.max(firstW, firstH)
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1
  return { w: even(firstW * scale), h: even(firstH * scale) }
}

async function renderBlackBaseMp4(opts: {
  outPath: string
  durationSeconds: number
  targetW: number
  targetH: number
  fps: number
  color?: string
  backgroundImagePath?: string | null
  logPaths?: FfmpegLogPaths
}) {
  const dur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!(dur > 0)) throw new Error('invalid_duration')
  const fps = Math.max(15, Math.min(60, Math.round(Number(opts.fps || 30))))
  const bgImagePath = opts.backgroundImagePath ? String(opts.backgroundImagePath) : ''
  if (bgImagePath) {
    await runFfmpeg(
      [
        '-loop',
        '1',
        '-t',
        String(dur),
        '-i',
        bgImagePath,
        '-f',
        'lavfi',
        '-t',
        String(dur),
        '-i',
        `anullsrc=r=48000:cl=stereo`,
        '-shortest',
        '-filter_complex',
        `[0:v]scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=increase,crop=${opts.targetW}:${opts.targetH},fps=${fps},format=yuv420p[v]`,
        '-map',
        '[v]',
        '-map',
        '1:a:0',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        opts.outPath,
      ],
      opts.logPaths
    )
    return
  }
  const color = normalizeFfmpegColor(opts.color ?? CREATE_VIDEO_BG_COLOR)
  await runFfmpeg(
    [
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=${opts.targetW}x${opts.targetH}:d=${dur}:r=${fps}`,
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=48000:cl=stereo`,
      '-shortest',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      opts.outPath,
    ],
    opts.logPaths
  )
}

function overlayXYForPositionPx(position: string, insetXPx: number, insetYPx: number): { x: string; y: string } {
  const insetX = String(Math.max(0, Math.round(Number(insetXPx) || 0)))
  const insetY = String(Math.max(0, Math.round(Number(insetYPx) || 0)))
  switch (String(position || 'middle_center')) {
    case 'top_left':
      return { x: insetX, y: insetY }
    case 'top_center':
      return { x: '(main_w-overlay_w)/2', y: insetY }
    case 'top_right':
      return { x: `main_w-overlay_w-${insetX}`, y: insetY }
    case 'middle_left':
      return { x: insetX, y: '(main_h-overlay_h)/2' }
    case 'middle_center':
      return { x: '(main_w-overlay_w)/2', y: '(main_h-overlay_h)/2' }
    case 'middle_right':
      return { x: `main_w-overlay_w-${insetX}`, y: '(main_h-overlay_h)/2' }
    case 'bottom_left':
      return { x: insetX, y: `main_h-overlay_h-${insetY}` }
    case 'bottom_center':
      return { x: '(main_w-overlay_w)/2', y: `main_h-overlay_h-${insetY}` }
    case 'bottom_right':
    default:
      return { x: `main_w-overlay_w-${insetX}`, y: `main_h-overlay_h-${insetY}` }
  }
}

async function overlayGraphics(opts: {
  baseMp4Path: string
  outPath: string
  graphics: Array<{
    startSeconds: number
    endSeconds: number
    imagePath: string
    fitMode?: 'cover_full' | 'contain_transparent'
    sizePctWidth?: number
    position?: string
    insetXPx?: number
    insetYPx?: number
    borderWidthPx?: number
    borderColor?: string
    fade?: 'none' | 'in' | 'out' | 'in_out'
    fadeDurationMs?: number
    animate?: 'none' | 'slide_in' | 'slide_out' | 'slide_in_out' | 'doc_reveal'
    animateDurationMs?: number
  }>
  targetW: number
  targetH: number
  durationSeconds: number
  logPaths?: FfmpegLogPaths
}) {
  const baseDur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!opts.graphics.length) throw new Error('no_graphics')

  const args: string[] = ['-i', opts.baseMp4Path]
  for (const g of opts.graphics) {
    // Loop a *single* still image for the duration of the base video.
    // Also set an explicit framerate so the still produces frames consistently.
    // Note: Some ffmpeg builds don't support image2's `-pattern_type` option, so we avoid numbered filenames instead.
    args.push('-loop', '1', '-framerate', '30', '-t', String(baseDur), '-i', g.imagePath)
  }

  const filters: string[] = []
  const overlapSeconds = 0.1
  for (let i = 0; i < opts.graphics.length; i++) {
    const g = opts.graphics[i]
    const inIdx = i + 1
    const s = Number(g.startSeconds)
    const rawEnd = Number(g.endSeconds)
    const trimEnd = Math.min(baseDur, rawEnd + overlapSeconds)
    const d = Math.max(0, trimEnd - s)
    const segDur = Math.max(0, Number(g.endSeconds) - Number(g.startSeconds))
    const fitMode = g.fitMode || 'cover_full'
    const borderWidthAllowed = new Set([0, 2, 4, 6])
    const borderWidthRaw = Number(g.borderWidthPx)
    const borderWidthPx = borderWidthAllowed.has(borderWidthRaw) ? borderWidthRaw : 0
    const borderColor = String(g.borderColor || '#000000')
    const borderFilter = borderWidthPx > 0 ? `,drawbox=x=0:y=0:w=iw:h=ih:color=${borderColor}:t=${borderWidthPx}` : ''
    const animateRaw = String(g.animate || 'none').trim().toLowerCase()
    const animateAllowed = new Set(['none', 'slide_in', 'slide_out', 'slide_in_out', 'doc_reveal'])
    const animate = animateAllowed.has(animateRaw) ? animateRaw : 'none'
    const isDocReveal = animate === 'doc_reveal'
    const segMs = Math.max(0, Math.round(segDur * 1000))
    let animateDurationMs = Number.isFinite(Number(g.animateDurationMs)) ? Math.round(Number(g.animateDurationMs)) : 600
    animateDurationMs = Math.round(clamp(animateDurationMs, 100, 2000))
    const maxAnimMs = segMs > 0 ? Math.round(segMs * 0.45) : 0
    if (maxAnimMs > 0) animateDurationMs = Math.min(animateDurationMs, maxAnimMs)
    const animDur = segDur > 0 ? Math.min(segDur, animateDurationMs / 1000) : 0
    let fadeDurationMs = Number.isFinite(Number(g.fadeDurationMs)) ? Math.round(Number(g.fadeDurationMs)) : 600
    fadeDurationMs = Math.round(clamp(fadeDurationMs, 100, 2000))
    const maxFadeMs = segMs > 0 ? Math.round(segMs * 0.45) : 0
    if (maxFadeMs > 0) fadeDurationMs = Math.min(fadeDurationMs, maxFadeMs)
    const fadeDur = d > 0 ? Math.min(d, fadeDurationMs / 1000) : 0
    const fadeRaw = String(g.fade || 'none')
    const fadeAllowed = new Set(['none', 'in', 'out', 'in_out'])
    const fade = fadeAllowed.has(fadeRaw) ? (fadeRaw as 'none' | 'in' | 'out' | 'in_out') : 'none'
    const fadeIn = fade === 'in' || fade === 'in_out'
    const fadeOut = fade === 'out' || fade === 'in_out'
    const fadeInDur = fadeIn && d > 0 ? Math.min(fadeDur, d) : 0
    const fadeOutDur = fadeOut && d > 0 ? Math.min(fadeDur, d) : 0
    const fadeOutSt = Math.max(0, d - fadeOutDur)
    const fadeFilters =
      (fadeInDur > 0 ? `,fade=t=in:st=0:d=${fadeInDur}:alpha=1` : '') +
      (fadeOutDur > 0 ? `,fade=t=out:st=${fadeOutSt}:d=${fadeOutDur}:alpha=1` : '')

    if (isDocReveal) {
      let scaleExpr = '1'
      if (animDur > 0 && segDur > 0) {
        const inDur = animDur
        const outStart = Math.max(0, segDur - animDur)
        const outDur = animDur
        const inExpr = `0.2+0.8*(1-pow(1-(t/${inDur.toFixed(3)}),3))`
        const outExpr = `1-0.8*pow((t-${outStart.toFixed(3)})/${outDur.toFixed(3)},3)`
        scaleExpr = `if(lte(t,${inDur.toFixed(3)}),${inExpr},if(gte(t,${outStart.toFixed(3)}),${outExpr},1))`
      }
      const scaleExprSafe = scaleExpr.replace(/,/g, '\\,')
      const docScaleFilter =
        animDur > 0
          ? `,scale=w='iw*(${scaleExprSafe})':h='ih*(${scaleExprSafe})':eval=frame`
          : ''
      const fadeInDoc = segDur > 0 ? Math.min(fadeDurationMs / 1000, segDur) : 0
      const fadeOutDoc = segDur > 0 ? Math.min(fadeDurationMs / 1000, segDur) : 0
      const fadeOutDocSt = Math.max(0, segDur - fadeOutDoc)
      const docFadeFilters =
        (fadeInDoc > 0 ? `,fade=t=in:st=0:d=${fadeInDoc}:alpha=1` : '') +
        (fadeOutDoc > 0 ? `,fade=t=out:st=${fadeOutDocSt}:d=${fadeOutDoc}:alpha=1` : '')
      const baseScale = `scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=decrease,pad=${opts.targetW}:${opts.targetH}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`
      filters.push(
        `[${inIdx}:v]${baseScale},format=rgba${borderFilter}[img${i}full];` +
          `[img${i}full]trim=start=${s}:end=${trimEnd},setpts=PTS-STARTPTS${docScaleFilter}${docFadeFilters},setpts=PTS+${s}/TB[img${i}src]`
      )
      continue
    }

    if (fitMode === 'contain_transparent') {
      const sizePctWidth = clamp(Number(g.sizePctWidth ?? 70), 10, 100)
      const insetXPx = Math.round(clamp(Number(g.insetXPx ?? 24), 0, 300))
      const insetYPx = Math.round(clamp(Number(g.insetYPx ?? 24), 0, 300))
      const desiredW = Math.round((opts.targetW * sizePctWidth) / 100)
      // ffmpeg expressions only support min(a,b) (2 args), so nest to clamp to all constraints:
      // - requested pct width
      // - available width after X insets
      // - available height after Y insets (converted to width by aspect)
      const wExpr = `min(${desiredW},min(${opts.targetW}-2*${insetXPx},(${opts.targetH}-2*${insetYPx})*iw/ih))`
      filters.push(
        `[${inIdx}:v]scale=w='${wExpr}':h=-2:flags=lanczos,format=rgba${borderFilter}[img${i}full];` +
          `[img${i}full]trim=start=${s}:end=${trimEnd},setpts=PTS-STARTPTS${fadeFilters},setpts=PTS+${s}/TB[img${i}src]`
      )
    } else {
      // Legacy full-frame cover.
      filters.push(
        `[${inIdx}:v]scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=increase,crop=${opts.targetW}:${opts.targetH},format=rgba${borderFilter}[img${i}full];` +
          `[img${i}full]trim=start=${s}:end=${trimEnd},setpts=PTS-STARTPTS${fadeFilters},setpts=PTS+${s}/TB[img${i}src]`
      )
    }
  }

  let current = '[0:v]'
  for (let i = 0; i < opts.graphics.length; i++) {
    const g = opts.graphics[i]
    const next = `[v${i + 1}]`
    const fitMode = g.fitMode || 'cover_full'
    const sStr = Number(g.startSeconds).toFixed(3)
    const eStr = Math.min(baseDur, Number(g.endSeconds) + overlapSeconds).toFixed(3)
    if (fitMode === 'contain_transparent') {
      const insetXPx = Math.round(clamp(Number(g.insetXPx ?? 24), 0, 300))
      const insetYPx = Math.round(clamp(Number(g.insetYPx ?? 24), 0, 300))
      const posRaw = String(g.position || 'middle_center')
      const animateRaw = String(g.animate || 'none').trim().toLowerCase()
      const animateAllowed = new Set(['none', 'slide_in', 'slide_out', 'slide_in_out', 'doc_reveal'])
      const animate = animateAllowed.has(animateRaw) ? animateRaw : 'none'
      const animateForX = animate === 'doc_reveal' ? 'slide_in_out' : animate
      let pos = posRaw
      if (animateForX !== 'none') {
        if (posRaw.includes('top')) pos = 'top_center'
        else if (posRaw.includes('bottom')) pos = 'bottom_center'
        else pos = 'middle_center'
      }
      const xy = overlayXYForPositionPx(pos, insetXPx, insetYPx)
      let xExpr = xy.x
      if (animateForX !== 'none') {
        const segStart = Number(g.startSeconds)
        const segEnd = Number(g.endSeconds)
        const segDur = Math.max(0, segEnd - segStart)
        const segMs = Math.max(0, Math.round(segDur * 1000))
        let animateDurationMs = Number.isFinite(Number(g.animateDurationMs)) ? Math.round(Number(g.animateDurationMs)) : 600
        animateDurationMs = Math.round(clamp(animateDurationMs, 100, 2000))
        const maxAnimMs = segMs > 0 ? Math.round(segMs * 0.45) : 0
        if (maxAnimMs > 0) animateDurationMs = Math.min(animateDurationMs, maxAnimMs)
        const animDur = segDur > 0 ? Math.min(segDur, animateDurationMs / 1000) : 0
        if (animDur > 0) {
          const inEnd = segStart + animDur
          const outStart = Math.max(segStart, segEnd - animDur)
          const offExpr = '((main_w+overlay_w)/2+20)'
          const baseX = `(${xy.x})`
          const inProgress = `((t-${segStart.toFixed(3)})/${animDur.toFixed(3)})`
          const outProgress = `((t-${outStart.toFixed(3)})/${animDur.toFixed(3)})`
          const inExpr = `${baseX}-${offExpr}+${offExpr}*(1-pow(1-(${inProgress}),3))`
          const outExpr = `${baseX}+${offExpr}*pow(${outProgress},3)`
          if (animateForX === 'slide_in_out') {
            xExpr = `if(gte(t,${outStart.toFixed(3)}),${outExpr},if(lte(t,${inEnd.toFixed(3)}),${inExpr},${baseX}))`
          } else if (animateForX === 'slide_in') {
            xExpr = `if(lte(t,${inEnd.toFixed(3)}),${inExpr},${baseX})`
          } else if (animateForX === 'slide_out') {
            xExpr = `if(gte(t,${outStart.toFixed(3)}),${outExpr},${baseX})`
          }
        }
      }
      const xExprSafe = xExpr.replace(/,/g, '\\,')
      filters.push(`${current}[img${i}src]overlay=${xExprSafe}:${xy.y}:eof_action=repeat:enable='gte(t,${sStr})*lt(t,${eStr})'${next}`)
    } else {
      filters.push(`${current}[img${i}src]overlay=0:0:eof_action=repeat:enable='gte(t,${sStr})*lt(t,${eStr})'${next}`)
    }
    current = next
  }

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    current,
    '-map',
    '0:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    opts.outPath
  )

  await runFfmpeg(args, opts.logPaths)
}

async function overlayNarrationVisualizers(opts: {
  baseMp4Path: string
  outPath: string
  visuals: Array<{
    audioPath: string
    startSeconds: number
    endSeconds: number
    sourceStartSeconds: number
    visualizer: {
      style: 'wave_line' | 'wave_fill' | 'spectrum_bars'
      fgColor: string
      bgColor: string | 'transparent'
      opacity: number
      scale: 'linear' | 'log'
    }
  }>
  targetW: number
  targetH: number
  durationSeconds: number
  logPaths?: FfmpegLogPaths
}) {
  const baseDur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!opts.visuals.length) throw new Error('no_visuals')

  const args: string[] = ['-i', opts.baseMp4Path]
  for (const v of opts.visuals) {
    args.push('-i', v.audioPath)
  }

  const filters: string[] = []
  let current = '[0:v]'

  for (let i = 0; i < opts.visuals.length; i++) {
    const v = opts.visuals[i]
    const inIdx = i + 1
    const start = clamp(roundToTenth(Number(v.startSeconds)), 0, baseDur)
    const end = clamp(roundToTenth(Number(v.endSeconds)), 0, baseDur)
    const segDur = Math.max(0, end - start)
    if (!(segDur > 0.05)) continue
    const srcStart = clamp(roundToTenth(Number(v.sourceStartSeconds || 0)), 0, 20 * 60)
    const srcEnd = roundToTenth(srcStart + segDur)
    const delayMs = Math.max(0, Math.round(start * 1000))
    const fg = hexToFfmpegColor(v.visualizer.fgColor)
    const bg = v.visualizer.bgColor === 'transparent' ? 'black@0' : hexToFfmpegColor(v.visualizer.bgColor)
    const opacity = Math.max(0, Math.min(1, Number(v.visualizer.opacity || 1)))
    const scale = v.visualizer.scale === 'log' ? 'log' : 'lin'
    const show =
      v.visualizer.style === 'spectrum_bars'
        ? `showspectrum=s=${opts.targetW}x${opts.targetH}:mode=combined:color=${fg}:scale=${scale}`
        : v.visualizer.style === 'wave_fill'
          ? `showwaves=s=${opts.targetW}x${opts.targetH}:mode=p2p:rate=30:colors=${fg}`
          : `showwaves=s=${opts.targetW}x${opts.targetH}:mode=line:rate=30:colors=${fg}`

    filters.push(
      `[${inIdx}:a]atrim=start=${srcStart.toFixed(3)}:end=${srcEnd.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs},apad=pad_dur=${baseDur}[a${i}]`
    )
    filters.push(`[a${i}]${show},format=rgba,colorkey=0x000000:0.1:0.0[vw${i}]`)
    filters.push(`color=c=${bg}:s=${opts.targetW}x${opts.targetH}:d=${baseDur}[bg${i}]`)
    filters.push(`[bg${i}][vw${i}]overlay=format=auto,format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[vis${i}]`)

    const next = `[v${i + 1}]`
    const sStr = start.toFixed(3)
    const eStr = Math.min(baseDur, end + 0.05).toFixed(3)
    filters.push(`${current}[vis${i}]overlay=0:0:format=auto:enable='gte(t,${sStr})*lt(t,${eStr})'${next}`)
    current = next
  }

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    current,
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    opts.outPath
  )

  await runFfmpeg(args, opts.logPaths)
}

function overlayXYForPosition(position: string): { x: string; y: string } {
  const insetX = '(main_w*0.02)'
  const insetY = '(main_h*0.02)'
  switch (String(position || 'bottom_right')) {
    case 'top_left':
      return { x: insetX, y: insetY }
    case 'top_center':
      return { x: '(main_w-overlay_w)/2', y: insetY }
    case 'top_right':
      return { x: `main_w-overlay_w-${insetX}`, y: insetY }
    case 'middle_left':
      return { x: insetX, y: '(main_h-overlay_h)/2' }
    case 'middle_center':
      return { x: '(main_w-overlay_w)/2', y: '(main_h-overlay_h)/2' }
    case 'middle_right':
      return { x: `main_w-overlay_w-${insetX}`, y: '(main_h-overlay_h)/2' }
    case 'bottom_left':
      return { x: insetX, y: `main_h-overlay_h-${insetY}` }
    case 'bottom_center':
      return { x: '(main_w-overlay_w)/2', y: `main_h-overlay_h-${insetY}` }
    case 'bottom_right':
    default:
      return { x: `main_w-overlay_w-${insetX}`, y: `main_h-overlay_h-${insetY}` }
  }
}

function overlayXYForPositionWithPad(position: string, padPx: number): { x: string; y: string } {
  const insetX = '(main_w*0.02)'
  const insetY = '(main_h*0.02)'
  const pad = Math.max(0, Math.round(padPx || 0))
  const padAdd = pad > 0 ? `+${pad}` : ''
  const padSub = pad > 0 ? `-${pad}` : ''
  switch (String(position || 'bottom_right')) {
    case 'top_left':
      return { x: `${insetX}${padSub}`, y: `${insetY}${padSub}` }
    case 'top_center':
      return { x: '(main_w-overlay_w)/2', y: `${insetY}${padSub}` }
    case 'top_right':
      return { x: `main_w-overlay_w-${insetX}${padAdd}`, y: `${insetY}${padSub}` }
    case 'middle_left':
      return { x: `${insetX}${padSub}`, y: '(main_h-overlay_h)/2' }
    case 'middle_center':
      return { x: '(main_w-overlay_w)/2', y: '(main_h-overlay_h)/2' }
    case 'middle_right':
      return { x: `main_w-overlay_w-${insetX}${padAdd}`, y: '(main_h-overlay_h)/2' }
    case 'bottom_left':
      return { x: `${insetX}${padSub}`, y: `main_h-overlay_h-${insetY}${padAdd}` }
    case 'bottom_center':
      return { x: '(main_w-overlay_w)/2', y: `main_h-overlay_h-${insetY}${padAdd}` }
    case 'bottom_right':
    default:
      return { x: `main_w-overlay_w-${insetX}${padAdd}`, y: `main_h-overlay_h-${insetY}${padAdd}` }
  }
}

async function overlayVideoOverlays(opts: {
  baseMp4Path: string
  outPath: string
  overlays: Array<{
    startSeconds: number
    endSeconds: number
    inPath: string
    sourceStartSeconds: number
    sourceEndSeconds: number
    sizePctWidth: number
    position: string
    audioEnabled: boolean
    boostDb?: number
    plateStyle?: 'none' | 'thin' | 'medium' | 'thick' | 'band'
    plateColor?: string
    plateOpacityPct?: number
  }>
  targetW: number
  targetH: number
  durationSeconds: number
  logPaths?: FfmpegLogPaths
}) {
  const baseDur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!opts.overlays.length) throw new Error('no_video_overlays')

  const overlays = opts.overlays
    .slice()
    .map((o) => ({
      ...o,
      startSeconds: roundToTenth(Math.max(0, Number(o.startSeconds || 0))),
      endSeconds: roundToTenth(Math.max(0, Number(o.endSeconds || 0))),
      sourceStartSeconds: roundToTenth(Math.max(0, Number(o.sourceStartSeconds || 0))),
      sourceEndSeconds: roundToTenth(Math.max(0, Number(o.sourceEndSeconds || 0))),
    }))
    .filter((o) => o.endSeconds > o.startSeconds + 0.05 && o.sourceEndSeconds > o.sourceStartSeconds + 0.05)
    .sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds))

  const args: string[] = ['-i', opts.baseMp4Path]
  for (const o of overlays) args.push('-i', o.inPath)

  const filters: string[] = []
  let currentV = '[0:v]'
  const audioLabels: string[] = []
  const dimsCache = new Map<string, { width: number; height: number }>()

  for (let i = 0; i < overlays.length; i++) {
    const inIdx = i + 1
    const o = overlays[i]
    const start = o.startSeconds
    const end = o.endSeconds
    const srcStart = o.sourceStartSeconds
    const srcEnd = o.sourceEndSeconds
    const duration = roundToTenth(Math.max(0, srcEnd - srcStart))
    const expected = roundToTenth(Math.max(0, end - start))
    // Prefer the timeline window length; treat sourceEndSeconds as the authoritative trim.
    const effectiveDuration = expected > 0.05 ? expected : duration
    const effectiveEnd = roundToTenth(start + effectiveDuration)

    const pct = Math.max(10, Math.min(100, Math.round(Number(o.sizePctWidth || 40))))
    const boxW = even((opts.targetW * pct) / 100)
    let boxH = even((opts.targetH * pct) / 100)
    try {
      const key = String(o.inPath)
      let dims = dimsCache.get(key)
      if (!dims) {
        dims = await probeVideoDisplayDimensions(o.inPath)
        dimsCache.set(key, dims)
      }
      if (dims && Number.isFinite(dims.width) && Number.isFinite(dims.height) && dims.width > 0 && dims.height > 0) {
        boxH = even((boxW * dims.height) / dims.width)
      }
    } catch {}
    const { x, y } = overlayXYForPosition(o.position)

    const plateStyleRaw = String(o.plateStyle || 'none').toLowerCase()
    const plateStyleAllowed = new Set(['none', 'thin', 'medium', 'thick', 'band'])
    const plateStyle = plateStyleAllowed.has(plateStyleRaw) ? plateStyleRaw : 'none'

    filters.push(
      `[${inIdx}:v]trim=start=${srcStart.toFixed(3)}:end=${srcEnd.toFixed(3)},setpts=PTS-STARTPTS+${start.toFixed(3)}/TB,scale=${boxW}:-2:force_original_aspect_ratio=decrease[ov${i}]`
    )
    let baseUnderOverlay = currentV
    if (plateStyle !== 'none') {
      const plateOpacity = Math.max(0, Math.min(1, Number(o.plateOpacityPct ?? 85) / 100))
      const plateColorRaw = String(o.plateColor || '#000000').trim()
      const plateHex = /^#?[0-9a-fA-F]{6}$/.test(plateColorRaw)
        ? (plateColorRaw.startsWith('#') ? plateColorRaw.slice(1) : plateColorRaw)
        : '000000'
      const plateColor = `0x${plateHex}`
      const pad =
        plateStyle === 'thin' ? 4 :
        plateStyle === 'medium' ? 12 :
        plateStyle === 'thick' ? 30 : 0
      const frameW = plateStyle === 'band' ? even(opts.targetW) : even(boxW + pad * 2)
      const frameH = plateStyle === 'band' ? even(boxH + 80) : even(boxH + pad * 2)
      const frameInsetX = '(iw*0.02)'
      const frameInsetY = '(ih*0.02)'
      const framePos =
        plateStyle === 'band'
          ? (() => {
              const pos = String(o.position || 'bottom_right')
              if (pos.startsWith('top_')) return { x: '0', y: '0' }
              if (pos.startsWith('bottom_')) return { x: '0', y: `ih-${frameH}` }
              return { x: '0', y: `(ih-${frameH})/2` }
            })()
          : (() => {
              const pos = String(o.position || 'bottom_right')
              const padAdd = pad > 0 ? `+${pad}` : ''
              const padSub = pad > 0 ? `-${pad}` : ''
              switch (pos) {
                case 'top_left':
                  return { x: `${frameInsetX}${padSub}`, y: `${frameInsetY}${padSub}` }
                case 'top_center':
                  return { x: `(iw-${frameW})/2`, y: `${frameInsetY}${padSub}` }
                case 'top_right':
                  return { x: `iw-${frameW}-${frameInsetX}${padAdd}`, y: `${frameInsetY}${padSub}` }
                case 'middle_left':
                  return { x: `${frameInsetX}${padSub}`, y: `(ih-${frameH})/2` }
                case 'middle_center':
                  return { x: `(iw-${frameW})/2`, y: `(ih-${frameH})/2` }
                case 'middle_right':
                  return { x: `iw-${frameW}-${frameInsetX}${padAdd}`, y: `(ih-${frameH})/2` }
                case 'bottom_left':
                  return { x: `${frameInsetX}${padSub}`, y: `ih-${frameH}-${frameInsetY}${padAdd}` }
                case 'bottom_center':
                  return { x: `(iw-${frameW})/2`, y: `ih-${frameH}-${frameInsetY}${padAdd}` }
                case 'bottom_right':
                default:
                  return { x: `iw-${frameW}-${frameInsetX}${padAdd}`, y: `ih-${frameH}-${frameInsetY}${padAdd}` }
              }
            })()
      const thickness = plateStyle === 'band' ? 'fill' : String(pad)
      const plateLayer = `[vop${i}]`
      filters.push(
        `${currentV}drawbox=x=${framePos.x}:y=${framePos.y}:w=${frameW}:h=${frameH}:color=${plateColor}@${plateOpacity.toFixed(3)}:t=${thickness}:enable='between(t,${start.toFixed(3)},${effectiveEnd.toFixed(3)})'${plateLayer}`
      )
      baseUnderOverlay = plateLayer
    }
    const nextV = `[vov${i + 1}]`
    filters.push(
      `${baseUnderOverlay}[ov${i}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${start.toFixed(3)},${effectiveEnd.toFixed(3)})'${nextV}`
    )
    currentV = nextV

    if (o.audioEnabled) {
      const hasAudio = await hasAudioStream(o.inPath)
      if (hasAudio) {
        const delayMs = Math.max(0, Math.round(start * 1000))
        const delay = delayMs > 0 ? `,adelay=${delayMs}:all=1` : ''
        const boostRaw = o.boostDb == null ? 0 : Number(o.boostDb)
        const boostAllowed = new Set([0, 3, 6, 9])
        const boostDb = Number.isFinite(boostRaw) && boostAllowed.has(Math.round(boostRaw)) ? Math.round(boostRaw) : 0
        const boostFilter = boostDb !== 0 ? `,volume=${boostDb}dB` : ''
        const label = `ova${i}`
        filters.push(
          `[${inIdx}:a]atrim=start=${srcStart.toFixed(3)}:end=${srcEnd.toFixed(3)},asetpts=N/SR/TB${delay}${boostFilter},apad[${label}]`
        )
        audioLabels.push(`[${label}]`)
      }
    }
  }

  if (!audioLabels.length) {
    filters.push('[0:a]anull[aout]')
  } else {
    filters.push(`[0:a]apad[abase]`)
    const mixInputs = ['[abase]', ...audioLabels].join('')
    const mixCount = 1 + audioLabels.length
    filters.push(
      `${mixInputs}amix=inputs=${mixCount}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98[aout]`
    )
  }

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    currentV,
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    opts.outPath
  )
  // Preserve the base duration; overlays should not extend output beyond base.
  if (baseDur > 0.05) args.splice(args.length - 1, 0, '-t', String(baseDur))

  await runFfmpeg(args, opts.logPaths)
}

async function overlayVideoOverlayStills(opts: {
  baseMp4Path: string
  outPath: string
  stills: Array<{
    startSeconds: number
    endSeconds: number
    imagePath: string
    sizePctWidth: number
    position: string
  }>
  targetW: number
  targetH: number
  durationSeconds: number
  logPaths?: FfmpegLogPaths
}) {
  const baseDur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!opts.stills.length) throw new Error('no_video_overlay_stills')

  const stills = opts.stills
    .slice()
    .map((s) => ({
      ...s,
      startSeconds: roundToTenth(Math.max(0, Number(s.startSeconds || 0))),
      endSeconds: roundToTenth(Math.max(0, Number(s.endSeconds || 0))),
    }))
    .filter((s) => s.endSeconds > s.startSeconds + 0.05)
    .sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds))

  const args: string[] = ['-i', opts.baseMp4Path]
  for (const st of stills) {
    // Loop the still image so it can be enabled for its time window.
    args.push('-loop', '1', '-t', String(baseDur), '-i', st.imagePath)
  }

  const filters: string[] = []
  let currentV = '[0:v]'
  for (let i = 0; i < stills.length; i++) {
    const inIdx = i + 1
    const seg = stills[i]
    const s = Number(seg.startSeconds)
    const e = Number(seg.endSeconds) + 1 / 30

    const pct = Math.max(10, Math.min(100, Math.round(Number(seg.sizePctWidth || 40))))
    const boxW = even((opts.targetW * pct) / 100)

    filters.push(`[${inIdx}:v]scale=${boxW}:-2:force_original_aspect_ratio=decrease,format=rgba[ovst${i}]`)
    const { x, y } = overlayXYForPosition(seg.position)
    const next = `[vost${i + 1}]`
    filters.push(`${currentV}[ovst${i}]overlay=x=${x}:y=${y}:enable='between(t,${s.toFixed(3)},${e.toFixed(3)})'${next}`)
    currentV = next
  }

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    currentV,
    '-map',
    '0:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    opts.outPath
  )
  if (baseDur > 0.05) args.splice(args.length - 1, 0, '-t', String(baseDur))

  await runFfmpeg(args, opts.logPaths)
}

async function overlayFullFrameScreenTitles(opts: {
  baseMp4Path: string
  outPath: string
  screenTitles: Array<{ startSeconds: number; endSeconds: number; imagePath: string; fade: 'none' | 'in' | 'out' | 'in_out' }>
  targetW: number
  targetH: number
  durationSeconds: number
  logPaths?: FfmpegLogPaths
}) {
  const baseDur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!opts.screenTitles.length) throw new Error('no_screen_titles')

  const args: string[] = ['-i', opts.baseMp4Path]
  for (const st of opts.screenTitles) {
    args.push('-loop', '1', '-t', String(baseDur), '-i', st.imagePath)
  }

  const filters: string[] = []
  for (let i = 0; i < opts.screenTitles.length; i++) {
    const inIdx = i + 1
    const seg = opts.screenTitles[i]
    const s = roundToTenth(Number(seg.startSeconds))
    const e = roundToTenth(Number(seg.endSeconds))
    const segDur = Math.max(0, e - s)
    const fadeBase = 0.35
    const fadeDur = Math.max(0.05, Math.min(fadeBase, segDur / 2))
    const fadeIn = seg.fade === 'in' || seg.fade === 'in_out'
    const fadeOut = seg.fade === 'out' || seg.fade === 'in_out'
    const fadeFilters: string[] = []
    if (fadeIn && segDur > 0.05) fadeFilters.push(`fade=t=in:st=${s.toFixed(3)}:d=${fadeDur.toFixed(3)}:alpha=1`)
    if (fadeOut && segDur > 0.05) {
      const outStart = Math.max(0, e - fadeDur)
      fadeFilters.push(`fade=t=out:st=${outStart.toFixed(3)}:d=${fadeDur.toFixed(3)}:alpha=1`)
    }
    const fadeSuffix = fadeFilters.length ? `,${fadeFilters.join(',')}` : ''
    filters.push(
      `[${inIdx}:v]scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=increase,crop=${opts.targetW}:${opts.targetH},format=rgba${fadeSuffix}[stimg${i}]`
    )
  }

  let current = '[0:v]'
  for (let i = 0; i < opts.screenTitles.length; i++) {
    const seg = opts.screenTitles[i]
    const s = roundToTenth(Number(seg.startSeconds))
    const e = roundToTenth(Number(seg.endSeconds))
    const next = `[vst${i + 1}]`
    filters.push(`${current}[stimg${i}]overlay=0:0:enable='between(t,${s.toFixed(3)},${e.toFixed(3)})'${next}`)
    current = next
  }

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    current,
    '-map',
    '0:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    opts.outPath
  )

  await runFfmpeg(args, opts.logPaths)
}

async function renderSegmentMp4(opts: {
  inPath: string
  outPath: string
  startSeconds: number
  endSeconds: number
  audioEnabled?: boolean
  boostDb?: number
  bgFillStyle?: 'none' | 'blur' | 'color' | 'image'
  bgFillBrightness?: 'light3' | 'light2' | 'light1' | 'neutral' | 'dim1' | 'dim2' | 'dim3'
  bgFillDim?: 'light' | 'medium' | 'strong'
  bgFillBlur?: 'soft' | 'medium' | 'strong' | 'very_strong'
  bgFillColor?: string
  bgFillImagePath?: string | null
  timelineBackgroundMode?: 'none' | 'color' | 'image'
  timelineBackgroundColor?: string
  timelineBackgroundImagePath?: string | null
  sourceDims?: { width: number; height: number }
  freezeStartSeconds?: number
  freezeEndSeconds?: number
  targetW: number
  targetH: number
  fps: number
  logPaths?: FfmpegLogPaths
}) {
  const start = roundToTenth(Math.max(0, Number(opts.startSeconds)))
  const end = roundToTenth(Math.max(0, Number(opts.endSeconds)))
  if (!(end > start)) throw new Error('invalid_segment_range')
  const freezeStart = roundToTenth(Math.max(0, Number(opts.freezeStartSeconds || 0)))
  const freezeEnd = roundToTenth(Math.max(0, Number(opts.freezeEndSeconds || 0)))
  const dur = roundToTenth(end - start)
  const totalDur = roundToTenth(dur + freezeStart + freezeEnd)
  const fps = Math.max(15, Math.min(60, Math.round(Number(opts.fps || 30))))
  const hasAudio = await hasAudioStream(opts.inPath)
  const audioEnabled = opts.audioEnabled !== false

  const timelineBackgroundModeRaw = String(opts.timelineBackgroundMode || 'none').trim().toLowerCase()
  const timelineBackgroundMode = timelineBackgroundModeRaw === 'color' ? 'color' : timelineBackgroundModeRaw === 'image' ? 'image' : 'none'
  const timelineBackgroundColor = normalizeFfmpegColor(normalizeHexColor(opts.timelineBackgroundColor, '#000000'))
  const timelineBackgroundImagePath =
    timelineBackgroundMode === 'image' && opts.timelineBackgroundImagePath ? String(opts.timelineBackgroundImagePath) : ''
  const bgFillStyleRaw = String(opts.bgFillStyle || 'none').trim().toLowerCase()
  const bgFillStyle = bgFillStyleRaw === 'blur' ? 'blur' : bgFillStyleRaw === 'color' ? 'color' : bgFillStyleRaw === 'image' ? 'image' : 'none'
  const bgFillColor = normalizeFfmpegColor(normalizeHexColor(opts.bgFillColor, '#000000'))
  const bgFillImagePath = bgFillStyle === 'image' && opts.bgFillImagePath ? String(opts.bgFillImagePath) : ''
  const bgFillBrightnessRaw = String(opts.bgFillBrightness || '').toLowerCase()
  const bgFillBrightness = bgFillBrightnessRaw === 'light3'
    ? 'light3'
    : bgFillBrightnessRaw === 'light2'
      ? 'light2'
      : bgFillBrightnessRaw === 'light1'
        ? 'light1'
        : bgFillBrightnessRaw === 'dim1'
          ? 'dim1'
          : bgFillBrightnessRaw === 'dim3'
            ? 'dim3'
            : bgFillBrightnessRaw === 'dim2'
              ? 'dim2'
              : bgFillBrightnessRaw === 'neutral'
                ? 'neutral'
                : ''
  const bgFillDimRaw = String(opts.bgFillDim || '').toLowerCase()
  const legacyBrightness = bgFillDimRaw === 'light'
    ? 'light1'
    : bgFillDimRaw === 'strong'
      ? 'dim3'
      : bgFillDimRaw === 'medium'
        ? 'dim2'
        : 'neutral'
  const resolvedBrightness = bgFillBrightness || legacyBrightness
  const bgFillBlurRaw = String(opts.bgFillBlur || 'medium').toLowerCase()
  const bgFillBlur = bgFillBlurRaw === 'soft'
    ? 'soft'
    : bgFillBlurRaw === 'strong'
      ? 'strong'
      : bgFillBlurRaw === 'very_strong'
        ? 'very_strong'
        : 'medium'
  let sourceDims = opts.sourceDims
  if (!sourceDims || !(Number.isFinite(sourceDims.width) && Number.isFinite(sourceDims.height) && sourceDims.width > 0 && sourceDims.height > 0)) {
    try {
      const dims = await probeVideoDisplayDimensions(opts.inPath)
      sourceDims = { width: dims.width, height: dims.height }
    } catch {}
  }
  const sourceIsLandscape = !!(sourceDims && sourceDims.width > sourceDims.height)
  const targetIsPortrait = opts.targetH >= opts.targetW
  const useBgFill = bgFillStyle === 'blur' && sourceIsLandscape && targetIsPortrait
  const useClipBackgroundColor = bgFillStyle === 'color'
  const effectiveBackgroundImagePath = useBgFill || useClipBackgroundColor ? '' : bgFillImagePath || timelineBackgroundImagePath
  const useEffectiveBackgroundImage = !!effectiveBackgroundImagePath
  const padColor = useClipBackgroundColor ? bgFillColor : timelineBackgroundMode === 'color' ? timelineBackgroundColor : 'black'
  const scalePad = `scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=decrease,pad=${opts.targetW}:${opts.targetH}:(ow-iw)/2:(oh-ih)/2:color=${padColor}`
  const tpad = freezeStart > 0.01 || freezeEnd > 0.01
    ? `,tpad=start_mode=clone:start_duration=${freezeStart.toFixed(3)}:stop_mode=clone:stop_duration=${freezeEnd.toFixed(3)}`
    : ''
  let v = `trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${scalePad},fps=${fps},format=yuv420p${tpad}`
  if (useBgFill) {
    const blurSigma = bgFillBlur === 'soft' ? 12 : bgFillBlur === 'strong' ? 60 : bgFillBlur === 'very_strong' ? 80 : 32
    const brightness = resolvedBrightness === 'light3'
      ? 0.24
      : resolvedBrightness === 'light2'
        ? 0.16
        : resolvedBrightness === 'light1'
          ? 0.04
          : resolvedBrightness === 'dim1'
            ? -0.06
            : resolvedBrightness === 'dim3'
              ? -0.36
              : resolvedBrightness === 'dim2'
                ? -0.24
                : 0
    const fg = `scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=decrease`
    const bg = `scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=increase,crop=${opts.targetW}:${opts.targetH},gblur=sigma=${blurSigma},eq=brightness=${brightness}:saturation=0.9`
    v = `trim=start=${start}:end=${end},setpts=PTS-STARTPTS,split=2[fg][bg];` +
      `[bg]${bg}[bgf];` +
      `[fg]${fg}[fgf];` +
      `[bgf][fgf]overlay=(W-w)/2:(H-h)/2,fps=${fps},format=yuv420p${tpad}`
  }

  const delayMs = Math.max(0, Math.round(freezeStart * 1000))
  const delay = delayMs > 0 ? `,adelay=${delayMs}:all=1` : ''
  const boostRaw = opts.boostDb == null ? 0 : Number(opts.boostDb)
  const boostAllowed = new Set([0, 3, 6, 9])
  const boostDb = Number.isFinite(boostRaw) && boostAllowed.has(Math.round(boostRaw)) ? Math.round(boostRaw) : 0
  const boostFilter = boostDb !== 0 ? `,volume=${boostDb}dB` : ''
  const a = hasAudio && audioEnabled
    ? `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS${delay}${boostFilter},apad,atrim=0:${totalDur.toFixed(3)},asetpts=N/SR/TB`
    : `anullsrc=r=48000:cl=stereo,atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS`
  let filterComplex = `[0:v]${v}[v];${a}[a]`
  const ffmpegArgs: string[] = ['-i', opts.inPath]
  if (useEffectiveBackgroundImage) {
    const bgDur = Math.max(0.1, totalDur)
    ffmpegArgs.push('-loop', '1', '-t', String(bgDur), '-i', effectiveBackgroundImagePath)
    const fg = `trim=start=${start}:end=${end},setpts=PTS-STARTPTS,scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=decrease,fps=${fps},format=yuv420p${tpad}`
    const bg = `scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=increase,crop=${opts.targetW}:${opts.targetH},fps=${fps},format=yuv420p`
    filterComplex = `[0:v]${fg}[fg];[1:v]${bg}[bg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[v];${a}[a]`
  }

  await runFfmpeg(
    [
      ...ffmpegArgs,
      '-filter_complex',
      filterComplex,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      opts.outPath,
    ],
    opts.logPaths
  )
}

async function renderStillSegmentMp4(opts: {
  imagePath: string
  outPath: string
  durationSeconds: number
  bgFillStyle?: 'none' | 'blur' | 'color' | 'image'
  bgFillBrightness?: 'light3' | 'light2' | 'light1' | 'neutral' | 'dim1' | 'dim2' | 'dim3'
  bgFillDim?: 'light' | 'medium' | 'strong'
  bgFillBlur?: 'soft' | 'medium' | 'strong' | 'very_strong'
  bgFillColor?: string
  bgFillImagePath?: string | null
  timelineBackgroundMode?: 'none' | 'color' | 'image'
  timelineBackgroundColor?: string
  timelineBackgroundImagePath?: string | null
  sourceDims?: { width: number; height: number }
  targetW: number
  targetH: number
  fps: number
  logPaths?: FfmpegLogPaths
}) {
  const dur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!(dur > 0.05)) throw new Error('invalid_still_duration')
  const fps = Math.max(15, Math.min(60, Math.round(Number(opts.fps || 30))))
  const timelineBackgroundModeRaw = String(opts.timelineBackgroundMode || 'none').trim().toLowerCase()
  const timelineBackgroundMode = timelineBackgroundModeRaw === 'color' ? 'color' : timelineBackgroundModeRaw === 'image' ? 'image' : 'none'
  const timelineBackgroundColor = normalizeFfmpegColor(normalizeHexColor(opts.timelineBackgroundColor, '#000000'))
  const timelineBackgroundImagePath =
    timelineBackgroundMode === 'image' && opts.timelineBackgroundImagePath ? String(opts.timelineBackgroundImagePath) : ''

  const bgFillStyleRaw = String(opts.bgFillStyle || 'none').trim().toLowerCase()
  const bgFillStyle = bgFillStyleRaw === 'blur' ? 'blur' : bgFillStyleRaw === 'color' ? 'color' : bgFillStyleRaw === 'image' ? 'image' : 'none'
  const bgFillColor = normalizeFfmpegColor(normalizeHexColor(opts.bgFillColor, '#000000'))
  const bgFillImagePath = bgFillStyle === 'image' && opts.bgFillImagePath ? String(opts.bgFillImagePath) : ''
  const bgFillBrightnessRaw = String(opts.bgFillBrightness || '').toLowerCase()
  const bgFillBrightness = bgFillBrightnessRaw === 'light3'
    ? 'light3'
    : bgFillBrightnessRaw === 'light2'
      ? 'light2'
      : bgFillBrightnessRaw === 'light1'
        ? 'light1'
        : bgFillBrightnessRaw === 'dim1'
          ? 'dim1'
          : bgFillBrightnessRaw === 'dim3'
            ? 'dim3'
            : bgFillBrightnessRaw === 'dim2'
              ? 'dim2'
              : bgFillBrightnessRaw === 'neutral'
                ? 'neutral'
                : ''
  const bgFillDimRaw = String(opts.bgFillDim || '').toLowerCase()
  const legacyBrightness = bgFillDimRaw === 'light'
    ? 'light1'
    : bgFillDimRaw === 'strong'
      ? 'dim3'
      : bgFillDimRaw === 'medium'
        ? 'dim2'
        : 'neutral'
  const resolvedBrightness = bgFillBrightness || legacyBrightness
  const bgFillBlurRaw = String(opts.bgFillBlur || 'medium').toLowerCase()
  const bgFillBlur = bgFillBlurRaw === 'soft'
    ? 'soft'
    : bgFillBlurRaw === 'strong'
      ? 'strong'
      : bgFillBlurRaw === 'very_strong'
        ? 'very_strong'
        : 'medium'
  let sourceDims = opts.sourceDims
  if (!sourceDims || !(Number.isFinite(sourceDims.width) && Number.isFinite(sourceDims.height) && sourceDims.width > 0 && sourceDims.height > 0)) {
    try {
      const dims = await probeVideoDisplayDimensions(opts.imagePath)
      sourceDims = { width: dims.width, height: dims.height }
    } catch {}
  }
  const sourceIsLandscape = !!(sourceDims && sourceDims.width > sourceDims.height)
  const targetIsPortrait = opts.targetH >= opts.targetW
  const useBgFill = bgFillStyle === 'blur' && sourceIsLandscape && targetIsPortrait
  const useClipBackgroundColor = bgFillStyle === 'color'
  const effectiveBackgroundImagePath = useBgFill || useClipBackgroundColor ? '' : bgFillImagePath || timelineBackgroundImagePath
  const useEffectiveBackgroundImage = !!effectiveBackgroundImagePath
  const padColor = useClipBackgroundColor ? bgFillColor : timelineBackgroundMode === 'color' ? timelineBackgroundColor : 'black'

  // Match clip rendering default behavior: preserve source frame (contain) when blur fill is off.
  let v = `scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=decrease,pad=${opts.targetW}:${opts.targetH}:(ow-iw)/2:(oh-ih)/2:color=${padColor},fps=${fps},format=yuv420p`
  if (useBgFill) {
    const blurSigma = bgFillBlur === 'soft' ? 12 : bgFillBlur === 'strong' ? 60 : bgFillBlur === 'very_strong' ? 80 : 32
    const brightness = resolvedBrightness === 'light3'
      ? 0.24
      : resolvedBrightness === 'light2'
        ? 0.16
        : resolvedBrightness === 'light1'
          ? 0.04
          : resolvedBrightness === 'dim1'
            ? -0.06
            : resolvedBrightness === 'dim3'
              ? -0.36
              : resolvedBrightness === 'dim2'
                ? -0.24
                : 0
    const fg = `scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=decrease`
    const bg = `scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=increase,crop=${opts.targetW}:${opts.targetH},gblur=sigma=${blurSigma},eq=brightness=${brightness}:saturation=0.9`
    v = `split=2[fg][bg];` +
      `[bg]${bg}[bgf];` +
      `[fg]${fg}[fgf];` +
      `[bgf][fgf]overlay=(W-w)/2:(H-h)/2,fps=${fps},format=yuv420p`
  }
  const ffmpegArgs: string[] = [
    '-loop',
    '1',
    '-t',
    String(dur),
    '-i',
    opts.imagePath,
  ]
  if (useEffectiveBackgroundImage) {
    ffmpegArgs.push(
      '-loop',
      '1',
      '-t',
      String(dur),
      '-i',
      effectiveBackgroundImagePath
    )
  }
  ffmpegArgs.push(
    '-f',
    'lavfi',
    '-t',
    String(dur),
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-shortest'
  )
  const filterComplex = useEffectiveBackgroundImage
    ? `[0:v]scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=decrease,fps=${fps},format=yuv420p[fg];` +
      `[1:v]scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=increase,crop=${opts.targetW}:${opts.targetH},fps=${fps},format=yuv420p[bg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`
    : `[0:v]${v}[v]`
  const audioMap = useEffectiveBackgroundImage ? '2:a:0' : '1:a:0'
  await runFfmpeg(
    [
      ...ffmpegArgs,
      '-filter_complex',
      filterComplex,
      '-map',
      '[v]',
      '-map',
      audioMap,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      opts.outPath,
    ],
    opts.logPaths
  )
}

async function insertGeneratedUpload(input: {
  userId: number
  projectId: number
  bucket: string
  key: string
  sizeBytes: number
  width: number
  height: number
  durationSeconds: number | null
  assetUuid: string
  dateYmd: string
}): Promise<number> {
  const db = getPool()
  // This environment has kind/user_id columns; keep the insert simple.
  const [result] = await db.query(
    `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status, kind, user_id, video_role, create_video_project_id, uploaded_at)
     VALUES (?, ?, 'video.mp4', NULL, NULL, 'video/mp4', ?, ?, ?, ?, ?, ?, 'completed', 'video', ?, 'export', ?, CURRENT_TIMESTAMP)`,
    [input.bucket, input.key, input.sizeBytes, input.width, input.height, input.durationSeconds, input.assetUuid, input.dateYmd, input.userId, input.projectId]
  )
  return Number((result as any).insertId)
}

export async function runCreateVideoExportV1Job(
  input: CreateVideoExportV1Input,
  logPaths?: FfmpegLogPaths
): Promise<{ resultUploadId: number; output: { bucket: string; key: string; s3Url: string }; ffmpegCommands?: string[]; metricsInput?: any }> {
  const ffmpegCommands: string[] = []
  logPaths = { ...(logPaths || {}), commandLog: ffmpegCommands }
  const userId = Number(input.userId)
  const clips = Array.isArray(input.timeline?.clips) ? input.timeline.clips : []
  const stills = Array.isArray((input.timeline as any)?.stills) ? ((input.timeline as any).stills as Still[]) : []
  const videoOverlaysRaw = Array.isArray((input.timeline as any)?.videoOverlays) ? ((input.timeline as any).videoOverlays as any[]) : []
  const videoOverlayStillsRaw = Array.isArray((input.timeline as any)?.videoOverlayStills) ? ((input.timeline as any).videoOverlayStills as any[]) : []
  const videoOverlays: VideoOverlay[] = videoOverlaysRaw
    .map((o) => ({
      id: String((o as any).id || ''),
      uploadId: Number((o as any).uploadId),
      startSeconds: (o as any).startSeconds == null ? undefined : Number((o as any).startSeconds),
      sourceStartSeconds: Number((o as any).sourceStartSeconds),
      sourceEndSeconds: Number((o as any).sourceEndSeconds),
      sizePctWidth: Number((o as any).sizePctWidth),
      position: String((o as any).position || 'bottom_right') as any,
      audioEnabled: (o as any).audioEnabled == null ? undefined : Boolean((o as any).audioEnabled),
      boostDb: (o as any).boostDb == null ? undefined : Number((o as any).boostDb),
      plateStyle: (o as any).plateStyle == null ? undefined : (String((o as any).plateStyle) as any),
      plateColor: (o as any).plateColor == null ? undefined : String((o as any).plateColor),
      plateOpacityPct: (o as any).plateOpacityPct == null ? undefined : Number((o as any).plateOpacityPct),
    }))
    .filter(
      (o) =>
        o.id &&
        Number.isFinite(o.uploadId) &&
        o.uploadId > 0 &&
        Number.isFinite(o.sourceStartSeconds) &&
        Number.isFinite(o.sourceEndSeconds) &&
        o.sourceEndSeconds > o.sourceStartSeconds
    )
  const videoOverlayStills: VideoOverlayStill[] = videoOverlayStillsRaw
    .map((s) => ({
      id: String((s as any).id || ''),
      uploadId: Number((s as any).uploadId),
      startSeconds: Number((s as any).startSeconds),
      endSeconds: Number((s as any).endSeconds),
      sourceVideoOverlayId: (s as any).sourceVideoOverlayId == null ? undefined : String((s as any).sourceVideoOverlayId),
      sizePctWidth: (s as any).sizePctWidth == null ? undefined : Number((s as any).sizePctWidth),
      position: (s as any).position == null ? undefined : (String((s as any).position) as any),
    }))
    .filter((s) => s.id && Number.isFinite(s.uploadId) && s.uploadId > 0 && Number.isFinite(s.startSeconds) && Number.isFinite(s.endSeconds) && s.endSeconds > s.startSeconds)
  const graphics = Array.isArray((input.timeline as any)?.graphics) ? ((input.timeline as any).graphics as Graphic[]) : []
  const logos = Array.isArray((input.timeline as any)?.logos) ? ((input.timeline as any).logos as Logo[]) : []
  const lowerThirds = Array.isArray((input.timeline as any)?.lowerThirds) ? ((input.timeline as any).lowerThirds as LowerThird[]) : []
  const screenTitles = Array.isArray((input.timeline as any)?.screenTitles) ? ((input.timeline as any).screenTitles as ScreenTitle[]) : []
  const narrationRaw = Array.isArray((input.timeline as any)?.narration) ? ((input.timeline as any).narration as any[]) : []
  const narration: Narration[] = narrationRaw
    .map((n) => ({
      id: String((n as any).id || ''),
      uploadId: Number((n as any).uploadId),
      startSeconds: Number((n as any).startSeconds),
      endSeconds: Number((n as any).endSeconds),
      sourceStartSeconds: (n as any).sourceStartSeconds == null ? undefined : Number((n as any).sourceStartSeconds),
      audioEnabled: (n as any).audioEnabled == null ? undefined : Boolean((n as any).audioEnabled),
      boostDb: (n as any).boostDb == null ? undefined : Number((n as any).boostDb),
      gainDb: (n as any).gainDb == null ? undefined : Number((n as any).gainDb),
      visualizer: (n as any).visualizer == null ? undefined : (n as any).visualizer,
    }))
    .filter((n) => n.id && Number.isFinite(n.uploadId) && n.uploadId > 0 && Number.isFinite(n.startSeconds) && Number.isFinite(n.endSeconds))
  const audioSegmentsRaw = (input.timeline as any)?.audioSegments
  const audioSegments: AudioSegment[] = Array.isArray(audioSegmentsRaw)
    ? (audioSegmentsRaw as any[])
        .map((s) => ({
          id: String((s as any).id || ''),
          uploadId: Number((s as any).uploadId),
          startSeconds: Number((s as any).startSeconds),
          endSeconds: Number((s as any).endSeconds),
          sourceStartSeconds: (s as any).sourceStartSeconds == null ? undefined : Number((s as any).sourceStartSeconds),
          audioEnabled: (s as any).audioEnabled == null ? undefined : Boolean((s as any).audioEnabled),
          musicMode: (s as any).musicMode == null ? undefined : (String((s as any).musicMode) as any),
          musicLevel: (s as any).musicLevel == null ? undefined : (String((s as any).musicLevel) as any),
          duckingIntensity: (s as any).duckingIntensity == null ? undefined : (String((s as any).duckingIntensity) as any),
          audioConfigId: (s as any).audioConfigId == null ? undefined : Number((s as any).audioConfigId),
        }))
        .filter((s) => s.id && Number.isFinite(s.uploadId) && s.uploadId > 0 && Number.isFinite(s.startSeconds) && Number.isFinite(s.endSeconds))
    : []
  const audioTrackRaw = (input.timeline as any)?.audioTrack
  const audioTrack: AudioTrack | null =
    audioTrackRaw && typeof audioTrackRaw === 'object'
      ? {
          uploadId: Number((audioTrackRaw as any).uploadId),
          audioConfigId: Number((audioTrackRaw as any).audioConfigId),
          startSeconds: Number((audioTrackRaw as any).startSeconds),
          endSeconds: Number((audioTrackRaw as any).endSeconds),
        }
      : null
  if (!audioSegments.length && audioTrack && Number.isFinite(audioTrack.uploadId) && audioTrack.uploadId > 0) {
    audioSegments.push({
      id: 'audio_track_legacy',
      uploadId: Number(audioTrack.uploadId),
      audioConfigId: Number(audioTrack.audioConfigId),
      startSeconds: Number(audioTrack.startSeconds),
      endSeconds: Number(audioTrack.endSeconds),
      sourceStartSeconds: 0,
    })
  }
  const timelineBackgroundModeRaw = String((input.timeline as any)?.timelineBackgroundMode || 'none').trim().toLowerCase()
  const timelineBackgroundMode = timelineBackgroundModeRaw === 'color' ? 'color' : timelineBackgroundModeRaw === 'image' ? 'image' : 'none'
  const timelineBackgroundColor = normalizeHexColor((input.timeline as any)?.timelineBackgroundColor, '#000000')
  const timelineBackgroundUploadIdRaw = Number((input.timeline as any)?.timelineBackgroundUploadId)
  const timelineBackgroundUploadId =
    timelineBackgroundMode === 'image' && Number.isFinite(timelineBackgroundUploadIdRaw) && timelineBackgroundUploadIdRaw > 0
      ? Number(timelineBackgroundUploadIdRaw)
      : null
  if (
    !clips.length &&
    !stills.length &&
    !graphics.length &&
    !videoOverlays.length &&
    !videoOverlayStills.length &&
    !logos.length &&
    !lowerThirds.length &&
    !screenTitles.length &&
    !narration.length &&
    !audioSegments.length
  )
    throw new Error('empty_timeline')

  const db = getPool()
  const ids = Array.from(
    new Set(
      [
        ...clips.map((c) => Number(c.uploadId)),
        ...clips.map((c) => Number((c as any).bgFillImageUploadId)),
        ...stills.map((s) => Number((s as any).uploadId)),
        ...graphics.map((g) => Number(g.uploadId)),
        ...videoOverlays.map((o) => Number((o as any).uploadId)),
        ...videoOverlayStills.map((s) => Number((s as any).uploadId)),
        ...logos.map((l) => Number((l as any).uploadId)),
        ...lowerThirds.map((lt) => Number((lt as any).uploadId)),
        ...screenTitles.map((st) => Number((st as any).renderUploadId)),
        ...narration.map((n) => Number((n as any).uploadId)),
        ...audioSegments.map((s) => Number((s as any).uploadId)),
        ...(timelineBackgroundUploadId != null ? [timelineBackgroundUploadId] : []),
      ].filter((n) => Number.isFinite(n) && n > 0)
    )
  )
  const [rows] = await db.query(
    `SELECT id, user_id, kind, status, s3_bucket, s3_key, width, height, image_role, is_system, source_deleted_at FROM uploads WHERE id IN (?)`,
    [ids]
  )
  const byId = new Map<number, any>()
  for (const r of rows as any[]) byId.set(Number(r.id), r)

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-create-video-export-'))
  try {
    const fps = 30
    const segPaths: string[] = []
    const seenDownloads = new Map<number, string>()
    let timelineBackgroundImagePath: string | null = null
    if (timelineBackgroundMode === 'image' && timelineBackgroundUploadId != null) {
      const row = byId.get(timelineBackgroundUploadId)
      if (!row) throw new Error('upload_not_found')
      if (String(row.kind || '').toLowerCase() !== 'image') throw new Error('invalid_upload_kind')
      const ownerId = row.user_id != null ? Number(row.user_id) : null
      if (!(ownerId === userId || ownerId == null)) throw new Error('forbidden')
      const status = String(row.status || '').toLowerCase()
      if (!(status === 'uploaded' || status === 'completed')) throw new Error('invalid_upload_status')
      if (row.source_deleted_at) throw new Error('source_deleted')
      const inPath = seenDownloads.get(timelineBackgroundUploadId) || path.join(tmpDir, `timeline_bg_${timelineBackgroundUploadId}.img`)
      if (!seenDownloads.has(timelineBackgroundUploadId)) {
        await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), inPath)
        seenDownloads.set(timelineBackgroundUploadId, inPath)
      }
      timelineBackgroundImagePath = inPath
    }
    const resolveClipBackgroundImagePath = async (clip: Clip | null | undefined): Promise<string | null> => {
      if (!clip) return null
      const styleRaw = String((clip as any).bgFillStyle || 'none').trim().toLowerCase()
      if (styleRaw !== 'image') return null
      const uploadIdRaw = Number((clip as any).bgFillImageUploadId)
      if (!(Number.isFinite(uploadIdRaw) && uploadIdRaw > 0)) return null
      const uploadId = Math.round(uploadIdRaw)
      const row = byId.get(uploadId)
      if (!row) throw new Error('upload_not_found')
      if (String(row.kind || '').toLowerCase() !== 'image') throw new Error('invalid_upload_kind')
      const ownerId = row.user_id != null ? Number(row.user_id) : null
      if (!(ownerId === userId || ownerId == null)) throw new Error('forbidden')
      const status = String(row.status || '').toLowerCase()
      if (!(status === 'uploaded' || status === 'completed')) throw new Error('invalid_upload_status')
      if (row.source_deleted_at) throw new Error('source_deleted')
      const inPath = seenDownloads.get(uploadId) || path.join(tmpDir, `clip_bg_${uploadId}.img`)
      if (!seenDownloads.has(uploadId)) {
        await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), inPath)
        seenDownloads.set(uploadId, inPath)
      }
      return inPath
    }

    let target = { w: 1080, h: 1920 }
    let baseDurationSeconds = 0
    let baseOut = path.join(tmpDir, 'out.mp4')

    const clipTimelineDurationSeconds = (c: Clip): number => {
      const base = Math.max(0, roundToTenth(Number(c.sourceEndSeconds) - Number(c.sourceStartSeconds)))
      const fs = Math.max(0, roundToTenth(Number((c as any).freezeStartSeconds || 0)))
      const fe = Math.max(0, roundToTenth(Number((c as any).freezeEndSeconds || 0)))
      return roundToTenth(base + fs + fe)
    }

    // Normalize missing clip.startSeconds the same way the frontend does: sequential placement after the latest end.
    let cursorForMissing = 0
    const normalizedClips: Clip[] = clips.map((c) => {
      const raw = (c as any).startSeconds
      const hasStart = raw != null && Number.isFinite(Number(raw))
      const startSeconds = hasStart ? roundToTenth(Math.max(0, Number(raw))) : roundToTenth(Math.max(0, cursorForMissing))
      const end = roundToTenth(startSeconds + clipTimelineDurationSeconds(c))
      cursorForMissing = Math.max(cursorForMissing, end)
      return { ...c, startSeconds }
    })
    const sortedClips: Clip[] = normalizedClips.slice().sort((a, b) => Number(a.startSeconds || 0) - Number(b.startSeconds || 0) || String(a.id).localeCompare(String(b.id)))
    const clipById = new Map<string, Clip>()
    for (const c of sortedClips) {
      clipById.set(String(c.id), c)
    }
    const findClipForStillByTimelinePosition = (stillStartSeconds: number, stillEndSeconds: number): Clip | undefined => {
      if (!sortedClips.length) return undefined
      let best: Clip | undefined
      let bestDist = Number.POSITIVE_INFINITY
      for (const c of sortedClips) {
        const clipStart = roundToTenth(Number((c as any).startSeconds || 0))
        const clipEnd = roundToTenth(clipStart + clipTimelineDurationSeconds(c))
        const dist = Math.min(
          Math.abs(clipStart - stillStartSeconds),
          Math.abs(clipEnd - stillStartSeconds),
          Math.abs(clipStart - stillEndSeconds),
          Math.abs(clipEnd - stillEndSeconds)
        )
        if (dist < bestDist) {
          bestDist = dist
          best = c
        }
      }
      return best
    }
    const sortedStills: Still[] = stills
      .map((s) => ({
        ...s,
        startSeconds: roundToTenth(Math.max(0, Number((s as any).startSeconds || 0))),
        endSeconds: roundToTenth(Math.max(0, Number((s as any).endSeconds || 0))),
      }))
      .filter((s) => Number.isFinite(Number(s.startSeconds)) && Number.isFinite(Number(s.endSeconds)) && Number(s.endSeconds) > Number(s.startSeconds))
      .sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))

    const videoOverlayTimelineDurationSeconds = (o: VideoOverlay): number => {
      const base = roundToTenth(Math.max(0, Number(o.sourceEndSeconds) - Number(o.sourceStartSeconds)))
      return base
    }

    // Normalize missing videoOverlays.startSeconds the same way the frontend does: sequential placement after the latest end.
    let cursorForMissingOverlays = 0
    const normalizedVideoOverlays: VideoOverlay[] = videoOverlays.map((o) => {
      const raw = (o as any).startSeconds
      const hasStart = raw != null && Number.isFinite(Number(raw))
      const startSeconds = hasStart ? roundToTenth(Math.max(0, Number(raw))) : roundToTenth(Math.max(0, cursorForMissingOverlays))
      const end = roundToTenth(startSeconds + videoOverlayTimelineDurationSeconds(o))
      cursorForMissingOverlays = Math.max(cursorForMissingOverlays, end)
      return { ...o, startSeconds }
    })
    const sortedVideoOverlays: VideoOverlay[] = normalizedVideoOverlays
      .slice()
      .sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id)))

    type BaseSeg =
      | { kind: 'clip'; id: string; startSeconds: number; endSeconds: number; clip: Clip }
      | { kind: 'still'; id: string; startSeconds: number; endSeconds: number; still: Still }

    const segments: BaseSeg[] = []
    for (const c of sortedClips) {
      const s = roundToTenth(Number(c.startSeconds || 0))
      const e = roundToTenth(s + clipTimelineDurationSeconds(c))
      segments.push({ kind: 'clip', id: String(c.id), startSeconds: s, endSeconds: e, clip: c })
    }
    for (const s of sortedStills) {
      segments.push({ kind: 'still', id: String(s.id), startSeconds: roundToTenth(Number(s.startSeconds)), endSeconds: roundToTenth(Number(s.endSeconds)), still: s })
    }
    segments.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))

    const graphicsEnd = graphics.length ? Number(graphics.slice().sort((a, b) => Number(a.endSeconds) - Number(b.endSeconds))[graphics.length - 1].endSeconds) : 0
    const screenTitlesEnd = screenTitles.length
      ? Number(screenTitles.slice().sort((a, b) => Number((a as any).endSeconds) - Number((b as any).endSeconds))[screenTitles.length - 1].endSeconds)
      : 0
    const videoOverlaysEnd = sortedVideoOverlays.length
      ? Number(
          sortedVideoOverlays
            .slice()
            .sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0))
            .map((o) => roundToTenth(Number((o as any).startSeconds || 0) + videoOverlayTimelineDurationSeconds(o)))
            .sort((a, b) => a - b)[sortedVideoOverlays.length - 1]
        )
      : 0
    const videoOverlayStillsEnd = videoOverlayStills.length
      ? Number(
          videoOverlayStills
            .slice()
            .map((s) => roundToTenth(Number((s as any).endSeconds || 0)))
            .filter((n) => Number.isFinite(n))
            .sort((a, b) => a - b)[videoOverlayStills.length - 1]
        )
      : 0
    const narrationEnd = narration.length
      ? Number(narration.slice().sort((a, b) => Number((a as any).endSeconds) - Number((b as any).endSeconds))[narration.length - 1].endSeconds)
      : 0
    const audioEnd = audioSegments.length
      ? Number(
          audioSegments
            .slice()
            .sort((a, b) => Number((a as any).endSeconds) - Number((b as any).endSeconds))
            [audioSegments.length - 1].endSeconds
        )
      : 0
    const logosEnd = logos.length ? Number(logos.slice().sort((a, b) => Number(a.endSeconds) - Number(b.endSeconds))[logos.length - 1].endSeconds) : 0
    const lowerThirdsEnd = lowerThirds.length
      ? Number(lowerThirds.slice().sort((a, b) => Number(a.endSeconds) - Number(b.endSeconds))[lowerThirds.length - 1].endSeconds)
      : 0

    if (segments.length) {
      // If we have video clips, use the first clip to choose output dimensions (max long edge 1080).
      if (sortedClips.length) {
        const first = sortedClips[0]
        const firstRow = byId.get(Number(first.uploadId))
        if (!firstRow) throw new Error('upload_not_found')
        if (String(firstRow.kind || 'video').toLowerCase() !== 'video') throw new Error('invalid_upload_kind')
        const ownerId = firstRow.user_id != null ? Number(firstRow.user_id) : null
        if (!(ownerId === userId || ownerId == null)) throw new Error('forbidden')

        const firstIn = path.join(tmpDir, `src_${Number(first.uploadId)}.mp4`)
        await downloadS3ObjectToFile(String(firstRow.s3_bucket), String(firstRow.s3_key), firstIn)
        const dims = await probeVideoDisplayDimensions(firstIn)
        const computed = computeTargetDims(dims.width, dims.height)
        if (computed.w > computed.h) {
          const portraitW = even((1080 * 9) / 16)
          target = { w: portraitW, h: 1080 }
        } else {
          target = { w: computed.w, h: computed.h }
        }
        seenDownloads.set(Number(first.uploadId), firstIn)
      }

      // Render base-track segments (clips + stills), filling gaps with timeline background.
      let cursorSeconds = 0
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const startSeconds = roundToTenth(Math.max(0, Number(seg.startSeconds || 0)))
        const endSeconds = roundToTenth(Math.max(0, Number(seg.endSeconds || 0)))
        if (startSeconds < cursorSeconds - 0.05) throw new Error('overlapping_base_segments')
        if (startSeconds > cursorSeconds + 0.05) {
          const gapDur = roundToTenth(startSeconds - cursorSeconds)
          const gapPath = path.join(tmpDir, `gap_${String(i).padStart(3, '0')}.mp4`)
          await renderBlackBaseMp4({
            outPath: gapPath,
            durationSeconds: gapDur,
            targetW: target.w,
            targetH: target.h,
            fps,
            color: timelineBackgroundMode === 'color' ? timelineBackgroundColor : undefined,
            backgroundImagePath: timelineBackgroundImagePath,
            logPaths,
          })
          segPaths.push(gapPath)
          cursorSeconds = startSeconds
        }

        if (seg.kind === 'clip') {
          const c = seg.clip
          const uploadId = Number(c.uploadId)
          const row = byId.get(uploadId)
          if (!row) throw new Error('upload_not_found')
          if (String(row.kind || 'video').toLowerCase() !== 'video') throw new Error('invalid_upload_kind')
          const oid = row.user_id != null ? Number(row.user_id) : null
          if (!(oid === userId || oid == null)) throw new Error('forbidden')

          const inPath = seenDownloads.get(uploadId) || path.join(tmpDir, `src_${uploadId}.mp4`)
          if (!seenDownloads.has(uploadId)) {
            await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), inPath)
            seenDownloads.set(uploadId, inPath)
          }

          const outPath = path.join(tmpDir, `seg_clip_${String(i).padStart(3, '0')}.mp4`)
          const clipBackgroundImagePath = await resolveClipBackgroundImagePath(c)
          await renderSegmentMp4({
            inPath,
            outPath,
            startSeconds: Number(c.sourceStartSeconds || 0),
            endSeconds: Number(c.sourceEndSeconds || 0),
            audioEnabled: (c as any).audioEnabled !== false,
            boostDb: (c as any).boostDb,
            bgFillStyle: (c as any).bgFillStyle,
            bgFillBrightness: (c as any).bgFillBrightness,
            bgFillBlur: (c as any).bgFillBlur,
            bgFillColor: (c as any).bgFillColor,
            bgFillImagePath: clipBackgroundImagePath,
            timelineBackgroundMode,
            timelineBackgroundColor,
            timelineBackgroundImagePath,
            sourceDims:
              row.width != null && row.height != null && Number(row.width) > 0 && Number(row.height) > 0
                ? { width: Number(row.width), height: Number(row.height) }
                : undefined,
            freezeStartSeconds: Number((c as any).freezeStartSeconds || 0),
            freezeEndSeconds: Number((c as any).freezeEndSeconds || 0),
            targetW: target.w,
            targetH: target.h,
            fps,
            logPaths,
          })
          segPaths.push(outPath)
          cursorSeconds = endSeconds
          continue
        }

        const s = seg.still
        const uploadId = Number(s.uploadId)
        const row = byId.get(uploadId)
        if (!row) throw new Error('upload_not_found')
        if (String(row.kind || '').toLowerCase() !== 'image') throw new Error('invalid_upload_kind')
        if (String(row.image_role || '').toLowerCase() !== 'freeze_frame') throw new Error('invalid_image_role')
        const oid = row.user_id != null ? Number(row.user_id) : null
        if (!(oid === userId || oid == null)) throw new Error('forbidden')
        const st = String(row.status || '').toLowerCase()
        if (!(st === 'uploaded' || st === 'completed')) throw new Error('invalid_upload_status')
        if (row.source_deleted_at) throw new Error('source_deleted')

        const inPath = seenDownloads.get(uploadId) || path.join(tmpDir, `still_${uploadId}.png`)
        if (!seenDownloads.has(uploadId)) {
          await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), inPath)
          seenDownloads.set(uploadId, inPath)
        }
        const sourceClipId = (s as any).sourceClipId != null ? String((s as any).sourceClipId) : ''
        let sourceClip = sourceClipId ? clipById.get(sourceClipId) : undefined
        if (!sourceClip) {
          sourceClip = findClipForStillByTimelinePosition(startSeconds, endSeconds)
        }
        const sourceClipBackgroundImagePath = await resolveClipBackgroundImagePath(sourceClip)
        const outPath = path.join(tmpDir, `seg_still_${String(i).padStart(3, '0')}.mp4`)
        await renderStillSegmentMp4({
          imagePath: inPath,
          outPath,
          durationSeconds: roundToTenth(endSeconds - startSeconds),
          bgFillStyle: sourceClip ? (sourceClip as any).bgFillStyle : undefined,
          bgFillBrightness: sourceClip ? (sourceClip as any).bgFillBrightness : undefined,
          bgFillBlur: sourceClip ? (sourceClip as any).bgFillBlur : undefined,
          bgFillColor: sourceClip ? (sourceClip as any).bgFillColor : undefined,
          bgFillImagePath: sourceClipBackgroundImagePath,
          timelineBackgroundMode,
          timelineBackgroundColor,
          timelineBackgroundImagePath,
          sourceDims:
            row.width != null && row.height != null && Number(row.width) > 0 && Number(row.height) > 0
              ? { width: Number(row.width), height: Number(row.height) }
              : undefined,
          targetW: target.w,
          targetH: target.h,
          fps,
          logPaths,
        })
        segPaths.push(outPath)
        cursorSeconds = endSeconds
      }

      const targetEnd = roundToTenth(
        Math.max(cursorSeconds, graphicsEnd, videoOverlaysEnd, videoOverlayStillsEnd, screenTitlesEnd, audioEnd, narrationEnd, logosEnd, lowerThirdsEnd)
      )
      if (targetEnd > cursorSeconds + 0.05) {
        const gapDur = roundToTenth(targetEnd - cursorSeconds)
        const gapPath = path.join(tmpDir, `tail_gap.mp4`)
        await renderBlackBaseMp4({
          outPath: gapPath,
          durationSeconds: gapDur,
          targetW: target.w,
          targetH: target.h,
          fps,
          color: timelineBackgroundMode === 'color' ? timelineBackgroundColor : undefined,
          backgroundImagePath: timelineBackgroundImagePath,
          logPaths,
        })
        segPaths.push(gapPath)
        cursorSeconds = targetEnd
      }

      baseDurationSeconds = roundToTenth(Math.max(0, cursorSeconds))

      // Concat segments.
      const listPath = path.join(tmpDir, 'list.txt')
      fs.writeFileSync(listPath, segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
      try {
        await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', baseOut], logPaths)
      } catch {
        await runFfmpeg(
          [
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            listPath,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-movflags',
            '+faststart',
            baseOut,
          ],
          logPaths
        )
      }
    } else {
      baseDurationSeconds = roundToTenth(Math.max(0, graphicsEnd, videoOverlaysEnd, videoOverlayStillsEnd, screenTitlesEnd, audioEnd, logosEnd, lowerThirdsEnd))
      if (!(baseDurationSeconds > 0)) throw new Error('invalid_duration')
      await renderBlackBaseMp4({
        outPath: baseOut,
        durationSeconds: baseDurationSeconds,
        targetW: target.w,
        targetH: target.h,
        fps,
        color: timelineBackgroundMode === 'color' ? timelineBackgroundColor : undefined,
        backgroundImagePath: timelineBackgroundImagePath,
        logPaths,
      })
    }

    let finalOut = baseOut
    if (sortedVideoOverlays.length) {
      const sorted = sortedVideoOverlays.slice()
      const overlays: Array<{
        startSeconds: number
        endSeconds: number
        inPath: string
        sourceStartSeconds: number
        sourceEndSeconds: number
        sizePctWidth: number
        position: string
        audioEnabled: boolean
        boostDb?: number
        plateStyle?: 'none' | 'thin' | 'medium' | 'thick' | 'band'
        plateColor?: string
        plateOpacityPct?: number
      }> = []
      for (let i = 0; i < sorted.length; i++) {
        const o: any = sorted[i]
        const uploadId = Number(o.uploadId)
        const row = byId.get(uploadId)
        if (!row) throw new Error('upload_not_found')
        if (String(row.kind || 'video').toLowerCase() !== 'video') throw new Error('invalid_upload_kind')
        const oid = row.user_id != null ? Number(row.user_id) : null
        if (!(oid === userId || oid == null)) throw new Error('forbidden')
        if (row.source_deleted_at) throw new Error('source_deleted')

        const inPath = seenDownloads.get(uploadId) || path.join(tmpDir, `ovsrc_${uploadId}.mp4`)
        if (!seenDownloads.has(uploadId)) {
          await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), inPath)
          seenDownloads.set(uploadId, inPath)
        }

        const startSeconds = roundToTenth(Math.max(0, Number(o.startSeconds || 0)))
        const sourceStartSeconds = roundToTenth(Math.max(0, Number(o.sourceStartSeconds || 0)))
        const sourceEndSeconds = roundToTenth(Math.max(0, Number(o.sourceEndSeconds || 0)))
        const dur = roundToTenth(Math.max(0, sourceEndSeconds - sourceStartSeconds))
        const endSeconds = roundToTenth(startSeconds + dur)
        if (!(endSeconds > startSeconds + 0.05)) continue
        const plateStyleRaw = (o as any).plateStyle != null ? String((o as any).plateStyle).toLowerCase() : 'none'
        const plateStyleAllowed = new Set(['none', 'thin', 'medium', 'thick', 'band'])
        const plateStyle = plateStyleAllowed.has(plateStyleRaw) ? (plateStyleRaw as any) : 'none'
        overlays.push({
          startSeconds,
          endSeconds,
          inPath,
          sourceStartSeconds,
          sourceEndSeconds,
          sizePctWidth: Number(o.sizePctWidth || 40),
          position: String(o.position || 'bottom_right'),
          audioEnabled: Boolean(o.audioEnabled),
          boostDb: (o as any).boostDb == null ? 0 : Number((o as any).boostDb),
          plateStyle,
          plateColor: (o as any).plateColor != null ? String((o as any).plateColor) : '#000000',
          plateOpacityPct: (o as any).plateOpacityPct != null ? Number((o as any).plateOpacityPct) : 85,
        })
      }

      if (overlays.length) {
        const overlayOut = path.join(tmpDir, 'out_video_overlays.mp4')
        await overlayVideoOverlays({
          baseMp4Path: finalOut,
          outPath: overlayOut,
          overlays,
          targetW: target.w,
          targetH: target.h,
          durationSeconds: baseDurationSeconds,
          logPaths,
        })
        finalOut = overlayOut
      }
    }

    if (videoOverlayStills.length) {
      const imageDownloads = new Map<number, string>()
      const sorted = videoOverlayStills
        .slice()
        .map((s) => ({
          ...s,
          startSeconds: roundToTenth(Math.max(0, Number((s as any).startSeconds || 0))),
          endSeconds: roundToTenth(Math.max(0, Number((s as any).endSeconds || 0))),
        }))
        .filter((s) => Number.isFinite(Number((s as any).startSeconds)) && Number.isFinite(Number((s as any).endSeconds)) && Number((s as any).endSeconds) > Number((s as any).startSeconds))
        .sort((a, b) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String((a as any).id).localeCompare(String((b as any).id)))

      const stillOverlays: Array<{ startSeconds: number; endSeconds: number; imagePath: string; sizePctWidth: number; position: string }> = []
      for (let i = 0; i < sorted.length; i++) {
        const st: any = sorted[i] as any
        const uploadId = Number((st as any).uploadId)
        if (!Number.isFinite(uploadId) || uploadId <= 0) continue
        const row = byId.get(uploadId)
        if (!row) throw new Error('upload_not_found')
        if (String(row.kind || '').toLowerCase() !== 'image') throw new Error('invalid_upload_kind')
        if (String(row.image_role || '').toLowerCase() !== 'freeze_frame') throw new Error('invalid_image_role')
        const oid = row.user_id != null ? Number(row.user_id) : null
        if (!(oid === userId || oid == null)) throw new Error('forbidden')
        const stStatus = String(row.status || '').toLowerCase()
        if (!(stStatus === 'uploaded' || stStatus === 'completed')) throw new Error('invalid_upload_status')
        if (row.source_deleted_at) throw new Error('source_deleted')

        const ext = path.extname(String(row.s3_key || '')).toLowerCase() || '.png'
        const inPath = imageDownloads.get(uploadId) || path.join(tmpDir, `ovstill_${uploadId}_img${ext}`)
        if (!imageDownloads.has(uploadId)) {
          await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), inPath)
          imageDownloads.set(uploadId, inPath)
        }

        const segStart = clamp(roundToTenth(Number(st.startSeconds)), 0, Math.max(0, baseDurationSeconds))
        const segEnd = clamp(roundToTenth(Number(st.endSeconds)), 0, Math.max(0, baseDurationSeconds))
        if (!(segEnd > segStart + 0.01)) continue

        stillOverlays.push({
          startSeconds: segStart,
          endSeconds: segEnd,
          imagePath: inPath,
          sizePctWidth: Number((st as any).sizePctWidth || 40),
          position: String((st as any).position || 'bottom_right'),
        })
      }

      if (stillOverlays.length) {
        const overlayOut = path.join(tmpDir, 'out_video_overlay_stills.mp4')
        await overlayVideoOverlayStills({
          baseMp4Path: finalOut,
          outPath: overlayOut,
          stills: stillOverlays,
          targetW: target.w,
          targetH: target.h,
          durationSeconds: baseDurationSeconds,
          logPaths,
        })
        finalOut = overlayOut
      }
    }

    if (screenTitles.length) {
      const imageDownloads = new Map<number, string>()
      const sorted = screenTitles
        .slice()
        .map((st) => ({
          ...st,
          startSeconds: roundToTenth(Math.max(0, Number((st as any).startSeconds || 0))),
          endSeconds: roundToTenth(Math.max(0, Number((st as any).endSeconds || 0))),
        }))
        .filter((st) => Number.isFinite(Number((st as any).startSeconds)) && Number.isFinite(Number((st as any).endSeconds)) && Number((st as any).endSeconds) > Number((st as any).startSeconds))
        .sort((a, b) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String((a as any).id).localeCompare(String((b as any).id)))

      const overlays: Array<{ startSeconds: number; endSeconds: number; imagePath: string; fade: 'none' | 'in' | 'out' | 'in_out' }> = []
      for (let i = 0; i < sorted.length; i++) {
        const st: any = sorted[i] as any
        const uploadId = st.renderUploadId == null ? 0 : Number(st.renderUploadId)
        if (!Number.isFinite(uploadId) || uploadId <= 0) continue
        const row = byId.get(uploadId)
        if (!row) throw new Error('upload_not_found')
        if (String(row.kind || '').toLowerCase() !== 'image') throw new Error('invalid_upload_kind')
        if (String(row.image_role || '').toLowerCase() !== 'screen_title') throw new Error('invalid_image_role')
        const oid = row.user_id != null ? Number(row.user_id) : null
        if (!(oid === userId || oid == null)) throw new Error('forbidden')
        const stStatus = String(row.status || '').toLowerCase()
        if (!(stStatus === 'uploaded' || stStatus === 'completed')) throw new Error('invalid_upload_status')
        if (row.source_deleted_at) throw new Error('source_deleted')

        const inPath = imageDownloads.get(uploadId) || path.join(tmpDir, `screen_title_${uploadId}_${String(i).padStart(3, '0')}.png`)
        if (!imageDownloads.has(uploadId)) {
          await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), inPath)
          imageDownloads.set(uploadId, inPath)
        }

        const segStart = clamp(roundToTenth(Number(st.startSeconds)), 0, Math.max(0, baseDurationSeconds))
        const segEnd = clamp(roundToTenth(Number(st.endSeconds)), 0, Math.max(0, baseDurationSeconds))
        if (!(segEnd > segStart + 0.01)) continue

        const preset: any = st.presetSnapshot && typeof st.presetSnapshot === 'object' ? st.presetSnapshot : {}
        const fadeRaw = String(preset.fade || 'none').toLowerCase()
        const fade = (fadeRaw === 'in_out' ? 'in_out' : fadeRaw === 'in' ? 'in' : fadeRaw === 'out' ? 'out' : 'none') as any

        overlays.push({ startSeconds: segStart, endSeconds: segEnd, imagePath: inPath, fade })
      }

      if (overlays.length) {
        const overlayOut = path.join(tmpDir, 'out_screen_titles.mp4')
        await overlayFullFrameScreenTitles({
          baseMp4Path: finalOut,
          outPath: overlayOut,
          screenTitles: overlays,
          targetW: target.w,
          targetH: target.h,
          durationSeconds: baseDurationSeconds,
          logPaths,
        })
        finalOut = overlayOut
      }
    }

    if (lowerThirds.length) {
      const downloads = new Map<number, { path: string; w: number; h: number }>()
      const sorted = lowerThirds
        .slice()
        .map((lt) => ({
          ...lt,
          startSeconds: roundToTenth(Math.max(0, Number((lt as any).startSeconds || 0))),
          endSeconds: roundToTenth(Math.max(0, Number((lt as any).endSeconds || 0))),
        }))
        .filter((lt) => Number.isFinite(Number((lt as any).startSeconds)) && Number.isFinite(Number((lt as any).endSeconds)) && Number((lt as any).endSeconds) > Number((lt as any).startSeconds))
        .sort((a, b) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String((a as any).id).localeCompare(String((b as any).id)))

      const overlays: Array<{ pngPath: string; imgW: number; imgH: number; cfg: any; startSeconds: number; endSeconds: number }> = []
      for (let i = 0; i < sorted.length; i++) {
        const lt: any = sorted[i] as any
        const uploadId = Number(lt.uploadId)
        const row = byId.get(uploadId)
        if (!row) throw new Error('upload_not_found')
        if (String(row.kind || '').toLowerCase() !== 'image') throw new Error('invalid_upload_kind')
        if (String(row.image_role || '').toLowerCase() !== 'lower_third') throw new Error('invalid_image_role')
        const oid = row.user_id != null ? Number(row.user_id) : null
        if (!(oid === userId || oid == null)) throw new Error('forbidden')
        const st = String(row.status || '').toLowerCase()
        if (!(st === 'uploaded' || st === 'completed')) throw new Error('invalid_upload_status')
        if (row.source_deleted_at) throw new Error('source_deleted')

        let entry = downloads.get(uploadId)
        if (!entry) {
          const p = path.join(tmpDir, `lower_third_${uploadId}_${String(i).padStart(3, '0')}.png`)
          await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), p)
          let w = row.width != null ? Number(row.width) : NaN
          let h = row.height != null ? Number(row.height) : NaN
          if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) {
            const dims = await probeVideoDisplayDimensions(p)
            w = dims.width
            h = dims.height
          }
          entry = { path: p, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
          downloads.set(uploadId, entry)
        }

        const segStart = clamp(roundToTenth(Number(lt.startSeconds)), 0, Math.max(0, baseDurationSeconds))
        const segEnd = clamp(roundToTenth(Number(lt.endSeconds)), 0, Math.max(0, baseDurationSeconds))
        if (!(segEnd > segStart + 0.01)) continue
        const segDur = roundToTenth(segEnd - segStart)

        const cfgRaw = lt.configSnapshot && typeof lt.configSnapshot === 'object' ? lt.configSnapshot : {}
        const cfg: any = { ...cfgRaw }

        // Support match-image sizing by converting to sizePctWidth at the configured baseline width.
        const sizeMode = String(cfg.sizeMode || 'pct').toLowerCase()
        if (sizeMode === 'match_image') {
          const baseline = Number(cfg.baselineWidth) === 1920 ? 1920 : 1080
          const pct = Math.round((entry.w / baseline) * 100)
          cfg.sizePctWidth = clamp(pct, 1, 100)
        }

        const rule = String(cfgRaw.timingRule || 'first_only').toLowerCase()
        const secsRaw = cfgRaw.timingSeconds == null ? null : Number(cfgRaw.timingSeconds)
        const secs = secsRaw != null && Number.isFinite(secsRaw) ? Math.max(0, Math.min(3600, secsRaw)) : null

        let startRel = 0
        let endRel = segDur
        if (rule === 'first_only') endRel = Math.max(0, Math.min(segDur, secs ?? segDur))

        const effStart = roundToTenth(segStart + startRel)
        const effEnd = roundToTenth(segStart + endRel)
        if (!(effEnd > effStart + 0.01)) continue

        overlays.push({
          pngPath: entry.path,
          imgW: entry.w,
          imgH: entry.h,
          cfg,
          startSeconds: effStart,
          endSeconds: effEnd,
        })
      }

      if (overlays.length) {
        const outLt = path.join(tmpDir, 'out_lower_third.mp4')
        await burnPngOverlaysIntoMp4({
          inPath: finalOut,
          outPath: outLt,
          videoDurationSeconds: baseDurationSeconds,
          overlays: overlays.map((o) => ({
            pngPath: o.pngPath,
            imgW: o.imgW,
            imgH: o.imgH,
            cfg: o.cfg,
            startSeconds: o.startSeconds,
            endSeconds: o.endSeconds,
          })),
          logPaths,
        })
        finalOut = outLt
      }
    }

    if (narration.length) {
      const visuals: Array<{
        audioPath: string
        startSeconds: number
        endSeconds: number
        sourceStartSeconds: number
        visualizer: {
          style: 'wave_line' | 'wave_fill' | 'spectrum_bars'
          fgColor: string
          bgColor: string | 'transparent'
          opacity: number
          scale: 'linear' | 'log'
        }
      }> = []
      const sortedViz = narration
        .slice()
        .map((n) => ({
          ...n,
          startSeconds: roundToTenth(Math.max(0, Number((n as any).startSeconds || 0))),
          endSeconds: roundToTenth(Math.max(0, Number((n as any).endSeconds || 0))),
          sourceStartSeconds: roundToTenth(Math.max(0, Number((n as any).sourceStartSeconds || 0))),
          audioEnabled: (n as any).audioEnabled == null ? true : Boolean((n as any).audioEnabled),
          visualizer: normalizeNarrationVisualizerConfig((n as any).visualizer),
        }))
        .filter((n) => n.audioEnabled !== false && n.visualizer.enabled && Number(n.endSeconds) > Number(n.startSeconds))
        .sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))

      if (sortedViz.length) {
        const narrationDownloads = new Map<number, string>()
        for (const seg of sortedViz) {
          const uploadId = Number(seg.uploadId)
          const row = byId.get(uploadId)
          if (!row) throw new Error('upload_not_found')
          if (String(row.kind || '').toLowerCase() !== 'audio') throw new Error('invalid_upload_kind')
          const oid = row.user_id != null ? Number(row.user_id) : null
          if (!(oid === userId || oid == null)) throw new Error('forbidden')
          if (Number(row.is_system || 0)) throw new Error('forbidden')
          if (row.source_deleted_at) throw new Error('source_deleted')
          const st = String(row.status || '').toLowerCase()
          if (!(st === 'uploaded' || st === 'completed')) throw new Error('invalid_upload_status')

          let audioPath = narrationDownloads.get(uploadId)
          if (!audioPath) {
            const ext = path.extname(String(row.s3_key || '')) || '.m4a'
            audioPath = path.join(tmpDir, `narr_viz_${uploadId}${ext}`)
            await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), audioPath)
            narrationDownloads.set(uploadId, audioPath)
          }

          const startSeconds = clamp(roundToTenth(Number(seg.startSeconds || 0)), 0, Math.max(0, baseDurationSeconds))
          const endSeconds = clamp(roundToTenth(Number(seg.endSeconds || 0)), 0, Math.max(0, baseDurationSeconds))
          if (!(endSeconds > startSeconds + 0.05)) continue
          const sourceStartSeconds = clamp(roundToTenth(Number(seg.sourceStartSeconds || 0)), 0, 20 * 60)
          visuals.push({
            audioPath,
            startSeconds,
            endSeconds,
            sourceStartSeconds,
            visualizer: seg.visualizer,
          })
        }
      }

      if (visuals.length) {
        const outViz = path.join(tmpDir, 'out_narration_visualizer.mp4')
        await overlayNarrationVisualizers({
          baseMp4Path: finalOut,
          outPath: outViz,
          visuals,
          targetW: target.w,
          targetH: target.h,
          durationSeconds: baseDurationSeconds,
          logPaths,
        })
        finalOut = outViz
      }
    }

    if (logos.length) {
      const logoDownloads = new Map<number, { path: string; w: number; h: number }>()
      const sorted = logos
        .slice()
        .map((l) => ({
          ...l,
          startSeconds: roundToTenth(Math.max(0, Number((l as any).startSeconds || 0))),
          endSeconds: roundToTenth(Math.max(0, Number((l as any).endSeconds || 0))),
        }))
        .filter((l) => Number.isFinite(Number((l as any).startSeconds)) && Number.isFinite(Number((l as any).endSeconds)) && Number((l as any).endSeconds) > Number((l as any).startSeconds))
        .sort((a, b) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String((a as any).id).localeCompare(String((b as any).id)))

      const overlays: Array<{ pngPath: string; imgW: number; imgH: number; cfg: any; startSeconds: number; endSeconds: number }> = []

      for (let i = 0; i < sorted.length; i++) {
        const l: any = sorted[i] as any
        const uploadId = Number(l.uploadId)
        const row = byId.get(uploadId)
        if (!row) throw new Error('upload_not_found')
        if (String(row.kind || '').toLowerCase() !== 'logo') throw new Error('invalid_upload_kind')
        const oid = row.user_id != null ? Number(row.user_id) : null
        if (!(oid === userId || oid == null)) throw new Error('forbidden')
        const st = String(row.status || '').toLowerCase()
        if (!(st === 'uploaded' || st === 'completed')) throw new Error('invalid_upload_status')
        if (row.source_deleted_at) throw new Error('source_deleted')

        let entry = logoDownloads.get(uploadId)
        if (!entry) {
          const p = path.join(tmpDir, `logo_${uploadId}_${String(i).padStart(3, '0')}.png`)
          await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), p)
          let w = row.width != null ? Number(row.width) : NaN
          let h = row.height != null ? Number(row.height) : NaN
          if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) {
            const dims = await probeVideoDisplayDimensions(p)
            w = dims.width
            h = dims.height
          }
          entry = { path: p, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
          logoDownloads.set(uploadId, entry)
        }

        const segStart = clamp(roundToTenth(Number(l.startSeconds)), 0, Math.max(0, baseDurationSeconds))
        const segEnd = clamp(roundToTenth(Number(l.endSeconds)), 0, Math.max(0, baseDurationSeconds))
        if (!(segEnd > segStart + 0.01)) continue
        const sizeRaw = l.sizePctWidth == null ? 20 : Number(l.sizePctWidth)
        const sizePctWidth = Number.isFinite(sizeRaw) ? Math.max(1, Math.min(100, Math.round(sizeRaw))) : 20
        const opacityRaw = l.opacityPct == null ? 100 : Number(l.opacityPct)
        const opacityPct = Number.isFinite(opacityRaw) ? Math.max(0, Math.min(100, Math.round(opacityRaw))) : 100
        const insetXRaw = l.insetXPx == null ? 24 : Number(l.insetXPx)
        const insetYRaw = l.insetYPx == null ? 24 : Number(l.insetYPx)
        const insetXPx = Number.isFinite(insetXRaw) ? Math.max(0, Math.min(9999, Math.round(insetXRaw))) : 100
        const insetYPx = Number.isFinite(insetYRaw) ? Math.max(0, Math.min(9999, Math.round(insetYRaw))) : 100

        const posRaw = String(l.position || 'top_left').toLowerCase()
        const position =
          posRaw === 'center'
            ? 'center'
            : (posRaw as any)
        const fadeRaw = String(l.fade || 'none').toLowerCase()
        const fade = fadeRaw === 'in' || fadeRaw === 'out' || fadeRaw === 'in_out' ? fadeRaw : 'none'

        const cfg = {
          position,
          sizePctWidth,
          opacityPct,
          fade,
          insetXPx,
          insetYPx,
        }

        overlays.push({
          pngPath: entry.path,
          imgW: entry.w,
          imgH: entry.h,
          cfg,
          startSeconds: segStart,
          endSeconds: segEnd,
        })
      }

      if (overlays.length) {
        const outLogo = path.join(tmpDir, 'out_logo.mp4')
        await burnPngOverlaysIntoMp4({
          inPath: finalOut,
          outPath: outLogo,
          videoDurationSeconds: baseDurationSeconds,
          overlays: overlays.map((o) => ({
            pngPath: o.pngPath,
            imgW: o.imgW,
            imgH: o.imgH,
            cfg: o.cfg,
            startSeconds: o.startSeconds,
            endSeconds: o.endSeconds,
          })),
          logPaths,
        })
        finalOut = outLogo
      }
    }

    if (graphics.length) {
      const imageDownloads = new Map<number, string>()
      const sorted = graphics.slice().sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds))
      const overlays: Array<{
        startSeconds: number
        endSeconds: number
        imagePath: string
        fitMode?: 'cover_full' | 'contain_transparent'
        sizePctWidth?: number
        position?: string
        insetXPx?: number
        insetYPx?: number
        borderWidthPx?: number
        borderColor?: string
        fade?: 'none' | 'in' | 'out' | 'in_out'
        fadeDurationMs?: number
        animate?: 'none' | 'slide_in' | 'slide_out' | 'slide_in_out' | 'doc_reveal'
        animateDurationMs?: number
      }> = []
      for (let i = 0; i < sorted.length; i++) {
        const g = sorted[i]
        const uploadId = Number(g.uploadId)
        const row = byId.get(uploadId)
        if (!row) throw new Error('upload_not_found')
        if (String(row.kind || '').toLowerCase() !== 'image') throw new Error('invalid_upload_kind')
        const oid = row.user_id != null ? Number(row.user_id) : null
        if (!(oid === userId || oid == null)) throw new Error('forbidden')
        const ext = path.extname(String(row.s3_key || '')).toLowerCase() || '.img'
        // Avoid filenames ending in digits (e.g. img_84_000.jpg), because the image2 demuxer can interpret them as a numbered sequence.
        const inPath = imageDownloads.get(uploadId) || path.join(tmpDir, `img_${uploadId}_still${ext}`)
        if (!imageDownloads.has(uploadId)) {
          await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), inPath)
          imageDownloads.set(uploadId, inPath)
        }
        overlays.push({
          startSeconds: Number(g.startSeconds),
          endSeconds: Number(g.endSeconds),
          imagePath: inPath,
          fitMode: (g as any).fitMode != null ? (String((g as any).fitMode) as any) : undefined,
          sizePctWidth: (g as any).sizePctWidth != null ? Number((g as any).sizePctWidth) : undefined,
          position: (g as any).position != null ? String((g as any).position) : undefined,
          insetXPx: (g as any).insetXPx != null ? Number((g as any).insetXPx) : undefined,
          insetYPx: (g as any).insetYPx != null ? Number((g as any).insetYPx) : undefined,
          borderWidthPx: (g as any).borderWidthPx != null ? Number((g as any).borderWidthPx) : undefined,
          borderColor: (g as any).borderColor != null ? String((g as any).borderColor) : undefined,
          fade: (g as any).fade != null ? (String((g as any).fade) as any) : undefined,
          fadeDurationMs: (g as any).fadeDurationMs != null ? Number((g as any).fadeDurationMs) : undefined,
          animate: (g as any).animate != null ? (String((g as any).animate) as any) : undefined,
          animateDurationMs: (g as any).animateDurationMs != null ? Number((g as any).animateDurationMs) : undefined,
        })
      }
      const overlayOut = path.join(tmpDir, 'out_overlay.mp4')
      await overlayGraphics({
        baseMp4Path: finalOut,
        outPath: overlayOut,
        graphics: overlays,
        targetW: target.w,
        targetH: target.h,
        durationSeconds: baseDurationSeconds,
        logPaths,
      })
      finalOut = overlayOut
    }

    // Apply narration first so that Opener Cutoff can detect speech from narration (and any overlay audio already present in the timeline).
    let narrationMixed = false
    if (narration.length) {
      const sorted = narration
        .slice()
        .map((n) => ({
          ...n,
          startSeconds: roundToTenth(Math.max(0, Number((n as any).startSeconds || 0))),
          endSeconds: roundToTenth(Math.max(0, Number((n as any).endSeconds || 0))),
          sourceStartSeconds: roundToTenth(Math.max(0, Number((n as any).sourceStartSeconds || 0))),
          audioEnabled: (n as any).audioEnabled == null ? true : Boolean((n as any).audioEnabled),
          boostDb: normalizeBoostDb((n as any).boostDb),
          gainDb: Number.isFinite(Number((n as any).gainDb)) ? Number((n as any).gainDb) : 0,
        }))
        .filter((n) => n.audioEnabled !== false && Number(n.endSeconds) > Number(n.startSeconds))
        .sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))

      const narrationDownloads = new Map<number, string>()
      const segmentsForMix: Array<{ audioPath: string; startSeconds: number; endSeconds: number; sourceStartSeconds: number; gainDb: number }> = []

      const videoDur = (await probeDurationSeconds(finalOut)) ?? baseDurationSeconds
      for (const seg of sorted) {
        const uploadId = Number(seg.uploadId)
        const row = byId.get(uploadId)
        if (!row) throw new Error('upload_not_found')
        if (String(row.kind || '').toLowerCase() !== 'audio') throw new Error('invalid_upload_kind')
        const oid = row.user_id != null ? Number(row.user_id) : null
        if (!(oid === userId || oid == null)) throw new Error('forbidden')
        if (Number(row.is_system || 0)) throw new Error('forbidden')
        if (row.source_deleted_at) throw new Error('source_deleted')
        const st = String(row.status || '').toLowerCase()
        if (!(st === 'uploaded' || st === 'completed')) throw new Error('invalid_upload_status')

        let audioPath = narrationDownloads.get(uploadId)
        if (!audioPath) {
          const ext = path.extname(String(row.s3_key || '')) || '.m4a'
          audioPath = path.join(tmpDir, `narr_${uploadId}${ext}`)
          await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), audioPath)
          narrationDownloads.set(uploadId, audioPath)
        }

        const startSeconds = clamp(roundToTenth(Number(seg.startSeconds || 0)), 0, Math.max(0, videoDur))
        const endSeconds = clamp(roundToTenth(Number(seg.endSeconds || 0)), 0, Math.max(0, videoDur))
        if (!(endSeconds > startSeconds + 0.05)) continue
        const sourceStartSeconds = clamp(roundToTenth(Number((seg as any).sourceStartSeconds || 0)), 0, 20 * 60)
        const gainDb = clamp(Number((seg as any).boostDb != null ? (seg as any).boostDb : seg.gainDb || 0), -12, 12)
        segmentsForMix.push({ audioPath, startSeconds, endSeconds, sourceStartSeconds, gainDb })
      }

      if (segmentsForMix.length) {
        const outWithNarration = path.join(tmpDir, 'out_narration.mp4')
        await applyNarrationSegmentsToMp4({
          inMp4Path: finalOut,
          outMp4Path: outWithNarration,
          segments: segmentsForMix,
          logPaths,
        })
        finalOut = outWithNarration
        narrationMixed = true
      }
    }

    if (audioSegments.length) {
      const enabledSegments = audioSegments.filter((s) => (s as any).audioEnabled !== false)
      if (enabledSegments.length) {
        const videoDur = (await probeDurationSeconds(finalOut)) ?? baseDurationSeconds

        const segmentsWithCfg = enabledSegments.map((s) => ({
          seg: s,
          musicMode: String((s as any).musicMode || '').toLowerCase(),
          musicLevel: String((s as any).musicLevel || '').toLowerCase(),
          duckingIntensity: (s as any).duckingIntensity == null ? null : String((s as any).duckingIntensity || '').toLowerCase(),
        }))

        for (const { musicMode, musicLevel, duckingIntensity } of segmentsWithCfg) {
          if (!musicMode || !musicLevel) throw new Error('music_config_required')
          if (!['opener_cutoff', 'replace', 'mix', 'mix_duck'].includes(musicMode)) throw new Error('music_config_required')
          if (!['quiet', 'medium', 'loud'].includes(musicLevel)) throw new Error('music_config_required')
          if (musicMode === 'mix_duck' && !duckingIntensity) throw new Error('music_config_required')
          if (musicMode === 'mix_duck' && !['min', 'medium', 'max'].includes(String(duckingIntensity))) throw new Error('music_config_required')
        }

        const hasOpener = segmentsWithCfg.some((x) => x.musicMode === 'opener_cutoff')
        if (hasOpener && enabledSegments.length !== 1) throw new Error('opener_cutoff_requires_single_segment')

        const groups = new Map<
          string,
          { uploadId: number; mode: MusicMode; level: MusicLevel; duckingIntensity?: DuckingIntensity; segs: any[] }
        >()
        for (const x of segmentsWithCfg) {
          const uploadId = Number((x.seg as any).uploadId)
          if (!Number.isFinite(uploadId) || uploadId <= 0) throw new Error('upload_not_found')
          const mode = x.musicMode as MusicMode
          const level = x.musicLevel as MusicLevel
          const intensity = x.duckingIntensity ? (x.duckingIntensity as DuckingIntensity) : undefined
          const key = `${uploadId}|${mode}|${level}|${intensity || ''}`
          const g = groups.get(key) || { uploadId, mode, level, duckingIntensity: intensity, segs: [] as any[] }
          g.segs.push(x.seg)
          groups.set(key, g)
        }

        const sortedGroups = Array.from(groups.values()).sort((a, b) => {
          const aMin = Math.min(...a.segs.map((s) => Number((s as any).startSeconds || 0)))
          const bMin = Math.min(...b.segs.map((s) => Number((s as any).startSeconds || 0)))
          return aMin - bMin
        })

        for (let gi = 0; gi < sortedGroups.length; gi++) {
          const g = sortedGroups[gi]
          const cfg = buildMusicAudioConfig({ mode: g.mode, level: g.level, duckingIntensity: g.duckingIntensity })

          const trackUploadId = Number(g.uploadId)
          if (!Number.isFinite(trackUploadId) || trackUploadId <= 0) throw new Error('upload_not_found')
          const row = byId.get(trackUploadId)
          if (!row) throw new Error('upload_not_found')
          if (String(row.kind || '').toLowerCase() !== 'audio') throw new Error('invalid_upload_kind')
          // Allow system audio for all creators; allow user audio only when owned by the project user.
          const isSystem = Number(row.is_system || 0) === 1
          const ownerId = Number(row.user_id || 0)
          if (!isSystem && ownerId !== userId) throw new Error('forbidden')
          if (row.source_deleted_at) throw new Error('source_deleted')
          const st = String(row.status || '').toLowerCase()
          if (!(st === 'uploaded' || st === 'completed')) throw new Error('invalid_upload_status')

          const audioPath = path.join(tmpDir, `audio_${trackUploadId}`)
          await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), audioPath)

          const clampedSegments = g.segs
            .slice()
            .map((s) => ({
              startSeconds: clamp(roundToTenth(Number((s as any).startSeconds || 0)), 0, Math.max(0, videoDur)),
              endSeconds: clamp(roundToTenth(Number((s as any).endSeconds || 0)), 0, Math.max(0, videoDur)),
              sourceStartSeconds: roundToTenth(Math.max(0, Number((s as any).sourceStartSeconds || 0))),
            }))
            .filter((s) => s.endSeconds > s.startSeconds + 0.05)
            .sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || Number(a.endSeconds) - Number(b.endSeconds))

          if (!clampedSegments.length) continue

          const outWithAudio = path.join(tmpDir, `out_audio_${String(gi).padStart(2, '0')}.mp4`)
          // If narration was mixed in, it already normalized voice; don't normalize again while adding music.
          const normalizeThisPass = narrationMixed ? false : gi === sortedGroups.length - 1
          await applyAudioSegmentsToMp4({
            inMp4Path: finalOut,
            outMp4Path: outWithAudio,
            audioPath,
            audioConfig: cfg,
            segments: clampedSegments,
            normalizeAudio: normalizeThisPass ? undefined : false,
            logPaths,
          })
          finalOut = outWithAudio
        }
      }
    }

    const stat = fs.statSync(finalOut)
    const durationSeconds = await probeDurationSeconds(finalOut)
    const metricsInput = await probeMediaInfo(finalOut)
    const { ymd, folder } = nowDateYmd()
    const assetUuid = randomUUID()
    const key = buildExportKey(String(UPLOAD_PREFIX || ''), folder, assetUuid, '.mp4')
    const bucket = String(UPLOAD_BUCKET || '')
    if (!bucket) throw new Error('missing_upload_bucket')
    await uploadFileToS3(bucket, key, finalOut, 'video/mp4')

    const uploadId = await insertGeneratedUpload({
      userId,
      projectId: Number(input.projectId),
      bucket,
      key,
      sizeBytes: Number(stat.size || 0),
      width: target.w,
      height: target.h,
      durationSeconds: durationSeconds != null ? Math.round(durationSeconds) : null,
      assetUuid,
      dateYmd: ymd,
    })

    return { resultUploadId: uploadId, output: { bucket, key, s3Url: `s3://${bucket}/${key}` }, ffmpegCommands, metricsInput }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
