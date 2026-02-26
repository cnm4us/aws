import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import type {
  VisualizerClipMode,
  VisualizerGradientMode,
  VisualizerPresetDto,
  VisualizerPresetRow,
  VisualizerScale,
  VisualizerStyle,
} from './types'

const STYLES: readonly VisualizerStyle[] = ['wave_line', 'wave_fill', 'spectrum_bars', 'radial_bars']
const SCALES: readonly VisualizerScale[] = ['linear', 'log']
const GRADIENT_MODES: readonly VisualizerGradientMode[] = ['vertical', 'horizontal']
const CLIP_MODES: readonly VisualizerClipMode[] = ['none', 'rect']

const DEFAULTS = {
  style: 'wave_line' as VisualizerStyle,
  fgColor: '#d4af37',
  bgColor: 'transparent' as 'transparent',
  opacity: 1,
  scale: 'linear' as VisualizerScale,
  gradientEnabled: false,
  gradientStart: '#d4af37',
  gradientEnd: '#f7d774',
  gradientMode: 'vertical' as VisualizerGradientMode,
  clipMode: 'none' as VisualizerClipMode,
  clipInsetPct: 6,
  clipHeightPct: 100,
}

function isEnumValue<T extends string>(value: any, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
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

function normalizeHexColor(raw: any, fallback: string): string {
  const value = String(raw ?? '').trim()
  if (!value) return fallback
  if (/^#[0-9a-fA-F]{3}$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase()
  return fallback
}

function normalizeBgColor(raw: any): string | 'transparent' {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value || value === 'transparent') return 'transparent'
  return normalizeHexColor(value, '#000000')
}

function normalizeOpacity(raw: any, fallback = DEFAULTS.opacity): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  const clamped = Math.min(Math.max(n, 0), 1)
  return Math.round(clamped * 100) / 100
}

function normalizeClipInset(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULTS.clipInsetPct
  return Math.round(Math.min(Math.max(n, 0), 40))
}

function normalizeClipHeight(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULTS.clipHeightPct
  return Math.round(Math.min(Math.max(n, 10), 100))
}

function mapRow(row: VisualizerPresetRow): VisualizerPresetDto {
  const styleRaw = String(row.style || DEFAULTS.style).trim().toLowerCase()
  const style: VisualizerStyle = isEnumValue(styleRaw, STYLES) ? (styleRaw as VisualizerStyle) : DEFAULTS.style
  const scaleRaw = String(row.scale || DEFAULTS.scale).trim().toLowerCase()
  const scale: VisualizerScale = isEnumValue(scaleRaw, SCALES) ? (scaleRaw as VisualizerScale) : DEFAULTS.scale
  const gradientModeRaw = String(row.gradient_mode || DEFAULTS.gradientMode).trim().toLowerCase()
  const gradientMode: VisualizerGradientMode = isEnumValue(gradientModeRaw, GRADIENT_MODES) ? (gradientModeRaw as VisualizerGradientMode) : DEFAULTS.gradientMode
  const clipModeRaw = String(row.clip_mode || DEFAULTS.clipMode).trim().toLowerCase()
  const clipMode: VisualizerClipMode = isEnumValue(clipModeRaw, CLIP_MODES) ? (clipModeRaw as VisualizerClipMode) : DEFAULTS.clipMode

  const fgColor = normalizeHexColor((row as any).fg_color, DEFAULTS.fgColor)
  const bgColor = normalizeBgColor((row as any).bg_color)
  const gradientEnabled = Number((row as any).gradient_enabled) === 1
  const gradientStart = normalizeHexColor((row as any).gradient_start, fgColor)
  const gradientEnd = normalizeHexColor((row as any).gradient_end, DEFAULTS.gradientEnd)
  const opacity = normalizeOpacity((row as any).opacity)
  const clipInsetPct = normalizeClipInset((row as any).clip_inset_pct)
  const clipHeightPct = normalizeClipHeight((row as any).clip_height_pct)

  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: row.description == null ? null : String(row.description),
    style,
    fgColor,
    bgColor,
    opacity,
    scale,
    gradientEnabled,
    gradientStart,
    gradientEnd,
    gradientMode,
    clipMode,
    clipInsetPct,
    clipHeightPct,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
  }
}

function ensureOwned(row: VisualizerPresetRow, userId: number) {
  if (!userId) throw new ForbiddenError()
  if (Number(row.owner_user_id) !== Number(userId)) throw new ForbiddenError()
}

export async function listForUser(userId: number, params?: { includeArchived?: boolean; limit?: number }): Promise<VisualizerPresetDto[]> {
  if (!userId) throw new ForbiddenError()
  const rows = await repo.listByOwner(userId, params)
  return rows.map(mapRow)
}

export async function getForUser(id: number, userId: number): Promise<VisualizerPresetDto> {
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  return mapRow(row)
}

