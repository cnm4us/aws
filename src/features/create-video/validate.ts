import { DomainError, ForbiddenError, ValidationError } from '../../core/errors'
import { getPool } from '../../db'
import type { CreateVideoTimelineV1 } from './types'
import * as audioConfigsSvc from '../audio-configs/service'
import * as logoConfigsSvc from '../logo-configs/service'
import * as lowerThirdConfigsSvc from '../lower-third-configs/service'
import * as screenTitlePresetsSvc from '../screen-title-presets/service'

const MAX_CLIPS = 50
const MAX_GRAPHICS = 200
const MAX_STILLS = 200
const MAX_LOGOS = 200
const MAX_LOWER_THIRDS = 200
const MAX_SCREEN_TITLES = 200
const MAX_NARRATION = 200
const MAX_SECONDS = 20 * 60

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

function normalizeSeconds(n: any): number {
  const v = Number(n)
  if (!Number.isFinite(v)) throw new ValidationError('invalid_seconds')
  return roundToTenth(Math.max(0, v))
}

function isAllowedFreezeSeconds(v: number): boolean {
  const n = roundToTenth(Number(v))
  if (!(Number.isFinite(n) && n >= 0)) return false
  if (Math.abs(n) < 1e-9) return true
  if (n > 5 + 1e-6) return false
  // Allow 0.1..1.0 in 0.1s steps, and whole seconds 2..5.
  if (n <= 1 + 1e-6) return true
  return Math.abs(n - Math.round(n)) < 1e-6 && n >= 2 - 1e-6 && n <= 5 + 1e-6
}

function normalizeId(raw: any): string {
  const s = String(raw || '').trim()
  if (!s) throw new ValidationError('invalid_clip_id')
  if (s.length > 80) throw new ValidationError('invalid_clip_id')
  return s
}

async function loadUploadMetaForUser(uploadId: number, userId: number): Promise<{ id: number; durationSeconds: number | null }> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, user_id, kind, status, duration_seconds, source_deleted_at
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('upload_not_found', 'upload_not_found', 404)
  if (String(row.kind || 'video').toLowerCase() !== 'video') throw new DomainError('invalid_upload_kind', 'invalid_upload_kind', 400)
  if (row.source_deleted_at) throw new DomainError('source_deleted', 'source_deleted', 409)

  const status = String(row.status || '').toLowerCase()
  if (status !== 'uploaded' && status !== 'completed') throw new DomainError('invalid_upload_state', 'invalid_upload_state', 409)

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(userId)
  const isSystem = ownerId == null
  if (!isOwner && !isSystem) throw new ForbiddenError()

  const durationSeconds = row.duration_seconds != null && Number.isFinite(Number(row.duration_seconds)) ? Number(row.duration_seconds) : null
  return { id: Number(row.id), durationSeconds }
}

async function loadOverlayImageMetaForUser(uploadId: number, userId: number): Promise<{ id: number }> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, user_id, kind, image_role, status, source_deleted_at
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('upload_not_found', 'upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'image') throw new DomainError('invalid_upload_kind', 'invalid_upload_kind', 400)
  if (String(row.image_role || '').toLowerCase() !== 'overlay') throw new DomainError('invalid_upload_image_role', 'invalid_upload_image_role', 400)
  if (row.source_deleted_at) throw new DomainError('source_deleted', 'source_deleted', 409)

  const status = String(row.status || '').toLowerCase()
  if (status !== 'uploaded' && status !== 'completed') throw new DomainError('invalid_upload_state', 'invalid_upload_state', 409)

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(userId)
  const isSystem = ownerId == null
  if (!isOwner && !isSystem) throw new ForbiddenError()

  return { id: Number(row.id) }
}

async function loadScreenTitleImageMetaForUser(uploadId: number, userId: number): Promise<{ id: number }> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, user_id, kind, image_role, status, source_deleted_at
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('upload_not_found', 'upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'image') throw new DomainError('invalid_upload_kind', 'invalid_upload_kind', 400)
  if (String(row.image_role || '').toLowerCase() !== 'screen_title') throw new DomainError('invalid_upload_image_role', 'invalid_upload_image_role', 400)
  if (row.source_deleted_at) throw new DomainError('source_deleted', 'source_deleted', 409)

  const status = String(row.status || '').toLowerCase()
  if (status !== 'uploaded' && status !== 'completed') throw new DomainError('invalid_upload_state', 'invalid_upload_state', 409)

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(userId)
  const isSystem = ownerId == null
  if (!isOwner && !isSystem) throw new ForbiddenError()

  return { id: Number(row.id) }
}

async function loadLowerThirdImageMetaForUser(uploadId: number, userId: number): Promise<{ id: number }> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, user_id, kind, image_role, status, source_deleted_at
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('upload_not_found', 'upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'image') throw new DomainError('invalid_upload_kind', 'invalid_upload_kind', 400)
  if (String(row.image_role || '').toLowerCase() !== 'lower_third') throw new DomainError('invalid_upload_image_role', 'invalid_upload_image_role', 400)
  if (row.source_deleted_at) throw new DomainError('source_deleted', 'source_deleted', 409)

  const status = String(row.status || '').toLowerCase()
  if (status !== 'uploaded' && status !== 'completed') throw new DomainError('invalid_upload_state', 'invalid_upload_state', 409)

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(userId)
  const isSystem = ownerId == null
  if (!isOwner && !isSystem) throw new ForbiddenError()

  return { id: Number(row.id) }
}

