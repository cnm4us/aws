export function buildUploadTimelineSpritePrefix(uploadId: number): string {
  const id = Number(uploadId)
  return `proxies/uploads/${id}/timeline/`
}

export function buildUploadTimelineManifestKey(uploadId: number): string {
  const id = Number(uploadId)
  return `${buildUploadTimelineSpritePrefix(id)}manifest.json`
}

export function buildUploadTimelineSpriteKey(uploadId: number, startSecond: number): string {
  const id = Number(uploadId)
  const s = Math.max(0, Math.floor(Number(startSecond) || 0))
  return `${buildUploadTimelineSpritePrefix(id)}sprite_${s}.jpg`
}

