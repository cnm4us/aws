import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'

// Lightweight logging helper for field diagnostics
const FEED_TAG = '[feed]'
function log(...args: any[]) { try { console.log(FEED_TAG, ...args) } catch {} }
function warn(...args: any[]) { try { console.warn(FEED_TAG, ...args) } catch {} }
function error(...args: any[]) { try { console.error(FEED_TAG, ...args) } catch {} }

type UploadItem = {
  id: number
  url: string
  posterPortrait?: string
  posterLandscape?: string
  masterPortrait?: string
  masterLandscape?: string
  ownerId?: number | null
  ownerName?: string | null
  ownerEmail?: string | null
  publicationId?: number | null
  spaceId?: number | null
  publishedAt?: string | null
}

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
  roles: string[]
  spaceRoles: Record<string, string[]>
  personalSpace: { id: number; slug: string } | null
}

type SpaceSummary = {
  id: number
  name: string
  slug: string
  type: 'personal' | 'group' | 'channel'
  relationship: 'owner' | 'admin' | 'member' | 'subscriber'
  subscribed: boolean
}

type MySpacesResponse = {
  personal: SpaceSummary | null
  global: SpaceSummary | null
  groups: SpaceSummary[]
  channels: SpaceSummary[]
}

type FeedMode =
  | { kind: 'global' }
  | { kind: 'space'; spaceId: number }

function swapOrientation(url: string): { portrait?: string; landscape?: string } {
  if (!url) return {}
  if (url.includes('/portrait/')) {
    return { portrait: url, landscape: url.replace('/portrait/', '/landscape/') }
  }
  if (url.includes('/landscape/')) {
    return { landscape: url, portrait: url.replace('/landscape/', '/portrait/') }
  }
  return { portrait: url }
}

function buildUploadItem(raw: any, owner?: { id: number | null; displayName?: string | null; email?: string | null } | null, publication?: any | null): UploadItem {
  const posterPortrait = raw.poster_portrait_cdn || raw.poster_portrait_s3 || raw.poster_cdn || raw.poster_s3 || ''
  const posterLandscape = raw.poster_landscape_cdn || raw.poster_landscape_s3 || ''
  const master = raw.cdn_master || raw.s3_master || ''
  const { portrait: masterPortrait, landscape: masterLandscape } = swapOrientation(master)
  const ownerId = owner?.id != null ? Number(owner.id) : (raw.user_id != null ? Number(raw.user_id) : null)
  const ownerName = owner?.displayName ?? null
  const ownerEmail = owner?.email ?? null
  const publicationId = publication?.id != null ? Number(publication.id) : null
  const spaceId = publication?.space_id != null ? Number(publication.space_id) : (raw.space_id != null ? Number(raw.space_id) : null)
  const publishedAt = publication?.published_at ? String(publication.published_at) : null
  return {
    id: Number(raw.id),
    url: masterPortrait || master,
    posterPortrait,
    posterLandscape,
    masterPortrait,
    masterLandscape,
    ownerId,
    ownerName,
    ownerEmail,
    publicationId,
    spaceId,
    publishedAt,
  }
}

// Legacy feed removed: feeds are driven by publications only.

async function fetchSpaceFeed(spaceId: number, opts: { cursor?: string | null; limit?: number } = {}): Promise<{ items: UploadItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 20) })
  if (opts.cursor) params.set('cursor', opts.cursor)
  const res = await fetch(`/api/spaces/${spaceId}/feed?${params.toString()}`)
  if (!res.ok) throw new Error('failed to fetch space feed')
  const payload = await res.json()
  const items = Array.isArray(payload?.items)
    ? payload.items.map((entry: any) =>
        buildUploadItem(entry.upload, entry.owner ? { id: entry.owner.id ?? null, displayName: entry.owner.displayName ?? null, email: entry.owner.email ?? null } : null, entry.publication ?? null)
      )
    : []
  const nextCursor = typeof payload?.nextCursor === 'string' && payload.nextCursor.length ? payload.nextCursor : null
  return { items, nextCursor }
}