async function loadFreezeFrameImageMetaForUser(uploadId: number, userId: number): Promise<{ id: number }> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, user_id, kind, image_role, status, source_deleted_at
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('upload_not_found', 'upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'image') throw new DomainError('invalid_upload_kind', 'invalid_upload_kind', 400)
  if (String(row.image_role || '').toLowerCase() !== 'freeze_frame') throw new DomainError('invalid_upload_image_role', 'invalid_upload_image_role', 400)
  if (row.source_deleted_at) throw new DomainError('source_deleted', 'source_deleted', 409)

  const status = String(row.status || '').toLowerCase()
  if (status !== 'uploaded' && status !== 'completed') throw new DomainError('invalid_upload_state', 'invalid_upload_state', 409)

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(userId)
  const isSystem = ownerId == null
  if (!isOwner && !isSystem) throw new ForbiddenError()

  return { id: Number(row.id) }
}

async function loadLogoMetaForUser(uploadId: number, userId: number): Promise<{ id: number }> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, user_id, kind, status, source_deleted_at
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('upload_not_found', 'upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'logo') throw new DomainError('invalid_upload_kind', 'invalid_upload_kind', 400)
  if (row.source_deleted_at) throw new DomainError('source_deleted', 'source_deleted', 409)

  const status = String(row.status || '').toLowerCase()
  if (status !== 'uploaded' && status !== 'completed') throw new DomainError('invalid_upload_state', 'invalid_upload_state', 409)

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(userId)
  const isSystem = ownerId == null
  if (!isOwner && !isSystem) throw new ForbiddenError()

  return { id: Number(row.id) }
}

function normalizeLogoConfigSnapshot(raw: any, configId: number) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('invalid_logo_config_snapshot')
  const id = Number((raw as any).id)
  if (!Number.isFinite(id) || id <= 0 || id !== Number(configId)) throw new ValidationError('invalid_logo_config_snapshot')
  const name = String((raw as any).name || '').trim()
  if (!name || name.length > 200) throw new ValidationError('invalid_logo_config_snapshot')
  const position = String((raw as any).position || '').trim()
  if (!position || position.length > 40) throw new ValidationError('invalid_logo_config_snapshot')
  const sizePctWidth = Number((raw as any).sizePctWidth)
  const opacityPct = Number((raw as any).opacityPct)
  if (!Number.isFinite(sizePctWidth) || sizePctWidth < 1 || sizePctWidth > 100) throw new ValidationError('invalid_logo_config_snapshot')
  if (!Number.isFinite(opacityPct) || opacityPct < 0 || opacityPct > 100) throw new ValidationError('invalid_logo_config_snapshot')
  const timingRule = String((raw as any).timingRule || '').trim()
  if (!timingRule || timingRule.length > 40) throw new ValidationError('invalid_logo_config_snapshot')
  const timingSecondsRaw = (raw as any).timingSeconds
  const timingSeconds = timingSecondsRaw == null ? null : Number(timingSecondsRaw)
  if (timingSeconds != null && (!Number.isFinite(timingSeconds) || timingSeconds < 0 || timingSeconds > 3600)) throw new ValidationError('invalid_logo_config_snapshot')
  const fade = String((raw as any).fade || '').trim()
  if (!fade || fade.length > 40) throw new ValidationError('invalid_logo_config_snapshot')
  const insetXPresetRaw = (raw as any).insetXPreset
  const insetYPresetRaw = (raw as any).insetYPreset
  const insetXPreset = insetXPresetRaw == null ? null : String(insetXPresetRaw || '').trim() || null
  const insetYPreset = insetYPresetRaw == null ? null : String(insetYPresetRaw || '').trim() || null
  if (insetXPreset != null && insetXPreset.length > 20) throw new ValidationError('invalid_logo_config_snapshot')
  if (insetYPreset != null && insetYPreset.length > 20) throw new ValidationError('invalid_logo_config_snapshot')
  return {
    id,
    name,
    position,
    sizePctWidth: Math.round(sizePctWidth),
    opacityPct: Math.round(opacityPct),
    timingRule,
    timingSeconds,
    fade,
    insetXPreset,
    insetYPreset,
  }
}

function normalizeLowerThirdConfigSnapshot(raw: any, configId: number) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('invalid_lower_third_config_snapshot')
  const id = Number((raw as any).id)
  if (!Number.isFinite(id) || id <= 0 || id !== Number(configId)) throw new ValidationError('invalid_lower_third_config_snapshot')
  const name = String((raw as any).name || '').trim()
  if (!name || name.length > 200) throw new ValidationError('invalid_lower_third_config_snapshot')
  const descriptionRaw = (raw as any).description
  const description = descriptionRaw == null ? null : String(descriptionRaw).trim() || null
  if (description != null && description.length > 2000) throw new ValidationError('invalid_lower_third_config_snapshot')

  const sizeMode = String((raw as any).sizeMode || 'pct').trim().toLowerCase()
  if (sizeMode !== 'pct' && sizeMode !== 'match_image') throw new ValidationError('invalid_lower_third_config_snapshot')
  const baselineWidthRaw = Number((raw as any).baselineWidth)
  const baselineWidth = baselineWidthRaw === 1920 ? 1920 : 1080

  const position = String((raw as any).position || '').trim()
  if (!position || position.length > 40) throw new ValidationError('invalid_lower_third_config_snapshot')
  const sizePctWidth = Number((raw as any).sizePctWidth)
  const opacityPct = Number((raw as any).opacityPct)
  if (!Number.isFinite(sizePctWidth) || sizePctWidth < 1 || sizePctWidth > 100) throw new ValidationError('invalid_lower_third_config_snapshot')
  if (!Number.isFinite(opacityPct) || opacityPct < 0 || opacityPct > 100) throw new ValidationError('invalid_lower_third_config_snapshot')
  const timingRule = String((raw as any).timingRule || '').trim().toLowerCase()
  if (!(timingRule === 'first_only' || timingRule === 'entire')) throw new ValidationError('invalid_lower_third_config_snapshot')
  const timingSecondsRaw = (raw as any).timingSeconds
  const timingSeconds = timingSecondsRaw == null ? null : Number(timingSecondsRaw)
  if (timingSeconds != null && (!Number.isFinite(timingSeconds) || timingSeconds < 0 || timingSeconds > 3600)) throw new ValidationError('invalid_lower_third_config_snapshot')
  const fade = String((raw as any).fade || '').trim()
  if (!fade || fade.length > 40) throw new ValidationError('invalid_lower_third_config_snapshot')
  const insetXPresetRaw = (raw as any).insetXPreset
  const insetYPresetRaw = (raw as any).insetYPreset
  const insetXPreset = insetXPresetRaw == null ? null : String(insetXPresetRaw || '').trim() || null
  const insetYPreset = insetYPresetRaw == null ? null : String(insetYPresetRaw || '').trim() || null
  if (insetXPreset != null && insetXPreset.length > 20) throw new ValidationError('invalid_lower_third_config_snapshot')
  if (insetYPreset != null && insetYPreset.length > 20) throw new ValidationError('invalid_lower_third_config_snapshot')
  return {
    id,
    name,
    description,
    sizeMode: sizeMode as any,
    baselineWidth: baselineWidth as any,
    position,
    sizePctWidth: Math.round(sizePctWidth),
    opacityPct: Math.round(opacityPct),
    timingRule: timingRule as any,
    timingSeconds,
    fade,
    insetXPreset,
    insetYPreset,
  }
}

