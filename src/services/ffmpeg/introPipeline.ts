import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
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
    const vFilter = `[0:v]tpad=start_duration=${seconds}:start_mode=clone,setsar=1[v]`
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
