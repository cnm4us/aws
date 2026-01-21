import { DomainError } from '../../core/errors'
import { getPool } from '../../db'

type UploadRowLite = {
  id: number
  user_id: number | null
  kind: string
  status: string
  source_deleted_at?: string | null
  duration_seconds?: number | null
  image_role?: string | null
  is_system?: number | null
}

function normalizeIdOrNull(raw: any, code: string): number | null {
  if (raw == null) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError(code, code, 400)
  return Math.trunc(n)
}

function normalizeStringOrNull(raw: any, maxLen: number, code: string): string | null {
  const s = String(raw ?? '').replace(/\r\n/g, '\n').trim()
  if (!s) return null
  if (s.length > maxLen) throw new DomainError(code, code, 400)
  return s
}

async function loadUpload(uploadId: number): Promise<UploadRowLite | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, user_id, kind, status, source_deleted_at, duration_seconds, image_role, is_system
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  return (rows as any[])[0] || null
}

async function ensureOverlayImageUploadOwned(uploadId: number, userId: number) {
  const row = await loadUpload(uploadId)
  if (!row) throw new DomainError('overlay_upload_not_found', 'overlay_upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'image') throw new DomainError('invalid_overlay_upload_kind', 'invalid_overlay_upload_kind', 400)
  if (String(row.image_role || '').toLowerCase() !== 'overlay') throw new DomainError('invalid_overlay_image_role', 'invalid_overlay_image_role', 400)
  if (row.user_id != null && Number(row.user_id) !== Number(userId)) throw new DomainError('forbidden', 'forbidden', 403)
  return row
}

async function ensureImageUploadOwned(uploadId: number, userId: number, role: 'title_page' | 'lower_third') {
  const row = await loadUpload(uploadId)
  if (!row) throw new DomainError('image_upload_not_found', 'image_upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'image') throw new DomainError('invalid_image_upload_kind', 'invalid_image_upload_kind', 400)
  if (String(row.image_role || '').toLowerCase() !== role) throw new DomainError('invalid_image_role', 'invalid_image_role', 400)
  if (row.user_id != null && Number(row.user_id) !== Number(userId)) throw new DomainError('forbidden', 'forbidden', 403)
  return row
}

async function ensureLogoUploadOwned(uploadId: number, userId: number) {
  const row = await loadUpload(uploadId)
  if (!row) throw new DomainError('logo_upload_not_found', 'logo_upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'logo') throw new DomainError('invalid_logo_upload_kind', 'invalid_logo_upload_kind', 400)
  if (row.user_id != null && Number(row.user_id) !== Number(userId)) throw new DomainError('forbidden', 'forbidden', 403)
  return row
}

async function ensureMusicUploadSelectable(uploadId: number, userId: number) {
  const row = await loadUpload(uploadId)
  if (!row) throw new DomainError('music_upload_not_found', 'music_upload_not_found', 404)
  if (String(row.kind || '').toLowerCase() !== 'audio') throw new DomainError('invalid_music_upload_kind', 'invalid_music_upload_kind', 400)
  const isSystem = Number(row.is_system || 0) === 1
  if (!isSystem && row.user_id != null && Number(row.user_id) !== Number(userId)) throw new DomainError('forbidden', 'forbidden', 403)
  return row
}

async function ensureOwnedConfig(id: number, userId: number, table: string, ownerCol: string) {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, ${ownerCol} AS owner_user_id, archived_at
       FROM ${table}
      WHERE id = ?
      LIMIT 1`,
    [id]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('not_found', 'not_found', 404)
  if (row.archived_at) throw new DomainError('archived', 'archived', 400)
  if (Number(row.owner_user_id) !== Number(userId)) throw new DomainError('forbidden', 'forbidden', 403)
}

async function ensureAudioConfigSelectable(id: number) {
  const db = getPool()
  const [rows] = await db.query(`SELECT id, archived_at FROM audio_configurations WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('not_found', 'not_found', 404)
  if (row.archived_at) throw new DomainError('archived', 'archived', 400)
}

type Range = { start: number; end: number }

function normalizeRanges(raw: any, maxSeconds: number | null): Range[] {
  const arr = Array.isArray(raw) ? raw : []
  const out: Range[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const s = Number((item as any).start)
    const e = Number((item as any).end)
    if (!Number.isFinite(s) || !Number.isFinite(e)) throw new DomainError('invalid_edit_ranges', 'invalid_edit_ranges', 400)
    const start = Math.max(0, Math.round(s * 10) / 10)
    const end = Math.max(0, Math.round(e * 10) / 10)
    if (end <= start) throw new DomainError('invalid_edit_ranges', 'invalid_edit_ranges', 400)
    if (maxSeconds != null && end > maxSeconds) throw new DomainError('invalid_edit_ranges', 'invalid_edit_ranges', 400)
    out.push({ start, end })
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end)
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1].end > out[i].start) throw new DomainError('invalid_edit_ranges', 'invalid_edit_ranges', 400)
  }
  return out
}