async function loadSystemAudioMeta(uploadId: number): Promise<{ id: number }> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, kind, status, is_system, source_deleted_at
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('upload_not_found', 'upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'audio') throw new DomainError('invalid_upload_kind', 'invalid_upload_kind', 400)
  if (Number(row.is_system || 0) !== 1) throw new DomainError('not_system_audio', 'not_system_audio', 403)
  if (row.source_deleted_at) throw new DomainError('source_deleted', 'source_deleted', 409)

  const status = String(row.status || '').toLowerCase()
  if (status !== 'uploaded' && status !== 'completed') throw new DomainError('invalid_upload_state', 'invalid_upload_state', 409)

  return { id: Number(row.id) }
}

async function loadNarrationAudioMetaForUser(uploadId: number, userId: number): Promise<{ id: number }> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, user_id, kind, is_system, status, source_deleted_at
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('upload_not_found', 'upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'audio') throw new DomainError('invalid_upload_kind', 'invalid_upload_kind', 400)
  if (Number((row as any).is_system || 0) === 1) throw new ForbiddenError()
  if (row.source_deleted_at) throw new DomainError('source_deleted', 'source_deleted', 409)

  const status = String(row.status || '').toLowerCase()
  if (status !== 'uploaded' && status !== 'completed') throw new DomainError('invalid_upload_state', 'invalid_upload_state', 409)

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(userId)
  if (!isOwner) throw new ForbiddenError()

  return { id: Number(row.id) }
}

function normalizeScreenTitlePresetSnapshot(raw: any, presetId: number) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('invalid_screen_title_preset_snapshot')
  const id = Number((raw as any).id)
  if (!Number.isFinite(id) || id <= 0 || id !== Number(presetId)) throw new ValidationError('invalid_screen_title_preset_snapshot')
  const name = String((raw as any).name || '').trim()
  if (!name || name.length > 200) throw new ValidationError('invalid_screen_title_preset_snapshot')
  const styleRaw = String((raw as any).style || 'outline').trim().toLowerCase()
  const style = (styleRaw === 'pill' ? 'pill' : styleRaw === 'strip' ? 'strip' : 'outline') as 'pill' | 'outline' | 'strip'
  const fontKey = String((raw as any).fontKey || '').trim()
  if (!fontKey || fontKey.length > 100) throw new ValidationError('invalid_screen_title_preset_snapshot')
  const fontSizePct = Number((raw as any).fontSizePct)
  const trackingPct = Number((raw as any).trackingPct)
  if (!Number.isFinite(fontSizePct) || fontSizePct < 1 || fontSizePct > 20) throw new ValidationError('invalid_screen_title_preset_snapshot')
  if (!Number.isFinite(trackingPct) || trackingPct < -40 || trackingPct > 40) throw new ValidationError('invalid_screen_title_preset_snapshot')
  const fontColor = String((raw as any).fontColor || '').trim()
  const pillBgColor = String((raw as any).pillBgColor || '').trim()
  if (!fontColor || fontColor.length > 20) throw new ValidationError('invalid_screen_title_preset_snapshot')
  if (!pillBgColor || pillBgColor.length > 20) throw new ValidationError('invalid_screen_title_preset_snapshot')
  const pillBgOpacityPct = Number((raw as any).pillBgOpacityPct)
  if (!Number.isFinite(pillBgOpacityPct) || pillBgOpacityPct < 0 || pillBgOpacityPct > 100) throw new ValidationError('invalid_screen_title_preset_snapshot')
  const positionRaw = String((raw as any).position || 'top').trim().toLowerCase()
  const position = (positionRaw === 'bottom' ? 'bottom' : positionRaw === 'middle' ? 'middle' : 'top') as 'top' | 'middle' | 'bottom'
  const maxWidthPct = Number((raw as any).maxWidthPct)
  if (!Number.isFinite(maxWidthPct) || maxWidthPct < 10 || maxWidthPct > 100) throw new ValidationError('invalid_screen_title_preset_snapshot')
  const insetXPresetRaw = (raw as any).insetXPreset
  const insetYPresetRaw = (raw as any).insetYPreset
  const insetXPreset = insetXPresetRaw == null ? null : String(insetXPresetRaw || '').trim() || null
  const insetYPreset = insetYPresetRaw == null ? null : String(insetYPresetRaw || '').trim() || null
  const isInset = (v: any) => v === null || v === 'small' || v === 'medium' || v === 'large'
  if (!isInset(insetXPreset)) throw new ValidationError('invalid_screen_title_preset_snapshot')
  if (!isInset(insetYPreset)) throw new ValidationError('invalid_screen_title_preset_snapshot')
  const fadeRaw = String((raw as any).fade || 'none').trim().toLowerCase()
  const fade = (fadeRaw === 'in_out' ? 'in_out' : fadeRaw === 'in' ? 'in' : fadeRaw === 'out' ? 'out' : 'none') as
    | 'none'
    | 'in'
    | 'out'
    | 'in_out'

  return {
    id,
    name,
    style,
    fontKey,
    fontSizePct: roundToTenth(fontSizePct),
    trackingPct: Math.round(trackingPct),
    fontColor,
    pillBgColor,
    pillBgOpacityPct: Math.round(pillBgOpacityPct),
    position,
    maxWidthPct: Math.round(maxWidthPct),
    insetXPreset: insetXPreset as any,
    insetYPreset: insetYPreset as any,
    fade,
  }
}

