import { CreateJobCommand } from '@aws-sdk/client-mediaconvert'
import { getMediaConvertClient } from '../aws/mediaconvert'
import { getPool } from '../db'
import { applyAudioNormalization, applyHqTuning, enforceQvbr, getFirstHlsDestinationPrefix, getFirstCmafDestinationPrefix, loadProfileJson, transformSettings } from '../jobs'
import { ACCELERATION_MODE, AWS_REGION, MC_PRIORITY, MC_QUEUE_ARN, MC_ROLE_ARN, OUTPUT_BUCKET, OUTPUT_PREFIX, UPLOAD_BUCKET } from '../config'
import { writeRequestLog } from '../utils/requestLog'
import { ulid as genUlid } from '../utils/ulid'
import { DomainError } from '../core/errors'
import { s3 } from './s3'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pipeline } from 'stream/promises'
import { spawn } from 'child_process'

export type RenderOptions = {
  upload: any
  userId: number
  name?: string | null
  profile?: string | null
  quality?: string | null
  sound?: string | null
  config?: any
}

export async function startProductionRender(options: RenderOptions) {
  const { upload, userId, name, profile, quality, sound, config } = options
  if (!MC_ROLE_ARN) throw new Error('MC_ROLE_ARN not configured')
  const db = getPool()

  const inputUrl = `s3://${upload.s3_bucket}/${upload.s3_key}`
  let chosenProfile = profile || (
    upload.width && upload.height ? (upload.height > upload.width ? 'portrait-hls' : 'landscape-both-hls') : 'simple-hls'
  )
  // Feature flag: prefer CMAF outputs when enabled (keeps same naming for orientation variants)
  try {
    const format = String(process.env.MC_OUTPUT_FORMAT || '').toLowerCase()
    if (!profile && (format === 'cmaf' || format === 'cmaf+hls' || format === 'cmaf+hls+dash')) {
      chosenProfile = chosenProfile.replace(/-hls\b/, '-cmaf')
    }
  } catch {}
  if (!profile && typeof quality === 'string') {
    if (quality.toLowerCase().startsWith('hq')) {
      if (!chosenProfile.endsWith('-hq')) chosenProfile = `${chosenProfile}-hq`
    } else {
      chosenProfile = chosenProfile.replace(/-hq$/, '')
    }
  }
  const isHq = chosenProfile.endsWith('-hq')
  let raw: any
  try {
    raw = loadProfileJson(chosenProfile)
  } catch {
    const baseProfile = isHq ? chosenProfile.replace(/-hq$/, '') : chosenProfile
    raw = loadProfileJson(baseProfile)
  }
  const createdDate = (upload.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
  const keyParts = String(upload.s3_key || '').split('/')
  let assetUuid: string = String(upload.id)
  if (keyParts.length >= 3) {
    assetUuid = keyParts[keyParts.length - 2]
  }
  // Create a production row first to get ULID
  const configPayload = {
    ...(config && typeof config === 'object' ? config : {}),
    profile: profile ?? null,
    quality: quality ?? null,
    sound: sound ?? null,
  }
  const prodUlid = genUlid()
  const [preIns] = await db.query(
    `INSERT INTO productions (upload_id, user_id, name, status, config, ulid)
     VALUES (?, ?, ?, 'queued', ?, ?)`,
    [upload.id, userId, name ?? null, JSON.stringify(configPayload), prodUlid]
  )
  const productionId = Number((preIns as any).insertId)

  const settings = transformSettings(raw, {
    inputUrl,
    outputBucket: OUTPUT_BUCKET,
    assetId: assetUuid,
    dateYMD: createdDate,
    productionUlid: prodUlid,
  })
  // Ensure QVBR + MaxBitrate with no Bitrate across outputs to avoid MC validation error
  enforceQvbr(settings)
  if (isHq) applyHqTuning(settings)
  if (typeof sound === 'string' && sound.toLowerCase().startsWith('norm')) {
    applyAudioNormalization(settings, { targetLkfs: -16, aacBitrate: 128000 })
  }

  // Optional: logo watermark overlay (applies to video outputs only; posters remain unwatermarked).
  await applyLogoWatermarkIfConfigured(settings, {
    config: configPayload,
    videoDurationSeconds: upload?.duration_seconds != null ? Number(upload.duration_seconds) : null,
  })

  // Optional: replace output audio with a music track (looped/truncated to video length when possible).
  await applyMusicReplacementIfConfigured(settings, {
    config: configPayload,
    videoDurationSeconds: upload?.duration_seconds != null ? Number(upload.duration_seconds) : null,
    dateYmd: createdDate,
    productionUlid: prodUlid,
  })

  try {
    const groups: any[] = Array.isArray((settings as any).OutputGroups) ? (settings as any).OutputGroups : []
    const hlsDests: string[] = []
    for (const g of groups) {
      const t = g?.OutputGroupSettings?.Type
      if (t === 'HLS_GROUP_SETTINGS') {
        const d = g?.OutputGroupSettings?.HlsGroupSettings?.Destination
        if (typeof d === 'string' && d.startsWith(`s3://${OUTPUT_BUCKET}/`)) {
          hlsDests.push(d)
        }
      }
      if (t === 'CMAF_GROUP_SETTINGS') {
        const d = g?.OutputGroupSettings?.CmafGroupSettings?.Destination
        if (typeof d === 'string' && d.startsWith(`s3://${OUTPUT_BUCKET}/`)) {
          hlsDests.push(d)
        }
      }
    }
    const uniqueDests = Array.from(new Set(hlsDests))
    for (const dest of uniqueDests) {
      let posterWidth: number | undefined
      let posterHeight: number | undefined
      if (dest.includes('/portrait/')) { posterWidth = 720; posterHeight = 1280 }
      else if (dest.includes('/landscape/')) { posterWidth = 1280; posterHeight = 720 }
      const hasPosterForDest = groups.some((g) => g?.OutputGroupSettings?.Type === 'FILE_GROUP_SETTINGS' && g?.OutputGroupSettings?.FileGroupSettings?.Destination === dest)
      if (!hasPosterForDest) {
        const name = dest.includes('/portrait/') ? 'Posters Portrait' : dest.includes('/landscape/') ? 'Posters Landscape' : 'Posters'
        groups.push({
          Name: name,
          OutputGroupSettings: { Type: 'FILE_GROUP_SETTINGS', FileGroupSettings: { Destination: dest } },
          Outputs: [
            {
              NameModifier: '_poster',
              ContainerSettings: { Container: 'RAW' },
              Extension: 'jpg',
              VideoDescription: {
                ...(posterWidth && posterHeight ? { Width: posterWidth, Height: posterHeight, ScalingBehavior: 'DEFAULT' as const, Sharpness: 50 } : {}),
                CodecSettings: {
                  Codec: 'FRAME_CAPTURE',
                  FrameCaptureSettings: {
                    CaptureIntervalUnits: 'FRAMES',
                    CaptureInterval: 1,
                    MaxCaptures: 1,
                    Quality: 80,
                  },
                },
              },
            },
          ],
        })
      }
    }
    ;(settings as any).OutputGroups = groups
  } catch {}

  try {
    const groups: any[] = Array.isArray((settings as any).OutputGroups) ? (settings as any).OutputGroups : []
    const cleaned: any[] = []
    for (const g of groups) {
      const t = g?.OutputGroupSettings?.Type
      if (t === 'HLS_GROUP_SETTINGS' || t === 'CMAF_GROUP_SETTINGS' || t === 'FILE_GROUP_SETTINGS') {
        if (!Array.isArray(g.Outputs)) g.Outputs = []
        for (const o of g.Outputs) {
          if (!o.ContainerSettings) {
            if (t === 'FILE_GROUP_SETTINGS') o.ContainerSettings = { Container: 'RAW' }
            if (t === 'HLS_GROUP_SETTINGS') o.ContainerSettings = { Container: 'M3U8' } as any
            if (t === 'CMAF_GROUP_SETTINGS') o.ContainerSettings = { Container: 'CMFC' } as any
          }
        }
        cleaned.push(g)
      }
    }
    ;(settings as any).OutputGroups = cleaned
  } catch {}

  const mc = await getMediaConvertClient(AWS_REGION)
  const params: any = {
    Role: MC_ROLE_ARN,
    Queue: MC_QUEUE_ARN,
    AccelerationSettings: { Mode: ACCELERATION_MODE },
    Priority: MC_PRIORITY,
    UserMetadata: { upload_id: String(upload.id), profile: profile || '' },
    Settings: settings,
  }

  writeRequestLog(`upload:${upload.id}:${profile || ''}`, params)
  const resp = await mc.send(new CreateJobCommand(params))
  const jobId = resp.Job?.Id || null
  const outPrefix = getFirstCmafDestinationPrefix(settings, OUTPUT_BUCKET) || getFirstHlsDestinationPrefix(settings, OUTPUT_BUCKET) || `${OUTPUT_PREFIX}${upload.id}/`

  await db.query(
    `UPDATE uploads SET status = 'queued', mediaconvert_job_id = ?, output_prefix = ?, profile = ? WHERE id = ?`,
    [jobId, outPrefix, profile ?? null, upload.id]
  )
  await db.query(
    `UPDATE productions SET mediaconvert_job_id = ?, output_prefix = ? WHERE id = ?`,
    [jobId, outPrefix, productionId]
  )

  return { jobId, outPrefix, productionId, profile: profile ?? null }
}

type LogoConfigSnapshot = {
  id?: number
  name?: string
  position?: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'center'
  sizePctWidth?: number
  opacityPct?: number
  timingRule?: 'entire' | 'start_after' | 'first_only' | 'last_only'
  timingSeconds?: number | null
  fade?: 'none' | 'in' | 'out' | 'in_out'
}

function clampInt(n: any, min: number, max: number): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return min
  return Math.min(Math.max(v, min), max)
}

function secondsToTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:00`
}

function computeOverlayRect(outputW: number, outputH: number, logoW: number, logoH: number, cfg: LogoConfigSnapshot) {
  const pct = clampInt(cfg.sizePctWidth ?? 15, 1, 100)
  const opacity = clampInt(cfg.opacityPct ?? 35, 0, 100)
  const margin = Math.max(8, Math.round(outputW * 0.02))
  const renderW = Math.max(1, Math.round(outputW * (pct / 100)))
  const aspect = logoW > 0 && logoH > 0 ? (logoH / logoW) : 1
  const renderH = Math.max(1, Math.round(renderW * aspect))

  let x = margin
  let y = margin
  const pos = cfg.position || 'bottom_right'
  if (pos === 'top_left') { x = margin; y = margin }
  else if (pos === 'top_right') { x = Math.max(0, outputW - renderW - margin); y = margin }
  else if (pos === 'bottom_left') { x = margin; y = Math.max(0, outputH - renderH - margin) }
  else if (pos === 'bottom_right') { x = Math.max(0, outputW - renderW - margin); y = Math.max(0, outputH - renderH - margin) }
  else { x = Math.max(0, Math.round((outputW - renderW) / 2)); y = Math.max(0, Math.round((outputH - renderH) / 2)) }

  return { x, y, width: renderW, height: renderH, opacity }
}

function computeTiming(cfg: LogoConfigSnapshot, videoDurationSeconds: number | null) {
  const rule = cfg.timingRule || 'entire'
  const secs = cfg.timingSeconds == null ? null : clampInt(cfg.timingSeconds, 0, 3600)
  const fallbackDurationMs = 60 * 60 * 1000
  const totalMs = videoDurationSeconds != null && Number.isFinite(videoDurationSeconds) && videoDurationSeconds > 0
    ? Math.max(1, Math.round(videoDurationSeconds * 1000))
    : fallbackDurationMs

  if (rule === 'entire') {
    return { startTime: secondsToTimecode(0), durationMs: totalMs }
  }
  if (rule === 'start_after') {
    const startS = secs ?? 0
    const startMs = Math.max(0, Math.round(startS * 1000))
    const durMs = Math.max(1, totalMs - startMs)
    return { startTime: secondsToTimecode(startS), durationMs: durMs }
  }
  if (rule === 'first_only') {
    const dur = Math.max(0, (secs ?? 0) * 1000)
    return { startTime: secondsToTimecode(0), durationMs: Math.max(1, Math.min(dur, totalMs)) }
  }
  // last_only
  const dur = Math.max(0, (secs ?? 0) * 1000)
  if (videoDurationSeconds != null && videoDurationSeconds > 0 && secs != null) {
    const startS = Math.max(0, videoDurationSeconds - secs)
    return { startTime: secondsToTimecode(startS), durationMs: Math.max(1, Math.min(dur, totalMs)) }
  }
  return { startTime: secondsToTimecode(0), durationMs: Math.max(1, Math.min(dur || totalMs, totalMs)) }
}

function computeFade(cfg: LogoConfigSnapshot) {
  const fadeMs = 500
  const fade = cfg.fade || 'none'
  if (fade === 'in') return { FadeIn: fadeMs, FadeOut: 0 }
  if (fade === 'out') return { FadeIn: 0, FadeOut: fadeMs }
  if (fade === 'in_out') return { FadeIn: fadeMs, FadeOut: fadeMs }
  return { FadeIn: 0, FadeOut: 0 }
}

async function applyLogoWatermarkIfConfigured(settings: any, opts: { config: any; videoDurationSeconds: number | null }) {
  const cfgObj = opts.config && typeof opts.config === 'object' ? opts.config : null
  if (!cfgObj) return
  const logoUploadId = cfgObj.logoUploadId != null ? Number(cfgObj.logoUploadId) : null
  const snapshot = (cfgObj.logoConfigSnapshot && typeof cfgObj.logoConfigSnapshot === 'object') ? (cfgObj.logoConfigSnapshot as LogoConfigSnapshot) : null
  if (!logoUploadId || !snapshot) return

  const db = getPool()
  const [rows] = await db.query(`SELECT id, kind, status, s3_bucket, s3_key, content_type, width, height FROM uploads WHERE id = ? LIMIT 1`, [logoUploadId])
  const logo = (rows as any[])[0]
  if (!logo) throw new DomainError('logo_upload_not_found', 'logo_upload_not_found', 404)
  const kind = String(logo.kind || '').toLowerCase()
  if (kind !== 'logo') throw new DomainError('invalid_logo_upload_kind', 'invalid_logo_upload_kind', 400)
  const st = String(logo.status || '').toLowerCase()
  if (st !== 'uploaded' && st !== 'completed') throw new DomainError('invalid_logo_upload_state', 'invalid_logo_upload_state', 422)

  const ct = String(logo.content_type || '').toLowerCase()
  const key = String(logo.s3_key || '')
  // MediaConvert ImageInserter expects PNG or TGA. We only support PNG for now.
  const isPng = ct === 'image/png' || key.toLowerCase().endsWith('.png')
  if (!isPng) throw new DomainError('logo_requires_png', 'logo_requires_png', 400)

  const logoUrl = `s3://${String(logo.s3_bucket)}/${key}`
  const logoW = logo.width != null ? Number(logo.width) : 0
  const logoH = logo.height != null ? Number(logo.height) : 0

  const timing = computeTiming(snapshot, opts.videoDurationSeconds)
  const fades = computeFade(snapshot)

  const groups: any[] = Array.isArray(settings?.OutputGroups) ? settings.OutputGroups : []
  for (const g of groups) {
    const t = g?.OutputGroupSettings?.Type
    if (t !== 'HLS_GROUP_SETTINGS' && t !== 'CMAF_GROUP_SETTINGS') continue
    const outs: any[] = Array.isArray(g?.Outputs) ? g.Outputs : []
    for (const o of outs) {
      const vd = o?.VideoDescription
      const cs = vd?.CodecSettings
      if (!vd || !cs) continue
      if (cs.Codec === 'FRAME_CAPTURE') continue
      const outW = vd.Width != null ? Number(vd.Width) : null
      const outH = vd.Height != null ? Number(vd.Height) : null
      if (!outW || !outH) continue

      const rect = computeOverlayRect(outW, outH, logoW, logoH, snapshot)
      if (!vd.VideoPreprocessors) vd.VideoPreprocessors = {}
      if (!vd.VideoPreprocessors.ImageInserter) vd.VideoPreprocessors.ImageInserter = {}
      if (!Array.isArray(vd.VideoPreprocessors.ImageInserter.InsertableImages)) {
        vd.VideoPreprocessors.ImageInserter.InsertableImages = []
      }
      vd.VideoPreprocessors.ImageInserter.InsertableImages.push({
        ImageInserterInput: logoUrl,
        ImageX: rect.x,
        ImageY: rect.y,
        Width: rect.width,
        Height: rect.height,
        Opacity: rect.opacity,
        Layer: 1,
        StartTime: timing.startTime,
        Duration: timing.durationMs,
        ...fades,
      })
    }
  }
}

