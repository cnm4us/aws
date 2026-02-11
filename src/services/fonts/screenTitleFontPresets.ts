import path from 'path'
import { resolveFamilyKeyForFontKey } from './screenTitleFonts'

export type ScreenTitleLegacyFontSizeKey = 'x_small' | 'small' | 'medium' | 'large' | 'x_large'
export type ScreenTitleFontSizeKey = string

export type ScreenTitleFontSizePreset = {
  fontSizePct: number
  trackingPct: number
  lineSpacingPct: number
}

type ScreenTitleAnchorPresetMap = Record<ScreenTitleLegacyFontSizeKey, ScreenTitleFontSizePreset>

export type ScreenTitleFontPresetsV1 = {
  schemaVersion: 1
  baselineFrame: { width: number; height: number }
  families: Record<
    string,
    {
      label: string
      sizes: Record<string, ScreenTitleFontSizePreset>
      variants?: Record<
        string,
        {
          label: string
          sizes?: Partial<Record<string, ScreenTitleFontSizePreset>>
        }
      >
    }
  >
}

let cached: ScreenTitleFontPresetsV1 | null = null

export const SCREEN_TITLE_SIZE_MIN = 10
export const SCREEN_TITLE_SIZE_MAX = 40
export const SCREEN_TITLE_SIZE_DEFAULT = 18

const LEGACY_SIZE_TO_NUMERIC: Record<ScreenTitleLegacyFontSizeKey, number> = {
  x_small: 12,
  small: 15,
  medium: 18,
  large: 23,
  x_large: 28,
}

const ANCHOR_X: Record<ScreenTitleLegacyFontSizeKey, number> = {
  x_small: 11.5,
  small: 13,
  medium: 15.5,
  large: 20.5,
  x_large: 25.5,
}

