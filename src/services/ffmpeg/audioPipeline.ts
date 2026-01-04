import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { pipeline } from 'stream/promises'
import { s3 } from '../s3'

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
      // Apply -t as an INPUT option so ffmpeg stops demuxing/decoding early.
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

    // Preserve the original input basename so MediaConvert output names stay stable (e.g. "video.m3u8"),
    // since the app derives master/poster URLs from the upload's original key leaf.
    const folder = ymdToFolder(opts.dateYmd)
    const keyPrefix = seconds != null ? 'music-replace-clip' : 'music-replace'
    const key = `${keyPrefix}/${folder}/${opts.productionUlid}/${randomUUID()}/${opts.originalLeaf}`
    await uploadFileToS3(opts.uploadBucket, key, outPath, 'video/mp4')
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
    let origChain = `[0:a]volume=${vVol},apad[orig]`
    let musicChain = `[1:a]volume=${mVol}${musicTail}[music]`
    const thresholdForGate = (gate: string): number => {
      if (gate === 'sensitive') return 0.06
      if (gate === 'strict') return 0.10
      return 0.08 // normal
    }

    if (duckingEnabled && duckingMode !== 'none') {
      const threshold = thresholdForGate(duckingGate)

      origChain = `[0:a]volume=${vVol},apad[orig]`
      if (duckingMode === 'abrupt') {
        // Abrupt Ducking (latched): detect when the video's audio becomes non-silent, then fully cut music
        // after that point (good for opener SFX/music that should not continue under speech).
        const analyzeWindow = seconds != null ? Math.max(5, Math.min(60, seconds + 10)) : 30
        const cutAt = await detectInitialNonSilenceSeconds(videoPath, duckingGate, { maxAnalyzeSeconds: analyzeWindow })
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

    const folder = ymdToFolder(opts.dateYmd)
    const prefix = duckingEnabled ? (duckingMode === 'abrupt' ? 'music-mix-gate' : 'music-mix-duck') : 'music-mix'
    const keyPrefix = seconds != null ? `${prefix}-clip` : prefix
    const key = `${keyPrefix}/${folder}/${opts.productionUlid}/${randomUUID()}/${opts.originalLeaf}`
    await uploadFileToS3(opts.uploadBucket, key, outPath, 'video/mp4')
    return { bucket: opts.uploadBucket, key, s3Url: `s3://${opts.uploadBucket}/${key}` }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}
