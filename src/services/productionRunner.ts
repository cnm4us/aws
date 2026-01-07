import { CreateJobCommand } from '@aws-sdk/client-mediaconvert'
import { getMediaConvertClient } from '../aws/mediaconvert'
import { getPool } from '../db'
import { applyHqTuning, enforceQvbr, getFirstHlsDestinationPrefix, getFirstCmafDestinationPrefix, loadProfileJson, transformSettings } from '../jobs'
import { ACCELERATION_MODE, AWS_REGION, MC_PRIORITY, MC_QUEUE_ARN, MC_ROLE_ARN, MC_WATERMARK_POSTERS, MEDIA_CONVERT_NORMALIZE_AUDIO, MEDIA_JOBS_ENABLED, MEDIA_VIDEO_HIGHPASS_ENABLED, MEDIA_VIDEO_HIGHPASS_HZ, OUTPUT_BUCKET, OUTPUT_PREFIX, UPLOAD_BUCKET } from '../config'
import { writeRequestLog } from '../utils/requestLog'
import { ulid as genUlid } from '../utils/ulid'
import { DomainError } from '../core/errors'
import path from 'path'
import { applyConfiguredTransforms } from './mediaconvert/transforms'
import { createMuxedMp4WithLoopedMixedAudio, createMuxedMp4WithLoopedReplacementAudio, parseS3Url, ymdToFolder } from './ffmpeg/audioPipeline'
import { createMp4WithFrozenFirstFrame, createMp4WithTitleImageIntro } from './ffmpeg/introPipeline'
import { enqueueJob } from '../features/media-jobs/service'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import { s3 } from './s3'
import * as lowerThirdsSvc from '../features/lower-thirds/service'
import { rasterizeLowerThirdSvgToPng } from './lowerThirdPng'

export type RenderOptions = {
  upload: any
  userId: number
  name?: string | null
  profile?: string | null
  quality?: string | null
  sound?: string | null
  config?: any
}

function ensurePosterOutputGroups(settings: any) {
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
}