async function normalizeTimelineOverlays(overlaysRaw: any, userId: number, maxSeconds: number | null) {
  const arr = Array.isArray(overlaysRaw) ? overlaysRaw : []
  if (arr.length > 20) throw new DomainError('too_many_overlays', 'too_many_overlays', 400)
  const out: any[] = []
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue
    const kind = String((raw as any).kind || '').toLowerCase()
    const track = String((raw as any).track || '').toUpperCase()
    const uploadId = Number((raw as any).uploadId)
    const startSecondsRaw = Number((raw as any).startSeconds)
    const endSecondsRaw = Number((raw as any).endSeconds)
    if (kind !== 'image') throw new DomainError('invalid_overlay_kind', 'invalid_overlay_kind', 400)
    if (track !== 'A') throw new DomainError('invalid_overlay_track', 'invalid_overlay_track', 400)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new DomainError('invalid_overlay_upload', 'invalid_overlay_upload', 400)
    if (!Number.isFinite(startSecondsRaw) || !Number.isFinite(endSecondsRaw)) throw new DomainError('invalid_overlay_window', 'invalid_overlay_window', 400)
    const startSeconds = Math.max(0, Math.min(3600, Math.round(startSecondsRaw * 10) / 10))
    const endSeconds = Math.max(0, Math.min(3600, Math.round(endSecondsRaw * 10) / 10))
    if (endSeconds <= startSeconds) throw new DomainError('invalid_overlay_window', 'invalid_overlay_window', 400)
    if (maxSeconds != null && endSeconds > maxSeconds) throw new DomainError('invalid_overlay_window', 'invalid_overlay_window', 400)

    await ensureOverlayImageUploadOwned(uploadId, userId)

    out.push({
      id: (raw as any).id != null ? String((raw as any).id) : `ov_${uploadId}_${startSeconds}_${endSeconds}`,
      kind: 'image',
      track: 'A',
      uploadId,
      startSeconds,
      endSeconds,
      fit: 'cover',
      opacityPct: 100,
    })
  }
  out.sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds) || Number(a.endSeconds) - Number(b.endSeconds) || Number(a.uploadId) - Number(b.uploadId))
  for (let i = 1; i < out.length; i++) {
    if (Number(out[i - 1].endSeconds) > Number(out[i].startSeconds)) {
      throw new DomainError('overlay_overlap', 'overlay_overlap', 400)
    }
  }
  return out
}

