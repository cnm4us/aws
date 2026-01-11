import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

function parseEditsFromFromUrl(from: string | null): { start: number | null; end: number | null } {
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

function applyEditsToUrl(from: string, edits: { start: number | null; end: number | null }): string {
  const u = new URL(from, window.location.origin)
  if (edits.start == null) u.searchParams.delete('editStart')
  else u.searchParams.set('editStart', String(edits.start))
  if (edits.end == null) u.searchParams.delete('editEnd')
  else u.searchParams.set('editEnd', String(edits.end))
  const qs = u.searchParams.toString()
  return qs ? `${u.pathname}?${qs}` : u.pathname
}

export default function EditVideo() {
  const uploadId = useMemo(() => parseUploadId(), [])
  const from = useMemo(() => parseFrom(), [])
  const initialEdits = useMemo(() => parseEditsFromFromUrl(from), [from])
  const [trimStart, setTrimStart] = useState<number | null>(initialEdits.start)
  const [trimEnd, setTrimEnd] = useState<number | null>(initialEdits.end)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [duration, setDuration] = useState<number>(0)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [proxyError, setProxyError] = useState<string | null>(null)

  const src = uploadId ? `/api/uploads/${encodeURIComponent(String(uploadId))}/edit-proxy?b=${retryNonce}` : null
  const backHref = from || (uploadId ? `/produce?upload=${encodeURIComponent(String(uploadId))}` : '/produce')

  const syncTime = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const d = Number.isFinite(v.duration) ? v.duration : 0
    const t = Number.isFinite(v.currentTime) ? v.currentTime : 0
    setDuration(d > 0 ? d : 0)
    setCurrentTime(t >= 0 ? roundToTenth(t) : 0)
  }, [])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onLoaded = () => syncTime()
    const onTime = () => syncTime()
    const onDur = () => syncTime()
    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('loadeddata', onLoaded)
    v.addEventListener('canplay', onLoaded)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('durationchange', onDur)
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('loadeddata', onLoaded)
      v.removeEventListener('canplay', onLoaded)
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('durationchange', onDur)
    }
  }, [syncTime])

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current
    if (!v) return
    try {
      v.currentTime = t
    } catch {}
  }, [])

  const setStartFromPlayhead = useCallback(() => {
    setTrimStart(roundToTenth(currentTime))
  }, [currentTime])

  const setEndFromPlayhead = useCallback(() => {
    setTrimEnd(roundToTenth(currentTime))
  }, [currentTime])

  const clearEdits = useCallback(() => {
    setTrimStart(null)
    setTrimEnd(null)
  }, [])

  const save = useCallback(() => {
    setError(null)
    const start = trimStart != null ? roundToTenth(trimStart) : null
    const end = trimEnd != null ? roundToTenth(trimEnd) : null
    const effectiveStart = start == null ? null : Math.max(0, start)
    const effectiveEnd = end == null ? null : Math.max(0, end)
    if (effectiveStart != null && effectiveEnd != null && effectiveEnd <= effectiveStart) {
      setError('End must be greater than Start.')
      return
    }
    const target = applyEditsToUrl(backHref, { start: effectiveStart, end: effectiveEnd })
    window.location.href = target
  }, [backHref, trimEnd, trimStart])

  if (!uploadId) {
    return (
      <div style={{ padding: 20, color: '#fff' }}>
        Missing upload id.
      </div>
    )
  }

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
            controls
            preload="metadata"
            style={{ width: '100%', borderRadius: 12, background: '#000' }}
            onError={() => setProxyError('Generating edit proxy… try again in a moment.')}
            onLoadedMetadata={() => syncTime()}
          />

          <div style={{ display: 'grid', gap: 10, padding: '12px 12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ color: '#bbb' }}>Playhead: {currentTime.toFixed(1)}s</div>
              <div style={{ color: '#bbb' }}>Duration: {duration > 0 ? `${duration.toFixed(1)}s` : '—'}</div>
            </div>

            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 0}
              step={0.1}
              value={Math.min(duration > 0 ? duration : 0, Math.max(0, currentTime))}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (!Number.isFinite(v)) return
                setCurrentTime(roundToTenth(v))
                seekTo(v)
              }}
              style={{ width: '100%' }}
              disabled={duration <= 0}
            />

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={setStartFromPlayhead}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Set Start
              </button>
              <button
                type="button"
                onClick={setEndFromPlayhead}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Set End
              </button>
              <button
                type="button"
                onClick={clearEdits}
                style={{
                  marginLeft: 'auto',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>

            <div style={{ display: 'grid', gap: 6, color: '#bbb', fontSize: 14 }}>
              <div>Start: {trimStart == null ? '—' : `${trimStart.toFixed(1)}s`}</div>
              <div>End: {trimEnd == null ? '— (end of video)' : `${trimEnd.toFixed(1)}s`}</div>
            </div>

            {error ? <div style={{ color: '#ff9b9b' }}>{error}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
