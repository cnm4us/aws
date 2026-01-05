import { Resvg } from '@resvg/resvg-js'

export type SvgViewBox = { width: number; height: number }

export function parseSvgViewBox(svg: string): SvgViewBox {
  const s = String(svg || '')
  const m = s.match(/viewBox\s*=\s*["']\s*([0-9.+-eE]+)\s+([0-9.+-eE]+)\s+([0-9.+-eE]+)\s+([0-9.+-eE]+)\s*["']/i)
  if (m) {
    const w = Number(m[3])
    const h = Number(m[4])
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h }
  }
  const mw = s.match(/\bwidth\s*=\s*["']\s*([0-9.+-eE]+)\s*["']/i)
  const mh = s.match(/\bheight\s*=\s*["']\s*([0-9.+-eE]+)\s*["']/i)
  const w = mw ? Number(mw[1]) : NaN
  const h = mh ? Number(mh[1]) : NaN
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h }
  return { width: 1920, height: 200 }
}

export function rasterizeLowerThirdSvgToPng(svg: string, opts?: { targetWidthPx?: number }): { png: Buffer; viewBox: SvgViewBox } {
  const viewBox = parseSvgViewBox(svg)
  const targetWidthPx = opts?.targetWidthPx != null ? Math.round(Number(opts.targetWidthPx)) : 1920
  const safeWidth = Number.isFinite(targetWidthPx) && targetWidthPx > 0 ? targetWidthPx : 1920
  const targetHeightPx = Math.max(1, Math.round(safeWidth * (viewBox.height / viewBox.width)))

  const resvg = new Resvg(String(svg || ''), {
    fitTo: { mode: 'width', value: safeWidth },
    background: 'transparent',
  })
  const rendered = resvg.render()
  const png = Buffer.from(rendered.asPng())
  // Note: rendered output might not exactly match computed height, but aspect ratio should align.
  void targetHeightPx
  return { png, viewBox }
}

