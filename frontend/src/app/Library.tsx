import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './styles/card-list.css'
import { cardThemeStyle, cardThemeTokens, mergeCardThemeVars } from './styles/cardThemes'
import nebulaBgImage from './images/nebula_bg.jpg'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type LibraryVideo = {
  id: number
  modified_filename?: string | null
  original_filename?: string | null
  description?: string | null
  duration_seconds?: number | null
  width?: number | null
  height?: number | null
  source_org?: string | null
}

type TranscriptHit = {
  startSeconds: number
  endSeconds: number
  text: string
}

type AudioEnvelope = {
  hasAudio?: boolean
  points?: Array<{ t: number; v: number }>
}

type LibrarySourceOption = {
  value: string
  label: string
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

function getCsrfToken(): string | null {
  try {
    const match = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

function formatDuration(seconds: number | null | undefined): string {
  const s = seconds == null ? 0 : Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return ''
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

function formatTime(seconds: number | null | undefined): string {
  const s = seconds == null ? 0 : Math.max(0, Number(seconds))
  if (!Number.isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

function truncateWords(text: string, limit: number): { text: string; truncated: boolean } {
  const trimmed = String(text || '').trim()
  if (!trimmed) return { text: '', truncated: false }
  const words = trimmed.split(/\s+/)
  if (words.length <= limit) return { text: trimmed, truncated: false }
  return { text: `${words.slice(0, limit).join(' ')}…`, truncated: true }
}

const FALLBACK_LIBRARY_SOURCES: LibrarySourceOption[] = [
  { value: 'cspan', label: 'CSPAN' },
  { value: 'glenn kirschner', label: 'Glenn Kirschner' },
  { value: 'other', label: 'Other' },
]

function normalizeLibrarySources(items: any): LibrarySourceOption[] {
  if (!Array.isArray(items)) return []
  const normalized: LibrarySourceOption[] = []
  for (const item of items) {
    if (!item) continue
    const value = String(item.value || '').trim().toLowerCase()
    const label = String(item.label || '').trim()
    if (!value || !label) continue
    normalized.push({ value, label })
  }
  return normalized
}

function getLibrarySourceLabel(value: string | null | undefined, options: LibrarySourceOption[]): string | null {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return null
  const hit = options.find((opt) => opt.value === v)
  return hit ? hit.label : null
}

function useLibrarySourceOptions(): LibrarySourceOption[] {
  const [options, setOptions] = useState<LibrarySourceOption[]>(FALLBACK_LIBRARY_SOURCES)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/library/source-orgs', { credentials: 'same-origin' })
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_load'))
        const items = normalizeLibrarySources(json?.items)
        if (!cancelled && items.length) setOptions(items)
      } catch {
        if (!cancelled) setOptions(FALLBACK_LIBRARY_SOURCES)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return options
}

type LibraryListPageProps = {
  embedded?: boolean
  basePath?: string
  clipBasePath?: string
  showSharedScope?: boolean
  defaultSharedScope?: 'system' | 'users'
}

export const LibraryListPage: React.FC<LibraryListPageProps> = ({
  embedded = false,
  basePath,
  clipBasePath = '/library/create-clip',
  showSharedScope = false,
  defaultSharedScope = 'system',
}) => {
  const [videos, setVideos] = useState<LibraryVideo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sourceOrg, setSourceOrg] = useState('all')
  const [sharedScope, setSharedScope] = useState<'system' | 'users'>(defaultSharedScope)
  const [selectedView, setSelectedView] = useState<LibraryVideo | null>(null)
  const [selectedInfo, setSelectedInfo] = useState<LibraryVideo | null>(null)
  const sourceOptions = useLibrarySourceOptions()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const qParam = params.get('q') || ''
    const sourceParam = params.get('source_org') || params.get('sourceOrg') || 'all'
    const sharedParam = params.get('shared_scope') || params.get('sharedScope') || ''
    setQ(qParam)
    setSourceOrg(sourceParam || 'all')
    if (showSharedScope) {
      const nextShared = String(sharedParam || defaultSharedScope).trim().toLowerCase()
      setSharedScope(nextShared === 'users' ? 'users' : 'system')
    }
  }, [])

  const syncUrl = useCallback(
    (nextQ: string, nextSource: string, nextSharedScope: 'system' | 'users') => {
      const params = new URLSearchParams(window.location.search)
      params.delete('q')
      params.delete('source_org')
      params.delete('sourceOrg')
      params.delete('shared_scope')
      params.delete('sharedScope')
      if (nextQ.trim()) params.set('q', nextQ.trim())
      if (nextSource && nextSource !== 'all') params.set('source_org', nextSource)
      if (showSharedScope && nextSharedScope && nextSharedScope !== 'system') params.set('shared_scope', nextSharedScope)
      const qs = params.toString()
      const targetPath = basePath || window.location.pathname || '/library'
      const nextUrl = qs ? `${targetPath}?${qs}` : targetPath
      window.history.replaceState(null, '', nextUrl)
    },
    [basePath, showSharedScope]
  )

  const loadVideos = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (showSharedScope && sharedScope === 'users') {
        setVideos([])
        syncUrl(q, sourceOrg, sharedScope)
        return
      }
      const user = await ensureLoggedIn()
      if (!user?.userId) throw new Error('Please sign in to access the library.')
      const params = new URLSearchParams()
      const qTrim = q.trim()
      if (qTrim) params.set('q', qTrim)
      if (sourceOrg && sourceOrg !== 'all') params.set('source_org', sourceOrg)
      params.set('limit', '200')
      const res = await fetch(`/api/library/videos?${params.toString()}`, { credentials: 'same-origin' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_load'))
      const items: LibraryVideo[] = Array.isArray(json?.items) ? json.items : []
      setVideos(items)
      syncUrl(qTrim, sourceOrg, sharedScope)
    } catch (e: any) {
      setError(e?.message || 'Failed to load library.')
    } finally {
      setLoading(false)
    }
  }, [q, sourceOrg, sharedScope, showSharedScope, syncUrl])

  useEffect(() => {
    void loadVideos()
  }, [loadVideos])

  useEffect(() => {
    if (!sourceOrg || sourceOrg === 'all') return
    const allowed = sourceOptions.some((opt) => opt.value === sourceOrg)
    if (!allowed) setSourceOrg('all')
  }, [sourceOrg, sourceOptions])

  const filterOptions = useMemo(
    () => [{ value: 'all', label: 'All sources' }, ...sourceOptions],
    [sourceOptions]
  )
  const cardListStyle = useMemo(
    () =>
      cardThemeStyle(
        mergeCardThemeVars(cardThemeTokens.base, cardThemeTokens.assetsGlass, {
          '--card-list-gap': '14px',
          '--card-bg-image': 'none',
        })
      ),
    []
  )

  const sharedScopeOptions = [
    { value: 'system', label: 'System' },
    { value: 'users', label: 'Other Users' },
  ]

  const content = (
    <>
      {!embedded ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 26 }}>Video Library</h1>
        </div>
      ) : null}

      <div style={{ marginTop: embedded ? 0 : 16, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {showSharedScope ? (
            <select
              value={sharedScope}
              onChange={(e) => setSharedScope(String(e.target.value) === 'users' ? 'users' : 'system')}
              style={{
                minWidth: 160,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0b0b0b',
                color: '#fff',
                fontSize: 16,
              }}
            >
              {sharedScopeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : null}
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name/description"
              style={{
                flex: '1 1 240px',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0b0b0b',
                color: '#fff',
                fontSize: 16,
              }}
            />
            <select
              value={sourceOrg}
              onChange={(e) => setSourceOrg(String(e.target.value))}
              style={{
                minWidth: 160,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0b0b0b',
                color: '#fff',
                fontSize: 16,
              }}
            >
              {filterOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void loadVideos()}
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 700,
              }}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
          {error ? <div style={{ color: '#ffb3b3' }}>{error}</div> : null}
        </div>

        <div style={{ marginTop: 18, display: 'grid', gap: 16 }}>
          <div className="card-list" style={cardListStyle}>
            {loading ? <div>Loading…</div> : null}
            {!loading && !videos.length ? (
              <div>{showSharedScope && sharedScope === 'users' ? 'No shared videos yet.' : 'No system videos found.'}</div>
            ) : null}
            {videos.map((v) => {
              const name = (v.modified_filename || v.original_filename || `Video ${v.id}`).toString()
              const sourceLabel =
                getLibrarySourceLabel(v.source_org, sourceOptions) ||
                (v.source_org ? String(v.source_org).toUpperCase() : null)
              const meta = [
                sourceLabel,
                v.duration_seconds ? formatDuration(v.duration_seconds) : null,
                v.width && v.height ? `${v.width}×${v.height}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
              const description = v.description ? String(v.description) : ''
              const clippedDescription = description ? truncateWords(description, 50).text : ''
              const backParams = new URLSearchParams()
              const baseParams = new URLSearchParams(window.location.search)
              baseParams.delete('q')
              baseParams.delete('source_org')
              baseParams.delete('sourceOrg')
              baseParams.delete('shared_scope')
              baseParams.delete('sharedScope')
              for (const [key, value] of baseParams.entries()) backParams.set(key, value)
              if (q.trim()) backParams.set('q', q.trim())
              if (sourceOrg && sourceOrg !== 'all') backParams.set('source_org', sourceOrg)
              if (showSharedScope && sharedScope !== 'system') backParams.set('shared_scope', sharedScope)
              const qs = backParams.toString()
              const clipHref = qs
                ? `${clipBasePath}/${encodeURIComponent(String(v.id))}?${qs}`
                : `${clipBasePath}/${encodeURIComponent(String(v.id))}`

              return (
                <div key={v.id} className="card-item">
                  <button
                    type="button"
                    onClick={() => setSelectedInfo(v)}
                    style={{
                      padding: 0,
                      margin: 0,
                      border: 'none',
                      background: 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div className="card-title" style={{ fontSize: 17 }}>{name}</div>
                  </button>
                  {meta ? <div style={{ color: '#bbb', fontSize: 13 }}>{meta}</div> : null}
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '16 / 9',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: '#0b0b0b',
                      border: '1px solid rgba(255,255,255,0.12)',
                    }}
                  >
                    <img
                      src={`/api/uploads/${encodeURIComponent(String(v.id))}/thumb`}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      onError={(event) => {
                        const target = event.currentTarget
                        target.style.display = 'none'
                      }}
                    />
                  </div>
                  {clippedDescription ? <div className="card-meta" style={{ lineHeight: 1.35 }}>{clippedDescription}</div> : null}
                  <div className="card-actions card-actions-right" style={{ flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedView(v)}
                      className="card-btn card-btn-edit"
                    >
                      View Video
                    </button>
                    <a
                      href={clipHref}
                      className="card-btn card-btn-open"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      Create clip
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {selectedView ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: 20,
            }}
            onClick={() => setSelectedView(null)}
          >
            <div
              style={{
                width: 'min(960px, 100%)',
                background: '#0b0b0b',
                borderRadius: 12,
                padding: 16,
                border: '1px solid rgba(255,255,255,0.12)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 800 }}>{selectedView.modified_filename || selectedView.original_filename}</div>
                <button
                  type="button"
                  onClick={() => setSelectedView(null)}
                  style={{
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#1a1a1a',
                    color: '#fff',
                    borderRadius: 8,
                    padding: '4px 10px',
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div style={{ marginTop: 12 }}>
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={`/api/uploads/${encodeURIComponent(String(selectedView.id))}/edit-proxy#t=0.1`}
                  style={{ width: '100%', maxHeight: '70vh', background: '#000', borderRadius: 10 }}
                />
              </div>
            </div>
          </div>
        ) : null}

        {selectedInfo ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: 20,
            }}
            onClick={() => setSelectedInfo(null)}
          >
            <div
              style={{
                width: 'min(720px, 100%)',
                background: '#0b0b0b',
                borderRadius: 12,
                padding: 16,
                border: '1px solid rgba(255,255,255,0.12)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 800 }}>{selectedInfo.modified_filename || selectedInfo.original_filename}</div>
                <button
                  type="button"
                  onClick={() => setSelectedInfo(null)}
                  style={{
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#1a1a1a',
                    color: '#fff',
                    borderRadius: 8,
                    padding: '4px 10px',
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              {selectedInfo.description ? (
                <div style={{ marginTop: 10, color: '#c8c8c8', fontSize: 14, lineHeight: 1.5 }}>
                  {selectedInfo.description}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
    </>
  )

  if (embedded) return <>{content}</>

  return (
    <div style={{ minHeight: '100vh', color: '#fff', padding: 20, position: 'relative', background: '#050508' }}>
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          backgroundImage: `url(${nebulaBgImage})`,
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'cover',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1100, margin: '0 auto' }}>
        {content}
      </div>
    </div>
  )
}

const LibraryCreateClipPageInner: React.FC = () => {
  const [error, setError] = useState<string | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<LibraryVideo | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TranscriptHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [currentTime, setCurrentTimeState] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [waveEnv, setWaveEnv] = useState<AudioEnvelope | null>(null)
  const [waveStatus, setWaveStatus] = useState<'idle' | 'pending' | 'ready' | 'error'>('idle')
  const [waveError, setWaveError] = useState<string | null>(null)
  const [captionsEnabled, setCaptionsEnabled] = useState(false)
  const [captions, setCaptions] = useState<TranscriptHit[]>([])
  const [captionsStatus, setCaptionsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [captionsError, setCaptionsError] = useState<string | null>(null)
  const [clipStart, setClipStart] = useState<number | null>(null)
  const [clipEnd, setClipEnd] = useState<number | null>(null)
  const [clipTitle, setClipTitle] = useState('')
  const [clipDescription, setClipDescription] = useState('')
  const [showFullDescription, setShowFullDescription] = useState(false)
  const [clipError, setClipError] = useState<string | null>(null)
  const [clipSaving, setClipSaving] = useState(false)
  const [clipMessage, setClipMessage] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const wavePollRef = useRef<number | null>(null)
  const sourceOptions = useLibrarySourceOptions()
  const [isScrubbing, setIsScrubbing] = useState(false)
  const scrubPointerIdRef = useRef<number | null>(null)
  const scrubStartXRef = useRef(0)
  const scrubStartTimeRef = useRef(0)
  const scrubWasPlayingRef = useRef(false)
  const nudgeTimeoutRef = useRef<number | null>(null)
  const nudgeIntervalRef = useRef<number | null>(null)

  const isSharedRoute = useMemo(() => {
    const path = window.location.pathname || ''
    return path.startsWith('/assets/shared/create-clip/')
  }, [])

  const backHref = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const qParam = params.get('q') || ''
    const sourceParam = params.get('source_org') || params.get('sourceOrg') || ''
    const sharedScopeParam = params.get('shared_scope') || params.get('sharedScope') || ''
    const backParams = new URLSearchParams()
    if (isSharedRoute) backParams.set('scope', 'shared')
    if (qParam) backParams.set('q', qParam)
    if (sourceParam) backParams.set('source_org', sourceParam)
    if (sharedScopeParam && sharedScopeParam !== 'system') backParams.set('shared_scope', sharedScopeParam)
    const qs = backParams.toString()
    const basePath = isSharedRoute ? '/assets/video' : '/library'
    return qs ? `${basePath}?${qs}` : basePath
  }, [isSharedRoute])

  const selectedId = useMemo(() => {
    const match = window.location.pathname.match(/\/(library|assets\/shared)\/create-clip\/(\d+)/)
    if (!match) return null
    const id = Number(match[2])
    if (!Number.isFinite(id) || id <= 0) return null
    return id
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadVideo = async () => {
      setLoading(true)
      setError(null)
      try {
        const user = await ensureLoggedIn()
        if (!user?.userId) throw new Error('Please sign in to access the library.')
        if (!selectedId) throw new Error('Invalid video id.')
        const res = await fetch(`/api/library/videos/${encodeURIComponent(String(selectedId))}`, { credentials: 'same-origin' })
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_load'))
        if (cancelled) return
        setSelectedVideo((json as any)?.upload || null)
      } catch (e: any) {
        if (cancelled) return
        setError(e?.message || 'Failed to load video.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadVideo()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  useEffect(() => {
    setSearchResults([])
    setSearchQuery('')
    setSearchError(null)
    setShowFullDescription(false)
  }, [selectedVideo?.id])

  useEffect(() => {
    if (!selectedVideo?.id) {
      setWaveEnv(null)
      setWaveStatus('idle')
      setWaveError(null)
      return
    }
    let cancelled = false
    const id = Number(selectedVideo.id)
    const fetchEnvelope = async () => {
      if (cancelled) return
      setWaveStatus('pending')
      setWaveError(null)
      try {
        const res = await fetch(`/api/uploads/${encodeURIComponent(String(id))}/audio-envelope`, { credentials: 'same-origin' })
        if (res.status === 202) {
          wavePollRef.current = window.setTimeout(fetchEnvelope, 2000)
          return
        }
        const json: any = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
        if (cancelled) return
        setWaveEnv(json)
        setWaveStatus('ready')
      } catch (e: any) {
        if (cancelled) return
        setWaveStatus('error')
        setWaveError(e?.message || 'failed_to_load')
      }
    }
    fetchEnvelope()
    return () => {
      cancelled = true
      if (wavePollRef.current) {
        window.clearTimeout(wavePollRef.current)
        wavePollRef.current = null
      }
    }
  }, [selectedVideo?.id])

  useEffect(() => {
    setCaptions([])
    setCaptionsStatus('idle')
    setCaptionsError(null)
  }, [selectedVideo?.id])

  useEffect(() => {
    if (!captionsEnabled || !selectedVideo?.id) return
    let cancelled = false
    const id = Number(selectedVideo.id)
    const fetchCaptions = async () => {
      setCaptionsStatus('loading')
      setCaptionsError(null)
      try {
        const res = await fetch(`/api/library/videos/${encodeURIComponent(String(id))}/captions`, { credentials: 'same-origin' })
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_load'))
        if (cancelled) return
        const items: TranscriptHit[] = Array.isArray(json?.items) ? json.items : []
        setCaptions(items)
        setCaptionsStatus('ready')
      } catch (e: any) {
        if (cancelled) return
        setCaptionsStatus('error')
        setCaptionsError(e?.message || 'failed_to_load')
      }
    }
    fetchCaptions()
    return () => {
      cancelled = true
    }
  }, [captionsEnabled, selectedVideo?.id])

  const handleSearch = useCallback(async () => {
    setSearchError(null)
    setSearching(true)
    setSearchResults([])
    try {
      if (!selectedVideo?.id) throw new Error('Select a video first.')
      const qTrim = searchQuery.trim()
      if (!qTrim) throw new Error('Enter a search term.')
      const params = new URLSearchParams()
      params.set('q', qTrim)
      const res = await fetch(`/api/library/videos/${encodeURIComponent(String(selectedVideo.id))}/search?${params.toString()}`, {
        credentials: 'same-origin',
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_search'))
      const items: TranscriptHit[] = Array.isArray(json?.items) ? json.items : []
      setSearchResults(items)
    } catch (e: any) {
      setSearchError(e?.message || 'Search failed.')
    } finally {
      setSearching(false)
    }
  }, [searchQuery, selectedVideo])

  const setCurrentTime = useCallback((t: number) => {
    const vid = videoRef.current
    if (!vid || !Number.isFinite(t)) return
    try {
      const next = Math.max(0, t)
      vid.currentTime = next
      setCurrentTimeState(next)
      vid.play().catch(() => {})
    } catch {}
  }, [])

  const handleTogglePlay = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    if (vid.paused) {
      vid.play().catch(() => {})
    } else {
      vid.pause()
    }
  }, [])

  const handleScrub = useCallback((value: number) => {
    const vid = videoRef.current
    const next = Number.isFinite(value) ? Math.max(0, value) : 0
    setCurrentTimeState(next)
    if (!vid) return
    try {
      vid.currentTime = next
    } catch {}
  }, [])

  const getWaveWindow = useCallback((time: number) => {
    const windowLen = 10
    const windowStart = time - windowLen / 2
    const windowEnd = windowStart + windowLen
    return { windowLen, windowStart, windowEnd }
  }, [])

  const clampTime = useCallback(
    (t: number) => {
      if (!Number.isFinite(t)) return 0
      if (duration > 0) return Math.min(Math.max(0, t), duration)
      return Math.max(0, t)
    },
    [duration]
  )

  useEffect(() => {
    const canvas = waveCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, rect.width, rect.height)

    if (waveStatus !== 'ready' || !waveEnv || !Array.isArray(waveEnv.points)) return
    if (!waveEnv.points.length) return

    const { windowLen, windowStart, windowEnd } = getWaveWindow(currentTime)

    ctx.strokeStyle = '#f0c062'
    ctx.lineWidth = 1
    const mid = rect.height / 2
    for (const p of waveEnv.points) {
      const t = Number((p as any).t)
      const v = Number((p as any).v)
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue
      if (t < windowStart || t > windowEnd) continue
      const x = ((t - windowStart) / windowLen) * rect.width
      const amp = Math.min(1, Math.max(0, v)) * (rect.height * 0.45)
      ctx.beginPath()
      ctx.moveTo(x, mid - amp)
      ctx.lineTo(x, mid + amp)
      ctx.stroke()
    }

    ctx.strokeStyle = 'rgba(255,64,0,0.9)'
    ctx.lineWidth = 2
    const px = rect.width / 2
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, rect.height)
    ctx.stroke()
  }, [waveEnv, waveStatus, currentTime, getWaveWindow])

  const handleWavePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      const canvas = waveCanvasRef.current
      if (!canvas) return
      if (scrubPointerIdRef.current != null) return
      scrubPointerIdRef.current = event.pointerId
      canvas.setPointerCapture(event.pointerId)
      scrubStartXRef.current = event.clientX
      const vid = videoRef.current
      const baseTime = Number(vid?.currentTime ?? currentTime)
      scrubStartTimeRef.current = Number.isFinite(baseTime) ? baseTime : 0
      scrubWasPlayingRef.current = !!vid && !vid.paused
      if (scrubWasPlayingRef.current) {
        vid?.pause()
      }
      setIsScrubbing(true)
    },
    [currentTime]
  )

  const handleWavePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (scrubPointerIdRef.current !== event.pointerId) return
      const canvas = waveCanvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      if (!rect.width) return
      const { windowLen } = getWaveWindow(scrubStartTimeRef.current)
      const deltaX = event.clientX - scrubStartXRef.current
      const deltaTime = (-deltaX / rect.width) * windowLen
      const next = clampTime(scrubStartTimeRef.current + deltaTime)
      const vid = videoRef.current
      if (vid) {
        try {
          vid.currentTime = next
        } catch {}
      }
      setCurrentTimeState(next)
    },
    [clampTime, getWaveWindow]
  )

  const endWaveScrub = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (scrubPointerIdRef.current !== event.pointerId) return
    const canvas = waveCanvasRef.current
    try {
      canvas?.releasePointerCapture(event.pointerId)
    } catch {}
    scrubPointerIdRef.current = null
    setIsScrubbing(false)
    if (scrubWasPlayingRef.current) {
      videoRef.current?.play().catch(() => {})
    }
    scrubWasPlayingRef.current = false
  }, [])

  const clearNudgeTimers = useCallback(() => {
    if (nudgeTimeoutRef.current) {
      window.clearTimeout(nudgeTimeoutRef.current)
      nudgeTimeoutRef.current = null
    }
    if (nudgeIntervalRef.current) {
      window.clearInterval(nudgeIntervalRef.current)
      nudgeIntervalRef.current = null
    }
  }, [])

  const nudgeTime = useCallback(
    (deltaSeconds: number) => {
      const vid = videoRef.current
      const baseTime = Number(vid?.currentTime ?? currentTime)
      const wasPlaying = !!vid && !vid.paused
      const next = clampTime(baseTime + deltaSeconds)
      if (vid) {
        try {
          vid.currentTime = next
        } catch {}
        if (wasPlaying) {
          vid.play().catch(() => {})
        }
      }
      setCurrentTimeState(next)
    },
    [clampTime, currentTime]
  )

  const handleNudgePointerDown = useCallback(
    (deltaSeconds: number) => (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      clearNudgeTimers()
      nudgeTime(deltaSeconds)
      nudgeTimeoutRef.current = window.setTimeout(() => {
        nudgeIntervalRef.current = window.setInterval(() => {
          nudgeTime(deltaSeconds)
        }, 120)
      }, 320)
    },
    [clearNudgeTimers, nudgeTime]
  )

  const handleNudgePointerUp = useCallback(() => {
    clearNudgeTimers()
  }, [clearNudgeTimers])

  useEffect(() => {
    return () => clearNudgeTimers()
  }, [clearNudgeTimers])

  const activeCaptionIndex = useMemo(() => {
    if (!captions.length) return -1
    for (let i = 0; i < captions.length; i += 1) {
      const cue = captions[i]
      if (currentTime >= cue.startSeconds && currentTime <= cue.endSeconds) return i
    }
    return -1
  }, [captions, currentTime])
  const activeCaption = useMemo(() => {
    if (activeCaptionIndex < 0) return null
    return captions[activeCaptionIndex] || null
  }, [captions, activeCaptionIndex])

  const setInPoint = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    const t = Number(vid.currentTime)
    if (!Number.isFinite(t)) return
    setClipStart(Number(t.toFixed(1)))
    if (clipEnd != null && clipEnd <= t) setClipEnd(null)
  }, [clipEnd])

  const setOutPoint = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    const t = Number(vid.currentTime)
    if (!Number.isFinite(t)) return
    if (clipStart != null && t <= clipStart + 0.05) {
      setClipError('End must be after start.')
      return
    }
    setClipEnd(Number(t.toFixed(1)))
  }, [clipStart])

  const handleSaveClip = useCallback(async () => {
    setClipError(null)
    setClipMessage(null)
    try {
      if (!selectedVideo?.id) throw new Error('Select a video first.')
      if (clipStart == null || clipEnd == null) throw new Error('Set both start and end times.')
      const len = clipEnd - clipStart
      if (len < 5) throw new Error('Clip must be at least 5 seconds.')
      if (len > 180) throw new Error('Clip must be 3 minutes or less.')
      setClipSaving(true)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch('/api/library/clips', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({
          uploadId: selectedVideo.id,
          title: clipTitle.trim() || undefined,
          description: clipDescription.trim() || undefined,
          startSeconds: clipStart,
          endSeconds: clipEnd,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_save'))
      setClipMessage('Clip saved.')
      setClipTitle('')
      setClipDescription('')
    } catch (e: any) {
      setClipError(e?.message || 'Failed to save clip.')
    } finally {
      setClipSaving(false)
    }
  }, [selectedVideo, clipStart, clipEnd, clipTitle, clipDescription])

  const playerSrc = selectedVideo?.id
    ? `/api/uploads/${encodeURIComponent(String(selectedVideo.id))}/edit-proxy#t=0.1`
    : ''

  const meta = useMemo(() => {
    if (!selectedVideo) return ''
    const sourceLabel =
      getLibrarySourceLabel(selectedVideo.source_org, sourceOptions) ||
      (selectedVideo.source_org ? String(selectedVideo.source_org).toUpperCase() : null)
    return [
      sourceLabel,
      selectedVideo.duration_seconds ? formatDuration(selectedVideo.duration_seconds) : null,
      selectedVideo.width && selectedVideo.height ? `${selectedVideo.width}×${selectedVideo.height}` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }, [selectedVideo, sourceOptions])

  const progressPercent = useMemo(() => {
    if (!duration || duration <= 0) return 0
    const pct = (currentTime / duration) * 100
    return Math.min(100, Math.max(0, pct))
  }, [currentTime, duration])

  const clipLengthLabel = useMemo(() => {
    if (clipStart == null || clipEnd == null) return '—'
    return formatTime(clipEnd - clipStart)
  }, [clipStart, clipEnd])

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', padding: 20 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h1 style={{ margin: 0, fontSize: 26 }}>Create Clip</h1>
            <a href={backHref} style={{ color: '#9bbcff', textDecoration: 'none', fontSize: 14 }}>
              {isSharedRoute ? '← Back to shared videos' : '← Back to library'}
            </a>
          </div>
        </div>

        {error ? <div style={{ marginTop: 12, color: '#ffb3b3' }}>{error}</div> : null}
        {loading ? <div style={{ marginTop: 12 }}>Loading…</div> : null}

        {selectedVideo ? (
          <div style={{ marginTop: 16, padding: 16, borderRadius: 16, border: '1px solid rgba(255,255,255,0.14)', background: '#0c0c0c' }}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>{selectedVideo.modified_filename || selectedVideo.original_filename}</div>
            {meta ? <div style={{ marginTop: 6, color: '#bbb', fontSize: 13 }}>{meta}</div> : null}
            {selectedVideo.description ? (() => {
              const description = String(selectedVideo.description || '')
              const truncated = truncateWords(description, 50)
              return (
                <div style={{ marginTop: 6, color: '#a8a8a8', fontSize: 13, lineHeight: 1.5 }}>
                  <div>{showFullDescription ? description : truncated.text}</div>
                  {truncated.truncated ? (
                    <button
                      type="button"
                      onClick={() => setShowFullDescription((prev) => !prev)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#9bbcff',
                        fontWeight: 700,
                        padding: 0,
                        marginTop: 6,
                        cursor: 'pointer',
                      }}
                    >
                      {showFullDescription ? 'less' : 'more'}
                    </button>
                  ) : null}
                </div>
              )
            })() : null}
            <div style={{ marginTop: 10, position: 'relative' }}>
              <video
                ref={videoRef}
                playsInline
                preload="metadata"
                src={playerSrc}
                style={{ width: '100%', maxHeight: '60vh', background: '#000', borderRadius: 12 }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={() => {
                  const vid = videoRef.current
                  if (!vid) return
                  const t = Number(vid.currentTime || 0)
                  setCurrentTimeState(Number.isFinite(t) ? t : 0)
                }}
                onLoadedMetadata={() => {
                  const vid = videoRef.current
                  if (!vid) return
                  const d = Number(vid.duration || 0)
                  setDuration(Number.isFinite(d) ? d : 0)
                }}
              />
              <button
                type="button"
                onClick={() => setCaptionsEnabled((prev) => !prev)}
                aria-pressed={captionsEnabled}
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  width: 44,
                  height: 36,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: captionsEnabled ? '#0a84ff' : 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  fontWeight: 800,
                  backdropFilter: 'blur(4px)',
                }}
              >
                CC
              </button>
              {captionsEnabled && activeCaption ? (
                <div
                  style={{
                    position: 'absolute',
                    left: 12,
                    right: 12,
                    bottom: 12,
                    display: 'flex',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  <div
                    style={{
                      maxWidth: '100%',
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      padding: '6px 10px',
                      borderRadius: 8,
                      fontSize: 14,
                      lineHeight: 1.4,
                      textAlign: 'center',
                    }}
                  >
                    {activeCaption.text}
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ marginTop: 6 }}>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                onChange={(e) => handleScrub(Number(e.target.value))}
                style={{
                  width: '100%',
                  height: 6,
                  borderRadius: 999,
                  accentColor: '#f0c062',
                  background: `linear-gradient(90deg, #f0c062 ${progressPercent}%, rgba(255,255,255,0.2) ${progressPercent}%)`,
                }}
              />
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ height: 60, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                <canvas
                  ref={waveCanvasRef}
                  onPointerDown={handleWavePointerDown}
                  onPointerMove={handleWavePointerMove}
                  onPointerUp={endWaveScrub}
                  onPointerCancel={endWaveScrub}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    cursor: isScrubbing ? 'grabbing' : 'grab',
                    touchAction: 'none',
                  }}
                />
              </div>
              {waveStatus === 'pending' ? <div style={{ color: '#9aa0a6', marginTop: 6 }}>Waveform is generating…</div> : null}
              {waveStatus === 'error' && waveError ? <div style={{ color: '#ffb3b3', marginTop: 6 }}>{waveError}</div> : null}
            </div>

            <div
              style={{
                marginTop: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                color: '#bbb',
                fontSize: 16,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <div>{formatTime(currentTime)} / {formatTime(duration)}</div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                Clip:{' '}
                <span style={{ color: '#f0c062' }}>
                  {clipStart != null ? formatTime(clipStart) : '—'} | {clipEnd != null ? formatTime(clipEnd) : '—'} | {clipLengthLabel}
                </span>{' '}
                (5s–180s)
              </div>
            </div>

            <div
              style={{
                marginTop: 10,
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                columnGap: 8,
                rowGap: 8,
                alignItems: 'center',
              }}
            >
              <button
                type="button"
                onClick={setInPoint}
                aria-label="Set In"
                title="Set In"
                style={{
                  width: 44,
                  height: 36,
                  borderRadius: 10,
                  border: `1px solid ${clipStart != null ? '#f0c062' : 'rgba(255,255,255,0.18)'}`,
                  background: '#1a1a1a',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  justifySelf: 'start',
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="36"
                  height="36"
                  viewBox="0 0 128 128"
                  fill="none"
                  style={{ display: 'block' }}
                >
                  <path
                    d="M82.5 44L94.5147 56.0147C99.201 60.701 99.201 68.299 94.5147 72.9853L82.5 85M56 64.2279L96.4558 64.2279"
                    stroke={clipStart != null ? '#f0c062' : '#fff'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="7"
                  />
                  <path
                    d="M41 36L41 92"
                    stroke={clipStart != null ? '#f0c062' : '#fff'}
                    strokeLinecap="round"
                    strokeWidth="7"
                  />
                </svg>
              </button>
              <button
                type="button"
                onPointerDown={handleNudgePointerDown(-10)}
                onPointerUp={handleNudgePointerUp}
                onPointerLeave={handleNudgePointerUp}
                onPointerCancel={handleNudgePointerUp}
                style={{
                  minWidth: 56,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#161616',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 16,
                  lineHeight: 1,
                  justifySelf: 'center',
                }}
              >
                -10s
              </button>
              <button
                type="button"
                onClick={handleTogglePlay}
                style={{
                  width: 44,
                  height: 36,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: '#111',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: 21,
                  lineHeight: 1,
                  justifySelf: 'center',
                }}
              >
                {isPlaying ? '❚❚' : '▶'}
              </button>
              <button
                type="button"
                onPointerDown={handleNudgePointerDown(10)}
                onPointerUp={handleNudgePointerUp}
                onPointerLeave={handleNudgePointerUp}
                onPointerCancel={handleNudgePointerUp}
                style={{
                  minWidth: 56,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#161616',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 16,
                  lineHeight: 1,
                  justifySelf: 'center',
                }}
              >
                +10s
              </button>
              <button
                type="button"
                onClick={setOutPoint}
                aria-label="Set Out"
                title="Set Out"
                style={{
                  width: 44,
                  height: 36,
                  borderRadius: 10,
                  border: `1px solid ${clipEnd != null ? '#f0c062' : 'rgba(255,255,255,0.18)'}`,
                  background: '#1a1a1a',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  justifySelf: 'end',
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="36"
                  height="36"
                  viewBox="0 0 128 128"
                  fill="none"
                  style={{ display: 'block', transform: 'scaleX(-1)' }}
                >
                  <path
                    d="M82.5 44L94.5147 56.0147C99.201 60.701 99.201 68.299 94.5147 72.9853L82.5 85M56 64.2279L96.4558 64.2279"
                    stroke={clipEnd != null ? '#f0c062' : '#fff'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="7"
                  />
                  <path
                    d="M41 36L41 92"
                    stroke={clipEnd != null ? '#f0c062' : '#fff'}
                    strokeLinecap="round"
                    strokeWidth="7"
                  />
                </svg>
              </button>
            </div>

            <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Transcript Search</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search transcript…"
                  style={{
                    flex: '1 1 240px',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#0b0b0b',
                    color: '#fff',
                    fontSize: 16,
                    lineHeight: '1.4',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleSearch()}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#0a84ff',
                    color: '#fff',
                    fontWeight: 700,
                  }}
                  disabled={searching}
                >
                  Search
                </button>
              </div>
              {searchError ? <div style={{ color: '#ffb3b3' }}>{searchError}</div> : null}
              {searching ? <div>Searching…</div> : null}
              {searchResults.length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {searchResults.map((hit, idx) => (
                    <button
                      key={`${hit.startSeconds}-${idx}`}
                      type="button"
                      onClick={() => setCurrentTime(hit.startSeconds)}
                      style={{
                        textAlign: 'left',
                        padding: 10,
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: '#121212',
                        color: '#fff',
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 13 }}>
                        {formatTime(hit.startSeconds)} → {formatTime(hit.endSeconds)}
                      </div>
                      <div style={{ marginTop: 4, color: '#bbb', fontSize: 13 }}>{hit.text}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ marginTop: 20, display: 'grid', gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Create Clip</div>
              <div style={{ display: 'grid', gap: 8 }}>
                <input
                  type="text"
                  value={clipTitle}
                  onChange={(e) => setClipTitle(e.target.value)}
                  placeholder="Clip title (optional)"
                  style={{
                    width: '100%',
                    maxWidth: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#0b0b0b',
                    color: '#fff',
                    fontSize: 16,
                    lineHeight: '1.4',
                    boxSizing: 'border-box',
                  }}
                />
                <textarea
                  value={clipDescription}
                  onChange={(e) => setClipDescription(e.target.value)}
                  placeholder="Clip description (optional)"
                  rows={3}
                  style={{
                    width: '100%',
                    maxWidth: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#0b0b0b',
                    color: '#fff',
                    resize: 'vertical',
                    fontSize: 16,
                    lineHeight: '1.4',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              {clipError ? <div style={{ color: '#ffb3b3' }}>{clipError}</div> : null}
              {clipMessage ? <div style={{ color: '#9ef0b4' }}>{clipMessage}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => void handleSaveClip()}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#0a84ff',
                    color: '#fff',
                    fontWeight: 700,
                    width: 'fit-content',
                  }}
                  disabled={clipSaving}
                >
                  Save Clip
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const LibraryCreateClipPage: React.FC = () => {
  return <LibraryCreateClipPageInner />
}

const LibraryPage: React.FC = () => {
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  if (path.startsWith('/library/create-clip/')) {
    const target = path.replace('/library/create-clip/', '/assets/shared/create-clip/')
    window.location.replace(`${target}${window.location.search || ''}`)
    return null
  }
  if (path.startsWith('/library')) {
    const qs = window.location.search || ''
    const base = '/assets/video?scope=shared'
    window.location.replace(qs ? `${base}&${qs.replace(/^\?/, '')}` : base)
    return null
  }
  return <LibraryListPage />
}

export default LibraryPage