async function fetchGlobalFeed(opts: { cursor?: string | null; limit?: number } = {}): Promise<{ items: UploadItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 20) })
  if (opts.cursor) params.set('cursor', opts.cursor)
  const res = await fetch(`/api/feed/global?${params.toString()}`)
  if (!res.ok) throw new Error('failed to fetch global feed')
  const payload = await res.json()
  const items = Array.isArray(payload?.items)
    ? payload.items.map((entry: any) =>
        buildUploadItem(entry.upload, entry.owner ? { id: entry.owner.id ?? null, displayName: entry.owner.displayName ?? null, email: entry.owner.email ?? null } : null, entry.publication ?? null)
      )
    : []
  const nextCursor = typeof payload?.nextCursor === 'string' && payload.nextCursor.length ? payload.nextCursor : null
  return { items, nextCursor }
}

function applyMineFilter(items: UploadItem[], mineOnly: boolean, myUserId: number | null): UploadItem[] {
  if (!mineOnly) return items
  if (myUserId == null) return []
  return items.filter((it) => it.ownerId === myUserId)
}

function flattenSpaces(list: MySpacesResponse | null): SpaceSummary[] {
  if (!list) return []
  const merged: SpaceSummary[] = []
  if (list.global) merged.push(list.global)
  if (list.personal) merged.push(list.personal)
  merged.push(...(list.groups || []))
  merged.push(...(list.channels || []))
  return merged
}

