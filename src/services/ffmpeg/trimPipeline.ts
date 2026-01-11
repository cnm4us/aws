import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { runFfmpeg } from './audioPipeline'

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

function clampTrimSeconds(n: any): number | null {
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  if (v < 0) return 0
  // Hard cap to prevent nonsense; typical max is 3m.
  return Math.min(60 * 60, Math.round(v * 1000) / 1000)
}

export async function trimMp4Local(opts: {
  inPath: string
  outPath: string
  startSeconds: number
  endSeconds?: number | null
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}): Promise<{ durationSeconds: number | null }> {
  const start = clampTrimSeconds(opts.startSeconds)
  const end = clampTrimSeconds(opts.endSeconds)
  if (start == null) throw new Error('invalid_trim_start')
  if (end != null && end <= start) throw new Error('invalid_trim_range')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-trim-'))
  const tmpOut = path.join(tmpDir, 'out.mp4')
  try {
    const hasAudio = await hasAudioStream(opts.inPath)
    const vFilter = end != null ? `trim=start=${start}:end=${end},setpts=PTS-STARTPTS` : `trim=start=${start},setpts=PTS-STARTPTS`
    const aFilter = end != null ? `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS` : `atrim=start=${start},asetpts=PTS-STARTPTS`

    if (hasAudio) {
      await runFfmpeg(
        [
          '-i',
          opts.inPath,
          '-filter_complex',
          `[0:v]${vFilter}[v];[0:a]${aFilter}[a]`,
          '-map',
          '[v]',
          '-map',
          '[a]',
          '-c:v',
          'libx264',
          // Trims are intermediate for MediaConvert; prefer speed.
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
          tmpOut,
        ],
        opts.logPaths
      )
    } else {
      await runFfmpeg(
        [
          '-i',
          opts.inPath,
          '-vf',
          vFilter,
          '-map',
          '0:v:0',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          tmpOut,
        ],
        opts.logPaths
      )
    }

    try { fs.copyFileSync(tmpOut, opts.outPath) } catch {
      // fallback if cross-device
      fs.copyFileSync(tmpOut, opts.outPath)
    }
    const durationSeconds = await probeDurationSeconds(opts.outPath)
    return { durationSeconds }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

export async function spliceMp4Local(opts: {
  inPath: string
  outPath: string
  ranges: Array<{ start: number; end: number }>
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}): Promise<{ durationSeconds: number | null }> {
  const rawRanges = Array.isArray(opts.ranges) ? opts.ranges : []
  const ranges = rawRanges
    .map((r) => ({ start: clampTrimSeconds(r.start), end: clampTrimSeconds(r.end) }))
    .filter((r) => r.start != null && r.end != null)
    .map((r) => ({ start: r.start as number, end: r.end as number }))
    .filter((r) => r.end > r.start)

  if (!ranges.length) throw new Error('invalid_edit_ranges')
  if (ranges.length === 1) {
    return await trimMp4Local({ inPath: opts.inPath, outPath: opts.outPath, startSeconds: ranges[0].start, endSeconds: ranges[0].end, logPaths: opts.logPaths })
  }

  // Ensure sorted & non-overlapping.
  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) throw new Error('overlapping_edit_ranges')
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-splice-'))
  const tmpOut = path.join(tmpDir, 'out.mp4')
  try {
    const hasAudio = await hasAudioStream(opts.inPath)
    const parts: string[] = []
    const concatInputs: string[] = []
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]
      parts.push(`[0:v]trim=start=${r.start}:end=${r.end},setpts=PTS-STARTPTS[v${i}]`)
      if (hasAudio) parts.push(`[0:a]atrim=start=${r.start}:end=${r.end},asetpts=PTS-STARTPTS[a${i}]`)
      if (hasAudio) concatInputs.push(`[v${i}]`, `[a${i}]`)
      else concatInputs.push(`[v${i}]`)
    }

    const concat = hasAudio
      ? `${concatInputs.join('')}concat=n=${ranges.length}:v=1:a=1[v][a]`
      : `${concatInputs.join('')}concat=n=${ranges.length}:v=1:a=0[v]`

    const filter = `${parts.join(';')};${concat}`

    if (hasAudio) {
      await runFfmpeg(
        [
          '-i',
          opts.inPath,
          '-filter_complex',
          filter,
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
          tmpOut,
        ],
        opts.logPaths
      )
    } else {
      await runFfmpeg(
        [
          '-i',
          opts.inPath,
          '-filter_complex',
          filter,
          '-map',
          '[v]',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          tmpOut,
        ],
        opts.logPaths
      )
    }

    fs.copyFileSync(tmpOut, opts.outPath)
    const durationSeconds = await probeDurationSeconds(opts.outPath)
    return { durationSeconds }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
