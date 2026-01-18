import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { getPool } from '../../db'
import { MEDIA_CONVERT_NORMALIZE_AUDIO, UPLOAD_BUCKET, UPLOAD_PREFIX } from '../../config'
import { buildUploadKey, nowDateYmd } from '../../utils/naming'
import { downloadS3ObjectToFile, runFfmpeg, uploadFileToS3 } from '../../services/ffmpeg/audioPipeline'
import { burnPngOverlaysIntoMp4, probeVideoDisplayDimensions } from '../../services/ffmpeg/visualPipeline'
import * as audioConfigsSvc from '../../features/audio-configs/service'

type Clip = {
  id: string
  uploadId: number
  startSeconds?: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  freezeStartSeconds?: number
  freezeEndSeconds?: number
}
type Graphic = { id: string; uploadId: number; startSeconds: number; endSeconds: number }
type Still = { id: string; uploadId: number; startSeconds: number; endSeconds: number; sourceClipId?: string }
type Logo = { id: string; uploadId: number; startSeconds: number; endSeconds: number; configId: number; configSnapshot: any }
type LowerThird = { id: string; uploadId: number; startSeconds: number; endSeconds: number; configId: number; configSnapshot: any }
type ScreenTitle = { id: string; startSeconds: number; endSeconds: number; presetId: number | null; presetSnapshot: any | null; text?: string; renderUploadId: number | null }
type AudioTrack = { uploadId: number; audioConfigId: number; startSeconds: number; endSeconds: number }
type Narration = { id: string; uploadId: number; startSeconds: number; endSeconds: number; sourceStartSeconds?: number; gainDb?: number }

