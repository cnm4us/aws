import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Range = { start: number; end: number }

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
  const initialRanges = useMemo(() => parseEditRangesFromFromUrl(from), [from])
  const initialTrim = useMemo(() => parseTrimFromFromUrl(from), [from])

  const [retryNonce, setRetryNonce] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [proxyError, setProxyError] = useState<string | null>(null)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const [timelinePadPx, setTimelinePadPx] = useState(0)

  const [durationOriginal, setDurationOriginal] = useState(0)
  const [ranges, setRanges] = useState<Range[] | null>(initialRanges)
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [playheadEdited, setPlayheadEdited] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<{ ranges: Range[]; selectedIndex: number; playheadEdited: number }>>([])

  const src = uploadId ? `/api/uploads/${encodeURIComponent(String(uploadId))}/edit-proxy?b=${retryNonce}` : null
  const backHref = from || (uploadId ? `/produce?upload=${encodeURIComponent(String(uploadId))}` : '/produce')

  const totalEditedDuration = useMemo(() => (ranges ? sumRanges(ranges) : 0), [ranges])
  const cutCount = useMemo(() => (ranges ? Math.max(0, ranges.length - 1) : 0), [ranges])

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
          try { v.currentTime = target } catch {}
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
      v.play().catch(() => {})
    } else {
      try { v.pause() } catch {}
    }
  }, [playheadEdited, ranges])

  const pushHistory = useCallback((nextRanges: Range[], nextSelected: number, nextPlayhead: number) => {
    setHistory((h) => [{ ranges: ranges || nextRanges, selectedIndex, playheadEdited }, ...h].slice(0, 50))
    setRanges(nextRanges)
    setSelectedIndex(nextSelected)
    setPlayheadEdited(nextPlayhead)
    setError(null)
  }, [playheadEdited, ranges, selectedIndex])

  const undo = useCallback(() => {
    setError(null)
    setHistory((h) => {
      const head = h[0]
      if (!head) return h
      setRanges(head.ranges)
      setSelectedIndex(head.selectedIndex)
      setPlayheadEdited(head.playheadEdited)
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
    pushHistory([{ start: 0, end: durationOriginal }], 0, 0)
  }, [durationOriginal, pushHistory])

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
    pushHistory(next, nextSel, nextPlayhead)
  }, [playheadEdited, pushHistory, ranges, selectedIndex])

  const save = useCallback(() => {
    setError(null)
    if (!ranges || !ranges.length) return
    const normalized = ranges
      .map((r) => ({ start: roundToTenth(r.start), end: roundToTenth(r.end) }))
      .filter((r) => r.end > r.start)
      .slice(0, MAX_SEGMENTS)
    const target = applyRangesToUrl(backHref, normalized)
    window.location.href = target
  }, [backHref, ranges])

  const segs = ranges || []
  const pxPerSecond = 96
  const rulerH = 20
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

  if (!uploadId) {
    return <div style={{ padding: 20, color: '#fff' }}>Missing upload id.</div>
  }
  const total = totalEditedDuration > 0 ? totalEditedDuration : 0
  const playheadPct = total > 0 ? clamp(playheadEdited / total, 0, 1) : 0
  const canSplit = segs.length > 0 && cutCount < MAX_CUTS && segs.length < MAX_SEGMENTS
  const canDelete = segs.length > 1
  const canUndo = history.length > 0

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
            playsInline
            preload="metadata"
            style={{ width: '100%', borderRadius: 12, background: '#000' }}
            onError={() => setProxyError('Generating edit proxy… try again in a moment.')}
            onLoadedMetadata={() => syncFromVideo()}
          />

          <div style={{ color: '#bbb', fontSize: 13 }}>
            Segments: {segs.length} • Cuts: {cutCount}/{MAX_CUTS} • Total: {total > 0 ? `${total.toFixed(1)}s` : '—'}
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
                    height: rulerH * 2 + trackH,
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: 'rgba(0,0,0,0.35)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                >
                  <div
                    ref={timelineScrollRef}
                    style={{
                      height: '100%',
                      overflowX: 'hidden',
                      overflowY: 'hidden',
                      touchAction: 'none',
                    }}
                  >
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
                            gridTemplateRows: `${rulerH}px ${trackH}px ${rulerH}px`,
                            height: '100%',
                            width: stripTotalW,
                            minWidth: stripTotalW,
                          }}
                        >
                          <div style={{ display: 'flex', height: rulerH }}>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                            <div
                              onClick={(e) => selectAtClientX(e.clientX)}
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

                          <div style={{ display: 'flex', height: trackH }}>
                            <div style={{ width: timelinePadPx, flex: '0 0 auto' }} />
                            <div
                              onClick={(e) => selectAtClientX(e.clientX)}
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
                              onClick={(e) => selectAtClientX(e.clientX)}
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

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
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
    </div>
  )
}
