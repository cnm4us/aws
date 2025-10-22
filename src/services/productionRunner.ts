import { CreateJobCommand } from '@aws-sdk/client-mediaconvert'
import { getMediaConvertClient } from '../aws/mediaconvert'
import { getPool } from '../db'
import { applyAudioNormalization, applyHqTuning, getFirstHlsDestinationPrefix, loadProfileJson, transformSettings } from '../jobs'
import { ACCELERATION_MODE, AWS_REGION, MC_PRIORITY, MC_QUEUE_ARN, MC_ROLE_ARN, OUTPUT_BUCKET, OUTPUT_PREFIX } from '../config'
import { writeRequestLog } from '../utils/requestLog'
import { ulid as genUlid } from '../utils/ulid'

export type RenderOptions = {
  upload: any
  userId: number
  profile?: string | null
  quality?: string | null
  sound?: string | null
  config?: any
}

export async function startProductionRender(options: RenderOptions) {
  const { upload, userId, profile, quality, sound, config } = options
  if (!MC_ROLE_ARN) throw new Error('MC_ROLE_ARN not configured')
  const db = getPool()

  const inputUrl = `s3://${upload.s3_bucket}/${upload.s3_key}`
  let chosenProfile = profile || (
    upload.width && upload.height ? (upload.height > upload.width ? 'portrait-hls' : 'landscape-both-hls') : 'simple-hls'
  )
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
    `INSERT INTO productions (upload_id, user_id, status, config, ulid)
     VALUES (?, ?, 'queued', ?, ?)`,
    [upload.id, userId, JSON.stringify(configPayload), prodUlid]
  )
  const productionId = Number((preIns as any).insertId)

  const settings = transformSettings(raw, {
    inputUrl,
    outputBucket: OUTPUT_BUCKET,
    assetId: assetUuid,
    dateYMD: createdDate,
    productionUlid: prodUlid,
  })
  if (isHq) applyHqTuning(settings)
  if (typeof sound === 'string' && sound.toLowerCase().startsWith('norm')) {
    applyAudioNormalization(settings, { targetLkfs: -16, aacBitrate: 160000 })
  }

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
      if (t === 'HLS_GROUP_SETTINGS' || t === 'FILE_GROUP_SETTINGS') {
        if (!Array.isArray(g.Outputs)) g.Outputs = []
        for (const o of g.Outputs) {
          if (!o.ContainerSettings) {
            if (t === 'FILE_GROUP_SETTINGS') o.ContainerSettings = { Container: 'RAW' }
            if (t === 'HLS_GROUP_SETTINGS') o.ContainerSettings = { Container: 'M3U8' } as any
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
  const outPrefix = getFirstHlsDestinationPrefix(settings, OUTPUT_BUCKET) || `${OUTPUT_PREFIX}${upload.id}/`

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
