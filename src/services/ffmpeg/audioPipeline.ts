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
  introSfx?: null | {
    audio: { bucket: string; key: string }
    seconds: number
    gainDb: number
    fadeEnabled: boolean
    duckingEnabled: boolean
    duckingAmountDb: number
  }
}): Promise<{ bucket: string; key: string; s3Url: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-audio-replace-'))
  const videoPath = path.join(tmpDir, 'video')
  const audioPath = path.join(tmpDir, 'music')
  const sfxPath = path.join(tmpDir, 'sfx')
  const outPath = path.join(tmpDir, 'muxed.mp4')

  try {
    await downloadS3ObjectToFile(opts.video.bucket, opts.video.key, videoPath)
    await downloadS3ObjectToFile(opts.audio.bucket, opts.audio.key, audioPath)
    const intro = opts.introSfx || null
    if (intro) await downloadS3ObjectToFile(intro.audio.bucket, intro.audio.key, sfxPath)

    // Loop music indefinitely; stop output at end of video.
    try {
      if (!intro) {
        await runFfmpeg([
          '-i',
          videoPath,
          '-stream_loop',
          '-1',
          '-i',
          audioPath,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
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
          outPath,
        ])
      } else {
        const seconds = Math.max(0, Math.min(30, Math.round(Number(intro.seconds) || 3)))
        const gainDb = Math.round(Number.isFinite(intro.gainDb) ? intro.gainDb : 0)
        const fadeEnabled = Boolean(intro.fadeEnabled)
        const duckingEnabled = Boolean(intro.duckingEnabled)
        const duckingAmountDb = Math.round(Number.isFinite(intro.duckingAmountDb) ? Number(intro.duckingAmountDb) : 12)

        const fadeBase = 0.35
        const fadeDur = fadeEnabled ? Math.max(0.05, Math.min(fadeBase, seconds / 2)) : 0
        const fadeOutStart = Math.max(0, seconds - fadeDur)
        const fadeFilters = fadeEnabled
          ? `,afade=t=in:st=0:d=${fadeDur.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDur.toFixed(2)}`
          : ''

        let sfxChain = `[2:a]atrim=0:${seconds},asetpts=N/SR/TB,volume=${gainDb}dB${fadeFilters}[sfx]`
        if (duckingEnabled) {
          const ratio = Math.max(2, Math.min(20, 1 + Math.round(duckingAmountDb / 2)))
          const threshold = 0.1
          const attack = 20
          const release = 250
          // Duck intro SFX under the video’s original audio (sidechain = [0:a]).
          // Even in replace-mode, the sidechain references the input audio for timing; output does not include original audio.
          sfxChain = `[2:a][0:a]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1[sfxduck];[sfxduck]atrim=0:${seconds},asetpts=N/SR/TB,volume=${gainDb}dB${fadeFilters}[sfx]`
        }

        const filter = `[1:a]volume=0dB[music];${sfxChain};[music][sfx]amix=inputs=2:duration=longest:dropout_transition=0[outa]`

        await runFfmpeg([
          '-i',
          videoPath,
          '-stream_loop',
          '-1',
          '-i',
          audioPath,
          '-i',
          sfxPath,
          '-filter_complex',
          filter,
          '-map',
          '0:v:0',
          '-map',
          '[outa]',
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
          outPath,
        ])
      }
    } catch {
      // Fallback: if stream copy fails, re-encode video (best-effort).
      if (!intro) {
        await runFfmpeg([
          '-i',
          videoPath,
          '-stream_loop',
          '-1',
          '-i',
          audioPath,
          '-map',
          '0:v:0',
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
          '-shortest',
          outPath,
        ])
      } else {
        const seconds = Math.max(0, Math.min(30, Math.round(Number(intro.seconds) || 3)))
        const gainDb = Math.round(Number.isFinite(intro.gainDb) ? intro.gainDb : 0)
        const fadeEnabled = Boolean(intro.fadeEnabled)
        const duckingEnabled = Boolean(intro.duckingEnabled)
        const duckingAmountDb = Math.round(Number.isFinite(intro.duckingAmountDb) ? Number(intro.duckingAmountDb) : 12)

        const fadeBase = 0.35
        const fadeDur = fadeEnabled ? Math.max(0.05, Math.min(fadeBase, seconds / 2)) : 0
        const fadeOutStart = Math.max(0, seconds - fadeDur)
        const fadeFilters = fadeEnabled
          ? `,afade=t=in:st=0:d=${fadeDur.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDur.toFixed(2)}`
          : ''

        let sfxChain = `[2:a]atrim=0:${seconds},asetpts=N/SR/TB,volume=${gainDb}dB${fadeFilters}[sfx]`
        if (duckingEnabled) {
          const ratio = Math.max(2, Math.min(20, 1 + Math.round(duckingAmountDb / 2)))
          const threshold = 0.1
          const attack = 20
          const release = 250
          sfxChain = `[2:a][0:a]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1[sfxduck];[sfxduck]atrim=0:${seconds},asetpts=N/SR/TB,volume=${gainDb}dB${fadeFilters}[sfx]`
        }

        const filter = `[1:a]volume=0dB[music];${sfxChain};[music][sfx]amix=inputs=2:duration=longest:dropout_transition=0[outa]`

        await runFfmpeg([
          '-i',
          videoPath,
          '-stream_loop',
          '-1',
          '-i',
          audioPath,
          '-i',
          sfxPath,
          '-filter_complex',
          filter,
          '-map',
          '0:v:0',
          '-map',
          '[outa]',
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
          '-shortest',
          outPath,
        ])
      }
    }

    // Preserve the original input basename so MediaConvert output names stay stable (e.g. "video.m3u8"),
    // since the app derives master/poster URLs from the upload's original key leaf.
    const folder = ymdToFolder(opts.dateYmd)
    const keyPrefix = intro ? 'music-replace-intro' : 'music-replace'
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
  duckingEnabled?: boolean
  duckingAmountDb?: number
  introSfx?: null | {
    audio: { bucket: string; key: string }
    seconds: number
    gainDb: number
    fadeEnabled: boolean
    duckingEnabled: boolean
    duckingAmountDb: number
  }
}): Promise<{ bucket: string; key: string; s3Url: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-audio-mix-'))
  const videoPath = path.join(tmpDir, 'video')
  const audioPath = path.join(tmpDir, 'music')
  const sfxPath = path.join(tmpDir, 'sfx')
  const outPath = path.join(tmpDir, 'muxed.mp4')

  const vDb = Math.round(Number.isFinite(opts.videoGainDb) ? opts.videoGainDb : 0)
  const mDb = Math.round(Number.isFinite(opts.musicGainDb) ? opts.musicGainDb : -18)
  const duckingEnabled = Boolean(opts.duckingEnabled)
  const duckingAmountDb = Math.round(
    Number.isFinite(opts.duckingAmountDb) ? Number(opts.duckingAmountDb) : 12
  )

  const vVol = `${vDb}dB`
  const mVol = `${mDb}dB`

  try {
    await downloadS3ObjectToFile(opts.video.bucket, opts.video.key, videoPath)
    await downloadS3ObjectToFile(opts.audio.bucket, opts.audio.key, audioPath)
    const intro = opts.introSfx || null
    if (intro) await downloadS3ObjectToFile(intro.audio.bucket, intro.audio.key, sfxPath)

    // Mix original (embedded) audio with looped music at configured gains.
    // Optionally duck music under the original audio (no voice isolation; uses full original audio as sidechain).
    //
    // We use `apad` so the original audio can be safely shorter than the video without truncating the output,
    // and `-shortest` to stop output at end of video.
    //
    // Note: if the input video has no audio stream, this filtergraph will fail; callers should fallback to replace-mode.
    let filter = `[0:a]volume=${vVol},apad[orig];[1:a]volume=${mVol}[music];[orig][music]amix=inputs=2:duration=longest:dropout_transition=0[mix]`
    if (duckingEnabled) {
      const dbToLinear = (db: number): number => Math.pow(10, db / 20)
      const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n))

      // Heuristic mapping from "duckingAmountDb" into a reasonable ratio range.
      const ratio = Math.max(2, Math.min(20, 1 + Math.round(duckingAmountDb / 2)))
      // Conservative defaults; we can expose tuning later if needed.
      // sidechaincompress uses a linear threshold (0..1), not dB.
      const threshold = 0.1
      const attack = 20
      const release = 250

      const levelIn = clamp(dbToLinear(mDb), 0.015625, 64)
      const levelSc = clamp(dbToLinear(vDb), 0.015625, 64)

      // IMPORTANT: sidechaincompress appears to not accept intermediate labels as input on this ffmpeg build.
      // Use direct input streams ([1:a] and [0:a]) for sidechaincompress, and only use labels for amix.
      filter = `[0:a]volume=${vVol}[orig];[1:a][0:a]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:level_in=${levelIn}:level_sc=${levelSc}:makeup=1[mduck];[mduck]volume=${mVol}[music];[orig][music]amix=inputs=2:duration=longest:dropout_transition=0[mix]`
    }

    let outLabel = '[mix]'
    if (intro) {
      const seconds = Math.max(0, Math.min(30, Math.round(Number(intro.seconds) || 3)))
      const gainDb = Math.round(Number.isFinite(intro.gainDb) ? intro.gainDb : 0)
      const fadeEnabled = Boolean(intro.fadeEnabled)
      const duckEnabled = Boolean(intro.duckingEnabled)
      const duckAmt = Math.round(Number.isFinite(intro.duckingAmountDb) ? Number(intro.duckingAmountDb) : 12)

      const fadeBase = 0.35
      const fadeDur = fadeEnabled ? Math.max(0.05, Math.min(fadeBase, seconds / 2)) : 0
      const fadeOutStart = Math.max(0, seconds - fadeDur)
      const fadeFilters = fadeEnabled
        ? `,afade=t=in:st=0:d=${fadeDur.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDur.toFixed(2)}`
        : ''

      let sfxChain = `[2:a]atrim=0:${seconds},asetpts=N/SR/TB,volume=${gainDb}dB${fadeFilters}[sfx]`
      if (duckEnabled) {
        const ratio = Math.max(2, Math.min(20, 1 + Math.round(duckAmt / 2)))
        const threshold = 0.1
        const attack = 20
        const release = 250
        sfxChain = `[2:a][0:a]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1[sfxduck];[sfxduck]atrim=0:${seconds},asetpts=N/SR/TB,volume=${gainDb}dB${fadeFilters}[sfx]`
      }

      // Mix intro SFX on top of the existing (orig+music) mix.
      filter = `${filter};${sfxChain};[mix][sfx]amix=inputs=2:duration=longest:dropout_transition=0[out]`
      outLabel = '[out]'
    }

    await runFfmpeg([
      '-i',
      videoPath,
      '-stream_loop',
      '-1',
      '-i',
      audioPath,
      ...(intro ? ['-i', sfxPath] : []),
      '-filter_complex',
      filter,
      '-map',
      '0:v:0',
      '-map',
      outLabel,
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
      outPath,
    ])

    const folder = ymdToFolder(opts.dateYmd)
    const base = duckingEnabled ? 'music-mix-duck' : 'music-mix'
    const prefix = intro ? `${base}-intro` : base
    const key = `${prefix}/${folder}/${opts.productionUlid}/${randomUUID()}/${opts.originalLeaf}`
    await uploadFileToS3(opts.uploadBucket, key, outPath, 'video/mp4')
    return { bucket: opts.uploadBucket, key, s3Url: `s3://${opts.uploadBucket}/${key}` }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}
