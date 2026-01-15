import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUploadCdnUrl } from '../ui/uploadsCdn'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type UploadListItem = {
  id: number
  original_filename: string
  modified_filename: string | null
  description: string | null
  size_bytes: number | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  status: string
  kind?: string
  created_at: string
}

type UploadSummary = { id: number; original_filename: string; modified_filename: string | null; duration_seconds?: number | null }

type Clip = {
  id: string
  uploadId: number
  sourceStartSeconds: number
  sourceEndSeconds: number
}

type Timeline = {
  version: 'create_video_v1'
  playheadSeconds: number
  clips: Clip[]
}

function computeClipStartsCached(clips: Clip[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const c of clips) {
    out.push(acc)
    acc += Math.max(0, c.sourceEndSeconds - c.sourceStartSeconds)
  }
  return out
}

function findClipIndexAtTime(t: number, clips: Clip[], clipStarts: number[]): number {
  const tt = Number(t)
  if (!Number.isFinite(tt) || tt < 0) return 0
  for (let i = 0; i < clips.length; i++) {
    const len = Math.max(0, clips[i].sourceEndSeconds - clips[i].sourceStartSeconds)
    const a = clipStarts[i] || 0
    const b = a + len
    if (tt >= a && tt < b) return i
  }
  return Math.max(0, clips.length - 1)
}

