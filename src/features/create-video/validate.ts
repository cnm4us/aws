import { DomainError, ForbiddenError, ValidationError } from '../../core/errors'
import { getPool } from '../../db'
import type { CreateVideoTimelineV1 } from './types'
import * as audioConfigsSvc from '../audio-configs/service'
import * as lowerThirdConfigsSvc from '../lower-third-configs/service'
import * as screenTitlePresetsSvc from '../screen-title-presets/service'

const MAX_CLIPS = 50
const MAX_GRAPHICS = 200
const MAX_STILLS = 200
const MAX_LOGOS = 200
const MAX_LOWER_THIRDS = 200
const MAX_SCREEN_TITLES = 200
const MAX_NARRATION = 200
const MAX_VIDEO_OVERLAYS = 200
const MAX_SECONDS = 20 * 60

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function normalizeSeconds(n: any): number {
  const v = Number(n)
  if (!Number.isFinite(v)) throw new ValidationError('invalid_seconds')
  return roundToTenth(Math.max(0, v))
}

function normalizeHexColor(raw: any, fallback: string): string {
  const s = String(raw == null ? fallback : raw).trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(s)) return fallback
  return s.startsWith('#') ? s : `#${s}`
}

function clampTimelineRange(
  startSeconds: number,
  endSeconds: number
): { startSeconds: number; endSeconds: number } | null {
  const start = roundToTenth(Math.max(0, Number(startSeconds)))
  if (!Number.isFinite(start) || start >= MAX_SECONDS - 1e-6) return null
  const end = roundToTenth(Math.min(MAX_SECONDS, Number(endSeconds)))
  if (!Number.isFinite(end) || end <= start + 1e-6) return null
  return { startSeconds: start, endSeconds: end }
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

async function loadUploadMetaForUser(
  uploadId: number,
  userId: number,
  opts?: { requireVideoRole?: 'source' | 'export' }
): Promise<{ id: number; durationSeconds: number | null }> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, user_id, kind, status, duration_seconds, source_deleted_at, video_role, s3_key
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

  if (opts?.requireVideoRole) {
    const roleRaw = row.video_role != null ? String(row.video_role).trim().toLowerCase() : ''
    const keyRaw = row.s3_key != null ? String(row.s3_key) : ''
    const inferred =
      roleRaw === 'source' || roleRaw === 'export'
        ? roleRaw
        : /(^|\/)renders\//.test(keyRaw)
          ? 'export'
          : 'source'
    if (inferred !== opts.requireVideoRole) throw new DomainError('invalid_video_role', 'invalid_video_role', 400)
  }

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

async function loadImageMetaForUser(uploadId: number, userId: number): Promise<{ id: number }> {
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
  if (String(row.kind || '').toLowerCase() !== 'image') throw new DomainError('invalid_upload_kind', 'invalid_upload_kind', 400)
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

async function loadBackgroundMusicAudioMetaForUser(uploadId: number, userId: number): Promise<{ id: number }> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, user_id, kind, status, is_system, s3_key, source_deleted_at
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('upload_not_found', 'upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'audio') throw new DomainError('invalid_upload_kind', 'invalid_upload_kind', 400)
  if (row.source_deleted_at) throw new DomainError('source_deleted', 'source_deleted', 409)

  const status = String(row.status || '').toLowerCase()
  if (status !== 'uploaded' && status !== 'completed') throw new DomainError('invalid_upload_state', 'invalid_upload_state', 409)

  const isSystem = Number(row.is_system || 0) === 1
  const key = String(row.s3_key || '')
  // Match both unprefixed keys like "audio/music/..." and prefixed keys like "foo/audio/music/..."
  // without relying on a leading slash.
  const isMusicKey = key.includes('audio/music/')
  const isNarrationKey = key.includes('audio/narration/')
  // Allow:
  // - user-uploaded background music under audio/music/
  // - system background music (legacy keys) under audio/*, but never narration
  if (!isMusicKey) {
    if (!(isSystem && key.includes('audio/') && !isNarrationKey)) {
      throw new DomainError('invalid_audio_role', 'invalid_audio_role', 403)
    }
  }

  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId != null && ownerId === Number(userId)
  if (!isSystem && !isOwner) throw new ForbiddenError()

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
  const styleRaw = String((raw as any).style || 'none').trim().toLowerCase()
  const style = (styleRaw === 'pill' ? 'pill' : styleRaw === 'strip' ? 'strip' : 'none') as 'none' | 'pill' | 'strip'
  const fontKey = String((raw as any).fontKey || '').trim()
  if (!fontKey || fontKey.length > 100) throw new ValidationError('invalid_screen_title_preset_snapshot')
  const fontSizePct = Number((raw as any).fontSizePct)
  const trackingPct = Number((raw as any).trackingPct)
  if (!Number.isFinite(fontSizePct) || fontSizePct < 1 || fontSizePct > 20) throw new ValidationError('invalid_screen_title_preset_snapshot')
  if (!Number.isFinite(trackingPct) || trackingPct < -40 || trackingPct > 40) throw new ValidationError('invalid_screen_title_preset_snapshot')
  const lineSpacingPctRaw = (raw as any).lineSpacingPct
  const lineSpacingPct = lineSpacingPctRaw == null ? 0 : Number(lineSpacingPctRaw)
	  const fontColor = String((raw as any).fontColor || '').trim()
	  const shadowColorRaw = (raw as any).shadowColor
	  const shadowColor = String(shadowColorRaw || '#000000').trim()
	  const shadowOffsetPxRaw = (raw as any).shadowOffsetPx
	  const shadowOffsetPx = shadowOffsetPxRaw == null ? 2 : Number(shadowOffsetPxRaw)
	  const shadowBlurPxRaw = (raw as any).shadowBlurPx
	  const shadowBlurPx = shadowBlurPxRaw == null ? 0 : Number(shadowBlurPxRaw)
	  const shadowOpacityPctRaw = (raw as any).shadowOpacityPct
	  const shadowOpacityPct = shadowOpacityPctRaw == null ? 65 : Number(shadowOpacityPctRaw)
	  const fontGradientKeyRaw = (raw as any).fontGradientKey
	  const fontGradientKey = fontGradientKeyRaw == null ? null : String(fontGradientKeyRaw || '').trim() || null
	  const outlineWidthPctRaw = (raw as any).outlineWidthPct
	  const outlineWidthPct = outlineWidthPctRaw == null ? null : Number(outlineWidthPctRaw)
	  const outlineOpacityPctRaw = (raw as any).outlineOpacityPct
	  const outlineOpacityPct = outlineOpacityPctRaw == null ? null : Number(outlineOpacityPctRaw)
	  const outlineColorRaw = (raw as any).outlineColor
	  const outlineColorStr = outlineColorRaw == null ? null : String(outlineColorRaw || '').trim() || null
	  const outlineColor = outlineColorStr == null || outlineColorStr.toLowerCase() === 'auto' ? null : outlineColorStr
	  const marginLeftPctRaw = (raw as any).marginLeftPct
	  const marginLeftPct = marginLeftPctRaw == null ? null : Number(marginLeftPctRaw)
	  const marginRightPctRaw = (raw as any).marginRightPct
	  const marginRightPct = marginRightPctRaw == null ? null : Number(marginRightPctRaw)
	  const marginTopPctRaw = (raw as any).marginTopPct
	  const marginTopPct = marginTopPctRaw == null ? null : Number(marginTopPctRaw)
	  const marginBottomPctRaw = (raw as any).marginBottomPct
	  const marginBottomPct = marginBottomPctRaw == null ? null : Number(marginBottomPctRaw)
	  const pillBgColor = String((raw as any).pillBgColor || '').trim()
	  if (!fontColor || fontColor.length > 20) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (!shadowColor || shadowColor.length > 20 || !/^#([0-9a-fA-F]{6})$/.test(shadowColor)) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (!Number.isFinite(shadowOffsetPx) || shadowOffsetPx < -50 || shadowOffsetPx > 50) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (!Number.isFinite(shadowBlurPx) || shadowBlurPx < 0 || shadowBlurPx > 20) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (!Number.isFinite(shadowOpacityPct) || shadowOpacityPct < 0 || shadowOpacityPct > 100) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (!Number.isFinite(lineSpacingPct) || lineSpacingPct < -20 || lineSpacingPct > 200) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (fontGradientKey != null && fontGradientKey.length > 200) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (outlineWidthPct != null && (!Number.isFinite(outlineWidthPct) || outlineWidthPct < 0 || outlineWidthPct > 100)) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (outlineOpacityPct != null && (!Number.isFinite(outlineOpacityPct) || outlineOpacityPct < 0 || outlineOpacityPct > 100)) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (outlineColor != null && !/^#([0-9a-fA-F]{6})$/.test(outlineColor)) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (marginLeftPct != null && (!Number.isFinite(marginLeftPct) || marginLeftPct < 0 || marginLeftPct > 40)) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (marginRightPct != null && (!Number.isFinite(marginRightPct) || marginRightPct < 0 || marginRightPct > 40)) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (marginTopPct != null && (!Number.isFinite(marginTopPct) || marginTopPct < 0 || marginTopPct > 40)) throw new ValidationError('invalid_screen_title_preset_snapshot')
	  if (marginBottomPct != null && (!Number.isFinite(marginBottomPct) || marginBottomPct < 0 || marginBottomPct > 40)) throw new ValidationError('invalid_screen_title_preset_snapshot')
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
  const alignmentRaw = String((raw as any).alignment || 'center').trim().toLowerCase()
  const alignment = (alignmentRaw === 'left' ? 'left' : alignmentRaw === 'right' ? 'right' : 'center') as 'left' | 'center' | 'right'

  // Legacy: some stored snapshots may use style='outline' without explicit outline fields.
  // Treat it as background none + classic outline.
  const legacyStyleRaw = String((raw as any).style || '').trim().toLowerCase()
  const legacyNeedsOutline = legacyStyleRaw === 'outline' && outlineWidthPct == null && outlineOpacityPct == null && outlineColor == null

  return {
    id,
    name,
    style,
    fontKey,
    fontSizePct: roundToTenth(fontSizePct),
	    trackingPct: Math.round(trackingPct),
	    lineSpacingPct: Math.round(lineSpacingPct),
	    fontColor,
	    shadowColor: shadowColor.toLowerCase(),
	    shadowOffsetPx: Math.round(shadowOffsetPx),
	    shadowBlurPx: Math.round(shadowBlurPx),
	    shadowOpacityPct: Math.round(shadowOpacityPct),
	    fontGradientKey,
	    outlineWidthPct: legacyNeedsOutline ? 1.2 : (outlineWidthPct == null ? null : Math.round(outlineWidthPct * 100) / 100),
	    outlineOpacityPct: legacyNeedsOutline ? 45 : (outlineOpacityPct == null ? null : Math.round(outlineOpacityPct)),
	    outlineColor,
	    marginLeftPct: marginLeftPct == null ? null : Math.round(marginLeftPct * 100) / 100,
	    marginRightPct: marginRightPct == null ? null : Math.round(marginRightPct * 100) / 100,
	    marginTopPct: marginTopPct == null ? null : Math.round(marginTopPct * 100) / 100,
	    marginBottomPct: marginBottomPct == null ? null : Math.round(marginBottomPct * 100) / 100,
	    pillBgColor,
	    pillBgOpacityPct: Math.round(pillBgOpacityPct),
	    alignment,
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
  const timelineBackgroundModeRaw = String((raw as any).timelineBackgroundMode || 'none').trim().toLowerCase()
  let timelineBackgroundMode: 'none' | 'color' | 'image' =
    timelineBackgroundModeRaw === 'color' ? 'color' : timelineBackgroundModeRaw === 'image' ? 'image' : 'none'
  const timelineBackgroundColor = normalizeHexColor((raw as any).timelineBackgroundColor, '#000000')
  let timelineBackgroundUploadId: number | null = null
  if (timelineBackgroundMode === 'image') {
    const uploadId = Number((raw as any).timelineBackgroundUploadId)
    if (Number.isFinite(uploadId) && uploadId > 0) {
      const meta = await loadImageMetaForUser(uploadId, ctx.userId)
      timelineBackgroundUploadId = meta.id
    } else {
      timelineBackgroundMode = 'none'
    }
  }

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
    audioEnabled: boolean
    boostDb: number
    bgFillStyle: 'none' | 'blur' | 'color' | 'image'
    bgFillBrightness: 'light3' | 'light2' | 'light1' | 'neutral' | 'dim1' | 'dim2' | 'dim3'
    bgFillBlur: 'soft' | 'medium' | 'strong' | 'very_strong'
    bgFillColor: string
    bgFillImageUploadId: number | null
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

    const audioEnabledRaw = (c as any).audioEnabled
    const audioEnabled = audioEnabledRaw == null ? true : Boolean(audioEnabledRaw)
    const boostRaw = (c as any).boostDb
    const boostDb = boostRaw == null ? 0 : Number(boostRaw)
    const boostAllowed = new Set([0, 3, 6, 9])
    if (!Number.isFinite(boostDb) || !boostAllowed.has(Math.round(boostDb))) throw new ValidationError('invalid_boost_db')

    const bgFillStyleRaw = String((c as any).bgFillStyle || 'none').trim().toLowerCase()
    let bgFillStyle: 'none' | 'blur' | 'color' | 'image' =
      bgFillStyleRaw === 'blur' ? 'blur' : bgFillStyleRaw === 'color' ? 'color' : bgFillStyleRaw === 'image' ? 'image' : 'none'
    const bgFillColor = normalizeHexColor((c as any).bgFillColor, '#000000')
    let bgFillImageUploadId: number | null = null
    if (bgFillStyle === 'image') {
      const uploadId = Number((c as any).bgFillImageUploadId)
      if (Number.isFinite(uploadId) && uploadId > 0) {
        const meta = await loadImageMetaForUser(Math.round(uploadId), ctx.userId)
        bgFillImageUploadId = meta.id
      } else {
        bgFillStyle = 'none'
      }
    }
    const bgFillBrightnessRaw = String((c as any).bgFillBrightness || '').trim().toLowerCase()
    const bgFillBrightness = bgFillBrightnessRaw === 'light3'
      ? 'light3'
      : bgFillBrightnessRaw === 'light2'
        ? 'light2'
        : bgFillBrightnessRaw === 'light1'
          ? 'light1'
          : bgFillBrightnessRaw === 'dim1'
            ? 'dim1'
            : bgFillBrightnessRaw === 'dim3'
              ? 'dim3'
              : bgFillBrightnessRaw === 'dim2'
                ? 'dim2'
                : bgFillBrightnessRaw === 'neutral'
                  ? 'neutral'
                  : ''
    const bgFillDimRaw = String((c as any).bgFillDim || '').trim().toLowerCase()
    const legacyBrightness = bgFillDimRaw === 'light'
      ? 'light1'
      : bgFillDimRaw === 'strong'
        ? 'dim3'
        : bgFillDimRaw === 'medium'
          ? 'dim2'
          : 'neutral'
    const resolvedBgFillBrightness = bgFillBrightness || legacyBrightness
    const bgFillBlurRaw = String((c as any).bgFillBlur || 'medium').trim().toLowerCase()
    const bgFillBlur = bgFillBlurRaw === 'soft'
      ? 'soft'
      : bgFillBlurRaw === 'strong'
        ? 'strong'
        : bgFillBlurRaw === 'very_strong'
          ? 'very_strong'
          : 'medium'

    // Legacy clip freeze: accept but treat as deprecated. Clamp to 0..5 for safety.
    const freezeStartRaw = (c as any).freezeStartSeconds
    const freezeEndRaw = (c as any).freezeEndSeconds
    const freezeStart =
      freezeStartRaw != null && Number.isFinite(Number(freezeStartRaw)) ? roundToTenth(Math.max(0, Number(freezeStartRaw))) : 0
    const freezeEnd = freezeEndRaw != null && Number.isFinite(Number(freezeEndRaw)) ? roundToTenth(Math.max(0, Number(freezeEndRaw))) : 0
    const legacyFreezeSeconds = roundToTenth(Math.min(5, freezeStart) + Math.min(5, freezeEnd))

    if (startSeconds >= MAX_SECONDS - 1e-6) continue

    const meta = await loadUploadMetaForUser(uploadId, ctx.userId)
    let end = sourceEndSeconds
    if (meta.durationSeconds != null) {
      end = Math.min(end, roundToTenth(Math.max(0, meta.durationSeconds)))
      if (!(end > sourceStartSeconds)) throw new ValidationError('invalid_source_range')
    }

    const baseLen = Math.max(0, end - sourceStartSeconds)
    const availableSeconds = Math.max(0, roundToTenth(MAX_SECONDS - startSeconds))
    const clampedBaseLen = Math.min(baseLen, availableSeconds)
    if (clampedBaseLen <= 1e-6) continue

    end = roundToTenth(sourceStartSeconds + clampedBaseLen)
    const legacyEndSeconds = roundToTenth(startSeconds + clampedBaseLen + legacyFreezeSeconds)
    legacyVideoEndSeconds = Math.max(legacyVideoEndSeconds, legacyEndSeconds)
    sequentialCursorSeconds = Math.max(sequentialCursorSeconds, legacyEndSeconds)

    if (legacyFreezeSeconds > 1e-6) legacyRemovalEvents.push({ t: legacyEndSeconds, delta: legacyFreezeSeconds })

    clipsPre.push({
      id,
      uploadId,
      startSeconds,
      sourceStartSeconds,
      sourceEndSeconds: end,
      audioEnabled,
      boostDb: Math.round(boostDb),
      bgFillStyle,
      bgFillBrightness: resolvedBgFillBrightness,
      bgFillBlur,
      bgFillColor,
      bgFillImageUploadId,
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
    audioEnabled: c.audioEnabled,
    boostDb: c.boostDb,
    bgFillStyle: c.bgFillStyle,
    bgFillBrightness: c.bgFillBrightness,
    bgFillBlur: c.bgFillBlur,
    bgFillColor: c.bgFillColor,
    bgFillImageUploadId: c.bgFillImageUploadId,
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
    const clamped = clampTimelineRange(startSeconds, endSeconds)
    if (!clamped) continue

    const meta = await loadFreezeFrameImageMetaForUser(uploadId, ctx.userId)
    const sourceClipIdRaw = (s as any).sourceClipId
    const sourceClipId = sourceClipIdRaw != null ? String(sourceClipIdRaw).trim() : undefined
    stills.push({
      id,
      uploadId: meta.id,
      startSeconds: clamped.startSeconds,
      endSeconds: clamped.endSeconds,
      sourceClipId: sourceClipId || undefined,
    })
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
  const allowedGraphicPositions = new Set([
    'top_left',
    'top_center',
    'top_right',
    'middle_left',
    'middle_center',
    'middle_right',
    'bottom_left',
    'bottom_center',
    'bottom_right',
  ])
  const allowedGraphicAnimations = new Set(['none', 'slide_in', 'slide_out', 'slide_in_out', 'doc_reveal'])
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
    const clamped = clampTimelineRange(startSeconds, endSeconds)
    if (!clamped) continue
    const segMs = Math.max(0, Math.round((endSeconds - startSeconds) * 1000))
    const animateRaw = String((g as any).animate || 'none').trim().toLowerCase()
    const animate = allowedGraphicAnimations.has(animateRaw) ? animateRaw : 'none'
    const animateDurationRaw = Number((g as any).animateDurationMs)
    let animateDurationMs = Number.isFinite(animateDurationRaw) ? Math.round(animateDurationRaw) : 600
    animateDurationMs = Math.round(clamp(animateDurationMs, 100, 2000))
    const maxAnimMs = segMs > 0 ? Math.round(segMs * 0.45) : 0
    if (maxAnimMs > 0) animateDurationMs = Math.min(animateDurationMs, maxAnimMs)
    const wantsAnimation = animate !== 'none'

    const meta = await loadOverlayImageMetaForUser(uploadId, ctx.userId)

    // New placement fields (optional). For backward compatibility, legacy graphics that do not
    // include any placement fields continue to render full-frame (cover) as before.
    const hasPlacementFields =
      (g as any).fitMode != null ||
      (g as any).sizePctWidth != null ||
      (g as any).position != null ||
      (g as any).insetXPx != null ||
      (g as any).insetYPx != null
    const hasEffectsFields =
      (g as any).borderWidthPx != null ||
      (g as any).borderColor != null ||
      (g as any).fade != null ||
      (g as any).fadeDurationMs != null
    const hasAnimationFields = wantsAnimation || (g as any).animateDurationMs != null

    const borderWidthRaw = Number((g as any).borderWidthPx)
    const borderWidthAllowed = new Set([0, 2, 4, 6])
    const borderWidthPx = borderWidthAllowed.has(borderWidthRaw) ? borderWidthRaw : 0
    const borderColorRaw = String((g as any).borderColor || '#000000').trim()
    const borderColor = /^#?[0-9a-fA-F]{6}$/.test(borderColorRaw) ? (borderColorRaw.startsWith('#') ? borderColorRaw : `#${borderColorRaw}`) : '#000000'
    const fadeRaw = String((g as any).fade || 'none').trim().toLowerCase()
    const fadeAllowed = new Set(['none', 'in', 'out', 'in_out'])
    const fade = fadeAllowed.has(fadeRaw) ? fadeRaw : 'none'
    const fadeDurationRaw = Number((g as any).fadeDurationMs)
    let fadeDurationMs = Number.isFinite(fadeDurationRaw) ? Math.round(fadeDurationRaw) : 600
    fadeDurationMs = Math.round(clamp(fadeDurationMs, 100, 2000))
    const maxFadeMs = segMs > 0 ? Math.round(segMs * 0.45) : 0
    if (maxFadeMs > 0) fadeDurationMs = Math.min(fadeDurationMs, maxFadeMs)

    if (!hasPlacementFields && !hasEffectsFields && !hasAnimationFields) {
      graphics.push({ id, uploadId: meta.id, startSeconds: clamped.startSeconds, endSeconds: clamped.endSeconds })
      continue
    }

    // Effects-only (no placement) keeps legacy full-frame rendering, but persists effect fields.
    if (!hasPlacementFields && hasEffectsFields && !hasAnimationFields) {
      graphics.push({
        id,
        uploadId: meta.id,
        startSeconds: clamped.startSeconds,
        endSeconds: clamped.endSeconds,
        borderWidthPx,
        borderColor,
        fade,
        fadeDurationMs,
      })
      continue
    }

    const fitModeRaw = String((g as any).fitMode || 'contain_transparent').trim().toLowerCase()
    const fitMode = wantsAnimation ? 'contain_transparent' : (fitModeRaw === 'cover_full' ? 'cover_full' : 'contain_transparent')

    const sizePctWidthRaw = Number((g as any).sizePctWidth)
    const sizePctWidthNum = Number.isFinite(sizePctWidthRaw) ? sizePctWidthRaw : (fitMode === 'cover_full' ? 100 : 70)
    let sizePctWidth = Math.round(clamp(sizePctWidthNum, 10, 100))

    const positionRaw = String((g as any).position || 'middle_center').trim().toLowerCase()
    let position = allowedGraphicPositions.has(positionRaw) ? positionRaw : 'middle_center'
    if (wantsAnimation) {
      if (position.includes('top')) position = 'top_center'
      else if (position.includes('bottom')) position = 'bottom_center'
      else position = 'middle_center'
    }

    const insetXPxRaw = Number((g as any).insetXPx)
    const insetYPxRaw = Number((g as any).insetYPx)
    let insetXPx = wantsAnimation ? 0 : Math.round(clamp(Number.isFinite(insetXPxRaw) ? insetXPxRaw : 24, 0, 300))
    let insetYPx = Math.round(clamp(Number.isFinite(insetYPxRaw) ? insetYPxRaw : 24, 0, 300))
    if (animate === 'doc_reveal') {
      position = 'middle_center'
      insetXPx = 0
      insetYPx = 0
    }

    if (animate === 'doc_reveal') {
      sizePctWidth = 100
    }

    graphics.push({
      id,
      uploadId: meta.id,
      startSeconds: clamped.startSeconds,
      endSeconds: clamped.endSeconds,
      fitMode,
      sizePctWidth,
      position,
      insetXPx,
      insetYPx,
      borderWidthPx,
      borderColor,
      fade,
      fadeDurationMs,
      ...(wantsAnimation ? { animate, animateDurationMs } : {}),
    })
  }

  // Sort by time for overlap validation and deterministic export.
  graphics.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < graphics.length; i++) {
    const g = graphics[i]
    if (i > 0) {
      const prev = graphics[i - 1]
      if (g.startSeconds < prev.endSeconds - 1e-6) throw new DomainError('graphic_overlap', 'graphic_overlap', 400)
    }
  }

  const graphicsTotalSeconds = graphics.length ? Number(graphics[graphics.length - 1].endSeconds) : 0
  const stillsTotalSeconds = stills.length ? Number(stills[stills.length - 1].endSeconds) : 0

  const videoOverlayStillsRaw0 = Array.isArray((raw as any).videoOverlayStills) ? ((raw as any).videoOverlayStills as any[]) : []
  const videoOverlayStillsRaw = legacyCumulative.length
    ? videoOverlayStillsRaw0.map((s) => ({
        ...(s as any),
        startSeconds: legacyMapMaybe((s as any).startSeconds),
        endSeconds: legacyMapMaybe((s as any).endSeconds),
      }))
    : videoOverlayStillsRaw0
  const MAX_VIDEO_OVERLAY_STILLS = 500
  if (videoOverlayStillsRaw.length > MAX_VIDEO_OVERLAY_STILLS) throw new DomainError('too_many_video_overlay_stills', 'too_many_video_overlay_stills', 400)
  const videoOverlayStills: any[] = []
  const allowedOverlayPositionsForStills = new Set([
    'top_left',
    'top_center',
    'top_right',
    'middle_left',
    'middle_center',
    'middle_right',
    'bottom_left',
    'bottom_center',
    'bottom_right',
  ])
  const allowedOverlaySizesForStills = new Set([25, 33, 40, 50, 70, 90, 100])
  for (const s of videoOverlayStillsRaw) {
    if (!s || typeof s !== 'object') continue
    const id = normalizeId((s as any).id)
    if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
    seen.add(id)

    const uploadId = Number((s as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')
    const startSeconds = normalizeSeconds((s as any).startSeconds)
    const endSeconds = normalizeSeconds((s as any).endSeconds)
    if (!(endSeconds > startSeconds)) throw new ValidationError('invalid_seconds')
    const clamped = clampTimelineRange(startSeconds, endSeconds)
    if (!clamped) continue

    const meta = await loadFreezeFrameImageMetaForUser(uploadId, ctx.userId)
    const sourceVideoOverlayIdRaw = (s as any).sourceVideoOverlayId
    const sourceVideoOverlayId = sourceVideoOverlayIdRaw != null ? String(sourceVideoOverlayIdRaw).trim() : undefined

    const sizePctWidthRaw = (s as any).sizePctWidth
    const sizePctWidthParsed = sizePctWidthRaw == null ? undefined : Math.round(Number(sizePctWidthRaw))
    const sizePctWidth = sizePctWidthParsed != null && allowedOverlaySizesForStills.has(sizePctWidthParsed) ? sizePctWidthParsed : undefined

    const posRaw = (s as any).position
    const pos = posRaw == null ? undefined : String(posRaw).trim().toLowerCase()
    const position = pos != null && allowedOverlayPositionsForStills.has(pos) ? pos : undefined

    videoOverlayStills.push({
      id,
      uploadId: meta.id,
      startSeconds: clamped.startSeconds,
      endSeconds: clamped.endSeconds,
      ...(sourceVideoOverlayId ? { sourceVideoOverlayId } : {}),
      ...(sizePctWidth != null ? { sizePctWidth } : {}),
      ...(position ? { position } : {}),
    })
  }

  videoOverlayStills.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < videoOverlayStills.length; i++) {
    const s = videoOverlayStills[i] as any
    if (i > 0) {
      const prev = videoOverlayStills[i - 1] as any
      if (s.startSeconds < Number(prev.endSeconds) - 1e-6) throw new DomainError('video_overlay_still_overlap', 'video_overlay_still_overlap', 400)
    }
  }

  const videoOverlaysRaw0 = Array.isArray((raw as any).videoOverlays) ? ((raw as any).videoOverlays as any[]) : []
  const videoOverlaysRaw = legacyCumulative.length
    ? videoOverlaysRaw0.map((o) => ({
        ...(o as any),
        startSeconds: legacyMapMaybe((o as any).startSeconds),
      }))
    : videoOverlaysRaw0
  if (videoOverlaysRaw.length > MAX_VIDEO_OVERLAYS) throw new DomainError('too_many_video_overlays', 'too_many_video_overlays', 400)
  const allowedOverlaySizes = new Set([25, 33, 40, 50, 70, 90, 100])
  const allowedOverlayPositions = new Set([
    'top_left',
    'top_center',
    'top_right',
    'middle_left',
    'middle_center',
    'middle_right',
    'bottom_left',
    'bottom_center',
    'bottom_right',
  ])
  const videoOverlays: any[] = []
  let overlayCursorSeconds = 0
  const allowedPlateStyles = new Set(['none', 'thin', 'medium', 'thick', 'band'])
  for (const o of videoOverlaysRaw) {
    if (!o || typeof o !== 'object') continue
    const id = normalizeId((o as any).id)
    if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
    seen.add(id)

    const uploadId = Number((o as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')

    const startSecondsRaw = (o as any).startSeconds
    const startSeconds =
      startSecondsRaw != null ? normalizeSeconds(startSecondsRaw) : roundToTenth(Math.max(0, overlayCursorSeconds))
    if (startSeconds >= MAX_SECONDS - 1e-6) continue

    const sourceStartSeconds = normalizeSeconds((o as any).sourceStartSeconds ?? 0)
    const sourceEndSeconds = normalizeSeconds((o as any).sourceEndSeconds)
    if (!(sourceEndSeconds > sourceStartSeconds)) throw new ValidationError('invalid_source_range')

    const sizePctWidthRaw = Number((o as any).sizePctWidth)
    const sizePctWidth = Number.isFinite(sizePctWidthRaw) ? Math.round(sizePctWidthRaw) : NaN
    if (!(Number.isFinite(sizePctWidth) && allowedOverlaySizes.has(sizePctWidth))) throw new ValidationError('invalid_overlay_size')

    const position = String((o as any).position || '').trim().toLowerCase()
    if (!allowedOverlayPositions.has(position)) throw new ValidationError('invalid_overlay_position')

    const audioEnabledRaw = (o as any).audioEnabled
    const audioEnabled = audioEnabledRaw == null ? false : Boolean(audioEnabledRaw)
    const boostRaw = (o as any).boostDb
    const boostDb = boostRaw == null ? 0 : Number(boostRaw)
    const boostAllowed = new Set([0, 3, 6, 9])
    if (!Number.isFinite(boostDb) || !boostAllowed.has(Math.round(boostDb))) throw new ValidationError('invalid_boost_db')

    const plateStyleRaw = String((o as any).plateStyle || 'none').trim().toLowerCase()
    const plateStyle = allowedPlateStyles.has(plateStyleRaw) ? plateStyleRaw : 'none'
    const plateColorRaw = String((o as any).plateColor || '#000000').trim()
    const plateColor = /^#?[0-9a-fA-F]{6}$/.test(plateColorRaw)
      ? (plateColorRaw.startsWith('#') ? plateColorRaw : `#${plateColorRaw}`)
      : '#000000'
    const plateOpacityRaw = Number((o as any).plateOpacityPct)
    const plateOpacityPct = Number.isFinite(plateOpacityRaw) ? Math.round(clamp(plateOpacityRaw, 0, 100)) : 85

    const meta = await loadUploadMetaForUser(uploadId, ctx.userId, { requireVideoRole: 'source' })
    let end = sourceEndSeconds
    if (meta.durationSeconds != null) {
      end = Math.min(end, roundToTenth(Math.max(0, meta.durationSeconds)))
      if (!(end > sourceStartSeconds)) throw new ValidationError('invalid_source_range')
    }

    const dur = roundToTenth(Math.max(0, end - sourceStartSeconds))
    const availableSeconds = Math.max(0, roundToTenth(MAX_SECONDS - startSeconds))
    const clampedDur = Math.min(dur, availableSeconds)
    if (clampedDur <= 1e-6) continue
    end = roundToTenth(sourceStartSeconds + clampedDur)
    const endSeconds = roundToTenth(startSeconds + clampedDur)
    overlayCursorSeconds = Math.max(overlayCursorSeconds, endSeconds)

    videoOverlays.push({
      id,
      uploadId: meta.id,
      startSeconds,
      sourceStartSeconds,
      sourceEndSeconds: end,
      sizePctWidth,
      position,
      audioEnabled,
      boostDb: Math.round(boostDb),
      plateStyle,
      plateColor,
      plateOpacityPct,
    })
  }

  videoOverlays.sort(
    (a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
  )
  let videoOverlaysTotalSeconds = 0
  for (let i = 0; i < videoOverlays.length; i++) {
    const o = videoOverlays[i] as any
    const start = Number(o.startSeconds || 0)
    const dur = Math.max(0, Number(o.sourceEndSeconds) - Number(o.sourceStartSeconds))
    const end = roundToTenth(start + dur)
    videoOverlaysTotalSeconds = Math.max(videoOverlaysTotalSeconds, end)
    if (i > 0) {
      const prev = videoOverlays[i - 1] as any
      const prevStart = Number(prev.startSeconds || 0)
      const prevDur = Math.max(0, Number(prev.sourceEndSeconds) - Number(prev.sourceStartSeconds))
      const prevEnd = roundToTenth(prevStart + prevDur)
      if (start < prevEnd - 1e-6) throw new DomainError('video_overlay_overlap', 'video_overlay_overlap', 400)
    }
  }

  // No overlaps between overlay videos and overlay stills (same lane).
  if (videoOverlayStills.length && videoOverlays.length) {
    for (const s of videoOverlayStills) {
      const ss = Number((s as any).startSeconds)
      const se = Number((s as any).endSeconds)
      if (!(Number.isFinite(ss) && Number.isFinite(se) && se > ss)) continue
      for (const o of videoOverlays) {
        const os = Number((o as any).startSeconds || 0)
        const od = Math.max(0, Number((o as any).sourceEndSeconds) - Number((o as any).sourceStartSeconds))
        const oe = roundToTenth(os + od)
        if (ss < oe - 1e-6 && se > os + 1e-6) throw new DomainError('video_overlay_lane_overlap', 'video_overlay_lane_overlap', 400)
      }
    }
  }

  const videoOverlayStillsTotalSeconds = videoOverlayStills.length ? Number(videoOverlayStills[videoOverlayStills.length - 1].endSeconds) : 0

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
  const logoSizeAllowed = new Set([10, 20, 30, 40, 50])
  const logoFadeAllowed = new Set(['none', 'in', 'out', 'in_out'])
  const logoPositionAllowed = new Set([
    'top_left',
    'top_center',
    'top_right',
    'middle_left',
    'middle_center',
    'middle_right',
    'bottom_left',
    'bottom_center',
    'bottom_right',
    // Legacy fallback.
    'center',
  ])
  for (const l of logosRaw) {
    if (!l || typeof l !== 'object') continue
    const id = normalizeId((l as any).id)
    if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
    seen.add(id)

    const uploadId = Number((l as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')

    const startSeconds = normalizeSeconds((l as any).startSeconds)
    const endSeconds = normalizeSeconds((l as any).endSeconds)
    if (!(endSeconds > startSeconds)) throw new ValidationError('invalid_seconds')
    const clamped = clampTimelineRange(startSeconds, endSeconds)
    if (!clamped) continue

    const meta = await loadLogoMetaForUser(uploadId, ctx.userId)

    const sizeRaw = Number((l as any).sizePctWidth)
    const sizeRounded = Number.isFinite(sizeRaw) ? Math.round(sizeRaw) : 20
    const sizePctWidth = logoSizeAllowed.has(sizeRounded) ? sizeRounded : 20

    const positionRaw = String((l as any).position || 'top_left').trim().toLowerCase()
    const position = (logoPositionAllowed.has(positionRaw) ? positionRaw : 'top_left') as any

    const opacityRaw = Number((l as any).opacityPct)
    const opacityPct = Number.isFinite(opacityRaw) ? Math.max(0, Math.min(100, Math.round(opacityRaw))) : 100

    const fadeRaw = String((l as any).fade || 'none').trim().toLowerCase()
    const fade = (logoFadeAllowed.has(fadeRaw) ? fadeRaw : 'none') as any

    const insetXPxRaw = Number((l as any).insetXPx)
    const insetYPxRaw = Number((l as any).insetYPx)
    const insetXPx = Number.isFinite(insetXPxRaw) ? Math.max(0, Math.min(9999, Math.round(insetXPxRaw))) : 100
    const insetYPx = Number.isFinite(insetYPxRaw) ? Math.max(0, Math.min(9999, Math.round(insetYPxRaw))) : 100

    logos.push({
      id,
      uploadId: meta.id,
      startSeconds: clamped.startSeconds,
      endSeconds: clamped.endSeconds,
      sizePctWidth,
      position,
      opacityPct,
      fade,
      insetXPx,
      insetYPx,
    })
  }

  logos.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < logos.length; i++) {
    const l = logos[i]
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
    const clamped = clampTimelineRange(startSeconds, endSeconds)
    if (!clamped) continue

    const meta = await loadLowerThirdImageMetaForUser(uploadId, ctx.userId)
    await lowerThirdConfigsSvc.getActiveForUser(configId, Number(ctx.userId))
    const configSnapshot = normalizeLowerThirdConfigSnapshot((lt as any).configSnapshot, configId)

    lowerThirds.push({
      id,
      uploadId: meta.id,
      startSeconds: clamped.startSeconds,
      endSeconds: clamped.endSeconds,
      configId,
      configSnapshot,
    })
  }

  lowerThirds.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < lowerThirds.length; i++) {
    const lt = lowerThirds[i]
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
    const clamped = clampTimelineRange(startSeconds, endSeconds)
    if (!clamped) continue

    const presetIdRaw = (st as any).presetId
    const presetId = presetIdRaw == null ? null : Number(presetIdRaw)
    if (presetId != null && (!Number.isFinite(presetId) || presetId <= 0)) throw new ValidationError('invalid_screen_title_preset_id')
    const presetSnapshotRaw = (st as any).presetSnapshot
    const presetSnapshot = presetId != null ? normalizeScreenTitlePresetSnapshot(presetSnapshotRaw, presetId) : null
    if (presetId == null && presetSnapshotRaw != null) throw new ValidationError('invalid_screen_title_preset_snapshot')

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

    const normalizeCustomStyle = (customStyleRaw: any): any => {
      if (!customStyleRaw || typeof customStyleRaw !== 'object') return null
      const posRaw = String((customStyleRaw as any).position || '').trim().toLowerCase()
      const position = posRaw === 'top' || posRaw === 'middle' || posRaw === 'bottom' ? posRaw : undefined
      const alnRaw = String((customStyleRaw as any).alignment || '').trim().toLowerCase()
      const alignment = alnRaw === 'left' || alnRaw === 'center' || alnRaw === 'right' ? alnRaw : undefined
      const marginXPxRaw = (customStyleRaw as any).marginXPx
      const marginYPxRaw = (customStyleRaw as any).marginYPx
      const marginXPx = marginXPxRaw == null ? undefined : Number(marginXPxRaw)
      const marginYPx = marginYPxRaw == null ? undefined : Number(marginYPxRaw)
      const offsetXPxRaw = (customStyleRaw as any).offsetXPx
      const offsetYPxRaw = (customStyleRaw as any).offsetYPx
      const offsetXPx = offsetXPxRaw == null ? undefined : Number(offsetXPxRaw)
      const offsetYPx = offsetYPxRaw == null ? undefined : Number(offsetYPxRaw)
      const placementRectRaw = (customStyleRaw as any).placementRect
      const placementRect =
        placementRectRaw && typeof placementRectRaw === 'object' && !Array.isArray(placementRectRaw)
          ? {
              xPct: Number((placementRectRaw as any).xPct),
              yPct: Number((placementRectRaw as any).yPct),
              wPct: Number((placementRectRaw as any).wPct),
              hPct: Number((placementRectRaw as any).hPct),
            }
          : null
      const fontKeyRaw = (customStyleRaw as any).fontKey
      const fontKey = fontKeyRaw == null ? undefined : String(fontKeyRaw)
      const fontSizePctRaw = (customStyleRaw as any).fontSizePct
      const fontSizePct = fontSizePctRaw == null ? undefined : Number(fontSizePctRaw)
      const fontColorRaw = (customStyleRaw as any).fontColor
      const fontColor = fontColorRaw == null ? undefined : String(fontColorRaw)
      const fontGradientKeyRaw = (customStyleRaw as any).fontGradientKey
      const fontGradientKey =
        fontGradientKeyRaw === undefined
          ? undefined
          : fontGradientKeyRaw == null
            ? null
            : String(fontGradientKeyRaw || '').trim() || null

      const out: any = {}
      if (position) out.position = position
      if (alignment) out.alignment = alignment
      if (Number.isFinite(marginXPx)) out.marginXPx = clamp(marginXPx as number, 0, 1000)
      if (Number.isFinite(marginYPx)) out.marginYPx = clamp(marginYPx as number, 0, 1000)
      if (Number.isFinite(offsetXPx)) out.offsetXPx = clamp(offsetXPx as number, -1000, 1000)
      if (Number.isFinite(offsetYPx)) out.offsetYPx = clamp(offsetYPx as number, -1000, 1000)
      if (placementRect) {
        const xRaw = placementRect.xPct
        const yRaw = placementRect.yPct
        const wRaw = placementRect.wPct
        const hRaw = placementRect.hPct
        if (Number.isFinite(xRaw) && Number.isFinite(yRaw) && Number.isFinite(wRaw) && Number.isFinite(hRaw)) {
          let xPct = clamp(xRaw, 0, 100)
          let yPct = clamp(yRaw, 0, 100)
          let wPct = clamp(wRaw, 0, 100)
          let hPct = clamp(hRaw, 0, 100)
          wPct = Math.min(wPct, Math.max(0, 100 - xPct))
          hPct = Math.min(hPct, Math.max(0, 100 - yPct))
          if (wPct > 0.001 && hPct > 0.001) {
            out.placementRect = {
              xPct: Math.round(xPct * 1000) / 1000,
              yPct: Math.round(yPct * 1000) / 1000,
              wPct: Math.round(wPct * 1000) / 1000,
              hPct: Math.round(hPct * 1000) / 1000,
            }
          }
        }
      }
      if (fontKey && fontKey.length <= 120) out.fontKey = fontKey
      if (Number.isFinite(fontSizePct)) out.fontSizePct = clamp(fontSizePct as number, 0.5, 20)
      if (fontColor && fontColor.length <= 32) out.fontColor = fontColor
      if (fontGradientKey === null) out.fontGradientKey = null
      if (typeof fontGradientKey === 'string' && fontGradientKey.length > 0 && fontGradientKey.length <= 200) out.fontGradientKey = fontGradientKey
      return Object.keys(out).length ? out : null
    }

    const instancesRaw = Array.isArray((st as any).instances) ? ((st as any).instances as any[]) : []
    let instances: any[] | null = null
    if (instancesRaw.length) {
      if (instancesRaw.length > 5) throw new ValidationError('invalid_screen_title_text')
      const insts: any[] = []
      for (let i = 0; i < instancesRaw.length; i++) {
        const inst = instancesRaw[i]
        if (!inst || typeof inst !== 'object') continue
        const instIdRaw = (inst as any).id
        const instId = normalizeId(instIdRaw || `${id}_i${i + 1}`)
        const instTextRaw = (inst as any).text
        const instText = instTextRaw == null ? '' : String(instTextRaw)
        if (instText.length > 1000) throw new ValidationError('invalid_screen_title_text')
        const instLines = instText.split(/\r?\n/)
        if (instLines.length > 30) throw new ValidationError('invalid_screen_title_text')
        const instCustomStyle = normalizeCustomStyle((inst as any).customStyle)
        insts.push({ id: instId, text: instText, customStyle: instCustomStyle })
      }
      if (insts.length > 5) throw new ValidationError('invalid_screen_title_text')
      instances = insts
    }

    const textRaw = (st as any).text
    const text = textRaw == null ? '' : String(textRaw)
    if (!instances) {
      if (text.length > 1000) throw new ValidationError('invalid_screen_title_text')
      const lines = text.split(/\r?\n/)
      if (lines.length > 30) throw new ValidationError('invalid_screen_title_text')
    }

    const legacyCustomStyle = normalizeCustomStyle((st as any).customStyle)
    if (!instances || !instances.length) {
      instances = [{ id: `${id}_i1`, text, customStyle: legacyCustomStyle }]
    }
    const primaryInst = instances[0] || { text, customStyle: legacyCustomStyle }

    screenTitles.push({
      id,
      startSeconds: clamped.startSeconds,
      endSeconds: clamped.endSeconds,
      presetId,
      presetSnapshot,
      customStyle: primaryInst?.customStyle || null,
      text: primaryInst?.text == null ? '' : String(primaryInst.text),
      instances,
      renderUploadId: renderUploadMetaId,
    })
  }

  screenTitles.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < screenTitles.length; i++) {
    const st = screenTitles[i]
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
    const clamped = clampTimelineRange(startSeconds, endSeconds)
    if (!clamped) continue
    const sourceStartRaw = (seg as any).sourceStartSeconds
    const sourceStartSeconds = sourceStartRaw == null ? 0 : normalizeSeconds(sourceStartRaw)
    const gainRaw = (seg as any).gainDb
    const gainDb = gainRaw == null ? 0 : Number(gainRaw)
    if (!Number.isFinite(gainDb) || gainDb < -12 || gainDb > 12) throw new ValidationError('invalid_narration_gain')
    const audioEnabled = (seg as any).audioEnabled == null ? true : Boolean((seg as any).audioEnabled)
    const boostRaw = (seg as any).boostDb
    const boostDb = boostRaw == null ? null : Number(boostRaw)
    const boostAllowed = new Set([0, 3, 6, 9])
    if (boostDb != null && !(Number.isFinite(boostDb) && boostAllowed.has(Math.round(boostDb)))) throw new ValidationError('invalid_boost_db')

    const meta = await loadNarrationAudioMetaForUser(uploadId, ctx.userId)
    narration.push({
      id,
      uploadId: meta.id,
      startSeconds: clamped.startSeconds,
      endSeconds: clamped.endSeconds,
      sourceStartSeconds,
      gainDb,
      audioEnabled,
      ...(boostDb != null ? { boostDb: Math.round(boostDb) } : {}),
    })
  }
  narration.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  for (let i = 0; i < narration.length; i++) {
    const n = narration[i]
    if (i > 0) {
      const prev = narration[i - 1]
      if (n.startSeconds < prev.endSeconds - 1e-6) throw new DomainError('narration_overlap', 'narration_overlap', 400)
    }
  }
  const narrationTotalSeconds = narration.length ? Number(narration[narration.length - 1].endSeconds) : 0

  const totalForPlayhead = roundToTenth(
    Math.min(
      MAX_SECONDS,
      Math.max(
        videoTotalSeconds,
        graphicsTotalSeconds,
        stillsTotalSeconds,
        videoOverlaysTotalSeconds,
        videoOverlayStillsTotalSeconds,
        logosTotalSeconds,
        lowerThirdsTotalSeconds,
        screenTitlesTotalSeconds,
        narrationTotalSeconds
      )
    )
  )
  const safePlayheadSeconds = totalForPlayhead > 0 ? Math.min(playheadSeconds, roundToTenth(totalForPlayhead)) : 0

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
      if (audioSegmentsRaw.length && !(totalForPlayhead > 0)) throw new DomainError('empty_timeline', 'empty_timeline', 400)

      for (let i = 0; i < audioSegmentsRaw.length; i++) {
        const seg = audioSegmentsRaw[i]
        if (!seg || typeof seg !== 'object') continue
        const id = normalizeId((seg as any).id || `aud_${i + 1}`)
        if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
        seen.add(id)

        const uploadId = Number((seg as any).uploadId)
        const audioConfigIdRaw = (seg as any).audioConfigId
        const audioConfigId =
          audioConfigIdRaw == null ? null : (Number.isFinite(Number(audioConfigIdRaw)) ? Number(audioConfigIdRaw) : NaN)
        const audioEnabled = (seg as any).audioEnabled == null ? true : Boolean((seg as any).audioEnabled)
        const musicModeRaw = (seg as any).musicMode == null ? null : String((seg as any).musicMode)
        const musicLevelRaw = (seg as any).musicLevel == null ? null : String((seg as any).musicLevel)
        const duckingIntensityRaw = (seg as any).duckingIntensity == null ? null : String((seg as any).duckingIntensity)
        if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')

        const meta = await loadBackgroundMusicAudioMetaForUser(uploadId, ctx.userId)

        const startSeconds = normalizeSeconds((seg as any).startSeconds ?? 0)
        const endSecondsRaw = (seg as any).endSeconds
        const endSecondsInput = endSecondsRaw == null ? totalForPlayhead : normalizeSeconds(endSecondsRaw)
        const maxPlayhead = roundToTenth(totalForPlayhead)
        const start = Math.min(startSeconds, maxPlayhead)
        const end = Math.min(endSecondsInput, maxPlayhead)
        if (!(end > start)) {
          if (start >= maxPlayhead - 1e-6) continue
          throw new ValidationError('invalid_seconds')
        }
        const sourceStartRaw = (seg as any).sourceStartSeconds
        const sourceStartSeconds = sourceStartRaw == null ? 0 : normalizeSeconds(sourceStartRaw)
        audioSegments.push({
          id,
          uploadId: meta.id,
          ...(audioConfigId != null && Number.isFinite(audioConfigId) && audioConfigId > 0 ? { audioConfigId } : {}),
          audioEnabled,
          ...(musicModeRaw ? { musicMode: musicModeRaw } : {}),
          ...(musicLevelRaw ? { musicLevel: musicLevelRaw } : {}),
          ...(duckingIntensityRaw ? { duckingIntensity: duckingIntensityRaw } : {}),
          startSeconds: start,
          endSeconds: end,
          sourceStartSeconds,
        })
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
      const meta = await loadBackgroundMusicAudioMetaForUser(uploadId, ctx.userId)

      const startSeconds = normalizeSeconds((audioTrackRaw as any).startSeconds ?? 0)
      const endSecondsRaw = (audioTrackRaw as any).endSeconds
      const endSecondsInput = endSecondsRaw == null ? totalForPlayhead : normalizeSeconds(endSecondsRaw)
      const start = Math.min(startSeconds, roundToTenth(totalForPlayhead))
      const end = Math.min(endSecondsInput, roundToTenth(totalForPlayhead))
      if (end > start) {
        audioSegments.push({
          id: 'audio_track_legacy',
          uploadId: meta.id,
          audioConfigId,
          audioEnabled: true,
          startSeconds: start,
          endSeconds: end,
          sourceStartSeconds: 0,
        })
      }
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

  // Optional: guidelines (UI-only, used for snapping/markers).
  const rawGuidelines = Array.isArray((raw as any).guidelines) ? ((raw as any).guidelines as any[]) : []
  const guidelinesMap = new Map<string, number>()
  for (const g of rawGuidelines) {
    const t0 = normalizeSeconds(g)
    const t1 = legacyCumulative.length ? legacyMapTime(t0) : t0
    const t = roundToTenth(Math.max(0, Math.min(MAX_SECONDS, t1)))
    guidelinesMap.set(t.toFixed(1), t)
  }
  const guidelines = Array.from(guidelinesMap.values()).sort((a, b) => a - b)

  // Optional: viewport end (UI-only, does not affect export duration).
  // Normalize for legacy freeze removal so the viewport doesn't retain "phantom time".
  const viewportEndRaw = (raw as any).viewportEndSeconds
  let viewportEndSeconds: number | undefined = undefined
  if (viewportEndRaw != null && viewportEndRaw !== '') {
    const t0 = normalizeSeconds(viewportEndRaw)
    const t1 = legacyCumulative.length ? legacyMapTime(t0) : t0
    const t = roundToTenth(Math.max(0, Math.min(MAX_SECONDS, t1)))
    viewportEndSeconds = t
  }

  return {
    version: 'create_video_v1',
    playheadSeconds: safePlayheadSeconds,
    timelineBackgroundMode,
    timelineBackgroundColor,
    timelineBackgroundUploadId,
    viewportEndSeconds,
    clips,
    stills,
    videoOverlays,
    videoOverlayStills,
    graphics,
    guidelines,
    logos,
    lowerThirds,
    screenTitles,
    narration,
    audioSegments,
    audioTrack: null,
  }
}
