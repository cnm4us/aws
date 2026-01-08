import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import type { InsetPreset, ScreenTitleFade, ScreenTitleFontKey, ScreenTitlePosition, ScreenTitlePresetDto, ScreenTitlePresetRow, ScreenTitleStyle, ScreenTitleTimingRule } from './types'

const INSET_PRESETS: readonly InsetPreset[] = ['small', 'medium', 'large']
const STYLES: readonly ScreenTitleStyle[] = ['pill', 'outline', 'strip']
const FONT_KEYS: readonly ScreenTitleFontKey[] = ['dejavu_sans_bold']
const POSITIONS: readonly ScreenTitlePosition[] = ['top', 'middle', 'bottom']
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
  const fontSizePctRaw = (row as any).font_size_pct != null ? Number((row as any).font_size_pct) : 4.5
  const fontSizePct = Number.isFinite(fontSizePctRaw) ? fontSizePctRaw : 4.5
  const fontColor = String((row as any).font_color || '#ffffff').trim() || '#ffffff'
  const pillBgColor = String((row as any).pill_bg_color || '#000000').trim() || '#000000'
  const pillBgOpacityPctRaw = (row as any).pill_bg_opacity_pct != null ? Number((row as any).pill_bg_opacity_pct) : 55
  const pillBgOpacityPct = Number.isFinite(pillBgOpacityPctRaw) ? pillBgOpacityPctRaw : 55
  const posRaw = String((row as any).position || 'top').trim().toLowerCase()
  const position: ScreenTitlePosition =
    posRaw === 'middle' || posRaw === 'center' || posRaw === 'middle_center'
      ? 'middle'
      : posRaw === 'bottom' || posRaw.startsWith('bottom_')
        ? 'bottom'
        : 'top'
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: row.description == null ? null : String(row.description),
    style: row.style,
    fontKey,
    fontSizePct,
    fontColor,
    pillBgColor,
    pillBgOpacityPct,
    position,
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

function normalizeFontSizePct(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 4.5
  const clamped = Math.min(Math.max(n, 2), 8)
  return Math.round(clamped * 10) / 10
}

function normalizeFontColor(raw: any): string {
  const s = String(raw ?? '').trim()
  if (!s) return '#ffffff'
  const m = s.match(/^#([0-9a-fA-F]{6})$/)
  if (!m) throw new DomainError('invalid_font_color', 'invalid_font_color', 400)
  return `#${m[1].toLowerCase()}`
}

function normalizePillBgColor(raw: any): string {
  const s = String(raw ?? '').trim()
  if (!s) return '#000000'
  const m = s.match(/^#([0-9a-fA-F]{6})$/)
  if (!m) throw new DomainError('invalid_pill_bg_color', 'invalid_pill_bg_color', 400)
  return `#${m[1].toLowerCase()}`
}

function normalizeOpacityPct(raw: any, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(Math.max(n, 0), 100))
}

function positionAxes(pos: ScreenTitlePosition): { x: 'center'; y: 'top' | 'middle' | 'bottom' } {
  const y: 'top' | 'middle' | 'bottom' = pos === 'bottom' ? 'bottom' : pos === 'middle' ? 'middle' : 'top'
  return { x: 'center', y }
}

function coerceInsetsForPosition(pos: ScreenTitlePosition, insetXPreset: InsetPreset | null, insetYPreset: InsetPreset | null) {
  // Keep values as-is; UI controls visibility by position (top/bottom vs middle),
  // and rendering treats inset X as symmetric safe area.
  return { insetXPreset, insetYPreset }
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
  fontSizePct?: any
  fontColor?: any
  pillBgColor?: any
  pillBgOpacityPct?: any
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
  const fontSizePct = normalizeFontSizePct(input.fontSizePct)
  const fontColor = normalizeFontColor(input.fontColor)
  const pillBgColor = normalizePillBgColor(input.pillBgColor)
  const pillBgOpacityPct = normalizeOpacityPct(input.pillBgOpacityPct, 55)
  const position: ScreenTitlePosition = isEnumValue(input.position, POSITIONS) ? input.position : 'top'
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
    fontSizePct,
    fontColor,
    pillBgColor: style === 'pill' ? pillBgColor : '#000000',
    pillBgOpacityPct: style === 'pill' ? pillBgOpacityPct : 55,
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
    fontSizePct?: any
    fontColor?: any
    pillBgColor?: any
    pillBgOpacityPct?: any
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
    fontSizePct: patch.fontSizePct !== undefined ? patch.fontSizePct : (existing as any).font_size_pct,
    fontColor: patch.fontColor !== undefined ? patch.fontColor : (existing as any).font_color,
    pillBgColor: patch.pillBgColor !== undefined ? patch.pillBgColor : (existing as any).pill_bg_color,
    pillBgOpacityPct: patch.pillBgOpacityPct !== undefined ? patch.pillBgOpacityPct : (existing as any).pill_bg_opacity_pct,
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
  const fontSizePct = normalizeFontSizePct(next.fontSizePct)
  const fontColor = normalizeFontColor(next.fontColor)
  const pillBgColor = normalizePillBgColor(next.pillBgColor)
  const pillBgOpacityPct = normalizeOpacityPct(next.pillBgOpacityPct, 55)
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
    fontSizePct,
    fontColor,
    pillBgColor: next.style === 'pill' ? pillBgColor : '#000000',
    pillBgOpacityPct: next.style === 'pill' ? pillBgOpacityPct : 55,
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
