import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { pipeline } from 'stream/promises'
import { s3 } from '../s3'

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

export async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    p.stderr.on('data', (d) => {
      stderr += String(d)
    })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) return resolve()
      reject(new Error(`ffmpeg_failed:${code}:${stderr.slice(0, 800)}`))
    })
  })
}

export async function createMuxedMp4WithLoopedReplacementAudio(opts: {
  uploadBucket: string
  dateYmd: string
  productionUlid: string
  originalLeaf: string
  video: { bucket: string; key: string }
  audio: { bucket: string; key: string }
  musicGainDb: number
  audioDurationSeconds?: number | null
  audioFadeEnabled?: boolean
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

    const baseArgs: string[] = [
      '-i',
      videoPath,
    ]
    if (seconds == null) baseArgs.push('-stream_loop', '-1')
    baseArgs.push(
      '-i',
      audioPath,
      '-filter_complex',
      musicFilter,
      '-map',
      '0:v:0',
      '-map',
      '[music]'
    )

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
      '-shortest',
      outPath,
    ]

    try {
      await runFfmpeg([
        ...baseArgs,
        '-c:v',
        'copy',
        ...commonTail,
      ])
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
        ...commonTail,
      ])
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
        // Abrupt Ducking: sidechain gate that quickly drops the music toward silence.
        const attack = 5
        const release = 400
        const range = 0.001 // ~ -60 dB max attenuation (near-silence)
        musicChain = `[1:a][0:a]sidechaingate=threshold=${threshold}:attack=${attack}:release=${release}:range=${range}:makeup=1[mduck];[mduck]volume=${mVol}${musicTail}[music]`
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

    const filter = `${origChain};${musicChain};[orig][music]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98[out]`

    const args: string[] = ['-i', videoPath]
    if (seconds == null) args.push('-stream_loop', '-1')
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
      '-shortest',
      outPath
    )
    await runFfmpeg(args)

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
