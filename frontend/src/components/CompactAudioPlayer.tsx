import React, { useEffect, useMemo, useRef, useState } from 'react'
import '../styles/audio-player.css'

type Props = {
  src: string
  autoPauseOthers?: boolean
}

let currentPlayingEl: HTMLAudioElement | null = null
const GOLD = '#d4af37'

function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export default function CompactAudioPlayer({ src, autoPauseOthers = true }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [seeking, setSeeking] = useState(false)

  const timeLabel = useMemo(() => `${formatTime(currentTime)} / ${formatTime(duration)}`, [currentTime, duration])
  const progressPct = useMemo(() => {
    if (!duration || duration <= 0) return 0
    const pct = (currentTime / duration) * 100
    return Math.max(0, Math.min(100, pct))
  }, [currentTime, duration])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    setPlaying(false)
    setCurrentTime(0)
    // duration will be set on loadedmetadata
  }, [src])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    const onLoaded = () => {
      const d = Number(el.duration)
      setDuration(Number.isFinite(d) ? d : 0)
    }
    const onTime = () => {
      if (seeking) return
      const t = Number(el.currentTime)
      setCurrentTime(Number.isFinite(t) ? t : 0)
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      setPlaying(false)
      setCurrentTime(0)
    }

    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
    }
  }, [seeking])

  useEffect(() => {
    return () => {
      const el = audioRef.current
      if (el && currentPlayingEl === el) currentPlayingEl = null
      try { el?.pause() } catch {}
    }
  }, [])

  const toggle = async () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      try { el.pause() } catch {}
      return
    }
    if (autoPauseOthers && currentPlayingEl && currentPlayingEl !== el) {
      try { currentPlayingEl.pause() } catch {}
    }
    currentPlayingEl = el
    try { await el.play() } catch {}
  }

  const onScrubStart = () => setSeeking(true)
  const onScrubEnd = () => setSeeking(false)
  const onScrub = (next: number) => {
    const el = audioRef.current
    const n = Number(next)
    const t = Number.isFinite(n) ? Math.max(0, Math.min(duration || 0, n)) : 0
    setCurrentTime(t)
    if (!el) return
    try { el.currentTime = t } catch {}
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <audio ref={audioRef} src={src} preload="none" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={toggle}
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            border: 'none',
            background: 'transparent',
            color: GOLD,
            fontWeight: 900,
            cursor: 'pointer',
            flexShrink: 0,
            padding: 0,
            lineHeight: 0,
            transform: 'translateY(-7px)',
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40 }}>
            {playing ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'block' }}>
                <rect x="3" y="3" width="4" height="12" rx="1" fill={GOLD} />
                <rect x="11" y="3" width="4" height="12" rx="1" fill={GOLD} />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'block' }}>
                <path d="M6.2 4.4C6.2 3.7 6.95 3.25 7.6 3.58L14.2 6.9C14.9 7.25 14.9 8.25 14.2 8.6L7.6 11.92C6.95 12.25 6.2 11.8 6.2 11.1V4.4Z" fill={GOLD} />
              </svg>
            )}
          </span>
        </button>

        <div style={{ flex: 1, display: 'grid', gap: 4 }}>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={Math.min(currentTime, duration || currentTime)}
            step={0.25}
            className="CompactAudioPlayerRange"
            style={
              {
                ['--pct' as any]: `${progressPct}%`,
                ['--gold' as any]: GOLD,
              } as React.CSSProperties
            }
            onPointerDown={onScrubStart as any}
            onPointerUp={onScrubEnd as any}
            onMouseDown={onScrubStart as any}
            onMouseUp={onScrubEnd as any}
            onTouchStart={onScrubStart as any}
            onTouchEnd={onScrubEnd as any}
            onChange={(e) => onScrub((e.target as HTMLInputElement).valueAsNumber)}
            onInput={(e) => onScrub((e.target as HTMLInputElement).valueAsNumber)}
            aria-label="Seek"
          />
          <div style={{ fontSize: 12, color: '#9a9a9a' }}>{timeLabel}</div>
        </div>
      </div>
    </div>
  )
}
