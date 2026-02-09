import { DomainError, ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from '../../core/errors'
import { randomUUID } from 'crypto'
import * as repo from './repo'
import { validateAndNormalizeCreateVideoTimeline } from './validate'
import type { CreateVideoProjectDto, CreateVideoProjectListItemDto, CreateVideoProjectRow, CreateVideoTimelineV1 } from './types'
import { enqueueJob } from '../media-jobs/service'
import * as mediaJobsRepo from '../media-jobs/repo'

function mapRow(row: CreateVideoProjectRow): CreateVideoProjectDto {
  let timeline: any = {}
  try {
    timeline = (row as any).timeline_json
    if (typeof timeline === 'string') timeline = JSON.parse(timeline)
    if (timeline == null || typeof timeline !== 'object') timeline = {}
  } catch {
    timeline = {}
  }
  if (timeline.version !== 'create_video_v1') {
    timeline = {
      version: 'create_video_v1',
      playheadSeconds: 0,
      timelineBackgroundMode: 'none',
      timelineBackgroundColor: '#000000',
      timelineBackgroundUploadId: null,
      clips: [],
      stills: [],
      graphics: [],
      guidelines: [],
      logos: [],
      lowerThirds: [],
      screenTitles: [],
      narration: [],
      audioSegments: [],
      audioTrack: null,
    }
  }
  return {
    id: Number(row.id),
    name: row.name == null ? null : String(row.name),
    description: row.description == null ? null : String(row.description),
    status: row.status,
    timeline: timeline as CreateVideoTimelineV1,
    lastExportUploadId: row.last_export_upload_id == null ? null : Number(row.last_export_upload_id),
    lastExportJobId: row.last_export_job_id == null ? null : Number(row.last_export_job_id),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
  }
}

function mapRowListItem(row: CreateVideoProjectRow): CreateVideoProjectListItemDto {
  return {
    id: Number(row.id),
    name: row.name == null ? null : String(row.name),
    description: row.description == null ? null : String(row.description),
    status: row.status,
    lastExportUploadId: row.last_export_upload_id == null ? null : Number(row.last_export_upload_id),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
  }
}

function normalizeTimeline(raw: any): any {
  if (raw == null) throw new ValidationError('invalid_timeline')
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('invalid_timeline')
  return raw
}

function ensureOwned(row: CreateVideoProjectRow, userId: number) {
  const ownerId = Number(row.user_id)
  if (ownerId !== Number(userId)) throw new ForbiddenError()
}

function emptyTimelineJson(): string {
  return JSON.stringify({
    version: 'create_video_v1',
    playheadSeconds: 0,
    timelineBackgroundMode: 'none',
    timelineBackgroundColor: '#000000',
    timelineBackgroundUploadId: null,
    clips: [],
    stills: [],
    graphics: [],
    guidelines: [],
    logos: [],
    lowerThirds: [],
    screenTitles: [],
    narration: [],
    audioSegments: [],
    audioTrack: null,
  })
}

export async function createOrGetActiveProjectForUser(userId: number): Promise<{ created: boolean; project: CreateVideoProjectDto }> {
  if (!userId) throw new ForbiddenError()
  const existing = await repo.getActiveByUser(Number(userId))
  if (existing) return { created: false, project: mapRow(existing) }

  const created = await repo.create({ userId: Number(userId), timelineJson: emptyTimelineJson() })
  return { created: true, project: mapRow(created) }
}

export async function getActiveProjectForUser(userId: number): Promise<CreateVideoProjectDto> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getActiveByUser(Number(userId))
  if (!row) throw new NotFoundError('not_found')
  return mapRow(row)
}

export async function listProjectsForUser(userId: number): Promise<{ items: CreateVideoProjectListItemDto[] }> {
  if (!userId) throw new ForbiddenError()
  const rows = await repo.listByUser(Number(userId))
  return { items: rows.map(mapRowListItem) }
}

export async function createProjectForUser(
  userId: number,
  input: { name?: string | null; description?: string | null }
): Promise<{ project: CreateVideoProjectDto }> {
  if (!userId) throw new ForbiddenError()
  const name = input.name == null ? null : String(input.name || '').trim()
  if (name != null && name.length > 255) throw new ValidationError('invalid_name')
  const description = input.description == null ? null : String(input.description || '').trim()
  if (description != null && description.length > 2000) throw new ValidationError('invalid_description')
  const created = await repo.create({
    userId: Number(userId),
    name: name && name.length ? name : null,
    description: description && description.length ? description : null,
    timelineJson: emptyTimelineJson(),
  })
  return { project: mapRow(created) }
}