export type CreateVideoExportV1Input = {
  projectId: number
  userId: number
  timeline: {
    version: 'create_video_v1'
    clips: Clip[]
    stills?: Still[]
    graphics?: Graphic[]
    logos?: Logo[]
    lowerThirds?: LowerThird[]
    screenTitles?: ScreenTitle[]
    narration?: Narration[]
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
  logPaths?: { stdoutPath?: string; stderrPath?: string }
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

async function applyNarrationSegmentsToMp4(opts: {
  inMp4Path: string
  outMp4Path: string
  segments: Array<{ audioPath: string; startSeconds: number; endSeconds: number; sourceStartSeconds: number; gainDb: number }>
  logPaths?: { stdoutPath?: string; stderrPath?: string }
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
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}) {
  const dur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!(dur > 0)) throw new Error('invalid_duration')
  const fps = Math.max(15, Math.min(60, Math.round(Number(opts.fps || 30))))
  await runFfmpeg(
    [
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=${opts.targetW}x${opts.targetH}:d=${dur}:r=${fps}`,
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

async function overlayFullFrameGraphics(opts: {
  baseMp4Path: string
  outPath: string
  graphics: Array<{ startSeconds: number; endSeconds: number; imagePath: string }>
  targetW: number
  targetH: number
  durationSeconds: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}) {
  const baseDur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!opts.graphics.length) throw new Error('no_graphics')

  const args: string[] = ['-i', opts.baseMp4Path]
  for (const g of opts.graphics) {
    args.push('-loop', '1', '-t', String(baseDur), '-i', g.imagePath)
  }

  const filters: string[] = []
  for (let i = 0; i < opts.graphics.length; i++) {
    const inIdx = i + 1
    filters.push(
      `[${inIdx}:v]scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=increase,crop=${opts.targetW}:${opts.targetH},format=rgba[img${i}]`
    )
  }

  let current = '[0:v]'
  for (let i = 0; i < opts.graphics.length; i++) {
    const g = opts.graphics[i]
    const s = roundToTenth(Number(g.startSeconds))
    const e = roundToTenth(Number(g.endSeconds))
    const next = `[v${i + 1}]`
    filters.push(`${current}[img${i}]overlay=0:0:enable='between(t,${s},${e})'${next}`)
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

async function overlayFullFrameScreenTitles(opts: {
  baseMp4Path: string
  outPath: string
  screenTitles: Array<{ startSeconds: number; endSeconds: number; imagePath: string; fade: 'none' | 'in' | 'out' | 'in_out' }>
  targetW: number
  targetH: number
  durationSeconds: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
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
  freezeStartSeconds?: number
  freezeEndSeconds?: number
  targetW: number
  targetH: number
  fps: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
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

  const scalePad = `scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=decrease,pad=${opts.targetW}:${opts.targetH}:(ow-iw)/2:(oh-ih)/2`
  const tpad = freezeStart > 0.01 || freezeEnd > 0.01
    ? `,tpad=start_mode=clone:start_duration=${freezeStart.toFixed(3)}:stop_mode=clone:stop_duration=${freezeEnd.toFixed(3)}`
    : ''
  const v = `trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${scalePad},fps=${fps},format=yuv420p${tpad}`

  const delayMs = Math.max(0, Math.round(freezeStart * 1000))
  const delay = delayMs > 0 ? `,adelay=${delayMs}:all=1` : ''
  const a = hasAudio
    ? `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS${delay},apad,atrim=0:${totalDur.toFixed(3)},asetpts=N/SR/TB`
    : `anullsrc=r=48000:cl=stereo,atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS`

  await runFfmpeg(
    [
      '-i',
      opts.inPath,
      '-filter_complex',
      `[0:v]${v}[v];${a}[a]`,
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
  targetW: number
  targetH: number
  fps: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}) {
  const dur = roundToTenth(Math.max(0, Number(opts.durationSeconds)))
  if (!(dur > 0.05)) throw new Error('invalid_still_duration')
  const fps = Math.max(15, Math.min(60, Math.round(Number(opts.fps || 30))))
  const v = `scale=${opts.targetW}:${opts.targetH}:force_original_aspect_ratio=increase,crop=${opts.targetW}:${opts.targetH},fps=${fps},format=yuv420p`
  await runFfmpeg(
    [
      '-loop',
      '1',
      '-t',
      String(dur),
      '-i',
      opts.imagePath,
      '-f',
      'lavfi',
      '-t',
      String(dur),
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-shortest',
      '-filter_complex',
      `[0:v]${v}[v]`,
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
}

async function insertGeneratedUpload(input: {
  userId: number
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
    `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status, kind, user_id)
     VALUES (?, ?, 'video.mp4', NULL, NULL, 'video/mp4', ?, ?, ?, ?, ?, ?, 'uploaded', 'video', ?)`,
    [input.bucket, input.key, input.sizeBytes, input.width, input.height, input.durationSeconds, input.assetUuid, input.dateYmd, input.userId]
  )
  return Number((result as any).insertId)
}

export async function runCreateVideoExportV1Job(
  input: CreateVideoExportV1Input,
  logPaths?: { stdoutPath?: string; stderrPath?: string }
): Promise<{ resultUploadId: number; output: { bucket: string; key: string; s3Url: string } }> {
  const userId = Number(input.userId)
  const clips = Array.isArray(input.timeline?.clips) ? input.timeline.clips : []
  const stills = Array.isArray((input.timeline as any)?.stills) ? ((input.timeline as any).stills as Still[]) : []
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
      gainDb: (n as any).gainDb == null ? undefined : Number((n as any).gainDb),
    }))
    .filter((n) => n.id && Number.isFinite(n.uploadId) && n.uploadId > 0 && Number.isFinite(n.startSeconds) && Number.isFinite(n.endSeconds))
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
  if (!clips.length && !stills.length && !graphics.length) throw new Error('empty_timeline')

  const db = getPool()
  const ids = Array.from(
    new Set(
      [
        ...clips.map((c) => Number(c.uploadId)),
        ...stills.map((s) => Number((s as any).uploadId)),
        ...graphics.map((g) => Number(g.uploadId)),
        ...logos.map((l) => Number((l as any).uploadId)),
        ...lowerThirds.map((lt) => Number((lt as any).uploadId)),
        ...screenTitles.map((st) => Number((st as any).renderUploadId)),
        ...narration.map((n) => Number((n as any).uploadId)),
        ...(audioTrack ? [Number(audioTrack.uploadId)] : []),
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
    const sortedStills: Still[] = stills
      .map((s) => ({
        ...s,
        startSeconds: roundToTenth(Math.max(0, Number((s as any).startSeconds || 0))),
        endSeconds: roundToTenth(Math.max(0, Number((s as any).endSeconds || 0))),
      }))
      .filter((s) => Number.isFinite(Number(s.startSeconds)) && Number.isFinite(Number(s.endSeconds)) && Number(s.endSeconds) > Number(s.startSeconds))
      .sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))

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
    const narrationEnd = narration.length
      ? Number(narration.slice().sort((a, b) => Number((a as any).endSeconds) - Number((b as any).endSeconds))[narration.length - 1].endSeconds)
      : 0
    const audioEnd = audioTrack ? Number(audioTrack.endSeconds || 0) : 0
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
        target = { w: computed.w, h: computed.h }
        seenDownloads.set(Number(first.uploadId), firstIn)
      }

      // Render base-track segments (clips + stills), filling gaps with black.
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
          await renderSegmentMp4({
            inPath,
            outPath,
            startSeconds: Number(c.sourceStartSeconds || 0),
            endSeconds: Number(c.sourceEndSeconds || 0),
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
        const outPath = path.join(tmpDir, `seg_still_${String(i).padStart(3, '0')}.mp4`)
        await renderStillSegmentMp4({
          imagePath: inPath,
          outPath,
          durationSeconds: roundToTenth(endSeconds - startSeconds),
          targetW: target.w,
          targetH: target.h,
          fps,
          logPaths,
        })
        segPaths.push(outPath)
        cursorSeconds = endSeconds
      }

      const targetEnd = roundToTenth(
        Math.max(cursorSeconds, graphicsEnd, screenTitlesEnd, audioEnd, narrationEnd, logosEnd, lowerThirdsEnd)
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
      baseDurationSeconds = roundToTenth(Math.max(0, graphicsEnd, screenTitlesEnd, audioEnd, logosEnd, lowerThirdsEnd))
      if (!(baseDurationSeconds > 0)) throw new Error('invalid_duration')
      await renderBlackBaseMp4({
        outPath: baseOut,
        durationSeconds: baseDurationSeconds,
        targetW: target.w,
        targetH: target.h,
        fps,
        logPaths,
      })
    }

    let finalOut = baseOut
    if (graphics.length) {
      const imageDownloads = new Map<number, string>()
      const sorted = graphics.slice().sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds))
      const overlays: Array<{ startSeconds: number; endSeconds: number; imagePath: string }> = []
      for (let i = 0; i < sorted.length; i++) {
        const g = sorted[i]
        const uploadId = Number(g.uploadId)
        const row = byId.get(uploadId)
        if (!row) throw new Error('upload_not_found')
        if (String(row.kind || '').toLowerCase() !== 'image') throw new Error('invalid_upload_kind')
        const oid = row.user_id != null ? Number(row.user_id) : null
        if (!(oid === userId || oid == null)) throw new Error('forbidden')
        const inPath = imageDownloads.get(uploadId) || path.join(tmpDir, `img_${uploadId}_${String(i).padStart(3, '0')}`)
        if (!imageDownloads.has(uploadId)) {
          await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), inPath)
          imageDownloads.set(uploadId, inPath)
        }
        overlays.push({ startSeconds: Number(g.startSeconds), endSeconds: Number(g.endSeconds), imagePath: inPath })
      }
      const overlayOut = path.join(tmpDir, 'out_overlay.mp4')
      await overlayFullFrameGraphics({
        baseMp4Path: baseOut,
        outPath: overlayOut,
        graphics: overlays,
        targetW: target.w,
        targetH: target.h,
        durationSeconds: baseDurationSeconds,
        logPaths,
      })
      finalOut = overlayOut
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
        const segDur = roundToTenth(segEnd - segStart)

        const cfg = l.configSnapshot && typeof l.configSnapshot === 'object' ? l.configSnapshot : {}
        const rule = String(cfg.timingRule || 'entire').toLowerCase()
        const secsRaw = cfg.timingSeconds == null ? null : Number(cfg.timingSeconds)
        const secs = secsRaw != null && Number.isFinite(secsRaw) ? Math.max(0, Math.min(3600, secsRaw)) : null

        let startRel = 0
        let endRel = segDur
        if (rule === 'start_after') {
          startRel = Math.min(segDur, secs ?? 0)
          endRel = segDur
        } else if (rule === 'first_only') {
          endRel = Math.max(0, Math.min(segDur, secs ?? 0))
        } else if (rule === 'last_only') {
          const d = Math.max(0, Math.min(segDur, secs ?? segDur))
          startRel = Math.max(0, segDur - d)
          endRel = segDur
        }

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

    if (audioTrack && Number.isFinite(audioTrack.uploadId) && audioTrack.uploadId > 0) {
      const row = byId.get(Number(audioTrack.uploadId))
      if (!row) throw new Error('upload_not_found')
      if (String(row.kind || '').toLowerCase() !== 'audio') throw new Error('invalid_upload_kind')
      if (!Number(row.is_system || 0)) throw new Error('forbidden')
      if (row.source_deleted_at) throw new Error('source_deleted')
      const st = String(row.status || '').toLowerCase()
      if (!(st === 'uploaded' || st === 'completed')) throw new Error('invalid_upload_status')

      const cfg = await audioConfigsSvc.getActiveForUser(Number(audioTrack.audioConfigId), userId)
      const audioPath = path.join(tmpDir, `audio_${Number(audioTrack.uploadId)}`)
      await downloadS3ObjectToFile(String(row.s3_bucket), String(row.s3_key), audioPath)

      const videoDur = (await probeDurationSeconds(finalOut)) ?? baseDurationSeconds
      const start = clamp(roundToTenth(Number(audioTrack.startSeconds || 0)), 0, Math.max(0, videoDur))
      const end = clamp(roundToTenth(Number(audioTrack.endSeconds || 0)), 0, Math.max(0, videoDur))
      if (end > start + 0.05) {
        const outWithAudio = path.join(tmpDir, 'out_audio.mp4')
        await applyAudioTrackToMp4({
          inMp4Path: finalOut,
          outMp4Path: outWithAudio,
          audioPath,
          audioConfig: cfg,
          trackStartSeconds: start,
          trackEndSeconds: end,
          normalizeAudio: narration.length ? false : undefined,
          logPaths,
        })
        finalOut = outWithAudio
      }
    }

    if (narration.length) {
      const sorted = narration
        .slice()
        .map((n) => ({
          ...n,
          startSeconds: roundToTenth(Math.max(0, Number((n as any).startSeconds || 0))),
          endSeconds: roundToTenth(Math.max(0, Number((n as any).endSeconds || 0))),
          sourceStartSeconds: roundToTenth(Math.max(0, Number((n as any).sourceStartSeconds || 0))),
          gainDb: Number.isFinite(Number((n as any).gainDb)) ? Number((n as any).gainDb) : 0,
        }))
        .filter((n) => Number(n.endSeconds) > Number(n.startSeconds))
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
        const gainDb = clamp(Number(seg.gainDb || 0), -12, 12)
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
      }
    }

    const stat = fs.statSync(finalOut)
    const durationSeconds = await probeDurationSeconds(finalOut)
    const { ymd, folder } = nowDateYmd()
    const assetUuid = randomUUID()
    const key = buildUploadKey(String(UPLOAD_PREFIX || ''), folder, assetUuid, '.mp4', 'video')
    const bucket = String(UPLOAD_BUCKET || '')
    if (!bucket) throw new Error('missing_upload_bucket')
    await uploadFileToS3(bucket, key, finalOut, 'video/mp4')

    const uploadId = await insertGeneratedUpload({
      userId,
      bucket,
      key,
      sizeBytes: Number(stat.size || 0),
      width: target.w,
      height: target.h,
      durationSeconds: durationSeconds != null ? Math.round(durationSeconds) : null,
      assetUuid,
      dateYmd: ymd,
    })

    return { resultUploadId: uploadId, output: { bucket, key, s3Url: `s3://${bucket}/${key}` } }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
