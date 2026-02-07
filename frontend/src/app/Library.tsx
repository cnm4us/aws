import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

const LibraryListPage: React.FC = () => {
  const [videos, setVideos] = useState<LibraryVideo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sourceOrg, setSourceOrg] = useState('all')
  const [selectedView, setSelectedView] = useState<LibraryVideo | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const qParam = params.get('q') || ''
    const sourceParam = params.get('source_org') || params.get('sourceOrg') || 'all'
    setQ(qParam)
    setSourceOrg(sourceParam || 'all')
  }, [])

  const syncUrl = useCallback((nextQ: string, nextSource: string) => {
    const params = new URLSearchParams()
    if (nextQ.trim()) params.set('q', nextQ.trim())
    if (nextSource && nextSource !== 'all') params.set('source_org', nextSource)
    const qs = params.toString()
    const nextUrl = qs ? `/library?${qs}` : '/library'
    window.history.replaceState(null, '', nextUrl)
  }, [])

  const loadVideos = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
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
      syncUrl(qTrim, sourceOrg)
    } catch (e: any) {
      setError(e?.message || 'Failed to load library.')
    } finally {
      setLoading(false)
    }
  }, [q, sourceOrg, syncUrl])

  useEffect(() => {
    void loadVideos()
  }, [loadVideos])

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', padding: 20 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 26 }}>Video Library</h1>
        </div>

        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
              }}
            >
              <option value="all">All sources</option>
              <option value="cspan">CSPAN</option>
              <option value="other">Other</option>
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
          <div style={{ display: 'grid', gap: 12 }}>
            {loading ? <div>Loading…</div> : null}
            {!loading && !videos.length ? <div>No library videos found.</div> : null}
            {videos.map((v) => {
              const name = (v.modified_filename || v.original_filename || `Video ${v.id}`).toString()
              const meta = [
                v.source_org ? String(v.source_org).toUpperCase() : null,
                v.duration_seconds ? formatDuration(v.duration_seconds) : null,
                v.width && v.height ? `${v.width}×${v.height}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
              const backParams = new URLSearchParams()
              if (q.trim()) backParams.set('q', q.trim())
              if (sourceOrg && sourceOrg !== 'all') backParams.set('source_org', sourceOrg)
              const qs = backParams.toString()
              const clipHref = qs
                ? `/library/create-clip/${encodeURIComponent(String(v.id))}?${qs}`
                : `/library/create-clip/${encodeURIComponent(String(v.id))}`

              return (
                <div
                  key={v.id}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(28,28,28,0.95)',
                    color: '#fff',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{name}</div>
                  {meta ? <div style={{ color: '#bbb', fontSize: 13 }}>{meta}</div> : null}
                  {v.description ? <div style={{ color: '#a8a8a8', fontSize: 13 }}>{v.description}</div> : null}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedView(v)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: '#1a1a1a',
                        color: '#fff',
                        fontWeight: 700,
                      }}
                    >
                      View
                    </button>
                    <a
                      href={clipHref}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: '#0a84ff',
                        color: '#fff',
                        fontWeight: 700,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
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
                    padding: '6px 10px',
                  }}
                >
                  Close
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
      </div>
    </div>
  )
}

const LibraryCreateClipPage: React.FC = () => {
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
  const [clipError, setClipError] = useState<string | null>(null)
  const [clipSaving, setClipSaving] = useState(false)
  const [clipMessage, setClipMessage] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const wavePollRef = useRef<number | null>(null)
  const captionsContainerRef = useRef<HTMLDivElement | null>(null)
  const activeCaptionRef = useRef<HTMLButtonElement | null>(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const scrubPointerIdRef = useRef<number | null>(null)
  const scrubStartXRef = useRef(0)
  const scrubStartTimeRef = useRef(0)
  const scrubWasPlayingRef = useRef(false)
  const nudgeTimeoutRef = useRef<number | null>(null)
  const nudgeIntervalRef = useRef<number | null>(null)

  const backHref = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const qParam = params.get('q') || ''
    const sourceParam = params.get('source_org') || params.get('sourceOrg') || ''
    const backParams = new URLSearchParams()
    if (qParam) backParams.set('q', qParam)
    if (sourceParam) backParams.set('source_org', sourceParam)
    const qs = backParams.toString()
    return qs ? `/library?${qs}` : '/library'
  }, [])

  const selectedId = useMemo(() => {
    const match = window.location.pathname.match(/\/library\/create-clip\/(\d+)/)
    if (!match) return null
    const id = Number(match[1])
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

  const visibleCaptions = useMemo(() => {
    if (!captions.length) return []
    const windowSize = 8
    if (activeCaptionIndex < 0) {
      return captions.slice(0, windowSize).map((cue, idx) => ({ cue, index: idx }))
    }
    let start = Math.max(0, activeCaptionIndex - 1)
    if (start + windowSize > captions.length) {
      start = Math.max(0, captions.length - windowSize)
    }
    const end = Math.min(captions.length, start + windowSize)
    return captions.slice(start, end).map((cue, idx) => ({ cue, index: start + idx }))
  }, [captions, activeCaptionIndex])

  useEffect(() => {
    if (!captionsEnabled) return
    const container = captionsContainerRef.current
    const active = activeCaptionRef.current
    if (!container || !active) return
    const handle = window.requestAnimationFrame(() => {
      const gap = 6
      const desiredOffset = active.offsetHeight + gap
      const containerRect = container.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()
      const activeOffset = activeRect.top - containerRect.top + container.scrollTop
      let target = activeOffset - desiredOffset
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
      if (!Number.isFinite(target)) target = 0
      target = Math.min(maxScroll, Math.max(0, target))
      container.scrollTop = target
    })
    return () => window.cancelAnimationFrame(handle)
  }, [activeCaptionIndex, captionsEnabled, visibleCaptions.length])

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
    return [
      selectedVideo.source_org ? String(selectedVideo.source_org).toUpperCase() : null,
      selectedVideo.duration_seconds ? formatDuration(selectedVideo.duration_seconds) : null,
      selectedVideo.width && selectedVideo.height ? `${selectedVideo.width}×${selectedVideo.height}` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }, [selectedVideo])

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', padding: 20 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h1 style={{ margin: 0, fontSize: 26 }}>Create Clip</h1>
            <a href={backHref} style={{ color: '#9bbcff', textDecoration: 'none', fontSize: 14 }}>
              ← Back to library
            </a>
          </div>
        </div>

        {error ? <div style={{ marginTop: 12, color: '#ffb3b3' }}>{error}</div> : null}
        {loading ? <div style={{ marginTop: 12 }}>Loading…</div> : null}

        {selectedVideo ? (
          <div style={{ marginTop: 16, padding: 16, borderRadius: 16, border: '1px solid rgba(255,255,255,0.14)', background: '#0c0c0c' }}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>{selectedVideo.modified_filename || selectedVideo.original_filename}</div>
            {meta ? <div style={{ marginTop: 6, color: '#bbb', fontSize: 13 }}>{meta}</div> : null}
            {selectedVideo.description ? (
              <div style={{ marginTop: 6, color: '#a8a8a8', fontSize: 13 }}>{selectedVideo.description}</div>
            ) : null}
            <div style={{ marginTop: 10 }}>
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
            </div>

            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                  }}
                >
                  {isPlaying ? '❚❚' : '▶'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={Math.min(currentTime, duration || 0)}
                  onChange={(e) => handleScrub(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <div style={{ fontVariantNumeric: 'tabular-nums', color: '#bbb', minWidth: 90, textAlign: 'right' }}>
                  {formatTime(currentTime)} / {formatTime(duration)}
                </div>
                <button
                  type="button"
                  onClick={() => setCaptionsEnabled((prev) => !prev)}
                  aria-pressed={captionsEnabled}
                  style={{
                    width: 44,
                    height: 36,
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: captionsEnabled ? '#0a84ff' : '#111',
                    color: '#fff',
                    fontWeight: 800,
                  }}
                >
                  CC
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                  }}
                >
                  -10s
                </button>
                <div style={{ flex: 1, height: 60, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', overflow: 'hidden' }}>
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
                  }}
                >
                  +10s
                </button>
              </div>
              {waveStatus === 'pending' ? <div style={{ color: '#9aa0a6' }}>Waveform is generating…</div> : null}
              {waveStatus === 'error' && waveError ? <div style={{ color: '#ffb3b3' }}>{waveError}</div> : null}
            </div>

            {captionsEnabled ? (
              <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 800 }}>Captions</div>
                  {captions.length ? <div style={{ color: '#888', fontSize: 12 }}>{captions.length} cues</div> : null}
                </div>
                {captionsStatus === 'loading' ? <div>Loading captions…</div> : null}
                {captionsError ? <div style={{ color: '#ffb3b3' }}>{captionsError}</div> : null}
                {!captionsError && captionsStatus === 'ready' && !captions.length ? (
                  <div style={{ color: '#bbb' }}>No captions available.</div>
                ) : null}
                {visibleCaptions.length ? (
                  <div
                    ref={captionsContainerRef}
                    style={{
                      maxHeight: 200,
                      overflow: 'auto',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.12)',
                      background: '#0f0f0f',
                      padding: 8,
                      display: 'grid',
                      gap: 6,
                    }}
                  >
                    {visibleCaptions.map(({ cue, index }) => {
                      const isActive = index === activeCaptionIndex
                      return (
                        <button
                          key={`${cue.startSeconds}-${index}`}
                          ref={isActive ? activeCaptionRef : undefined}
                          type="button"
                          onClick={() => setCurrentTime(cue.startSeconds)}
                          style={{
                            textAlign: 'left',
                            padding: 8,
                            borderRadius: 8,
                            border: isActive ? '1px solid rgba(10,132,255,0.7)' : '1px solid rgba(255,255,255,0.08)',
                            background: isActive ? 'rgba(10,132,255,0.15)' : '#111',
                            color: '#fff',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: 12, color: '#b8c6ff' }}>
                            {formatTime(cue.startSeconds)} → {formatTime(cue.endSeconds)}
                          </div>
                          <div style={{ marginTop: 4, color: '#ddd', fontSize: 13 }}>{cue.text}</div>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

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
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={setInPoint}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#1a1a1a',
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  Set In ({clipStart != null ? formatTime(clipStart) : '—'})
                </button>
                <button
                  type="button"
                  onClick={setOutPoint}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#1a1a1a',
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  Set Out ({clipEnd != null ? formatTime(clipEnd) : '—'})
                </button>
                <div style={{ alignSelf: 'center', color: '#bbb' }}>
                  Length: {clipStart != null && clipEnd != null ? formatTime(clipEnd - clipStart) : '—'} (5s–180s)
                </div>
              </div>
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
        ) : null}
      </div>
    </div>
  )
}

const LibraryPage: React.FC = () => {
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  if (path.startsWith('/library/create-clip/')) {
    return <LibraryCreateClipPage />
  }
  return <LibraryListPage />
}

export default LibraryPage
