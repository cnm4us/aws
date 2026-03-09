import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import { getLogger } from '../../lib/logger'
import * as repo from './repo'
import type { PromptDto, PromptKind, PromptRow, PromptStatus } from './types'

const promptsLogger = getLogger({ component: 'features.prompts' })

const KINDS: readonly PromptKind[] = ['prompt_full', 'prompt_overlay']
const STATUSES: readonly PromptStatus[] = ['draft', 'active', 'paused', 'archived']

function isEnumValue<T extends string>(value: any, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function normalizeName(raw: any): string {
  const value = String(raw ?? '').trim()
  if (!value) throw new DomainError('invalid_name', 'invalid_name', 400)
  if (value.length > 120) throw new DomainError('invalid_name', 'invalid_name', 400)
  return value
}

function normalizeKind(raw: any): PromptKind {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!isEnumValue(value, KINDS)) throw new DomainError('invalid_kind', 'invalid_kind', 400)
  return value
}

function normalizeHeadline(raw: any): string {
  const value = String(raw ?? '').trim()
  if (!value) throw new DomainError('invalid_headline', 'invalid_headline', 400)
  if (value.length > 280) throw new DomainError('invalid_headline', 'invalid_headline', 400)
  return value
}

function normalizeBody(raw: any): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (value.length > 6000) throw new DomainError('invalid_body', 'invalid_body', 400)
  return value
}

function normalizeLabel(raw: any, key: string, required = true): string | null {
  const value = String(raw ?? '').trim()
  if (!value) {
    if (required) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
    return null
  }
  if (value.length > 100) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return value
}

function normalizeInternalHref(raw: any, key: string, required = true): string | null {
  const value = String(raw ?? '').trim()
  if (!value) {
    if (required) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
    return null
  }
  if (value.length > 1200) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  if (!value.startsWith('/')) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  if (value.startsWith('//')) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  if (/^\/[\s]/.test(value) || /\s/.test(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  try {
    const url = new URL(value, 'https://aws.bawebtech.com')
    if (url.origin !== 'https://aws.bawebtech.com') throw new Error('invalid')
  } catch {
    throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  }
  return value
}

function normalizeCategory(raw: any): string {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) throw new DomainError('invalid_category', 'invalid_category', 400)
  if (value.length > 64) throw new DomainError('invalid_category', 'invalid_category', 400)
  if (!/^[a-z0-9_-]+$/.test(value)) throw new DomainError('invalid_category', 'invalid_category', 400)
  return value
}

function normalizePriority(raw: any, fallback = 100): number {
  const value = raw == null || raw === '' ? fallback : Number(raw)
  if (!Number.isFinite(value)) throw new DomainError('invalid_priority', 'invalid_priority', 400)
  return Math.round(Math.min(Math.max(value, -100000), 100000))
}

function normalizeStatus(raw: any, fallback: PromptStatus = 'draft'): PromptStatus {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, STATUSES)) throw new DomainError('invalid_status', 'invalid_status', 400)
  return value
}

