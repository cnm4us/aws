import { clamp } from './timelineMath'

export const SCREEN_TITLE_MARGIN_BASELINE_WIDTH_PX = 1080
export const SCREEN_TITLE_SAFE_AREA_TOP_PCT = 3
export const SCREEN_TITLE_SAFE_AREA_RIGHT_PCT = 3
export const SCREEN_TITLE_SAFE_AREA_BOTTOM_PCT = 3
export const SCREEN_TITLE_SAFE_AREA_LEFT_PCT = 3
export const SCREEN_TITLE_PLACEMENT_MIN_W_PCT = 12
export const SCREEN_TITLE_PLACEMENT_MIN_H_PCT = 8

export type ScreenTitlePlacementRect = { xPct: number; yPct: number; wPct: number; hPct: number }
export type ScreenTitleCustomStyleDraft = {
  position?: 'top' | 'middle' | 'bottom'
  alignment?: 'left' | 'center' | 'right'
  marginXPx?: number
  marginYPx?: number
  offsetXPx?: number
  offsetYPx?: number
  placementRect?: ScreenTitlePlacementRect | null
  fontKey?: string
  fontSizePct?: number
  fontColor?: string
  fontGradientKey?: string | null
}

export const screenTitleInsetPresetToMarginPct = (raw: any): number => {
  const s = String(raw || '').trim().toLowerCase()
  if (s === 'small') return 6
  if (s === 'large') return 14
  return 10
}

export const screenTitleMarginPxToPct = (px: number): number => {
  return Math.round(((px / SCREEN_TITLE_MARGIN_BASELINE_WIDTH_PX) * 100) * 100) / 100
}

export const screenTitleMarginPctToPx = (pct: number): number => {
  return Math.round((pct / 100) * SCREEN_TITLE_MARGIN_BASELINE_WIDTH_PX)
}

export const normalizeScreenTitlePlacementRect = (raw: any): ScreenTitlePlacementRect | null => {
  if (!raw || typeof raw !== 'object') return null
  const xRaw = Number((raw as any).xPct)
  const yRaw = Number((raw as any).yPct)
  const wRaw = Number((raw as any).wPct)
  const hRaw = Number((raw as any).hPct)
  if (!(Number.isFinite(xRaw) && Number.isFinite(yRaw) && Number.isFinite(wRaw) && Number.isFinite(hRaw))) return null
  let xPct = clamp(xRaw, 0, 100)
  let yPct = clamp(yRaw, 0, 100)
  let wPct = clamp(wRaw, 0, 100)
  let hPct = clamp(hRaw, 0, 100)
  wPct = Math.min(wPct, Math.max(0, 100 - xPct))
  hPct = Math.min(hPct, Math.max(0, 100 - yPct))
  if (!(wPct > 0.001 && hPct > 0.001)) return null
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  return { xPct: r3(xPct), yPct: r3(yPct), wPct: r3(wPct), hPct: r3(hPct) }
}

export const defaultScreenTitlePlacementRect = (): ScreenTitlePlacementRect => ({
  xPct: SCREEN_TITLE_SAFE_AREA_LEFT_PCT,
  yPct: SCREEN_TITLE_SAFE_AREA_TOP_PCT,
  wPct: 100 - SCREEN_TITLE_SAFE_AREA_LEFT_PCT - SCREEN_TITLE_SAFE_AREA_RIGHT_PCT,
  hPct: 100 - SCREEN_TITLE_SAFE_AREA_TOP_PCT - SCREEN_TITLE_SAFE_AREA_BOTTOM_PCT,
})

export const normalizeScreenTitlePlacementRectForEditor = (raw: any): ScreenTitlePlacementRect => {
  const base = normalizeScreenTitlePlacementRect(raw) || defaultScreenTitlePlacementRect()
  const safeLeft = SCREEN_TITLE_SAFE_AREA_LEFT_PCT
  const safeTop = SCREEN_TITLE_SAFE_AREA_TOP_PCT
  const safeRight = 100 - SCREEN_TITLE_SAFE_AREA_RIGHT_PCT
  const safeBottom = 100 - SCREEN_TITLE_SAFE_AREA_BOTTOM_PCT
  const maxW = Math.max(SCREEN_TITLE_PLACEMENT_MIN_W_PCT, safeRight - safeLeft)
  const maxH = Math.max(SCREEN_TITLE_PLACEMENT_MIN_H_PCT, safeBottom - safeTop)
  let wPct = clamp(base.wPct, SCREEN_TITLE_PLACEMENT_MIN_W_PCT, maxW)
  let hPct = clamp(base.hPct, SCREEN_TITLE_PLACEMENT_MIN_H_PCT, maxH)
  let xPct = clamp(base.xPct, safeLeft, safeRight - wPct)
  let yPct = clamp(base.yPct, safeTop, safeBottom - hPct)
  if (xPct + wPct > safeRight) xPct = safeRight - wPct
  if (yPct + hPct > safeBottom) yPct = safeBottom - hPct
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  return { xPct: r3(xPct), yPct: r3(yPct), wPct: r3(wPct), hPct: r3(hPct) }
}