const DEFAULT_ANCHORS: ScreenTitleAnchorPresetMap = {
  x_small: { fontSizePct: 3.0, trackingPct: 0, lineSpacingPct: 0 },
  small: { fontSizePct: 3.8, trackingPct: 0, lineSpacingPct: 0 },
  medium: { fontSizePct: 4.5, trackingPct: 0, lineSpacingPct: 0 },
  large: { fontSizePct: 5.2, trackingPct: 0, lineSpacingPct: 0 },
  x_large: { fontSizePct: 6.4, trackingPct: 0, lineSpacingPct: 0 },
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function toFiniteOr(raw: any, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function interpolate2(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || Math.abs(x1 - x0) < 1e-9) return y0
  const t = (x - x0) / (x1 - x0)
  return y0 + (y1 - y0) * t
}

function mapUiSizeToCurveCoord(size: number): number {
  const n = clamp(size, SCREEN_TITLE_SIZE_MIN, SCREEN_TITLE_SIZE_MAX)
  if (n <= 11) return n
  if (n <= 16) return 11 + (n - 11) * 0.5
  return n - 2.5
}

function interpolateAnchorField(curveCoord: number, field: 'fontSizePct' | 'trackingPct' | 'lineSpacingPct', anchors: ScreenTitleAnchorPresetMap): number {
  const xs = toFiniteOr(anchors.x_small?.[field], DEFAULT_ANCHORS.x_small[field])
  const sm = toFiniteOr(anchors.small?.[field], DEFAULT_ANCHORS.small[field])
  const md = toFiniteOr(anchors.medium?.[field], DEFAULT_ANCHORS.medium[field])
  const lg = toFiniteOr(anchors.large?.[field], DEFAULT_ANCHORS.large[field])
  const xl = toFiniteOr(anchors.x_large?.[field], DEFAULT_ANCHORS.x_large[field])
  const n = clamp(curveCoord, mapUiSizeToCurveCoord(SCREEN_TITLE_SIZE_MIN), mapUiSizeToCurveCoord(SCREEN_TITLE_SIZE_MAX))

  if (n <= ANCHOR_X.x_small) {
    return interpolate2(n, ANCHOR_X.x_small, xs, ANCHOR_X.small, sm)
  }
  if (n <= ANCHOR_X.small) {
    return interpolate2(n, ANCHOR_X.x_small, xs, ANCHOR_X.small, sm)
  }
  if (n <= ANCHOR_X.medium) {
    return interpolate2(n, ANCHOR_X.small, sm, ANCHOR_X.medium, md)
  }
  if (n <= ANCHOR_X.large) {
    return interpolate2(n, ANCHOR_X.medium, md, ANCHOR_X.large, lg)
  }
  if (n <= ANCHOR_X.x_large) {
    return interpolate2(n, ANCHOR_X.large, lg, ANCHOR_X.x_large, xl)
  }
  return interpolate2(n, ANCHOR_X.large, lg, ANCHOR_X.x_large, xl)
}

function resolveAnchorMapFromFamily(
  family: { sizes?: Record<string, ScreenTitleFontSizePreset>; variants?: Record<string, { sizes?: Partial<Record<string, ScreenTitleFontSizePreset>> }> } | null,
  fontKey: string
): ScreenTitleAnchorPresetMap {
  const base = family?.sizes || {}
  const variant = family?.variants?.[String(fontKey || '').trim()]?.sizes || {}
  const pick = (k: ScreenTitleLegacyFontSizeKey, field: 'fontSizePct' | 'trackingPct' | 'lineSpacingPct'): number => {
    const ov = (variant as any)?.[k]?.[field]
    const bv = (base as any)?.[k]?.[field]
    const dv = DEFAULT_ANCHORS[k][field]
    return toFiniteOr(ov, toFiniteOr(bv, dv))
  }
  return {
    x_small: { fontSizePct: pick('x_small', 'fontSizePct'), trackingPct: pick('x_small', 'trackingPct'), lineSpacingPct: pick('x_small', 'lineSpacingPct') },
    small: { fontSizePct: pick('small', 'fontSizePct'), trackingPct: pick('small', 'trackingPct'), lineSpacingPct: pick('small', 'lineSpacingPct') },
    medium: { fontSizePct: pick('medium', 'fontSizePct'), trackingPct: pick('medium', 'trackingPct'), lineSpacingPct: pick('medium', 'lineSpacingPct') },
    large: { fontSizePct: pick('large', 'fontSizePct'), trackingPct: pick('large', 'trackingPct'), lineSpacingPct: pick('large', 'lineSpacingPct') },
    x_large: { fontSizePct: pick('x_large', 'fontSizePct'), trackingPct: pick('x_large', 'trackingPct'), lineSpacingPct: pick('x_large', 'lineSpacingPct') },
  }
}

export function normalizeScreenTitleSizeKey(raw: any, fallback = SCREEN_TITLE_SIZE_DEFAULT): string {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return String(clamp(Math.round(fallback), SCREEN_TITLE_SIZE_MIN, SCREEN_TITLE_SIZE_MAX))
  if (s in LEGACY_SIZE_TO_NUMERIC) return String(LEGACY_SIZE_TO_NUMERIC[s as ScreenTitleLegacyFontSizeKey])
  const n = Number(s)
  if (Number.isFinite(n)) return String(clamp(Math.round(n), SCREEN_TITLE_SIZE_MIN, SCREEN_TITLE_SIZE_MAX))
  return String(clamp(Math.round(fallback), SCREEN_TITLE_SIZE_MIN, SCREEN_TITLE_SIZE_MAX))
}

export function getScreenTitleFontPresets(): ScreenTitleFontPresetsV1 {
  if (cached) return cached
  const cfgPath = path.join(process.cwd(), 'assets', 'fonts', 'fontPresets.js')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const raw = require(cfgPath)
  cached = raw as ScreenTitleFontPresetsV1
  return cached
}

export function resolveScreenTitleFontSizePreset(
  fontKey: string,
  sizeKey: ScreenTitleFontSizeKey
): ScreenTitleFontSizePreset | null {
  const k = String(fontKey || '').trim()
  if (!k) return null
  const familyKey = resolveFamilyKeyForFontKey(k)
  if (!familyKey) return null
  const presets = getScreenTitleFontPresets()
  const fam: any = (presets as any)?.families?.[String(familyKey)]
  const rawKey = String(sizeKey || '').trim().toLowerCase()
  const legacyKey = rawKey in LEGACY_SIZE_TO_NUMERIC ? (rawKey as ScreenTitleLegacyFontSizeKey) : null
  if (legacyKey) {
    const base = fam?.sizes?.[legacyKey]
    const v = fam?.variants && fam.variants[String(k)] ? fam.variants[String(k)] : null
    const ov = v?.sizes && v.sizes[legacyKey] ? v.sizes[legacyKey] : null
    const resolved = { ...(DEFAULT_ANCHORS as any)[legacyKey], ...(base || {}), ...(ov || {}) }
    return {
      fontSizePct: Number(resolved.fontSizePct),
      trackingPct: Number(resolved.trackingPct),
      lineSpacingPct: Number(resolved.lineSpacingPct),
    }
  }
  const normalizedSize = Number(normalizeScreenTitleSizeKey(rawKey || SCREEN_TITLE_SIZE_DEFAULT))
  const curveCoord = mapUiSizeToCurveCoord(normalizedSize)
  const anchors = resolveAnchorMapFromFamily(fam || null, k)
  return {
    fontSizePct: clamp(Math.round(interpolateAnchorField(curveCoord, 'fontSizePct', anchors) * 10) / 10, 1, 12),
    trackingPct: Math.round(clamp(interpolateAnchorField(curveCoord, 'trackingPct', anchors), -20, 50)),
    lineSpacingPct: Math.round(clamp(interpolateAnchorField(curveCoord, 'lineSpacingPct', anchors), -20, 200)),
  }
}
