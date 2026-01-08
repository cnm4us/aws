import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { pipeline } from 'stream/promises'
import { s3 } from '../s3'

type ScreenTitleV1 = {
  text: string
  preset: {
    style?: 'pill' | 'outline' | 'strip'
    fontKey?: string
    fontSizePct?: number
    fontColor?: string
    pillBgColor?: string
    pillBgOpacityPct?: number
    position?: 'top' | 'middle' | 'bottom' | 'top_left' | 'top_center' | 'top_right' | 'bottom_left' | 'bottom_center' | 'bottom_right'
    maxWidthPct?: number
    insetXPreset?: 'small' | 'medium' | 'large' | null
    insetYPreset?: 'small' | 'medium' | 'large' | null
    timingRule?: 'entire' | 'first_only'
    timingSeconds?: number | null
    fade?: 'none' | 'in' | 'out' | 'in_out'
  }
}

export type ScreenTitleOverlayPngsV1 = {
  portrait: { bucket: string; key: string; s3Url: string }
  landscape: { bucket: string; key: string; s3Url: string }
}

function normalizeScreenTitlePosition(pos: any): 'top' | 'middle' | 'bottom' {
  const raw = String(pos || 'top').trim().toLowerCase()
  if (raw === 'middle' || raw === 'center' || raw === 'middle_center') return 'middle'
  if (raw === 'bottom' || raw.startsWith('bottom_')) return 'bottom'
  if (raw.startsWith('top_')) return 'top'
  return raw === 'top' ? 'top' : 'top'
}

function parsePositiveIntEnv(name: string): number | null {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') return null
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  return rounded > 0 ? rounded : null
}

export function ymdToFolder(ymd: string): string {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(ymd || '')
  return `${m[1]}-${m[2]}/${m[3]}`
}

export function parseS3Url(url: string): { bucket: string; key: string } | null {
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

export async function downloadS3ObjectToFile(bucket: string, key: string, filePath: string): Promise<void> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const body = resp.Body as any
  if (!body) throw new Error('missing_s3_body')
  await pipeline(body, fs.createWriteStream(filePath))
}

export async function uploadFileToS3(bucket: string, key: string, filePath: string, contentType: string): Promise<void> {
  const body = fs.createReadStream(filePath)
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'no-store' })
  )
}

export async function runFfmpeg(
  args: string[],
  opts?: { stdoutPath?: string; stderrPath?: string }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const filterThreads = parsePositiveIntEnv('FFMPEG_FILTER_THREADS')
    const filterComplexThreads = parsePositiveIntEnv('FFMPEG_FILTER_COMPLEX_THREADS')
    const threads = parsePositiveIntEnv('FFMPEG_THREADS')
    const nice = parsePositiveIntEnv('FFMPEG_NICE')

    const injected: string[] = ['-hide_banner', '-y']
    if (filterThreads) injected.push('-filter_threads', String(filterThreads))
    if (filterComplexThreads) injected.push('-filter_complex_threads', String(filterComplexThreads))

    const hasThreadsFlag = args.includes('-threads')
    const finalArgs = threads && !hasThreadsFlag ? [...args.slice(0, -1), '-threads', String(threads), args[args.length - 1]] : args

    const p = spawn('ffmpeg', [...injected, ...finalArgs], { stdio: ['ignore', 'pipe', 'pipe'] })
    if (nice && p.pid) {
      try { os.setPriority(p.pid, Math.min(19, Math.max(0, nice))) } catch {}
    }
    const outStream = opts?.stdoutPath ? fs.createWriteStream(opts.stdoutPath, { flags: 'a' }) : null
    const errStream = opts?.stderrPath ? fs.createWriteStream(opts.stderrPath, { flags: 'a' }) : null
    if (outStream) p.stdout.pipe(outStream)
    if (errStream) p.stderr.pipe(errStream)
    let stderr = ''
    const maxStderr = 8000
    p.stderr.on('data', (d) => {
      stderr = (stderr + String(d)).slice(-maxStderr)
    })
    p.on('error', reject)
    p.on('close', (code) => {
      try { outStream?.end() } catch {}
      try { errStream?.end() } catch {}
      if (code === 0) return resolve()
      reject(new Error(`ffmpeg_failed:${code}:${stderr.slice(0, 800)}`))
    })
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

async function detectInitialNonSilenceSeconds(
  filePath: string,
  gate: 'sensitive' | 'normal' | 'strict',
  opts?: { maxAnalyzeSeconds?: number; highpassHz?: number | null }
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
      // Apply -t as an INPUT option so ffmpeg stops demuxing/decoding early.
      '-t',
      String(maxAnalyzeSeconds),
      '-i',
      filePath,
      '-vn',
      '-af',
      `${opts?.highpassHz != null && Number.isFinite(Number(opts.highpassHz)) && Number(opts.highpassHz) > 0 ? `highpass=f=${Math.round(Number(opts.highpassHz))},` : ''}silencedetect=n=${noiseDb}:d=${minNonSilenceSeconds.toFixed(2)}`,
      '-f',
      'null',
      '-',
    ]
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    p.stderr.on('data', (d) => { stderr += String(d) })
    p.on('close', (code) => {
      // If the audio starts non-silent, silencedetect emits no silence_start/end.
      // Treat that as "starts immediately" (cut at t=0).
      if (code !== 0) return resolve(0)
      const hasSilenceStart = /silence_start:\s*([0-9.]+)/.test(stderr)
      const m = stderr.match(/silence_end:\s*([0-9.]+)/)
      // If we observed silence_start but never got a silence_end, audio stayed silent for the whole window.
      // In that case, we don't want to cut the opener early.
      if (!m) return resolve(hasSilenceStart ? null : 0)
      const v = Number(m[1])
      if (!Number.isFinite(v) || v < 0) return resolve(0)
      resolve(v)
    })
    p.on('error', () => resolve(0))
  })
}

