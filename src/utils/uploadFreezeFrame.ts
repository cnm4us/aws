function clamp(n: number, min: number, max: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, v))
}

export function buildUploadFreezeFrameKey(opts: { uploadId: number; atSeconds: number; longEdgePx?: number }): string {
  const id = Number(opts.uploadId)
  const ms = Math.max(0, Math.round(Number(opts.atSeconds) * 1000))
  const longEdgePx = Math.max(64, Math.min(2160, Math.round(clamp(Number(opts.longEdgePx ?? 1080), 64, 2160))))
  return `images/freeze-frames/uploads/${id}/t_${ms}_le${longEdgePx}.png`
}

