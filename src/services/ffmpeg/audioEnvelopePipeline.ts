import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { downloadS3ObjectToFile, runFfmpeg, uploadFileToS3 } from './audioPipeline'
import { probeMediaInfo, type MediaInfo } from './metrics'

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

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

async function hasAudioStream(filePath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const p = spawn(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    let out = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.on('close', () => {
      const v = String(out || '').trim().toLowerCase()
      resolve(v === 'audio')
    })
    p.on('error', () => resolve(false))
  })
}

function dbToNorm(db: number | null): number {
  // Convert dBFS to a perceptually useful 0..1 value without normalizing per-video.
  // Use linear amplitude (10^(dB/20)) and a mild gamma to keep quiet material visible.
  if (db == null || !Number.isFinite(db)) return 0
  const clamped = clamp(db, -60, 0)
  const amp = Math.pow(10, clamped / 20) // 0..1
  const gamma = 0.5
  return clamp(Math.pow(amp, gamma), 0, 1)
}

function parseAstatsMetadataFile(txt: string, intervalSeconds: number): Array<{ t: number; v: number }> {
  const out: Array<{ t: number; v: number }> = []
  const lines = String(txt || '').split(/\r?\n/)
  let t: number | null = null
  const seen = new Map<number, number>()

  for (const line of lines) {
    const mT = line.match(/pts_time:([0-9.]+)/)
    if (mT) {
      const v = Number(mT[1])
      if (Number.isFinite(v)) t = v
      continue
    }
    if (!line.includes('lavfi.astats.Overall.RMS_level')) continue
    if (t == null) continue
    const mV = line.match(/lavfi\.astats\.Overall\.RMS_level=([^\s]+)/)
    if (!mV) continue
    const raw = String(mV[1] || '').trim()
    let db: number | null = null
    if (raw === '-inf' || raw === 'inf' || raw === 'nan') db = -60
    else {
      const n = Number(raw)
      db = Number.isFinite(n) ? n : -60
    }
    const tt = Math.round((t / intervalSeconds)) * intervalSeconds
    const roundedT = Math.round(tt * 10) / 10
    seen.set(roundedT, dbToNorm(db))
  }

  const keys = Array.from(seen.keys()).sort((a, b) => a - b)
  for (const k of keys) out.push({ t: k, v: seen.get(k) || 0 })
  return out
}

export type AudioEnvelopeV1 = {
  version: 'audio_envelope_v3'
  intervalSeconds: number
  durationSeconds: number
  hasAudio: boolean
  points: Array<{ t: number; v: number }>
}

export async function createUploadAudioEnvelopeJson(opts: {
  uploadId: number
  proxy: { bucket: string; key: string }
  outputBucket: string
  outputKey: string
  intervalSeconds?: number
  logPaths?: { stdoutPath?: string; stderrPath?: string }
}): Promise<{ output: { bucket: string; key: string; s3Url: string }; envelope: AudioEnvelopeV1; metricsInput?: MediaInfo | null }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-upload-audio-envelope-'))
  const proxyPath = path.join(tmpDir, 'proxy.mp4')
  const metaPath = path.join(tmpDir, 'astats.txt')
  const jsonPath = path.join(tmpDir, 'envelope.json')

  const intervalSeconds = Math.max(0.1, Math.min(1, Math.round(Number(opts.intervalSeconds ?? 0.1) * 10) / 10))

  try {
    await downloadS3ObjectToFile(opts.proxy.bucket, opts.proxy.key, proxyPath)
    const metricsInput = await probeMediaInfo(proxyPath)
    const durationSeconds = await probeDurationSeconds(proxyPath)
    const hasAudio = await hasAudioStream(proxyPath)

    let points: Array<{ t: number; v: number }> = []
    if (hasAudio) {
      // Write astats metadata to a file so we can parse it without scraping stderr logs.
      const sampleRate = 48000
      const n = Math.max(64, Math.round(sampleRate * intervalSeconds))
      const af = [
        `aresample=${sampleRate}`,
        `asetnsamples=n=${n}:p=1`,
        `astats=metadata=1:reset=1`,
        `ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${metaPath}`,
      ].join(',')
      await runFfmpeg(['-i', proxyPath, '-vn', '-sn', '-dn', '-af', af, '-f', 'null', '-'], opts.logPaths)
      const txt = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf8') : ''
      points = parseAstatsMetadataFile(txt, intervalSeconds)
    }

    const envelope: AudioEnvelopeV1 = {
      version: 'audio_envelope_v3',
      intervalSeconds,
      durationSeconds,
      hasAudio,
      points,
    }

    fs.writeFileSync(jsonPath, JSON.stringify(envelope, null, 2))
    await uploadFileToS3(opts.outputBucket, opts.outputKey, jsonPath, 'application/json; charset=utf-8')
    return {
      output: { bucket: opts.outputBucket, key: opts.outputKey, s3Url: `s3://${opts.outputBucket}/${opts.outputKey}` },
      envelope,
      metricsInput,
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