export const applyScreenTitlePlacementDrag = (
  base: ScreenTitlePlacementRect,
  mode: 'move' | 'left' | 'right' | 'top' | 'bottom',
  dxPct: number,
  dyPct: number
): ScreenTitlePlacementRect => {
  const safeLeft = SCREEN_TITLE_SAFE_AREA_LEFT_PCT
  const safeTop = SCREEN_TITLE_SAFE_AREA_TOP_PCT
  const safeRight = 100 - SCREEN_TITLE_SAFE_AREA_RIGHT_PCT
  const safeBottom = 100 - SCREEN_TITLE_SAFE_AREA_BOTTOM_PCT
  const minW = SCREEN_TITLE_PLACEMENT_MIN_W_PCT
  const minH = SCREEN_TITLE_PLACEMENT_MIN_H_PCT
  let xPct = base.xPct
  let yPct = base.yPct
  let wPct = base.wPct
  let hPct = base.hPct

  if (mode === 'move') {
    xPct = clamp(base.xPct + dxPct, safeLeft, safeRight - base.wPct)
    yPct = clamp(base.yPct + dyPct, safeTop, safeBottom - base.hPct)
  } else if (mode === 'left') {
    const maxLeft = base.xPct + base.wPct - minW
    xPct = clamp(base.xPct + dxPct, safeLeft, maxLeft)
    wPct = base.wPct + (base.xPct - xPct)
  } else if (mode === 'right') {
    wPct = clamp(base.wPct + dxPct, minW, safeRight - base.xPct)
  } else if (mode === 'top') {
    const maxTop = base.yPct + base.hPct - minH
    yPct = clamp(base.yPct + dyPct, safeTop, maxTop)
    hPct = base.hPct + (base.yPct - yPct)
  } else if (mode === 'bottom') {
    hPct = clamp(base.hPct + dyPct, minH, safeBottom - base.yPct)
  }

  return normalizeScreenTitlePlacementRectForEditor({ xPct, yPct, wPct, hPct })
}

export const isSameScreenTitlePlacementRect = (a: ScreenTitlePlacementRect, b: ScreenTitlePlacementRect): boolean => {
  return (
    Math.abs(Number(a.xPct) - Number(b.xPct)) < 0.001 &&
    Math.abs(Number(a.yPct) - Number(b.yPct)) < 0.001 &&
    Math.abs(Number(a.wPct) - Number(b.wPct)) < 0.001 &&
    Math.abs(Number(a.hPct) - Number(b.hPct)) < 0.001
  )
}

export function buildScreenTitlePresetSnapshot(preset: any) {
  const presetId = Number((preset as any).id)
  return {
    id: presetId,
    name: String((preset as any).name || `Preset ${presetId}`),
    style: (String((preset as any).style || 'none').toLowerCase() === 'pill'
      ? 'pill'
      : String((preset as any).style || 'none').toLowerCase() === 'strip'
        ? 'strip'
        : 'none') as any,
    fontKey: String((preset as any).fontKey || 'dejavu_sans_bold'),
    fontSizePct: Number((preset as any).fontSizePct),
    trackingPct: Number((preset as any).trackingPct),
    lineSpacingPct: Number((preset as any).lineSpacingPct ?? 0),
    fontColor: String((preset as any).fontColor || '#ffffff'),
    shadowColor: String((preset as any).shadowColor || '#000000'),
    shadowOffsetPx: Number((preset as any).shadowOffsetPx ?? 2),
    shadowBlurPx: Number((preset as any).shadowBlurPx ?? 0),
    shadowOpacityPct: Number((preset as any).shadowOpacityPct ?? 65),
    fontGradientKey: (preset as any).fontGradientKey == null ? null : String((preset as any).fontGradientKey),
    outlineWidthPct: (preset as any).outlineWidthPct == null ? null : Number((preset as any).outlineWidthPct),
    outlineOpacityPct: (preset as any).outlineOpacityPct == null ? null : Number((preset as any).outlineOpacityPct),
    outlineColor: (preset as any).outlineColor == null ? null : String((preset as any).outlineColor),
    pillBgColor: String((preset as any).pillBgColor || '#000000'),
    pillBgOpacityPct: Number((preset as any).pillBgOpacityPct),
    alignment: (String((preset as any).alignment || 'center').toLowerCase() === 'left'
      ? 'left'
      : String((preset as any).alignment || 'center').toLowerCase() === 'right'
        ? 'right'
        : 'center') as any,
    // Placement is now controlled per object/instance from timeline quick tools.
    // Keep preset snapshot placement baseline deterministic.
    position: 'top' as any,
    maxWidthPct: Number((preset as any).maxWidthPct),
    insetXPreset: null,
    insetYPreset: null,
    marginLeftPct: null,
    marginRightPct: null,
    marginTopPct: null,
    marginBottomPct: null,
    fade: (String((preset as any).fade || 'none').toLowerCase() === 'in_out'
      ? 'in_out'
      : String((preset as any).fade || 'none').toLowerCase() === 'in'
        ? 'in'
        : String((preset as any).fade || 'none').toLowerCase() === 'out'
          ? 'out'
          : 'none') as any,
  }
}