async function downloadS3ObjectToFile(bucket: string, key: string, filePath: string) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const body = resp.Body as any
  if (!body) throw new Error('missing_s3_body')
  await pipeline(body, fs.createWriteStream(filePath))
}

async function uploadFileToS3(bucket: string, key: string, filePath: string, contentType: string) {
  const body = fs.createReadStream(filePath)
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'no-store' }))
}

async function runFfmpeg(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    p.stderr.on('data', (d) => { stderr += String(d) })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) return resolve()
      reject(new Error(`ffmpeg_failed:${code}:${stderr.slice(0, 800)}`))
    })
  })
}

function ymdToFolder(ymd: string): string {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(ymd || '')
  return `${m[1]}-${m[2]}/${m[3]}`
}

function parseS3Url(url: string): { bucket: string; key: string } | null {
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

async function applyMusicReplacementIfConfigured(settings: any, opts: { config: any; videoDurationSeconds: number | null; dateYmd: string; productionUlid: string }) {
  const cfgObj = opts.config && typeof opts.config === 'object' ? opts.config : null
  if (!cfgObj) return
  const musicUploadId = cfgObj.musicUploadId != null ? Number(cfgObj.musicUploadId) : null
  if (!musicUploadId) return

  const db = getPool()
  const [rows] = await db.query(`SELECT id, kind, status, s3_bucket, s3_key, content_type FROM uploads WHERE id = ? LIMIT 1`, [musicUploadId])
  const au = (rows as any[])[0]
  if (!au) throw new DomainError('audio_upload_not_found', 'audio_upload_not_found', 404)
  const kind = String(au.kind || '').toLowerCase()
  if (kind !== 'audio') throw new DomainError('invalid_audio_upload_kind', 'invalid_audio_upload_kind', 400)
  const st = String(au.status || '').toLowerCase()
  if (st !== 'uploaded' && st !== 'completed') throw new DomainError('invalid_audio_upload_state', 'invalid_audio_upload_state', 422)
  const srcBucket = String(au.s3_bucket || '')
  const srcKey = String(au.s3_key || '')
  if (!srcBucket || !srcKey) throw new DomainError('audio_upload_not_found', 'audio_upload_not_found', 404)

  // MediaConvert selects audio per-input across the timeline; it doesn't "sidechain" audio from a second input
  // into the first input's video. For replace-mode, pre-mux the music into the video input (copy video stream),
  // then run the existing single-input profile unchanged.
  if (!Array.isArray(settings?.Inputs) || !settings.Inputs[0]) return
  const videoInput = settings.Inputs[0]
  const videoUrl = String(videoInput.FileInput || '')
  const videoS3 = parseS3Url(videoUrl)
  if (!videoS3) return
  const originalLeaf = path.posix.basename(videoS3.key) || 'video.mp4'

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-audio-replace-'))
  const videoPath = path.join(tmpDir, 'video')
  const audioPath = path.join(tmpDir, 'music')
  const outPath = path.join(tmpDir, 'muxed.mp4')
  try {
    await downloadS3ObjectToFile(videoS3.bucket, videoS3.key, videoPath)
    await downloadS3ObjectToFile(srcBucket, srcKey, audioPath)

    // Loop music indefinitely; stop output at end of video.
    try {
      await runFfmpeg([
        '-i', videoPath,
        '-stream_loop', '-1',
        '-i', audioPath,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '48000',
        '-ac', '2',
        '-movflags', '+faststart',
        '-shortest',
        outPath,
      ])
    } catch {
      // Fallback: if stream copy fails, re-encode video (best-effort).
      await runFfmpeg([
        '-i', videoPath,
        '-stream_loop', '-1',
        '-i', audioPath,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '48000',
        '-ac', '2',
        '-movflags', '+faststart',
        '-shortest',
        outPath,
      ])
    }

    // Preserve the original input basename so MediaConvert output names stay stable (e.g. "video.m3u8"),
    // since the app derives master/poster URLs from the upload's original key leaf.
    const folder = ymdToFolder(opts.dateYmd)
    const key = `music-replace/${folder}/${opts.productionUlid}/${randomUUID()}/${originalLeaf}`
    await uploadFileToS3(UPLOAD_BUCKET, key, outPath, 'video/mp4')
    videoInput.FileInput = `s3://${UPLOAD_BUCKET}/${key}`
  } catch (e) {
    // Best-effort: if we can't mux, keep original audio/video.
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