export default function Feed() {
  const [items, setItems] = useState<UploadItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [unlocked, setUnlocked] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'nav' | 'spaces'>('nav')
  const [isAuthed, setIsAuthed] = useState(false)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [spaceList, setSpaceList] = useState<MySpacesResponse | null>(null)
  const [spacesLoaded, setSpacesLoaded] = useState(false)
  const [spacesLoading, setSpacesLoading] = useState(false)
  const [spacesError, setSpacesError] = useState<string | null>(null)
  const [feedMode, setFeedMode] = useState<FeedMode>({ kind: 'global' })
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

  const spacesStatusRef = useRef<{ loading: boolean; loaded: boolean }>({ loading: false, loaded: false })

  const loadSpaces = useCallback(async (force = false) => {
    if (!isAuthed) return
    if (spacesStatusRef.current.loading) return
    if (!force && spacesStatusRef.current.loaded) return
    spacesStatusRef.current.loading = true
    setSpacesLoading(true)
    try {
      const res = await fetch('/api/me/spaces', { credentials: 'same-origin' })
      if (!res.ok) throw new Error('failed_to_fetch_spaces')
      const data: MySpacesResponse = await res.json()
      setSpaceList({
        personal: data.personal || null,
        global: data.global || null,
        groups: Array.isArray(data.groups) ? data.groups : [],
        channels: Array.isArray(data.channels) ? data.channels : [],
      })
      setSpacesError(null)
      spacesStatusRef.current.loaded = true
      setSpacesLoaded(true)
    } catch (err: any) {
      console.error('load spaces failed', err)
      setSpacesError(err?.message ? String(err.message) : 'failed_to_fetch_spaces')
      spacesStatusRef.current.loaded = false
      setSpacesLoaded(false)
    } finally {
      spacesStatusRef.current.loading = false
      setSpacesLoading(false)
    }
  }, [isAuthed])

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        const res = await fetch('/api/me')
        if (!res.ok) throw new Error('me_failed')
        const data: MeResponse = await res.json()
        if (canceled) return
        setMe(data)
        setIsAuthed(Boolean(data.userId))
        setMyUserId(data.userId ?? null)
      } catch {
        if (canceled) return
        setMe(null)
        setIsAuthed(false)
        setMyUserId(null)
        setSpaceList(null)
        setSpacesLoaded(false)
        setSpacesError(null)
        setFeedMode((prev) => (prev.kind === 'space' ? { kind: 'global' } : prev))
      }
    })()
    return () => { canceled = true }
  }, [])

  useEffect(() => {
    if (!isAuthed) return
    loadSpaces(true).catch(() => {})
  }, [isAuthed, loadSpaces])

  useEffect(() => {
    let canceled = false
    const load = async () => {
      try {
        setInitialLoading(true)
        setLoadingMore(false)
        let nextCursor: string | null = null
        let fetchedItems: UploadItem[] = []
        if (feedMode.kind === 'space') {
          const { items: page, nextCursor: cursorStr } = await fetchSpaceFeed(feedMode.spaceId)
          fetchedItems = applyMineFilter(page, mineOnly, myUserId)
          nextCursor = cursorStr
        } else if (feedMode.kind === 'global') {
          const { items: page, nextCursor: cursorStr } = await fetchGlobalFeed()
          fetchedItems = applyMineFilter(page, mineOnly, myUserId)
          nextCursor = cursorStr
        } else {
          // Fallback: treat as global feed
          const { items: page, nextCursor: cursorStr } = await fetchGlobalFeed()
          fetchedItems = applyMineFilter(page, mineOnly, myUserId)
          nextCursor = cursorStr
        }
        if (canceled) return
        setItems(fetchedItems)
        setCursor(nextCursor)
        setIndex(0)
        railRef.current && (railRef.current.scrollTop = 0)
      } catch (err) {
        if (canceled) return
        console.error('initial feed load failed', err)
        setItems([])
        setCursor(null)
      } finally {
        if (!canceled) setInitialLoading(false)
      }
    }
    load()
    return () => { canceled = true }
  }, [feedMode, mineOnly, myUserId])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(orientation: portrait)')
    const onChange = () => setIsPortrait(mql.matches)
    try { mql.addEventListener('change', onChange) } catch { mql.addListener(onChange) }
    return () => { try { mql.removeEventListener('change', onChange) } catch { mql.removeListener(onChange) } }
  }, [])

  useEffect(() => {
    // Environment + capability snapshot for diagnostics
    try {
      const test = document.createElement('video') as HTMLVideoElement
      const native = !!(
        test.canPlayType &&
        (test.canPlayType('application/vnd.apple.mpegurl') || test.canPlayType('application/x-mpegURL'))
      )
      const mse = typeof (window as any).MediaSource !== 'undefined'
      const hlsjs = !!Hls.isSupported()
      log('env', { ua: navigator.userAgent, nativeHls: native, mse, hlsjs })
    } catch {}
    
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

  const isIOS = (() => {
    try {
      const ua = navigator.userAgent || ''
      const iOS = /iPad|iPhone|iPod/.test(ua)
      const macTouch = /Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1
      return iOS || macTouch
    } catch { return false }
  })()
  const isSafari = (() => {
    try { return /^((?!chrome|android).)*safari/i.test(navigator.userAgent || '') } catch { return false }
  })()

  const preferNativeHls = () => isIOS || isSafari

  const playSlide = async (i: number) => {
    const it = items[i]
    if (!it) return
    const v = getVideoEl(i)
    if (!v) return
    try {
      log('playSlide', { i, id: it.id, pub: it.publicationId ?? null })
      const r = railRef.current
      if (r) {
        Array.from(r.querySelectorAll('video')).forEach((other) => {
          if (other !== v) {
            try { (other as HTMLVideoElement).pause() } catch {}
          }
        })
      }
    } catch {}
    const src = it.masterPortrait || it.url
    const needSrc = !v.src
    if (needSrc) {
      const canNative = !!(v.canPlayType && (v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('application/x-mpegURL')))
      const preferHls = Hls.isSupported() && !preferNativeHls()
      log('attach source', { i, canNative, hlsSupported: Hls.isSupported(), preferHls, src })
      if (preferHls) {
        // Force hls.js on non‑Safari/Apple platforms
        const prev = hlsByIndexRef.current[i]
        if (prev) { try { prev.detachMedia(); prev.destroy(); } catch {} }
        const h = new Hls({ capLevelToPlayerSize: true, startLevel: -1, maxBufferLength: 15, backBufferLength: 0, debug: false })
        try {
          h.on(Hls.Events.ERROR, (_evt, data) => {
            error('hls error', { type: data.type, details: (data as any).details, fatal: data.fatal, code: (data as any).response?.code })
          })
          h.on(Hls.Events.MANIFEST_LOADED, (_evt, data: any) => {
            log('hls manifest loaded', { levels: data?.levels?.length, targetduration: data?.stats?.tload ? undefined : undefined })
          })
        } catch {}
        h.loadSource(src)
        h.attachMedia(v)
        hlsByIndexRef.current[i] = h
      } else if (canNative) {
        // Safari/iOS path
        v.src = src
      } else if (Hls.isSupported()) {
        // Fallback to hls.js when native says no
        const prev = hlsByIndexRef.current[i]
        if (prev) { try { prev.detachMedia(); prev.destroy(); } catch {} }
        const h = new Hls({ capLevelToPlayerSize: true, startLevel: -1, maxBufferLength: 15, backBufferLength: 0, debug: false })
        h.loadSource(src)
        h.attachMedia(v)
        hlsByIndexRef.current[i] = h
      } else {
        location.href = src
        return
      }
    }
    v.playsInline = true
    v.preload = 'auto'
    v.loop = true
    v.muted = !unlocked
    const onPlaying = () => {
      playingIndexRef.current = i
      setPlayingIndex(i)
      setStartedMap((prev) => (prev[i] ? prev : { ...prev, [i]: true }))
      log('video playing', { i })
    }
    const onPause = () => { if (playingIndexRef.current === i) { setPlayingIndex(null); log('video pause', { i }) } }
    const onEnded = () => { if (playingIndexRef.current === i) { setPlayingIndex(null); log('video ended', { i }) } }
    const onWaiting = () => log('video waiting', { i })
    const onStalled = () => log('video stalled', { i })
    const onError = () => error('video error', { i, mediaError: (v as any).error?.message || (v as any).error?.code })
    try {
      v.addEventListener('playing', onPlaying)
      v.addEventListener('pause', onPause)
      v.addEventListener('ended', onEnded)
      v.addEventListener('waiting', onWaiting)
      v.addEventListener('stalled', onStalled)
      v.addEventListener('error', onError)
    } catch {}
    try {
      await v.play()
      log('play() resolved', { i, muted: v.muted, readyState: v.readyState })
    } catch (e: any) {
      error('play() rejected', { i, name: e?.name, message: e?.message })
    }
  }

  function getSlideHeight(): number {
    const r = railRef.current
    const slide = r?.firstElementChild as HTMLElement | null
    const h = slide?.clientHeight || r?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 0)
    return Math.max(1, h)
  }

  useEffect(() => {
    const v = getVideoEl(index)
    const it = items[index]
    if (!v || !it) return
    if (!v.src) {
      try {
        v.playsInline = true
        v.preload = 'auto'
        const canNative = !!(v.canPlayType && (v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('application/x-mpegURL')))
        if (canNative) {
          const src = it.masterPortrait || it.url
          v.src = src
          try { v.load() } catch {}
        }
      } catch {}
    }
  }, [index, items])

  const attachAndPlay = async (i: number, opts?: { unmute?: boolean }) => {
    const v = videoRef.current
    const r = railRef.current
    if (!v || !r) return
    const slide = r.children[i] as HTMLDivElement | undefined
    const holder = slide?.querySelector('.holder') as HTMLDivElement | null
    if (!slide || !holder) return
    if (v.parentElement !== holder) {
      try { holder.insertBefore(v, holder.firstChild) } catch { holder.appendChild(v) }
    }
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
      v.style.opacity = '1'
    }
    try {
      v.playsInline = true
      v.loop = true
      v.preload = 'auto'
      v.muted = opts?.unmute ? false : !unlocked
      if (srcChanged) {
        v.src = targetUrl
        try { v.load() } catch {}
      }
      await v.play().catch(() => {})
      if (opts?.unmute && v.muted) {
        v.muted = false
        await v.play().catch(() => {})
      }
    } catch {}
  }

  useEffect(() => {
    if (!items.length) return
    attachAndPlay(index, { unmute: unlocked }).catch(() => {})
  }, [index, items, unlocked])

  function itemHasLandscape(it?: UploadItem): boolean {
    if (!it) return false
    const lp = it.posterLandscape
    if (lp && posterAvail[lp] !== false) return true
    if (it.masterLandscape && it.masterLandscape !== it.masterPortrait) return true
    return false
  }

  const openModal = () => {
    const currentIndex = playingIndexRef.current != null ? playingIndexRef.current : index
    const v = currentIndex != null ? getVideoEl(currentIndex) : null
    const it = items[currentIndex]
    if (!it) return
    if (!unlocked) setUnlocked(true)
    const t = v ? v.currentTime || 0 : 0
    setModalTime(t)
    const src = it.masterLandscape || (it.url.includes('/portrait/') ? it.url.replace('/portrait/', '/landscape/') : it.url)
    setModalSrc(src)
    try { v?.pause() } catch {}
    setModalOpen(true)
    try { document.body.style.overflow = 'hidden' } catch {}
  }

  const closeModal = () => {
    const mv = modalVideoRef.current
    const cur = mv ? mv.currentTime : modalTime || 0
    setModalOpen(false)
    try { document.body.style.overflow = '' } catch {}
    const v = playingIndexRef.current != null ? getVideoEl(playingIndexRef.current) : null
    if (v) {
      try {
        v.currentTime = Math.max(0, cur)
      } catch {}
      try { v.play() } catch {}
    }
  }

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

  const unlock = () => {
    if (unlocked) return
    // Start via the same pipeline used elsewhere so listeners/state are attached
    log('unlock gesture', { index, haveItem: !!items[index], haveVideo: !!getVideoEl(index) })
    try { void playSlide(index) } catch {}
    setUnlocked(true)
  }

  const onScroll = () => {
    const r = railRef.current
    if (!r) return
    const now = Date.now()
    if (now < ignoreScrollUntil.current) return
    const y = r.scrollTop
    const h = getSlideHeight()
    const i = Math.max(0, Math.min(items.length - 1, Math.floor((y + h / 2) / h)))
    if (i !== index) {
      setIndex(i)
      if (!loadingMore && items.length - i < 5 && cursor) {
        setLoadingMore(true)
        const loadMore = async () => {
          try {
            if (feedMode.kind === 'space') {
              const { items: page, nextCursor } = await fetchSpaceFeed(feedMode.spaceId, { cursor })
              const filtered = applyMineFilter(page, mineOnly, myUserId)
              setItems((prev) => prev.concat(filtered))
              setCursor(nextCursor)
            } else if (feedMode.kind === 'global') {
              const { items: page, nextCursor } = await fetchGlobalFeed({ cursor })
              const filtered = applyMineFilter(page, mineOnly, myUserId)
              setItems((prev) => prev.concat(filtered))
              setCursor(nextCursor)
            } else {
              const { items: page, nextCursor: nextCursorStr } = await fetchGlobalFeed({ cursor })
              const filtered = applyMineFilter(page, mineOnly, myUserId)
              setItems((prev) => prev.concat(filtered))
              setCursor(nextCursorStr)
            }
          } catch (err) {
            console.error('load more failed', err)
          } finally {
            setLoadingMore(false)
          }
        }
        loadMore().catch(() => setLoadingMore(false))
      }
    }
  }

  const slides = useMemo(
    () =>
      items.map((it, i) => {
        const desired = isPortrait ? it.posterPortrait : it.posterLandscape
        const fallback = isPortrait ? it.posterLandscape : it.posterPortrait
        const useUrl =
          (desired && posterAvail[desired] !== false ? desired : undefined) ||
          (fallback && posterAvail[fallback] !== false ? fallback : undefined)
        return (
          <div
            key={`${it.id}-${it.publicationId ?? 'upload'}`}
            className="slide"
            style={{ backgroundImage: useUrl ? `url('${useUrl}')` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            <div className="holder">
              <video
                playsInline
                preload="auto"
                poster={useUrl}
                onClick={(e) => {
                  e.stopPropagation()
                  try { e.preventDefault() } catch {}
                  const v = getVideoEl(i)
                  if (!v) return
                  if (!v.src) { playSlide(i); return }
                  if (v.paused) playSlide(i); else { try { v.pause() } catch {} }
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation()
                  try { e.preventDefault() } catch {}
                  const now = Date.now()
                  if (now - lastTouchTsRef.current < 300) return
                  lastTouchTsRef.current = now
                  const v = getVideoEl(i)
                  if (!v) return
                  if (!v.src) { playSlide(i); return }
                  if (v.paused) playSlide(i); else { try { v.pause() } catch {} }
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  background: 'transparent',
                  opacity: (playingIndex === i || startedMap[i]) ? 1 : 0,
                  transition: 'opacity .12s linear',
                  touchAction: 'manipulation' as any,
                }}
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
    const lockMs = 700
    setSmoothEnabled(false)
    setSnapEnabled(false)
    const until = Date.now() + lockMs
    ignoreScrollUntil.current = until
    ignoreIoUntil.current = until
    const id1 = requestAnimationFrame(() => {
      try { r.scrollTo({ top: targetTop, left: 0, behavior: 'auto' }) } catch { r.scrollTop = targetTop }
      setTimeout(() => {
        const slideEl2 = r.children[curIndex] as HTMLElement | undefined
        const targetTop2 = slideEl2 ? slideEl2.offsetTop : curIndex * getSlideHeight()
        try { r.scrollTo({ top: targetTop2, left: 0, behavior: 'auto' }) } catch { r.scrollTop = targetTop2 }
        setTimeout(() => {
          setSmoothEnabled(true)
          setSnapEnabled(true)
        }, Math.max(50, lockMs - 200))
      }, 180)
    })
    return () => cancelAnimationFrame(id1)
  }

  useEffect(() => {
    return reanchorToIndex(index) || undefined
  }, [isPortrait])

  useEffect(() => {
    const handler = () => { reanchorToIndex(index) }
    window.addEventListener('orientationchange', handler)
    return () => window.removeEventListener('orientationchange', handler)
  }, [index])

  useEffect(() => {
    const r = railRef.current
    if (!r) return
    const slidesEl = Array.from(r.children) as HTMLElement[]
    if (!slidesEl.length) return
    const io = new IntersectionObserver(
      (entries) => {
        const now = Date.now()
        if (now < ignoreIoUntil.current) return
        let best: IntersectionObserverEntry | null = null
        for (const e of entries) {
          if (!best || e.intersectionRatio > best.intersectionRatio) best = e
        }
        if (!best || best.target == null) return
        const idx = slidesEl.indexOf(best.target as HTMLElement)
        if (idx >= 0 && idx !== index) {
          setIndex(idx)
        }
        entries.forEach((e) => {
          const i = slidesEl.indexOf(e.target as HTMLElement)
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
    slidesEl.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [items, unlocked])

  useEffect(() => {
    const v = getVideoEl(index)
    if (!v) return
    attachAndPlay(index).catch(() => {})
  }, [index])

  const closeDrawer = () => {
    setDrawerOpen(false)
  }
  const openDrawer = (mode: 'nav' | 'spaces') => {
    setDrawerMode(mode)
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => setDrawerOpen(true))
    } else {
      setDrawerOpen(true)
    }
    if (mode === 'spaces') {
      loadSpaces(false)
    }
  }

  const handleSelectSpace = (spaceId: number) => {
    setFeedMode({ kind: 'space', spaceId })
    setDrawerOpen(false)
  }

  // Legacy feed removed

  const handleSelectGlobal = () => {
    setFeedMode({ kind: 'global' })
    setDrawerOpen(false)
  }

  const currentFeedLabel = useMemo(() => {
    if (feedMode.kind === 'space') {
      const match = flattenSpaces(spaceList).find((s) => s.id === feedMode.spaceId)
      return match ? match.name : 'Selected Space'
    }
    if (feedMode.kind === 'global') {
      return mineOnly ? 'My Global Feed' : 'Global Feed'
    }
    return mineOnly ? 'My Global Feed' : 'Global Feed'
  }, [feedMode, mineOnly, spaceList])

  const activeSpaceId = feedMode.kind === 'space' ? feedMode.spaceId : null

  const renderSpaceButton = (space: SpaceSummary, accent?: string) => {
    const active = activeSpaceId === space.id
    const badge =
      space.relationship === 'owner'
        ? 'Owner'
        : space.relationship === 'admin'
        ? 'Admin'
        : space.relationship === 'subscriber'
        ? 'Subscriber'
        : undefined
    return (
      <button
        key={space.id}
        onClick={() => handleSelectSpace(space.id)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '12px 14px',
          borderRadius: 10,
          marginBottom: 8,
          border: active ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(255,255,255,0.15)',
          background: active ? 'rgba(33,150,243,0.25)' : 'rgba(255,255,255,0.05)',
          color: '#fff',
          fontSize: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span>
          {space.name}
          {accent ? <span style={{ marginLeft: 6, fontSize: 12, color: accent }}>{accent}</span> : null}
        </span>
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          {badge}
          {space.subscribed && badge !== 'Subscriber' ? ' · Subscriber' : ''}
        </span>
      </button>
    )
  }

  const renderSpacesPanel = () => {
    if (!isAuthed) {
      return <div style={{ color: '#fff', fontSize: 15 }}>Login to switch spaces.</div>
    }
    const entries: JSX.Element[] = []
    // Global aggregator button
    entries.push(
      <button
        key="global"
        onClick={handleSelectGlobal}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '12px 14px',
          borderRadius: 10,
          marginBottom: 12,
          border: feedMode.kind === 'global' ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(255,255,255,0.15)',
          background: feedMode.kind === 'global' ? 'rgba(33,150,243,0.25)' : 'rgba(255,255,255,0.05)',
          color: '#fff',
          fontSize: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        Global
        <span style={{ fontSize: 12, opacity: 0.8 }}>Feed</span>
      </button>
    )
    // Optionally keep legacy archive for dev
    // entries.push(
    //   <button key="legacy" onClick={handleSelectLegacy} ...>Global Archive<span>Legacy</span></button>
    // )
    if (spaceList?.global) entries.push(renderSpaceButton(spaceList.global, 'Global'))
    if (spaceList?.personal) entries.push(renderSpaceButton(spaceList.personal, 'Personal'))
    if (spaceList?.groups?.length) {
      entries.push(
        <div key="groups-header" style={{ marginTop: 18, marginBottom: 6, fontWeight: 600, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.7 }}>
          Groups
        </div>
      )
      spaceList.groups.forEach((g) => entries.push(renderSpaceButton(g)))
    }
    if (spaceList?.channels?.length) {
      entries.push(
        <div key="channels-header" style={{ marginTop: 18, marginBottom: 6, fontWeight: 600, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.7 }}>
          Channels
        </div>
      )
      spaceList.channels.forEach((c) => entries.push(renderSpaceButton(c)))
    }
    if (!entries.length) {
      return <div style={{ color: '#fff', fontSize: 15 }}>No spaces yet.</div>
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {spacesLoading && <div style={{ color: '#fff', fontSize: 13, opacity: 0.7, marginBottom: 8 }}>Loading…</div>}
        {spacesError && <div style={{ color: '#ffb3b3', fontSize: 13, marginBottom: 8 }}>Failed to load spaces.</div>}
        {entries}
      </div>
    )
  }

  const navLinks = [
    { label: 'My Uploads', href: '/videos', enabled: true },
  ]

  const upcomingLinks = [
    { label: 'My Groups', note: 'Coming soon' },
    { label: 'My Channels', note: 'Coming soon' },
    { label: 'My Messages', note: 'Coming soon' },
  ]

  return (
    <div style={{ height: '100dvh', overflow: 'hidden', background: '#000' }}>
      <div
        onClick={(e) => {
          e.stopPropagation()
          if (drawerOpen) closeDrawer()
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          opacity: drawerOpen ? 1 : 0,
          transition: 'opacity 200ms ease',
          zIndex: 1000,
          pointerEvents: drawerOpen ? 'auto' : 'none',
        }}
      />
      <button
        aria-label={drawerOpen && drawerMode === 'nav' ? 'Close menu' : 'Open menu'}
        onClick={(e) => { e.stopPropagation(); drawerOpen && drawerMode === 'nav' ? closeDrawer() : openDrawer('nav') }}
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
        {drawerOpen && drawerMode === 'nav' ? (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5 L19 19 M19 5 L5 19" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
          </svg>
        ) : (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7 H20 M4 12 H20 M4 17 H20" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
          </svg>
        )}
      </button>
      <button
        aria-label={drawerOpen && drawerMode === 'spaces' ? 'Close space switcher' : 'Open space switcher'}
        onClick={(e) => { e.stopPropagation(); drawerOpen && drawerMode === 'spaces' ? closeDrawer() : openDrawer('spaces') }}
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          right: 8,
          zIndex: 1002,
          background: 'transparent',
          border: 'none',
          padding: 8,
          opacity: 0.9,
          touchAction: 'manipulation' as any,
        }}
      >
        {drawerOpen && drawerMode === 'spaces' ? (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5 L19 19 M19 5 L5 19" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
          </svg>
        ) : (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="4" width="6" height="6" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.8} fill="none" />
            <rect x="14" y="4" width="6" height="6" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.8} fill="none" />
            <rect x="4" y="14" width="6" height="6" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.8} fill="none" />
            <rect x="14" y="14" width="6" height="6" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.8} fill="none" />
          </svg>
        )}
      </button>
      <div
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
          left: '50%',
          transform: 'translateX(-50%)',
          color: '#fff',
          zIndex: 1001,
          fontSize: 14,
          padding: '6px 12px',
          borderRadius: 999,
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.2)',
        }}
      >
        {currentFeedLabel}
      </div>
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
          transform: drawerOpen ? 'translate3d(0,0,0)' : 'translate3d(-100%,0,0)',
          transition: 'transform 260ms cubic-bezier(0.25,1,0.5,1)',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          paddingLeft: 12,
          paddingRight: 12,
          boxShadow: drawerOpen ? '2px 0 12px rgba(0,0,0,0.5)' : 'none',
          pointerEvents: drawerOpen ? 'auto' : 'none',
          WebkitBackdropFilter: drawerOpen ? 'saturate(120%) blur(6px)' : undefined,
          backdropFilter: drawerOpen ? 'saturate(120%) blur(6px)' : undefined,
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {drawerMode === 'nav' ? (
          <>
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
            {isAuthed && (
              <div style={{ marginTop: 10, marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <input type="checkbox" checked={mineOnly} onChange={(e)=> setMineOnly(e.target.checked)} style={{ transform: 'scale(1.2)' }} />
                  Show only my videos
                </label>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  style={{
                    color: '#fff',
                    textDecoration: 'none',
                    fontSize: 16,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.04)',
                  }}
                >
                  {link.label}
                </a>
              ))}
              {upcomingLinks.map((item) => (
                <div
                  key={item.label}
                  style={{
                    fontSize: 15,
                    color: 'rgba(255,255,255,0.6)',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px dashed rgba(255,255,255,0.2)',
                    background: 'rgba(255,255,255,0.02)',
                  }}
                >
                  {item.label}
                  <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>({item.note})</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          renderSpacesPanel()
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
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
          scrollSnapType: snapEnabled ? 'y mandatory' as const : 'none' as const,
          scrollBehavior: smoothEnabled ? 'smooth' as const : 'auto' as const,
        }}
      >
        {slides.length ? slides : (
          <div style={{ color: '#fff', padding: 20 }}>
            {initialLoading ? 'Loading…' : 'No videos yet.'}
          </div>
        )}
      </div>
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
