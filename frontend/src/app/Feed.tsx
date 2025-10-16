import React, { useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'

type UploadItem = {
  id: number
  url: string
  // Orientation-aware posters
  posterPortrait?: string
  posterLandscape?: string
  // Orientation-aware masters (derived)
  masterPortrait?: string
  masterLandscape?: string
}

function swapOrientation(url: string): { portrait?: string; landscape?: string } {
  if (!url) return {};
  if (url.includes('/portrait/')) {
    return { portrait: url, landscape: url.replace('/portrait/', '/landscape/') };
  }
  if (url.includes('/landscape/')) {
    return { landscape: url, portrait: url.replace('/landscape/', '/portrait/') };
  }
  return { portrait: url };
}

async function fetchUploads(opts?: { cursor?: number; userId?: number }): Promise<UploadItem[]> {
  const params = new URLSearchParams({ status: 'completed', limit: '20' })
  if (opts?.cursor) params.set('cursor', String(opts.cursor))
  if (opts?.userId) params.set('user_id', String(opts.userId))
  const res = await fetch(`/api/uploads?${params.toString()}`)
  if (!res.ok) throw new Error('failed to fetch uploads')
  const data = await res.json()
  return (data as any[]).map((r) => {
    const posterPortrait = r.poster_portrait_cdn || r.poster_portrait_s3 || r.poster_cdn || r.poster_s3 || ''
    const posterLandscape = r.poster_landscape_cdn || r.poster_landscape_s3 || ''
    const master = r.cdn_master || r.s3_master || ''
    const { portrait: masterPortrait, landscape: masterLandscape } = swapOrientation(master)
    return {
      id: r.id,
      url: masterPortrait || master,
      posterPortrait: posterPortrait,
      posterLandscape: posterLandscape,
      masterPortrait,
      masterLandscape,
    }
  })
}

export default function Feed() {
  const [items, setItems] = useState<UploadItem[]>([])
  const [cursor, setCursor] = useState<number | undefined>(undefined)
  const [index, setIndex] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isAuthed, setIsAuthed] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPortrait, setIsPortrait] = useState<boolean>(() => typeof window !== 'undefined' ? window.matchMedia && window.matchMedia('(orientation: portrait)').matches : true)
  const [posterAvail, setPosterAvail] = useState<Record<string, boolean>>({})
  const ignoreScrollUntil = useRef<number>(0)
  const ignoreIoUntil = useRef<number>(0)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [smoothEnabled, setSmoothEnabled] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [mineOnly, setMineOnly] = useState(false)
  const [myUserId, setMyUserId] = useState<number | null>(null)
  const modalVideoRef = useRef<HTMLVideoElement>(null)
  const [modalTime, setModalTime] = useState<number | null>(null)
  const [modalSrc, setModalSrc] = useState<string | null>(null)
  const playingIndexRef = useRef<number | null>(null)
  const hlsByIndexRef = useRef<Record<number, Hls | null>>({})
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [startedMap, setStartedMap] = useState<Record<number, boolean>>({})
  const lastTouchTsRef = useRef<number>(0)

  function getSlide(i: number): HTMLDivElement | null {
    const r = railRef.current
    if (!r) return null
    return (r.children[i] as HTMLDivElement) || null
  }
  function getVideoEl(i: number): HTMLVideoElement | null {
    const slide = getSlide(i)
    if (!slide) return null
    const v = slide.querySelector('video') as HTMLVideoElement | null
    return v
  }

  // Play a given slide's video on user gesture; pause others
  const playSlide = async (i: number) => {
    const it = items[i]
    if (!it) return
    const v = getVideoEl(i)
    if (!v) return
    // Pause all other videos and detach any hls instances
    try {
      const r = railRef.current
      if (r) {
        Array.from(r.querySelectorAll('video')).forEach((other, idx) => {
          if (other !== v) {
            try { (other as HTMLVideoElement).pause() } catch {}
          }
        })
      }
    } catch {}
    // Set source if missing
    const src = it.masterPortrait || it.url
    const needSrc = !v.src
    if (needSrc) {
      // Native HLS first
      const canNative = !!(v.canPlayType && (v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('application/x-mpegURL')))
      if (canNative) {
        v.src = src
      } else if (Hls.isSupported()) {
        // Clean any previous instance for this index
        const prev = hlsByIndexRef.current[i]
        if (prev) { try { prev.detachMedia(); prev.destroy(); } catch {} }
        const h = new Hls({ capLevelToPlayerSize: true, startLevel: -1, maxBufferLength: 15, backBufferLength: 0 })
        h.loadSource(src)
        h.attachMedia(v)
        hlsByIndexRef.current[i] = h
      } else {
        // Fallback: navigate
        location.href = src
        return
      }
    }
    v.playsInline = true
    v.preload = 'auto'
    v.loop = true
    v.muted = false
    // Wire basic events (use addEventListener to avoid clobbering)
    const onPlaying = () => {
      playingIndexRef.current = i
      setPlayingIndex(i)
      setStartedMap((prev) => (prev[i] ? prev : { ...prev, [i]: true }))
    }
    const onPause = () => { if (playingIndexRef.current === i) setPlayingIndex(null) }
    const onEnded = () => { if (playingIndexRef.current === i) setPlayingIndex(null) }
    try {
      v.addEventListener('playing', onPlaying)
      v.addEventListener('pause', onPause)
      v.addEventListener('ended', onEnded)
    } catch {}
    try { await v.play() } catch {}
    // Cleanup handlers on next source change or unmount via IO cleanup
  }

  function getSlideHeight(): number {
    const r = railRef.current
    const slide = r?.firstElementChild as HTMLElement | null
    const h = slide?.clientHeight || r?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 0)
    return Math.max(1, h)
  }

  // initial load
  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        const uidStr = (() => { try { return localStorage.getItem('userId') } catch { return null } })()
        setMyUserId(uidStr ? Number(uidStr) : null)
        const page = await fetchUploads(mineOnly && uidStr ? { userId: Number(uidStr) } : undefined)
        if (canceled) return
        setItems(page)
        if (page.length) setCursor(page[page.length - 1].id)
      } catch {}
    })()
    return () => {
      canceled = true
    }
  }, [])

  // reload when mineOnly toggles
  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        const uid = mineOnly ? myUserId : null
        const page = await fetchUploads(uid ? { userId: uid } : undefined)
        if (canceled) return
        setItems(page)
        setCursor(page.length ? page[page.length - 1].id : undefined)
        setIndex(0)
        railRef.current && (railRef.current.scrollTop = 0)
      } catch {}
    })()
    return () => { canceled = true }
  }, [mineOnly, myUserId])

  // Detect simple auth presence (stub): localStorage key 'auth' === '1'
  useEffect(() => {
    const read = () => {
      try { setIsAuthed(localStorage.getItem('auth') === '1') } catch { setIsAuthed(false) }
    }
    read()
    const onStorage = (e: StorageEvent) => { if (e.key === 'auth') read() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Orientation change listener
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(orientation: portrait)')
    const onChange = () => setIsPortrait(mql.matches)
    try { mql.addEventListener('change', onChange) } catch { mql.addListener(onChange) }
    return () => { try { mql.removeEventListener('change', onChange) } catch { mql.removeListener(onChange) } }
  }, [])

  // Preload next posters (both orientations if present)
  useEffect(() => {
    const nexts = [index + 1, index + 2]
    nexts.forEach((i) => {
      const pi = items[i]
      const urls = [pi?.posterPortrait, pi?.posterLandscape].filter(Boolean) as string[]
      urls.forEach((u) => {
        if (!u || posterAvail.hasOwnProperty(u)) return
        const img = new Image()
        img.onload = () => setPosterAvail((prev) => ({ ...prev, [u]: true }))
        img.onerror = () => setPosterAvail((prev) => ({ ...prev, [u]: false }))
        img.src = u
      })
    })
  }, [index, items, posterAvail])

  // Attach and play current item
  const attachAndPlay = async (i: number, opts?: { unmute?: boolean }) => {
    const v = videoRef.current
    const r = railRef.current
    if (!v || !r) return
    // Ensure the single video element lives inside the active slide holder for iOS scrollability
    const slide = r.children[i] as HTMLDivElement | undefined
    const holder = slide?.querySelector('.holder') as HTMLDivElement | null
    if (!slide || !holder) return
    if (v.parentElement !== holder) {
      // Place video as first child; keep existing controls (e.g., Expand button)
      try { holder.insertBefore(v, holder.firstChild) } catch { holder.appendChild(v) }
    }
    // Ensure video sits visually below overlay controls
    try { (v.style as any).zIndex = '0' } catch {}
    const targetUrl = items[i].url
    const srcChanged = v.src !== targetUrl
    if (srcChanged) {
      v.style.opacity = '0'
      const onLoaded = () => {
        v.style.opacity = '1'
        v.removeEventListener('loadeddata', onLoaded)
      }
      v.addEventListener('loadeddata', onLoaded)
    } else {
      // Keep visible if source unchanged
      v.style.opacity = '1'
    }
    try {
      v.playsInline = true
      v.loop = true
      // Keep preload light; avoid load() if source unchanged
      v.preload = 'auto'
      // For iOS unlock, ensure unmuted on first user gesture
      v.muted = opts?.unmute ? false : !unlocked
      if (srcChanged) {
        v.src = targetUrl
        // Kick pipeline only when the source actually changed
        try { v.load() } catch {}
      }
      await v.play().catch(() => {})
      if (opts?.unmute && v.muted) {
        // If somehow still muted, try unmute + play again
        v.muted = false
        await v.play().catch(() => {})
      }
    } catch {}
  }

  function itemHasLandscape(it?: UploadItem): boolean {
    if (!it) return false
    // If we have a distinct landscape poster and it hasn't been marked as 404
    const lp = it.posterLandscape
    if (lp && posterAvail[lp] !== false) return true
    // Otherwise, if we have a derived landscape master URL distinct from portrait
    if (it.masterLandscape && it.masterLandscape !== it.masterPortrait) return true
    return false
  }

  const openModal = () => {
    const v = playingIndexRef.current != null ? getVideoEl(playingIndexRef.current) : null
    const it = items[index]
    if (!it) return
    if (!unlocked) setUnlocked(true)
    const t = v ? v.currentTime || 0 : 0
    setModalTime(t)
    // Prefer explicit landscape master, fallback by swap
    const src = it.masterLandscape || (it.url.includes('/portrait/') ? it.url.replace('/portrait/', '/landscape/') : it.url)
    setModalSrc(src)
    // Pause inline to save resources
    try { v?.pause() } catch {}
    setModalOpen(true)
    // Prevent background scroll
    try { document.body.style.overflow = 'hidden' } catch {}
  }

  const closeModal = () => {
    const mv = modalVideoRef.current
    const cur = mv ? mv.currentTime : modalTime || 0
    setModalOpen(false)
    try { document.body.style.overflow = '' } catch {}
    // Resume inline at captured time
    const v = playingIndexRef.current != null ? getVideoEl(playingIndexRef.current) : null
    if (v) {
      try {
        v.currentTime = Math.max(0, cur)
      } catch {}
      try { v.play() } catch {}
    }
  }

  // Drive modal video when open
  useEffect(() => {
    const mv = modalVideoRef.current
    if (!modalOpen || !mv || !modalSrc) return
    let mounted = true
    const onLoaded = async () => {
      if (!mounted) return
      try {
        if (modalTime != null) mv.currentTime = Math.max(0, modalTime)
      } catch {}
      mv.muted = !unlocked
      try { await mv.play() } catch {}
    }
    mv.addEventListener('loadedmetadata', onLoaded)
    if (mv.src !== modalSrc) {
      mv.src = modalSrc
      try { mv.load() } catch {}
    } else {
      onLoaded()
    }
    return () => {
      mounted = false
      mv.removeEventListener('loadedmetadata', onLoaded)
      try { mv.pause() } catch {}
    }
  }, [modalOpen, modalSrc])

  // On unlock
  const unlock = () => {
    if (unlocked) return
    setUnlocked(true)
    // First real tap on the video surface will handle play
  }

  // Compute active index on scroll (snap to nearest)
  const onScroll = () => {
    const r = railRef.current
    if (!r) return
    const now = Date.now()
    if (now < ignoreScrollUntil.current) return
    const y = r.scrollTop
    const h = getSlideHeight()
    // center-based index to reduce boundary sensitivity
    const i = Math.max(0, Math.min(items.length - 1, Math.floor((y + h / 2) / h)))
    if (i !== index) {
      setIndex(i)
      // pagination
      if (!loadingMore && items.length - i < 5 && cursor) {
        setLoadingMore(true)
        const uid = mineOnly ? myUserId : null
        fetchUploads({ cursor, userId: uid ?? undefined })
          .then((page) => {
            if (page.length) {
              setItems((prev) => prev.concat(page))
              setCursor(page[page.length - 1].id)
            }
          })
          .finally(() => setLoadingMore(false))
      }
    }
  }

  // Render cards
  const slides = useMemo(
    () =>
      items.map((it, i) => {
        const desired = isPortrait ? it.posterPortrait : it.posterLandscape
        const fallback = isPortrait ? it.posterLandscape : it.posterPortrait
        const useUrl = (desired && posterAvail[desired] !== false ? desired : undefined) || (fallback && posterAvail[fallback] !== false ? fallback : undefined)
        return (
          <div
            key={it.id}
            className="slide"
            style={{ backgroundImage: useUrl ? `url('${useUrl}')` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            <div className="holder">
              <video
                playsInline
                preload="auto"
                poster={useUrl}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  try { e.preventDefault() } catch {}
                  const now = Date.now();
                  if (now - lastTouchTsRef.current < 300) return;
                  lastTouchTsRef.current = now;
                  const v = getVideoEl(i);
                  if (!v) return;
                  if (!v.src) { playSlide(i); return; }
                  if (v.paused) playSlide(i); else { try { v.pause() } catch {} }
                }}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: 'transparent', opacity: (playingIndex === i || startedMap[i]) ? 1 : 0, transition: 'opacity .12s linear', touchAction: 'manipulation' as any }}
              />
              {playingIndex !== i && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%,-50%)',
                    width: '22vmin',
                    height: '22vmin',
                    minWidth: 72,
                    minHeight: 72,
                    pointerEvents: 'none',
                    display: 'grid',
                    placeItems: 'center',
                    zIndex: 2,
                  }}
                >
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
                    <polygon points="38,28 38,72 72,50" fill="#ffffff" fillOpacity="0.4" />
                  </svg>
                </div>
              )}
              {/* Expand control removed per PWA full-bleed design */}
            </div>
          </div>
        )
      }),
    [items, isPortrait, posterAvail, playingIndex, startedMap]
  )

  function reanchorToIndex(curIndex: number) {
    const r = railRef.current
    if (!r) return
    const slideEl = r.children[curIndex] as HTMLElement | undefined
    const targetTop = slideEl ? slideEl.offsetTop : curIndex * getSlideHeight()
    // Extend lock window to outlast iOS reflow/snap
    const lockMs = 700
    setSmoothEnabled(false)
    setSnapEnabled(false)
    const until = Date.now() + lockMs
    ignoreScrollUntil.current = until
    ignoreIoUntil.current = until
    // Phase 1: next frame
    const id1 = requestAnimationFrame(() => {
      try { r.scrollTo({ top: targetTop, left: 0, behavior: 'auto' }) } catch { r.scrollTop = targetTop }
      // Phase 2: after additional delay, re-assert position and restore snap
      setTimeout(() => {
        const slideEl2 = r.children[curIndex] as HTMLElement | undefined
        const targetTop2 = slideEl2 ? slideEl2.offsetTop : curIndex * getSlideHeight()
        try { r.scrollTo({ top: targetTop2, left: 0, behavior: 'auto' }) } catch { r.scrollTop = targetTop2 }
        // Restore behaviors after the lock window
        setTimeout(() => {
          setSmoothEnabled(true)
          setSnapEnabled(true)
        }, Math.max(50, lockMs - 200))
      }, 180)
    })
    return () => cancelAnimationFrame(id1)
  }

  // Re-anchor on orientation change to prevent index jumps
  useEffect(() => {
    return reanchorToIndex(index) || undefined
  }, [isPortrait])

  // Also listen to native orientationchange as a backstop (iOS Safari)
  useEffect(() => {
    const handler = () => { reanchorToIndex(index) }
    window.addEventListener('orientationchange', handler)
    return () => window.removeEventListener('orientationchange', handler)
  }, [index])

  // IntersectionObserver to robustly pick slide nearest center
  useEffect(() => {
    const r = railRef.current
    if (!r) return
    const slides = Array.from(r.children) as HTMLElement[]
    if (!slides.length) return
    const io = new IntersectionObserver(
      (entries) => {
        const now = Date.now()
        if (now < ignoreIoUntil.current) return
        // choose the entry with maximum intersection ratio
        let best: IntersectionObserverEntry | null = null
        for (const e of entries) {
          if (!best || e.intersectionRatio > best.intersectionRatio) best = e
        }
        if (!best || best.target == null) return
        const idx = slides.indexOf(best.target as HTMLElement)
        if (idx >= 0 && idx !== index) {
          setIndex(idx)
        }
        // Pause offscreen videos (not the center) and unload far slides
        entries.forEach((e) => {
          const i = slides.indexOf(e.target as HTMLElement)
          const v = getVideoEl(i)
          if (!v) return
          if (e.intersectionRatio < 0.5 && i !== index) {
            try { v.pause() } catch {}
            if (Math.abs(i - index) > 2) {
              try { v.removeAttribute('src'); v.load() } catch {}
              setStartedMap((prev) => {
                if (!prev[i]) return prev
                const c = { ...prev }
                delete c[i]
                return c
              })
            }
          }
        })
      },
      { root: r, threshold: Array.from({ length: 11 }, (_, i) => i / 10) }
    )
    slides.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [items, unlocked])

  // Eagerly attach source for the active slide so first tap is lighter (iOS)
  useEffect(() => {
    const v = getVideoEl(index)
    const it = items[index]
    if (!v || !it) return
    if (!v.src) {
      try {
        v.playsInline = true
        v.preload = 'auto'
        // Prefer native HLS on iOS; otherwise wait for explicit play to attach hls.js
        const canNative = !!(v.canPlayType && (v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('application/x-mpegURL')))
        if (canNative) {
          const src = it.masterPortrait || it.url
          v.src = src
          try { v.load() } catch {}
        }
      } catch {}
    }
  }, [index, items])

  return (
    <div style={{ height: '100dvh', overflow: 'hidden', background: '#000' }}>
      {/* Scrim behind drawer */}
      <div
        onPointerUp={(e) => { e.stopPropagation(); if (menuOpen) setMenuOpen(false) }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          opacity: menuOpen ? 1 : 0,
          transition: 'opacity 200ms ease',
          zIndex: 1000,
          pointerEvents: menuOpen ? 'auto' : 'none',
        }}
      />
      {/* Hamburger */}
      <button
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        onPointerUp={(e) => { e.stopPropagation(); setMenuOpen((s) => !s) }}
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          left: 8,
          zIndex: 1002,
          background: 'transparent',
          border: 'none',
          padding: 8,
          opacity: 0.9,
          touchAction: 'manipulation' as any,
        }}
      >
        {/* Icon: hamburger or X */}
        {menuOpen ? (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5 L19 19 M19 5 L5 19" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
          </svg>
        ) : (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7 H20 M4 12 H20 M4 17 H20" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
          </svg>
        )}
      </button>
      {/* Slide-out menu (left) */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: '78vw',
          maxWidth: 340,
          background: 'rgba(0,0,0,0.8)',
          color: '#fff',
          zIndex: 1001,
          transform: menuOpen ? 'translate3d(0,0,0)' : 'translate3d(-100%,0,0)',
          transition: 'transform 260ms cubic-bezier(0.25,1,0.5,1)',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          paddingLeft: 12,
          paddingRight: 12,
          boxShadow: menuOpen ? '2px 0 12px rgba(0,0,0,0.5)' : 'none',
          pointerEvents: menuOpen ? 'auto' : 'none',
          WebkitBackdropFilter: menuOpen ? 'saturate(120%) blur(6px)' : undefined,
          backdropFilter: menuOpen ? 'saturate(120%) blur(6px)' : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Login/Logout primary button */}
        <a
          href={isAuthed ? '/logout' : '/login'}
          style={{
            display: 'inline-block',
            textDecoration: 'none',
            textAlign: 'center' as const,
            color: '#fff',
            background: isAuthed ? '#d32f2f' : '#2e7d32',
            padding: '12px 20px',
            borderRadius: 10,
            fontWeight: 600,
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
            boxShadow: '0 4px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.15)',
            marginBottom: 14,
          }}
        >
          {isAuthed ? 'LOGOUT' : 'LOGIN'}
        </a>
        {/* My Videos toggle (only when logged in) */}
        {isAuthed && (
          <div style={{ marginTop: 10, marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={mineOnly} onChange={(e)=> setMineOnly(e.target.checked)} style={{ transform: 'scale(1.2)' }} />
              Show only my videos
            </label>
          </div>
        )}
        {/* Register link (only when logged out) */}
        {!isAuthed && (
          <a href="/register" style={{ display: 'block', color: '#fff', textDecoration: 'none', fontSize: 16 }}>
            Register
          </a>
        )}
      </div>
      {!unlocked && (
        <div
          onClick={unlock}
          onTouchEnd={unlock}
          style={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'linear-gradient(180deg,#000,#111)',
            zIndex: 10,
          }}
        >
          <button style={{ color: '#fff', background: '#0a84ff', border: 'none', padding: '14px 20px', borderRadius: 12, fontSize: 16 }}>
            Tap to start
          </button>
        </div>
      )}
      <div
        ref={railRef}
        onScroll={onScroll}
        style={{
          position: 'fixed',
          inset: 0,
          overflowY: 'auto',
          // Improve iOS touch scrolling reliability
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
          scrollSnapType: snapEnabled ? 'y mandatory' as const : 'none' as const,
          scrollBehavior: smoothEnabled ? 'smooth' as const : 'auto' as const,
        }}
      >
        {slides.length ? slides : <div style={{ color: '#fff', padding: 20 }}>Loading…</div>}
      </div>
      {/* Per-slide videos handle playback; no global video element */}
      {modalOpen && (
        <div
          onClick={closeModal}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.96)', zIndex: 50, display: 'grid', placeItems: 'center' }}
        >
          <video
            ref={modalVideoRef}
            playsInline
            controls
            autoPlay
            preload="auto"
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
          <button
            onClick={(e) => { e.stopPropagation(); closeModal() }}
            style={{ position: 'fixed', top: 14, right: 14, zIndex: 51, background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 16, padding: '6px 10px' }}
          >
            Close
          </button>
        </div>
      )}
      <style>{`
        .slide{position:relative; width:100vw; height:100dvh; scroll-snap-align:start; scroll-snap-stop:always; background:#000; background-size:cover; background-position:center; background-repeat:no-repeat;}
        .holder{position:absolute; inset:0;}
      `}</style>
    </div>
  )
}
