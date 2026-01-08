import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import type { InsetPreset, ScreenTitleFade, ScreenTitleFontKey, ScreenTitlePosition, ScreenTitlePresetDto, ScreenTitlePresetRow, ScreenTitleStyle, ScreenTitleTimingRule } from './types'

const INSET_PRESETS: readonly InsetPreset[] = ['small', 'medium', 'large']
const STYLES: readonly ScreenTitleStyle[] = ['pill', 'outline', 'strip']
const FONT_KEYS: readonly ScreenTitleFontKey[] = ['dejavu_sans_bold']
const POSITIONS: readonly ScreenTitlePosition[] = ['top_left', 'top_center', 'top_right']
const TIMING_RULES: readonly ScreenTitleTimingRule[] = ['entire', 'first_only']
const FADES: readonly ScreenTitleFade[] = ['none', 'in', 'out', 'in_out']

function isEnumValue<T extends string>(value: any, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function toInsetPresetOrNull(raw: any): InsetPreset | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  if ((INSET_PRESETS as readonly string[]).includes(s)) return s as InsetPreset
  return null
}

function mapRow(row: ScreenTitlePresetRow): ScreenTitlePresetDto {
  const rawFont = String((row as any).font_key || 'dejavu_sans_bold').trim() as any
  const fontKey: ScreenTitleFontKey = isEnumValue(rawFont, FONT_KEYS) ? rawFont : 'dejavu_sans_bold'
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: row.description == null ? null : String(row.description),
    style: row.style,
    fontKey,
    position: row.position,
    maxWidthPct: Number((row as any).max_width_pct),
    insetXPreset: toInsetPresetOrNull((row as any).inset_x_preset),
    insetYPreset: toInsetPresetOrNull((row as any).inset_y_preset),
    timingRule: row.timing_rule,
    timingSeconds: row.timing_seconds == null ? null : Number(row.timing_seconds),
    fade: row.fade,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
  }
}

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

function normalizeTimingSeconds(raw: any, rule: ScreenTitleTimingRule): number | null {
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

function positionAxes(pos: ScreenTitlePosition): { x: 'left' | 'center' | 'right'; y: 'top' } {
  const [row, col] = String(pos).split('_') as [string, string]
  const x = col === 'left' ? 'left' : col === 'right' ? 'right' : 'center'
  // Only top_* in MVP
  return { x, y: row === 'top' ? 'top' : 'top' }
}

function coerceInsetsForPosition(pos: ScreenTitlePosition, insetXPreset: InsetPreset | null, insetYPreset: InsetPreset | null) {
  const { x } = positionAxes(pos)
  const xPreset = x === 'center' ? null : (insetXPreset ?? 'medium')
  const yPreset = insetYPreset ?? 'medium'
  return { insetXPreset: xPreset, insetYPreset: yPreset }
}

function ensureOwned(row: ScreenTitlePresetRow, userId: number) {
  const ownerId = Number((row as any).owner_user_id)
  if (ownerId !== Number(userId)) throw new ForbiddenError()
}

export async function listForUser(userId: number, params?: { includeArchived?: boolean; limit?: number }): Promise<ScreenTitlePresetDto[]> {
  if (!userId) throw new ForbiddenError()
  const rows = await repo.listByOwner(Number(userId), params)
  return rows.map(mapRow)
}

export async function getForUser(id: number, userId: number): Promise<ScreenTitlePresetDto> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  return mapRow(row)
}