function insetPctForPreset(preset: any): number {
  const p = String(preset || '').toLowerCase()
  if (p === 'small') return 0.06
  if (p === 'large') return 0.14
  return 0.10
}

function normalizeHexColor(raw: any): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const m = s.match(/^#([0-9a-fA-F]{6})$/)
  if (!m) return null
  return `#${m[1].toLowerCase()}`
}

function ffmpegColorForHex(hex: string): string {
  // drawtext expects "0xRRGGBB" or named colors; we store "#rrggbb".
  return `0x${String(hex).replace('#', '')}`
}

function fontFileForKey(key: any): string {
  const k = String(key || '').trim().toLowerCase()
  if (k === 'dejavu_sans_bold') return '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
  return '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
}

function escapeFilterValue(raw: string): string {
  return String(raw).replace(/\\/g, '\\\\').replace(/:/g, '\\:')
}

function clampNum(n: any, min: number, max: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.min(Math.max(v, min), max)
}

function escapeFfmpegExprCommas(expr: string): string {
  return String(expr).replace(/,/g, '\\,')
}

function lineSpacingPxForFrame(frameH: number, fontSizePct: number): number {
  const h = Number.isFinite(frameH) && frameH > 0 ? frameH : 1080
  const pct = clampNum(fontSizePct, 2, 8)
  const px = Math.round(h * (pct / 100) * 0.18)
  return Math.max(0, Math.min(200, px))
}

function buildScreenTitleAlphaExpr(preset: any, videoDurationSeconds: number | null): { enableExpr: string; alphaExpr: string } {
  const fade = String(preset?.fade || 'out').toLowerCase()
  const timingRule = String(preset?.timingRule || 'first_only').toLowerCase()
  const timingSecondsRaw = preset?.timingSeconds != null ? Number(preset.timingSeconds) : 10
  const end =
    timingRule === 'first_only'
      ? clampNum(timingSecondsRaw, 0, 3600)
      : (videoDurationSeconds != null && Number.isFinite(videoDurationSeconds) && videoDurationSeconds > 0 ? videoDurationSeconds : null)

  const enableExpr = end != null ? `between(t\\,0\\,${end.toFixed(3)})` : '1'

  const f = 0.5
  const inExpr = `if(lt(t\\,${f.toFixed(3)})\\,t/${f.toFixed(3)}\\,1)`
  const outExpr =
    end != null
      ? `if(lt(t\\,${(end - f).toFixed(3)})\\,1\\,if(lt(t\\,${end.toFixed(3)})\\,(${end.toFixed(3)}-t)/${f.toFixed(3)}\\,0))`
      : '1'

  const wantIn = fade === 'in' || fade === 'in_out'
  const wantOut = fade === 'out' || fade === 'in_out'
  const aIn = wantIn ? inExpr : '1'
  const aOut = wantOut ? outExpr : '1'
  const alphaExpr = fade === 'in_out'
    ? `if(lt(${aIn}\\,${aOut})\\,${aIn}\\,${aOut})`
    : (fade === 'in' ? aIn : fade === 'out' ? aOut : '1')
  return { enableExpr, alphaExpr }
}

