import { DomainError, ForbiddenError, ValidationError } from '../../core/errors'
import { getPool } from '../../db'
import type { CreateVideoTimelineV1 } from './types'
import * as audioConfigsSvc from '../audio-configs/service'

const MAX_CLIPS = 50
const MAX_GRAPHICS = 200
const MAX_STILLS = 200
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

export async function validateAndNormalizeCreateVideoTimeline(
  raw: any,
  ctx: { userId: number }
): Promise<CreateVideoTimelineV1> {
  if (!ctx.userId) throw new ForbiddenError()
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('invalid_timeline')

  const version = String((raw as any).version || '').trim()
  if (version !== 'create_video_v1') throw new ValidationError('invalid_timeline_version')

  const playheadSecondsRaw = (raw as any).playheadSeconds
  const playheadSeconds = playheadSecondsRaw != null ? normalizeSeconds(playheadSecondsRaw) : 0

  const clipsRaw = Array.isArray((raw as any).clips) ? ((raw as any).clips as any[]) : []
  if (clipsRaw.length > MAX_CLIPS) throw new DomainError('too_many_clips', 'too_many_clips', 400)

  const clips: CreateVideoTimelineV1['clips'] = []
  const seen = new Set<string>()
  let sequentialCursorSeconds = 0
  let videoEndSeconds = 0

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

    const freezeStartSecondsRaw = (c as any).freezeStartSeconds
    const freezeEndSecondsRaw = (c as any).freezeEndSeconds
    const freezeStartSeconds = freezeStartSecondsRaw != null ? normalizeSeconds(freezeStartSecondsRaw) : 0
    const freezeEndSeconds = freezeEndSecondsRaw != null ? normalizeSeconds(freezeEndSecondsRaw) : 0
    if (!isAllowedFreezeSeconds(freezeStartSeconds)) throw new ValidationError('invalid_freeze_seconds')
    if (!isAllowedFreezeSeconds(freezeEndSeconds)) throw new ValidationError('invalid_freeze_seconds')

    const meta = await loadUploadMetaForUser(uploadId, ctx.userId)
    let end = sourceEndSeconds
    if (meta.durationSeconds != null) {
      end = Math.min(end, roundToTenth(Math.max(0, meta.durationSeconds)))
      if (!(end > sourceStartSeconds)) throw new ValidationError('invalid_source_range')
    }

    const len = Math.max(0, end - sourceStartSeconds) + freezeStartSeconds + freezeEndSeconds
    const clipEnd = roundToTenth(startSeconds + len)
    videoEndSeconds = Math.max(videoEndSeconds, clipEnd)
    sequentialCursorSeconds = Math.max(sequentialCursorSeconds, clipEnd)
    if (videoEndSeconds > MAX_SECONDS + 1e-6) throw new DomainError('timeline_too_long', 'timeline_too_long', 413)

    clips.push({ id, uploadId: meta.id, startSeconds, sourceStartSeconds, sourceEndSeconds: end, freezeStartSeconds, freezeEndSeconds })
  }

  // Sort by time for deterministic playback/export and overlap validation.
  clips.sort((a: any, b: any) => Number(a.startSeconds || 0) - Number(b.startSeconds || 0) || String(a.id).localeCompare(String(b.id)))
  const baseTrackWindows: Array<{ start: number; end: number }> = []
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i] as any
    const start = Number(c.startSeconds || 0)
    const dur =
      Math.max(0, Number(c.sourceEndSeconds) - Number(c.sourceStartSeconds)) +
      Math.max(0, Number((c as any).freezeStartSeconds || 0)) +
      Math.max(0, Number((c as any).freezeEndSeconds || 0))
    const end = start + dur
    baseTrackWindows.push({ start: roundToTenth(start), end: roundToTenth(end) })
    videoEndSeconds = Math.max(videoEndSeconds, roundToTenth(end))
  }

  const videoTotalSeconds = roundToTenth(videoEndSeconds)

  const stillsRaw = Array.isArray((raw as any).stills) ? ((raw as any).stills as any[]) : []
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

  const graphicsRaw = Array.isArray((raw as any).graphics) ? ((raw as any).graphics as any[]) : []
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
  const totalForPlayhead = roundToTenth(Math.max(videoTotalSeconds, graphicsTotalSeconds, stillsTotalSeconds))
  const safePlayheadSeconds = totalForPlayhead > 0 ? Math.min(playheadSeconds, roundToTenth(totalForPlayhead)) : 0

  if (totalForPlayhead > MAX_SECONDS) throw new DomainError('timeline_too_long', 'timeline_too_long', 413)

  const audioTrackRaw = (raw as any).audioTrack
  let audioTrack: any = null
  if (audioTrackRaw != null) {
    if (audioTrackRaw === null) {
      audioTrack = null
    } else if (typeof audioTrackRaw !== 'object' || Array.isArray(audioTrackRaw)) {
      throw new ValidationError('invalid_audio_track')
    } else {
      if (!(totalForPlayhead > 0)) throw new DomainError('empty_timeline', 'empty_timeline', 400)
      const uploadId = Number((audioTrackRaw as any).uploadId)
      const audioConfigId = Number((audioTrackRaw as any).audioConfigId)
      if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')
      if (!Number.isFinite(audioConfigId) || audioConfigId <= 0) throw new ValidationError('invalid_audio_config_id')
      const meta = await loadSystemAudioMeta(uploadId)
      // Validate audio config exists and is not archived.
      await audioConfigsSvc.getActiveForUser(audioConfigId, Number(ctx.userId))

      const startSeconds = normalizeSeconds((audioTrackRaw as any).startSeconds ?? 0)
      const endSecondsRaw = (audioTrackRaw as any).endSeconds
      const endSecondsInput = endSecondsRaw == null ? totalForPlayhead : normalizeSeconds(endSecondsRaw)
      const start = Math.min(startSeconds, roundToTenth(totalForPlayhead))
      const end = Math.min(endSecondsInput, roundToTenth(totalForPlayhead))
      if (!(end > start)) throw new ValidationError('invalid_seconds')
      audioTrack = { uploadId: meta.id, audioConfigId, startSeconds: start, endSeconds: end }
    }
  }

  return {
    version: 'create_video_v1',
    playheadSeconds: safePlayheadSeconds,
    clips,
    stills,
    graphics,
    audioTrack,
  }
}
