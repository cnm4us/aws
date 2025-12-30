import React, { useEffect, useMemo, useState } from 'react'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

async function ensureLoggedIn(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' })
    if (!res.ok) throw new Error('not_authenticated')
    const data = (await res.json()) as MeResponse
    if (!data || !data.userId) return null
    return data
  } catch {
    return null
  }
}

type UploadDetail = {
  id: number
  original_filename: string
  modified_filename?: string | null
  description?: string | null
  status: string
  size_bytes?: number | null
  width?: number | null
  height?: number | null
  created_at?: string | null
  poster_portrait_cdn?: string | null
  poster_landscape_cdn?: string | null
  poster_cdn?: string | null
  poster_portrait_s3?: string | null
  poster_landscape_s3?: string | null
  poster_s3?: string | null
}

type AssetItem = {
  id: number
  original_filename: string
  modified_filename: string | null
  content_type?: string | null
  size_bytes?: number | null
  created_at?: string | null
}

function parseUploadId(): number | null {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('upload')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function pickPoster(upload: UploadDetail): string | null {
  return (
    upload.poster_portrait_cdn ||
    upload.poster_landscape_cdn ||
    upload.poster_cdn ||
    upload.poster_portrait_s3 ||
    upload.poster_landscape_s3 ||
    upload.poster_s3 ||
    null
  )
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

export default function ProducePage() {
  const uploadId = useMemo(() => parseUploadId(), [])
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined)
  const [authChecked, setAuthChecked] = useState(false)
  const [upload, setUpload] = useState<UploadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [productionName, setProductionName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [logos, setLogos] = useState<AssetItem[]>([])
  const [audios, setAudios] = useState<AssetItem[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetsError, setAssetsError] = useState<string | null>(null)
  const [selectedLogoId, setSelectedLogoId] = useState<number | null>(null)
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!uploadId) {
      setError('Missing upload id.')
      setLoading(false)
      return
    }
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const user = await ensureLoggedIn()
        if (!cancelled) {
          setMe(user)
          setAuthChecked(true)
        }
        const res = await fetch(`/api/uploads/${uploadId}`, { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Failed to load upload')
        if (!cancelled) setUpload(data)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load upload')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uploadId])

  useEffect(() => {
    let cancelled = false
    if (!authChecked || !me?.userId) return
    ;(async () => {
      setAssetsLoading(true)
      setAssetsError(null)
      try {
        const base = new URLSearchParams({ user_id: String(me.userId), limit: '200', status: 'uploaded' })
        const logoParams = new URLSearchParams(base)
        logoParams.set('kind', 'logo')
        const audioParams = new URLSearchParams(base)
        audioParams.set('kind', 'audio')
        const [logoRes, audioRes] = await Promise.all([
          fetch(`/api/uploads?${logoParams.toString()}`, { credentials: 'same-origin' }),
          fetch(`/api/uploads?${audioParams.toString()}`, { credentials: 'same-origin' }),
        ])
        const logoJson = await logoRes.json().catch(() => [])
        const audioJson = await audioRes.json().catch(() => [])
        if (!logoRes.ok) throw new Error('Failed to load logos')
        if (!audioRes.ok) throw new Error('Failed to load audio')
        if (cancelled) return
        setLogos(Array.isArray(logoJson) ? logoJson : [])
        setAudios(Array.isArray(audioJson) ? audioJson : [])
      } catch (e: any) {
        if (!cancelled) setAssetsError(e?.message || 'Failed to load assets')
      } finally {
        if (!cancelled) setAssetsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authChecked, me?.userId])

  const backHref = uploadId ? `/productions?upload=${encodeURIComponent(String(uploadId))}` : '/productions'

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
          <h1 style={{ margin: '12px 0 0', fontSize: 28 }}>Build Production</h1>
          <p style={{ marginTop: 16, color: '#bbb' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (error || !upload) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
          <h1 style={{ margin: '12px 0 0', fontSize: 28 }}>Build Production</h1>
          <p style={{ marginTop: 16, color: '#ff9b9b' }}>{error || 'Upload not found.'}</p>
        </div>
      </div>
    )
  }

  const displayName = upload.modified_filename || upload.original_filename || `Upload ${upload.id}`
  const poster = pickPoster(upload)

  const onProduce = async () => {
    if (!uploadId) return
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf

      const body: any = {
        uploadId,
        musicUploadId: selectedAudioId ?? null,
        logoUploadId: selectedLogoId ?? null,
      }
      const trimmedName = productionName.trim()
      if (trimmedName) body.name = trimmedName

      const res = await fetch('/api/productions', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to create production')
      const id = Number(data?.production?.id)
      if (!Number.isFinite(id) || id <= 0) throw new Error('Missing production id')
      window.location.href = `/productions?id=${encodeURIComponent(String(id))}`
    } catch (e: any) {
      setCreateError(e?.message || 'Failed to create production')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
        <header style={{ margin: '12px 0 18px' }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 28 }}>Build Production</h1>
          <div style={{ color: '#bbb' }}>{displayName}</div>
        </header>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            {poster ? (
              <img src={poster} alt="poster" style={{ width: 280, borderRadius: 12, background: '#111', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 280, height: 158, borderRadius: 12, background: '#222' }} />
            )}
            <div style={{ marginTop: 10, color: '#888', fontSize: 13 }}>
              {upload.status}
              {upload.size_bytes != null ? ` • ${formatBytes(upload.size_bytes)}` : ''}
              {upload.width && upload.height ? ` • ${upload.width}×${upload.height}` : ''}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 260 }}>
            <section style={{ padding: 14, borderRadius: 12, background: '#0e0e0e', border: '1px solid #1f1f1f' }}>
              <div style={{ fontSize: 13, fontWeight: 650, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.8, marginBottom: 10 }}>
                Optional Enhancements
              </div>

              {authChecked && !me?.userId ? (
                <div style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)', color: '#bbb', marginBottom: 12 }}>
                  Sign in to select logos and audio for this production.
                </div>
              ) : null}

              <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                <div style={{ color: '#bbb' }}>Production Name (optional)</div>
                <input
                  value={productionName}
                  onChange={(e) => setProductionName(e.target.value)}
                  placeholder="Name this production"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid #2a2a2a',
                    background: '#0c0c0c',
                    color: '#fff',
                    outline: 'none',
                  }}
                />
              </label>

              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ color: '#bbb', fontWeight: 650 }}>Audio</div>
                  <a href="/uploads?kind=audio" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13 }}>Manage audio</a>
                </div>
                {assetsLoading ? (
                  <div style={{ color: '#777' }}>Loading audio…</div>
                ) : assetsError ? (
                  <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
                ) : audios.length === 0 ? (
                  <div style={{ color: '#777' }}>
                    No audio uploaded yet. <a href="/uploads/new?kind=audio" style={{ color: '#9cf' }}>Upload audio</a>.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="radio" name="audio" checked={selectedAudioId == null} onChange={() => setSelectedAudioId(null)} />
                      <div style={{ color: '#bbb' }}>None</div>
                    </label>
                    {audios.slice(0, 20).map((a) => {
                      const name = (a.modified_filename || a.original_filename || `Audio ${a.id}`).trim()
                      const src = `/api/uploads/${encodeURIComponent(String(a.id))}/file`
                      return (
                        <label key={a.id} style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <input type="radio" name="audio" checked={selectedAudioId === a.id} onChange={() => setSelectedAudioId(a.id)} />
                            <div style={{ fontWeight: 650 }}>{name}</div>
                          </div>
                          <audio controls preload="none" src={src} style={{ width: '100%' }} />
                        </label>
                      )
                    })}
                    {audios.length > 20 ? <div style={{ color: '#777', fontSize: 13 }}>Showing first 20. Manage audio to pick others.</div> : null}
                  </div>
                )}

                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />

                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ color: '#bbb', fontWeight: 650 }}>Logo</div>
                  <a href="/uploads?kind=logo" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13 }}>Manage logos</a>
                </div>
                {assetsLoading ? (
                  <div style={{ color: '#777' }}>Loading logos…</div>
                ) : assetsError ? (
                  <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
                ) : logos.length === 0 ? (
                  <div style={{ color: '#777' }}>
                    No logo uploaded yet. <a href="/uploads/new?kind=logo" style={{ color: '#9cf' }}>Upload a logo</a>.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="radio" name="logo" checked={selectedLogoId == null} onChange={() => setSelectedLogoId(null)} />
                      <div style={{ color: '#bbb' }}>None</div>
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                      {logos.slice(0, 12).map((l) => {
                        const name = (l.modified_filename || l.original_filename || `Logo ${l.id}`).trim()
                        const src = `/api/uploads/${encodeURIComponent(String(l.id))}/file`
                        return (
                          <label key={l.id} style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <input type="radio" name="logo" checked={selectedLogoId === l.id} onChange={() => setSelectedLogoId(l.id)} />
                              <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                              <img src={src} alt="logo" style={{ width: 96, height: 96, objectFit: 'contain', background: '#111', borderRadius: 10 }} />
                            </div>
                          </label>
                        )
                      })}
                    </div>
                    {logos.length > 12 ? <div style={{ color: '#777', fontSize: 13 }}>Showing first 12. Manage logos to pick others.</div> : null}
                  </div>
                )}
              </div>
            </section>

            <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={onProduce}
                disabled={creating}
                style={{
                  background: '#0a84ff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  padding: '10px 18px',
                  fontWeight: 700,
                  opacity: creating ? 0.7 : 1,
                  cursor: creating ? 'default' : 'pointer',
                }}
              >
                {creating ? 'Starting…' : 'Produce'}
              </button>
              {createError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{createError}</div> : <div style={{ color: '#888', fontSize: 13 }}>Selections are saved to the production for future rendering.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
