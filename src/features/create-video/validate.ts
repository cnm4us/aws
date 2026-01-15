import { DomainError, ForbiddenError, ValidationError } from '../../core/errors'
import { getPool } from '../../db'
import type { CreateVideoTimelineV1 } from './types'

const MAX_CLIPS = 50
const MAX_GRAPHICS = 200
const MAX_SECONDS = 20 * 60

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

function normalizeSeconds(n: any): number {
  const v = Number(n)
  if (!Number.isFinite(v)) throw new ValidationError('invalid_seconds')
  return roundToTenth(Math.max(0, v))
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
  let totalSeconds = 0

  for (const c of clipsRaw) {
    if (!c || typeof c !== 'object') continue
    const id = normalizeId((c as any).id)
    if (seen.has(id)) throw new ValidationError('duplicate_clip_id')
    seen.add(id)

    const uploadId = Number((c as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('invalid_upload_id')

    const sourceStartSeconds = normalizeSeconds((c as any).sourceStartSeconds ?? 0)
    const sourceEndSeconds = normalizeSeconds((c as any).sourceEndSeconds)
    if (!(sourceEndSeconds > sourceStartSeconds)) throw new ValidationError('invalid_source_range')

    const meta = await loadUploadMetaForUser(uploadId, ctx.userId)
    let end = sourceEndSeconds
    if (meta.durationSeconds != null) {
      end = Math.min(end, roundToTenth(Math.max(0, meta.durationSeconds)))
      if (!(end > sourceStartSeconds)) throw new ValidationError('invalid_source_range')
    }

    const len = Math.max(0, end - sourceStartSeconds)
    totalSeconds += len
    if (totalSeconds > MAX_SECONDS) throw new DomainError('timeline_too_long', 'timeline_too_long', 413)

    clips.push({ id, uploadId: meta.id, sourceStartSeconds, sourceEndSeconds: end })
  }

  const videoTotalSeconds = totalSeconds

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
    if (videoTotalSeconds > 0) {
      if (g.endSeconds > videoTotalSeconds + 1e-6) throw new DomainError('graphic_out_of_bounds', 'graphic_out_of_bounds', 400)
    }
    if (i > 0) {
      const prev = graphics[i - 1]
      if (g.startSeconds < prev.endSeconds - 1e-6) throw new DomainError('graphic_overlap', 'graphic_overlap', 400)
    }
  }

  const graphicsTotalSeconds = graphics.length ? Number(graphics[graphics.length - 1].endSeconds) : 0
  const totalForPlayhead = videoTotalSeconds > 0 ? videoTotalSeconds : graphicsTotalSeconds
  const safePlayheadSeconds = totalForPlayhead > 0 ? Math.min(playheadSeconds, roundToTenth(totalForPlayhead)) : 0

  if (totalForPlayhead > MAX_SECONDS) throw new DomainError('timeline_too_long', 'timeline_too_long', 413)

  return {
    version: 'create_video_v1',
    playheadSeconds: safePlayheadSeconds,
    clips,
    graphics,
  }
}
