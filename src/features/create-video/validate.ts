import { DomainError, ForbiddenError, ValidationError } from '../../core/errors'
import { getPool } from '../../db'
import type { CreateVideoTimelineV1 } from './types'

const MAX_CLIPS = 50
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

  return {
    version: 'create_video_v1',
    playheadSeconds,
    clips,
  }
}