export async function createForUser(input: {
  name: any
  description?: any
  style?: any
  fontKey?: any
  position?: any
  maxWidthPct?: any
  insetXPreset?: any
  insetYPreset?: any
  timingRule?: any
  timingSeconds?: any
  fade?: any
}, userId: number): Promise<ScreenTitlePresetDto> {
  if (!userId) throw new ForbiddenError()
  const name = normalizeName(input.name)
  const description = normalizeDescription(input.description)
  const style: ScreenTitleStyle = isEnumValue(input.style, STYLES) ? input.style : 'pill'
  const fontKey: ScreenTitleFontKey = isEnumValue(input.fontKey, FONT_KEYS) ? input.fontKey : 'dejavu_sans_bold'
  const position: ScreenTitlePosition = isEnumValue(input.position, POSITIONS) ? input.position : 'top_left'
  const maxWidthPct = normalizePct(input.maxWidthPct ?? 90, 'invalid_max_width', 10, 100)
  const rawInsetX = normalizeInsetPreset(input.insetXPreset)
  const rawInsetY = normalizeInsetPreset(input.insetYPreset)
  const coerced = coerceInsetsForPosition(position, rawInsetX, rawInsetY)
  const timingRule: ScreenTitleTimingRule = isEnumValue(input.timingRule, TIMING_RULES) ? input.timingRule : 'first_only'
  const timingSeconds = normalizeTimingSeconds(input.timingSeconds ?? 10, timingRule)
  const fade: ScreenTitleFade = isEnumValue(input.fade, FADES) ? input.fade : 'out'

  const row = await repo.create({
    ownerUserId: Number(userId),
    name,
    description,
    style,
    fontKey,
    position,
    maxWidthPct,
    insetXPreset: coerced.insetXPreset,
    insetYPreset: coerced.insetYPreset,
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
    description?: any
    style?: any
    fontKey?: any
    position?: any
    maxWidthPct?: any
    insetXPreset?: any
    insetYPreset?: any
    timingRule?: any
    timingSeconds?: any
    fade?: any
  },
  userId: number
): Promise<ScreenTitlePresetDto> {
  if (!userId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('not_found')
  ensureOwned(existing, userId)

  const next: any = {
    name: patch.name !== undefined ? normalizeName(patch.name) : String(existing.name || ''),
    description: patch.description !== undefined ? normalizeDescription(patch.description) : (existing.description == null ? null : String(existing.description)),
    style: patch.style !== undefined ? patch.style : existing.style,
    fontKey: patch.fontKey !== undefined ? patch.fontKey : (existing as any).font_key,
    position: patch.position !== undefined ? patch.position : existing.position,
    maxWidthPct: patch.maxWidthPct !== undefined ? patch.maxWidthPct : (existing as any).max_width_pct,
    insetXPreset: patch.insetXPreset !== undefined ? patch.insetXPreset : (existing as any).inset_x_preset,
    insetYPreset: patch.insetYPreset !== undefined ? patch.insetYPreset : (existing as any).inset_y_preset,
    timingRule: patch.timingRule !== undefined ? patch.timingRule : existing.timing_rule,
    timingSeconds: patch.timingSeconds !== undefined ? patch.timingSeconds : existing.timing_seconds,
    fade: patch.fade !== undefined ? patch.fade : existing.fade,
  }

  if (!isEnumValue(next.style, STYLES)) throw new DomainError('invalid_style', 'invalid_style', 400)
  if (!isEnumValue(next.fontKey, FONT_KEYS)) throw new DomainError('invalid_font', 'invalid_font', 400)
  if (!isEnumValue(next.position, POSITIONS)) throw new DomainError('invalid_position', 'invalid_position', 400)
  const maxWidthPct = normalizePct(next.maxWidthPct, 'invalid_max_width', 10, 100)
  const rawInsetX = normalizeInsetPreset(next.insetXPreset)
  const rawInsetY = normalizeInsetPreset(next.insetYPreset)
  const coerced = coerceInsetsForPosition(next.position, rawInsetX, rawInsetY)
  if (!isEnumValue(next.timingRule, TIMING_RULES)) throw new DomainError('invalid_timing_rule', 'invalid_timing_rule', 400)
  const timingSeconds = normalizeTimingSeconds(next.timingSeconds ?? 10, next.timingRule)
  if (!isEnumValue(next.fade, FADES)) throw new DomainError('invalid_fade', 'invalid_fade', 400)

  const row = await repo.update(id, {
    name: next.name,
    description: next.description,
    style: next.style,
    fontKey: next.fontKey,
    position: next.position,
    maxWidthPct,
    insetXPreset: coerced.insetXPreset,
    insetYPreset: coerced.insetYPreset,
    timingRule: next.timingRule,
    timingSeconds,
    fade: next.fade,
  })
  return mapRow(row)
}

export async function archiveForUser(id: number, userId: number): Promise<{ ok: true }> {
  if (!userId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('not_found')
  ensureOwned(existing, userId)
  await repo.archive(id)
  return { ok: true }
}

export async function getActiveForUser(id: number, userId: number): Promise<ScreenTitlePresetDto> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  if ((row as any).archived_at) throw new DomainError('archived', 'archived', 400)
  return mapRow(row)
}
