import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import type {
  VisualizerBandMode,
  VisualizerClipMode,
  VisualizerGradientMode,
  VisualizerPresetDto,
  VisualizerPresetInstanceDto,
  VisualizerPresetRow,
  VisualizerScale,
  VisualizerSpectrumMode,
  VisualizerStyle,
} from './types'

const STYLES: readonly VisualizerStyle[] = [
  'wave_line',
  'wave_fill',
  'center_wave',
  'spectrum_bars',
  'dot_spectrum',
  'mirror_bars',
  'stacked_bands',
  'ring_wave',
  'pulse_orb',
  'radial_bars',
]
const SCALES: readonly VisualizerScale[] = ['linear', 'log']
const GRADIENT_MODES: readonly VisualizerGradientMode[] = ['vertical', 'horizontal']
const CLIP_MODES: readonly VisualizerClipMode[] = ['none', 'rect']
const SPECTRUM_MODES: readonly VisualizerSpectrumMode[] = ['full', 'voice']
const BAND_MODES: readonly VisualizerBandMode[] = ['full', 'band_1', 'band_2', 'band_3', 'band_4']

const DEFAULTS = {
  style: 'wave_line' as VisualizerStyle,
  fgColor: '#d4af37',
  bgColor: 'transparent' as 'transparent',
  opacity: 1,
  scale: 'linear' as VisualizerScale,
  barCount: 48,
  spectrumMode: 'full' as VisualizerSpectrumMode,
  bandMode: 'full' as VisualizerBandMode,
  voiceLowHz: 80,
  voiceHighHz: 4000,
  amplitudeGainPct: 100,
  baselineLiftPct: 0,
  gradientEnabled: false,
  gradientStart: '#d4af37',
  gradientEnd: '#f7d774',
  gradientMode: 'vertical' as VisualizerGradientMode,
  clipMode: 'none' as VisualizerClipMode,
  clipInsetPct: 6,
  clipHeightPct: 100,
}

const MAX_INSTANCES = 8

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

function normalizeBarCount(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULTS.barCount
  return Math.round(Math.min(Math.max(n, 12), 128))
}

function normalizeVoiceLowHz(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULTS.voiceLowHz
  return Math.round(Math.min(Math.max(n, 20), 12000))
}

function normalizeVoiceHighHz(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULTS.voiceHighHz
  return Math.round(Math.min(Math.max(n, 100), 20000))
}

function normalizeAmplitudeGainPct(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULTS.amplitudeGainPct
  return Math.round(Math.min(Math.max(n, 0), 400))
}

function normalizeBaselineLiftPct(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULTS.baselineLiftPct
  return Math.round(Math.min(Math.max(n, -100), 100))
}

function normalizeVoiceRange(lowRaw: any, highRaw: any): { voiceLowHz: number; voiceHighHz: number } {
  let voiceLowHz = normalizeVoiceLowHz(lowRaw)
  let voiceHighHz = normalizeVoiceHighHz(highRaw)
  if (voiceLowHz >= voiceHighHz) {
    if (voiceLowHz >= 19990) voiceLowHz = 19990
    voiceHighHz = Math.min(20000, voiceLowHz + 10)
  }
  return { voiceLowHz, voiceHighHz }
}