export function applyScreenTitleCustomStyle(snapshot: any, customStyle: ScreenTitleCustomStyleDraft | null) {
  if (!customStyle) return snapshot
  const next: any = { ...(snapshot as any) }
  if (customStyle.position) next.position = customStyle.position
  if (customStyle.alignment) next.alignment = customStyle.alignment
  if (customStyle.fontKey) next.fontKey = customStyle.fontKey
  if (customStyle.fontSizePct != null && Number.isFinite(Number(customStyle.fontSizePct))) next.fontSizePct = Number(customStyle.fontSizePct)
  if (customStyle.fontColor) next.fontColor = customStyle.fontColor
  if (customStyle.fontGradientKey !== undefined) next.fontGradientKey = customStyle.fontGradientKey
  const hasOffsetX = customStyle.offsetXPx != null && Number.isFinite(Number(customStyle.offsetXPx))
  const hasOffsetY = customStyle.offsetYPx != null && Number.isFinite(Number(customStyle.offsetYPx))
  if (!hasOffsetX && customStyle.marginXPx != null && Number.isFinite(Number(customStyle.marginXPx))) {
    const pct = screenTitleMarginPxToPct(Number(customStyle.marginXPx))
    next.marginLeftPct = pct
    next.marginRightPct = pct
    next.insetXPreset = null
  }
  if (!hasOffsetY && customStyle.marginYPx != null && Number.isFinite(Number(customStyle.marginYPx))) {
    const pct = screenTitleMarginPxToPct(Number(customStyle.marginYPx))
    next.marginTopPct = pct
    next.marginBottomPct = pct
    next.insetYPreset = null
  }
  if (hasOffsetX) next.offsetXPx = Number(customStyle.offsetXPx)
  if (hasOffsetY) next.offsetYPx = Number(customStyle.offsetYPx)
  const placementRect = normalizeScreenTitlePlacementRect((customStyle as any).placementRect)
  if (placementRect) next.placementRect = placementRect
  return next
}

export function buildScreenTitlePresetOverride(customStyle: ScreenTitleCustomStyleDraft | null) {
  if (!customStyle) return null
  const out: any = {}
  if (customStyle.position) out.position = customStyle.position
  if (customStyle.alignment) out.alignment = customStyle.alignment
  if (customStyle.fontKey) out.fontKey = customStyle.fontKey
  if (customStyle.fontSizePct != null && Number.isFinite(Number(customStyle.fontSizePct))) out.fontSizePct = Number(customStyle.fontSizePct)
  if (customStyle.fontColor) out.fontColor = customStyle.fontColor
  if (customStyle.fontGradientKey !== undefined) out.fontGradientKey = customStyle.fontGradientKey
  const hasOffsetX = customStyle.offsetXPx != null && Number.isFinite(Number(customStyle.offsetXPx))
  const hasOffsetY = customStyle.offsetYPx != null && Number.isFinite(Number(customStyle.offsetYPx))
  if (!hasOffsetX && customStyle.marginXPx != null && Number.isFinite(Number(customStyle.marginXPx))) {
    const pct = screenTitleMarginPxToPct(Number(customStyle.marginXPx))
    out.marginLeftPct = pct
    out.marginRightPct = pct
    out.insetXPreset = null
  }
  if (!hasOffsetY && customStyle.marginYPx != null && Number.isFinite(Number(customStyle.marginYPx))) {
    const pct = screenTitleMarginPxToPct(Number(customStyle.marginYPx))
    out.marginTopPct = pct
    out.marginBottomPct = pct
    out.insetYPreset = null
  }
  if (hasOffsetX) out.offsetXPx = Number(customStyle.offsetXPx)
  if (hasOffsetY) out.offsetYPx = Number(customStyle.offsetYPx)
  const placementRect = normalizeScreenTitlePlacementRect((customStyle as any).placementRect)
  if (placementRect) out.placementRect = placementRect
  return Object.keys(out).length ? out : null
}

