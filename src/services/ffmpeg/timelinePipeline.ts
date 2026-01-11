import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { downloadS3ObjectToFile, runFfmpeg, uploadFileToS3 } from './audioPipeline'

async function probeDurationSeconds(filePath: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const p = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.stderr.on('data', (d) => { err += String(d) })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe_failed:${code}:${err.slice(0, 400)}`))
      const v = Number(String(out || '').trim())
      if (!Number.isFinite(v) || v <= 0) return reject(new Error('ffprobe_missing_duration'))
      resolve(v)
    })
  })
}

export type TimelineSpritesManifestV1 = {
  uploadId: number
  intervalSeconds: number
  tile: { w: number; h: number }
  sprite: { cols: number; rows: number; perSprite: number }
  durationSeconds: number
  sprites: Array<{ startSecond: number; key: string }>
}

export async function createUploadTimelineSpritesJpeg(opts: {
  uploadId: number
  proxy: { bucket: string; key: string }
  outputBucket: string
  manifestKey: string
  spritePrefix: string
  intervalSeconds?: number
  tileW?: number
  tileH?: number
  cols?: number
  rows?: number
  perSprite?: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}): Promise<{ manifest: { bucket: string; key: string; s3Url: string }; sprites: Array<{ bucket: string; key: string; s3Url: string }>; durationSeconds: number }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-upload-timeline-'))
  const proxyPath = path.join(tmpDir, 'proxy.mp4')
  const manifestPath = path.join(tmpDir, 'manifest.json')

  const intervalSeconds = Math.max(1, Math.min(5, Math.round(Number(opts.intervalSeconds ?? 1))))
  const tileW = Math.max(32, Math.min(320, Math.round(Number(opts.tileW ?? 96))))
  const tileH = Math.max(32, Math.min(320, Math.round(Number(opts.tileH ?? 54))))
  const cols = Math.max(1, Math.min(30, Math.round(Number(opts.cols ?? 10))))
  const rows = Math.max(1, Math.min(30, Math.round(Number(opts.rows ?? 6))))
  const perSprite = Math.max(1, Math.min(600, Math.round(Number(opts.perSprite ?? cols * rows))))

  try {
    await downloadS3ObjectToFile(opts.proxy.bucket, opts.proxy.key, proxyPath)
    const durationSeconds = await probeDurationSeconds(proxyPath)
    const durationCeil = Math.max(1, Math.ceil(durationSeconds))

    const spriteStarts: number[] = []
    for (let s = 0; s < durationCeil; s += perSprite) spriteStarts.push(s)
    if (!spriteStarts.length) spriteStarts.push(0)

    const spritePtrs: Array<{ bucket: string; key: string; s3Url: string }> = []
    const manifestSprites: Array<{ startSecond: number; key: string }> = []

    for (const startSecond of spriteStarts) {
      const remaining = Math.max(0, durationSeconds - startSecond)
      const pageSeconds = Math.min(perSprite, Math.max(1, Math.ceil(remaining)))
      const missingSeconds = Math.max(0, perSprite - pageSeconds)

      const outName = `sprite_${startSecond}.jpg`
      const outPath = path.join(tmpDir, outName)
      const outKey = `${String(opts.spritePrefix || '').replace(/\/+$/, '')}/${outName}`.replace(/^\//, '')

      const filters: string[] = [
        `fps=${intervalSeconds}:round=down`,
        `scale=${tileW}:${tileH}:force_original_aspect_ratio=increase`,
        `crop=${tileW}:${tileH}`,
      ]
      if (missingSeconds > 0) filters.push(`tpad=stop_mode=clone:stop_duration=${missingSeconds}`)
      filters.push(`tile=${cols}x${rows}:nb_frames=${perSprite}`)
      const vf = filters.join(',')

      await runFfmpeg(
        [
          '-ss',
          String(startSecond),
          '-t',
          String(pageSeconds),
          '-i',
          proxyPath,
          '-vf',
          vf,
          '-frames:v',
          '1',
          '-q:v',
          '4',
          outPath,
        ],
        opts.logPaths
      )

      await uploadFileToS3(opts.outputBucket, outKey, outPath, 'image/jpeg')
      spritePtrs.push({ bucket: opts.outputBucket, key: outKey, s3Url: `s3://${opts.outputBucket}/${outKey}` })
      manifestSprites.push({ startSecond, key: outKey })
    }

    const manifest: TimelineSpritesManifestV1 = {
      uploadId: Number(opts.uploadId),
      intervalSeconds,
      tile: { w: tileW, h: tileH },
      sprite: { cols, rows, perSprite },
      durationSeconds,
      sprites: manifestSprites,
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    await uploadFileToS3(opts.outputBucket, opts.manifestKey, manifestPath, 'application/json; charset=utf-8')

    return {
      durationSeconds,
      manifest: { bucket: opts.outputBucket, key: opts.manifestKey, s3Url: `s3://${opts.outputBucket}/${opts.manifestKey}` },
      sprites: spritePtrs,
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
