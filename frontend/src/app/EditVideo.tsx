import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Range = { start: number; end: number }

type OverlayItem = {
  id: string
  kind: 'image'
  track: 'A'
  uploadId: number
  startSeconds: number
  endSeconds: number
}

type AudioEnvelope = {
  version?: string
  intervalSeconds?: number
  durationSeconds?: number
  hasAudio?: boolean
  points?: Array<{ t: number; v: number }>
}

function buildEnvelopeValues(envelope: AudioEnvelope | null): { intervalSeconds: number; vals: number[] } | null {
  if (!envelope) return null
  const points = Array.isArray(envelope.points) ? envelope.points : []
  const intervalSeconds = envelope.intervalSeconds != null && Number.isFinite(Number(envelope.intervalSeconds)) ? Number(envelope.intervalSeconds) : 0.1
  const durationSeconds = envelope.durationSeconds != null && Number.isFinite(Number(envelope.durationSeconds)) ? Number(envelope.durationSeconds) : null
  if (!points.length || !intervalSeconds || intervalSeconds <= 0) return null
  const len = durationSeconds != null ? Math.ceil(durationSeconds / intervalSeconds) + 2 : Math.ceil((points[points.length - 1]?.t || 0) / intervalSeconds) + 2
  const vals = new Array<number>(Math.max(0, len)).fill(0)
  for (const p of points) {
    const t = Number(p?.t)
    const v = Number(p?.v)
    if (!Number.isFinite(t) || t < 0) continue
    const idx = Math.round(t / intervalSeconds)
    if (idx < 0 || idx >= vals.length) continue
    vals[idx] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
  }
  return { intervalSeconds, vals }
}

function drawAudioEnvelopeViewport(opts: {
  canvas: HTMLCanvasElement
  viewportWidthPx: number
  heightPx: number
  pxPerSecond: number
  padPx: number
  scrollLeftPx: number
  totalEditedSeconds: number
  segs: Range[]
  envelopeVals: { intervalSeconds: number; vals: number[] }
  lineColor?: string
}): void {
  const c = opts.canvas
  const viewportW = Math.max(0, Math.round(opts.viewportWidthPx))
  const heightPx = Math.max(0, Math.round(opts.heightPx))
  const dpr = Math.max(1, Math.round((window.devicePixelRatio || 1) * 100) / 100)

  c.width = Math.max(1, Math.floor(viewportW * dpr))
  c.height = Math.max(1, Math.floor(heightPx * dpr))

  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewportW, heightPx)

  if (!opts.segs.length || opts.totalEditedSeconds <= 0) return

  const interval = opts.envelopeVals.intervalSeconds
  const vals = opts.envelopeVals.vals
  if (!interval || interval <= 0 || !vals.length) return

  const pps = Math.max(1, opts.pxPerSecond)
  const padPx = Math.max(0, opts.padPx)
  const scrollLeft = Math.max(0, opts.scrollLeftPx)

  const tStart = clamp((scrollLeft - padPx) / pps, 0, Math.max(0, opts.totalEditedSeconds))
  const tEnd = clamp((scrollLeft + viewportW - padPx) / pps, 0, Math.max(0, opts.totalEditedSeconds))
  if (!(tEnd > tStart)) return

  const padY = 1
  const usableH = Math.max(1, heightPx - padY * 2)
  ctx.lineWidth = 1.25
  ctx.strokeStyle = opts.lineColor || 'rgba(212,175,55,0.9)'
  ctx.beginPath()

  const segmentStartsEdited = segmentEditedStarts(opts.segs)
  let segIdx = 0
  const eps = 1e-6

  const firstSample = Math.floor(tStart / interval) * interval
  const lastSample = Math.ceil(tEnd / interval) * interval
  const sampleCount = Math.max(1, Math.ceil((lastSample - firstSample) / interval) + 1)
  const step = Math.max(1, Math.ceil(sampleCount / 1500))

  let hasMoved = false
  for (let n = 0; n < sampleCount; n += step) {
    const tEdited = firstSample + n * interval
    if (tEdited < tStart - eps) continue
    if (tEdited > tEnd + eps) break

    while (segIdx < opts.segs.length - 1) {
      const segStartE = segmentStartsEdited[segIdx] || 0
      const segLen = Math.max(0, (opts.segs[segIdx]?.end || 0) - (opts.segs[segIdx]?.start || 0))
      const segEndE = segStartE + segLen
      if (tEdited < segEndE - eps) break
      segIdx++
    }

    const seg = opts.segs[segIdx]
    const segStartE = segmentStartsEdited[segIdx] || 0
    const tOrig = Math.max(0, Number(seg.start || 0) + (tEdited - segStartE))
    const vIdx = Math.round(tOrig / interval)
    const v = vIdx >= 0 && vIdx < vals.length ? vals[vIdx] : 0

    const x = padPx + tEdited * pps - scrollLeft
    const y = padY + (1 - Math.max(0, Math.min(1, v))) * usableH
    if (!hasMoved) {
      ctx.moveTo(x, y)
      hasMoved = true
    } else {
      ctx.lineTo(x, y)
    }
  }

  if (hasMoved) ctx.stroke()
}

const MAX_CUTS = 20
const MAX_SEGMENTS = MAX_CUTS + 1
const MIN_SEGMENT_SECONDS = 0.2

function parseUploadId(): number | null {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('upload')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseFrom(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('from')
    if (!raw) return null
    const decoded = decodeURIComponent(raw)
    return decoded.startsWith('/') ? decoded : null
  } catch {
    return null
  }
}

function parsePick(): 'overlayImage' | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('pick') || '').toLowerCase()
    if (raw === 'overlayimage') return 'overlayImage'
  } catch {}
  return null
}

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function parseEditRangesFromFromUrl(from: string | null): Range[] | null {
  try {
    if (!from) return null
    const u = new URL(from, window.location.origin)
    const raw = String(u.searchParams.get('editRanges') || '').trim()
    if (!raw) return null
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
    const out: Range[] = []
    for (const p of parts) {
      const m = p.match(/^([0-9.]+)\s*-\s*([0-9.]+)$/)
      if (!m) continue
      const start = roundToTenth(Number(m[1]))
      const end = roundToTenth(Number(m[2]))
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      if (start < 0 || end <= start) continue
      out.push({ start, end })
    }
    if (!out.length) return null
    out.sort((a, b) => a.start - b.start || a.end - b.end)
    return out
  } catch {
    return null
  }
}

function parseOverlayItemsFromFromUrl(from: string | null): OverlayItem[] {
  try {
    if (!from) return []
    const u = new URL(from, window.location.origin)
    const raw = String(u.searchParams.get('overlayItems') || '').trim()
    if (!raw) return []
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
    const out: OverlayItem[] = []
    for (const p of parts) {
      // Accept: img:<uploadId>:A:<start>-<end>[:...]
      const m = p.match(/^img:(\d+):([A-Za-z]+):([0-9.]+)\s*-\s*([0-9.]+)(?::.*)?$/)
      if (!m) continue
      const uploadId = Number(m[1])
      const track = String(m[2] || '').toUpperCase()
      const start = roundToTenth(Number(m[3]))
      const end = roundToTenth(Number(m[4]))
      if (!Number.isFinite(uploadId) || uploadId <= 0) continue
      if (track !== 'A') continue
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      if (start < 0 || end <= start) continue
      out.push({
        id: `ov_${uploadId}_${start}_${end}`,
        kind: 'image',
        track: 'A',
        uploadId,
        startSeconds: start,
        endSeconds: end,
      })
    }
    out.sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds || a.uploadId - b.uploadId)
    return out
  } catch {
    return []
  }
}