export async function validateAndNormalizeCreateVideoTimeline(
  raw: any,
  ctx: { userId: number }
): Promise<CreateVideoTimelineV1> {
  if (!ctx.userId) throw new ForbiddenError()
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('invalid_timeline')

  const version = String((raw as any).version || '').trim()
  if (version !== 'create_video_v1') throw new ValidationError('invalid_timeline_version')

  const playheadSecondsRaw = (raw as any).playheadSeconds
  let playheadSeconds = playheadSecondsRaw != null ? normalizeSeconds(playheadSecondsRaw) : 0

  const clipsRaw = Array.isArray((raw as any).clips) ? ((raw as any).clips as any[]) : []
  if (clipsRaw.length > MAX_CLIPS) throw new DomainError('too_many_clips', 'too_many_clips', 400)

  // Legacy support: earlier iterations stored "freeze" durations on clips.
  // Create Video now represents freeze holds as explicit base-track still segments, so clip.freeze*
  // is deprecated. Some timelines may still include non-zero values, which effectively become
  // phantom time (breaks playback/editing and can prevent persistence due to overlap validation).
  //
  // We normalize by removing that phantom time:
  // - Set clip.freezeStartSeconds/freezeEndSeconds = 0
  // - Time-shift any segment occurring at/after the old (freeze-inflated) clip end.
  const clipsPre: Array<{
    id: string
    uploadId: number
    startSeconds: number
    sourceStartSeconds: number
    sourceEndSeconds: number
    metaId: number
    legacyFreezeSeconds: number
    legacyEndSeconds: number
  }> = []
  const legacyRemovalEvents: Array<{ t: number; delta: number }> = []
  const seen = new Set<string>()
  let sequentialCursorSeconds = 0
  let legacyVideoEndSeconds = 0

  for (const c of clipsRaw) {
    if (!c || typeof c !== 'object') continue
    const id = normalizeId((c as any).id)
    if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
    seen.add(id)

    const uploadId = Number((c as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')

    const startSecondsRaw = (c as any).startSeconds
    const startSeconds = startSecondsRaw != null ? normalizeSeconds(startSecondsRaw) : roundToTenth(Math.max(0, sequentialCursorSeconds))

    const sourceStartSeconds = normalizeSeconds((c as any).sourceStartSeconds ?? 0)
    const sourceEndSeconds = normalizeSeconds((c as any).sourceEndSeconds)
    if (!(sourceEndSeconds > sourceStartSeconds)) throw new ValidationError('invalid_source_range')

    // Legacy clip freeze: accept but treat as deprecated. Clamp to 0..5 for safety.
    const freezeStartRaw = (c as any).freezeStartSeconds
    const freezeEndRaw = (c as any).freezeEndSeconds
    const freezeStart =
      freezeStartRaw != null && Number.isFinite(Number(freezeStartRaw)) ? roundToTenth(Math.max(0, Number(freezeStartRaw))) : 0
    const freezeEnd = freezeEndRaw != null && Number.isFinite(Number(freezeEndRaw)) ? roundToTenth(Math.max(0, Number(freezeEndRaw))) : 0
    const legacyFreezeSeconds = roundToTenth(Math.min(5, freezeStart) + Math.min(5, freezeEnd))

    const meta = await loadUploadMetaForUser(uploadId, ctx.userId)
    let end = sourceEndSeconds
    if (meta.durationSeconds != null) {
      end = Math.min(end, roundToTenth(Math.max(0, meta.durationSeconds)))
      if (!(end > sourceStartSeconds)) throw new ValidationError('invalid_source_range')
    }

    const baseLen = Math.max(0, end - sourceStartSeconds)
    const legacyEndSeconds = roundToTenth(startSeconds + baseLen + legacyFreezeSeconds)
    legacyVideoEndSeconds = Math.max(legacyVideoEndSeconds, legacyEndSeconds)
    sequentialCursorSeconds = Math.max(sequentialCursorSeconds, legacyEndSeconds)
    if (legacyVideoEndSeconds > MAX_SECONDS + 1e-6) throw new DomainError('timeline_too_long', 'timeline_too_long', 413)

    if (legacyFreezeSeconds > 1e-6) legacyRemovalEvents.push({ t: legacyEndSeconds, delta: legacyFreezeSeconds })

    clipsPre.push({
      id,
      uploadId,
      startSeconds,
      sourceStartSeconds,
      sourceEndSeconds: end,
      metaId: meta.id,
      legacyFreezeSeconds,
      legacyEndSeconds,
    })
  }

  legacyRemovalEvents.sort((a, b) => Number(a.t) - Number(b.t) || Number(a.delta) - Number(b.delta))
  const legacyCumulative: Array<{ t: number; sum: number }> = []
  if (legacyRemovalEvents.length) {
    let sum = 0
    for (const e of legacyRemovalEvents) {
      sum = roundToTenth(sum + roundToTenth(Number(e.delta) || 0))
      legacyCumulative.push({ t: roundToTenth(Number(e.t) || 0), sum })
    }
  }
  const legacyShiftAt = (t: number): number => {
    const tt = roundToTenth(Math.max(0, Number(t || 0)))
    let sum = 0
    for (const e of legacyCumulative) {
      if (tt + 1e-6 >= e.t) sum = e.sum
      else break
    }
    return sum
  }
  const legacyMapTime = (t: number): number => {
    const tt = roundToTenth(Math.max(0, Number(t || 0)))
    return roundToTenth(Math.max(0, tt - legacyShiftAt(tt)))
  }
  const legacyMapMaybe = (v: any): any => {
    if (!legacyCumulative.length) return v
    const n = Number(v)
    if (!Number.isFinite(n)) return v
    return legacyMapTime(n)
  }

  if (legacyCumulative.length) {
    playheadSeconds = legacyMapTime(playheadSeconds)
  }

  const clips: CreateVideoTimelineV1['clips'] = clipsPre.map((c) => ({
    id: c.id,
    uploadId: c.metaId,
    // Apply legacy time shift to startSeconds so clips remain aligned after removing phantom freeze time.
    startSeconds: legacyCumulative.length ? legacyMapTime(c.startSeconds) : c.startSeconds,
    sourceStartSeconds: c.sourceStartSeconds,
    sourceEndSeconds: c.sourceEndSeconds,
    freezeStartSeconds: 0,
    freezeEndSeconds: 0,
  }))

  // Sort by time for deterministic playback/export and overlap validation.
  clips.sort((a: any, b: any) => Number(a.startSeconds || 0) - Number(b.startSeconds || 0) || String(a.id).localeCompare(String(b.id)))
  const baseTrackWindows: Array<{ start: number; end: number }> = []
  let videoEndSeconds = 0
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i] as any
    const start = Number(c.startSeconds || 0)
    const dur = Math.max(0, Number(c.sourceEndSeconds) - Number(c.sourceStartSeconds))
    const end = start + dur
    baseTrackWindows.push({ start: roundToTenth(start), end: roundToTenth(end) })
    videoEndSeconds = Math.max(videoEndSeconds, roundToTenth(end))
  }

  const videoTotalSeconds = roundToTenth(videoEndSeconds)

  const stillsRaw0 = Array.isArray((raw as any).stills) ? ((raw as any).stills as any[]) : []
  const stillsRaw = legacyCumulative.length
    ? stillsRaw0.map((s) => ({
        ...(s as any),
        startSeconds: legacyMapMaybe((s as any).startSeconds),
        endSeconds: legacyMapMaybe((s as any).endSeconds),
      }))
    : stillsRaw0
  if (stillsRaw.length > MAX_STILLS) throw new DomainError('too_many_stills', 'too_many_stills', 400)
  const stills: any[] = []
  for (const s of stillsRaw) {
    if (!s || typeof s !== 'object') continue
    const id = normalizeId((s as any).id)
    if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
    seen.add(id)

    const uploadId = Number((s as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')
    const startSeconds = normalizeSeconds((s as any).startSeconds)
    const endSeconds = normalizeSeconds((s as any).endSeconds)
    if (!(endSeconds > startSeconds)) throw new ValidationError('invalid_seconds')

    const meta = await loadFreezeFrameImageMetaForUser(uploadId, ctx.userId)
    const sourceClipIdRaw = (s as any).sourceClipId
    const sourceClipId = sourceClipIdRaw != null ? String(sourceClipIdRaw).trim() : undefined
    stills.push({ id, uploadId: meta.id, startSeconds, endSeconds, sourceClipId: sourceClipId || undefined })
  }

  stills.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (const st of stills) {
    baseTrackWindows.push({ start: Number(st.startSeconds), end: Number(st.endSeconds) })
    videoEndSeconds = Math.max(videoEndSeconds, roundToTenth(Number(st.endSeconds)))
  }

  baseTrackWindows.sort((a, b) => Number(a.start) - Number(b.start) || Number(a.end) - Number(b.end))
  for (let i = 1; i < baseTrackWindows.length; i++) {
    const prev = baseTrackWindows[i - 1]
    const cur = baseTrackWindows[i]
    if (cur.start < prev.end - 1e-6) throw new DomainError('base_track_overlap', 'base_track_overlap', 400)
  }

  const graphicsRaw0 = Array.isArray((raw as any).graphics) ? ((raw as any).graphics as any[]) : []
  const graphicsRaw = legacyCumulative.length
    ? graphicsRaw0.map((g) => ({
        ...(g as any),
        startSeconds: legacyMapMaybe((g as any).startSeconds),
        endSeconds: legacyMapMaybe((g as any).endSeconds),
      }))
    : graphicsRaw0
  if (graphicsRaw.length > MAX_GRAPHICS) throw new DomainError('too_many_graphics', 'too_many_graphics', 400)
  const graphics: any[] = []
  for (const g of graphicsRaw) {
    if (!g || typeof g !== 'object') continue
    const id = normalizeId((g as any).id)
    if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
    seen.add(id)

    const uploadId = Number((g as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')
    const startSeconds = normalizeSeconds((g as any).startSeconds)
    const endSeconds = normalizeSeconds((g as any).endSeconds)
    if (!(endSeconds > startSeconds)) throw new ValidationError('invalid_seconds')

    const meta = await loadOverlayImageMetaForUser(uploadId, ctx.userId)
    graphics.push({ id, uploadId: meta.id, startSeconds, endSeconds })
  }

  // Sort by time for overlap validation and deterministic export.
  graphics.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < graphics.length; i++) {
    const g = graphics[i]
    if (g.endSeconds > MAX_SECONDS + 1e-6) throw new DomainError('timeline_too_long', 'timeline_too_long', 413)
    if (i > 0) {
      const prev = graphics[i - 1]
      if (g.startSeconds < prev.endSeconds - 1e-6) throw new DomainError('graphic_overlap', 'graphic_overlap', 400)
    }
  }

  const graphicsTotalSeconds = graphics.length ? Number(graphics[graphics.length - 1].endSeconds) : 0
  const stillsTotalSeconds = stills.length ? Number(stills[stills.length - 1].endSeconds) : 0
  const logosRaw0 = Array.isArray((raw as any).logos) ? ((raw as any).logos as any[]) : []
  const logosRaw = legacyCumulative.length
    ? logosRaw0.map((l) => ({
        ...(l as any),
        startSeconds: legacyMapMaybe((l as any).startSeconds),
        endSeconds: legacyMapMaybe((l as any).endSeconds),
      }))
    : logosRaw0
  if (logosRaw.length > MAX_LOGOS) throw new DomainError('too_many_logos', 'too_many_logos', 400)
  const logos: any[] = []
  for (const l of logosRaw) {
    if (!l || typeof l !== 'object') continue
    const id = normalizeId((l as any).id)
    if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
    seen.add(id)

    const uploadId = Number((l as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')
    const configId = Number((l as any).configId)
    if (!Number.isFinite(configId) || configId <= 0) throw new ValidationError('invalid_logo_config_id')

    const startSeconds = normalizeSeconds((l as any).startSeconds)
    const endSeconds = normalizeSeconds((l as any).endSeconds)
    if (!(endSeconds > startSeconds)) throw new ValidationError('invalid_seconds')

    const meta = await loadLogoMetaForUser(uploadId, ctx.userId)
    // Validate config exists and is accessible (and not archived).
    await logoConfigsSvc.getForUser(configId, Number(ctx.userId))
    const configSnapshot = normalizeLogoConfigSnapshot((l as any).configSnapshot, configId)

    logos.push({ id, uploadId: meta.id, startSeconds, endSeconds, configId, configSnapshot })
  }

  logos.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < logos.length; i++) {
    const l = logos[i]
    if (l.endSeconds > MAX_SECONDS + 1e-6) throw new DomainError('timeline_too_long', 'timeline_too_long', 413)
    if (i > 0) {
      const prev = logos[i - 1]
      if (l.startSeconds < prev.endSeconds - 1e-6) throw new DomainError('logo_overlap', 'logo_overlap', 400)
    }
  }
  const logosTotalSeconds = logos.length ? Number(logos[logos.length - 1].endSeconds) : 0

  const lowerThirdsRaw0 = Array.isArray((raw as any).lowerThirds) ? ((raw as any).lowerThirds as any[]) : []
  const lowerThirdsRaw = legacyCumulative.length
    ? lowerThirdsRaw0.map((lt) => ({
        ...(lt as any),
        startSeconds: legacyMapMaybe((lt as any).startSeconds),
        endSeconds: legacyMapMaybe((lt as any).endSeconds),
      }))
    : lowerThirdsRaw0
  if (lowerThirdsRaw.length > MAX_LOWER_THIRDS) throw new DomainError('too_many_lower_thirds', 'too_many_lower_thirds', 400)
  const lowerThirds: any[] = []
  for (const lt of lowerThirdsRaw) {
    if (!lt || typeof lt !== 'object') continue
    const id = normalizeId((lt as any).id)
    if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
    seen.add(id)

    const uploadId = Number((lt as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')
    const configId = Number((lt as any).configId)
    if (!Number.isFinite(configId) || configId <= 0) throw new ValidationError('invalid_lower_third_config_id')

    const startSeconds = normalizeSeconds((lt as any).startSeconds)
    const endSeconds = normalizeSeconds((lt as any).endSeconds)
    if (!(endSeconds > startSeconds)) throw new ValidationError('invalid_seconds')

    const meta = await loadLowerThirdImageMetaForUser(uploadId, ctx.userId)
    await lowerThirdConfigsSvc.getActiveForUser(configId, Number(ctx.userId))
    const configSnapshot = normalizeLowerThirdConfigSnapshot((lt as any).configSnapshot, configId)

    lowerThirds.push({ id, uploadId: meta.id, startSeconds, endSeconds, configId, configSnapshot })
  }

  lowerThirds.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < lowerThirds.length; i++) {
    const lt = lowerThirds[i]
    if (lt.endSeconds > MAX_SECONDS + 1e-6) throw new DomainError('timeline_too_long', 'timeline_too_long', 413)
    if (i > 0) {
      const prev = lowerThirds[i - 1]
      if (lt.startSeconds < prev.endSeconds - 1e-6) throw new DomainError('lower_third_overlap', 'lower_third_overlap', 400)
    }
  }
  const lowerThirdsTotalSeconds = lowerThirds.length ? Number(lowerThirds[lowerThirds.length - 1].endSeconds) : 0

  const screenTitlesRaw0 = Array.isArray((raw as any).screenTitles) ? ((raw as any).screenTitles as any[]) : []
  const screenTitlesRaw = legacyCumulative.length
    ? screenTitlesRaw0.map((st) => ({
        ...(st as any),
        startSeconds: legacyMapMaybe((st as any).startSeconds),
        endSeconds: legacyMapMaybe((st as any).endSeconds),
      }))
    : screenTitlesRaw0
  if (screenTitlesRaw.length > MAX_SCREEN_TITLES) throw new DomainError('too_many_screen_titles', 'too_many_screen_titles', 400)
  const screenTitles: any[] = []
  for (const st of screenTitlesRaw) {
    if (!st || typeof st !== 'object') continue
    const id = normalizeId((st as any).id)
    if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
    seen.add(id)

    const startSeconds = normalizeSeconds((st as any).startSeconds)
    const endSeconds = normalizeSeconds((st as any).endSeconds)
    if (!(endSeconds > startSeconds)) throw new ValidationError('invalid_seconds')

    const presetIdRaw = (st as any).presetId
    const presetId = presetIdRaw == null ? null : Number(presetIdRaw)
    if (presetId != null && (!Number.isFinite(presetId) || presetId <= 0)) throw new ValidationError('invalid_screen_title_preset_id')
    const presetSnapshotRaw = (st as any).presetSnapshot
    const presetSnapshot = presetId != null ? normalizeScreenTitlePresetSnapshot(presetSnapshotRaw, presetId) : null
    if (presetId == null && presetSnapshotRaw != null) throw new ValidationError('invalid_screen_title_preset_snapshot')

    const textRaw = (st as any).text
    const text = textRaw == null ? '' : String(textRaw)
    if (text.length > 140) throw new ValidationError('invalid_screen_title_text')
    const lines = text.split(/\r?\n/)
    if (lines.length > 3) throw new ValidationError('invalid_screen_title_text')

    const renderUploadIdRaw = (st as any).renderUploadId
    const renderUploadId = renderUploadIdRaw == null ? null : Number(renderUploadIdRaw)
    let renderUploadMetaId: number | null = null
    if (renderUploadId != null) {
      if (!Number.isFinite(renderUploadId) || renderUploadId <= 0) throw new ValidationError('invalid_upload_id')
      const meta = await loadScreenTitleImageMetaForUser(renderUploadId, ctx.userId)
      renderUploadMetaId = meta.id
    }

    if (presetId != null) {
      await screenTitlePresetsSvc.getActiveForUser(presetId, Number(ctx.userId))
    }

    screenTitles.push({
      id,
      startSeconds,
      endSeconds,
      presetId,
      presetSnapshot,
      text,
      renderUploadId: renderUploadMetaId,
    })
  }

  screenTitles.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < screenTitles.length; i++) {
    const st = screenTitles[i]
    if (st.endSeconds > MAX_SECONDS + 1e-6) throw new DomainError('timeline_too_long', 'timeline_too_long', 413)
    if (i > 0) {
      const prev = screenTitles[i - 1]
      if (st.startSeconds < prev.endSeconds - 1e-6) throw new DomainError('screen_title_overlap', 'screen_title_overlap', 400)
    }
  }
  const screenTitlesTotalSeconds = screenTitles.length ? Number(screenTitles[screenTitles.length - 1].endSeconds) : 0

  const narrationRaw0 = Array.isArray((raw as any).narration) ? ((raw as any).narration as any[]) : []
  const narrationRaw = legacyCumulative.length
    ? narrationRaw0.map((seg) => ({
        ...(seg as any),
        startSeconds: legacyMapMaybe((seg as any).startSeconds),
        endSeconds: legacyMapMaybe((seg as any).endSeconds),
      }))
    : narrationRaw0
  if (narrationRaw.length > MAX_NARRATION) throw new DomainError('too_many_narration', 'too_many_narration', 400)
  const narration: any[] = []
  for (const seg of narrationRaw) {
    if (!seg || typeof seg !== 'object') continue
    const id = normalizeId((seg as any).id)
    if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
    seen.add(id)

    const uploadId = Number((seg as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')
    const startSeconds = normalizeSeconds((seg as any).startSeconds)
    const endSeconds = normalizeSeconds((seg as any).endSeconds)
    if (!(endSeconds > startSeconds)) throw new ValidationError('invalid_seconds')
    const sourceStartRaw = (seg as any).sourceStartSeconds
    const sourceStartSeconds = sourceStartRaw == null ? 0 : normalizeSeconds(sourceStartRaw)
    const gainRaw = (seg as any).gainDb
    const gainDb = gainRaw == null ? 0 : Number(gainRaw)
    if (!Number.isFinite(gainDb) || gainDb < -12 || gainDb > 12) throw new ValidationError('invalid_narration_gain')

    const meta = await loadNarrationAudioMetaForUser(uploadId, ctx.userId)
    narration.push({ id, uploadId: meta.id, startSeconds, endSeconds, sourceStartSeconds, gainDb })
  }
  narration.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < narration.length; i++) {
    const n = narration[i]
    if (n.endSeconds > MAX_SECONDS + 1e-6) throw new DomainError('timeline_too_long', 'timeline_too_long', 413)
    if (i > 0) {
      const prev = narration[i - 1]
      if (n.startSeconds < prev.endSeconds - 1e-6) throw new DomainError('narration_overlap', 'narration_overlap', 400)
    }
  }
  const narrationTotalSeconds = narration.length ? Number(narration[narration.length - 1].endSeconds) : 0

  const totalForPlayhead = roundToTenth(
    Math.max(
      videoTotalSeconds,
      graphicsTotalSeconds,
      stillsTotalSeconds,
      logosTotalSeconds,
      lowerThirdsTotalSeconds,
      screenTitlesTotalSeconds,
      narrationTotalSeconds
    )
  )
  const safePlayheadSeconds = totalForPlayhead > 0 ? Math.min(playheadSeconds, roundToTenth(totalForPlayhead)) : 0

  if (totalForPlayhead > MAX_SECONDS) throw new DomainError('timeline_too_long', 'timeline_too_long', 413)

  const MAX_AUDIO_SEGMENTS = 200
  const audioSegments: any[] = []
  const audioSegmentsRaw = (raw as any).audioSegments
  if (audioSegmentsRaw != null) {
    if (audioSegmentsRaw === null) {
      // ok
    } else if (!Array.isArray(audioSegmentsRaw)) {
      throw new ValidationError('invalid_audio_segments')
    } else {
      if (audioSegmentsRaw.length > MAX_AUDIO_SEGMENTS) throw new DomainError('too_many_audio_segments', 'too_many_audio_segments', 400)
      if (!(totalForPlayhead > 0)) throw new DomainError('empty_timeline', 'empty_timeline', 400)

      let commonUploadId: number | null = null
      let commonAudioConfigId: number | null = null
      for (let i = 0; i < audioSegmentsRaw.length; i++) {
        const seg = audioSegmentsRaw[i]
        if (!seg || typeof seg !== 'object') continue
        const id = normalizeId((seg as any).id || `aud_${i + 1}`)
        if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
        seen.add(id)

        const uploadId = Number((seg as any).uploadId)
        const audioConfigId = Number((seg as any).audioConfigId)
        if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')
        if (!Number.isFinite(audioConfigId) || audioConfigId <= 0) throw new ValidationError('invalid_audio_config_id')

        if (commonUploadId == null) commonUploadId = uploadId
        if (commonAudioConfigId == null) commonAudioConfigId = audioConfigId
        if (commonUploadId != null && uploadId !== commonUploadId) throw new DomainError('multiple_audio_tracks_not_supported', 'multiple_audio_tracks_not_supported', 400)
        if (commonAudioConfigId != null && audioConfigId !== commonAudioConfigId) throw new DomainError('multiple_audio_configs_not_supported', 'multiple_audio_configs_not_supported', 400)

        const meta = await loadSystemAudioMeta(uploadId)
        // Validate audio config exists and is not archived.
        await audioConfigsSvc.getActiveForUser(audioConfigId, Number(ctx.userId))

        const startSeconds = normalizeSeconds((seg as any).startSeconds ?? 0)
        const endSecondsRaw = (seg as any).endSeconds
        const endSecondsInput = endSecondsRaw == null ? totalForPlayhead : normalizeSeconds(endSecondsRaw)
        const start = Math.min(startSeconds, roundToTenth(totalForPlayhead))
        const end = Math.min(endSecondsInput, roundToTenth(totalForPlayhead))
        if (!(end > start)) throw new ValidationError('invalid_seconds')
        const sourceStartRaw = (seg as any).sourceStartSeconds
        const sourceStartSeconds = sourceStartRaw == null ? 0 : normalizeSeconds(sourceStartRaw)
        audioSegments.push({ id, uploadId: meta.id, audioConfigId, startSeconds: start, endSeconds: end, sourceStartSeconds })
      }
    }
  }

  // Back-compat: audioTrack -> audioSegments (single segment).
  if (!audioSegments.length) {
    const audioTrackRaw0 = (raw as any).audioTrack
    const audioTrackRaw =
      audioTrackRaw0 && typeof audioTrackRaw0 === 'object' && !Array.isArray(audioTrackRaw0) && legacyCumulative.length
        ? {
            ...(audioTrackRaw0 as any),
            startSeconds: legacyMapMaybe((audioTrackRaw0 as any).startSeconds),
            endSeconds: legacyMapMaybe((audioTrackRaw0 as any).endSeconds),
          }
        : audioTrackRaw0
    if (audioTrackRaw != null && audioTrackRaw !== null) {
      if (typeof audioTrackRaw !== 'object' || Array.isArray(audioTrackRaw)) throw new ValidationError('invalid_audio_track')
      if (!(totalForPlayhead > 0)) throw new DomainError('empty_timeline', 'empty_timeline', 400)
      const uploadId = Number((audioTrackRaw as any).uploadId)
      const audioConfigId = Number((audioTrackRaw as any).audioConfigId)
      if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')
      if (!Number.isFinite(audioConfigId) || audioConfigId <= 0) throw new ValidationError('invalid_audio_config_id')
      const meta = await loadSystemAudioMeta(uploadId)
      await audioConfigsSvc.getActiveForUser(audioConfigId, Number(ctx.userId))

      const startSeconds = normalizeSeconds((audioTrackRaw as any).startSeconds ?? 0)
      const endSecondsRaw = (audioTrackRaw as any).endSeconds
      const endSecondsInput = endSecondsRaw == null ? totalForPlayhead : normalizeSeconds(endSecondsRaw)
      const start = Math.min(startSeconds, roundToTenth(totalForPlayhead))
      const end = Math.min(endSecondsInput, roundToTenth(totalForPlayhead))
      if (end > start) audioSegments.push({ id: 'audio_track_legacy', uploadId: meta.id, audioConfigId, startSeconds: start, endSeconds: end, sourceStartSeconds: 0 })
    }
  }

  audioSegments.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < audioSegments.length; i++) {
    const seg = audioSegments[i]
    if (i > 0) {
      const prev = audioSegments[i - 1]
      if (seg.startSeconds < prev.endSeconds - 1e-6) throw new DomainError('audio_overlap', 'audio_overlap', 400)
    }
  }

  return {
    version: 'create_video_v1',
    playheadSeconds: safePlayheadSeconds,
    clips,
    stills,
    graphics,
    logos,
    lowerThirds,
    screenTitles,
    narration,
    audioSegments,
    audioTrack: null,
  }
}