function normalizeInstance(raw: any, fallback?: Partial<VisualizerPresetInstanceDto>, idx = 0): VisualizerPresetInstanceDto {
  const seed = fallback || {}
  const idRaw = String(raw?.id ?? seed.id ?? '').trim()
  const id = idRaw ? idRaw.slice(0, 80) : `instance_${idx + 1}`

  const styleRaw = String(raw?.style ?? seed.style ?? DEFAULTS.style).trim().toLowerCase()
  const style: VisualizerStyle = isEnumValue(styleRaw, STYLES) ? (styleRaw as VisualizerStyle) : DEFAULTS.style

  const scaleRaw = String(raw?.scale ?? seed.scale ?? DEFAULTS.scale).trim().toLowerCase()
  const scale: VisualizerScale = isEnumValue(scaleRaw, SCALES) ? (scaleRaw as VisualizerScale) : DEFAULTS.scale

  const spectrumModeRaw = String(raw?.spectrumMode ?? seed.spectrumMode ?? DEFAULTS.spectrumMode).trim().toLowerCase()
  const spectrumMode: VisualizerSpectrumMode = isEnumValue(spectrumModeRaw, SPECTRUM_MODES)
    ? (spectrumModeRaw as VisualizerSpectrumMode)
    : DEFAULTS.spectrumMode
  const bandModeRaw = String(raw?.bandMode ?? seed.bandMode ?? DEFAULTS.bandMode).trim().toLowerCase()
  const bandMode: VisualizerBandMode = isEnumValue(bandModeRaw, BAND_MODES) ? (bandModeRaw as VisualizerBandMode) : DEFAULTS.bandMode

  const gradientModeRaw = String(raw?.gradientMode ?? seed.gradientMode ?? DEFAULTS.gradientMode).trim().toLowerCase()
  const gradientMode: VisualizerGradientMode = isEnumValue(gradientModeRaw, GRADIENT_MODES)
    ? (gradientModeRaw as VisualizerGradientMode)
    : DEFAULTS.gradientMode

  const fgColor = normalizeHexColor(raw?.fgColor ?? seed.fgColor, DEFAULTS.fgColor)
  const gradientEnabled = raw?.gradientEnabled == null ? Boolean(seed.gradientEnabled) : raw?.gradientEnabled === true
  const gradientStart = normalizeHexColor(raw?.gradientStart ?? seed.gradientStart, fgColor)
  const gradientEnd = normalizeHexColor(raw?.gradientEnd ?? seed.gradientEnd, DEFAULTS.gradientEnd)
  const opacity = normalizeOpacity(raw?.opacity ?? seed.opacity)
  const barCount = normalizeBarCount(raw?.barCount ?? seed.barCount)
  const { voiceLowHz, voiceHighHz } = normalizeVoiceRange(raw?.voiceLowHz ?? seed.voiceLowHz, raw?.voiceHighHz ?? seed.voiceHighHz)
  const amplitudeGainPct = normalizeAmplitudeGainPct(raw?.amplitudeGainPct ?? seed.amplitudeGainPct)
  const baselineLiftPct = normalizeBaselineLiftPct(raw?.baselineLiftPct ?? seed.baselineLiftPct)

  return {
    id,
    style,
    fgColor,
    opacity,
    scale,
    barCount,
    spectrumMode,
    bandMode,
    voiceLowHz,
    voiceHighHz,
    amplitudeGainPct,
    baselineLiftPct,
    gradientEnabled,
    gradientStart,
    gradientEnd,
    gradientMode,
  }
}

function parseInstancesJson(raw: any): any[] {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (typeof raw === 'object') return []
  return []
}

function normalizeInstances(raw: any, fallback: Partial<VisualizerPresetInstanceDto>): VisualizerPresetInstanceDto[] {
  const list = Array.isArray(raw) ? raw : []
  const out = list
    .slice(0, MAX_INSTANCES)
    .map((item, idx) => normalizeInstance(item, idx === 0 ? fallback : fallback, idx))
  if (out.length) return out
  return [normalizeInstance({}, fallback, 0)]
}

function legacyStyleFromRow(row: VisualizerPresetRow): Partial<VisualizerPresetInstanceDto> {
  return {
    id: 'instance_1',
    style: isEnumValue(String(row.style || '').trim().toLowerCase(), STYLES)
      ? (String(row.style || '').trim().toLowerCase() as VisualizerStyle)
      : DEFAULTS.style,
    fgColor: normalizeHexColor((row as any).fg_color, DEFAULTS.fgColor),
    opacity: normalizeOpacity((row as any).opacity),
    scale: isEnumValue(String(row.scale || '').trim().toLowerCase(), SCALES)
      ? (String(row.scale || '').trim().toLowerCase() as VisualizerScale)
      : DEFAULTS.scale,
    barCount: normalizeBarCount((row as any).bar_count),
    spectrumMode: isEnumValue(String((row as any).spectrum_mode || '').trim().toLowerCase(), SPECTRUM_MODES)
      ? (String((row as any).spectrum_mode || '').trim().toLowerCase() as VisualizerSpectrumMode)
      : DEFAULTS.spectrumMode,
    bandMode: DEFAULTS.bandMode,
    voiceLowHz: DEFAULTS.voiceLowHz,
    voiceHighHz: DEFAULTS.voiceHighHz,
    amplitudeGainPct: DEFAULTS.amplitudeGainPct,
    baselineLiftPct: DEFAULTS.baselineLiftPct,
    gradientEnabled: Number((row as any).gradient_enabled) === 1,
    gradientStart: normalizeHexColor((row as any).gradient_start, normalizeHexColor((row as any).fg_color, DEFAULTS.fgColor)),
    gradientEnd: normalizeHexColor((row as any).gradient_end, DEFAULTS.gradientEnd),
    gradientMode: isEnumValue(String((row as any).gradient_mode || '').trim().toLowerCase(), GRADIENT_MODES)
      ? (String((row as any).gradient_mode || '').trim().toLowerCase() as VisualizerGradientMode)
      : DEFAULTS.gradientMode,
  }
}