function formatOverlayItemsParam(items: OverlayItem[]): string {
  const fmt = (n: number) => {
    const s = roundToTenth(n).toFixed(1)
    return s.endsWith('.0') ? s.slice(0, -2) : s
  }
  return items
    .filter((it) => it && it.kind === 'image' && it.track === 'A')
    .map((it) => `img:${it.uploadId}:A:${fmt(it.startSeconds)}-${fmt(it.endSeconds)}`)
    .join(',')
}

function parseTrimFromFromUrl(from: string | null): { start: number | null; end: number | null } {
  try {
    if (!from) return { start: null, end: null }
    const u = new URL(from, window.location.origin)
    const s = u.searchParams.get('editStart')
    const e = u.searchParams.get('editEnd')
    const start = s != null && s !== '' && Number.isFinite(Number(s)) ? Math.max(0, roundToTenth(Number(s))) : null
    const end = e != null && e !== '' && Number.isFinite(Number(e)) ? Math.max(0, roundToTenth(Number(e))) : null
    return { start, end }
  } catch {
    return { start: null, end: null }
  }
}

function formatRangeParam(ranges: Range[]): string {
  const fmt = (n: number) => {
    const s = roundToTenth(n).toFixed(1)
    return s.endsWith('.0') ? s.slice(0, -2) : s
  }
  return ranges.map((r) => `${fmt(r.start)}-${fmt(r.end)}`).join(',')
}

function applyRangesToUrl(from: string, ranges: Range[] | null): string {
  const u = new URL(from, window.location.origin)
  if (!ranges || !ranges.length) u.searchParams.delete('editRanges')
  else u.searchParams.set('editRanges', formatRangeParam(ranges))
  // Avoid conflicting legacy params.
  u.searchParams.delete('editStart')
  u.searchParams.delete('editEnd')
  const qs = u.searchParams.toString()
  return qs ? `${u.pathname}?${qs}` : u.pathname
}

function applyOverlayItemsToUrl(from: string, items: OverlayItem[] | null): string {
  const u = new URL(from, window.location.origin)
  if (!items || !items.length) u.searchParams.delete('overlayItems')
  else u.searchParams.set('overlayItems', formatOverlayItemsParam(items))
  const qs = u.searchParams.toString()
  return qs ? `${u.pathname}?${qs}` : u.pathname
}

function rippleRemoveWindowFromOverlayItems(items: OverlayItem[], cutStart: number, cutEnd: number): OverlayItem[] {
  const s = Math.max(0, roundToTenth(cutStart))
  const e = Math.max(0, roundToTenth(cutEnd))
  if (!(e > s)) return items
  const removed = e - s
  const out: OverlayItem[] = []
  for (const it of items) {
    const a = roundToTenth(it.startSeconds)
    const b = roundToTenth(it.endSeconds)
    if (!(b > a)) continue
    // Entirely before cut.
    if (b <= s) {
      out.push({ ...it, startSeconds: a, endSeconds: b })
      continue
    }
    // Entirely after cut: shift left.
    if (a >= e) {
      out.push({ ...it, startSeconds: roundToTenth(a - removed), endSeconds: roundToTenth(b - removed) })
      continue
    }
    // Fully inside cut: drop.
    if (a >= s && b <= e) continue

    // Overlaps: preserve continuity and ripple.
    if (a < s && b > e) {
      // Span across cut: shorten by removed duration.
      out.push({ ...it, startSeconds: a, endSeconds: roundToTenth(b - removed) })
      continue
    }
    if (a < s && b > s && b <= e) {
      // Tail falls into removed region: truncate at cut start.
      out.push({ ...it, startSeconds: a, endSeconds: s })
      continue
    }
    if (a >= s && a < e && b > e) {
      // Head in removed region: start at cut start and shift end.
      out.push({ ...it, startSeconds: s, endSeconds: roundToTenth(b - removed) })
      continue
    }
  }
  out.sort((x, y) => x.startSeconds - y.startSeconds || x.endSeconds - y.endSeconds || x.uploadId - y.uploadId)
  return out
}

function sumRanges(ranges: Range[]): number {
  return ranges.reduce((acc, r) => acc + Math.max(0, r.end - r.start), 0)
}

function editedToOriginalTime(tEdited: number, ranges: Range[]): { tOriginal: number; segIndex: number } {
  const eps = 1e-6
  let acc = 0
  for (let i = 0; i < ranges.length; i++) {
    const len = Math.max(0, ranges[i].end - ranges[i].start)
    const next = acc + len
    // Treat segment ends as exclusive so an exact boundary maps to the *next* segment,
    // avoiding "stuck at segment end" playback behavior.
    if (tEdited < next - eps || i === ranges.length - 1) {
      const within = clamp(tEdited - acc, 0, len)
      return { tOriginal: ranges[i].start + within, segIndex: i }
    }
    acc = next
  }
  return { tOriginal: ranges[0]?.start || 0, segIndex: 0 }
}

function originalToEditedTime(tOriginal: number, ranges: Range[]): { tEdited: number; segIndex: number } {
  const eps = 1e-6
  let acc = 0
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    const len = Math.max(0, r.end - r.start)
    const isLast = i === ranges.length - 1
    const inRange = isLast ? (tOriginal >= r.start - eps && tOriginal <= r.end + eps) : (tOriginal >= r.start - eps && tOriginal < r.end - eps)
    if (inRange) {
      return { tEdited: acc + clamp(tOriginal - r.start, 0, len), segIndex: i }
    }
    acc += len
  }
  // If between segments, snap to nearest next segment start.
  let acc2 = 0
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    const len = Math.max(0, r.end - r.start)
    if (tOriginal < r.start) return { tEdited: acc2, segIndex: i }
    acc2 += len
  }
  return { tEdited: Math.max(0, acc2), segIndex: Math.max(0, ranges.length - 1) }
}

function segmentEditedStarts(ranges: Range[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const r of ranges) {
    out.push(acc)
    acc += Math.max(0, r.end - r.start)
  }
  return out
}

function editedTimeToSegmentIndex(tEdited: number, ranges: Range[]): number {
  const starts = segmentEditedStarts(ranges)
  for (let i = 0; i < ranges.length; i++) {
    const len = Math.max(0, ranges[i].end - ranges[i].start)
    const a = starts[i]
    const b = a + len
    if (tEdited >= a && tEdited < b) return i
  }
  return Math.max(0, ranges.length - 1)
}

