import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import type { InsetPreset, LogoConfigDto, LogoConfigRow, LogoFade, LogoPosition, LogoTimingRule } from './types'

const INSET_PRESETS: readonly InsetPreset[] = ['small', 'medium', 'large']

function toInsetPresetOrNull(raw: any): InsetPreset | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  if ((INSET_PRESETS as readonly string[]).includes(s)) return s as InsetPreset
  return null
}

function mapRow(row: LogoConfigRow): LogoConfigDto {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: (row as any).description == null ? null : String((row as any).description),
    position: row.position,
    sizePctWidth: Number(row.size_pct_width),
    opacityPct: Number(row.opacity_pct),
    timingRule: row.timing_rule,
    timingSeconds: row.timing_seconds == null ? null : Number(row.timing_seconds),
    fade: row.fade,
    insetXPreset: toInsetPresetOrNull((row as any).inset_x_preset),
    insetYPreset: toInsetPresetOrNull((row as any).inset_y_preset),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
  }
}

function isEnumValue<T extends string>(value: any, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

const POSITIONS: readonly LogoPosition[] = [
  'top_left', 'top_center', 'top_right',
  'middle_left', 'middle_center', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right',
  // Legacy alias; will be normalized in DB.
  'center',
]
const TIMING_RULES: readonly LogoTimingRule[] = ['entire', 'start_after', 'first_only', 'last_only']
const FADES: readonly LogoFade[] = ['none', 'in', 'out', 'in_out']

function normalizeName(raw: any): string {
  const name = String(raw ?? '').trim()
  if (!name) throw new DomainError('invalid_name', 'invalid_name', 400)
  if (name.length > 120) throw new DomainError('invalid_name', 'invalid_name', 400)
  return name
}

function normalizeDescription(raw: any): string | null {
  const description = String(raw ?? '').trim()
  if (!description) return null
  if (description.length > 2000) throw new DomainError('invalid_description', 'invalid_description', 400)
  return description
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

function normalizeInsetPreset(raw: any): InsetPreset | null {
  if (raw == null || raw === '') return null
  if (!isEnumValue(raw, INSET_PRESETS)) throw new DomainError('invalid_inset_preset', 'invalid_inset_preset', 400)
  return raw
}

function normalizeLegacyPosition(p: LogoPosition): Exclude<LogoPosition, 'center'> {
  return (p === 'center' ? 'middle_center' : p) as any
}

function positionAxes(posRaw: LogoPosition): { x: 'left' | 'center' | 'right'; y: 'top' | 'middle' | 'bottom' } {
  const pos = normalizeLegacyPosition(posRaw)
  const [row, col] = String(pos).split('_') as [string, string]
  const y = row === 'top' ? 'top' : row === 'bottom' ? 'bottom' : 'middle'
  const x = col === 'left' ? 'left' : col === 'right' ? 'right' : 'center'
  return { x, y }
}

function coerceInsetsForPosition(posRaw: LogoPosition, insetXPreset: InsetPreset | null, insetYPreset: InsetPreset | null) {
  const { x, y } = positionAxes(posRaw)
  const xPreset = x === 'center' ? null : (insetXPreset ?? 'medium')
  const yPreset = y === 'middle' ? null : (insetYPreset ?? 'medium')
  return { insetXPreset: xPreset, insetYPreset: yPreset }
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
  description?: any
  position: any
  sizePctWidth: any
  opacityPct: any
  timingRule: any
  timingSeconds: any
  fade: any
  insetXPreset?: any
  insetYPreset?: any
}, userId: number): Promise<LogoConfigDto> {
  if (!userId) throw new ForbiddenError()
  const name = normalizeName(input.name)
  const description = normalizeDescription(input.description)
  if (!isEnumValue(input.position, POSITIONS)) throw new DomainError('invalid_position', 'invalid_position', 400)
  const position = input.position
  const sizePctWidth = normalizePct(input.sizePctWidth, 'invalid_size', 1, 100)
  const opacityPct = normalizePct(input.opacityPct, 'invalid_opacity', 0, 100)
  if (!isEnumValue(input.timingRule, TIMING_RULES)) throw new DomainError('invalid_timing_rule', 'invalid_timing_rule', 400)
  const timingRule = input.timingRule
  const timingSeconds = normalizeTimingSeconds(input.timingSeconds, timingRule)
  if (!isEnumValue(input.fade, FADES)) throw new DomainError('invalid_fade', 'invalid_fade', 400)
  const fade = input.fade
  const rawInsetX = normalizeInsetPreset(input.insetXPreset)
  const rawInsetY = normalizeInsetPreset(input.insetYPreset)
  const coerced = coerceInsetsForPosition(position, rawInsetX, rawInsetY)

  const row = await repo.create({
    ownerUserId: Number(userId),
    name,
    description,
    position: normalizeLegacyPosition(position),
    sizePctWidth,
    opacityPct,
    timingRule,
    timingSeconds,
    fade,
    insetXPreset: coerced.insetXPreset,
    insetYPreset: coerced.insetYPreset,
  })
  return mapRow(row)
}

export async function updateForUser(
  id: number,
  patch: {
    name?: any
    description?: any
    position?: any
    sizePctWidth?: any
    opacityPct?: any
    timingRule?: any
    timingSeconds?: any
    fade?: any
    insetXPreset?: any
    insetYPreset?: any
  },
  userId: number
): Promise<LogoConfigDto> {
  if (!userId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('not_found')
  ensureOwned(existing, userId)

  const next: any = {
    name: patch.name !== undefined ? normalizeName(patch.name) : String(existing.name || ''),
    description: patch.description !== undefined ? normalizeDescription(patch.description) : ((existing as any).description == null ? null : String((existing as any).description)),
    position: patch.position !== undefined ? patch.position : existing.position,
    sizePctWidth: patch.sizePctWidth !== undefined ? patch.sizePctWidth : existing.size_pct_width,
    opacityPct: patch.opacityPct !== undefined ? patch.opacityPct : existing.opacity_pct,
    timingRule: patch.timingRule !== undefined ? patch.timingRule : existing.timing_rule,
    timingSeconds: patch.timingSeconds !== undefined ? patch.timingSeconds : existing.timing_seconds,
    fade: patch.fade !== undefined ? patch.fade : existing.fade,
    insetXPreset: patch.insetXPreset !== undefined ? patch.insetXPreset : (existing as any).inset_x_preset,
    insetYPreset: patch.insetYPreset !== undefined ? patch.insetYPreset : (existing as any).inset_y_preset,
  }

  if (!isEnumValue(next.position, POSITIONS)) throw new DomainError('invalid_position', 'invalid_position', 400)
  const normalizedPosition = normalizeLegacyPosition(next.position)
  const sizePctWidth = normalizePct(next.sizePctWidth, 'invalid_size', 1, 100)
  const opacityPct = normalizePct(next.opacityPct, 'invalid_opacity', 0, 100)
  if (!isEnumValue(next.timingRule, TIMING_RULES)) throw new DomainError('invalid_timing_rule', 'invalid_timing_rule', 400)
  const timingSeconds = normalizeTimingSeconds(next.timingSeconds, next.timingRule)
  if (!isEnumValue(next.fade, FADES)) throw new DomainError('invalid_fade', 'invalid_fade', 400)
  const rawInsetX = normalizeInsetPreset(next.insetXPreset)
  const rawInsetY = normalizeInsetPreset(next.insetYPreset)
  const coerced = coerceInsetsForPosition(normalizedPosition, rawInsetX, rawInsetY)

  const row = await repo.update(id, {
    name: next.name,
    description: next.description,
    position: normalizedPosition,
    sizePctWidth,
    opacityPct,
    timingRule: next.timingRule,
    timingSeconds,
    fade: next.fade,
    insetXPreset: coerced.insetXPreset,
    insetYPreset: coerced.insetYPreset,
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
  const description = (row as any).description == null ? null : String((row as any).description)
  const created = await repo.create({
    ownerUserId: Number(userId),
    name,
    description,
    position: normalizeLegacyPosition(row.position),
    sizePctWidth: Number(row.size_pct_width),
    opacityPct: Number(row.opacity_pct),
    timingRule: row.timing_rule,
    timingSeconds: row.timing_seconds == null ? null : Number(row.timing_seconds),
    fade: row.fade,
    insetXPreset: (row as any).inset_x_preset != null ? (String((row as any).inset_x_preset) as any) : null,
    insetYPreset: (row as any).inset_y_preset != null ? (String((row as any).inset_y_preset) as any) : null,
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
