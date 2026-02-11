export const SCREEN_TITLE_SIZE_MIN = 10
export const SCREEN_TITLE_SIZE_MAX = 40
export const SCREEN_TITLE_SIZE_DEFAULT = 18

type LegacySizeKey = 'x_small' | 'small' | 'medium' | 'large' | 'x_large'
type SizePreset = { fontSizePct: number; trackingPct: number; lineSpacingPct: number }
type AnchorPresetMap = Record<LegacySizeKey, SizePreset>

const LEGACY_TO_NUMERIC: Record<LegacySizeKey, number> = {
  x_small: 12,
  small: 15,
  medium: 18,
  large: 23,
  x_large: 28,
}

const ANCHOR_X: Record<LegacySizeKey, number> = {
  x_small: 11.5,
  small: 13,
  medium: 15.5,
  large: 20.5,
  x_large: 25.5,
}

const DEFAULT_ANCHORS: AnchorPresetMap = {
  x_small: { fontSizePct: 3.0, trackingPct: 0, lineSpacingPct: 0 },
  small: { fontSizePct: 3.8, trackingPct: 0, lineSpacingPct: 0 },
  medium: { fontSizePct: 4.5, trackingPct: 0, lineSpacingPct: 0 },
  large: { fontSizePct: 5.2, trackingPct: 0, lineSpacingPct: 0 },
  x_large: { fontSizePct: 6.4, trackingPct: 0, lineSpacingPct: 0 },
}

export const SCREEN_TITLE_SIZE_OPTIONS: Array<{ value: string; label: string }> = Array.from(
  { length: SCREEN_TITLE_SIZE_MAX - SCREEN_TITLE_SIZE_MIN + 1 },
  (_, i) => {
    const n = SCREEN_TITLE_SIZE_MIN + i
    return { value: String(n), label: String(n) }
  }
)

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

function interpolateAnchorField(curveCoord: number, field: 'fontSizePct' | 'trackingPct' | 'lineSpacingPct', anchors: AnchorPresetMap): number {
  const xs = toFiniteOr(anchors.x_small?.[field], DEFAULT_ANCHORS.x_small[field])
  const sm = toFiniteOr(anchors.small?.[field], DEFAULT_ANCHORS.small[field])
  const md = toFiniteOr(anchors.medium?.[field], DEFAULT_ANCHORS.medium[field])
  const lg = toFiniteOr(anchors.large?.[field], DEFAULT_ANCHORS.large[field])
  const xl = toFiniteOr(anchors.x_large?.[field], DEFAULT_ANCHORS.x_large[field])
  const n = clamp(curveCoord, mapUiSizeToCurveCoord(SCREEN_TITLE_SIZE_MIN), mapUiSizeToCurveCoord(SCREEN_TITLE_SIZE_MAX))

  if (n <= ANCHOR_X.x_small) return interpolate2(n, ANCHOR_X.x_small, xs, ANCHOR_X.small, sm)
  if (n <= ANCHOR_X.small) return interpolate2(n, ANCHOR_X.x_small, xs, ANCHOR_X.small, sm)
  if (n <= ANCHOR_X.medium) return interpolate2(n, ANCHOR_X.small, sm, ANCHOR_X.medium, md)
  if (n <= ANCHOR_X.large) return interpolate2(n, ANCHOR_X.medium, md, ANCHOR_X.large, lg)
  if (n <= ANCHOR_X.x_large) return interpolate2(n, ANCHOR_X.large, lg, ANCHOR_X.x_large, xl)
  return interpolate2(n, ANCHOR_X.large, lg, ANCHOR_X.x_large, xl)
}

function resolveAnchorsFromFamily(
  family: { sizes?: Record<string, SizePreset>; variants?: Record<string, { sizes?: Partial<Record<string, SizePreset>> }> } | null,
  fontKey: string | null
): AnchorPresetMap {
  const base = family?.sizes || {}
  const variant = family?.variants?.[String(fontKey || '').trim()]?.sizes || {}
  const pick = (k: LegacySizeKey, field: 'fontSizePct' | 'trackingPct' | 'lineSpacingPct'): number => {
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
  if (s in LEGACY_TO_NUMERIC) return String(LEGACY_TO_NUMERIC[s as LegacySizeKey])
  const n = Number(s)
  if (Number.isFinite(n)) return String(clamp(Math.round(n), SCREEN_TITLE_SIZE_MIN, SCREEN_TITLE_SIZE_MAX))
  return String(clamp(Math.round(fallback), SCREEN_TITLE_SIZE_MIN, SCREEN_TITLE_SIZE_MAX))
}

export function resolveScreenTitleSizePresetForUi(
  sizeKey: string | null,
  family: { sizes?: Record<string, SizePreset>; variants?: Record<string, { sizes?: Partial<Record<string, SizePreset>> }> } | null,
  fontKey: string | null
): SizePreset {
  const normalized = Number(normalizeScreenTitleSizeKey(sizeKey, SCREEN_TITLE_SIZE_DEFAULT))
  const curveCoord = mapUiSizeToCurveCoord(normalized)
  const anchors = resolveAnchorsFromFamily(family, fontKey)
  return {
    fontSizePct: clamp(Math.round(interpolateAnchorField(curveCoord, 'fontSizePct', anchors) * 10) / 10, 1, 12),
    trackingPct: Math.round(clamp(interpolateAnchorField(curveCoord, 'trackingPct', anchors), -20, 50)),
    lineSpacingPct: Math.round(clamp(interpolateAnchorField(curveCoord, 'lineSpacingPct', anchors), -20, 200)),
  }
}
