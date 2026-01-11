import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Range = { start: number; end: number }
type TimelineManifestV1 = {
  uploadId: number
  intervalSeconds: number
  tile: { w: number; h: number }
  sprite: { cols: number; rows: number; perSprite: number }
  durationSeconds: number
  sprites: Array<{ startSecond: number; key: string }>
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
  let acc = 0
  for (let i = 0; i < ranges.length; i++) {
    const len = Math.max(0, ranges[i].end - ranges[i].start)
    const next = acc + len
    if (tEdited <= next || i === ranges.length - 1) {
      const within = clamp(tEdited - acc, 0, len)
      return { tOriginal: ranges[i].start + within, segIndex: i }
    }
    acc = next
  }
  return { tOriginal: ranges[0]?.start || 0, segIndex: 0 }
}

function originalToEditedTime(tOriginal: number, ranges: Range[]): { tEdited: number; segIndex: number } {
  let acc = 0
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    const len = Math.max(0, r.end - r.start)
    if (tOriginal >= r.start && tOriginal <= r.end) {
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

function buildEditedThumbSeconds(ranges: Range[], intervalSeconds: number, durationSeconds: number): number[] {
  const interval = Math.max(1, Math.round(Number(intervalSeconds) || 1))
  const maxSec = Math.max(0, Math.floor(Math.max(0, Number(durationSeconds) || 0) - 1e-6))
  const out: number[] = []
  const eps = 1e-6

  for (const r of ranges) {
    const start = Math.max(0, r.start)
    const end = Math.max(0, r.end)
    if (end <= start + eps) continue

    const first = Math.max(0, Math.ceil(start / interval) * interval)
    const last = Math.max(0, Math.floor((end - eps) / interval) * interval)
    if (last >= first) {
      for (let t = first; t <= last; t += interval) {
        const sec = Math.max(0, Math.min(maxSec, Math.round(t)))
        out.push(sec)
      }
    } else {
      // Very short segment: include a single representative thumb.
      const sec = Math.max(0, Math.min(maxSec, Math.floor((start + end) / 2)))
      out.push(sec)
    }
  }

  return out
}

export default function EditVideo() {
  const uploadId = useMemo(() => parseUploadId(), [])
  const from = useMemo(() => parseFrom(), [])
  const initialRanges = useMemo(() => parseEditRangesFromFromUrl(from), [from])
  const initialTrim = useMemo(() => parseTrimFromFromUrl(from), [from])

  const [retryNonce, setRetryNonce] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [proxyError, setProxyError] = useState<string | null>(null)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [timelineManifest, setTimelineManifest] = useState<TimelineManifestV1 | null>(null)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)

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
      if (!ranges || !ranges.length) return
      const orig = Number.isFinite(v.currentTime) ? v.currentTime : 0
      // Enforce playback within kept ranges.
      const eps = 0.06
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
          try { v.currentTime = next.start } catch {}
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
  }, [ranges, syncFromVideo])

  useEffect(() => {
    if (!uploadId) return
    let alive = true
    setTimelineError(null)
    setTimelineManifest(null)
    fetch(`/api/uploads/${encodeURIComponent(String(uploadId))}/timeline/manifest?b=${retryNonce}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(async (r) => {
        if (!alive) return
        if (r.status === 404) {
          setTimelineError('Generating thumbnails…')
          setTimelineManifest(null)
          return
        }
        if (!r.ok) {
          setTimelineError('Thumbnails unavailable.')
          setTimelineManifest(null)
          return
        }
        const json = (await r.json()) as TimelineManifestV1
        if (!alive) return
        setTimelineManifest(json)
        setTimelineError(null)
      })
      .catch(() => {
        if (!alive) return
        setTimelineError('Thumbnails unavailable.')
        setTimelineManifest(null)
      })
    return () => {
      alive = false
    }
  }, [retryNonce, uploadId])

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
        try { v.currentTime = mapped.tOriginal } catch {}
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

  const thumbs = useMemo(() => {
    if (!ranges || !ranges.length) return null
    if (!timelineManifest) return null
    return buildEditedThumbSeconds(ranges, timelineManifest.intervalSeconds, timelineManifest.durationSeconds)
  }, [ranges, timelineManifest])

  useEffect(() => {
    if (!timelineManifest || !thumbs || !thumbs.length) return
    const sc = timelineScrollRef.current
    if (!sc) return
    const tileW = Math.max(1, Math.round(Number(timelineManifest.tile?.w) || 96))
    const idx = clamp(Math.floor(playheadEdited), 0, thumbs.length - 1)
    const targetCenter = idx * tileW + tileW / 2
    const desiredLeft = Math.max(0, targetCenter - sc.clientWidth / 2)
    const maxLeft = Math.max(0, sc.scrollWidth - sc.clientWidth)
    const clamped = Math.max(0, Math.min(maxLeft, desiredLeft))
    try {
      sc.scrollTo({ left: clamped, behavior: 'auto' })
    } catch {
      sc.scrollLeft = clamped
    }
  }, [playheadEdited, thumbs, timelineManifest])

  if (!uploadId) {
    return <div style={{ padding: 20, color: '#fff' }}>Missing upload id.</div>
  }

  const segs = ranges || []
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

          <div style={{ display: 'grid', gap: 10, padding: '12px 12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <div style={{ color: '#bbb' }}>Playhead: {playheadEdited.toFixed(1)}s</div>
              <div style={{ color: '#bbb' }}>
                Segments: {segs.length} • Cuts: {cutCount}/{MAX_CUTS} • Total: {total > 0 ? `${total.toFixed(1)}s` : '—'}
              </div>
            </div>

            {!proxyError && durationOriginal <= 0 ? (
              <div style={{ color: '#bbb', fontSize: 13 }}>
                Loading video… if this stays blank, tap Play once or hit Retry above.
              </div>
            ) : null}

            {timelineManifest && thumbs && thumbs.length ? (
              <div
                style={{
                  position: 'relative',
                  height: Math.max(24, Number(timelineManifest.tile?.h) || 54),
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
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  <div style={{ display: 'flex', height: '100%' }}>
                    {thumbs.map((tOrig, i) => {
                      const tileW = Math.max(1, Math.round(Number(timelineManifest.tile?.w) || 96))
                      const tileH = Math.max(1, Math.round(Number(timelineManifest.tile?.h) || 54))
                      const cols = Math.max(1, Math.round(Number(timelineManifest.sprite?.cols) || 10))
                      const rows = Math.max(1, Math.round(Number(timelineManifest.sprite?.rows) || 6))
                      const perSprite = Math.max(1, Math.round(Number(timelineManifest.sprite?.perSprite) || cols * rows))
                      const spriteStart = Math.floor(tOrig / perSprite) * perSprite
                      const idx = tOrig - spriteStart
                      const col = idx % cols
                      const row = Math.floor(idx / cols)
                      const bgX = -col * tileW
                      const bgY = -row * tileH
                      const bgSize = `${tileW * cols}px ${tileH * rows}px`
                      const spriteUrl = `/api/uploads/${encodeURIComponent(String(uploadId))}/timeline/sprite?start=${encodeURIComponent(String(spriteStart))}&b=${retryNonce}`

                      return (
                        <div
                          key={`${tOrig}-${i}`}
                          onClick={() => {
                            try { videoRef.current?.pause?.() } catch {}
                            setPlaying(false)
                            seekEdited(i)
                          }}
                          style={{
                            width: tileW,
                            height: tileH,
                            flex: '0 0 auto',
                            backgroundImage: `url(${spriteUrl})`,
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: `${bgX}px ${bgY}px`,
                            backgroundSize: bgSize,
                            cursor: 'pointer',
                            borderRight: '1px solid rgba(0,0,0,0.22)',
                          }}
                          title={`${i}s`}
                        />
                      )
                    })}
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
                  }}
                />
              </div>
            ) : timelineError ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, color: '#bbb', fontSize: 13 }}>
                <div>{timelineError}</div>
                <button
                  type="button"
                  onClick={() => setRetryNonce((n) => n + 1)}
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