export default function EditVideo() {
  const uploadId = useMemo(() => parseUploadId(), [])
  const from = useMemo(() => parseFrom(), [])
  const [pick, setPick] = useState<'overlayImage' | null>(() => parsePick())
  const initialRanges = useMemo(() => parseEditRangesFromFromUrl(from), [from])
  const initialTrim = useMemo(() => parseTrimFromFromUrl(from), [from])
  const initialOverlayItems = useMemo(() => parseOverlayItemsFromFromUrl(from), [from])

  const [retryNonce, setRetryNonce] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const initialSeekDoneRef = useRef(false)
  const [proxyError, setProxyError] = useState<string | null>(null)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const [timelinePadPx, setTimelinePadPx] = useState(0)
  const [videoMuted, setVideoMuted] = useState(true)
  const [audioEnvelope, setAudioEnvelope] = useState<AudioEnvelope | null>(null)
  const [audioEnvelopeStatus, setAudioEnvelopeStatus] = useState<'idle' | 'pending' | 'ready' | 'error'>('idle')
  const audioCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const envelopeVals = useMemo(
    () => (audioEnvelopeStatus === 'ready' ? buildEnvelopeValues(audioEnvelope) : null),
    [audioEnvelope, audioEnvelopeStatus],
  )

  const [durationOriginal, setDurationOriginal] = useState(0)
  const [ranges, setRanges] = useState<Range[] | null>(initialRanges)
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [overlayItems, setOverlayItems] = useState<OverlayItem[]>(() => initialOverlayItems || [])
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [playheadEdited, setPlayheadEdited] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<
    Array<{ ranges: Range[]; selectedIndex: number; playheadEdited: number; overlayItems: OverlayItem[]; selectedOverlayId: string | null }>
  >([])
  const [overlayPickerLoading, setOverlayPickerLoading] = useState(false)
  const [overlayPickerError, setOverlayPickerError] = useState<string | null>(null)
  const [overlayPickerItems, setOverlayPickerItems] = useState<any[]>([])

  // iOS Safari often won’t render an initial paused frame for a <video> without a poster until playback begins.
  // Adding a time fragment and starting muted improves first-frame paint reliability.
  const src = uploadId ? `/api/uploads/${encodeURIComponent(String(uploadId))}/edit-proxy?b=${retryNonce}#t=0.1` : null
  const backHref = from || (uploadId ? `/produce?upload=${encodeURIComponent(String(uploadId))}` : '/produce')

  const totalEditedDuration = useMemo(() => (ranges ? sumRanges(ranges) : 0), [ranges])
  const cutCount = useMemo(() => (ranges ? Math.max(0, ranges.length - 1) : 0), [ranges])

  const pushQueryParams = useCallback((updates: Record<string, string | null>, state: any = {}) => {
    const params = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === '') params.delete(k)
      else params.set(k, v)
    }
    const qs = params.toString()
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    window.history.pushState(state, '', next)
    setPick(parsePick())
  }, [])

  useEffect(() => {
    const onPop = () => setPick(parsePick())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!pick) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [pick])

  useEffect(() => {
    if (pick !== 'overlayImage') return
    let alive = true
    setOverlayPickerLoading(true)
    setOverlayPickerError(null)
    fetch('/api/uploads?kind=image&image_role=overlay&limit=200', { credentials: 'same-origin' })
      .then(async (r) => {
        if (!alive) return
        if (!r.ok) throw new Error('failed_to_load')
        const json: any = await r.json().catch(() => null)
        const items = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : []
        setOverlayPickerItems(items)
      })
      .catch((e: any) => {
        if (!alive) return
        setOverlayPickerError(e?.message || 'Failed to load overlay images')
      })
      .finally(() => {
        if (!alive) return
        setOverlayPickerLoading(false)
      })
    return () => {
      alive = false
    }
  }, [pick])

  useEffect(() => {
    initialSeekDoneRef.current = false
    setVideoMuted(true)
  }, [retryNonce, uploadId])

  const attemptInitialSeekToFirstKeptFrame = useCallback(() => {
    if (initialSeekDoneRef.current) return
    const v = videoRef.current
    if (!v) return
    if (!ranges || !ranges.length) return
    const start = Number(ranges[0]?.start || 0)
    if (!Number.isFinite(start) || start <= 0) return

    // Only seek once the browser has at least loaded metadata/seekable ranges.
    const canSeek = v.readyState >= 1 && (v.seekable?.length ? v.seekable.length > 0 : true)
    if (!canSeek) return

    try {
      v.currentTime = start
      initialSeekDoneRef.current = true
    } catch {}
  }, [ranges])

  // Ensure we have a duration even if the browser delays `video.duration` until user interaction.
  useEffect(() => {
    if (!uploadId) return
    let alive = true
    fetch(`/api/uploads/${encodeURIComponent(String(uploadId))}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(async (r) => {
        if (!alive) return
        if (!r.ok) return
        const json: any = await r.json().catch(() => null)
        if (!alive || !json) return
        const dRaw = json.duration_seconds ?? json.durationSeconds ?? null
        const d = dRaw != null ? Number(dRaw) : 0
        if (Number.isFinite(d) && d > 0) {
          setDurationOriginal((prev) => (prev > 0 ? prev : d))
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [uploadId])

  // Fetch audio envelope (best-effort), polling while pending.
  useEffect(() => {
    if (!uploadId) return
    let alive = true
    let timer: any = null
    let attempt = 0

    const poll = async () => {
      if (!alive) return
      setAudioEnvelopeStatus((s) => (s === 'ready' ? 'ready' : 'pending'))
      try {
        const res = await fetch(`/api/uploads/${encodeURIComponent(String(uploadId))}/audio-envelope`, { credentials: 'same-origin' })
        if (!alive) return
        if (res.status === 202) {
          setAudioEnvelopeStatus('pending')
        } else if (res.ok) {
          const json = (await res.json().catch(() => null)) as any
          if (!alive) return
          setAudioEnvelope(json || null)
          setAudioEnvelopeStatus('ready')
          return
        } else {
          setAudioEnvelopeStatus('error')
          return
        }
      } catch {
        if (!alive) return
        setAudioEnvelopeStatus('error')
        return
      }

      attempt++
      const delay = Math.min(10000, 500 + attempt * 500)
      timer = window.setTimeout(poll, delay)
    }

    poll()
    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
    }
  }, [uploadId])

  const syncFromVideo = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const d = Number.isFinite(v.duration) ? v.duration : 0
    if (d > 0) setDurationOriginal(d)
    if (!ranges || !ranges.length) return

    const orig = Number.isFinite(v.currentTime) ? v.currentTime : 0
    const mapped = originalToEditedTime(orig, ranges)
    setPlayheadEdited(roundToTenth(mapped.tEdited))
  }, [ranges])

  // If ranges become available after metadata is loaded, still seek to the first kept frame.
  useEffect(() => {
    attemptInitialSeekToFirstKeptFrame()
  }, [attemptInitialSeekToFirstKeptFrame])

  // Initialize default ranges once we know duration.
  useEffect(() => {
    if (durationOriginal <= 0) return
    if (ranges && ranges.length) return

    if (initialRanges && initialRanges.length) {
      const clamped = initialRanges
        .map((r) => ({ start: clamp(roundToTenth(r.start), 0, durationOriginal), end: clamp(roundToTenth(r.end), 0, durationOriginal) }))
        .filter((r) => r.end > r.start)
      setRanges(clamped.length ? clamped : [{ start: 0, end: durationOriginal }])
      setSelectedIndex(0)
      setPlayheadEdited(0)
      return
    }

    if (initialTrim.start != null || initialTrim.end != null) {
      const s = clamp(initialTrim.start ?? 0, 0, durationOriginal)
      const e = initialTrim.end != null ? clamp(initialTrim.end, 0, durationOriginal) : durationOriginal
      if (e > s) {
        setRanges([{ start: s, end: e }])
        setSelectedIndex(0)
        setPlayheadEdited(0)
        return
      }
    }

    setRanges([{ start: 0, end: durationOriginal }])
    setSelectedIndex(0)
    setPlayheadEdited(0)
  }, [durationOriginal, initialRanges, initialTrim.end, initialTrim.start, ranges])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onLoaded = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0
      if (d > 0) setDurationOriginal(d)
      attemptInitialSeekToFirstKeptFrame()
      syncFromVideo()
    }
    const onTime = () => {
      // Some browsers only populate `duration` after playback starts; capture it here so we can
      // initialize ranges and enable the scrubber even if loadedmetadata didn't fire.
      if (durationOriginal <= 0) {
        const d = Number.isFinite(v.duration) ? v.duration : 0
        if (d > 0) setDurationOriginal(d)
      }
      if (!ranges || !ranges.length) return
      const orig = Number.isFinite(v.currentTime) ? v.currentTime : 0
      // Enforce playback within kept ranges.
      const eps = 0.06
      // Needs to be > eps so we're unambiguously inside the next segment.
      const boundaryNudge = 0.07
      // Find the first range that could contain or follow orig.
      let idx = -1
      for (let i = 0; i < ranges.length; i++) {
        if (orig + eps < ranges[i].start) {
          idx = i
          break
        }
        if (orig >= ranges[i].start - eps && orig <= ranges[i].end + eps) {
          idx = i
          break
        }
      }
      if (idx === -1) idx = ranges.length - 1
      const r = ranges[idx]
      if (orig < r.start - eps) {
        try { v.currentTime = r.start } catch {}
      } else if (orig > r.end - eps) {
        const next = ranges[idx + 1]
        if (next) {
          const maxStart = Math.max(next.start, next.end - boundaryNudge)
          const target = clamp(next.start + boundaryNudge, next.start, maxStart)
          // Only auto-advance while playing; when paused/scrubbing we should allow the user to
          // sit exactly on boundaries and scrub backward across a cut.
          if (!v.paused) {
            try { v.currentTime = target } catch {}
          }
        } else {
          try { v.pause() } catch {}
          setPlaying(false)
        }
      }

      const mapped = originalToEditedTime(Number.isFinite(v.currentTime) ? v.currentTime : orig, ranges)
      setPlayheadEdited(roundToTenth(mapped.tEdited))
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onDur = onLoaded
    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('loadeddata', onLoaded)
    v.addEventListener('canplay', onLoaded)
    v.addEventListener('durationchange', onDur)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('loadeddata', onLoaded)
      v.removeEventListener('canplay', onLoaded)
      v.removeEventListener('durationchange', onDur)
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [durationOriginal, ranges, syncFromVideo])

  // Timeline thumbnails are intentionally not used for editing now; we keep the editor UI time-based.

  const seekEdited = useCallback((tEdited: number) => {
    if (!ranges || !ranges.length) return
    const v = videoRef.current
    if (!v) return
    const t = clamp(roundToTenth(tEdited), 0, Math.max(0, totalEditedDuration))
    const mapped = editedToOriginalTime(t, ranges)
    setSelectedIndex(mapped.segIndex)
    setPlayheadEdited(t)
    try { v.currentTime = mapped.tOriginal } catch {}
  }, [ranges, totalEditedDuration])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      if (ranges && ranges.length) {
        const mapped = editedToOriginalTime(playheadEdited, ranges)
        let target = mapped.tOriginal
        // If we're exactly on a segment boundary, nudge forward slightly so playback doesn't
        // get stuck on the previous segment's inclusive end in some browsers.
        // Needs to be > the playback enforcement eps (0.06) to avoid being classified in the prior segment.
        const boundaryNudge = 0.07
        try {
          const seg = ranges[mapped.segIndex]
          if (seg && mapped.segIndex > 0 && Math.abs(target - seg.start) < 1e-6) {
            const maxStart = Math.max(seg.start, seg.end - boundaryNudge)
            target = clamp(seg.start + boundaryNudge, seg.start, maxStart)
          }
        } catch {}
        try { v.currentTime = target } catch {}
      }
      try {
        v.muted = false
        v.volume = 1
      } catch {}
      setVideoMuted(false)
      v.play().catch(() => {})
    } else {
      try { v.pause() } catch {}
    }
  }, [playheadEdited, ranges])

  const pushHistory = useCallback(
    (nextRanges: Range[], nextSelected: number, nextPlayhead: number, nextOverlayItems: OverlayItem[] = overlayItems, nextSelectedOverlayId: string | null = selectedOverlayId) => {
      setHistory((h) => [{ ranges: ranges || nextRanges, selectedIndex, playheadEdited, overlayItems, selectedOverlayId }, ...h].slice(0, 50))
      setRanges(nextRanges)
      setSelectedIndex(nextSelected)
      setPlayheadEdited(nextPlayhead)
      setOverlayItems(nextOverlayItems)
      setSelectedOverlayId(nextSelectedOverlayId)
      setError(null)
    },
    [overlayItems, playheadEdited, ranges, selectedIndex, selectedOverlayId],
  )

  const undo = useCallback(() => {
    setError(null)
    setHistory((h) => {
      const head = h[0]
      if (!head) return h
      setRanges(head.ranges)
      setSelectedIndex(head.selectedIndex)
      setPlayheadEdited(head.playheadEdited)
      setOverlayItems(head.overlayItems || [])
      setSelectedOverlayId(head.selectedOverlayId ?? null)
      try {
        const v = videoRef.current
        if (v) {
          const mapped = editedToOriginalTime(head.playheadEdited, head.ranges)
          v.currentTime = mapped.tOriginal
        }
      } catch {}
      return h.slice(1)
    })
  }, [])

  const clear = useCallback(() => {
    if (durationOriginal <= 0) return
    pushHistory([{ start: 0, end: durationOriginal }], 0, 0, overlayItems, selectedOverlayId)
  }, [durationOriginal, overlayItems, pushHistory, selectedOverlayId])

  const split = useCallback(() => {
    if (!ranges || !ranges.length) return
    if (cutCount >= MAX_CUTS || ranges.length >= MAX_SEGMENTS) {
      setError(`Max ${MAX_CUTS} cuts reached.`)
      return
    }
    const mapped = editedToOriginalTime(playheadEdited, ranges)
    const idx = mapped.segIndex
    const r = ranges[idx]
    const cut = roundToTenth(mapped.tOriginal)
    if (cut <= r.start + MIN_SEGMENT_SECONDS || cut >= r.end - MIN_SEGMENT_SECONDS) {
      setError('Move playhead away from the segment edge to split.')
      return
    }
    const left: Range = { start: r.start, end: cut }
    const right: Range = { start: cut, end: r.end }
    if (left.end - left.start < MIN_SEGMENT_SECONDS || right.end - right.start < MIN_SEGMENT_SECONDS) {
      setError('Split would create a tiny segment.')
      return
    }
    const next = [...ranges.slice(0, idx), left, right, ...ranges.slice(idx + 1)]
    const nextSel = idx + 1
    pushHistory(next, nextSel, playheadEdited)
  }, [cutCount, playheadEdited, pushHistory, ranges])

  const addOverlayImage = useCallback((overlayUploadId: number) => {
    if (!Number.isFinite(overlayUploadId) || overlayUploadId <= 0) return
    if (!ranges || !ranges.length) return
    const total = totalEditedDuration > 0 ? totalEditedDuration : 0
    const starts = segmentEditedStarts(ranges)
    const segStartE = starts[selectedIndex] || 0
    const segLen = Math.max(0, (ranges[selectedIndex]?.end || 0) - (ranges[selectedIndex]?.start || 0))
    const segEndE = segStartE + segLen

    const defaultWindow = 2
    const startSeconds = roundToTenth(clamp(playheadEdited, 0, Math.max(0, total)))
    const preferSpanSegment = segLen > 0 && segLen <= 10
    const endTarget = preferSpanSegment ? segEndE : startSeconds + defaultWindow
    const endSeconds = roundToTenth(clamp(Math.min(endTarget, segEndE || endTarget), 0, Math.max(0, total)))
    if (!(endSeconds > startSeconds)) {
      setError('Cannot add overlay at this time position.')
      return
    }

    const overlaps = overlayItems.some((it) => it.track === 'A' && it.endSeconds > startSeconds && it.startSeconds < endSeconds)
    if (overlaps) {
      setError('Overlay overlaps an existing overlay. Delete or shorten the existing one first.')
      return
    }

    const id = `ov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const next = [...overlayItems, { id, kind: 'image', track: 'A', uploadId: overlayUploadId, startSeconds, endSeconds }]
    next.sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds || a.uploadId - b.uploadId)
    pushHistory(ranges, selectedIndex, playheadEdited, next, id)
    setError(null)
  }, [overlayItems, playheadEdited, pushHistory, ranges, selectedIndex, totalEditedDuration])

  const deleteSelectedOverlay = useCallback(() => {
    if (!selectedOverlayId) return
    if (!ranges || !ranges.length) return
    const idx = overlayItems.findIndex((it) => it.id === selectedOverlayId)
    if (idx < 0) return
    const next = overlayItems.filter((it) => it.id !== selectedOverlayId)
    pushHistory(ranges, selectedIndex, playheadEdited, next, null)
  }, [overlayItems, playheadEdited, pushHistory, ranges, selectedIndex, selectedOverlayId])

  const del = useCallback(() => {
    if (!ranges || ranges.length <= 1) return
    const idx = clamp(selectedIndex, 0, ranges.length - 1)
    const starts = segmentEditedStarts(ranges)
    const segStartEdited = starts[idx]
    const segLen = Math.max(0, ranges[idx].end - ranges[idx].start)
    const segEndEdited = segStartEdited + segLen

    const next = ranges.filter((_, i) => i !== idx)
    if (!next.length) return

    let nextPlayhead = playheadEdited
    if (playheadEdited >= segEndEdited) {
      nextPlayhead = Math.max(0, playheadEdited - segLen)
    } else if (playheadEdited >= segStartEdited && playheadEdited < segEndEdited) {
      // If playhead is inside the removed segment, keep same edited time (now maps to next segment start).
      nextPlayhead = segStartEdited
    }
    const nextTotal = sumRanges(next)
    nextPlayhead = clamp(nextPlayhead, 0, Math.max(0, nextTotal))
    const nextSel = clamp(idx, 0, next.length - 1)
    const nextOverlayItems = rippleRemoveWindowFromOverlayItems(overlayItems, segStartEdited, segEndEdited)
    const selectedStillExists = selectedOverlayId != null && nextOverlayItems.some((it) => it.id === selectedOverlayId)
    pushHistory(next, nextSel, nextPlayhead, nextOverlayItems, selectedStillExists ? selectedOverlayId : null)
  }, [overlayItems, playheadEdited, pushHistory, ranges, selectedIndex, selectedOverlayId])

  const save = useCallback(() => {
    setError(null)
    if (!ranges || !ranges.length) return
    const normalized = ranges
      .map((r) => ({ start: roundToTenth(r.start), end: roundToTenth(r.end) }))
      .filter((r) => r.end > r.start)
      .slice(0, MAX_SEGMENTS)
    const overlaysNormalized = (overlayItems || [])
      .map((it) => ({
        ...it,
        startSeconds: roundToTenth(it.startSeconds),
        endSeconds: roundToTenth(it.endSeconds),
      }))
      .filter((it) => Number.isFinite(it.uploadId) && it.uploadId > 0 && Number.isFinite(it.startSeconds) && Number.isFinite(it.endSeconds) && it.endSeconds > it.startSeconds)
      .slice(0, 20)
    const withRanges = applyRangesToUrl(backHref, normalized)
    const target = applyOverlayItemsToUrl(withRanges, overlaysNormalized.length ? overlaysNormalized : null)
    window.location.href = target
  }, [backHref, overlayItems, ranges])

  const segs = ranges || []
  const pxPerSecond = 96
  const rulerH = 20
  const buildH = 22
  const overlayH = 22
  const trackH = 46
  const rulerBg = useMemo(() => {
    const tickMinorPx = pxPerSecond / 10
    const tickMajorPx = pxPerSecond
    return [
      `repeating-linear-gradient(to right, rgba(255,255,255,0.16) 0, rgba(255,255,255,0.16) 1px, transparent 1px, transparent ${tickMinorPx}px)`,
      `repeating-linear-gradient(to right, rgba(255,255,255,0.30) 0, rgba(255,255,255,0.30) 1px, transparent 1px, transparent ${tickMajorPx}px)`,
    ].join(',')
  }, [pxPerSecond])

  useEffect(() => {
    const sc = timelineScrollRef.current
    if (!sc || !segs.length) return
    const update = () => {
      const w = Math.max(0, sc.clientWidth || 0)
      const pad = Math.ceil(w / 2)
      setTimelinePadPx(pad)
    }
    update()
    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(() => update())
      ro.observe(sc)
    } catch {}
    const onResize = () => update()
    window.addEventListener('resize', onResize)
    return () => {
      try { ro?.disconnect() } catch {}
      window.removeEventListener('resize', onResize)
    }
  }, [segs.length])

  useEffect(() => {
    const sc = timelineScrollRef.current
    if (!sc || !segs.length) return
    const atEndEps = 0.11
    const atEnd = totalEditedDuration > 0 && playheadEdited >= totalEditedDuration - atEndEps
    const maxLeft = Math.max(0, sc.scrollWidth - sc.clientWidth)
    const desiredLeft = atEnd ? maxLeft : Math.max(0, playheadEdited * pxPerSecond)
    const clamped = Math.max(0, Math.min(maxLeft, desiredLeft))
    try {
      sc.scrollTo({ left: clamped, behavior: 'auto' })
    } catch {
      sc.scrollLeft = clamped
    }
  }, [playheadEdited, pxPerSecond, segs.length, timelinePadPx, totalEditedDuration])

  useEffect(() => {
    const c = audioCanvasRef.current
    const sc = timelineScrollRef.current
    if (!c || !sc) return
    const total = totalEditedDuration > 0 ? totalEditedDuration : 0
    if (!segs.length || total <= 0 || audioEnvelopeStatus !== 'ready' || !envelopeVals) {
      const ctx = c.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, c.width, c.height)
      return
    }
    const raf = window.requestAnimationFrame(() => {
      drawAudioEnvelopeViewport({
        canvas: c,
        viewportWidthPx: sc.clientWidth || 0,
        heightPx: trackH,
        pxPerSecond,
        padPx: timelinePadPx,
        scrollLeftPx: sc.scrollLeft || 0,
        totalEditedSeconds: total,
        segs,
        envelopeVals,
      })
    })
    return () => window.cancelAnimationFrame(raf)
  }, [audioEnvelopeStatus, envelopeVals, pxPerSecond, segs, timelinePadPx, totalEditedDuration, trackH, playheadEdited])

  if (!uploadId) {
    return <div style={{ padding: 20, color: '#fff' }}>Missing upload id.</div>
  }
  const total = totalEditedDuration > 0 ? totalEditedDuration : 0
  const playheadPct = total > 0 ? clamp(playheadEdited / total, 0, 1) : 0
  const canSplit = segs.length > 0 && cutCount < MAX_CUTS && segs.length < MAX_SEGMENTS
  const canDelete = segs.length > 1
  const canUndo = history.length > 0
  const canDeleteOverlay = selectedOverlayId != null && overlayItems.some((it) => it.id === selectedOverlayId)

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back to Produce</a>
          <button
            type="button"
            onClick={save}
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#0a84ff',
              color: '#fff',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>

        <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Edit Video</h1>

        {proxyError ? (
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div style={{ color: '#ff9b9b' }}>{proxyError}</div>
            <button
              type="button"
              onClick={() => {
                setProxyError(null)
                setRetryNonce((n) => n + 1)
                try { videoRef.current?.load?.() } catch {}
              }}
              style={{
                padding: '8px 10px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0c0c0c',
                color: '#fff',
                fontWeight: 800,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Retry
            </button>
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 12 }}>
	          <video
	            ref={videoRef}
	            src={src || undefined}
	            muted={videoMuted}
	            playsInline
	            preload="auto"
	            style={{ width: '100%', borderRadius: 12, background: '#000' }}
	            onError={() => setProxyError('Generating edit proxy… try again in a moment.')}
	            onLoadedMetadata={() => syncFromVideo()}
	          />

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>
              Segments: {segs.length} • Cuts: {cutCount}/{MAX_CUTS} • Total: {total > 0 ? `${total.toFixed(1)}s` : '—'}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Overlay A: {overlayItems.length}</div>
              <button
                type="button"
                onClick={() => pushQueryParams({ pick: 'overlayImage' })}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Add Image
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10, padding: '12px 12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
            {!proxyError && durationOriginal <= 0 ? (
              <div style={{ color: '#bbb', fontSize: 13 }}>
                Loading video… if this stays blank, tap Play once or hit Retry above.
              </div>
            ) : null}

            {total > 0 ? (
              <>
                <div style={{ textAlign: 'center', color: '#bbb', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                  {playheadEdited.toFixed(1)}
                </div>
                <div
                  style={{
                    position: 'relative',
                    height: rulerH * 2 + buildH + overlayH + trackH,
                    borderRadius: 0,
                    overflow: 'hidden',
                    background: 'rgba(0,0,0,0.35)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: rulerH + buildH + overlayH,
                      height: trackH,
                      pointerEvents: 'none',
                      zIndex: 1,
                      overflow: 'hidden',
                    }}
                  >
                    <canvas
                      ref={audioCanvasRef}
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'block',
                        opacity: audioEnvelopeStatus === 'ready' ? 1 : 0.35,
                      }}
                    />
                  </div>
                  <div
                    ref={timelineScrollRef}
                    style={{
                      position: 'relative',
                      zIndex: 2,
                      height: '100%',
                      overflowX: 'hidden',
                      overflowY: 'hidden',
                      touchAction: 'none',
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                    {(() => {
                      const stripContentW = Math.max(0, total * pxPerSecond)
                      const stripTotalW = Math.max(0, stripContentW + timelinePadPx * 2)
                      const segmentStartsEdited = segmentEditedStarts(segs)
                      const cutBoundariesEdited = segmentStartsEdited.slice(1)

                      const selectAtClientX = (clientX: number) => {
                        const sc = timelineScrollRef.current
                        if (!sc || !segs.length) return
                        const rect = sc.getBoundingClientRect()
                        const x = clientX - rect.left + sc.scrollLeft - timelinePadPx
                        const tEdited = clamp(x / pxPerSecond, 0, Math.max(0, total))
                        setSelectedIndex(editedTimeToSegmentIndex(tEdited, segs))
                      }

                      const renderRowHighlight = (opacity: number, withOutline: boolean) => (
                        <>
                          {segs.map((r, i) => {
                            const len = Math.max(0, r.end - r.start)
                            const wPx = len * pxPerSecond
                            const leftPx = (segmentStartsEdited[i] || 0) * pxPerSecond
                            const selected = i === selectedIndex
                            if (!selected || wPx <= 0.5) return null
                            return (
                              <div
                                key={`sel-${opacity}-${i}-${r.start}-${r.end}`}
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  bottom: 0,
                                  left: leftPx,
                                  width: wPx,
                                  background: `rgba(10,132,255,${opacity})`,
                                  boxShadow: withOutline ? 'inset 0 0 0 2px rgba(10,132,255,0.65)' : 'none',
                                  pointerEvents: 'none',
                                }}
                              />
                            )
                          })}
                        </>
                      )

                      const renderBoundaries = (color: string, alpha: number) => (
                        <>
                          {cutBoundariesEdited.map((t, i) => (
                            <div
                              key={`b-${color}-${i}-${t}`}
                              style={{
                                position: 'absolute',
                                top: 0,
                                bottom: 0,
                                left: t * pxPerSecond,
                                width: 2,
                                transform: 'translateX(-1px)',
                                background: `rgba(${color},${alpha})`,
                                pointerEvents: 'none',
                              }}
                            />
                          ))}
                        </>
                      )

                      return (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateRows: `${rulerH}px ${buildH}px ${overlayH}px ${trackH}px ${rulerH}px`,
                            height: '100%',
                            width: stripTotalW,
                            minWidth: stripTotalW,
                          }}
                        >
                          <div style={{ display: 'flex', height: rulerH }}>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                            <div
                              onClick={(e) => {
                                selectAtClientX(e.clientX)
                                setSelectedOverlayId(null)
                              }}
                              style={{
                                position: 'relative',
                                width: stripContentW,
                                height: rulerH,
                                flex: '0 0 auto',
                                cursor: 'pointer',
                                background: 'rgba(255,255,255,0.02)',
                                backgroundImage: rulerBg,
                              }}
                            >
                              {renderRowHighlight(0.2, true)}
                              {renderBoundaries('255,255,255', 0.65)}
                            </div>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                          </div>

                          <div style={{ display: 'flex', height: buildH }}>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                            <div
                              onClick={(e) => {
                                selectAtClientX(e.clientX)
                                setSelectedOverlayId(null)
                              }}
                              style={{
                                position: 'relative',
                                width: stripContentW,
                                height: buildH,
                                flex: '0 0 auto',
                                cursor: 'pointer',
                                background: 'rgba(255,255,255,0.01)',
                              }}
                            >
                              {(() => {
                                try {
                                  if (!from || total <= 0) return null
                                  const u = new URL(from, window.location.origin)
                                  const items: Array<{ label: string; start: number; end: number; color: string }> = []
                                  const logoUploadId = Number(u.searchParams.get('logoUploadId') || 0)
                                  const lowerThirdUploadId = Number(u.searchParams.get('lowerThirdUploadId') || 0)
                                  const screenTitlePresetId = Number(u.searchParams.get('screenTitlePresetId') || 0)
                                  const introSeconds = Number(u.searchParams.get('introSeconds') || 0)
                                  const titleUploadId = Number(u.searchParams.get('titleUploadId') || 0)
                                  const titleHoldSeconds = Number(u.searchParams.get('titleHoldSeconds') || 0)

                                  if (Number.isFinite(titleUploadId) && titleUploadId > 0) {
                                    const hold = Number.isFinite(titleHoldSeconds) ? Math.max(0, Math.min(5, Math.round(titleHoldSeconds))) : 0
                                    if (hold > 0) items.push({ label: 'First Screen', start: 0, end: Math.min(total, hold), color: 'rgba(10,132,255,0.35)' })
                                  } else {
                                    const hold = Number.isFinite(introSeconds) ? Math.max(0, Math.min(5, Math.round(introSeconds))) : 0
                                    if (hold > 0) items.push({ label: 'First Screen', start: 0, end: Math.min(total, hold), color: 'rgba(10,132,255,0.35)' })
                                  }
                                  if (Number.isFinite(screenTitlePresetId) && screenTitlePresetId > 0) {
                                    items.push({ label: 'Screen Title', start: 0, end: Math.min(total, 10), color: 'rgba(255,159,10,0.35)' })
                                  }
                                  if (Number.isFinite(lowerThirdUploadId) && lowerThirdUploadId > 0) {
                                    items.push({ label: 'Lower Third', start: 0, end: Math.min(total, 10), color: 'rgba(175,82,222,0.35)' })
                                  }
                                  if (Number.isFinite(logoUploadId) && logoUploadId > 0) {
                                    items.push({ label: 'Logo', start: 0, end: Math.min(total, total), color: 'rgba(212,175,55,0.25)' })
                                  }
                                  if (!items.length) return null

                                  const h = Math.max(1, Math.floor((buildH - 4) / items.length))
                                  return (
                                    <>
                                      {items.map((it, i) => {
                                        const left = it.start * pxPerSecond
                                        const width = Math.max(2, (it.end - it.start) * pxPerSecond)
                                        return (
                                          <div
                                            key={`build-${it.label}-${i}`}
                                            title={it.label}
                                            style={{
                                              position: 'absolute',
                                              left,
                                              top: 2 + i * h,
                                              width,
                                              height: Math.max(4, h - 2),
                                              background: it.color,
                                              border: '1px solid rgba(255,255,255,0.12)',
                                              borderRadius: 4,
                                              overflow: 'hidden',
                                            }}
                                          />
                                        )
                                      })}
                                      {renderBoundaries('255,255,255', 0.18)}
                                    </>
                                  )
                                } catch {
                                  return null
                                }
                              })()}
                            </div>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                          </div>

                          <div style={{ display: 'flex', height: overlayH }}>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                            <div
                              onClick={(e) => {
                                const sc = timelineScrollRef.current
                                if (!sc) return
                                const rect = sc.getBoundingClientRect()
                                const x = e.clientX - rect.left + sc.scrollLeft - timelinePadPx
                                const tEdited = clamp(x / pxPerSecond, 0, Math.max(0, total))
                                const found = overlayItems.find((it) => it.track === 'A' && tEdited >= it.startSeconds && tEdited < it.endSeconds)
                                setSelectedOverlayId(found ? found.id : null)
                              }}
                              style={{
                                position: 'relative',
                                width: stripContentW,
                                height: overlayH,
                                flex: '0 0 auto',
                                cursor: 'pointer',
                                background: 'rgba(255,255,255,0.01)',
                              }}
                            >
                              {overlayItems.map((it) => {
                                if (it.track !== 'A') return null
                                const left = it.startSeconds * pxPerSecond
                                const width = Math.max(2, (it.endSeconds - it.startSeconds) * pxPerSecond)
                                const selected = it.id === selectedOverlayId
                                return (
                                  <div
                                    key={it.id}
                                    title={`Overlay image #${it.uploadId}`}
                                    style={{
                                      position: 'absolute',
                                      left,
                                      top: 2,
                                      height: overlayH - 4,
                                      width,
                                      background: selected ? 'rgba(212,175,55,0.70)' : 'rgba(212,175,55,0.35)',
                                      border: selected ? '1px solid rgba(255,255,255,0.85)' : '1px solid rgba(255,255,255,0.18)',
                                      borderRadius: 6,
                                      overflow: 'hidden',
                                    }}
                                  />
                                )
                              })}
                              {renderBoundaries('255,255,255', 0.18)}
                            </div>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                          </div>

                          <div style={{ display: 'flex', height: trackH }}>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                            <div
                              onClick={(e) => {
                                selectAtClientX(e.clientX)
                                setSelectedOverlayId(null)
                              }}
                              style={{
                                position: 'relative',
                                width: stripContentW,
                                height: trackH,
                                flex: '0 0 auto',
                                cursor: 'pointer',
                                background: 'rgba(0,0,0,0.12)',
                              }}
                            >
                              {renderRowHighlight(0.1, false)}
                              {renderBoundaries('255,255,255', 0.28)}
                            </div>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                          </div>

                          <div style={{ display: 'flex', height: rulerH }}>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                            <div
                              onClick={(e) => {
                                selectAtClientX(e.clientX)
                                setSelectedOverlayId(null)
                              }}
                              style={{
                                position: 'relative',
                                width: stripContentW,
                                height: rulerH,
                                flex: '0 0 auto',
                                cursor: 'pointer',
                                background: 'rgba(255,255,255,0.015)',
                                backgroundImage: rulerBg,
                              }}
                            >
                              {renderRowHighlight(0.14, false)}
                              {renderBoundaries('255,255,255', 0.45)}
                            </div>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                          </div>
                        </div>
                      )
                    })()}
                    </div>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      top: -2,
                      bottom: -2,
                      width: 2,
                      left: '50%',
                      transform: 'translateX(-1px)',
                      background: '#ff3b30',
                      pointerEvents: 'none',
                      zIndex: 3,
                    }}
                  />
                </div>
              </>
            ) : (
              <div style={{ position: 'relative', height: 16, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
                <div style={{ display: 'flex', height: '100%' }}>
                  {segs.map((r, i) => {
                    const len = Math.max(0, r.end - r.start)
                    const wPct = total > 0 ? (len / total) * 100 : 0
                    const selected = i === selectedIndex
                    return (
                      <div
                        key={`${r.start}-${r.end}-${i}`}
                        onClick={() => setSelectedIndex(i)}
                        title={`${r.start.toFixed(1)}–${r.end.toFixed(1)}s`}
                        style={{
                          width: `${wPct}%`,
                          background: selected ? 'rgba(10,132,255,0.95)' : 'rgba(212,175,55,0.6)',
                          borderRight: i < segs.length - 1 ? '1px solid rgba(0,0,0,0.35)' : 'none',
                          cursor: 'pointer',
                        }}
                      />
                    )
                  })}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    top: -2,
                    bottom: -2,
                    width: 2,
                    left: `${playheadPct * 100}%`,
                    transform: 'translateX(-1px)',
                    background: '#ff3b30',
                  }}
                />
              </div>
            )}

            <input
              type="range"
              min={0}
              max={total > 0 ? total : 0}
              step={0.1}
              value={clamp(playheadEdited, 0, total > 0 ? total : 0)}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (!Number.isFinite(v)) return
                // Pause during scrubs for predictable behavior.
                try { videoRef.current?.pause?.() } catch {}
                setPlaying(false)
                seekEdited(v)
              }}
              style={{ width: '100%' }}
              disabled={total <= 0}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  try { videoRef.current?.pause?.() } catch {}
                  setPlaying(false)
                  seekEdited(playheadEdited - 0.1)
                }}
                disabled={total <= 0}
                aria-label="Nudge back 0.1 seconds"
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: total <= 0 ? 'default' : 'pointer',
                  minWidth: 64,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                0.1s
              </div>
              <button
                type="button"
                onClick={() => {
                  try { videoRef.current?.pause?.() } catch {}
                  setPlaying(false)
                  seekEdited(playheadEdited + 0.1)
                }}
                disabled={total <= 0}
                aria-label="Nudge forward 0.1 seconds"
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: total <= 0 ? 'default' : 'pointer',
                  minWidth: 64,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

	            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 20 }}>
              <button
                type="button"
                onClick={togglePlay}
                disabled={Boolean(proxyError)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: proxyError ? 'default' : 'pointer',
                }}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={split}
                disabled={!canSplit}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: canSplit ? '#0c0c0c' : 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: canSplit ? 'pointer' : 'default',
                }}
              >
                Split
              </button>
              <button
                type="button"
                onClick={deleteSelectedOverlay}
                disabled={!canDeleteOverlay}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: canDeleteOverlay ? '#300' : 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: canDeleteOverlay ? 'pointer' : 'default',
                }}
              >
                Delete Overlay
              </button>
              <button
                type="button"
                onClick={del}
                disabled={!canDelete}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: canDelete ? '#300' : 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: canDelete ? 'pointer' : 'default',
                }}
              >
                Delete
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
                  fontWeight: 800,
                  cursor: canUndo ? 'pointer' : 'default',
                }}
              >
                Undo
              </button>
              <button
                type="button"
                onClick={clear}
                disabled={durationOriginal <= 0}
                style={{
                  marginLeft: 'auto',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: durationOriginal <= 0 ? 'default' : 'pointer',
                }}
              >
                Clear
              </button>
            </div>

	            {error ? <div style={{ color: '#ff9b9b' }}>{error}</div> : null}
	          </div>
	        </div>
	      </div>
	      {pick === 'overlayImage' ? (
	        <div
	          role="dialog"
	          aria-modal="true"
	          style={{
	            position: 'fixed',
	            inset: 0,
	            background: 'rgba(0,0,0,0.92)',
	            zIndex: 1000,
	            overflowY: 'auto',
	            WebkitOverflowScrolling: 'touch',
	          }}
	        >
	          <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
	            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
	              <button
	                type="button"
	                onClick={() => pushQueryParams({ pick: null })}
	                style={{ color: '#0a84ff', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14 }}
	              >
	                ← Back to editor
	              </button>
	              <div style={{ color: '#bbb', fontSize: 13 }}>Overlay images: {overlayPickerItems.length}</div>
	            </div>

	            <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Select Overlay Image</h1>
	            <div style={{ color: '#bbb', fontSize: 13, marginBottom: 12 }}>
	              Tip: overlay clips are applied when you Produce.
	            </div>

	            {overlayPickerLoading ? <div style={{ color: '#bbb' }}>Loading…</div> : null}
	            {overlayPickerError ? <div style={{ color: '#ff9b9b' }}>{overlayPickerError}</div> : null}

	            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
	              {overlayPickerItems.map((it: any) => {
	                const id = Number(it?.id)
	                if (!Number.isFinite(id) || id <= 0) return null
	                const name = String(it?.modified_filename || it?.original_filename || `Image ${id}`)
	                const thumbSrc = `/api/uploads/${encodeURIComponent(String(id))}/file`
	                return (
	                  <div
	                    key={`ovimg-${id}`}
	                    style={{
	                      display: 'grid',
	                      gridTemplateColumns: '96px 1fr auto',
	                      gap: 12,
	                      alignItems: 'center',
	                      padding: 12,
	                      borderRadius: 12,
	                      border: '1px solid rgba(212,175,55,0.55)',
	                      background: 'rgba(0,0,0,0.35)',
	                    }}
	                  >
	                    <img src={thumbSrc} alt="" style={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 8, background: '#000' }} />
	                    <div style={{ minWidth: 0 }}>
	                      <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
	                      <div style={{ color: '#bbb', fontSize: 12, marginTop: 2 }}>
	                        {it?.description ? String(it.description).slice(0, 80) : 'No description'}
	                      </div>
	                    </div>
	                    <button
	                      type="button"
	                      onClick={() => {
	                        addOverlayImage(id)
	                        pushQueryParams({ pick: null })
	                      }}
	                      style={{
	                        padding: '10px 12px',
	                        borderRadius: 10,
	                        border: '1px solid rgba(255,255,255,0.18)',
	                        background: '#0a84ff',
	                        color: '#fff',
	                        fontWeight: 800,
	                        cursor: 'pointer',
	                      }}
	                    >
	                      Select
	                    </button>
	                  </div>
	                )
	              })}
	            </div>
	          </div>
	        </div>
	      ) : null}
	    </div>
	  )
	}