export async function burnScreenTitleIntoMp4(opts: {
  inPath: string
  outPath: string
  screenTitle: ScreenTitleV1
  videoDurationSeconds: number | null
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}): Promise<void> {
  const text = String(opts.screenTitle?.text || '').replace(/\r\n/g, '\n').trim()
  if (!text) return

  const tmpDir = path.dirname(opts.outPath)
  const textFile = path.join(tmpDir, `screen-title-${randomUUID()}.txt`)
  fs.writeFileSync(textFile, text, 'utf8')

  try {
    const preset = opts.screenTitle.preset || {}
    const pos = normalizeScreenTitlePosition(preset.position)
    const style = String(preset.style || 'pill').toLowerCase()
    const fontSizePct = clampNum(preset.fontSizePct ?? 4.5, 2, 8)
    const fontColorHex = normalizeHexColor(preset.fontColor) ?? '#ffffff'
    const pillBgColorHex = normalizeHexColor(preset.pillBgColor) ?? '#000000'
    const pillBgOpacityPct = clampNum(preset.pillBgOpacityPct ?? 55, 0, 100)
    const pillBgAlpha = clampNum(pillBgOpacityPct / 100, 0, 1)
    const xInset = insetPctForPreset(preset.insetXPreset)
    const yInset = insetPctForPreset(preset.insetYPreset ?? 'medium')

    const xExpr = escapeFfmpegExprCommas(`min(max(w*${xInset.toFixed(4)},(w-text_w)/2),w-text_w-w*${xInset.toFixed(4)})`)
    const yExpr =
      pos === 'bottom'
        ? `h-text_h-h*${yInset.toFixed(4)}`
        : pos === 'middle'
          ? `(h-text_h)/2`
          : `h*${yInset.toFixed(4)}`

    const fontFile = escapeFilterValue(fontFileForKey(preset.fontKey))
    const textFileEsc = escapeFilterValue(textFile)
    const { enableExpr, alphaExpr } = buildScreenTitleAlphaExpr(preset, opts.videoDurationSeconds)

    const fontSizeExpr = `h*${(fontSizePct / 100).toFixed(5)}`

    const baseText = [
      `drawtext=fontfile=${fontFile}`,
      `textfile=${textFileEsc}`,
      `x=${xExpr}`,
      `y=${yExpr}`,
      `fontsize=${fontSizeExpr}`,
      `fontcolor=${escapeFilterValue(ffmpegColorForHex(fontColorHex))}`,
      `alpha=${alphaExpr}`,
      `enable='${enableExpr}'`,
    ]

    const extras: string[] = []
    if (style === 'pill') {
      extras.push(
        'box=1',
        `boxcolor=${escapeFilterValue(`${ffmpegColorForHex(pillBgColorHex)}@${pillBgAlpha.toFixed(3)}`)}`,
        'boxborderw=10',
        'shadowcolor=black@0.55',
        'shadowx=0',
        'shadowy=2'
      )
    } else if (style === 'outline') {
      extras.push('borderw=3', 'bordercolor=black@0.90', 'shadowcolor=black@0.55', 'shadowx=0', 'shadowy=2')
    } else {
      extras.push('shadowcolor=black@0.55', 'shadowx=0', 'shadowy=2')
    }

    const drawText = [...baseText, ...extras].join(':')
    const stripY = pos === 'bottom' ? 'h-h*0.12' : pos === 'middle' ? '(h-h*0.12)/2' : '0'
    const vf = style === 'strip'
      ? `drawbox=x=0:y=${stripY}:w=w:h=h*0.12:color=black@0.40:t=fill,${drawText}`
      : drawText

    await runFfmpeg([
      '-i',
      opts.inPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-vf',
      vf,
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
      opts.outPath,
    ], opts.logPaths)
  } finally {
    try { fs.rmSync(textFile, { force: true }) } catch {}
  }
}