export async function getProjectForUserById(userId: number, projectId: number): Promise<{ project: CreateVideoProjectDto }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(Number(projectId))
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  return { project: mapRow(row) }
}

export async function updateProjectMetaForUser(
  userId: number,
  projectId: number,
  input: { name?: any; description?: any }
): Promise<{ project: CreateVideoProjectDto }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(Number(projectId))
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  const name = input.name == null ? undefined : String(input.name || '').trim()
  if (name !== undefined && name.length > 255) throw new ValidationError('invalid_name')
  const description = input.description == null ? undefined : String(input.description || '').trim()
  if (description !== undefined && description.length > 2000) throw new ValidationError('invalid_description')
  const updated = await repo.updateMeta(Number(projectId), {
    name: name === undefined ? undefined : name && name.length ? name : null,
    description: description === undefined ? undefined : description && description.length ? description : null,
  })
  return { project: mapRow(updated) }
}

export async function updateProjectTimelineForUser(userId: number, projectId: number, timelineRaw: any): Promise<{ project: CreateVideoProjectDto }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(Number(projectId))
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  if (row.archived_at) throw new InvalidStateError('archived')

  const timeline = normalizeTimeline(timelineRaw)
  const normalized = await validateAndNormalizeCreateVideoTimeline(timeline, { userId: Number(userId) })
  const json = JSON.stringify(normalized)
  if (json.length > 512 * 1024) throw new DomainError('timeline_too_large', 'timeline_too_large', 413)
  const updated = await repo.updateTimeline(Number(row.id), json)
  return { project: mapRow(updated) }
}

export async function updateActiveProjectTimelineForUser(userId: number, timelineRaw: any): Promise<CreateVideoProjectDto> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getActiveByUser(Number(userId))
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  if (row.archived_at) throw new InvalidStateError('archived')

  const timeline = normalizeTimeline(timelineRaw)
  const normalized = await validateAndNormalizeCreateVideoTimeline(timeline, { userId: Number(userId) })
  const json = JSON.stringify(normalized)
  if (json.length > 512 * 1024) throw new DomainError('timeline_too_large', 'timeline_too_large', 413)
  const updated = await repo.updateTimeline(Number(row.id), json)
  return mapRow(updated)
}

export async function archiveProjectForUserById(userId: number, projectId: number): Promise<{ ok: true }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(Number(projectId))
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  await repo.archive(Number(projectId))
  return { ok: true }
}

export async function archiveActiveProjectForUser(userId: number): Promise<{ ok: true }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getActiveByUser(Number(userId))
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  await repo.archive(Number(row.id))
  return { ok: true }
}

export async function deleteProjectForUserById(userId: number, projectId: number): Promise<{ ok: true }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(Number(projectId))
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)

  await repo.detachUploadsFromProject(Number(userId), Number(projectId))
  await repo.deleteForUserById(Number(userId), Number(projectId))
  return { ok: true }
}

export async function exportProjectForUserById(userId: number, projectId: number): Promise<{ jobId: number }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(Number(projectId))
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  if (row.archived_at) throw new InvalidStateError('archived')
  return exportRowAsJob(userId, row)
}

export async function exportActiveProjectForUser(userId: number): Promise<{ jobId: number }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getActiveByUser(Number(userId))
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  if (row.archived_at) throw new InvalidStateError('archived')
  return exportRowAsJob(userId, row)
}

