type CdnUrlResponse = { url?: string; expiresAt?: number }

const cache = new Map<string, { url: string; expiresAt: number }>()

function cacheKey(uploadId: number, kind: string): string {
  return `${uploadId}:${kind}`
}

export async function getUploadCdnUrl(
  uploadId: number,
  opts: { kind: 'file' | 'thumb' | 'edit-proxy' }
): Promise<string | null> {
  const id = Number(uploadId)
  if (!Number.isFinite(id) || id <= 0) return null
  const kind = String(opts.kind || '').trim()
  if (!kind) return null

  const k = cacheKey(id, kind)
  const now = Math.floor(Date.now() / 1000)
  const existing = cache.get(k)
  if (existing && existing.expiresAt - now > 30) return existing.url

  const qs = new URLSearchParams()
  qs.set('kind', kind)

  try {
    const res = await fetch(`/api/uploads/${encodeURIComponent(String(id))}/cdn-url?${qs.toString()}`, {
      credentials: 'same-origin',
    })
    const json = (await res.json().catch(() => null)) as CdnUrlResponse | null
    if (!res.ok) return null
    const url = json?.url ? String(json.url) : ''
    const expiresAt = json?.expiresAt != null ? Number(json.expiresAt) : 0
    if (!url || !Number.isFinite(expiresAt) || expiresAt <= 0) return null
    cache.set(k, { url, expiresAt })
    return url
  } catch {
    return null
  }
}
