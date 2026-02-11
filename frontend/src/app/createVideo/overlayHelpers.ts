import type { CSSProperties } from 'react'

export function normalizeLegacyPosition(pos: string): string {
  return pos === 'center' ? 'middle_center' : pos
}

function insetPctForPreset(preset: any): number {
  const p = String(preset || '').toLowerCase()
  if (p === 'small') return 0.06
  if (p === 'large') return 0.14
  return 0.10
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

export function ellipsizeText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const raw = String(text || '')
  if (!raw) return ''
  if (ctx.measureText(raw).width <= maxWidth) return raw
  const ell = '…'
  const ellW = ctx.measureText(ell).width
  const target = Math.max(0, maxWidth - ellW)
  if (target <= 0) return ell
  let lo = 0
  let hi = raw.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const s = raw.slice(0, mid)
    if (ctx.measureText(s).width <= target) lo = mid
    else hi = mid - 1
  }
  return raw.slice(0, Math.max(0, lo)) + ell
}

export function computeOverlayCssNoOpacity(cfg: {
  position?: string | null
  sizePctWidth?: number | null
  insetXPreset?: string | null
  insetYPreset?: string | null
  insetXPx?: number | null
  insetYPx?: number | null
}): CSSProperties {
  const clampNumber = (n: any, min: number, max: number): number => {
    const v = Number(n)
    if (!Number.isFinite(v)) return min
    return Math.min(Math.max(v, min), max)
  }
  const sizePctWidth = clampNumber(cfg.sizePctWidth ?? 15, 1, 100)
  const posRaw = String(cfg.position || 'bottom_right')
  const pos = normalizeLegacyPosition(posRaw)
  const [rowRaw, colRaw] = String(pos).split('_') as [string, string]
  const row = rowRaw || 'bottom'
  const col = colRaw || 'right'
  const yMode = row === 'top' ? 'top' : row === 'bottom' ? 'bottom' : 'middle'
  const xMode = col === 'left' ? 'left' : col === 'right' ? 'right' : 'center'
  // Inset is specified in px relative to a 1080x1920 baseline (Create Video export resolution).
  // If missing, fall back to legacy preset-based insets.
  const insetXPxRaw = cfg.insetXPx != null ? Number(cfg.insetXPx) : NaN
  const insetYPxRaw = cfg.insetYPx != null ? Number(cfg.insetYPx) : NaN
  const insetXPct = Number.isFinite(insetXPxRaw) ? (clampNumber(insetXPxRaw, 0, 9999) / 1080) * 100 : insetPctForPreset(cfg.insetXPreset) * 100
  const insetYPct = Number.isFinite(insetYPxRaw) ? (clampNumber(insetYPxRaw, 0, 9999) / 1920) * 100 : insetPctForPreset(cfg.insetYPreset) * 100
  const marginXPct = xMode === 'center' ? 0 : insetXPct
  const marginYPct = yMode === 'middle' ? 0 : insetYPct

  const style: CSSProperties = {
    position: 'absolute',
    width: `${sizePctWidth}%`,
    height: 'auto',
    pointerEvents: 'none',
  }
  let transform = ''
  if (xMode === 'left') style.left = `${marginXPct}%`
  else if (xMode === 'right') style.right = `${marginXPct}%`
  else {
    style.left = '50%'
    transform += ' translateX(-50%)'
  }
  if (yMode === 'top') style.top = `${marginYPct}%`
  else if (yMode === 'bottom') style.bottom = `${marginYPct}%`
  else {
    style.top = '50%'
    transform += ' translateY(-50%)'
  }
  if (transform.trim()) style.transform = transform.trim()
  return style
}

export function computeSegmentTimingWindow(cfg: { timingRule?: any; timingSeconds?: any }, segmentDurationSeconds: number): { startRelS: number; endRelS: number } {
  const rule = String(cfg.timingRule || 'entire').toLowerCase()
  const secsRaw = cfg.timingSeconds == null ? null : Number(cfg.timingSeconds)
  const secs = secsRaw != null && Number.isFinite(secsRaw) ? Math.max(0, secsRaw) : null
  const totalS = Math.max(0, Number.isFinite(segmentDurationSeconds) ? segmentDurationSeconds : 0)
  if (rule === 'start_after') {
    const startRelS = Math.min(totalS, secs ?? 0)
    return { startRelS, endRelS: totalS }
  }
  if (rule === 'first_only') {
    const d = secs ?? 0
    return { startRelS: 0, endRelS: Math.max(0, Math.min(d, totalS)) }
  }
  if (rule === 'last_only') {
    const d = secs ?? totalS
    const endRelS = totalS
    const startRelS = Math.max(0, endRelS - Math.max(0, Math.min(d, totalS)))
    return { startRelS, endRelS }
  }
  return { startRelS: 0, endRelS: totalS }
}

export function maybePromoteLowerThirdTimingOnExpand(prevSeg: any, nextSeg: any): any {
  if (!prevSeg || !nextSeg) return nextSeg
  const prevDur = Math.max(0, Number(prevSeg.endSeconds || 0) - Number(prevSeg.startSeconds || 0))
  const nextDur = Math.max(0, Number(nextSeg.endSeconds || 0) - Number(nextSeg.startSeconds || 0))
  if (!(nextDur > prevDur + 0.05)) return nextSeg

  const cfg0 = prevSeg.configSnapshot
  if (!cfg0 || typeof cfg0 !== 'object') return nextSeg
  const rule = String((cfg0 as any).timingRule || 'entire').toLowerCase()
  if (rule !== 'first_only') return nextSeg
  const secsRaw = (cfg0 as any).timingSeconds
  const secs = secsRaw == null ? null : Number(secsRaw)
  if (!(secs != null && Number.isFinite(secs))) return nextSeg

  const visiblePrev = Math.max(0, Math.min(secs, prevDur))
  // Only auto-promote when the old first_only config effectively covered the entire old segment.
  if (Math.abs(visiblePrev - prevDur) > 0.05) return nextSeg

  return {
    ...(nextSeg as any),
    configSnapshot: {
      ...(cfg0 as any),
      timingRule: 'entire',
      timingSeconds: null,
    },
  }
}

export function computeFadeAlpha(cfg: { fade?: any }, tRelS: number, windowStartRelS: number, windowEndRelS: number): number {
  const fadeS = 0.5
  const fade = String(cfg.fade || 'none').toLowerCase()
  let a = 1
  if ((fade === 'in' || fade === 'in_out') && fadeS > 0) {
    const x = (tRelS - windowStartRelS) / fadeS
    a *= Math.min(1, Math.max(0, x))
  }
  if ((fade === 'out' || fade === 'in_out') && fadeS > 0) {
    const x = (windowEndRelS - tRelS) / fadeS
    a *= Math.min(1, Math.max(0, x))
  }
  return a
}