export async function startMediaConvertForExistingProduction(opts: {
  upload: any
  productionId: number
  productionUlid: string
  profile?: string | null
  quality?: string | null
  sound?: string | null
  configPayload: any
  inputUrlOverride?: string | null
  skipInlineAudioMux?: boolean
  skipAudioNormalization?: boolean
}) {
  if (!MC_ROLE_ARN) throw new Error('MC_ROLE_ARN not configured')
  const db = getPool()

  const inputUrl = opts.inputUrlOverride || `s3://${opts.upload.s3_bucket}/${opts.upload.s3_key}`
  let chosenProfile = opts.profile || (
    opts.upload.width && opts.upload.height ? (opts.upload.height > opts.upload.width ? 'portrait-hls' : 'landscape-both-hls') : 'simple-hls'
  )
  // Feature flag: prefer CMAF outputs when enabled (keeps same naming for orientation variants)
  try {
    const format = String(process.env.MC_OUTPUT_FORMAT || '').toLowerCase()
    if (!opts.profile && (format === 'cmaf' || format === 'cmaf+hls' || format === 'cmaf+hls+dash')) {
      chosenProfile = chosenProfile.replace(/-hls\b/, '-cmaf')
    }
  } catch {}
  if (!opts.profile && typeof opts.quality === 'string') {
    if (opts.quality.toLowerCase().startsWith('hq')) {
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

  const createdDate = (opts.upload.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
  const keyParts = String(opts.upload.s3_key || '').split('/')
  let assetUuid: string = String(opts.upload.id)
  if (keyParts.length >= 3) {
    assetUuid = keyParts[keyParts.length - 2]
  }

  const settings = transformSettings(raw, {
    inputUrl,
    outputBucket: OUTPUT_BUCKET,
    assetId: assetUuid,
    dateYMD: createdDate,
    productionUlid: opts.productionUlid,
  })
  // Ensure QVBR + MaxBitrate with no Bitrate across outputs to avoid MC validation error
  enforceQvbr(settings)
  if (isHq) applyHqTuning(settings)
  await applyConfiguredTransforms(settings, {
    config: opts.configPayload,
    upload: opts.upload,
    videoDurationSeconds: opts.upload?.duration_seconds != null ? Number(opts.upload.duration_seconds) : null,
    productionUlid: opts.productionUlid,
    skipAudioNormalization: Boolean(opts.skipAudioNormalization),
  })

  ensurePosterOutputGroups(settings)

  let durationSeconds: number | null =
    opts.upload?.duration_seconds != null && Number.isFinite(Number(opts.upload.duration_seconds)) && Number(opts.upload.duration_seconds) > 0
      ? Number(opts.upload.duration_seconds)
      : null
  try {
    const intro = (opts.configPayload as any)?.intro
    if (durationSeconds != null && intro && typeof intro === 'object') {
      const kind = String((intro as any).kind || '').trim()
      if (kind === 'freeze_first_frame') {
        const secs = Number((intro as any).seconds)
        const rounded = Number.isFinite(secs) ? Math.round(secs) : 0
        if (rounded > 0) durationSeconds += rounded
      } else if (kind === 'title_image') {
        const secs = Number((intro as any).holdSeconds)
        const rounded = Number.isFinite(secs) ? Math.round(secs) : 0
        if (rounded > 0) durationSeconds += rounded
      }
    }
  } catch {}

  const lowerThirdApplied = await applyLowerThirdImageIfConfigured(settings, {
    config: opts.configPayload,
    videoDurationSeconds: durationSeconds,
  })
  if (!lowerThirdApplied) {
    await applyLowerThirdIfConfigured(settings, {
      config: opts.configPayload,
      videoDurationSeconds: durationSeconds,
      dateYmd: createdDate,
      productionUlid: opts.productionUlid,
    })
  }

  await applyLogoWatermarkIfConfigured(settings, {
    config: opts.configPayload,
    videoDurationSeconds: durationSeconds,
  })

  if (!opts.skipInlineAudioMux) {
    await applyMusicReplacementIfConfigured(settings, {
      config: opts.configPayload,
      videoDurationSeconds: durationSeconds,
      dateYmd: createdDate,
      productionUlid: opts.productionUlid,
    })
  }

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
    UserMetadata: { upload_id: String(opts.upload.id), profile: opts.profile || '' },
    Settings: settings,
  }

  writeRequestLog(`upload:${opts.upload.id}:${opts.profile || ''}`, params)
  const resp = await mc.send(new CreateJobCommand(params))
  const jobId = resp.Job?.Id || null
  const outPrefix = getFirstCmafDestinationPrefix(settings, OUTPUT_BUCKET) || getFirstHlsDestinationPrefix(settings, OUTPUT_BUCKET) || `${OUTPUT_PREFIX}${opts.upload.id}/`

  await db.query(
    `UPDATE uploads SET status = 'queued', mediaconvert_job_id = ?, output_prefix = ?, profile = ? WHERE id = ?`,
    [jobId, outPrefix, opts.profile ?? null, opts.upload.id]
  )
  await db.query(
    `UPDATE productions
        SET status = 'queued',
            mediaconvert_job_id = ?,
            output_prefix = ?,
            error_message = NULL,
            updated_at = NOW()
      WHERE id = ?`,
    [jobId, outPrefix, opts.productionId]
  )

  return { jobId, outPrefix, profile: opts.profile ?? null }
}

export async function startProductionRender(options: RenderOptions) {
  const { upload, userId, name, profile, quality, sound, config } = options
  if (!MC_ROLE_ARN) throw new Error('MC_ROLE_ARN not configured')
  const db = getPool()

  const cfgObj = config && typeof config === 'object' ? config : {}
  const configPayload = {
    ...cfgObj,
    profile: profile ?? null,
    quality: quality ?? null,
    sound: sound ?? null,
  }
  const prodUlid = genUlid()
  const musicUploadId = cfgObj && cfgObj.musicUploadId != null ? Number(cfgObj.musicUploadId) : null
  const introRaw = cfgObj && (cfgObj as any).intro != null ? (cfgObj as any).intro : null
  let introSeconds = 0
  let introForJob: any = null
  if (introRaw != null && introRaw !== false) {
    if (typeof introRaw === 'number' || typeof introRaw === 'string') {
      const secs = Number(introRaw)
      const rounded = Number.isFinite(secs) ? Math.round(secs) : 0
      if ([2, 3, 4, 5].includes(rounded)) {
        introSeconds = rounded
        introForJob = { kind: 'freeze_first_frame', seconds: introSeconds }
      }
    } else if (typeof introRaw === 'object') {
      const kind = String((introRaw as any).kind || '').trim()
      if (kind === 'freeze_first_frame') {
        const secs = Number((introRaw as any).seconds)
        const rounded = Number.isFinite(secs) ? Math.round(secs) : 0
        if ([2, 3, 4, 5].includes(rounded)) {
          introSeconds = rounded
          introForJob = { kind: 'freeze_first_frame', seconds: introSeconds }
        }
      } else if (kind === 'title_image') {
        const uploadId = Number((introRaw as any).uploadId)
        const holdRaw = (introRaw as any).holdSeconds != null ? Number((introRaw as any).holdSeconds) : 0
        const holdSeconds = Number.isFinite(holdRaw) ? Math.round(holdRaw) : 0
        if (Number.isFinite(uploadId) && uploadId > 0 && [0, 2, 3, 4, 5].includes(holdSeconds)) {
          const [rows] = await db.query(
            `SELECT id, kind, image_role, status, s3_bucket, s3_key
               FROM uploads
              WHERE id = ?
              LIMIT 1`,
            [uploadId]
          )
          const img = (rows as any[])[0]
          if (!img) throw new DomainError('image_upload_not_found', 'image_upload_not_found', 404)
          const k = String(img.kind || '').toLowerCase()
          if (k !== 'image') throw new DomainError('invalid_image_upload_kind', 'invalid_image_upload_kind', 400)
          const role = String(img.image_role || '').toLowerCase()
          if (role !== 'title_page') throw new DomainError('invalid_image_role', 'invalid_image_role', 400)
          const st = String(img.status || '').toLowerCase()
          if (st !== 'uploaded' && st !== 'completed') throw new DomainError('invalid_image_upload_state', 'invalid_image_upload_state', 422)
          introForJob = {
            kind: 'title_image',
            uploadId,
            holdSeconds,
            titleImage: { bucket: String(img.s3_bucket), key: String(img.s3_key) },
          }
        }
      }
    }
  }
  const hasMusic = Boolean(musicUploadId && Number.isFinite(musicUploadId) && musicUploadId > 0)
  const needsMediaJob = Boolean(MEDIA_JOBS_ENABLED && (hasMusic || introForJob != null))
  const initialStatus = needsMediaJob ? 'pending_media' : 'queued'
  let jobInputBase: any = null
  if (needsMediaJob && hasMusic) {
    const [rows] = await db.query(
      `SELECT id, kind, status, s3_bucket, s3_key, content_type
         FROM uploads
        WHERE id = ?
        LIMIT 1`,
      [musicUploadId]
    )
    const au = (rows as any[])[0]
    if (!au) throw new DomainError('audio_upload_not_found', 'audio_upload_not_found', 404)
    const kind = String(au.kind || '').toLowerCase()
    if (kind !== 'audio') throw new DomainError('invalid_audio_upload_kind', 'invalid_audio_upload_kind', 400)
    const st = String(au.status || '').toLowerCase()
    if (st !== 'uploaded' && st !== 'completed') throw new DomainError('invalid_audio_upload_state', 'invalid_audio_upload_state', 422)

    const audioCfg = (cfgObj.audioConfigSnapshot && typeof cfgObj.audioConfigSnapshot === 'object') ? cfgObj.audioConfigSnapshot : null
    const mode = audioCfg && typeof audioCfg.mode === 'string' ? String(audioCfg.mode).toLowerCase() : 'mix'
    const videoGainDb = audioCfg && audioCfg.videoGainDb != null ? Number(audioCfg.videoGainDb) : 0
    const musicGainDb = audioCfg && audioCfg.musicGainDb != null ? Number(audioCfg.musicGainDb) : -18
    const duckingModeRaw = audioCfg && typeof audioCfg.duckingMode === 'string' ? String(audioCfg.duckingMode).toLowerCase() : 'none'
    const duckingMode: 'none' | 'rolling' | 'abrupt' =
      duckingModeRaw === 'abrupt' || duckingModeRaw === 'rolling' || duckingModeRaw === 'none' ? duckingModeRaw : 'none'
    const duckingGateRaw = audioCfg && typeof audioCfg.duckingGate === 'string' ? String(audioCfg.duckingGate).toLowerCase() : 'normal'
    const duckingGate: 'sensitive' | 'normal' | 'strict' =
      duckingGateRaw === 'sensitive' || duckingGateRaw === 'strict' || duckingGateRaw === 'normal' ? duckingGateRaw : 'normal'
    const duckingAmountDb = audioCfg && audioCfg.duckingAmountDb != null ? Number(audioCfg.duckingAmountDb) : 12
    const openerCutFadeBeforeSeconds =
      audioCfg && audioCfg.openerCutFadeBeforeSeconds != null ? Number(audioCfg.openerCutFadeBeforeSeconds) : null
    const openerCutFadeAfterSeconds =
      audioCfg && audioCfg.openerCutFadeAfterSeconds != null ? Number(audioCfg.openerCutFadeAfterSeconds) : null
    const durRaw = audioCfg && audioCfg.audioDurationSeconds != null ? Number(audioCfg.audioDurationSeconds) : null
    const audioDurationSeconds = durRaw != null && Number.isFinite(durRaw) ? Math.max(2, Math.min(20, Math.round(durRaw))) : null
    const audioFadeEnabled = audioCfg && audioCfg.audioFadeEnabled != null
      ? Boolean(audioCfg.audioFadeEnabled === true || String(audioCfg.audioFadeEnabled || '').toLowerCase() === 'true' || String(audioCfg.audioFadeEnabled || '') === '1')
      : true

    const createdDate = (upload.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    const originalLeaf = path.posix.basename(String(upload.s3_key || '')) || 'video.mp4'
    const videoDurationSeconds =
      upload?.duration_seconds != null && Number.isFinite(Number(upload.duration_seconds)) && Number(upload.duration_seconds) > 0
        ? Number(upload.duration_seconds)
        : null

	    jobInputBase = {
	      productionUlid: prodUlid,
	      userId: Number(userId),
	      uploadId: Number(upload.id),
	      dateYmd: createdDate,
	      originalLeaf,
	      videoDurationSeconds,
	      video: { bucket: String(upload.s3_bucket), key: String(upload.s3_key) },
	      music: { bucket: String(au.s3_bucket), key: String(au.s3_key) },
	      intro: introForJob,
	      introSeconds: introForJob && introForJob.kind === 'freeze_first_frame' ? introSeconds : null,
	      mode: mode === 'replace' ? 'replace' : 'mix',
	      videoGainDb,
	      musicGainDb,
	      duckingMode,
      duckingGate,
      duckingAmountDb,
      openerCutFadeBeforeSeconds: mode === 'mix' && duckingMode === 'abrupt' ? (openerCutFadeBeforeSeconds == null ? null : openerCutFadeBeforeSeconds) : null,
      openerCutFadeAfterSeconds: mode === 'mix' && duckingMode === 'abrupt' ? (openerCutFadeAfterSeconds == null ? null : openerCutFadeAfterSeconds) : null,
	      audioDurationSeconds,
	      audioFadeEnabled,
	      normalizeAudio: Boolean(MEDIA_CONVERT_NORMALIZE_AUDIO),
	      normalizeTargetLkfs: -16,
	      videoHighpassEnabled: Boolean(MEDIA_VIDEO_HIGHPASS_ENABLED),
	      videoHighpassHz: Number(MEDIA_VIDEO_HIGHPASS_HZ),
	      outputBucket: UPLOAD_BUCKET,
	    }
	  }

  const [preIns] = await db.query(
    `INSERT INTO productions (upload_id, user_id, name, status, config, ulid)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [upload.id, userId, name ?? null, initialStatus, JSON.stringify(configPayload), prodUlid]
  )
  const productionId = Number((preIns as any).insertId)

  if (needsMediaJob) {
    if (hasMusic) {
      const job = await enqueueJob('audio_master_v1', { productionId, ...jobInputBase })
      return { jobId: null, outPrefix: null, productionId, profile: profile ?? null, mediaJobId: Number((job as any).id) }
    }
    if (introForJob != null) {
      const createdDate = (upload.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
      const originalLeaf = path.posix.basename(String(upload.s3_key || '')) || 'video.mp4'
      const videoDurationSeconds =
        upload?.duration_seconds != null && Number.isFinite(Number(upload.duration_seconds)) && Number(upload.duration_seconds) > 0
          ? Number(upload.duration_seconds)
          : null
      const job = await enqueueJob('video_master_v1', {
        productionId,
        productionUlid: prodUlid,
        userId: Number(userId),
        uploadId: Number(upload.id),
        dateYmd: createdDate,
        originalLeaf,
        videoDurationSeconds,
        video: { bucket: String(upload.s3_bucket), key: String(upload.s3_key) },
        intro: introForJob,
        introSeconds: introForJob.kind === 'freeze_first_frame' ? introSeconds : 0,
        outputBucket: UPLOAD_BUCKET,
      })
      return { jobId: null, outPrefix: null, productionId, profile: profile ?? null, mediaJobId: Number((job as any).id) }
    }
  }

  // Inline fallback: if intro is selected but media jobs are disabled, pre-master the video synchronously.
  // This keeps feature parity in dev; production should prefer MEDIA_JOBS_ENABLED=1.
  let inputOverride: string | null = null
  if (!MEDIA_JOBS_ENABLED && introForJob != null) {
    const createdDate = (upload.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    const originalLeaf = path.posix.basename(String(upload.s3_key || '')) || 'video.mp4'
    const out = introForJob.kind === 'title_image'
      ? await createMp4WithTitleImageIntro({
        uploadBucket: UPLOAD_BUCKET,
        dateYmd: createdDate,
        productionUlid: prodUlid,
        originalLeaf,
        video: { bucket: String(upload.s3_bucket), key: String(upload.s3_key) },
        titleImage: introForJob.titleImage,
        holdSeconds: introForJob.holdSeconds,
      })
      : await createMp4WithFrozenFirstFrame({
        uploadBucket: UPLOAD_BUCKET,
        dateYmd: createdDate,
        productionUlid: prodUlid,
        originalLeaf,
        video: { bucket: String(upload.s3_bucket), key: String(upload.s3_key) },
        freezeSeconds: introSeconds,
      })
    inputOverride = out.s3Url
  }

  const started = await startMediaConvertForExistingProduction({
    upload,
    productionId,
    productionUlid: prodUlid,
    profile: profile ?? null,
    quality: quality ?? null,
    sound: sound ?? null,
    configPayload,
    inputUrlOverride: inputOverride,
    skipInlineAudioMux: false,
    skipAudioNormalization: false,
  })

  return { ...started, productionId }
}

type LogoConfigSnapshot = {
  id?: number
  name?: string
  position?: 'top_left' | 'top_center' | 'top_right' | 'middle_left' | 'middle_center' | 'middle_right' | 'bottom_left' | 'bottom_center' | 'bottom_right' | 'center'
  sizePctWidth?: number
  opacityPct?: number
  timingRule?: 'entire' | 'start_after' | 'first_only' | 'last_only'
  timingSeconds?: number | null
  fade?: 'none' | 'in' | 'out' | 'in_out'
  insetXPreset?: 'small' | 'medium' | 'large' | null
  insetYPreset?: 'small' | 'medium' | 'large' | null
}

type LowerThirdConfigSnapshot = {
  id?: number
  name?: string
  templateKey?: string
  templateVersion?: number
  params?: Record<string, string>
  timingRule?: 'first_only' | 'entire'
  timingSeconds?: number | null
}

type LowerThirdImageConfigSnapshot = {
  id?: number
  name?: string
  sizeMode?: 'pct' | 'match_image'
  baselineWidth?: 1080 | 1920
  position?: LogoConfigSnapshot['position']
  sizePctWidth?: number
  opacityPct?: number
  timingRule?: 'first_only' | 'entire'
  timingSeconds?: number | null
  fade?: LogoConfigSnapshot['fade']
  insetXPreset?: LogoConfigSnapshot['insetXPreset']
  insetYPreset?: LogoConfigSnapshot['insetYPreset']
}

function clampInt(n: any, min: number, max: number): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return min
  return Math.min(Math.max(v, min), max)
}

function clampNum(n: any, min: number, max: number): number {
  const v = Number(n)
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

function normalizeLegacyPosition(pos: string): string {
  return pos === 'center' ? 'middle_center' : pos
}

function insetPctForPreset(preset: any): number {
  const p = String(preset || '').toLowerCase()
  if (p === 'small') return 0.06
  if (p === 'large') return 0.14
  return 0.10 // medium default
}

function computeOverlayRect(outputW: number, outputH: number, logoW: number, logoH: number, cfg: LogoConfigSnapshot) {
  const pct = clampInt(cfg.sizePctWidth ?? 15, 1, 100)
  const opacity = clampInt(cfg.opacityPct ?? 35, 0, 100)
  const aspect = logoW > 0 && logoH > 0 ? (logoH / logoW) : 1
  let renderW = Math.max(1, Math.round(outputW * (pct / 100)))
  let renderH = Math.max(1, Math.round(renderW * aspect))
  if (renderH > outputH) {
    renderH = outputH
    renderW = Math.max(1, Math.min(outputW, Math.round(renderH / aspect)))
  }

  const posRaw = cfg.position || 'bottom_right'
  const pos = normalizeLegacyPosition(posRaw)
  const [row, col] = String(pos).split('_') as [string, string]
  const yMode = row === 'top' ? 'top' : row === 'bottom' ? 'bottom' : 'middle'
  const xMode = col === 'left' ? 'left' : col === 'right' ? 'right' : 'center'

  // Percent-of-frame insets to protect against cover-crop in players.
  const marginX = xMode === 'center' ? 0 : Math.round(outputW * insetPctForPreset(cfg.insetXPreset))
  const marginY = yMode === 'middle' ? 0 : Math.round(outputH * insetPctForPreset(cfg.insetYPreset))

  let x = 0
  let y = 0
  if (xMode === 'left') x = marginX
  else if (xMode === 'right') x = outputW - renderW - marginX
  else x = Math.round((outputW - renderW) / 2)

  if (yMode === 'top') y = marginY
  else if (yMode === 'bottom') y = outputH - renderH - marginY
  else y = Math.round((outputH - renderH) / 2)

  // Clamp within the output frame.
  x = clampNum(x, 0, Math.max(0, outputW - renderW))
  y = clampNum(y, 0, Math.max(0, outputH - renderH))

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
  const includePosters = Boolean(MC_WATERMARK_POSTERS)

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
    if (t !== 'HLS_GROUP_SETTINGS' && t !== 'CMAF_GROUP_SETTINGS' && !(includePosters && t === 'FILE_GROUP_SETTINGS')) continue
    const outs: any[] = Array.isArray(g?.Outputs) ? g.Outputs : []
    for (const o of outs) {
      const vd = o?.VideoDescription
      const cs = vd?.CodecSettings
      if (!vd || !cs) continue
      if (cs.Codec === 'FRAME_CAPTURE' && !includePosters) continue
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
        Layer: 2,
        StartTime: timing.startTime,
        Duration: timing.durationMs,
        ...fades,
      })
    }
  }
}

function clampLowerThirdSeconds(raw: any): number {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return 10
  if ([5, 10, 15, 20].includes(n)) return n
  return 10
}

function computeLowerThirdTiming(cfg: { timingRule?: any; timingSeconds?: any }, videoDurationSeconds: number | null) {
  const rule = String(cfg.timingRule || '').toLowerCase() === 'entire' ? 'entire' : 'first_only'
  const fallbackDurationMs = 60 * 60 * 1000
  const totalMs =
    videoDurationSeconds != null && Number.isFinite(videoDurationSeconds) && videoDurationSeconds > 0
      ? Math.max(1, Math.round(videoDurationSeconds * 1000))
      : fallbackDurationMs
  if (rule === 'entire') return { startTime: secondsToTimecode(0), durationMs: totalMs }
  const seconds = clampLowerThirdSeconds(cfg.timingSeconds ?? 10)
  return { startTime: secondsToTimecode(0), durationMs: Math.max(1, Math.min(totalMs, seconds * 1000)) }
}

async function uploadPngToS3(bucket: string, key: string, png: Buffer) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: png,
      ContentType: 'image/png',
      CacheControl: 'no-store',
    })
  )
  return { bucket, key, s3Url: `s3://${bucket}/${key}` }
}

async function applyLowerThirdImageIfConfigured(
  settings: any,
  opts: { config: any; videoDurationSeconds: number | null }
): Promise<boolean> {
  const cfgObj = opts.config && typeof opts.config === 'object' ? opts.config : null
  if (!cfgObj) return false

  const lowerThirdUploadId = cfgObj.lowerThirdUploadId != null ? Number(cfgObj.lowerThirdUploadId) : null
  if (!lowerThirdUploadId || !Number.isFinite(lowerThirdUploadId) || lowerThirdUploadId <= 0) return false

  const snapRaw =
    cfgObj.lowerThirdConfigSnapshot && typeof cfgObj.lowerThirdConfigSnapshot === 'object'
      ? (cfgObj.lowerThirdConfigSnapshot as any)
      : null
  const snapshot: LowerThirdImageConfigSnapshot = {
    position: 'bottom_center',
    sizeMode: String(snapRaw?.sizeMode || snapRaw?.size_mode || 'pct').toLowerCase() === 'match_image' ? 'match_image' : 'pct',
    baselineWidth: Number(snapRaw?.baselineWidth || snapRaw?.baseline_width || 1080) === 1920 ? 1920 : 1080,
    sizePctWidth: snapRaw?.sizePctWidth != null ? Number(snapRaw.sizePctWidth) : 82,
    opacityPct: snapRaw?.opacityPct != null ? Number(snapRaw.opacityPct) : 100,
    timingRule: (String(snapRaw?.timingRule || '').toLowerCase() === 'entire' ? 'entire' : 'first_only') as any,
    timingSeconds: snapRaw?.timingSeconds != null ? Number(snapRaw.timingSeconds) : 10,
    fade: (snapRaw?.fade != null ? String(snapRaw.fade) : 'none') as any,
    insetXPreset: snapRaw?.insetXPreset != null ? (String(snapRaw.insetXPreset).toLowerCase() as any) : null,
    insetYPreset: snapRaw?.insetYPreset != null ? (String(snapRaw.insetYPreset).toLowerCase() as any) : 'medium',
  }

  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, kind, status, s3_bucket, s3_key, content_type, width, height, image_role FROM uploads WHERE id = ? LIMIT 1`,
    [lowerThirdUploadId]
  )
  const img = (rows as any[])[0]
  if (!img) throw new DomainError('lower_third_upload_not_found', 'lower_third_upload_not_found', 404)
  const kind = String(img.kind || '').toLowerCase()
  if (kind !== 'image') throw new DomainError('invalid_lower_third_upload_kind', 'invalid_lower_third_upload_kind', 400)
  const role = String(img.image_role || '').toLowerCase()
  if (role !== 'lower_third') throw new DomainError('invalid_image_role', 'invalid_image_role', 400)
  const st = String(img.status || '').toLowerCase()
  if (st !== 'uploaded' && st !== 'completed') throw new DomainError('invalid_lower_third_upload_state', 'invalid_lower_third_upload_state', 422)

  const ct = String(img.content_type || '').toLowerCase()
  const key = String(img.s3_key || '')
  const isPng = ct === 'image/png' || key.toLowerCase().endsWith('.png')
  if (!isPng) throw new DomainError('lower_third_requires_png', 'lower_third_requires_png', 400)

	  const imgUrl = `s3://${String(img.s3_bucket)}/${key}`
	  const imgW = img.width != null ? Number(img.width) : 0
	  const imgH = img.height != null ? Number(img.height) : 0

	  const pctFromBaseline =
	    snapshot.sizeMode === 'match_image' && imgW > 0
	      ? (imgW / (snapshot.baselineWidth === 1920 ? 1920 : 1080)) * 100
	      : null

	  const rectCfg: LogoConfigSnapshot = {
	    position: 'bottom_center',
	    sizePctWidth: clampInt(snapshot.sizePctWidth ?? 82, 1, 100),
	    opacityPct: clampInt(snapshot.opacityPct ?? 100, 0, 100),
    timingRule: (snapshot.timingRule === 'entire' ? 'entire' : 'first_only') as any,
    timingSeconds: snapshot.timingSeconds ?? 10,
    fade: (snapshot.fade as any) ?? 'none',
    insetXPreset: snapshot.insetXPreset ?? null,
    insetYPreset: snapshot.insetYPreset ?? 'medium',
  }

  const timing = computeLowerThirdTiming(snapshot, opts.videoDurationSeconds)
  const fades = computeFade(rectCfg)

  let applied = false
  const groups: any[] = Array.isArray(settings?.OutputGroups) ? settings.OutputGroups : []
  for (const g of groups) {
    const t = g?.OutputGroupSettings?.Type
    if (t !== 'HLS_GROUP_SETTINGS' && t !== 'CMAF_GROUP_SETTINGS' && t !== 'FILE_GROUP_SETTINGS') continue
    const outs: any[] = Array.isArray(g?.Outputs) ? g.Outputs : []
    for (const o of outs) {
      const vd = o?.VideoDescription
      const cs = vd?.CodecSettings
      if (!vd || !cs) continue
      if (t === 'FILE_GROUP_SETTINGS' && cs.Codec !== 'FRAME_CAPTURE') continue
	    const outW = vd.Width != null ? Number(vd.Width) : null
	    const outH = vd.Height != null ? Number(vd.Height) : null
	    if (!outW || !outH) continue

      const cfgForOut: LogoConfigSnapshot = { ...rectCfg }
      if (snapshot.sizeMode === 'match_image' && pctFromBaseline != null && Number.isFinite(pctFromBaseline) && pctFromBaseline > 0 && imgW > 0) {
        const pctNoUpscale = (imgW / outW) * 100
        const pctUsed = Math.min(pctFromBaseline, pctNoUpscale, 100)
        // Use floor so we don't accidentally round up and upscale by a few pixels.
        cfgForOut.sizePctWidth = clampInt(Math.floor(pctUsed), 1, 100)
      }
      const rect = computeOverlayRect(outW, outH, imgW, imgH, cfgForOut)
      if (!vd.VideoPreprocessors) vd.VideoPreprocessors = {}
      if (!vd.VideoPreprocessors.ImageInserter) vd.VideoPreprocessors.ImageInserter = {}
      if (!Array.isArray(vd.VideoPreprocessors.ImageInserter.InsertableImages)) {
        vd.VideoPreprocessors.ImageInserter.InsertableImages = []
      }
      vd.VideoPreprocessors.ImageInserter.InsertableImages.push({
        ImageInserterInput: imgUrl,
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
      applied = true
    }
  }

  return applied
}

async function applyLowerThirdIfConfigured(settings: any, opts: { config: any; videoDurationSeconds: number | null; dateYmd: string; productionUlid: string }) {
  const cfgObj = opts.config && typeof opts.config === 'object' ? opts.config : null
  if (!cfgObj) return
  const snapshot = (cfgObj.lowerThirdConfigSnapshot && typeof cfgObj.lowerThirdConfigSnapshot === 'object')
    ? (cfgObj.lowerThirdConfigSnapshot as LowerThirdConfigSnapshot)
    : null
  if (!snapshot) return

  const templateKey = String(snapshot.templateKey || '').trim()
  const templateVersion = snapshot.templateVersion != null ? Number(snapshot.templateVersion) : null
  const params = snapshot.params && typeof snapshot.params === 'object' ? snapshot.params : null
  if (!templateKey || !templateVersion || !params) return

  const resolved = await lowerThirdsSvc.resolveLowerThirdSvgFromSnapshot({ templateKey, templateVersion, params })
  const { png, viewBox } = rasterizeLowerThirdSvgToPng(resolved.svg, { targetWidthPx: 1920 })
  const pngKey = `lower-thirds/${ymdToFolder(opts.dateYmd)}/${opts.productionUlid}/${randomUUID()}/lower_third.png`
  const pngUrl = (await uploadPngToS3(UPLOAD_BUCKET, pngKey, png)).s3Url

  const aspect = viewBox.height / viewBox.width
  const timing = computeLowerThirdTiming(snapshot, opts.videoDurationSeconds)

  const groups: any[] = Array.isArray(settings?.OutputGroups) ? settings.OutputGroups : []
  for (const g of groups) {
    const t = g?.OutputGroupSettings?.Type
    if (t !== 'HLS_GROUP_SETTINGS' && t !== 'CMAF_GROUP_SETTINGS' && t !== 'FILE_GROUP_SETTINGS') continue
    const outs: any[] = Array.isArray(g?.Outputs) ? g.Outputs : []
    for (const o of outs) {
      const vd = o?.VideoDescription
      const cs = vd?.CodecSettings
      if (!vd || !cs) continue
      const outW = vd.Width != null ? Number(vd.Width) : null
      const outH = vd.Height != null ? Number(vd.Height) : null
      if (!outW || !outH) continue

      const renderW = outW
      const renderH = Math.max(1, Math.min(outH, Math.round(outW * aspect)))
      const x = 0
      const y = Math.max(0, outH - renderH)

      if (!vd.VideoPreprocessors) vd.VideoPreprocessors = {}
      if (!vd.VideoPreprocessors.ImageInserter) vd.VideoPreprocessors.ImageInserter = {}
      if (!Array.isArray(vd.VideoPreprocessors.ImageInserter.InsertableImages)) {
        vd.VideoPreprocessors.ImageInserter.InsertableImages = []
      }
      vd.VideoPreprocessors.ImageInserter.InsertableImages.push({
        ImageInserterInput: pngUrl,
        ImageX: x,
        ImageY: y,
        Width: renderW,
        Height: renderH,
        Opacity: 100,
        Layer: 1,
        StartTime: timing.startTime,
        Duration: timing.durationMs,
      })
    }
  }
}

async function applyMusicReplacementIfConfigured(settings: any, opts: { config: any; videoDurationSeconds: number | null; dateYmd: string; productionUlid: string }) {
  const cfgObj = opts.config && typeof opts.config === 'object' ? opts.config : null
  if (!cfgObj) return
  const musicUploadId = cfgObj.musicUploadId != null ? Number(cfgObj.musicUploadId) : null
  const audioCfg = (cfgObj.audioConfigSnapshot && typeof cfgObj.audioConfigSnapshot === 'object') ? cfgObj.audioConfigSnapshot : null
  const mode = audioCfg && typeof audioCfg.mode === 'string' ? String(audioCfg.mode).toLowerCase() : 'replace'
  const videoGainDb = audioCfg && audioCfg.videoGainDb != null ? Number(audioCfg.videoGainDb) : 0
  const musicGainDb = audioCfg && audioCfg.musicGainDb != null ? Number(audioCfg.musicGainDb) : -18
  const duckingModeRaw = audioCfg && typeof audioCfg.duckingMode === 'string'
    ? String(audioCfg.duckingMode).toLowerCase()
    : (audioCfg && (audioCfg.duckingEnabled === true || String(audioCfg.duckingEnabled || '').toLowerCase() === 'true' || String(audioCfg.duckingEnabled || '') === '1') ? 'rolling' : 'none')
  const duckingMode: 'none' | 'rolling' | 'abrupt' =
    duckingModeRaw === 'abrupt' || duckingModeRaw === 'rolling' || duckingModeRaw === 'none' ? duckingModeRaw : 'none'
  const duckingGateRaw = audioCfg && typeof audioCfg.duckingGate === 'string'
    ? String(audioCfg.duckingGate).toLowerCase()
    : 'normal'
  const duckingGate: 'sensitive' | 'normal' | 'strict' =
    duckingGateRaw === 'sensitive' || duckingGateRaw === 'strict' || duckingGateRaw === 'normal' ? duckingGateRaw : 'normal'
  const duckingEnabled = duckingMode !== 'none'
  const duckingAmountDb = audioCfg && audioCfg.duckingAmountDb != null ? Number(audioCfg.duckingAmountDb) : 12
  const durRaw = audioCfg && audioCfg.audioDurationSeconds != null ? Number(audioCfg.audioDurationSeconds) : null
  const audioDurationSeconds = durRaw != null && Number.isFinite(durRaw) ? Math.max(2, Math.min(20, Math.round(durRaw))) : null
  const audioFadeEnabled = audioCfg && audioCfg.audioFadeEnabled != null
    ? Boolean(audioCfg.audioFadeEnabled === true || String(audioCfg.audioFadeEnabled || '').toLowerCase() === 'true' || String(audioCfg.audioFadeEnabled || '') === '1')
    : true

  if (!musicUploadId) return

  // MediaConvert selects audio per-input across the timeline; it doesn't "sidechain" audio from a second input
  // into the first input's video. For replace-mode, pre-mux the music into the video input (copy video stream),
  // then run the existing single-input profile unchanged.
  if (!Array.isArray(settings?.Inputs) || !settings.Inputs[0]) return
  const videoInput = settings.Inputs[0]
  const videoUrl = String(videoInput.FileInput || '')
  const videoS3 = parseS3Url(videoUrl)
  if (!videoS3) return
  const originalLeaf = path.posix.basename(videoS3.key) || 'video.mp4'

  // Music present: load the music upload.
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

  try {
    if (mode === 'mix') {
      try {
        const out = await createMuxedMp4WithLoopedMixedAudio({
          uploadBucket: UPLOAD_BUCKET,
          dateYmd: opts.dateYmd,
          productionUlid: opts.productionUlid,
          originalLeaf,
          video: { bucket: videoS3.bucket, key: videoS3.key },
          audio: { bucket: srcBucket, key: srcKey },
          videoGainDb,
          musicGainDb,
          audioDurationSeconds,
          audioFadeEnabled,
          duckingEnabled,
          duckingMode,
          duckingGate,
          duckingAmountDb,
          videoHighpassEnabled: Boolean(MEDIA_VIDEO_HIGHPASS_ENABLED),
          videoHighpassHz: Number(MEDIA_VIDEO_HIGHPASS_HZ),
        })
        videoInput.FileInput = out.s3Url
      } catch {
        // If mixing fails (e.g. no input audio stream), fall back to replace-mode behavior.
        const out = await createMuxedMp4WithLoopedReplacementAudio({
          uploadBucket: UPLOAD_BUCKET,
          dateYmd: opts.dateYmd,
          productionUlid: opts.productionUlid,
          originalLeaf,
          video: { bucket: videoS3.bucket, key: videoS3.key },
          audio: { bucket: srcBucket, key: srcKey },
          musicGainDb,
          audioDurationSeconds,
          audioFadeEnabled,
          videoHighpassEnabled: Boolean(MEDIA_VIDEO_HIGHPASS_ENABLED),
          videoHighpassHz: Number(MEDIA_VIDEO_HIGHPASS_HZ),
        })
        videoInput.FileInput = out.s3Url
      }
    } else {
      const out = await createMuxedMp4WithLoopedReplacementAudio({
        uploadBucket: UPLOAD_BUCKET,
        dateYmd: opts.dateYmd,
        productionUlid: opts.productionUlid,
        originalLeaf,
        video: { bucket: videoS3.bucket, key: videoS3.key },
        audio: { bucket: srcBucket, key: srcKey },
        musicGainDb,
        audioDurationSeconds,
        audioFadeEnabled,
        videoHighpassEnabled: Boolean(MEDIA_VIDEO_HIGHPASS_ENABLED),
        videoHighpassHz: Number(MEDIA_VIDEO_HIGHPASS_HZ),
      })
      videoInput.FileInput = out.s3Url
    }
  } catch (e) {
    // Best-effort: if we can't mux, keep original audio/video.
  }
}