export function normalizeScreenTitleCustomStyleForSave(customStyle: ScreenTitleCustomStyleDraft | null, basePreset: any) {
  if (!customStyle) return null
  const basePos = String(basePreset?.position || 'top') as any
  const baseAln = String(basePreset?.alignment || 'center') as any
  const baseGradient = basePreset?.fontGradientKey == null ? null : String(basePreset.fontGradientKey)
  const baseMarginXPct =
    basePreset?.marginLeftPct != null
      ? Number(basePreset.marginLeftPct)
      : basePreset?.marginRightPct != null
        ? Number(basePreset.marginRightPct)
        : screenTitleInsetPresetToMarginPct(basePreset?.insetXPreset)
  const baseMarginYPct =
    basePreset?.marginTopPct != null
      ? Number(basePreset.marginTopPct)
      : basePreset?.marginBottomPct != null
        ? Number(basePreset.marginBottomPct)
        : screenTitleInsetPresetToMarginPct(basePreset?.insetYPreset)
  const baseOffsetXPx = 0
  const baseOffsetYPx = 0

  const out: ScreenTitleCustomStyleDraft = {}
  if (customStyle.position && customStyle.position !== basePos) out.position = customStyle.position
  if (customStyle.alignment && customStyle.alignment !== baseAln) out.alignment = customStyle.alignment
  if (customStyle.fontKey && customStyle.fontKey !== String(basePreset?.fontKey || '')) out.fontKey = customStyle.fontKey
  if (
    customStyle.fontSizePct != null &&
    Number.isFinite(Number(customStyle.fontSizePct)) &&
    Math.abs(Number(customStyle.fontSizePct) - Number(basePreset?.fontSizePct || 0)) > 0.001
  ) {
    out.fontSizePct = Number(customStyle.fontSizePct)
  }
  if (customStyle.fontColor && customStyle.fontColor !== String(basePreset?.fontColor || '')) out.fontColor = customStyle.fontColor
  if (customStyle.fontGradientKey !== undefined) {
    const nextGradient = customStyle.fontGradientKey == null ? null : String(customStyle.fontGradientKey)
    if (String(nextGradient || '') !== String(baseGradient || '')) out.fontGradientKey = nextGradient
  }
  const offsetXPx =
    customStyle.offsetXPx != null && Number.isFinite(Number(customStyle.offsetXPx))
      ? Number(customStyle.offsetXPx)
      : customStyle.marginXPx != null && Number.isFinite(Number(customStyle.marginXPx))
        ? Number(customStyle.marginXPx)
        : null
  const offsetYPx =
    customStyle.offsetYPx != null && Number.isFinite(Number(customStyle.offsetYPx))
      ? Number(customStyle.offsetYPx)
      : customStyle.marginYPx != null && Number.isFinite(Number(customStyle.marginYPx))
        ? Number(customStyle.marginYPx)
        : null

  if (offsetXPx != null && Math.abs(offsetXPx - Number(baseOffsetXPx || 0)) > 0.5) {
    out.offsetXPx = offsetXPx
  }
  if (offsetYPx != null && Math.abs(offsetYPx - Number(baseOffsetYPx || 0)) > 0.5) {
    out.offsetYPx = offsetYPx
  }
  const nextPlacementRect = normalizeScreenTitlePlacementRect((customStyle as any).placementRect)
  const basePlacementRect = normalizeScreenTitlePlacementRect((basePreset as any)?.placementRect)
  if (nextPlacementRect) {
    const samePlacement =
      basePlacementRect &&
      Math.abs(Number(nextPlacementRect.xPct) - Number(basePlacementRect.xPct)) < 0.001 &&
      Math.abs(Number(nextPlacementRect.yPct) - Number(basePlacementRect.yPct)) < 0.001 &&
      Math.abs(Number(nextPlacementRect.wPct) - Number(basePlacementRect.wPct)) < 0.001 &&
      Math.abs(Number(nextPlacementRect.hPct) - Number(basePlacementRect.hPct)) < 0.001
    if (!samePlacement) out.placementRect = nextPlacementRect
  }

  return Object.keys(out).length ? out : null
}

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3)
export const easeInCubic = (t: number): number => Math.pow(clamp01(t), 3)

export const normalizeSpeedPresetMs = (valueRaw: number, fallback = 600): number => {
  const raw = Number(valueRaw)
  const value = Number.isFinite(raw) ? Math.round(raw) : fallback
  if (value <= 500) return 400
  if (value <= 700) return 600
  return 800
}