async function exportRowAsJob(userId: number, row: CreateVideoProjectRow): Promise<{ jobId: number }> {
  let timelineRaw: any = (row as any).timeline_json
  if (typeof timelineRaw === 'string') {
    try {
      timelineRaw = JSON.parse(timelineRaw)
    } catch {
      timelineRaw = null
    }
  }
  const normalized = await validateAndNormalizeCreateVideoTimeline(timelineRaw, { userId: Number(userId) })
  const graphics = Array.isArray((normalized as any).graphics) ? ((normalized as any).graphics as any[]) : []
  const videoOverlays = Array.isArray((normalized as any).videoOverlays) ? ((normalized as any).videoOverlays as any[]) : []
  const videoOverlayStills = Array.isArray((normalized as any).videoOverlayStills) ? ((normalized as any).videoOverlayStills as any[]) : []
  const stills = Array.isArray((normalized as any).stills) ? ((normalized as any).stills as any[]) : []
  const logos = Array.isArray((normalized as any).logos) ? ((normalized as any).logos as any[]) : []
  const lowerThirds = Array.isArray((normalized as any).lowerThirds) ? ((normalized as any).lowerThirds as any[]) : []
  const screenTitles = Array.isArray((normalized as any).screenTitles) ? ((normalized as any).screenTitles as any[]) : []
  const hasVisual =
    normalized.clips.length ||
    graphics.length ||
    videoOverlays.length ||
    videoOverlayStills.length ||
    stills.length ||
    logos.length ||
    lowerThirds.length ||
    screenTitles.length
  if (!hasVisual) throw new DomainError('empty_timeline', 'empty_timeline', 400)

  const job = await enqueueJob('create_video_export_v1', {
    projectId: Number(row.id),
    userId: Number(userId),
    timeline: normalized,
    traceId: randomUUID(),
  })
  const jobId = Number((job as any).id)
  if (!Number.isFinite(jobId) || jobId <= 0) throw new DomainError('failed_to_enqueue', 'failed_to_enqueue', 500)

  try {
    await repo.setLastExport(Number(row.id), { jobId: Number(jobId) })
  } catch {}

  return { jobId: Number(jobId) }
}

export async function getExportStatusForUserByProjectId(
  userId: number,
  projectId: number,
  opts?: { jobId?: number | null }
): Promise<{ status: string; jobId: number | null; resultUploadId: number | null; error?: any }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(Number(projectId))
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  return getExportStatusForRow(row, { jobId: opts?.jobId })
}

export async function getExportStatusForUser(
  userId: number,
  opts?: { jobId?: number | null }
): Promise<{ status: string; jobId: number | null; resultUploadId: number | null; error?: any }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getActiveByUser(Number(userId))
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  return getExportStatusForRow(row, { jobId: opts?.jobId })
}

async function getExportStatusForRow(
  row: CreateVideoProjectRow,
  opts?: { jobId?: number | null }
): Promise<{ status: string; jobId: number | null; resultUploadId: number | null; error?: any }> {
  const explicitJobId = opts?.jobId != null && Number.isFinite(Number(opts.jobId)) ? Number(opts.jobId) : null
  const jobId = explicitJobId != null ? explicitJobId : (row.last_export_job_id != null ? Number(row.last_export_job_id) : null)
  if (!jobId) return { status: 'idle', jobId: null, resultUploadId: null }
  const job = await mediaJobsRepo.getById(jobId)
  if (!job) return { status: 'idle', jobId: null, resultUploadId: null }

  if (explicitJobId != null) {
    try {
      const input = (job as any).input_json
      const ij = typeof input === 'string' ? JSON.parse(input) : input
      const uj = Number(ij?.userId)
      const pj = Number(ij?.projectId)
      if (!(Number.isFinite(uj) && uj > 0 && uj === Number(row.user_id))) throw new ForbiddenError()
      if (!(Number.isFinite(pj) && pj > 0 && pj === Number(row.id))) throw new NotFoundError('not_found')
    } catch (err) {
      // If input_json isn't parseable (or doesn't match), treat as not accessible.
      if (err instanceof ForbiddenError) throw err
      if (err instanceof NotFoundError) throw err
      throw new ForbiddenError()
    }
  }

  const status = String((job as any).status || '')
  let resultUploadId: number | null = null
  try {
    const result = (job as any).result_json
    const rj = typeof result === 'string' ? JSON.parse(result) : result
    const id = Number(rj?.resultUploadId || rj?.uploadId || rj?.outputUploadId)
    if (Number.isFinite(id) && id > 0) resultUploadId = id
  } catch {}

  const out: any = { status, jobId, resultUploadId }
  if (status === 'failed' || status === 'dead') {
    out.error = { code: (job as any).error_code || null, message: (job as any).error_message || null }
  }
  return out
}
