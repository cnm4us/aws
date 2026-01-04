import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { downloadS3ObjectToFile, runFfmpeg, uploadFileToS3, ymdToFolder } from './audioPipeline'

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

async function probeVideoDimensions(filePath: string): Promise<{ width: number | null; height: number | null }> {
  return await new Promise<{ width: number | null; height: number | null }>((resolve) => {
    const p = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0:s=x',
        filePath,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    let out = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.on('close', (code) => {
      if (code !== 0) return resolve({ width: null, height: null })
      const raw = String(out || '').trim()
      const m = raw.match(/^(\d+)\s*x\s*(\d+)$/i)
      if (!m) return resolve({ width: null, height: null })
      const width = Number(m[1])
      const height = Number(m[2])
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return resolve({ width: null, height: null })
      resolve({ width, height })
    })
    p.on('error', () => resolve({ width: null, height: null }))
  })
}

function roundEven(n: number): number {
  const r = Math.round(n)
  return r % 2 === 0 ? r : r - 1
}

function pickCappedVideoSize(input: { width: number | null; height: number | null }): { outW: number; outH: number } {
  const inW = input.width != null && Number.isFinite(input.width) && input.width > 0 ? input.width : 720
  const inH = input.height != null && Number.isFinite(input.height) && input.height > 0 ? input.height : 1280
  const portrait = inH >= inW
  const maxW = portrait ? 1080 : 1920
  const maxH = portrait ? 1920 : 1080
  const scale = Math.min(1, maxW / inW, maxH / inH)
  const outW = Math.max(2, roundEven(inW * scale))
  const outH = Math.max(2, roundEven(inH * scale))
  return { outW, outH }
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

export async function createMp4WithFrozenFirstFrame(opts: {
  uploadBucket: string
  dateYmd: string
  productionUlid: string
  originalLeaf: string
  video: { bucket: string; key: string }
  freezeSeconds: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}): Promise<{ bucket: string; key: string; s3Url: string }> {
  const secondsRaw = Number(opts.freezeSeconds)
  if (!Number.isFinite(secondsRaw)) throw new Error('invalid_freeze_seconds')
  const seconds = Math.max(0, Math.min(30, Math.round(secondsRaw)))
  if (seconds <= 0) throw new Error('invalid_freeze_seconds')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-intro-freeze-'))
  const videoPath = path.join(tmpDir, 'video')
  const outPath = path.join(tmpDir, 'intro.mp4')

  try {
    await downloadS3ObjectToFile(opts.video.bucket, opts.video.key, videoPath)

    const ms = seconds * 1000
    const dims = await probeVideoDimensions(videoPath)
    const { outW, outH } = pickCappedVideoSize(dims)
    const needsScale = dims.width != null && dims.height != null && (dims.width !== outW || dims.height !== outH)
    const vFilter = needsScale
      ? `[0:v]tpad=start_duration=${seconds}:start_mode=clone,scale=${outW}:${outH},setsar=1[v]`
      : `[0:v]tpad=start_duration=${seconds}:start_mode=clone,setsar=1[v]`
    const hasAudio = await hasAudioStream(videoPath)
    const dur = await probeDurationSeconds(videoPath)
    const totalDur = dur != null ? Math.max(0.5, dur + seconds) : null

    if (hasAudio) {
      // IMPORTANT: apad alone makes audio infinite; always trim to the expected total duration.
      // This prevents ffmpeg from running indefinitely.
      const durTrim = totalDur != null ? `,atrim=0:${totalDur.toFixed(3)},asetpts=N/SR/TB` : ''
      const aFilter = `[0:a]adelay=${ms}|${ms},apad${durTrim}[a]`
      const filter = `${vFilter};${aFilter}`
      await runFfmpeg(
        [
          '-i',
          videoPath,
          '-filter_complex',
          filter,
          '-map',
          '[v]',
          '-map',
          '[a]',
          '-c:v',
          'libx264',
          // Intro freeze is intermediate input to MediaConvert packaging; prioritize speed.
          '-preset',
          'ultrafast',
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
          ...(totalDur != null ? ['-t', totalDur.toFixed(3)] : []),
          outPath,
        ],
        opts.logPaths
      )
    } else {
      // No audio track: inject silence so downstream packaging stays consistent.
      const filter = vFilter
      await runFfmpeg(
        [
          '-i',
          videoPath,
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=48000:cl=stereo',
          '-filter_complex',
          filter,
          '-map',
          '[v]',
          '-map',
          '1:a:0',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
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
          ...(totalDur != null ? ['-t', totalDur.toFixed(3)] : ['-shortest']),
          outPath,
        ],
        opts.logPaths
      )
    }

    const folder = ymdToFolder(opts.dateYmd)
    const key = `intro-freeze/${folder}/${opts.productionUlid}/${randomUUID()}/${opts.originalLeaf}`
    await uploadFileToS3(opts.uploadBucket, key, outPath, 'video/mp4')
    return { bucket: opts.uploadBucket, key, s3Url: `s3://${opts.uploadBucket}/${key}` }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

export async function createMp4WithTitleImageIntro(opts: {
  uploadBucket: string
  dateYmd: string
  productionUlid: string
  originalLeaf: string
  video: { bucket: string; key: string }
  titleImage: { bucket: string; key: string }
  holdSeconds: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}): Promise<{ bucket: string; key: string; s3Url: string }> {
  const secondsRaw = Number(opts.holdSeconds)
  if (!Number.isFinite(secondsRaw)) throw new Error('invalid_hold_seconds')
  const secondsRounded = Math.round(secondsRaw)
  if (![0, 2, 3, 4, 5].includes(secondsRounded)) throw new Error('invalid_hold_seconds')

  // Ensure there is at least a tiny amount of time for the title image to become frame 0 in the output.
  const hold = secondsRounded === 0 ? 0.1 : secondsRounded

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-intro-title-'))
  const videoPath = path.join(tmpDir, 'video')
  const imgPath = path.join(tmpDir, 'title')
  const outPath = path.join(tmpDir, 'intro.mp4')

  try {
    await downloadS3ObjectToFile(opts.video.bucket, opts.video.key, videoPath)
    await downloadS3ObjectToFile(opts.titleImage.bucket, opts.titleImage.key, imgPath)

    const dims = await probeVideoDimensions(videoPath)
    const { outW, outH } = pickCappedVideoSize(dims)

    const dur = await probeDurationSeconds(videoPath)
    const totalDur = dur != null ? Math.max(0.5, dur + hold) : null
    const hasAudio = await hasAudioStream(videoPath)
    const ms = Math.round(hold * 1000)

    // Cover + crop: scale to fill, then crop to exact output size.
    const introV = `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},setsar=1,trim=0:${hold.toFixed(3)},setpts=PTS-STARTPTS[intro]`
    const mainV = `[1:v]scale=${outW}:${outH},setsar=1,setpts=PTS-STARTPTS[main]`
    const concatV = `[intro][main]concat=n=2:v=1:a=0[v]`

    if (hasAudio) {
      const durTrim = totalDur != null ? `,atrim=0:${totalDur.toFixed(3)},asetpts=N/SR/TB` : ''
      const a = `[1:a]adelay=${ms}|${ms},apad${durTrim}[a]`
      const filter = `${introV};${mainV};${concatV};${a}`
      await runFfmpeg(
        [
          '-loop',
          '1',
          '-i',
          imgPath,
          '-i',
          videoPath,
          '-filter_complex',
          filter,
          '-map',
          '[v]',
          '-map',
          '[a]',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
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
          ...(totalDur != null ? ['-t', totalDur.toFixed(3)] : []),
          outPath,
        ],
        opts.logPaths
      )
    } else {
      const filter = `${introV};${mainV};${concatV}`
      await runFfmpeg(
        [
          '-loop',
          '1',
          '-i',
          imgPath,
          '-i',
          videoPath,
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=48000:cl=stereo',
          '-filter_complex',
          filter,
          '-map',
          '[v]',
          '-map',
          '2:a:0',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
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
          ...(totalDur != null ? ['-t', totalDur.toFixed(3)] : ['-shortest']),
          outPath,
        ],
        opts.logPaths
      )
    }

    const folder = ymdToFolder(opts.dateYmd)
    const key = `intro-title/${folder}/${opts.productionUlid}/${randomUUID()}/${opts.originalLeaf}`
    await uploadFileToS3(opts.uploadBucket, key, outPath, 'video/mp4')
    return { bucket: opts.uploadBucket, key, s3Url: `s3://${opts.uploadBucket}/${key}` }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