function serializeInstances(instances: VisualizerPresetInstanceDto[]): string {
  return JSON.stringify(instances.map((inst) => ({ ...inst })))
}

function mapRow(row: VisualizerPresetRow): VisualizerPresetDto {
  const styleRaw = String(row.style || DEFAULTS.style).trim().toLowerCase()
  const style: VisualizerStyle = isEnumValue(styleRaw, STYLES) ? (styleRaw as VisualizerStyle) : DEFAULTS.style
  const scaleRaw = String(row.scale || DEFAULTS.scale).trim().toLowerCase()
  const scale: VisualizerScale = isEnumValue(scaleRaw, SCALES) ? (scaleRaw as VisualizerScale) : DEFAULTS.scale
  const spectrumModeRaw = String((row as any).spectrum_mode || DEFAULTS.spectrumMode).trim().toLowerCase()
  const spectrumMode: VisualizerSpectrumMode = isEnumValue(spectrumModeRaw, SPECTRUM_MODES) ? (spectrumModeRaw as VisualizerSpectrumMode) : DEFAULTS.spectrumMode
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
  const barCount = normalizeBarCount((row as any).bar_count)
  const clipInsetPct = normalizeClipInset((row as any).clip_inset_pct)
  const clipHeightPct = normalizeClipHeight((row as any).clip_height_pct)

  const legacyPrimary: VisualizerPresetInstanceDto = normalizeInstance(
    {
      id: 'instance_1',
      style,
      fgColor,
      opacity,
      scale,
      barCount,
      spectrumMode,
      gradientEnabled,
      gradientStart,
      gradientEnd,
      gradientMode,
    },
    undefined,
    0
  )
  const parsedInstances = parseInstancesJson((row as any).instances_json)
  const instances = normalizeInstances(parsedInstances, legacyPrimary)
  const primary = instances[0] || legacyPrimary

  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: row.description == null ? null : String(row.description),
    style: primary.style,
    fgColor: primary.fgColor,
    bgColor,
    opacity: primary.opacity,
    scale: primary.scale,
    barCount: primary.barCount,
    spectrumMode: primary.spectrumMode,
    bandMode: primary.bandMode,
    voiceLowHz: primary.voiceLowHz,
    voiceHighHz: primary.voiceHighHz,
    amplitudeGainPct: primary.amplitudeGainPct,
    baselineLiftPct: primary.baselineLiftPct,
    gradientEnabled: primary.gradientEnabled,
    gradientStart: primary.gradientStart,
    gradientEnd: primary.gradientEnd,
    gradientMode: primary.gradientMode,
    clipMode,
    clipInsetPct,
    clipHeightPct,
    instances,
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
  instances?: any
  style?: any
  fgColor?: any
  bgColor?: any
  opacity?: any
  scale?: any
  barCount?: any
  spectrumMode?: any
  bandMode?: any
  voiceLowHz?: any
  voiceHighHz?: any
  amplitudeGainPct?: any
  baselineLiftPct?: any
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
  const spectrumModeRaw = String(input.spectrumMode ?? DEFAULTS.spectrumMode).trim().toLowerCase()
  const spectrumMode: VisualizerSpectrumMode = isEnumValue(spectrumModeRaw, SPECTRUM_MODES)
    ? (spectrumModeRaw as VisualizerSpectrumMode)
    : DEFAULTS.spectrumMode
  const bandModeRaw = String(input.bandMode ?? DEFAULTS.bandMode).trim().toLowerCase()
  const bandMode: VisualizerBandMode = isEnumValue(bandModeRaw, BAND_MODES)
    ? (bandModeRaw as VisualizerBandMode)
    : DEFAULTS.bandMode
  const { voiceLowHz, voiceHighHz } = normalizeVoiceRange(input.voiceLowHz, input.voiceHighHz)
  const amplitudeGainPct = normalizeAmplitudeGainPct(input.amplitudeGainPct)
  const baselineLiftPct = normalizeBaselineLiftPct(input.baselineLiftPct)
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
  const barCount = normalizeBarCount(input.barCount)
  const clipInsetPct = normalizeClipInset(input.clipInsetPct)
  const clipHeightPct = normalizeClipHeight(input.clipHeightPct)
  const instances = normalizeInstances((input as any).instances, {
    id: 'instance_1',
    style,
    fgColor,
    opacity,
    scale,
    barCount,
    spectrumMode,
    bandMode,
    voiceLowHz,
    voiceHighHz,
    amplitudeGainPct,
    baselineLiftPct,
    gradientEnabled,
    gradientStart,
    gradientEnd,
    gradientMode,
  })
  const primary = instances[0]

  const row = await repo.create({
    ownerUserId: Number(userId),
    name,
    description,
    style: primary.style,
    fgColor: primary.fgColor,
    bgColor,
    opacity: primary.opacity,
    scale: primary.scale,
    barCount: primary.barCount,
    spectrumMode: primary.spectrumMode,
    gradientEnabled: primary.gradientEnabled,
    gradientStart: primary.gradientStart,
    gradientEnd: primary.gradientEnd,
    gradientMode: primary.gradientMode,
    clipMode,
    clipInsetPct,
    clipHeightPct,
    instancesJson: serializeInstances(instances),
  })
  return mapRow(row)
}

