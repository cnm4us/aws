import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import type { InsetPreset, ScreenTitleAlignment, ScreenTitleFade, ScreenTitleFontKey, ScreenTitlePosition, ScreenTitlePresetDto, ScreenTitlePresetRow, ScreenTitleStyle, ScreenTitleTimingRule } from './types'
import { isFontKeyAllowed } from '../../services/fonts/screenTitleFonts'
import { isGradientKeyAllowed } from '../../services/fonts/screenTitleGradients'

const INSET_PRESETS: readonly InsetPreset[] = ['small', 'medium', 'large']
const STYLES: readonly ScreenTitleStyle[] = ['none', 'pill', 'strip']
const ALIGNMENTS: readonly ScreenTitleAlignment[] = ['left', 'center', 'right']
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

function insetPresetToMarginPct(preset: InsetPreset | null): number {
  if (preset === 'small') return 6
  if (preset === 'large') return 14
  return 10
}

function toNumberOrNull(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function mapRow(row: ScreenTitlePresetRow): ScreenTitlePresetDto {
  const rawFont = String((row as any).font_key || 'dejavu_sans_bold').trim()
  const fontKey: ScreenTitleFontKey = rawFont && isFontKeyAllowed(rawFont) ? rawFont : 'dejavu_sans_bold'
  const alignmentRaw = String((row as any).alignment || 'center').trim().toLowerCase()
  const alignment: ScreenTitleAlignment = isEnumValue(alignmentRaw, ALIGNMENTS) ? (alignmentRaw as any) : 'center'
  const fontSizePctRaw = (row as any).font_size_pct != null ? Number((row as any).font_size_pct) : 4.5
  const fontSizePct = Number.isFinite(fontSizePctRaw) ? fontSizePctRaw : 4.5
  const trackingPctRaw = (row as any).tracking_pct != null ? Number((row as any).tracking_pct) : 0
  const trackingPct = Number.isFinite(trackingPctRaw) ? Math.round(Math.min(Math.max(trackingPctRaw, -20), 50)) : 0
  const fontColor = String((row as any).font_color || '#ffffff').trim() || '#ffffff'
  const gradientRaw = (row as any).font_gradient_key
  const fontGradientKey = gradientRaw == null ? null : String(gradientRaw).trim() || null
  const outlineWidthPctRaw = (row as any).outline_width_pct
  const outlineWidthPct = outlineWidthPctRaw == null ? null : Number(outlineWidthPctRaw)
  const outlineOpacityPctRaw = (row as any).outline_opacity_pct
  const outlineOpacityPct = outlineOpacityPctRaw == null ? null : Number(outlineOpacityPctRaw)
  const outlineColorRaw = (row as any).outline_color
  const outlineColor = outlineColorRaw == null ? null : String(outlineColorRaw).trim() || null
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

  const insetXPreset = toInsetPresetOrNull((row as any).inset_x_preset)
  const insetYPreset = toInsetPresetOrNull((row as any).inset_y_preset)
  const marginLeftPctRaw = toNumberOrNull((row as any).margin_left_pct)
  const marginRightPctRaw = toNumberOrNull((row as any).margin_right_pct)
  const marginTopPctRaw = toNumberOrNull((row as any).margin_top_pct)
  const marginBottomPctRaw = toNumberOrNull((row as any).margin_bottom_pct)

  const marginLeftPct = marginLeftPctRaw == null ? insetPresetToMarginPct(insetXPreset) : marginLeftPctRaw
  const marginRightPct = marginRightPctRaw == null ? insetPresetToMarginPct(insetXPreset) : marginRightPctRaw
  const marginTopPct = marginTopPctRaw == null ? insetPresetToMarginPct(insetYPreset) : marginTopPctRaw
  const marginBottomPct = marginBottomPctRaw == null ? insetPresetToMarginPct(insetYPreset) : marginBottomPctRaw

  const styleRaw = String((row as any).style || 'pill').trim().toLowerCase()
  const style: ScreenTitleStyle =
    styleRaw === 'strip' ? 'strip' : styleRaw === 'none' ? 'none' : styleRaw === 'outline' ? 'none' : 'pill'

  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: row.description == null ? null : String(row.description),
    style,
    fontKey,
    fontSizePct,
    trackingPct,
    fontColor,
    fontGradientKey,
    outlineWidthPct: outlineWidthPct != null && Number.isFinite(outlineWidthPct) ? outlineWidthPct : null,
    outlineOpacityPct: outlineOpacityPct != null && Number.isFinite(outlineOpacityPct) ? Math.round(Math.min(Math.max(outlineOpacityPct, 0), 100)) : null,
    outlineColor,
    pillBgColor,
    pillBgOpacityPct,
    alignment,
    position,
    maxWidthPct: Number((row as any).max_width_pct),
    insetXPreset,
    insetYPreset,
    marginLeftPct: Number.isFinite(marginLeftPct) ? marginLeftPct : null,
    marginRightPct: Number.isFinite(marginRightPct) ? marginRightPct : null,
    marginTopPct: Number.isFinite(marginTopPct) ? marginTopPct : null,
    marginBottomPct: Number.isFinite(marginBottomPct) ? marginBottomPct : null,
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

function normalizeTrackingPct(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  const clamped = Math.min(Math.max(n, -20), 50)
  return Math.round(clamped)
}

function normalizeFontKey(raw: any): ScreenTitleFontKey {
  const s = String(raw ?? '').trim()
  if (!s) return 'dejavu_sans_bold'
  if (!isFontKeyAllowed(s)) throw new DomainError('invalid_font', 'invalid_font', 400)
  return s
}

function normalizeFontGradientKey(raw: any): string | null {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  if (!s) return null
  if (!isGradientKeyAllowed(s)) throw new DomainError('invalid_font_gradient', 'invalid_font_gradient', 400)
  return s
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

function normalizeOptionalOpacityPct(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new DomainError('invalid_outline_opacity', 'invalid_outline_opacity', 400)
  return Math.round(Math.min(Math.max(n, 0), 100))
}

function normalizeOutlineWidthPct(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 20) throw new DomainError('invalid_outline_width', 'invalid_outline_width', 400)
  return Math.round(n * 100) / 100
}

function normalizeOutlineColor(raw: any): string | null {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  if (!s) return null
  if (s.toLowerCase() === 'auto') return null
  const m = s.match(/^#([0-9a-fA-F]{6})$/)
  if (!m) throw new DomainError('invalid_outline_color', 'invalid_outline_color', 400)
  return `#${m[1].toLowerCase()}`
}

function normalizeMarginPct(raw: any, code: string): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 40) throw new DomainError(code, code, 400)
  return Math.round(n * 100) / 100
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
  fontGradientKey?: any
  fontSizePct?: any
  trackingPct?: any
  fontColor?: any
  outlineWidthPct?: any
  outlineOpacityPct?: any
  outlineColor?: any
  marginLeftPct?: any
  marginRightPct?: any
  marginTopPct?: any
  marginBottomPct?: any
  pillBgColor?: any
  pillBgOpacityPct?: any
  alignment?: any
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
  const styleRaw = typeof input.style === 'string' ? String(input.style).trim().toLowerCase() : ''
  const style: ScreenTitleStyle =
    isEnumValue(styleRaw, STYLES) ? (styleRaw as any) : (styleRaw === 'outline' ? 'none' : 'pill')
  const fontKey: ScreenTitleFontKey = normalizeFontKey(input.fontKey)
  const fontSizePct = normalizeFontSizePct(input.fontSizePct)
  const trackingPct = normalizeTrackingPct(input.trackingPct)
  const fontColor = normalizeFontColor(input.fontColor)
  const fontGradientKey = normalizeFontGradientKey((input as any).fontGradientKey)
  const outlineWidthPct = normalizeOutlineWidthPct((input as any).outlineWidthPct)
  const outlineOpacityPct = normalizeOptionalOpacityPct((input as any).outlineOpacityPct)
  const outlineColor = normalizeOutlineColor((input as any).outlineColor)
  const marginLeftPct = normalizeMarginPct((input as any).marginLeftPct, 'invalid_margin_left')
  const marginRightPct = normalizeMarginPct((input as any).marginRightPct, 'invalid_margin_right')
  const marginTopPct = normalizeMarginPct((input as any).marginTopPct, 'invalid_margin_top')
  const marginBottomPct = normalizeMarginPct((input as any).marginBottomPct, 'invalid_margin_bottom')
  const pillBgColor = normalizePillBgColor(input.pillBgColor)
  const pillBgOpacityPct = normalizeOpacityPct(input.pillBgOpacityPct, 55)
  const alignment: ScreenTitleAlignment = isEnumValue(input.alignment, ALIGNMENTS) ? input.alignment : 'center'
  const position: ScreenTitlePosition = isEnumValue(input.position, POSITIONS) ? input.position : 'top'
  const derivedMaxWidthPct = (() => {
    if (marginLeftPct == null || marginRightPct == null) return 90
    const w = 100 - marginLeftPct - marginRightPct
    if (!Number.isFinite(w)) return 90
    return Math.round(Math.min(Math.max(w, 10), 100))
  })()
  const maxWidthPct = normalizePct(input.maxWidthPct ?? derivedMaxWidthPct, 'invalid_max_width', 10, 100)
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
    trackingPct,
    fontColor,
    fontGradientKey,
    outlineWidthPct,
    outlineOpacityPct,
    outlineColor,
    marginLeftPct,
    marginRightPct,
    marginTopPct,
    marginBottomPct,
    pillBgColor: style === 'pill' || style === 'strip' ? pillBgColor : '#000000',
    pillBgOpacityPct: style === 'pill' || style === 'strip' ? pillBgOpacityPct : 55,
    alignment,
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
    fontGradientKey?: any
    fontSizePct?: any
    trackingPct?: any
    fontColor?: any
    outlineWidthPct?: any
    outlineOpacityPct?: any
    outlineColor?: any
    marginLeftPct?: any
    marginRightPct?: any
    marginTopPct?: any
    marginBottomPct?: any
    pillBgColor?: any
    pillBgOpacityPct?: any
    alignment?: any
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
    trackingPct: patch.trackingPct !== undefined ? patch.trackingPct : (existing as any).tracking_pct,
    fontColor: patch.fontColor !== undefined ? patch.fontColor : (existing as any).font_color,
    fontGradientKey: patch.fontGradientKey !== undefined ? patch.fontGradientKey : (existing as any).font_gradient_key,
    outlineWidthPct: patch.outlineWidthPct !== undefined ? patch.outlineWidthPct : (existing as any).outline_width_pct,
    outlineOpacityPct: patch.outlineOpacityPct !== undefined ? patch.outlineOpacityPct : (existing as any).outline_opacity_pct,
    outlineColor: patch.outlineColor !== undefined ? patch.outlineColor : (existing as any).outline_color,
    marginLeftPct: patch.marginLeftPct !== undefined ? patch.marginLeftPct : (existing as any).margin_left_pct,
    marginRightPct: patch.marginRightPct !== undefined ? patch.marginRightPct : (existing as any).margin_right_pct,
    marginTopPct: patch.marginTopPct !== undefined ? patch.marginTopPct : (existing as any).margin_top_pct,
    marginBottomPct: patch.marginBottomPct !== undefined ? patch.marginBottomPct : (existing as any).margin_bottom_pct,
    pillBgColor: patch.pillBgColor !== undefined ? patch.pillBgColor : (existing as any).pill_bg_color,
    pillBgOpacityPct: patch.pillBgOpacityPct !== undefined ? patch.pillBgOpacityPct : (existing as any).pill_bg_opacity_pct,
    alignment: patch.alignment !== undefined ? patch.alignment : (existing as any).alignment,
    position: patch.position !== undefined ? patch.position : existing.position,
    maxWidthPct: patch.maxWidthPct !== undefined ? patch.maxWidthPct : (existing as any).max_width_pct,
    insetXPreset: patch.insetXPreset !== undefined ? patch.insetXPreset : (existing as any).inset_x_preset,
    insetYPreset: patch.insetYPreset !== undefined ? patch.insetYPreset : (existing as any).inset_y_preset,
    timingRule: patch.timingRule !== undefined ? patch.timingRule : existing.timing_rule,
    timingSeconds: patch.timingSeconds !== undefined ? patch.timingSeconds : existing.timing_seconds,
    fade: patch.fade !== undefined ? patch.fade : existing.fade,
  }

  if (typeof next.style === 'string' && String(next.style).trim().toLowerCase() === 'outline') next.style = 'none'
  if (!isEnumValue(next.style, STYLES)) throw new DomainError('invalid_style', 'invalid_style', 400)
  next.fontKey = normalizeFontKey(next.fontKey)
  next.fontGradientKey = normalizeFontGradientKey(next.fontGradientKey)
  const fontSizePct = normalizeFontSizePct(next.fontSizePct)
  const trackingPct = normalizeTrackingPct(next.trackingPct)
  const fontColor = normalizeFontColor(next.fontColor)
  const outlineWidthPct = normalizeOutlineWidthPct(next.outlineWidthPct)
  const outlineOpacityPct = normalizeOptionalOpacityPct(next.outlineOpacityPct)
  const outlineColor = normalizeOutlineColor(next.outlineColor)
  const marginLeftPct = normalizeMarginPct(next.marginLeftPct, 'invalid_margin_left')
  const marginRightPct = normalizeMarginPct(next.marginRightPct, 'invalid_margin_right')
  const marginTopPct = normalizeMarginPct(next.marginTopPct, 'invalid_margin_top')
  const marginBottomPct = normalizeMarginPct(next.marginBottomPct, 'invalid_margin_bottom')
  const pillBgColor = normalizePillBgColor(next.pillBgColor)
  const pillBgOpacityPct = normalizeOpacityPct(next.pillBgOpacityPct, 55)
  if (!isEnumValue(String(next.alignment || '').toLowerCase(), ALIGNMENTS)) throw new DomainError('invalid_alignment', 'invalid_alignment', 400)
  const alignment: ScreenTitleAlignment = String(next.alignment || 'center').toLowerCase() as any
  if (!isEnumValue(next.position, POSITIONS)) throw new DomainError('invalid_position', 'invalid_position', 400)
  const derivedMaxWidthPct = (() => {
    if (marginLeftPct == null || marginRightPct == null) return Number(next.maxWidthPct)
    const w = 100 - marginLeftPct - marginRightPct
    if (!Number.isFinite(w)) return Number(next.maxWidthPct)
    return Math.round(Math.min(Math.max(w, 10), 100))
  })()
  const maxWidthPct = normalizePct(next.maxWidthPct ?? derivedMaxWidthPct, 'invalid_max_width', 10, 100)
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
    trackingPct,
    fontColor,
    fontGradientKey: next.fontGradientKey,
    outlineWidthPct,
    outlineOpacityPct,
    outlineColor,
    marginLeftPct,
    marginRightPct,
    marginTopPct,
    marginBottomPct,
    pillBgColor: next.style === 'pill' || next.style === 'strip' ? pillBgColor : '#000000',
    pillBgOpacityPct: next.style === 'pill' || next.style === 'strip' ? pillBgOpacityPct : 55,
    alignment,
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