export async function renderScreenTitleOverlayPngsToS3(opts: {
  uploadBucket: string
  dateYmd: string
  productionUlid: string
  screenTitle: ScreenTitleV1
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}): Promise<ScreenTitleOverlayPngsV1> {
  const text = String(opts.screenTitle?.text || '').replace(/\r\n/g, '\n').trim()
  if (!text) throw new Error('missing_screen_title_text')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-screen-title-png-'))
  const textFile = path.join(tmpDir, `screen-title-${randomUUID()}.txt`)
  fs.writeFileSync(textFile, text, 'utf8')

  const preset = opts.screenTitle.preset || {}
  const pos = normalizeScreenTitlePosition(preset.position)
  const style = String(preset.style || 'pill').toLowerCase()
  const fontSizePct = clampNum(preset.fontSizePct ?? 4.5, 2, 8)
  const fontColorHex = normalizeHexColor(preset.fontColor) ?? '#ffffff'
  const pillBgColorHex = normalizeHexColor(preset.pillBgColor) ?? '#000000'
  const pillBgOpacityPct = clampNum(preset.pillBgOpacityPct ?? 55, 0, 100)
  const pillBgAlpha = clampNum(pillBgOpacityPct / 100, 0, 1)
  const xInset = insetPctForPreset(preset.insetXPreset)
  const yInset = insetPctForPreset(preset.insetYPreset ?? 'medium')

  const fontFile = escapeFilterValue(fontFileForKey(preset.fontKey))
  const textFileEsc = escapeFilterValue(textFile)

  const fontSizeExpr = `h*${(fontSizePct / 100).toFixed(5)}`

  const renderOne = async (frame: { w: number; h: number }, outPngPath: string) => {
    const xExpr = escapeFfmpegExprCommas(`min(max(w*${xInset.toFixed(4)},(w-text_w)/2),w-text_w-w*${xInset.toFixed(4)})`)
    const yExpr =
      pos === 'bottom'
        ? `h-text_h-h*${yInset.toFixed(4)}`
        : pos === 'middle'
          ? `(h-text_h)/2`
          : `h*${yInset.toFixed(4)}`
    const lineSpacingPx = lineSpacingPxForFrame(frame.h, fontSizePct)

    const baseText = [
      `drawtext=fontfile=${fontFile}`,
      `textfile=${textFileEsc}`,
      `x=${xExpr}`,
      `y=${yExpr}`,
      `fontsize=${fontSizeExpr}`,
      `fontcolor=${escapeFilterValue(ffmpegColorForHex(fontColorHex))}`,
      'alpha=1',
      `line_spacing=${lineSpacingPx}`,
      "enable='1'",
    ]

    const extras: string[] = []
    if (style === 'pill') {
      extras.push(
        'box=1',
        `boxcolor=${escapeFilterValue(`${ffmpegColorForHex(pillBgColorHex)}@${pillBgAlpha.toFixed(3)}`)}`,
        'boxborderw=10',
        'shadowcolor=black@0.55',
        'shadowx=0',
        'shadowy=2'
      )
    } else if (style === 'outline') {
      extras.push('borderw=3', 'bordercolor=black@0.90', 'shadowcolor=black@0.55', 'shadowx=0', 'shadowy=2')
    } else {
      extras.push('shadowcolor=black@0.55', 'shadowx=0', 'shadowy=2')
    }

    const drawText = [...baseText, ...extras].join(':')
    const stripY = pos === 'bottom' ? 'h-h*0.12' : pos === 'middle' ? '(h-h*0.12)/2' : '0'
    const vf = style === 'strip'
      ? `format=rgba,colorchannelmixer=aa=0,drawbox=x=0:y=${stripY}:w=w:h=h*0.12:color=black@0.40:t=fill,${drawText}`
      : `format=rgba,colorchannelmixer=aa=0,${drawText}`

    await runFfmpeg(
      [
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${frame.w}x${frame.h}:d=1`,
        '-frames:v',
        '1',
        '-vf',
        vf,
        outPngPath,
      ],
      opts.logPaths
    )
  }

  try {
    const portraitPath = path.join(tmpDir, 'portrait.png')
    const landscapePath = path.join(tmpDir, 'landscape.png')
    await renderOne({ w: 1080, h: 1920 }, portraitPath)
    await renderOne({ w: 1920, h: 1080 }, landscapePath)

    // MediaConvert's job role permissions are often prefix-scoped. We already use `lower-thirds/*`
    // for other dynamic overlays, so keep screen-title overlays under that prefix as well.
    const folder = ymdToFolder(opts.dateYmd)
    const baseKey = `lower-thirds/screen-titles/${folder}/${opts.productionUlid}/${randomUUID()}`
    const portraitKey = `${baseKey}/portrait.png`
    const landscapeKey = `${baseKey}/landscape.png`
    await uploadFileToS3(opts.uploadBucket, portraitKey, portraitPath, 'image/png')
    await uploadFileToS3(opts.uploadBucket, landscapeKey, landscapePath, 'image/png')

    return {
      portrait: { bucket: opts.uploadBucket, key: portraitKey, s3Url: `s3://${opts.uploadBucket}/${portraitKey}` },
      landscape: { bucket: opts.uploadBucket, key: landscapeKey, s3Url: `s3://${opts.uploadBucket}/${landscapeKey}` },
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

export async function createMuxedMp4WithLoopedReplacementAudio(opts: {
  uploadBucket: string
  dateYmd: string
  productionUlid: string
  originalLeaf: string
  videoDurationSeconds?: number | null
  video: { bucket: string; key: string }
  audio: { bucket: string; key: string }
  musicGainDb: number
  audioDurationSeconds?: number | null
  audioFadeEnabled?: boolean
  logPaths?: { stdoutPath?: string; stderrPath?: string }
  normalizeAudio?: boolean
  normalizeTargetLkfs?: number
  videoHighpassEnabled?: boolean
  videoHighpassHz?: number
}): Promise<{ bucket: string; key: string; s3Url: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-audio-replace-'))
  const videoPath = path.join(tmpDir, 'video')
  const audioPath = path.join(tmpDir, 'music')
  const outPath = path.join(tmpDir, 'muxed.mp4')

  try {
    await downloadS3ObjectToFile(opts.video.bucket, opts.video.key, videoPath)
    await downloadS3ObjectToFile(opts.audio.bucket, opts.audio.key, audioPath)
    const secondsRaw = opts.audioDurationSeconds != null ? Number(opts.audioDurationSeconds) : null
    const seconds = secondsRaw != null && Number.isFinite(secondsRaw) ? Math.max(2, Math.min(20, Math.round(secondsRaw))) : null
    const fadeEnabled = opts.audioFadeEnabled !== false
    const mDb = Math.round(Number.isFinite(opts.musicGainDb) ? Number(opts.musicGainDb) : -18)
    const mVol = `${mDb}dB`

    const fadeBase = 0.35
    const fadeDur = seconds != null && fadeEnabled ? Math.max(0.05, Math.min(fadeBase, seconds / 2)) : 0
    const fadeOutStart = seconds != null ? Math.max(0, seconds - fadeDur) : 0
    const fadeFilters = seconds != null && fadeDur > 0
      ? `,afade=t=in:st=0:d=${fadeDur.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDur.toFixed(2)}`
      : ''

    const musicFilter = seconds != null
      ? `[1:a]volume=${mVol},atrim=0:${seconds},asetpts=N/SR/TB${fadeFilters},apad[music]`
      : `[1:a]volume=${mVol}[music]`

    const normalizeEnabled = opts.normalizeAudio === true
    const target = Number.isFinite(Number(opts.normalizeTargetLkfs)) ? Number(opts.normalizeTargetLkfs) : -16
    // NOTE: On ffmpeg 4.4, loudnorm + -shortest can truncate the tail due to filter latency.
    // Fix by trimming audio explicitly to video duration and omitting -shortest.
    const probedDur =
      normalizeEnabled ? (await probeDurationSeconds(videoPath)) : null
    const videoDur =
      normalizeEnabled
        ? (probedDur != null ? probedDur : (opts.videoDurationSeconds != null ? Number(opts.videoDurationSeconds) : null))
        : null
    const useDurTrim = normalizeEnabled && videoDur != null && Number.isFinite(videoDur) && videoDur > 0

    const baseArgs: string[] = [
      '-i',
      videoPath,
    ]
    // Always loop the music input and trim to our desired length; this avoids “music ends early then silence”
    // when the selected clip duration exceeds the file duration.
    baseArgs.push('-stream_loop', '-1', '-i', audioPath)

    const durTrim = useDurTrim ? `,atrim=0:${videoDur!.toFixed(6)},asetpts=N/SR/TB` : ''
    const normSuffix = normalizeEnabled ? `,loudnorm=I=${target}:TP=-1.5:LRA=11` : ''
    const filterComplex = normalizeEnabled
      ? `${musicFilter};[music]alimiter=limit=0.98${normSuffix}${durTrim}[out]`
      : musicFilter
    baseArgs.push('-filter_complex', filterComplex, '-map', '0:v:0', '-map', '[out]')

    const commonTail = [
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
      outPath,
    ]

    try {
      await runFfmpeg([
        ...baseArgs,
        '-c:v',
        'copy',
        ...(useDurTrim ? commonTail : ['-shortest', ...commonTail]),
      ], opts.logPaths)
    } catch {
      await runFfmpeg([
        ...baseArgs,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        ...(useDurTrim ? commonTail : ['-shortest', ...commonTail]),
      ], opts.logPaths)
    }

    const uploadPath = outPath

    // Preserve the original input basename so MediaConvert output names stay stable (e.g. "video.m3u8"),
    // since the app derives master/poster URLs from the upload's original key leaf.
    const folder = ymdToFolder(opts.dateYmd)
    const keyPrefix = seconds != null ? 'music-replace-clip' : 'music-replace'
    const key = `${keyPrefix}/${folder}/${opts.productionUlid}/${randomUUID()}/${opts.originalLeaf}`
    await uploadFileToS3(opts.uploadBucket, key, uploadPath, 'video/mp4')
    return { bucket: opts.uploadBucket, key, s3Url: `s3://${opts.uploadBucket}/${key}` }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}

export async function createMuxedMp4WithLoopedMixedAudio(opts: {
  uploadBucket: string
  dateYmd: string
  productionUlid: string
  originalLeaf: string
  videoDurationSeconds?: number | null
  video: { bucket: string; key: string }
  audio: { bucket: string; key: string }
  videoGainDb: number
  musicGainDb: number
  audioDurationSeconds?: number | null
  audioFadeEnabled?: boolean
  duckingEnabled?: boolean
  duckingMode?: 'none' | 'rolling' | 'abrupt'
  duckingGate?: 'sensitive' | 'normal' | 'strict'
  duckingAmountDb?: number
  openerCutFadeBeforeSeconds?: number | null
  openerCutFadeAfterSeconds?: number | null
  logPaths?: { stdoutPath?: string; stderrPath?: string }
  normalizeAudio?: boolean
  normalizeTargetLkfs?: number
  videoHighpassEnabled?: boolean
  videoHighpassHz?: number
}): Promise<{ bucket: string; key: string; s3Url: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-audio-mix-'))
  const videoPath = path.join(tmpDir, 'video')
  const audioPath = path.join(tmpDir, 'music')
  const outPath = path.join(tmpDir, 'muxed.mp4')

  const vDb = Math.round(Number.isFinite(opts.videoGainDb) ? opts.videoGainDb : 0)
  const mDb = Math.round(Number.isFinite(opts.musicGainDb) ? opts.musicGainDb : -18)
  const duckingEnabled = Boolean(opts.duckingEnabled)
  const duckingModeRaw = String(opts.duckingMode || (duckingEnabled ? 'rolling' : 'none')).toLowerCase()
  const duckingMode: 'none' | 'rolling' | 'abrupt' =
    duckingModeRaw === 'abrupt' || duckingModeRaw === 'rolling' || duckingModeRaw === 'none' ? duckingModeRaw : 'none'
  const duckingGateRaw = String(opts.duckingGate || 'normal').toLowerCase()
  const duckingGate: 'sensitive' | 'normal' | 'strict' =
    duckingGateRaw === 'sensitive' || duckingGateRaw === 'strict' || duckingGateRaw === 'normal' ? duckingGateRaw : 'normal'
  const duckingAmountDb = Math.round(
    Number.isFinite(opts.duckingAmountDb) ? Number(opts.duckingAmountDb) : 12
  )

  const vVol = `${vDb}dB`
  const mVol = `${mDb}dB`
  const videoHighpassEnabled = Boolean(opts.videoHighpassEnabled)
  const videoHighpassHzRaw = opts.videoHighpassHz != null ? Number(opts.videoHighpassHz) : 80
  const videoHighpassHz =
    Number.isFinite(videoHighpassHzRaw) ? Math.max(20, Math.min(250, Math.round(videoHighpassHzRaw))) : 80
  const videoHighpassPrefix = videoHighpassEnabled ? `highpass=f=${videoHighpassHz},` : ''

  try {
    await downloadS3ObjectToFile(opts.video.bucket, opts.video.key, videoPath)
    await downloadS3ObjectToFile(opts.audio.bucket, opts.audio.key, audioPath)
    const probedDur =
      opts.normalizeAudio === true ? (await probeDurationSeconds(videoPath)) : null
    const videoDur =
      opts.normalizeAudio === true
        ? (probedDur != null ? probedDur : (opts.videoDurationSeconds != null ? Number(opts.videoDurationSeconds) : null))
        : null
    const useDurTrim = opts.normalizeAudio === true && videoDur != null && Number.isFinite(videoDur) && videoDur > 0
    const secondsRaw = opts.audioDurationSeconds != null ? Number(opts.audioDurationSeconds) : null
    const seconds = secondsRaw != null && Number.isFinite(secondsRaw) ? Math.max(2, Math.min(20, Math.round(secondsRaw))) : null
    const fadeEnabled = opts.audioFadeEnabled !== false

    const fadeBase = 0.35
    const fadeDur = seconds != null && fadeEnabled ? Math.max(0.05, Math.min(fadeBase, seconds / 2)) : 0
    const fadeOutStart = seconds != null ? Math.max(0, seconds - fadeDur) : 0
    const fadeFilters = seconds != null && fadeDur > 0
      ? `,afade=t=in:st=0:d=${fadeDur.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDur.toFixed(2)}`
      : ''
    const musicTail = seconds != null ? `,atrim=0:${seconds},asetpts=N/SR/TB${fadeFilters},apad` : ''

    // Mix original (embedded) audio with looped music at configured gains.
    // Optionally duck music under the original audio (no voice isolation; uses full original audio as sidechain).
    //
    // We use `apad` so the original audio can be safely shorter than the video without truncating the output,
    // and `-shortest` to stop output at end of video.
    //
    // Note: if the input video has no audio stream, this filtergraph will fail; callers should fallback to replace-mode.
    //
    // IMPORTANT: amix defaults to normalize=1 (scales down by input count).
    // Use normalize=0 and add a limiter to avoid clipping (keeps gain presets audible/predictable).
    let origChain = `[0:a]${videoHighpassPrefix}volume=${vVol},apad[orig]`
    let musicChain = `[1:a]volume=${mVol}${musicTail}[music]`
    const thresholdForGate = (gate: string): number => {
      if (gate === 'sensitive') return 0.06
      if (gate === 'strict') return 0.10
      return 0.08 // normal
    }

    if (duckingEnabled && duckingMode !== 'none') {
      const threshold = thresholdForGate(duckingGate)

      origChain = `[0:a]${videoHighpassPrefix}volume=${vVol},apad[orig]`
      if (duckingMode === 'abrupt') {
        // Abrupt Ducking (latched): detect when the video's audio becomes non-silent, then fully cut music
        // after that point (good for opener SFX/music that should not continue under speech).
        const analyzeWindow = seconds != null ? Math.max(5, Math.min(60, seconds + 10)) : 30
        const cutAt = await detectInitialNonSilenceSeconds(videoPath, duckingGate, {
          maxAnalyzeSeconds: analyzeWindow,
          highpassHz: videoHighpassEnabled ? videoHighpassHz : null,
        })
        const effectiveCutRaw = cutAt == null ? null : cutAt
        const effectiveCut =
          effectiveCutRaw == null
            ? null
            : Math.max(0, Math.min(seconds != null ? seconds : effectiveCutRaw, effectiveCutRaw))

        if (effectiveCut != null && effectiveCut <= 0.05) {
          musicChain = `[1:a]volume=0,apad[music]`
        } else if (effectiveCut != null) {
          const t = Number(effectiveCut.toFixed(3))

          const beforeRaw = opts.openerCutFadeBeforeSeconds != null ? Number(opts.openerCutFadeBeforeSeconds) : null
          const afterRaw = opts.openerCutFadeAfterSeconds != null ? Number(opts.openerCutFadeAfterSeconds) : null
          const before = beforeRaw != null && Number.isFinite(beforeRaw) ? Math.max(0, Math.min(3, beforeRaw)) : null
          const after = afterRaw != null && Number.isFinite(afterRaw) ? Math.max(0, Math.min(3, afterRaw)) : null

          // Default behavior if config doesn't specify: fade out over 0.5s ending at t.
          const beforeSec = before == null && after == null ? 0.5 : (before ?? 0)
          const afterSec = after == null ? 0 : after
          const endRaw = t + afterSec
          const endCapped = seconds != null ? Math.min(Number(seconds), endRaw) : endRaw
          const end = Number(endCapped.toFixed(3))
          const start = Number(Math.max(0, t - beforeSec).toFixed(3))
          const fadeDur = Math.max(0, Math.min(beforeSec + afterSec, Math.max(0, end - start)))
          const fadeFiltersCut =
            fadeDur > 0
              ? `,afade=t=out:st=${start.toFixed(2)}:d=${fadeDur.toFixed(2)}`
              : ''

          // Keep only the opener segment (through end), then pad with silence so amix can run for the full video duration.
          // Use atrim (not aselect) to avoid per-sample expression evaluation on an infinite looped input.
          musicChain = `[1:a]volume=${mVol},atrim=0:${end.toFixed(3)},asetpts=N/SR/TB${fadeFiltersCut},apad[music]`
        } else {
          // No detectable audio stream → treat like "no ducking" (opener can play for the configured clip duration).
          musicChain = `[1:a]volume=${mVol}${musicTail}[music]`
        }
      } else {
        // Rolling Ducking: sidechain compression (smooth reduction).
        const ratio = Math.max(2, Math.min(20, 1 + Math.round(duckingAmountDb / 2)))
        const attack = 20
        const release = 250
        // IMPORTANT: sidechaincompress appears to not accept intermediate labels as input on this ffmpeg build.
        // Use direct input streams ([1:a] and [0:a]) for sidechaincompress, and only use labels for amix.
        musicChain = `[1:a][0:a]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1[mduck];[mduck]volume=${mVol}${musicTail}[music]`
      }
    }

    const normalizeEnabled = opts.normalizeAudio === true
    const target = Number.isFinite(Number(opts.normalizeTargetLkfs)) ? Number(opts.normalizeTargetLkfs) : -16
    const durTrim = useDurTrim ? `,atrim=0:${videoDur!.toFixed(6)},asetpts=N/SR/TB` : ''
    const normSuffix = normalizeEnabled ? `,loudnorm=I=${target}:TP=-1.5:LRA=11` : ''
    const filter = `${origChain};${musicChain};[orig][music]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98${normSuffix}${durTrim}[out]`

    const args: string[] = ['-i', videoPath]
    // Always loop the music input; we trim/pad inside the filtergraph to keep behavior stable
    // when the selected clip duration exceeds the file duration.
    args.push('-stream_loop', '-1')
    args.push(
      '-i',
      audioPath,
      '-filter_complex',
      filter,
      '-map',
      '0:v:0',
      '-map',
      '[out]',
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
      outPath
    )
    if (!useDurTrim) args.splice(args.length - 1, 0, '-shortest')
    await runFfmpeg(args, opts.logPaths)

    const uploadPath = outPath

    const folder = ymdToFolder(opts.dateYmd)
    const prefix = duckingEnabled ? (duckingMode === 'abrupt' ? 'music-mix-gate' : 'music-mix-duck') : 'music-mix'
    const keyPrefix = seconds != null ? `${prefix}-clip` : prefix
    const key = `${keyPrefix}/${folder}/${opts.productionUlid}/${randomUUID()}/${opts.originalLeaf}`
    await uploadFileToS3(opts.uploadBucket, key, uploadPath, 'video/mp4')
    return { bucket: opts.uploadBucket, key, s3Url: `s3://${opts.uploadBucket}/${key}` }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}
