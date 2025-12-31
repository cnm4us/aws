import React, { useEffect, useMemo, useState } from 'react'
import CompactAudioPlayer from '../components/CompactAudioPlayer'

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

type LogoConfig = {
  id: number
  name: string
  position: string
  sizePctWidth: number
  opacityPct: number
  timingRule: string
  timingSeconds: number | null
  fade: string
}

function parseUploadId(): number | null {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('upload')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function parsePick(): 'audio' | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('pick') || '').toLowerCase()
    if (raw === 'audio') return 'audio'
  } catch {}
  return null
}

function parseMusicUploadId(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('musicUploadId')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function pushQueryParams(updates: Record<string, string | null>, state: any = {}) {
  const params = new URLSearchParams(window.location.search)
  for (const [k, v] of Object.entries(updates)) {
    if (v == null || v === '') params.delete(k)
    else params.set(k, v)
  }
  const qs = params.toString()
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  window.history.pushState(state, '', next)
}

function replaceQueryParams(updates: Record<string, string | null>, state: any = window.history.state || {}) {
  const params = new URLSearchParams(window.location.search)
  for (const [k, v] of Object.entries(updates)) {
    if (v == null || v === '') params.delete(k)
    else params.set(k, v)
  }
  const qs = params.toString()
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  window.history.replaceState(state, '', next)
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

type AudioSortMode = 'recent' | 'alpha'

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
  const [logoConfigs, setLogoConfigs] = useState<LogoConfig[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetsError, setAssetsError] = useState<string | null>(null)
  const [selectedLogoId, setSelectedLogoId] = useState<number | null>(null)
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(() => parseMusicUploadId())
  const [selectedLogoConfigId, setSelectedLogoConfigId] = useState<number | null>(null)
  const [initLogoConfigDone, setInitLogoConfigDone] = useState(false)
  const [pick, setPick] = useState<'audio' | null>(() => parsePick())
  const [audioSort, setAudioSort] = useState<AudioSortMode>('recent')

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
    const applyFromLocation = () => {
      setPick(parsePick())
      // If we came back from a picker selection, prefer the pending selection.
      try {
        const pendingRaw = sessionStorage.getItem('produce:pendingMusicUploadId')
        if (pendingRaw !== null) {
          sessionStorage.removeItem('produce:pendingMusicUploadId')
          const pending = pendingRaw === '' ? null : Number(pendingRaw)
          const nextId = pending != null && Number.isFinite(pending) && pending > 0 ? pending : null
          setSelectedAudioId(nextId)
          replaceQueryParams({ musicUploadId: nextId == null ? null : String(nextId), pick: null }, { ...(window.history.state || {}), modal: null })
          return
        }
      } catch {}
      setSelectedAudioId(parseMusicUploadId())
    }
    window.addEventListener('popstate', applyFromLocation)
    return () => window.removeEventListener('popstate', applyFromLocation)
  }, [])

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
        const [logoRes, audioRes, cfgRes] = await Promise.all([
          fetch(`/api/uploads?${logoParams.toString()}`, { credentials: 'same-origin' }),
          fetch(`/api/uploads?${audioParams.toString()}`, { credentials: 'same-origin' }),
          fetch(`/api/logo-configs`, { credentials: 'same-origin' }),
        ])
        const logoJson = await logoRes.json().catch(() => [])
        const audioJson = await audioRes.json().catch(() => [])
        const cfgJson = await cfgRes.json().catch(() => [])
        if (!logoRes.ok) throw new Error('Failed to load logos')
        if (!audioRes.ok) throw new Error('Failed to load audio')
        if (!cfgRes.ok) throw new Error('Failed to load logo configurations')
        if (cancelled) return
        setLogos(Array.isArray(logoJson) ? logoJson : [])
        setAudios(Array.isArray(audioJson) ? audioJson : [])
        const cfgs = Array.isArray(cfgJson) ? (cfgJson as any[]) : []
        setLogoConfigs(cfgs as any)

        if (!initLogoConfigDone) {
          const standard = cfgs.find((c) => String(c?.name || '').trim().toLowerCase() === 'standard watermark')
          if (standard && standard.id && selectedLogoConfigId == null) {
            setSelectedLogoConfigId(Number(standard.id))
          }
          setInitLogoConfigDone(true)
        }
      } catch (e: any) {
        if (!cancelled) setAssetsError(e?.message || 'Failed to load assets')
      } finally {
        if (!cancelled) setAssetsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authChecked, me?.userId, initLogoConfigDone, selectedLogoConfigId])

  const selectedAudio = useMemo(() => {
    if (selectedAudioId == null) return null
    return audios.find((a) => a.id === selectedAudioId) || null
  }, [audios, selectedAudioId])

  const sortedAudios = useMemo(() => {
    const items = Array.isArray(audios) ? [...audios] : []
    const nameFor = (a: AssetItem) => String((a.modified_filename || a.original_filename || '')).trim().toLowerCase()
    if (audioSort === 'alpha') {
      items.sort((a, b) => nameFor(a).localeCompare(nameFor(b)))
      return items
    }
    items.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })
    return items
  }, [audios, audioSort])

  const openAudioPicker = () => {
    setPick('audio')
    pushQueryParams({ pick: 'audio' }, { ...(window.history.state || {}), modal: 'audioPicker' })
  }

  const closePicker = () => {
    setPick(null)
    replaceQueryParams({ pick: null }, { ...(window.history.state || {}), modal: null })
  }

  const applyMusicSelection = (id: number | null) => {
    setSelectedAudioId(id)
    replaceQueryParams({ musicUploadId: id == null ? null : String(id) }, { ...(window.history.state || {}), modal: null })
  }

  const chooseAudio = (id: number | null) => {
    // Called from the main /produce screen (not the picker).
    applyMusicSelection(id)
  }

  const chooseAudioFromPicker = (id: number | null) => {
    setPick(null)
    const modal = (window.history.state as any)?.modal
    if (modal === 'audioPicker') {
      try {
        sessionStorage.setItem('produce:pendingMusicUploadId', id == null ? '' : String(id))
      } catch {}
      try {
        window.history.back()
        return
      } catch {}
    }
    // Direct-entry into ?pick=audio (no modal history state): just close in-place.
    applyMusicSelection(id)
    closePicker()
  }

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
        logoConfigId: selectedLogoConfigId ?? null,
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
                  <div style={{ display: 'grid', gap: 8, padding: '8px 10px 10px', borderRadius: 12, border: '1px solid rgba(212,175,55,0.75)', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ color: '#d4af37', fontWeight: 800 }}>
                        {selectedAudio ? (selectedAudio.modified_filename || selectedAudio.original_filename || `Audio ${selectedAudio.id}`) : 'None'}
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button
                          type="button"
                          onClick={openAudioPicker}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(212,175,55,0.85)',
                            background: 'rgba(212,175,55,0.14)',
                            color: '#d4af37',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Choose
                        </button>
                        {selectedAudioId != null ? (
                          <button
                            type="button"
                            onClick={() => chooseAudio(null)}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(212,175,55,0.65)',
                              background: 'rgba(212,175,55,0.10)',
                              color: '#d4af37',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {selectedAudioId != null ? (
                      <CompactAudioPlayer src={`/api/uploads/${encodeURIComponent(String(selectedAudioId))}/file`} />
                    ) : (
                      <div style={{ color: '#777', fontSize: 13 }}>Select an audio track to replace the production audio (optional).</div>
                    )}
                  </div>
                )}

                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />

                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ color: '#bbb', fontWeight: 650 }}>Logo Config</div>
                  <a href="/logo-configs" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13 }}>Manage configs</a>
                </div>
                {assetsLoading ? (
                  <div style={{ color: '#777' }}>Loading logo configurations…</div>
                ) : assetsError ? (
                  <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
                ) : logoConfigs.length === 0 ? (
                  <div style={{ color: '#777' }}>
                    No logo configurations yet. <a href="/logo-configs" style={{ color: '#9cf' }}>Create a preset</a>.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="radio" name="logoCfg" checked={selectedLogoConfigId == null} onChange={() => setSelectedLogoConfigId(null)} />
                      <div style={{ color: '#bbb' }}>None</div>
                    </label>
                    {logoConfigs.slice(0, 12).map((c) => {
                      const name = (c.name || `Config ${c.id}`).trim()
                      const summary = [
                        c.position ? String(c.position).replace('_', '-') : null,
                        c.sizePctWidth != null ? `${c.sizePctWidth}%` : null,
                        c.opacityPct != null ? `${c.opacityPct}%` : null,
                        c.timingRule ? String(c.timingRule).replace('_', ' ') : null,
                        c.fade ? String(c.fade).replace('_', ' ') : null,
                      ].filter(Boolean).join(' • ')
                      return (
                        <label key={c.id} style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <input type="radio" name="logoCfg" checked={selectedLogoConfigId === c.id} onChange={() => setSelectedLogoConfigId(c.id)} />
                            <div style={{ fontWeight: 650 }}>{name}</div>
                          </div>
                          {summary ? <div style={{ color: '#777', fontSize: 13 }}>{summary}</div> : null}
                        </label>
                      )
                    })}
                    {logoConfigs.length > 12 ? <div style={{ color: '#777', fontSize: 13 }}>Showing first 12. Manage configs to pick others.</div> : null}
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

      {pick === 'audio' ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: '#050505',
            color: '#fff',
            zIndex: 10050,
            overflow: 'auto',
          }}
        >
          <div style={{ maxWidth: 960, margin: '0 auto', padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px max(24px, env(safe-area-inset-bottom, 0px))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => {
                  const modal = (window.history.state as any)?.modal
                  if (modal === 'audioPicker') {
                    try { window.history.back(); return } catch {}
                  }
                  closePicker()
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Choose Audio</div>
              <div style={{ width: 84 }} />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ color: '#bbb', fontWeight: 700 }}>Sort</div>
              <button
                type="button"
                onClick={() => setAudioSort('recent')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: audioSort === 'recent' ? '#0a84ff' : '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Recent
              </button>
              <button
                type="button"
                onClick={() => setAudioSort('alpha')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: audioSort === 'alpha' ? '#0a84ff' : '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Alphabetical
              </button>
              <a href="/uploads?kind=audio" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13, marginLeft: 'auto' }}>Manage audio</a>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <button
                type="button"
                onClick={() => chooseAudioFromPicker(null)}
                style={{
                  textAlign: 'left',
                  padding: 12,
                  borderRadius: 12,
                  border: selectedAudioId == null ? '1px solid rgba(10,132,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
                  background: selectedAudioId == null ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.03)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                None
              </button>

              {assetsLoading ? (
                <div style={{ color: '#888' }}>Loading audio…</div>
              ) : assetsError ? (
                <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
              ) : sortedAudios.length === 0 ? (
                <div style={{ color: '#bbb' }}>
                  No audio uploaded yet. <a href="/uploads/new?kind=audio" style={{ color: '#9cf' }}>Upload audio</a>.
                </div>
              ) : (
                sortedAudios.map((a) => {
                  const name = (a.modified_filename || a.original_filename || `Audio ${a.id}`).trim()
                  const src = `/api/uploads/${encodeURIComponent(String(a.id))}/file`
                  const selected = selectedAudioId === a.id
                  return (
                    <div
                      key={a.id}
                      style={{
                        padding: '8px 12px 12px',
                        borderRadius: 12,
                        border: selected ? '1px solid rgba(10,132,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
                        background: selected ? 'rgba(10,132,255,0.30)' : 'rgba(255,255,255,0.03)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                        <div style={{ fontWeight: 800, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                        <button
                          type="button"
                          onClick={() => chooseAudioFromPicker(a.id)}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(212,175,55,0.55)',
                            background: selected ? 'rgba(212,175,55,0.16)' : 'rgba(212,175,55,0.10)',
                            color: '#d4af37',
                            fontWeight: 800,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {selected ? 'Selected' : 'Select'}
                        </button>
                      </div>
                      <div style={{ color: '#888', fontSize: 13, marginBottom: 8 }}>
                        {formatBytes(a.size_bytes)}{a.created_at ? ` • ${String(a.created_at).slice(0, 10)}` : ''}
                      </div>
                      <CompactAudioPlayer src={src} />
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