export async function updateForUser(
  id: number,
  input: {
    name?: any
    description?: any
    instances?: any
    style?: any
    fgColor?: any
    bgColor?: any
    opacity?: any
    scale?: any
  barCount?: any
  spectrumMode?: any
  bandMode?: any
  voiceLowHz?: any
  voiceHighHz?: any
  amplitudeGainPct?: any
  baselineLiftPct?: any
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
  const mappedCurrent = mapRow(row)

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
  if (input.spectrumMode !== undefined) {
    const spectrumRaw = String(input.spectrumMode ?? '').trim().toLowerCase()
    patch.spectrumMode = isEnumValue(spectrumRaw, SPECTRUM_MODES) ? spectrumRaw : DEFAULTS.spectrumMode
  }
  if (input.bandMode !== undefined) {
    const bandRaw = String(input.bandMode ?? '').trim().toLowerCase()
    patch.bandMode = isEnumValue(bandRaw, BAND_MODES) ? bandRaw : DEFAULTS.bandMode
  }
  if (input.voiceLowHz !== undefined) patch.voiceLowHz = normalizeVoiceLowHz(input.voiceLowHz)
  if (input.voiceHighHz !== undefined) patch.voiceHighHz = normalizeVoiceHighHz(input.voiceHighHz)
  if (patch.voiceLowHz !== undefined || patch.voiceHighHz !== undefined) {
    const currentLow = patch.voiceLowHz ?? mappedCurrent.voiceLowHz ?? DEFAULTS.voiceLowHz
    const currentHigh = patch.voiceHighHz ?? mappedCurrent.voiceHighHz ?? DEFAULTS.voiceHighHz
    const normalizedRange = normalizeVoiceRange(currentLow, currentHigh)
    patch.voiceLowHz = normalizedRange.voiceLowHz
    patch.voiceHighHz = normalizedRange.voiceHighHz
  }
  if (input.amplitudeGainPct !== undefined) patch.amplitudeGainPct = normalizeAmplitudeGainPct(input.amplitudeGainPct)
  if (input.baselineLiftPct !== undefined) patch.baselineLiftPct = normalizeBaselineLiftPct(input.baselineLiftPct)
  if (input.barCount !== undefined) patch.barCount = normalizeBarCount(input.barCount)
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

  const instanceFieldTouched =
    input.style !== undefined ||
    input.fgColor !== undefined ||
    input.opacity !== undefined ||
    input.scale !== undefined ||
    input.barCount !== undefined ||
    input.spectrumMode !== undefined ||
    input.bandMode !== undefined ||
    input.voiceLowHz !== undefined ||
    input.voiceHighHz !== undefined ||
    input.amplitudeGainPct !== undefined ||
    input.baselineLiftPct !== undefined ||
    input.gradientEnabled !== undefined ||
    input.gradientStart !== undefined ||
    input.gradientEnd !== undefined ||
    input.gradientMode !== undefined

  if (input.instances !== undefined) {
    const currentPrimary = (mappedCurrent.instances && mappedCurrent.instances[0]) || normalizeInstance({}, legacyStyleFromRow(row), 0)
    const instances = normalizeInstances(input.instances, currentPrimary)
    const primary = instances[0]
    patch.instancesJson = serializeInstances(instances)
    patch.style = primary.style
    patch.fgColor = primary.fgColor
    patch.opacity = primary.opacity
    patch.scale = primary.scale
    patch.barCount = primary.barCount
    patch.spectrumMode = primary.spectrumMode
    patch.bandMode = primary.bandMode
    patch.voiceLowHz = primary.voiceLowHz
    patch.voiceHighHz = primary.voiceHighHz
    patch.amplitudeGainPct = primary.amplitudeGainPct
    patch.baselineLiftPct = primary.baselineLiftPct
    patch.gradientEnabled = primary.gradientEnabled
    patch.gradientStart = primary.gradientStart
    patch.gradientEnd = primary.gradientEnd
    patch.gradientMode = primary.gradientMode
  } else if (instanceFieldTouched) {
    const current = Array.isArray(mappedCurrent.instances) && mappedCurrent.instances.length
      ? mappedCurrent.instances
      : normalizeInstances([], legacyStyleFromRow(row))
    const primaryNext = normalizeInstance(
      {
        ...current[0],
        style: patch.style ?? current[0].style,
        fgColor: patch.fgColor ?? current[0].fgColor,
        opacity: patch.opacity ?? current[0].opacity,
        scale: patch.scale ?? current[0].scale,
        barCount: patch.barCount ?? current[0].barCount,
        spectrumMode: patch.spectrumMode ?? current[0].spectrumMode,
        bandMode: patch.bandMode ?? current[0].bandMode,
        voiceLowHz: patch.voiceLowHz ?? current[0].voiceLowHz,
        voiceHighHz: patch.voiceHighHz ?? current[0].voiceHighHz,
        amplitudeGainPct: patch.amplitudeGainPct ?? current[0].amplitudeGainPct,
        baselineLiftPct: patch.baselineLiftPct ?? current[0].baselineLiftPct,
        gradientEnabled: patch.gradientEnabled ?? current[0].gradientEnabled,
        gradientStart: patch.gradientStart ?? current[0].gradientStart,
        gradientEnd: patch.gradientEnd ?? current[0].gradientEnd,
        gradientMode: patch.gradientMode ?? current[0].gradientMode,
      },
      current[0],
      0
    )
    const tail = current.slice(1).map((inst, idx) => normalizeInstance(inst, inst, idx + 1))
    const instances = [primaryNext, ...tail]
    patch.instancesJson = serializeInstances(instances)
    patch.style = primaryNext.style
    patch.fgColor = primaryNext.fgColor
    patch.opacity = primaryNext.opacity
    patch.scale = primaryNext.scale
    patch.barCount = primaryNext.barCount
    patch.spectrumMode = primaryNext.spectrumMode
    patch.bandMode = primaryNext.bandMode
    patch.voiceLowHz = primaryNext.voiceLowHz
    patch.voiceHighHz = primaryNext.voiceHighHz
    patch.amplitudeGainPct = primaryNext.amplitudeGainPct
    patch.baselineLiftPct = primaryNext.baselineLiftPct
    patch.gradientEnabled = primaryNext.gradientEnabled
    patch.gradientStart = primaryNext.gradientStart
    patch.gradientEnd = primaryNext.gradientEnd
    patch.gradientMode = primaryNext.gradientMode
  }

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