function normalizeMediaUploadId(raw: any): number | null {
  if (raw == null || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new DomainError('invalid_media_upload_id', 'invalid_media_upload_id', 400)
  return Math.round(value)
}

function toMysqlDateTime(input: Date): string {
  const y = input.getUTCFullYear()
  const m = String(input.getUTCMonth() + 1).padStart(2, '0')
  const d = String(input.getUTCDate()).padStart(2, '0')
  const hh = String(input.getUTCHours()).padStart(2, '0')
  const mm = String(input.getUTCMinutes()).padStart(2, '0')
  const ss = String(input.getUTCSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function normalizeDateTime(raw: any, key: string): string | null {
  if (raw == null || raw === '') return null
  const date = new Date(String(raw))
  if (!Number.isFinite(date.getTime())) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return toMysqlDateTime(date)
}

function normalizeDateWindow(startsAtRaw: any, endsAtRaw: any): { startsAt: string | null; endsAt: string | null } {
  const startsAt = normalizeDateTime(startsAtRaw, 'starts_at')
  const endsAt = normalizeDateTime(endsAtRaw, 'ends_at')
  if (startsAt && endsAt && startsAt > endsAt) {
    throw new DomainError('invalid_date_window', 'invalid_date_window', 400)
  }
  return { startsAt, endsAt }
}

function mapRow(row: PromptRow): PromptDto {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    kind: row.kind,
    headline: String(row.headline || ''),
    body: row.body == null ? null : String(row.body),
    ctaPrimaryLabel: String(row.cta_primary_label || ''),
    ctaPrimaryHref: String(row.cta_primary_href || ''),
    ctaSecondaryLabel: row.cta_secondary_label == null ? null : String(row.cta_secondary_label),
    ctaSecondaryHref: row.cta_secondary_href == null ? null : String(row.cta_secondary_href),
    mediaUploadId: row.media_upload_id == null ? null : Number(row.media_upload_id),
    category: String(row.category || ''),
    priority: Number(row.priority || 0),
    status: row.status,
    startsAt: row.starts_at == null ? null : String(row.starts_at),
    endsAt: row.ends_at == null ? null : String(row.ends_at),
    createdBy: Number(row.created_by || 0),
    updatedBy: Number(row.updated_by || 0),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

export async function listForAdmin(params: {
  includeArchived?: boolean
  limit?: number
  status?: any
  kind?: any
  category?: any
}): Promise<PromptDto[]> {
  const status = params.status == null || params.status === '' ? null : normalizeStatus(params.status)
  const kind = params.kind == null || params.kind === '' ? null : normalizeKind(params.kind)
  const category = params.category == null || params.category === '' ? null : normalizeCategory(params.category)

  const rows = await repo.list({
    includeArchived: Boolean(params.includeArchived),
    limit: params.limit,
    status,
    kind,
    category,
  })
  return rows.map(mapRow)
}

export async function getForAdmin(id: number): Promise<PromptDto> {
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('prompt_not_found')
  return mapRow(row)
}

export async function createForAdmin(input: any, actorUserId: number): Promise<PromptDto> {
  if (!actorUserId) throw new ForbiddenError()

  const name = normalizeName(input?.name)
  const kind = normalizeKind(input?.kind)
  const headline = normalizeHeadline(input?.headline)
  const body = normalizeBody(input?.body)
  const ctaPrimaryLabel = String(normalizeLabel(input?.ctaPrimaryLabel ?? input?.cta_primary_label, 'cta_primary_label', true) || '')
  const ctaPrimaryHref = String(normalizeInternalHref(input?.ctaPrimaryHref ?? input?.cta_primary_href, 'cta_primary_href', true) || '')

  const ctaSecondaryLabel = normalizeLabel(input?.ctaSecondaryLabel ?? input?.cta_secondary_label, 'cta_secondary_label', false)
  const ctaSecondaryHref = normalizeInternalHref(input?.ctaSecondaryHref ?? input?.cta_secondary_href, 'cta_secondary_href', false)
  if ((ctaSecondaryLabel && !ctaSecondaryHref) || (!ctaSecondaryLabel && ctaSecondaryHref)) {
    throw new DomainError('invalid_secondary_cta', 'invalid_secondary_cta', 400)
  }

  const mediaUploadId = normalizeMediaUploadId(input?.mediaUploadId ?? input?.media_upload_id)
  const category = normalizeCategory(input?.category)
  const priority = normalizePriority(input?.priority, 100)
  const status = normalizeStatus(input?.status, 'draft')
  const { startsAt, endsAt } = normalizeDateWindow(input?.startsAt ?? input?.starts_at, input?.endsAt ?? input?.ends_at)

  const row = await repo.create({
    name,
    kind,
    headline,
    body,
    ctaPrimaryLabel,
    ctaPrimaryHref,
    ctaSecondaryLabel,
    ctaSecondaryHref,
    mediaUploadId,
    category,
    priority,
    status,
    startsAt,
    endsAt,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  })

  promptsLogger.info({ event: 'admin.prompts.create', prompt_id: row.id, user_id: actorUserId, app_operation: 'admin.prompts.write' }, 'admin.prompts.create')
  return mapRow(row)
}

export async function updateForAdmin(id: number, patch: any, actorUserId: number): Promise<PromptDto> {
  if (!actorUserId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('prompt_not_found')

  const nextName = patch?.name !== undefined ? normalizeName(patch.name) : existing.name
  const nextKind = patch?.kind !== undefined ? normalizeKind(patch.kind) : existing.kind
  const nextHeadline = patch?.headline !== undefined ? normalizeHeadline(patch.headline) : existing.headline
  const nextBody = patch?.body !== undefined ? normalizeBody(patch.body) : (existing.body == null ? null : String(existing.body))

  const primaryLabelInput = patch?.ctaPrimaryLabel ?? patch?.cta_primary_label
  const primaryHrefInput = patch?.ctaPrimaryHref ?? patch?.cta_primary_href
  const secondaryLabelInput = patch?.ctaSecondaryLabel ?? patch?.cta_secondary_label
  const secondaryHrefInput = patch?.ctaSecondaryHref ?? patch?.cta_secondary_href

  const nextCtaPrimaryLabel =
    patch?.ctaPrimaryLabel !== undefined || patch?.cta_primary_label !== undefined
      ? String(normalizeLabel(primaryLabelInput, 'cta_primary_label', true) || '')
      : String(existing.cta_primary_label)
  const nextCtaPrimaryHref =
    patch?.ctaPrimaryHref !== undefined || patch?.cta_primary_href !== undefined
      ? String(normalizeInternalHref(primaryHrefInput, 'cta_primary_href', true) || '')
      : String(existing.cta_primary_href)

  const nextCtaSecondaryLabel =
    patch?.ctaSecondaryLabel !== undefined || patch?.cta_secondary_label !== undefined
      ? normalizeLabel(secondaryLabelInput, 'cta_secondary_label', false)
      : (existing.cta_secondary_label == null ? null : String(existing.cta_secondary_label))
  const nextCtaSecondaryHref =
    patch?.ctaSecondaryHref !== undefined || patch?.cta_secondary_href !== undefined
      ? normalizeInternalHref(secondaryHrefInput, 'cta_secondary_href', false)
      : (existing.cta_secondary_href == null ? null : String(existing.cta_secondary_href))

  if ((nextCtaSecondaryLabel && !nextCtaSecondaryHref) || (!nextCtaSecondaryLabel && nextCtaSecondaryHref)) {
    throw new DomainError('invalid_secondary_cta', 'invalid_secondary_cta', 400)
  }

  const nextMediaUploadId =
    patch?.mediaUploadId !== undefined || patch?.media_upload_id !== undefined
      ? normalizeMediaUploadId(patch?.mediaUploadId ?? patch?.media_upload_id)
      : (existing.media_upload_id == null ? null : Number(existing.media_upload_id))

  const nextCategory = patch?.category !== undefined ? normalizeCategory(patch.category) : String(existing.category)
  const nextPriority = patch?.priority !== undefined ? normalizePriority(patch.priority, Number(existing.priority)) : Number(existing.priority)
  const nextStatus = patch?.status !== undefined ? normalizeStatus(patch.status, existing.status) : existing.status

  const startsAtRaw = patch?.startsAt ?? patch?.starts_at
  const endsAtRaw = patch?.endsAt ?? patch?.ends_at
  const nextStartsAt =
    patch?.startsAt !== undefined || patch?.starts_at !== undefined
      ? normalizeDateTime(startsAtRaw, 'starts_at')
      : (existing.starts_at == null ? null : String(existing.starts_at))
  const nextEndsAt =
    patch?.endsAt !== undefined || patch?.ends_at !== undefined
      ? normalizeDateTime(endsAtRaw, 'ends_at')
      : (existing.ends_at == null ? null : String(existing.ends_at))
  if (nextStartsAt && nextEndsAt && nextStartsAt > nextEndsAt) {
    throw new DomainError('invalid_date_window', 'invalid_date_window', 400)
  }

  const row = await repo.update(id, {
    name: nextName,
    kind: nextKind,
    headline: nextHeadline,
    body: nextBody,
    ctaPrimaryLabel: nextCtaPrimaryLabel,
    ctaPrimaryHref: nextCtaPrimaryHref,
    ctaSecondaryLabel: nextCtaSecondaryLabel,
    ctaSecondaryHref: nextCtaSecondaryHref,
    mediaUploadId: nextMediaUploadId,
    category: nextCategory,
    priority: nextPriority,
    status: nextStatus,
    startsAt: nextStartsAt,
    endsAt: nextEndsAt,
    updatedBy: actorUserId,
  })

  promptsLogger.info({ event: 'admin.prompts.update', prompt_id: id, user_id: actorUserId, app_operation: 'admin.prompts.write' }, 'admin.prompts.update')
  return mapRow(row)
}

export async function cloneForAdmin(id: number, actorUserId: number): Promise<PromptDto> {
  if (!actorUserId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('prompt_not_found')

  const row = await repo.create({
    name: `${String(existing.name || 'Prompt')} (Copy)`,
    kind: existing.kind,
    headline: existing.headline,
    body: existing.body == null ? null : String(existing.body),
    ctaPrimaryLabel: String(existing.cta_primary_label || ''),
    ctaPrimaryHref: String(existing.cta_primary_href || ''),
    ctaSecondaryLabel: existing.cta_secondary_label == null ? null : String(existing.cta_secondary_label),
    ctaSecondaryHref: existing.cta_secondary_href == null ? null : String(existing.cta_secondary_href),
    mediaUploadId: existing.media_upload_id == null ? null : Number(existing.media_upload_id),
    category: String(existing.category || ''),
    priority: Number(existing.priority || 100),
    status: 'draft',
    startsAt: existing.starts_at == null ? null : String(existing.starts_at),
    endsAt: existing.ends_at == null ? null : String(existing.ends_at),
    createdBy: actorUserId,
    updatedBy: actorUserId,
  })

  promptsLogger.info({ event: 'admin.prompts.clone', prompt_id: id, cloned_prompt_id: row.id, user_id: actorUserId, app_operation: 'admin.prompts.write' }, 'admin.prompts.clone')
  return mapRow(row)
}

export async function updateStatusForAdmin(id: number, statusRaw: any, actorUserId: number): Promise<PromptDto> {
  if (!actorUserId) throw new ForbiddenError()
  const status = normalizeStatus(statusRaw)
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('prompt_not_found')

  const row = await repo.update(id, {
    status,
    updatedBy: actorUserId,
  })

  promptsLogger.info({ event: 'admin.prompts.status', prompt_id: id, status, user_id: actorUserId, app_operation: 'admin.prompts.write' }, 'admin.prompts.status')
  return mapRow(row)
}

export async function listActiveForFeed(params?: {
  category?: any
  kind?: any
  limit?: number
}): Promise<PromptDto[]> {
  const category = params?.category == null || params?.category === '' ? null : normalizeCategory(params.category)
  const kind = params?.kind == null || params?.kind === '' ? null : normalizeKind(params.kind)
  const rows = await repo.listActiveForFeed({ category, kind, limit: params?.limit })
  return rows.map(mapRow)
}

export async function getActiveForFeedById(id: number): Promise<PromptDto> {
  const promptId = Number(id)
  if (!Number.isFinite(promptId) || promptId <= 0) throw new DomainError('bad_id', 'bad_id', 400)
  const row = await repo.getById(promptId)
  if (!row) throw new NotFoundError('prompt_not_found')
  if (row.status !== 'active') throw new NotFoundError('prompt_not_found')
  const now = Date.now()
  const startsAtMs = row.starts_at ? Date.parse(String(row.starts_at).replace(' ', 'T') + 'Z') : null
  const endsAtMs = row.ends_at ? Date.parse(String(row.ends_at).replace(' ', 'T') + 'Z') : null
  if (startsAtMs != null && Number.isFinite(startsAtMs) && startsAtMs > now) throw new NotFoundError('prompt_not_found')
  if (endsAtMs != null && Number.isFinite(endsAtMs) && endsAtMs < now) throw new NotFoundError('prompt_not_found')
  return mapRow(row)
}