export async function createForUser(input: {
  name: any
  description?: any
  style?: any
  fgColor?: any
  bgColor?: any
  opacity?: any
  scale?: any
  gradientEnabled?: any
  gradientStart?: any
  gradientEnd?: any
  gradientMode?: any
  clipMode?: any
  clipInsetPct?: any
  clipHeightPct?: any
}, userId: number): Promise<VisualizerPresetDto> {
  if (!userId) throw new ForbiddenError()
  const name = normalizeName(input.name)
  const description = normalizeDescription(input.description)
  const styleRaw = String(input.style ?? DEFAULTS.style).trim().toLowerCase()
  const style: VisualizerStyle = isEnumValue(styleRaw, STYLES) ? (styleRaw as VisualizerStyle) : DEFAULTS.style
  const scaleRaw = String(input.scale ?? DEFAULTS.scale).trim().toLowerCase()
  const scale: VisualizerScale = isEnumValue(scaleRaw, SCALES) ? (scaleRaw as VisualizerScale) : DEFAULTS.scale
  const gradientModeRaw = String(input.gradientMode ?? DEFAULTS.gradientMode).trim().toLowerCase()
  const gradientMode: VisualizerGradientMode = isEnumValue(gradientModeRaw, GRADIENT_MODES) ? (gradientModeRaw as VisualizerGradientMode) : DEFAULTS.gradientMode
  const clipModeRaw = String(input.clipMode ?? DEFAULTS.clipMode).trim().toLowerCase()
  const clipMode: VisualizerClipMode = isEnumValue(clipModeRaw, CLIP_MODES) ? (clipModeRaw as VisualizerClipMode) : DEFAULTS.clipMode

  const fgColor = normalizeHexColor(input.fgColor, DEFAULTS.fgColor)
  const bgColor = normalizeBgColor(input.bgColor)
  const gradientEnabled = input.gradientEnabled === true
  const gradientStart = normalizeHexColor(input.gradientStart, fgColor)
  const gradientEnd = normalizeHexColor(input.gradientEnd, DEFAULTS.gradientEnd)
  const opacity = normalizeOpacity(input.opacity)
  const clipInsetPct = normalizeClipInset(input.clipInsetPct)
  const clipHeightPct = normalizeClipHeight(input.clipHeightPct)

  const row = await repo.create({
    ownerUserId: Number(userId),
    name,
    description,
    style,
    fgColor,
    bgColor,
    opacity,
    scale,
    gradientEnabled,
    gradientStart,
    gradientEnd,
    gradientMode,
    clipMode,
    clipInsetPct,
    clipHeightPct,
  })
  return mapRow(row)
}

export async function updateForUser(
  id: number,
  input: {
    name?: any
    description?: any
    style?: any
    fgColor?: any
    bgColor?: any
    opacity?: any
    scale?: any
    gradientEnabled?: any
    gradientStart?: any
    gradientEnd?: any
    gradientMode?: any
    clipMode?: any
    clipInsetPct?: any
    clipHeightPct?: any
  },
  userId: number
): Promise<VisualizerPresetDto> {
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)

  const patch: any = {}
  if (input.name !== undefined) patch.name = normalizeName(input.name)
  if (input.description !== undefined) patch.description = normalizeDescription(input.description)
  if (input.style !== undefined) {
    const styleRaw = String(input.style ?? '').trim().toLowerCase()
    patch.style = isEnumValue(styleRaw, STYLES) ? styleRaw : DEFAULTS.style
  }
  if (input.fgColor !== undefined) patch.fgColor = normalizeHexColor(input.fgColor, DEFAULTS.fgColor)
  if (input.bgColor !== undefined) patch.bgColor = normalizeBgColor(input.bgColor)
  if (input.opacity !== undefined) patch.opacity = normalizeOpacity(input.opacity)
  if (input.scale !== undefined) {
    const scaleRaw = String(input.scale ?? '').trim().toLowerCase()
    patch.scale = isEnumValue(scaleRaw, SCALES) ? scaleRaw : DEFAULTS.scale
  }
  if (input.gradientEnabled !== undefined) patch.gradientEnabled = input.gradientEnabled === true
  if (input.gradientStart !== undefined) patch.gradientStart = normalizeHexColor(input.gradientStart, DEFAULTS.gradientStart)
  if (input.gradientEnd !== undefined) patch.gradientEnd = normalizeHexColor(input.gradientEnd, DEFAULTS.gradientEnd)
  if (input.gradientMode !== undefined) {
    const gradientRaw = String(input.gradientMode ?? '').trim().toLowerCase()
    patch.gradientMode = isEnumValue(gradientRaw, GRADIENT_MODES) ? gradientRaw : DEFAULTS.gradientMode
  }
  if (input.clipMode !== undefined) {
    const clipRaw = String(input.clipMode ?? '').trim().toLowerCase()
    patch.clipMode = isEnumValue(clipRaw, CLIP_MODES) ? clipRaw : DEFAULTS.clipMode
  }
  if (input.clipInsetPct !== undefined) patch.clipInsetPct = normalizeClipInset(input.clipInsetPct)
  if (input.clipHeightPct !== undefined) patch.clipHeightPct = normalizeClipHeight(input.clipHeightPct)

  const updated = await repo.update(id, patch)
  return mapRow(updated)
}

export async function archiveForUser(id: number, userId: number): Promise<{ ok: true }> {
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  await repo.archive(id)
  return { ok: true }
}