type Project = {
  id: number
  status: string
  timeline: Timeline
  lastExportJobId?: number | null
  lastExportUploadId?: number | null
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

function sumDur(clips: Clip[]): number {
  return clips.reduce((acc, c) => acc + Math.max(0, c.sourceEndSeconds - c.sourceStartSeconds), 0)
}

function computeClipStarts(clips: Clip[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const c of clips) {
    out.push(acc)
    acc += Math.max(0, c.sourceEndSeconds - c.sourceStartSeconds)
  }
  return out
}

function locate(t: number, clips: Clip[]): { clipIndex: number; within: number } {
  const starts = computeClipStarts(clips)
  for (let i = 0; i < clips.length; i++) {
    const len = Math.max(0, clips[i].sourceEndSeconds - clips[i].sourceStartSeconds)
    const a = starts[i]
    const b = a + len
    if (t >= a && t < b) return { clipIndex: i, within: t - a }
  }
  return { clipIndex: Math.max(0, clips.length - 1), within: 0 }
}

async function ensureLoggedIn(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' })
    if (!res.ok) return null
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function ellipsizeText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
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

export default function CreateVideo() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [timeline, setTimeline] = useState<Timeline>({ version: 'create_video_v1', playheadSeconds: 0, clips: [] })
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [namesByUploadId, setNamesByUploadId] = useState<Record<number, string>>({})
  const [durationsByUploadId, setDurationsByUploadId] = useState<Record<number, number>>({})
  const [pickOpen, setPickOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerItems, setPickerItems] = useState<UploadListItem[]>([])
  const [clipEditor, setClipEditor] = useState<{ id: string; start: number; end: number } | null>(null)
  const [clipEditorError, setClipEditorError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [activeUploadId, setActiveUploadId] = useState<number | null>(null)
  const activeClipIndexRef = useRef(0)
  const playheadFromVideoRef = useRef(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const undoStackRef = useRef<Array<{ timeline: Timeline; selectedClipId: string | null }>>([])
  const [undoDepth, setUndoDepth] = useState(0)
  const lastSavedRef = useRef<string>('')
  const hydratingRef = useRef(false)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const [timelineScrollEl, setTimelineScrollEl] = useState<HTMLDivElement | null>(null)
  const timelineCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [timelinePadPx, setTimelinePadPx] = useState(0)
  const playheadFromScrollRef = useRef(false)
  const ignoreScrollRef = useRef(false)
  const [timelineScrollLeftPx, setTimelineScrollLeftPx] = useState(0)
  const primedFrameSrcRef = useRef<string>('')
  const [posterByUploadId, setPosterByUploadId] = useState<Record<number, string>>({})
  const activePoster = useMemo(() => {
    if (!activeUploadId) return null
    return posterByUploadId[activeUploadId] || null
  }, [activeUploadId, posterByUploadId])

  const clipDragRef = useRef<{
    clipId: string
    edge: 'start' | 'end'
    pointerId: number
    startClientX: number
    startStartSeconds: number
    startEndSeconds: number
    maxDurationSeconds: number
  } | null>(null)
  const [clipDragging, setClipDragging] = useState(false)

  const primePausedFrame = useCallback(async (v: HTMLVideoElement) => {
    try {
      if (!v.paused) return
      const prevMuted = v.muted
      v.muted = true
      const p = v.play()
      if (p && typeof (p as any).then === 'function') {
        await p.catch(() => {})
      }
      await new Promise((r) => window.setTimeout(r, 80))
      try { v.pause() } catch {}
      v.muted = prevMuted
    } catch {
      try { v.pause() } catch {}
    }
  }, [])

  const totalSeconds = useMemo(() => sumDur(timeline.clips), [timeline.clips])
  const clipStarts = useMemo(() => computeClipStartsCached(timeline.clips), [timeline.clips])
  const playhead = useMemo(() => clamp(roundToTenth(timeline.playheadSeconds || 0), 0, Math.max(0, totalSeconds)), [timeline.playheadSeconds, totalSeconds])
  const pxPerSecond = 48
  const stripContentW = useMemo(() => Math.max(0, Math.ceil(totalSeconds * pxPerSecond)), [totalSeconds])
  const RULER_H = 16
  const TRACK_H = 48
  const PILL_Y = RULER_H + 6
  const PILL_H = Math.max(18, TRACK_H - 12)
  const HANDLE_HIT_PX = 12

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null
    return timeline.clips.find((c) => c.id === selectedClipId) || null
  }, [selectedClipId, timeline.clips])

  const canUndo = undoDepth > 0

  const snapshotUndo = useCallback(() => {
    const stack = undoStackRef.current
    const snapshot = {
      timeline: {
        version: 'create_video_v1',
        playheadSeconds: Number(timeline.playheadSeconds || 0),
        clips: timeline.clips.map((c) => ({
          id: String(c.id),
          uploadId: Number(c.uploadId),
          sourceStartSeconds: Number(c.sourceStartSeconds),
          sourceEndSeconds: Number(c.sourceEndSeconds),
        })),
      },
      selectedClipId,
    }
    stack.push(snapshot)
    // Cap memory and keep behavior predictable.
    if (stack.length > 50) stack.splice(0, stack.length - 50)
    setUndoDepth(stack.length)
  }, [selectedClipId, timeline.clips, timeline.playheadSeconds])

  const undo = useCallback(() => {
    const stack = undoStackRef.current
    const snap = stack.pop()
    if (!snap) return
    setUndoDepth(stack.length)
    hydratingRef.current = true
    try {
      setTimeline(snap.timeline)
      setSelectedClipId(snap.selectedClipId)
    } finally {
      hydratingRef.current = false
    }
  }, [])

  // Timeline padding so t=0 and t=end can align under the centered playhead line.
  useEffect(() => {
    const el = timelineScrollEl || timelineScrollRef.current
    if (!el) return
    let ro: ResizeObserver | null = null
    const update = (width: number) => {
      const w = Math.max(0, Math.round(width || 0))
      setTimelinePadPx(Math.floor(w / 2))
    }
    try {
      ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          if (e.target !== el) continue
          update(e.contentRect?.width || el.clientWidth || 0)
        }
      })
      ro.observe(el)
      update(el.clientWidth || 0)
    } catch {
      // Fallback if ResizeObserver is unavailable.
      const onResize = () => update(el.clientWidth || 0)
      window.addEventListener('resize', onResize)
      update(el.clientWidth || 0)
      return () => window.removeEventListener('resize', onResize)
    }
    return () => {
      try { ro?.disconnect() } catch {}
    }
  }, [timelineScrollEl])

  const drawTimeline = useCallback(() => {
    const canvas = timelineCanvasRef.current
    const sc = timelineScrollRef.current
    if (!canvas || !sc) return
    const wCss = Math.max(0, Math.round(sc.clientWidth || 0))
    const rulerH = RULER_H
    const trackH = TRACK_H
    const hCss = rulerH + trackH
    const dpr = Math.max(1, Math.round((window.devicePixelRatio || 1) * 100) / 100)
    canvas.width = Math.max(1, Math.floor(wCss * dpr))
    canvas.height = Math.max(1, Math.floor(hCss * dpr))
    canvas.style.width = `${wCss}px`
    canvas.style.height = `${hCss}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, wCss, hCss)

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, 0, wCss, rulerH)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, rulerH, wCss, trackH)

    // Ticks (0.1s minor, 1.0s major, 5.0s extra-major)
    const scrollLeft = Math.max(0, Number(timelineScrollLeftPx) || 0)
    const padPx = timelinePadPx || Math.floor(wCss / 2)
    const startT = clamp((scrollLeft - padPx) / pxPerSecond, 0, Math.max(0, totalSeconds))
    const endT = clamp((scrollLeft - padPx + wCss) / pxPerSecond, 0, Math.max(0, totalSeconds))
    const eps = 1e-6
    const firstTenth = Math.max(0, Math.floor(startT * 10) / 10)
    const lastTenth = Math.ceil(endT * 10) / 10
    const count = Math.max(0, Math.round((lastTenth - firstTenth) * 10) + 1)
    for (let i = 0; i <= count; i++) {
      const t = firstTenth + i * 0.1
      if (t < startT - 0.2) continue
      if (t > endT + 0.2) break
      const x = padPx + t * pxPerSecond - scrollLeft
      if (x < -2 || x > wCss + 2) continue

      const isOne = Math.abs(t - Math.round(t)) < eps
      const isFive = isOne && (Math.round(t) % 5 === 0)
      ctx.strokeStyle = isFive
        ? 'rgba(255,255,255,0.62)'
        : isOne
          ? 'rgba(255,255,255,0.46)'
          : 'rgba(255,255,255,0.28)'
      ctx.lineWidth = 1
      const tickLen = isFive ? 14 : isOne ? 10 : 6
      ctx.beginPath()
      ctx.moveTo(x + 0.5, rulerH - tickLen)
      ctx.lineTo(x + 0.5, rulerH)
      ctx.stroke()

      // Optional faint guide line down into the track for 1s/5s marks.
      if (isOne) {
        ctx.strokeStyle = isFive ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.12)'
        ctx.beginPath()
        ctx.moveTo(x + 0.5, rulerH)
        ctx.lineTo(x + 0.5, hCss)
        ctx.stroke()
      }
    }

    // Clip pills
    const pillY = PILL_Y
    const pillH = PILL_H
    ctx.font = '900 12px system-ui, -apple-system, Segoe UI, sans-serif'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < timeline.clips.length; i++) {
      const clip = timeline.clips[i]
      const start = clipStarts[i] || 0
      const len = Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds)
      const x = padPx + start * pxPerSecond - scrollLeft
      const w = Math.max(8, len * pxPerSecond)
      if (x > wCss + 4 || x + w < -4) continue
      const isSelected = clip.id === selectedClipId

      // pill background
      ctx.fillStyle = isSelected ? 'rgba(212,175,55,0.28)' : 'rgba(212,175,55,0.14)'
      roundRect(ctx, x, pillY, w, pillH, 10)
      ctx.fill()

      // pill border
      ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.92)' : 'rgba(212,175,55,0.65)'
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, pillY + 0.5, w - 1, pillH - 1, 10)
      ctx.stroke()

      const name = namesByUploadId[clip.uploadId] || `Video ${clip.uploadId}`
      ctx.fillStyle = '#fff'
      const pad = 10
      const maxTextW = Math.max(0, w - pad * 2)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, name, maxTextW)
        ctx.fillText(clipped, x + pad, pillY + pillH / 2)
      }

      if (isSelected && w >= 20) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        const hw = 3
        const hh = pillH - 10
        const hy = pillY + 5
        ctx.fillRect(x + 6, hy, hw, hh)
        ctx.fillRect(x + w - 6 - hw, hy, hw, hh)
      }
    }
  }, [clipStarts, namesByUploadId, pxPerSecond, selectedClipId, timeline.clips, timelinePadPx, timelineScrollLeftPx, totalSeconds])

  useEffect(() => {
    drawTimeline()
  }, [drawTimeline])

  // Scroll timeline to match playhead unless the user is currently scrubbing via scroll.
  useEffect(() => {
    const sc = timelineScrollRef.current
    if (!sc) return
    if (playheadFromScrollRef.current) {
      playheadFromScrollRef.current = false
      return
    }
    const target = clamp(Math.round(playhead * pxPerSecond), 0, Math.max(0, stripContentW))
    ignoreScrollRef.current = true
    sc.scrollLeft = target
    setTimelineScrollLeftPx(target)
    window.requestAnimationFrame(() => {
      ignoreScrollRef.current = false
    })
  }, [playhead, pxPerSecond, stripContentW, timelinePadPx])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const user = await ensureLoggedIn()
        if (cancelled) return
        setMe(user)
        if (!user || !user.userId) throw new Error('not_authenticated')

        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        const res = await fetch('/api/create-video/project', { method: 'POST', credentials: 'same-origin', headers, body: '{}' })
        const json: any = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
        const pj = (json?.project || null) as any
        const id = Number(pj?.id)
        if (!Number.isFinite(id) || id <= 0) throw new Error('failed_to_load')
        const tlRaw = pj?.timeline && typeof pj.timeline === 'object' ? pj.timeline : null
        const tl: Timeline = {
          version: 'create_video_v1',
          playheadSeconds: roundToTenth(Number(tlRaw?.playheadSeconds || 0)),
          clips: Array.isArray(tlRaw?.clips) ? (tlRaw.clips as any) : [],
        }
        hydratingRef.current = true
        try {
          setProject(pj)
          setTimeline(tl)
          lastSavedRef.current = JSON.stringify(tl)
          undoStackRef.current = []
          setUndoDepth(0)
        } finally {
          hydratingRef.current = false
        }
      } catch (e: any) {
        if (cancelled) return
        setError(e?.message || 'Failed to load project')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Autosave timeline (debounced)
  useEffect(() => {
    if (!project?.id) return
    if (hydratingRef.current) return
    const next = { ...timeline, playheadSeconds: playhead }
    const json = JSON.stringify(next)
    if (json === lastSavedRef.current) return
    const timer = window.setTimeout(async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        const res = await fetch('/api/create-video/project', {
          method: 'PATCH',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({ timeline: next }),
        })
        const data: any = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(data?.error || 'save_failed'))
        lastSavedRef.current = json
      } catch {
        // ignore; user can still export later
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [playhead, project?.id, timeline])

  // Fetch upload names for clip pills
  useEffect(() => {
    const ids = Array.from(new Set(timeline.clips.map((c) => Number(c.uploadId)).filter((n) => Number.isFinite(n) && n > 0)))
    if (!ids.length) return
    const missing = ids.filter((id) => !namesByUploadId[id] || !durationsByUploadId[id])
    if (!missing.length) return
    let alive = true
    const qs = encodeURIComponent(missing.slice(0, 50).join(','))
    fetch(`/api/uploads/summary?ids=${qs}`, { credentials: 'same-origin' })
      .then(async (r) => {
        const json: any = await r.json().catch(() => null)
        if (!alive) return
        if (!r.ok) return
        const items: UploadSummary[] = Array.isArray(json?.items) ? json.items : []
        if (!items.length) return
        setNamesByUploadId((prev) => {
          const next = { ...prev }
          for (const it of items) {
            const id = Number((it as any).id)
            if (!Number.isFinite(id) || id <= 0) continue
            next[id] = String((it as any).modified_filename || (it as any).original_filename || `Video ${id}`)
          }
          return next
        })
        setDurationsByUploadId((prev) => {
          const next = { ...prev }
          for (const it of items as any[]) {
            const id = Number((it as any).id)
            const dur = (it as any).duration_seconds
            if (!Number.isFinite(id) || id <= 0) continue
            const d = dur == null ? null : Number(dur)
            if (d != null && Number.isFinite(d) && d > 0) next[id] = d
          }
          return next
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [durationsByUploadId, namesByUploadId, timeline.clips])

  const seek = useCallback(
    async (t: number, opts?: { autoPlay?: boolean }) => {
      const v = videoRef.current
      if (!v) return
      const tClamped = clamp(roundToTenth(t), 0, Math.max(0, totalSeconds))
      if (!timeline.clips.length) return
      const { clipIndex, within } = locate(tClamped, timeline.clips)
      activeClipIndexRef.current = clipIndex
      const clip = timeline.clips[clipIndex]
      if (!clip) return
      const sourceTime = clip.sourceStartSeconds + within
      const nextUploadId = Number(clip.uploadId)
      if (!Number.isFinite(nextUploadId) || nextUploadId <= 0) return

      if (activeUploadId !== nextUploadId) {
        setActiveUploadId(nextUploadId)
        const cdn = await getUploadCdnUrl(nextUploadId, { kind: 'edit-proxy' })
        v.src = `${cdn || `/api/uploads/${encodeURIComponent(String(nextUploadId))}/edit-proxy`}#t=0.1`
        v.load()
        const onMeta = () => {
          v.removeEventListener('loadedmetadata', onMeta)
          try { v.currentTime = Math.max(0, sourceTime) } catch {}
          const srcKey = String(v.currentSrc || v.src || '')
          if (!opts?.autoPlay && srcKey && primedFrameSrcRef.current !== srcKey) {
            primedFrameSrcRef.current = srcKey
            void primePausedFrame(v)
          }
          if (opts?.autoPlay) {
            try { void v.play() } catch {}
          }
        }
        v.addEventListener('loadedmetadata', onMeta)
      } else {
        try { v.currentTime = Math.max(0, sourceTime) } catch {}
        if (opts?.autoPlay) {
          try { void v.play() } catch {}
        }
      }
    },
    [activeUploadId, timeline.clips, totalSeconds]
  )

  // Ensure the preview initializes after the timeline loads (especially when playhead is 0.0).
  // Without this, `playhead` may not change during hydration, so the normal playhead-driven sync won't run.
  useEffect(() => {
    if (!timeline.clips.length) return
    if (activeUploadId != null) return
    void seek(playhead)
  }, [activeUploadId, playhead, seek, timeline.clips.length])

  // Keep a stable poster image for iOS Safari (initial paused frame often won’t paint reliably).
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!activeUploadId) return
      if (posterByUploadId[activeUploadId]) return
      const cdn = await getUploadCdnUrl(activeUploadId, { kind: 'thumb' })
      const url = cdn || `/api/uploads/${encodeURIComponent(String(activeUploadId))}/thumb`
      if (!alive) return
      setPosterByUploadId((prev) => (prev[activeUploadId] ? prev : { ...prev, [activeUploadId]: url }))
    })()
    return () => {
      alive = false
    }
  }, [activeUploadId, posterByUploadId])

  // Keep video position synced when playhead changes by UI
  useEffect(() => {
    if (!timeline.clips.length) return
    if (playheadFromVideoRef.current) {
      playheadFromVideoRef.current = false
      return
    }
    // If user scrubs while playing, pause for predictable behavior.
    if (playing) {
      try { videoRef.current?.pause?.() } catch {}
      setPlaying(false)
    }
    void seek(playhead)
  }, [playhead]) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (!timeline.clips.length) return
    if (v.paused) {
      try {
        v.muted = false
        v.volume = 1
      } catch {}
      void seek(playhead)
      v.play().catch(() => {})
    } else {
      try { v.pause() } catch {}
    }
  }, [playhead, seek, timeline.clips.length])

  // Drive playhead from video time while playing.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime = () => {
      if (!playing) return
      if (!timeline.clips.length) return
      const clipIndex = Math.max(0, Math.min(activeClipIndexRef.current, timeline.clips.length - 1))
      const clip = timeline.clips[clipIndex]
      if (!clip) return
      const startTimeline = clipStarts[clipIndex] || 0
      const withinNow = Math.max(0, (v.currentTime || 0) - clip.sourceStartSeconds)
      const nextPlayhead = startTimeline + withinNow
      const next = clamp(roundToTenth(nextPlayhead), 0, Math.max(0, totalSeconds))
      if (Math.abs(next - playhead) >= 0.1) {
        playheadFromVideoRef.current = true
        setTimeline((prev) => ({ ...prev, playheadSeconds: next }))
      }
      // If we reached the end of this clip, advance to next.
      const clipLen = Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds)
      if (withinNow >= clipLen - 0.12 && clipIndex < timeline.clips.length - 1) {
        const nextStart = clipStarts[clipIndex + 1] || 0
        activeClipIndexRef.current = clipIndex + 1
        playheadFromVideoRef.current = true
        setTimeline((prev) => ({ ...prev, playheadSeconds: nextStart }))
        void seek(nextStart, { autoPlay: true })
      } else if (withinNow >= clipLen - 0.05 && clipIndex === timeline.clips.length - 1) {
        try { v.pause() } catch {}
        setPlaying(false)
      }
    }
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('timeupdate', onTime)
    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('timeupdate', onTime)
    }
  }, [clipStarts, playhead, playing, seek, timeline.clips, totalSeconds])

  const openPicker = useCallback(async () => {
    if (!me?.userId) return
    setPickOpen(true)
    setPickerLoading(true)
    setPickerError(null)
    try {
      const params = new URLSearchParams({
        kind: 'video',
        status: 'uploaded,completed',
        user_id: String(me.userId),
        limit: '200',
      })
      const res = await fetch(`/api/uploads?${params.toString()}`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const items: UploadListItem[] = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : []
      setPickerItems(items)
    } catch (e: any) {
      setPickerError(e?.message || 'Failed to load videos')
    } finally {
      setPickerLoading(false)
    }
  }, [me?.userId])

  const addClipFromUpload = useCallback(
    (upload: UploadListItem) => {
      const dur = upload.duration_seconds != null ? Number(upload.duration_seconds) : null
      if (dur == null || !Number.isFinite(dur) || dur <= 0) {
        setPickerError('That video is missing duration metadata. Please try a different video.')
        return
      }
      setDurationsByUploadId((prev) => (prev[Number(upload.id)] ? prev : { ...prev, [Number(upload.id)]: Number(dur) }))
      const id = `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const newClip: Clip = {
        id,
        uploadId: Number(upload.id),
        sourceStartSeconds: 0,
        sourceEndSeconds: roundToTenth(dur),
      }
      snapshotUndo()
      setTimeline((prev) => {
        const t = clamp(roundToTenth(prev.playheadSeconds || 0), 0, Math.max(0, sumDur(prev.clips)))
        if (!prev.clips.length) return { ...prev, clips: [newClip], playheadSeconds: 0 }
        const { clipIndex, within } = locate(t, prev.clips)
        const starts = computeClipStarts(prev.clips)
        const insertIdx = within <= 0.05 ? clipIndex : within >= (prev.clips[clipIndex].sourceEndSeconds - prev.clips[clipIndex].sourceStartSeconds) - 0.05 ? clipIndex + 1 : clipIndex + 1
        const nextClips = [...prev.clips.slice(0, insertIdx), newClip, ...prev.clips.slice(insertIdx)]
        return { ...prev, clips: nextClips }
      })
      setSelectedClipId(id)
      setPickOpen(false)
    },
    [setTimeline, snapshotUndo]
  )

  const split = useCallback(() => {
    if (!selectedClip) return
    const t = playhead
    const { clipIndex, within } = locate(t, timeline.clips)
    const clip = timeline.clips[clipIndex]
    if (!clip || clip.id !== selectedClip.id) return
    const cut = roundToTenth(clip.sourceStartSeconds + within)
    const minLen = 0.2
    if (cut <= clip.sourceStartSeconds + minLen || cut >= clip.sourceEndSeconds - minLen) return
    snapshotUndo()
    const left: Clip = { ...clip, id: `${clip.id}_a`, sourceEndSeconds: cut }
    const right: Clip = { ...clip, id: `${clip.id}_b`, sourceStartSeconds: cut }
    setTimeline((prev) => {
      const idx = prev.clips.findIndex((c) => c.id === clip.id)
      if (idx < 0) return prev
      const next = [...prev.clips.slice(0, idx), left, right, ...prev.clips.slice(idx + 1)]
      return { ...prev, clips: next }
    })
    setSelectedClipId(right.id)
  }, [playhead, selectedClip, snapshotUndo, timeline.clips])

  const deleteSelected = useCallback(() => {
    if (!timeline.clips.length) return
    const fallbackIdx = findClipIndexAtTime(playhead, timeline.clips, clipStarts)
    const fallback = timeline.clips[fallbackIdx] || null
    const target = selectedClip || fallback
    if (!target) return
    snapshotUndo()
    setTimeline((prev) => {
      const idx = prev.clips.findIndex((c) => c.id === target.id)
      if (idx < 0) return prev
      const next = prev.clips.filter((c) => c.id !== target.id)
      const nextTotal = sumDur(next)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...prev, clips: next, playheadSeconds: nextPlayhead }
    })
    // Keep selection stable by selecting the next clip (or previous if we deleted the last).
    setSelectedClipId((prevSel) => {
      const wasSelected = prevSel === target.id
      if (!wasSelected && prevSel) return prevSel
      const nextIdx = Math.min(fallbackIdx, Math.max(0, timeline.clips.length - 2))
      const nextClip = timeline.clips.filter((c) => c.id !== target.id)[nextIdx] || null
      return nextClip ? nextClip.id : null
    })
  }, [clipStarts, playhead, selectedClip, snapshotUndo, timeline.clips])

  const openClipEditor = useCallback(() => {
    if (!selectedClip) return
    setClipEditor({ id: selectedClip.id, start: selectedClip.sourceStartSeconds, end: selectedClip.sourceEndSeconds })
    setClipEditorError(null)
  }, [selectedClip])

  const saveClipEditor = useCallback(() => {
    if (!clipEditor) return
    const start = roundToTenth(Number(clipEditor.start))
    const end = roundToTenth(Number(clipEditor.end))
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setClipEditorError('End must be after start.')
      return
    }
    const clip = timeline.clips.find((c) => c.id === clipEditor.id) || null
    const maxDur = clip ? (durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds) : null
    if (maxDur != null && Number.isFinite(maxDur) && end > maxDur + 1e-6) {
      setClipEditorError(`End exceeds source duration (${Number(maxDur).toFixed(1)}s).`)
      return
    }
    snapshotUndo()
    setTimeline((prev) => {
      const idx = prev.clips.findIndex((c) => c.id === clipEditor.id)
      if (idx < 0) return prev
      const clip = prev.clips[idx]
      const maxEnd = durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds
      const safeStart = Math.max(0, start)
      const safeEnd = Math.min(maxEnd, Math.max(safeStart + 0.2, end))
      const updated: Clip = { ...clip, sourceStartSeconds: safeStart, sourceEndSeconds: safeEnd }
      const next = prev.clips.slice()
      next[idx] = updated
      const nextTotal = sumDur(next)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...prev, clips: next, playheadSeconds: nextPlayhead }
    })
    setClipEditor(null)
  }, [clipEditor, durationsByUploadId, snapshotUndo, timeline.clips])

  useEffect(() => {
    if (!clipDragging) return
    const onMove = (e: PointerEvent) => {
      const drag = clipDragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      e.preventDefault()
      const dx = e.clientX - drag.startClientX
      const deltaSeconds = dx / pxPerSecond
      const minLen = 0.2
      setTimeline((prev) => {
        const idx = prev.clips.findIndex((c) => c.id === drag.clipId)
        if (idx < 0) return prev
        const c = prev.clips[idx]
        let startS = c.sourceStartSeconds
        let endS = c.sourceEndSeconds
        if (drag.edge === 'start') {
          startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), 0, Math.max(0, drag.startEndSeconds - minLen))
        } else {
          endS = clamp(
            roundToTenth(drag.startEndSeconds + deltaSeconds),
            Math.max(0, drag.startStartSeconds + minLen),
            drag.maxDurationSeconds
          )
        }
        const next = prev.clips.slice()
        next[idx] = { ...c, sourceStartSeconds: startS, sourceEndSeconds: endS }
        const nextTotal = sumDur(next)
        const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
        return { ...prev, clips: next, playheadSeconds: nextPlayhead }
      })
    }
    const onUp = (e: PointerEvent) => {
      const drag = clipDragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      clipDragRef.current = null
      setClipDragging(false)
      try { timelineScrollRef.current?.releasePointerCapture?.(e.pointerId) } catch {}
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove as any)
      window.removeEventListener('pointerup', onUp as any)
      window.removeEventListener('pointercancel', onUp as any)
    }
  }, [clipDragging, pxPerSecond])

  const archiveAndRestart = useCallback(async () => {
    if (!project?.id) return
    const ok = window.confirm('Start a new Create Video project? This will archive the current timeline.')
    if (!ok) return
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      await fetch('/api/create-video/project/archive', { method: 'POST', credentials: 'same-origin', headers, body: '{}' })
    } catch {}
    undoStackRef.current = []
    setUndoDepth(0)
    window.location.reload()
  }, [project?.id])

  const exportNow = useCallback(async () => {
    if (!timeline.clips.length) return
    setExporting(true)
    setExportError(null)
    setExportStatus('Starting export…')
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch('/api/create-video/project/export', { method: 'POST', credentials: 'same-origin', headers, body: '{}' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'export_failed'))
      setExportStatus('Export in progress…')
    } catch (e: any) {
      setExportError(e?.message || 'export_failed')
      setExportStatus(null)
      setExporting(false)
    }
  }, [timeline.clips.length])

  useEffect(() => {
    if (!exporting) return
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch('/api/create-video/project/export-status', { credentials: 'same-origin' })
        const json: any = await res.json().catch(() => null)
        if (!alive) return
        const status = String(json?.status || '')
        if (!status || status === 'idle') {
          setExportStatus('Waiting…')
          return
        }
        if (status === 'completed') {
          const uploadId = Number(json?.resultUploadId)
          if (Number.isFinite(uploadId) && uploadId > 0) {
            window.location.href = `/produce?upload=${encodeURIComponent(String(uploadId))}&from=${encodeURIComponent('/create-video')}`
            return
          }
          setExportError('Export completed but missing upload id.')
          setExporting(false)
          return
        }
        if (status === 'failed' || status === 'dead') {
          setExportError(String(json?.error?.message || json?.error?.code || 'export_failed'))
          setExporting(false)
          return
        }
        setExportStatus(`Export: ${status}`)
      } catch {
        // ignore transient
      }
    }
    tick()
    const t = window.setInterval(tick, 2000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [exporting])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Create Video</h1>
          <p style={{ color: '#bbb' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Create Video</h1>
          <p style={{ color: '#ff9b9b' }}>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href="/uploads" style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back to Uploads</a>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={archiveAndRestart}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.06)',
                color: '#fff',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              New Project
            </button>
            <button
              type="button"
              onClick={openPicker}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(212,175,55,0.65)',
                background: 'rgba(212,175,55,0.12)',
                color: '#fff',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Add Video
            </button>
            <button
              type="button"
              onClick={exportNow}
              disabled={!timeline.clips.length || exporting}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(10,132,255,0.55)',
                background: exporting ? 'rgba(10,132,255,0.18)' : '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                cursor: !timeline.clips.length || exporting ? 'default' : 'pointer',
              }}
            >
              Export
            </button>
          </div>
        </div>

        <h1 style={{ margin: '12px 0 10px', fontSize: 28 }}>Create Video</h1>
        <div style={{ color: '#bbb', fontSize: 13 }}>
          Clips: {timeline.clips.length} • Total: {totalSeconds.toFixed(1)}s
        </div>

        <div style={{ marginTop: 14, borderRadius: 14, border: '1px solid rgba(255,255,255,0.14)', overflow: 'hidden', background: '#000' }}>
          <div style={{ width: '100%', aspectRatio: '9 / 16', background: '#000' }}>
            <video
              ref={videoRef}
              playsInline
              preload="metadata"
              poster={activePoster || undefined}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
        </div>

        <div style={{ marginTop: 14, borderRadius: 14, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(0,0,0,0.35)', padding: 12 }}>
          <div style={{ position: 'relative', paddingTop: 14 }}>
            <div style={{ position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)', color: '#bbb', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {playhead.toFixed(1)}s
            </div>
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: '#ff3b30',
                  transform: 'translateX(-50%)',
                  zIndex: 50,
                  pointerEvents: 'none',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.75)',
                }}
              />
              <div
                ref={(el) => {
                  timelineScrollRef.current = el
                  setTimelineScrollEl(el)
                }}
                onScroll={() => {
                  const sc = timelineScrollRef.current
                  if (!sc) return
                  if (ignoreScrollRef.current) return
                  if (clipDragRef.current) return
                  const nextScrollLeft = Math.max(0, sc.scrollLeft)
                  setTimelineScrollLeftPx(nextScrollLeft)
                  const t = clamp(roundToTenth(nextScrollLeft / pxPerSecond), 0, Math.max(0, totalSeconds))
                  if (Math.abs(t - playhead) < 0.05) return
                  playheadFromScrollRef.current = true
                  setTimeline((prev) => ({ ...prev, playheadSeconds: t }))
                }}
                onPointerDown={(e) => {
                  const sc = timelineScrollRef.current
                  if (!sc) return
                  if (!timeline.clips.length) return
                  const rect = sc.getBoundingClientRect()
                  const y = e.clientY - rect.top
                  if (!(y >= PILL_Y && y <= PILL_Y + PILL_H)) return

                  const padPx = timelinePadPx || Math.floor((sc.clientWidth || 0) / 2)
                  const clickXInScroll = (e.clientX - rect.left) + sc.scrollLeft
                  const x = clickXInScroll - padPx
                  const t = clamp(roundToTenth(x / pxPerSecond), 0, Math.max(0, totalSeconds))
                  const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
                  const clip = timeline.clips[idx]
                  if (!clip) return

                  const start = (clipStarts[idx] || 0)
                  const len = Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds)
                  const leftX = padPx + start * pxPerSecond
                  const rightX = padPx + (start + len) * pxPerSecond
                  const nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                  const nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                  if (!nearLeft && !nearRight) return

                  e.preventDefault()
                  snapshotUndo()
                  setSelectedClipId(clip.id)
                  const maxDur = durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds
                  clipDragRef.current = {
                    clipId: clip.id,
                    edge: nearLeft ? 'start' : 'end',
                    pointerId: e.pointerId,
                    startClientX: e.clientX,
                    startStartSeconds: clip.sourceStartSeconds,
                    startEndSeconds: clip.sourceEndSeconds,
                    maxDurationSeconds: Number.isFinite(maxDur) && maxDur > 0 ? maxDur : clip.sourceEndSeconds,
                  }
                  setClipDragging(true)
                  try { sc.setPointerCapture(e.pointerId) } catch {}
                }}
                onClick={(e) => {
                  const sc = timelineScrollRef.current
                  if (!sc) return
                  const rect = sc.getBoundingClientRect()
                  const clickX = e.clientX - rect.left
                  const padPx = timelinePadPx || Math.floor((sc.clientWidth || 0) / 2)
                  const x = clickX + sc.scrollLeft - padPx
                  const t = clamp(roundToTenth(x / pxPerSecond), 0, Math.max(0, totalSeconds))
                  const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
                  const clip = timeline.clips[idx]
                  if (clip) setSelectedClipId(clip.id)
                }}
                style={{
                  width: '100%',
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  WebkitOverflowScrolling: 'touch',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.28)',
                  background: 'rgba(0,0,0,0.60)',
                  height: 64,
                  position: 'relative',
                  touchAction: clipDragging ? 'none' : 'pan-x',
                }}
              >
                <div style={{ width: timelinePadPx + stripContentW + timelinePadPx, height: 64, position: 'relative' }}>
                  <canvas
                    ref={timelineCanvasRef}
                    style={{ position: 'sticky', left: 0, top: 0, display: 'block', pointerEvents: 'none' }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setTimeline((prev) => ({ ...prev, playheadSeconds: clamp(playhead - 0.1, 0, Math.max(0, totalSeconds)) }))}
                disabled={totalSeconds <= 0}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                  flex: '0 0 auto',
                }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setTimeline((prev) => ({ ...prev, playheadSeconds: clamp(playhead + 0.1, 0, Math.max(0, totalSeconds)) }))}
                disabled={totalSeconds <= 0}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                  flex: '0 0 auto',
                }}
              >
                ›
              </button>
              <button
                type="button"
                onClick={togglePlay}
                disabled={!timeline.clips.length}
                style={{
                  marginLeft: 'auto',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(10,132,255,0.55)',
                  background: playing ? 'rgba(10,132,255,0.18)' : '#0a84ff',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: !timeline.clips.length ? 'default' : 'pointer',
                  flex: '0 0 auto',
                }}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: canUndo ? '#0c0c0c' : 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: canUndo ? 'pointer' : 'default',
                  flex: '0 0 auto',
                }}
              >
                Undo
              </button>
              <button
                type="button"
                onClick={openClipEditor}
                disabled={!selectedClip}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: selectedClip ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: selectedClip ? 'pointer' : 'default',
                  flex: '0 0 auto',
                }}
              >
                Video
              </button>
              <button
                type="button"
                onClick={split}
                disabled={!selectedClip}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: selectedClip ? '#0c0c0c' : 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: selectedClip ? 'pointer' : 'default',
                  flex: '0 0 auto',
                }}
              >
                Split
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                disabled={!selectedClip}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: selectedClip ? '#300' : 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: selectedClip ? 'pointer' : 'default',
                  flex: '0 0 auto',
                }}
              >
                Delete
              </button>
            </div>
        </div>

        {exportStatus ? <div style={{ marginTop: 12, color: '#bbb' }}>{exportStatus}</div> : null}
        {exportError ? <div style={{ marginTop: 10, color: '#ff9b9b' }}>{exportError}</div> : null}
      </div>

      {pickOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}
          onClick={() => setPickOpen(false)}
        >
          <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setPickOpen(false)} style={{ color: '#0a84ff', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14 }}>
                ← Back
              </button>
              <div style={{ color: '#bbb', fontSize: 13 }}>Videos: {pickerItems.length}</div>
            </div>
            <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Select Video</h1>
            {pickerLoading ? <div style={{ color: '#bbb' }}>Loading…</div> : null}
            {pickerError ? <div style={{ color: '#ff9b9b' }}>{pickerError}</div> : null}
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              {pickerItems.map((it) => {
                const id = Number(it.id)
                if (!Number.isFinite(id) || id <= 0) return null
                const name = String(it.modified_filename || it.original_filename || `Upload ${id}`)
                const thumb = `/api/uploads/${encodeURIComponent(String(id))}/thumb`
                const dur = it.duration_seconds != null ? Number(it.duration_seconds) : null
                return (
                  <button
                    key={`pick-${id}`}
                    type="button"
                    onClick={() => addClipFromUpload(it)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '96px 1fr',
                      gap: 12,
                      alignItems: 'center',
                      padding: 12,
                      borderRadius: 12,
                      border: '1px solid rgba(212,175,55,0.55)',
                      background: 'rgba(0,0,0,0.35)',
                      color: '#fff',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <img src={thumb} alt="" style={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 8, background: '#000' }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      <div style={{ color: '#bbb', fontSize: 12, marginTop: 2 }}>
                        {dur != null && Number.isFinite(dur) ? `${dur}s` : 'Duration unknown'}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}

      {clipEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '24px 16px 80px' }}
          onClick={() => { setClipEditor(null); setClipEditorError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, margin: '0 auto', borderRadius: 14, border: '1px solid rgba(212,175,55,0.55)', background: 'rgba(15,15,15,0.96)', padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Video Properties</div>
              <button type="button" onClick={() => { setClipEditor(null); setClipEditorError(null) }} style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}>
                Close
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
                <input type="number" step={0.1} min={0} value={String(clipEditor.start)} onChange={(e) => { setClipEditorError(null); setClipEditor((p) => p ? ({ ...p, start: Number(e.target.value) }) : p) }} style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>End (seconds)</div>
                <input type="number" step={0.1} min={0} value={String(clipEditor.end)} onChange={(e) => { setClipEditorError(null); setClipEditor((p) => p ? ({ ...p, end: Number(e.target.value) }) : p) }} style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }} />
              </label>
              {clipEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{clipEditorError}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
                <button type="button" onClick={() => { setClipEditor(null); setClipEditorError(null) }} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="button" onClick={saveClipEditor} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(212,175,55,0.65)', background: 'rgba(212,175,55,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