export async function validateAndNormalizeDraftConfig(
  uploadId: number,
  configRaw: any,
  ctx: { userId: number }
): Promise<any> {
  const config = configRaw && typeof configRaw === 'object' && !Array.isArray(configRaw) ? configRaw : {}

  const baseUpload = await loadUpload(uploadId)
  if (!baseUpload) throw new DomainError('upload_not_found', 'upload_not_found', 404)
  if (String(baseUpload.kind || '').toLowerCase() !== 'video') throw new DomainError('invalid_upload_kind', 'invalid_upload_kind', 400)
  if (baseUpload.source_deleted_at) throw new DomainError('source_deleted', 'source_deleted', 409)
  if (baseUpload.user_id != null && Number(baseUpload.user_id) !== Number(ctx.userId)) throw new DomainError('forbidden', 'forbidden', 403)

  const maxSeconds = baseUpload.duration_seconds != null && Number.isFinite(Number(baseUpload.duration_seconds))
    ? Math.max(0, Number(baseUpload.duration_seconds))
    : null

  const next: any = { ...config }

  // Produce-side fields (kept in draft config for later “resume”).
  if ('name' in next) next.name = normalizeStringOrNull(next.name, 255, 'invalid_name')
  if ('defaultStoryText' in next) next.defaultStoryText = normalizeStringOrNull(next.defaultStoryText, 2000, 'invalid_story')

  if ('musicUploadId' in next) {
    const id = normalizeIdOrNull(next.musicUploadId, 'invalid_music_upload_id')
    if (id != null) await ensureMusicUploadSelectable(id, ctx.userId)
    next.musicUploadId = id
  }
  if ('logoUploadId' in next) {
    const id = normalizeIdOrNull(next.logoUploadId, 'invalid_logo_upload_id')
    if (id != null) await ensureLogoUploadOwned(id, ctx.userId)
    next.logoUploadId = id
  }
  if ('lowerThirdUploadId' in next) {
    const id = normalizeIdOrNull(next.lowerThirdUploadId, 'invalid_lower_third_upload_id')
    if (id != null) await ensureImageUploadOwned(id, ctx.userId, 'lower_third')
    next.lowerThirdUploadId = id
  }

  if ('logoConfigId' in next) {
    const id = normalizeIdOrNull(next.logoConfigId, 'invalid_logo_config_id')
    if (id != null) await ensureOwnedConfig(id, ctx.userId, 'logo_configurations', 'owner_user_id')
    next.logoConfigId = id
  }
  if ('lowerThirdConfigId' in next) {
    const id = normalizeIdOrNull(next.lowerThirdConfigId, 'invalid_lower_third_config_id')
    if (id != null) await ensureOwnedConfig(id, ctx.userId, 'lower_third_image_configurations', 'owner_user_id')
    next.lowerThirdConfigId = id
  }
  if ('audioConfigId' in next) {
    const id = normalizeIdOrNull(next.audioConfigId, 'invalid_audio_config_id')
    if (id != null) await ensureAudioConfigSelectable(id)
    next.audioConfigId = id
  }
  if ('screenTitlePresetId' in next) {
    const id = normalizeIdOrNull(next.screenTitlePresetId, 'invalid_screen_title_preset_id')
    if (id != null) await ensureOwnedConfig(id, ctx.userId, 'screen_title_presets', 'owner_user_id')
    next.screenTitlePresetId = id
  }
  if ('screenTitleText' in next) {
    let text = String(next.screenTitleText ?? '').replace(/\r\n/g, '\n')
    const lines = text.split('\n')
    if (lines.length > 12) text = lines.slice(0, 12).join('\n')
    text = text.trim()
    if (!text) next.screenTitleText = null
    else if (text.length > 400) throw new DomainError('invalid_screen_title', 'invalid_screen_title', 400)
    else next.screenTitleText = text
  }

  // Nested production config (edit/intro/timeline).
  if (next.config != null) {
    if (typeof next.config !== 'object' || Array.isArray(next.config)) throw new DomainError('invalid_config', 'invalid_config', 400)
    const cfg: any = { ...(next.config || {}) }

    // Edit config
    if (cfg.edit != null) {
      if (typeof cfg.edit !== 'object' || Array.isArray(cfg.edit)) throw new DomainError('invalid_edit', 'invalid_edit', 400)
      const edit: any = { ...cfg.edit }
      if (Array.isArray(edit.ranges) && edit.ranges.length) {
        cfg.edit = { ranges: normalizeRanges(edit.ranges, maxSeconds) }
      } else if (edit.trimStartSeconds != null || edit.trimEndSeconds != null) {
        const ts = Number(edit.trimStartSeconds ?? 0)
        const te = edit.trimEndSeconds == null ? null : Number(edit.trimEndSeconds)
        if (!Number.isFinite(ts) || ts < 0) throw new DomainError('invalid_edit_trim', 'invalid_edit_trim', 400)
        if (te != null && (!Number.isFinite(te) || te <= ts)) throw new DomainError('invalid_edit_trim', 'invalid_edit_trim', 400)
        if (maxSeconds != null && ts > maxSeconds) throw new DomainError('invalid_edit_trim', 'invalid_edit_trim', 400)
        if (maxSeconds != null && te != null && te > maxSeconds) throw new DomainError('invalid_edit_trim', 'invalid_edit_trim', 400)
        cfg.edit = { trimStartSeconds: Math.round(ts * 10) / 10, trimEndSeconds: te == null ? null : Math.round(te * 10) / 10 }
      } else {
        cfg.edit = null
      }
    }

    // Intro config
    if (cfg.intro != null) {
      if (typeof cfg.intro !== 'object' || Array.isArray(cfg.intro)) throw new DomainError('invalid_intro', 'invalid_intro', 400)
      const kind = String((cfg.intro as any).kind || '').trim()
      if (kind === 'freeze_first_frame') {
        const seconds = Number((cfg.intro as any).seconds)
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 5) throw new DomainError('invalid_intro', 'invalid_intro', 400)
        cfg.intro = { kind: 'freeze_first_frame', seconds: Math.trunc(seconds) }
      } else if (kind === 'title_image') {
        const uploadId = normalizeIdOrNull((cfg.intro as any).uploadId, 'invalid_title_upload_id')
        if (!uploadId) throw new DomainError('invalid_intro', 'invalid_intro', 400)
        const holdSeconds = Number((cfg.intro as any).holdSeconds ?? 0)
        if (!Number.isFinite(holdSeconds) || holdSeconds < 0 || holdSeconds > 5) throw new DomainError('invalid_intro', 'invalid_intro', 400)
        await ensureImageUploadOwned(uploadId, ctx.userId, 'title_page')
        cfg.intro = { kind: 'title_image', uploadId, holdSeconds: Math.trunc(holdSeconds) }
      } else {
        throw new DomainError('invalid_intro', 'invalid_intro', 400)
      }
    }

    // Timeline overlays
    if (cfg.timeline != null) {
      if (typeof cfg.timeline !== 'object' || Array.isArray(cfg.timeline)) throw new DomainError('invalid_timeline', 'invalid_timeline', 400)
      const overlays = await normalizeTimelineOverlays((cfg.timeline as any).overlays, ctx.userId, maxSeconds)
      cfg.timeline = overlays.length ? { overlays } : null
    }

    next.config = cfg
  }

  return next
}
