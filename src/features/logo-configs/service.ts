import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import type { LogoConfigDto, LogoConfigRow, LogoFade, LogoPosition, LogoTimingRule } from './types'

function mapRow(row: LogoConfigRow): LogoConfigDto {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    position: row.position,
    sizePctWidth: Number(row.size_pct_width),
    opacityPct: Number(row.opacity_pct),
    timingRule: row.timing_rule,
    timingSeconds: row.timing_seconds == null ? null : Number(row.timing_seconds),
    fade: row.fade,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
  }
}

function isEnumValue<T extends string>(value: any, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

const POSITIONS: readonly LogoPosition[] = ['top_left', 'top_right', 'bottom_left', 'bottom_right', 'center']
const TIMING_RULES: readonly LogoTimingRule[] = ['entire', 'start_after', 'first_only', 'last_only']
const FADES: readonly LogoFade[] = ['none', 'in', 'out', 'in_out']

function normalizeName(raw: any): string {
  const name = String(raw ?? '').trim()
  if (!name) throw new DomainError('invalid_name', 'invalid_name', 400)
  if (name.length > 120) throw new DomainError('invalid_name', 'invalid_name', 400)
  return name
}

function normalizePct(raw: any, code: string, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) throw new DomainError(code, code, 400)
  return Math.round(n)
}

function normalizeTimingSeconds(raw: any, rule: LogoTimingRule): number | null {
  if (rule === 'entire') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 3600) throw new DomainError('invalid_timing_seconds', 'invalid_timing_seconds', 400)
  return Math.round(n)
}

function ensureOwned(row: LogoConfigRow, userId: number) {
  const ownerId = Number(row.owner_user_id)
  if (ownerId !== Number(userId)) throw new ForbiddenError()
}

export async function listForUser(userId: number, params?: { includeArchived?: boolean; limit?: number }): Promise<LogoConfigDto[]> {
  if (!userId) throw new ForbiddenError()
  const rows = await repo.listByOwner(Number(userId), params)
  return rows.map(mapRow)
}

export async function getForUser(id: number, userId: number): Promise<LogoConfigDto> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  return mapRow(row)
}

export async function createForUser(input: {
  name: any
  position: any
  sizePctWidth: any
  opacityPct: any
  timingRule: any
  timingSeconds: any
  fade: any
}, userId: number): Promise<LogoConfigDto> {
  if (!userId) throw new ForbiddenError()
  const name = normalizeName(input.name)
  if (!isEnumValue(input.position, POSITIONS)) throw new DomainError('invalid_position', 'invalid_position', 400)
  const position = input.position
  const sizePctWidth = normalizePct(input.sizePctWidth, 'invalid_size', 1, 100)
  const opacityPct = normalizePct(input.opacityPct, 'invalid_opacity', 0, 100)
  if (!isEnumValue(input.timingRule, TIMING_RULES)) throw new DomainError('invalid_timing_rule', 'invalid_timing_rule', 400)
  const timingRule = input.timingRule
  const timingSeconds = normalizeTimingSeconds(input.timingSeconds, timingRule)
  if (!isEnumValue(input.fade, FADES)) throw new DomainError('invalid_fade', 'invalid_fade', 400)
  const fade = input.fade

  const row = await repo.create({
    ownerUserId: Number(userId),
    name,
    position,
    sizePctWidth,
    opacityPct,
    timingRule,
    timingSeconds,
    fade,
  })
  return mapRow(row)
}

export async function updateForUser(
  id: number,
  patch: {
    name?: any
    position?: any
    sizePctWidth?: any
    opacityPct?: any
    timingRule?: any
    timingSeconds?: any
    fade?: any
  },
  userId: number
): Promise<LogoConfigDto> {
  if (!userId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('not_found')
  ensureOwned(existing, userId)

  const next: any = {
    name: patch.name !== undefined ? normalizeName(patch.name) : String(existing.name || ''),
    position: patch.position !== undefined ? patch.position : existing.position,
    sizePctWidth: patch.sizePctWidth !== undefined ? patch.sizePctWidth : existing.size_pct_width,
    opacityPct: patch.opacityPct !== undefined ? patch.opacityPct : existing.opacity_pct,
    timingRule: patch.timingRule !== undefined ? patch.timingRule : existing.timing_rule,
    timingSeconds: patch.timingSeconds !== undefined ? patch.timingSeconds : existing.timing_seconds,
    fade: patch.fade !== undefined ? patch.fade : existing.fade,
  }

  if (!isEnumValue(next.position, POSITIONS)) throw new DomainError('invalid_position', 'invalid_position', 400)
  const sizePctWidth = normalizePct(next.sizePctWidth, 'invalid_size', 1, 100)
  const opacityPct = normalizePct(next.opacityPct, 'invalid_opacity', 0, 100)
  if (!isEnumValue(next.timingRule, TIMING_RULES)) throw new DomainError('invalid_timing_rule', 'invalid_timing_rule', 400)
  const timingSeconds = normalizeTimingSeconds(next.timingSeconds, next.timingRule)
  if (!isEnumValue(next.fade, FADES)) throw new DomainError('invalid_fade', 'invalid_fade', 400)

  const row = await repo.update(id, {
    name: next.name,
    position: next.position,
    sizePctWidth,
    opacityPct,
    timingRule: next.timingRule,
    timingSeconds,
    fade: next.fade,
  })
  return mapRow(row)
}

export async function duplicateForUser(id: number, userId: number): Promise<LogoConfigDto> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  if (row.archived_at) throw new DomainError('archived', 'archived', 400)

  const baseName = String(row.name || '').trim() || 'Logo config'
  const pref = `Copy of ${baseName}`
  const name = pref.length > 120 ? pref.slice(0, 120).trim() : pref
  const created = await repo.create({
    ownerUserId: Number(userId),
    name,
    position: row.position,
    sizePctWidth: Number(row.size_pct_width),
    opacityPct: Number(row.opacity_pct),
    timingRule: row.timing_rule,
    timingSeconds: row.timing_seconds == null ? null : Number(row.timing_seconds),
    fade: row.fade,
  })
  return mapRow(created)
}

export async function archiveForUser(id: number, userId: number): Promise<{ ok: true }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  await repo.archive(id)
  return { ok: true }
}

export async function ensureDefaultForUser(userId: number): Promise<{ created: boolean }> {
  if (!userId) throw new ForbiddenError()
  return repo.ensureDefaultForOwner(Number(userId))
}

export async function getActiveForUser(id: number, userId: number): Promise<LogoConfigDto> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  if (row.archived_at) throw new DomainError('archived', 'archived', 400)
  return mapRow(row)
}
