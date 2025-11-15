import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FeedVideo from '../components/FeedVideo'
import SharedNav from '../ui/SharedNav'
import { prefetchForHref } from '../ui/routes'

type UploadItem = {
  id: number
  url: string
  posterPortrait?: string
  posterLandscape?: string
  masterPortrait?: string
  masterLandscape?: string
  // Stable, public video identifier (prefer production ULID; fallback to asset UUID)
  videoId?: string | null
  ownerId?: number | null
  ownerName?: string | null
  ownerEmail?: string | null
  publicationId?: number | null
  spaceId?: number | null
  publishedAt?: string | null
  likesCount?: number | null
  commentsCount?: number | null
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
  ulid?: string | null
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
  | { kind: 'space'; spaceId: number; spaceUlid?: string | null }

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
  const likesCount = typeof publication?.likes_count === 'number' ? Number(publication.likes_count) : null
  const commentsCount = typeof publication?.comments_count === 'number' ? Number(publication.comments_count) : null
  // Prefer production ULID; fallback to upload asset UUID; ensure string or null
  const productionUlid: string | null = publication?.production_ulid ? String(publication.production_ulid) : null
  const assetUuid: string | null = raw.asset_uuid ? String(raw.asset_uuid) : null
  const videoId: string | null = productionUlid || assetUuid || null
  return {
    id: Number(raw.id),
    url: masterPortrait || master,
    posterPortrait,
    posterLandscape,
    masterPortrait,
    masterLandscape,
    videoId,
    ownerId,
    ownerName,
    ownerEmail,
    publicationId,
    spaceId,
    publishedAt,
    likesCount,
    commentsCount,
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
  const FEED_DEBUG = true
  const dlog = (...args: any[]) => { try { if (FEED_DEBUG) console.log('[FEED]', ...args) } catch {} }
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
  // Note: individual slide videos are rendered via FeedVideo/HLSVideo; no shared video element
  const [isPortrait, setIsPortrait] = useState<boolean>(() => typeof window !== 'undefined' ? window.matchMedia && window.matchMedia('(orientation: portrait)').matches : true)
  const [posterAvail, setPosterAvail] = useState<Record<string, boolean>>({})
  const ignoreScrollUntil = useRef<number>(0)
  const ignoreIoUntil = useRef<number>(0)
  const reanchorTimerRef = useRef<number | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  // Default to 'auto' scroll-behavior for user gestures; enable smooth only during our programmatic jumps
  const [smoothEnabled, setSmoothEnabled] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [mineOnly, setMineOnly] = useState(false)
  const [myUserId, setMyUserId] = useState<number | null>(null)
  const [modalTime, setModalTime] = useState<number | null>(null)
  const [modalSrc, setModalSrc] = useState<string | null>(null)
  const playingIndexRef = useRef<number | null>(null)
  // hls.js lifecycle is managed inside HLSVideo; no per-index map needed here
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [startedMap, setStartedMap] = useState<Record<number, boolean>>({})
  const [pendingPlayIndex, setPendingPlayIndex] = useState<number | null>(null)
  // Likes state keyed by publicationId
  const [likesCountMap, setLikesCountMap] = useState<Record<number, number>>({})
  const [likedMap, setLikedMap] = useState<Record<number, boolean>>({})
  const [likeBusy, setLikeBusy] = useState<Record<number, boolean>>({})
  // Comments state
  const [commentsCountMap, setCommentsCountMap] = useState<Record<number, number>>({})
  const [commentedByMeMap, setCommentedByMeMap] = useState<Record<number, boolean>>({})
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentsForPub, setCommentsForPub] = useState<number | null>(null)
  const [commentsItems, setCommentsItems] = useState<Array<{ id: number; userId: number; displayName: string; email: string | null; body: string; createdAt: string }>>([])
  const [commentsCursor, setCommentsCursor] = useState<string | null>(null)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentRows, setCommentRows] = useState<number>(1)
  const commentsOrder: 'oldest' | 'newest' = 'oldest'
  // Who liked modal state
  const [likersOpen, setLikersOpen] = useState(false)
  const [likersForPub, setLikersForPub] = useState<number | null>(null)
  const [likersItems, setLikersItems] = useState<Array<{ userId: number; displayName: string; email: string | null; createdAt: string }>>([])
  const [likersCursor, setLikersCursor] = useState<string | null>(null)
  const [likersLoading, setLikersLoading] = useState(false)
  const lastTouchTsRef = useRef<number>(0)
  const touchStartYRef = useRef<number>(0)
  const touchStartTRef = useRef<number>(0)
  const touchLastYRef = useRef<number>(0)
  const touchLastTRef = useRef<number>(0)
  const suppressDurableRestoreRef = useRef<boolean>(false)
  const restoringRef = useRef<boolean>(false)
  const itemsFeedKeyRef = useRef<string>('')

  // ------- Durable per‑feed last‑active state (localStorage only; no URL hash) -------
  type LastActive = {
    feedItemId: number | null
    videoId: string | null
    positionMs: number | null
    sortKey: string | null
    index: number
    updatedAt: number
    version: number
  }
  const LAST_ACTIVE_VER = 2
  const FEED_LAST_PREFIX = 'feed:last:v2:'
  const VIDEO_LAST_PREFIX = 'video:last:v1:'
  const LAST_FEED_KEY = 'feed:last:current'

  function userKeyPrefix(): string {
    return myUserId != null ? `u:${myUserId}|` : ''
  }

  function getCsrfToken(): string | null {
    try {
      const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/)
      return m ? decodeURIComponent(m[1]) : null
    } catch { return null }
  }

  async function ensureLikeSummary(publicationId: number | null | undefined) {
    if (!publicationId || !isAuthed) return
    if (likesCountMap[publicationId] != null && likedMap[publicationId] != null) return
    try {
      const res = await fetch(`/api/publications/${publicationId}/likes`, { credentials: 'same-origin' })
      if (!res.ok) return
      const data = await res.json()
      setLikesCountMap((m) => ({ ...m, [publicationId]: Number(data?.count ?? 0) }))
      setLikedMap((m) => ({ ...m, [publicationId]: Boolean(data?.liked) }))
    } catch {}
  }

  function ensureCommentCountHydrated(pubId: number | null | undefined, fallback?: number | null) {
    if (!pubId) return
    if (commentsCountMap[pubId] != null) return
    if (typeof fallback === 'number') {
      setCommentsCountMap((m) => ({ ...m, [pubId]: fallback }))
    }
  }

  async function openComments(pubId: number | null | undefined) {
    if (!pubId) return
    setCommentsOpen(true)
    setCommentsForPub(pubId)
    setCommentsItems([])
    setCommentsCursor(null)
    await loadMoreComments(pubId)
  }

  async function loadMoreComments(pubId?: number | null) {
    const publicationId = pubId ?? commentsForPub
    if (!publicationId) return
    if (commentsLoading) return
    setCommentsLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50', order: commentsOrder })
      if (commentsCursor) params.set('cursor', commentsCursor)
      const res = await fetch(`/api/publications/${publicationId}/comments?${params.toString()}`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('comments_fetch_failed')
      const data = await res.json()
      const items = Array.isArray(data?.items) ? data.items : []
      const mapped = items.map((c: any) => ({ id: Number(c.id), userId: Number(c.userId), displayName: String(c.displayName || ''), email: c.email ?? null, body: String(c.body || ''), createdAt: String(c.createdAt || '') }))
      setCommentsItems((prev) => prev.concat(mapped))
      setCommentsCursor(typeof data?.nextCursor === 'string' && data.nextCursor.length ? data.nextCursor : null)
      if (myUserId != null && mapped.some((c) => c.userId === myUserId)) {
        setCommentedByMeMap((m) => ({ ...m, [publicationId]: true }))
      }
    } catch {}
    finally {
      setCommentsLoading(false)
    }
  }

  async function submitComment() {
    const pubId = commentsForPub
    if (!pubId) return
    if (!isAuthed) { try { alert('Please sign in to comment.') } catch {} ; return }
    const txt = commentText.trim()
    if (!txt) return
    if (commentBusy) return
    setCommentBusy(true)
    const csrf = getCsrfToken()
    // Optimistic: increment visible counter immediately
    const prevCount = commentsCountMap[pubId]
    setCommentsCountMap((m) => ({ ...m, [pubId]: (m[pubId] ?? 0) + 1 }))
    try {
      const res = await fetch(`/api/publications/${pubId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify({ body: txt }),
      })
      if (!res.ok) throw new Error('comment_failed')
      const created = await res.json()
      // Prepend to list when oldest-first by reloading; simplest is to reload from start
      setCommentsItems([])
      setCommentsCursor(null)
      setCommentText('')
      try { (document.activeElement as any)?.blur?.() } catch {}
      // After successful post, collapse composer back to 1 line
      setCommentRows(1)
      await loadMoreComments(pubId)
      setCommentedByMeMap((m) => ({ ...m, [pubId]: true }))
    } catch (e) {
      // Roll back optimistic increment
      setCommentsCountMap((m) => ({ ...m, [pubId]: prevCount != null ? prevCount : Math.max(0, (m[pubId] ?? 1) - 1) }))
    }
    finally {
      setCommentBusy(false)
    }
    // Roll back on failure: if last request failed, decrement back to previous
    // Note: since failures land in catch, use response.ok guard above. Here we can’t inspect,
    // so we conservatively align count with server by refetching if needed later.
    // Minimal rollback: if request threw, we should have left the try early.
    // We detect this by checking commentsItems unchanged and cursor unchanged would be complex;
    // simpler approach: wrap try/catch and rollback within catch.
  }

  async function toggleLike(publicationId: number | null | undefined) {
    if (!publicationId) return
    if (!isAuthed) { try { alert('Please sign in to like videos.') } catch {} ; return }
    if (likeBusy[publicationId]) return
    const currentlyLiked = !!likedMap[publicationId]
    const csrf = getCsrfToken()
    setLikeBusy((b) => ({ ...b, [publicationId]: true }))
    // Optimistic update
    setLikedMap((m) => ({ ...m, [publicationId]: !currentlyLiked }))
    setLikesCountMap((m) => ({ ...m, [publicationId]: Math.max(0, (m[publicationId] ?? 0) + (currentlyLiked ? -1 : 1)) }))
    try {
      const method = currentlyLiked ? 'DELETE' : 'POST'
      const res = await fetch(`/api/publications/${publicationId}/likes`, {
        method,
        headers: { ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('like_toggle_failed')
      const data = await res.json()
      setLikesCountMap((m) => ({ ...m, [publicationId]: Number(data?.count ?? (m[publicationId] ?? 0)) }))
      setLikedMap((m) => ({ ...m, [publicationId]: Boolean(data?.liked) }))
    } catch {
      // Rollback on error
      setLikedMap((m) => ({ ...m, [publicationId]: currentlyLiked }))
      setLikesCountMap((m) => ({ ...m, [publicationId]: Math.max(0, (m[publicationId] ?? 0) + (currentlyLiked ? 1 : -1)) }))
    } finally {
      setLikeBusy((b) => ({ ...b, [publicationId]: false }))
    }
  }

  async function openLikers(publicationId: number | null | undefined) {
    if (!publicationId) return
    setLikersOpen(true)
    setLikersForPub(publicationId)
    setLikersItems([])
    setLikersCursor(null)
    await loadMoreLikers(publicationId)
  }

  async function loadMoreLikers(publicationId?: number | null) {
    const pubId = publicationId ?? likersForPub
    if (!pubId) return
    if (likersLoading) return
    setLikersLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (likersCursor) params.set('cursor', likersCursor)
      const res = await fetch(`/api/publications/${pubId}/likes/users?${params.toString()}`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('likers_fetch_failed')
      const data = await res.json()
      const items = Array.isArray(data?.items) ? data.items : []
      setLikersItems((prev) => prev.concat(items))
      setLikersCursor(typeof data?.nextCursor === 'string' && data.nextCursor.length ? data.nextCursor : null)
    } catch {}
    finally {
      setLikersLoading(false)
    }
  }
  // We no longer read URL hash fragments for deep linking

  function feedStorageKey(m: FeedMode): string { return userKeyPrefix() + FEED_LAST_PREFIX + feedKey(m) }

  function computeSlideId(it: UploadItem): string {
    const vid = (it as any).videoId ? String((it as any).videoId) : null
    const pubId = it.publicationId != null ? String(it.publicationId) : null
    return vid ? `v-${vid}` : (pubId ? `p-${pubId}` : `u-${it.id}`)
  }

  function saveLastActiveFor(m: FeedMode, idx: number) {
    if (typeof window === 'undefined') return
    // Require user and stable feed identity to avoid stray keys
    if (myUserId == null) return
    if (m.kind === 'space' && !(m.spaceUlid && m.spaceUlid.length)) return // require ULID for feed key
    // Don't persist while restoring/re-anchoring or if feed items don't match the current feed key
    if (restoringRef.current) { return }
    const currentFeedKey = feedKey(m)
    if (!currentFeedKey || !itemsFeedKeyRef.current || currentFeedKey !== itemsFeedKeyRef.current) {
      return
    }
    const it = items[idx]
    if (!it) return
    // Extra guard: ensure the item belongs to the active space when saving for a space feed
    if (m.kind === 'space' && it.spaceId != null && it.spaceId !== m.spaceId) {
      return
    }
    let positionMs: number | null = null
    try {
      const raw = Math.floor((getVideoEl(idx)?.currentTime || 0) * 1000)
      positionMs = raw > 500 ? raw : null // store only when >0.5s to avoid noise
    } catch { positionMs = null }
    const sortKey = it.publishedAt ? `${it.publishedAt}#${it.publicationId ?? it.id}` : null
    const rec: LastActive = {
      feedItemId: it.publicationId ?? null,
      videoId: (it as any).videoId ? String((it as any).videoId) : null,
      positionMs,
      sortKey,
      index: idx,
      updatedAt: Date.now(),
      version: LAST_ACTIVE_VER,
    }
    try { localStorage.setItem(feedStorageKey(m), JSON.stringify(rec)); dlog('saveLastActive', { key: feedStorageKey(m), idx, positionMs }) } catch {}
  }

  function readLastActive(m: FeedMode): LastActive | null {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(feedStorageKey(m)) : null
      dlog('readLastActive', { key: feedStorageKey(m), present: Boolean(raw) })
      if (!raw) return null
      const obj = JSON.parse(raw)
      if (!obj || typeof obj !== 'object') return null
      return obj as LastActive
    } catch { return null }
  }

  function readVideoProgress(videoId: string | null | undefined): number | null {
    if (!videoId) return null
    try {
      const raw = localStorage.getItem(userKeyPrefix() + VIDEO_LAST_PREFIX + videoId)
      if (!raw) return null
      const n = Number(raw)
      return Number.isFinite(n) && n >= 0 ? n : null
    } catch { return null }
  }

  function writeLastFeed(spaceUlid: string | null | undefined) {
    if (!spaceUlid) return
    try { localStorage.setItem(userKeyPrefix() + LAST_FEED_KEY, `s:${spaceUlid}`); dlog('writeLastFeed', { value: `s:${spaceUlid}` }) } catch {}
  }
  function writeLastFeedGlobal() {
    try { localStorage.setItem(userKeyPrefix() + LAST_FEED_KEY, 'g'); dlog('writeLastFeed', { value: 'g' }) } catch {}
  }
  function readLastFeed(): string | null {
    try {
      const key = userKeyPrefix() + LAST_FEED_KEY
      const raw = localStorage.getItem(key)
      dlog('readLastFeed', { key, value: raw })
      if (!raw) return null
      return String(raw)
    } catch { return null }
  }

  const spacesStatusRef = useRef<{ loading: boolean; loaded: boolean }>({ loading: false, loaded: false })

  // ------- Per‑feed UI snapshot cache to avoid visible rewind on revisit -------
  type FeedSnapshot = { items: UploadItem[]; cursor: string | null; index: number; scrollTop: number; savedAt: number; anchorId: number | null }
  // Snapshot TTL (ms) can be configured via Vite env: VITE_FEED_SNAPSHOT_TTL_MS
  const SNAPSHOT_TTL_MS = (() => {
    try {
      const raw = (import.meta as any)?.env?.VITE_FEED_SNAPSHOT_TTL_MS
      const n = typeof raw === 'string' ? Number(raw) : undefined
      return Number.isFinite(n) && (n as number) > 0 ? (n as number) : 5 * 60 * 1000
    } catch { return 5 * 60 * 1000 }
  })()
  const SNAPSHOT_MAX = 8
  const snapshotsRef = useRef<Map<string, FeedSnapshot>>(new Map())
  const restoredRef = useRef<boolean>(false)
  const [restoring, setRestoring] = useState<boolean>(false)
  const [restorePoster, setRestorePoster] = useState<string | null>(null)
  const firstVisitKeyRef = useRef<string | null>(null)
  const didInitLastFeedRef = useRef<boolean>(false)
  const initialSpaceFromQuery = useRef<number | null>((() => {
    try {
      const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
      const v = Number(sp.get('space'))
      return Number.isFinite(v) && v > 0 ? v : null
    } catch { return null }
  })())
  const initialSpaceUlidFromQuery = useRef<string | null>((() => {
    try {
      const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
      const raw = sp.get('spaceUlid')
      return raw && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(raw) ? raw : null
    } catch { return null }
  })())

  function feedKey(m: FeedMode): string {
    if (m.kind === 'space') {
      const key = m.spaceUlid && typeof m.spaceUlid === 'string' && m.spaceUlid.length ? m.spaceUlid : ''
      return key ? `s:${key}` : 's:pending'
    }
    return 'g'
  }

  function hasSnapshot(mode: FeedMode): boolean {
    const key = feedKey(mode)
    const snap = snapshotsRef.current.get(key)
    return !!(snap && (Date.now() - snap.savedAt <= SNAPSHOT_TTL_MS))
  }

  function trimItems(src: UploadItem[], anchor: number): UploadItem[] {
    const MAX = 150
    if (src.length <= MAX) return src.slice()
    const half = Math.floor(MAX / 2)
    const start = Math.max(0, Math.min(src.length - MAX, anchor - half))
    return src.slice(start, start + MAX)
  }

  function saveSnapshot() {
    const key = feedKey(feedMode)
    const r = railRef.current
    if (!r || !items.length) return
    const kept = trimItems(items, index)
    const anchorItem = items[index]
    const anchorId = anchorItem ? (anchorItem.publicationId ?? anchorItem.id) : null
    let newIndex = Math.min(index, kept.length - 1)
    if (anchorId != null) {
      const found = kept.findIndex((it) => (it.publicationId ?? it.id) === anchorId)
      if (found >= 0) newIndex = found
    }
    const snap: FeedSnapshot = { items: kept, cursor, index: newIndex, scrollTop: r.scrollTop, savedAt: Date.now(), anchorId }
    const map = snapshotsRef.current
    map.set(key, snap)
    while (map.size > SNAPSHOT_MAX) {
      const firstKey = map.keys().next().value as string | undefined
      if (!firstKey) break
      map.delete(firstKey)
    }
  }

  function tryRestoreFor(mode: FeedMode): boolean {
    const key = feedKey(mode)
    const snap = snapshotsRef.current.get(key)
    if (!snap) return false
    if (Date.now() - snap.savedAt > SNAPSHOT_TTL_MS) return false
    setItems(snap.items)
    setCursor(snap.cursor)
    setIndex(Math.max(0, Math.min(snap.index, snap.items.length - 1)))
    const until = Date.now() + 700
    ignoreScrollUntil.current = until
    ignoreIoUntil.current = until
    // Reanchor by index using layout timing and show a poster overlay to prevent flashes
    const anchor = snap.items[Math.max(0, Math.min(snap.index, snap.items.length - 1))]
    const poster = (isPortrait ? (anchor?.posterPortrait || anchor?.posterLandscape) : (anchor?.posterLandscape || anchor?.posterPortrait)) || null
    setRestorePoster(poster)
    setRestoring(true)
    requestAnimationFrame(() => {
      const targetIndex = Math.max(0, Math.min(snap.index, snap.items.length - 1))
      try { reanchorToIndex(targetIndex) } catch {}
      const v = getVideoEl(targetIndex)
      let doneOnce = false
      const done = () => {
        if (doneOnce) return; doneOnce = true
        setRestoring(false)
        setRestorePoster(null)
        if (v) {
          try { v.removeEventListener('playing', done) } catch {}
          try { v.removeEventListener('loadeddata', done) } catch {}
        }
      }
      if (v) {
        try { v.addEventListener('playing', done, { once: true } as any) } catch { try { v.addEventListener('playing', done) } catch {} }
        try { v.addEventListener('loadeddata', done, { once: true } as any) } catch { try { v.addEventListener('loadeddata', done) } catch {} }
      }
      // Fallback timeout in case events don’t fire
      setTimeout(done, 900)
    })
    setInitialLoading(false)
    restoredRef.current = true
    return true
  }

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
      dlog('spaces loaded', {
        personal: Boolean(data.personal),
        global: Boolean(data.global),
        groups: Array.isArray(data.groups) ? data.groups.length : 0,
        channels: Array.isArray(data.channels) ? data.channels.length : 0,
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
    // If URL specifies ?space=ID, set initial feed to that space once
    if (initialSpaceFromQuery.current && feedMode.kind === 'global') {
      const sid = initialSpaceFromQuery.current
      initialSpaceFromQuery.current = null
      if (sid && Number.isFinite(sid)) {
        const match = flattenSpaces(spaceList).find((s) => s.id === sid)
        const spaceUlid = match?.ulid ?? null
        setFeedMode({ kind: 'space', spaceId: sid, spaceUlid })
        // Clean the query param to avoid lingering state on refresh
        try {
          const url = new URL(window.location.href)
          url.searchParams.delete('space')
          window.history.replaceState({}, '', url.toString())
        } catch {}
      }
    }
    // If URL specifies ?spaceUlid=ULID, resolve via loaded space list and set feed
    if (initialSpaceUlidFromQuery.current && feedMode.kind === 'global') {
      const su = initialSpaceUlidFromQuery.current
      const match = flattenSpaces(spaceList).find((s) => (s.ulid || '') === su)
      if (match) {
        initialSpaceUlidFromQuery.current = null
        setFeedMode({ kind: 'space', spaceId: match.id, spaceUlid: match.ulid || null })
        // Clean the query param to avoid lingering state on refresh
        try {
          const url = new URL(window.location.href)
          url.searchParams.delete('spaceUlid')
          window.history.replaceState({}, '', url.toString())
        } catch {}
      }
    }
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
        try { console.log('[FEED] me loaded', { userId: data.userId }) } catch {}
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

  // If feedMode lacks spaceUlid but list is available, enrich it
  useEffect(() => {
    if (feedMode.kind !== 'space') return
    if (feedMode.spaceUlid && feedMode.spaceUlid.length) return
    const match = flattenSpaces(spaceList).find((s) => s.id === feedMode.spaceId)
    if (match?.ulid) {
      setFeedMode({ kind: 'space', spaceId: feedMode.spaceId, spaceUlid: match.ulid })
    }
  }, [feedMode, spaceList])

  // Always persist last selected feed on mode change, but only after initial startup restore attempt.
  useEffect(() => {
    if (!didInitLastFeedRef.current) return
    if (myUserId == null) return
    if (feedMode.kind === 'global') {
      writeLastFeedGlobal()
    } else if (feedMode.spaceUlid && feedMode.spaceUlid.length) {
      writeLastFeed(feedMode.spaceUlid)
    }
  }, [feedMode.kind, feedMode.spaceUlid])

  // On startup only, restore last selected feed (user-scoped) once user and spaces are ready.
  useEffect(() => {
    try {
      if (didInitLastFeedRef.current) return
      if (myUserId == null) return
      if (!spaceList) return
      // Only act when URL does not specify a space and we are currently on global
      const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
      const hasSpaceParam = Boolean(sp.get('space') || sp.get('spaceUlid'))
      if (feedMode.kind !== 'global' || hasSpaceParam) { didInitLastFeedRef.current = true; return }
      const last = readLastFeed()
      didInitLastFeedRef.current = true
      if (!last || !last.startsWith('s:')) return
      const ulid = last.slice(2)
      const match = flattenSpaces(spaceList).find((s) => (s.ulid || '') === ulid)
      if (!match) return
      dlog('startup restore to space', { ulid, spaceId: match.id })
      setFeedMode({ kind: 'space', spaceId: match.id, spaceUlid: match.ulid || null })
    } catch {}
  }, [spaceList, myUserId, feedMode.kind])

  useEffect(() => {
    let canceled = false
    const load = async () => {
      // Ensure user identity is known so durable restore can read user‑scoped keys
      if (myUserId == null) return
      // Fast restore path: reuse prior UI state when available to avoid visible rewind
      if (!canceled && tryRestoreFor(feedMode)) {
        return
      }
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
        // Tag the feed key for which these items belong so we can guard saves
        itemsFeedKeyRef.current = feedKey(feedMode)
        setItems(fetchedItems)
        setCursor(nextCursor)
        // Determine initial index: URL hash > localStorage > default 0
        let targetIndex = 0
        let seekMs: number | null = null
        if (!suppressDurableRestoreRef.current) {
          const last = readLastActive(feedMode)
          if (last) {
            const iPub = last.feedItemId != null ? fetchedItems.findIndex((it) => (it.publicationId ?? null) === last.feedItemId) : -1
            let iVid = -1
            if (iPub < 0 && last.videoId) iVid = fetchedItems.findIndex((it) => ((it as any).videoId ?? null) === last.videoId)
            const found = iPub >= 0 ? iPub : iVid
            if (found >= 0) {
              targetIndex = found
              seekMs = (last.positionMs != null && last.positionMs > 0) ? last.positionMs : null
            }
          }
        }
        // Begin restore cycle to suppress premature saves during reanchor
        restoringRef.current = true
        setIndex(targetIndex)
        const fk = firstVisitKeyRef.current
        if (fk && fk === feedKey(feedMode)) {
          const anchor = fetchedItems[Math.max(0, Math.min(targetIndex, fetchedItems.length - 1))]
          const poster = (isPortrait ? (anchor?.posterPortrait || anchor?.posterLandscape) : (anchor?.posterLandscape || anchor?.posterPortrait)) || null
          setRestorePoster(poster)
          // Ensure snap/smooth are disabled before the next paint
          disableSnapNow()
          restoringRef.current = true
          setRestoring(true)
          requestAnimationFrame(() => {
            try { reanchorToIndex(targetIndex) } catch {}
            const v = getVideoEl(targetIndex)
            let doneOnce = false
            const done = () => {
              if (doneOnce) return; doneOnce = true
              setRestoring(false)
              restoringRef.current = false
              setRestorePoster(null)
              setSnapEnabled(true)
              setSmoothEnabled(true)
              firstVisitKeyRef.current = null
            }
            if (v) {
              try { v.addEventListener('playing', done, { once: true } as any) } catch { try { v.addEventListener('playing', done) } catch {} }
              try { v.addEventListener('loadeddata', done, { once: true } as any) } catch { try { v.addEventListener('loadeddata', done) } catch {} }
              if (seekMs && seekMs > 0) {
                const applySeek = () => {
                  try { v.currentTime = Math.max(0, seekMs! / 1000) } catch {}
                  v.removeEventListener('loadedmetadata', applySeek)
                }
                try { v.addEventListener('loadedmetadata', applySeek, { once: true } as any) } catch { try { v.addEventListener('loadedmetadata', applySeek) } catch {} }
                // If metadata already loaded, apply immediately
                try { if ((v as any).readyState >= 1) applySeek() } catch {}
              }
            }
            setTimeout(done, 900)
          })
        } else {
          // Use the same controlled reanchor flow even when firstVisitKeyRef is not set
          disableSnapNow()
          restoringRef.current = true
          requestAnimationFrame(() => {
            try { reanchorToIndex(targetIndex) } catch {}
            if (seekMs && seekMs > 0) {
              const v = getVideoEl(targetIndex)
              if (v) {
                const applySeek = () => {
                  try { v.currentTime = Math.max(0, seekMs! / 1000) } catch {}
                  v.removeEventListener('loadedmetadata', applySeek)
                }
                try { v.addEventListener('loadedmetadata', applySeek, { once: true } as any) } catch { try { v.addEventListener('loadedmetadata', applySeek) } catch {} }
                try { if ((v as any).readyState >= 1) applySeek() } catch {}
              }
            }
            // End restore shortly after reanchor/seek has been scheduled
            setTimeout(() => { restoringRef.current = false }, 400)
          })
        }
        // Allow durable restore again after this load cycle
        suppressDurableRestoreRef.current = false
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

  // HLS selection is handled inside HLSVideo; keep UA helpers locally if needed later

  function pauseNonCurrent(targetIndex: number) {
    try {
      const r = railRef.current
      if (!r) return
      const currentEl = getVideoEl(targetIndex)
      const videos = Array.from(r.querySelectorAll('video')) as HTMLVideoElement[]
      for (const el of videos) {
        if (currentEl && el === currentEl) continue
        try { el.pause() } catch {}
      }
    } catch {}
  }

  // Prewarm and playback are handled by FeedVideo/HLSVideo; keep pauseNonCurrent for index changes.

  function getSlideHeight(): number {
    const r = railRef.current
    const slide = r?.firstElementChild as HTMLElement | null
    const h = slide?.clientHeight || r?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 0)
    return Math.max(1, h)
  }

  // HLSVideo handles attaching source on Safari and via hls.js elsewhere

  // No URL hash syncing (clean URLs)

  // Persist last-active on index changes (in addition to scroll handler)
  useEffect(() => {
    try { saveLastActiveFor(feedMode, index) } catch {}
  }, [index])

  // Shared attachAndPlay path removed; each slide owns its <video>

  // Warm-up handled inside HLSVideo via `warm` prop; ensure only active video plays

  // Ensure only the active slide's video is playing; pause others on index change
  useEffect(() => {
    const r = railRef.current
    if (!r) return
    const current = getVideoEl(index)
    try {
      const videos = Array.from(r.querySelectorAll('video')) as HTMLVideoElement[]
      for (const el of videos) {
        if (el !== current) {
          try { el.pause() } catch {}
        }
      }
    } catch {}
  }, [index])

  // Track playing state and mark started for fade-in
  useEffect(() => {
    const v = getVideoEl(index)
    if (!v) return
    const onPlaying = () => {
      playingIndexRef.current = index
      setPlayingIndex(index)
      setStartedMap((prev) => (prev[index] ? prev : { ...prev, [index]: true }))
      // If we had a pending play intent for this index, clear it
      setPendingPlayIndex((p) => (p === index ? null : p))
    }
    const onPause = () => { if (playingIndexRef.current === index) setPlayingIndex(null) }
    const onEnded = onPause
    try {
      v.addEventListener('playing', onPlaying)
      v.addEventListener('pause', onPause)
      v.addEventListener('ended', onEnded)
    } catch {}
    return () => {
      try {
        v.removeEventListener('playing', onPlaying)
        v.removeEventListener('pause', onPause)
        v.removeEventListener('ended', onEnded)
      } catch {}
    }
  }, [index, items])

  // Fulfill pending play intent when a slide becomes ready
  useEffect(() => {
    if (pendingPlayIndex == null) return
    const v = getVideoEl(pendingPlayIndex)
    if (!v) return
    const tryPlay = () => {
      try {
        v.muted = false
        const p = v.play()
        if (p && typeof p.then === 'function') {
          p.then(() => setPendingPlayIndex((cur) => (cur === pendingPlayIndex ? null : cur))).catch(() => {})
        } else {
          setPendingPlayIndex((cur) => (cur === pendingPlayIndex ? null : cur))
        }
      } catch {}
    }
    if (v.readyState >= 2) {
      tryPlay()
      return
    }
    const onReady = () => { tryPlay() }
    try { v.addEventListener('loadeddata', onReady, { once: true } as any) } catch { try { v.addEventListener('loadeddata', onReady) } catch {} }
    return () => { try { v.removeEventListener('loadeddata', onReady) } catch {} }
  }, [pendingPlayIndex, index, items])

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
    const cur = modalTime || 0
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

  // Modal playback is managed via FeedVideo/HLSVideo when open

  const unlock = () => {
    if (unlocked) return
    // Unmute and attempt to play the current video
    try {
      const v = getVideoEl(index)
      if (v) { v.muted = false; void v.play() }
    } catch {}
    setUnlocked(true)
  }

  const onScroll = () => {
    const r = railRef.current
    if (!r) return
    const now = Date.now()
    if (now < ignoreScrollUntil.current) return
    const y = r.scrollTop
    const h = getSlideHeight()
    // Commit slightly earlier than halfway to make smaller motion page sooner
    const i = Math.max(0, Math.min(items.length - 1, Math.floor((y + h * 0.4) / h)))
    if (i !== index) {
      setIndex(i)
      schedulePersist(i)
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
    // Debounced finalize: after scrolling settles, force a quick reanchor to the nearest slide
    try { if (reanchorTimerRef.current) window.clearTimeout(reanchorTimerRef.current) } catch {}
    reanchorTimerRef.current = window.setTimeout(() => {
      const rr = railRef.current
      if (!rr) return
      const y2 = rr.scrollTop
      const h2 = getSlideHeight()
      const target = Math.max(0, Math.min(items.length - 1, Math.round(y2 / h2)))
      disableSnapNow()
      reanchorToIndex(target)
      pauseNonCurrent(target)
    }, 90)
  }

  const slides = useMemo(
    () =>
      items.map((it, i) => {
        const desired = isPortrait ? it.posterPortrait : it.posterLandscape
        const fallback = isPortrait ? it.posterLandscape : it.posterPortrait
        const useUrl =
          (desired && posterAvail[desired] !== false ? desired : undefined) ||
          (fallback && posterAvail[fallback] !== false ? fallback : undefined)
        // Derive stable attributes for DOM anchoring and analytics
        const vid = (it as any).videoId ? String((it as any).videoId) : null
        const pubId = it.publicationId != null ? String(it.publicationId) : null
        const slideId = vid ? `v-${vid}` : (pubId ? `p-${pubId}` : `u-${it.id}`)
        // TEMP DEBUG: render decision
        try { console.log('[Feed] render slide', { i, slideId, active: i === index, warm: i === index + 1, portrait: isPortrait }) } catch {}
        const manifestSrc = isPortrait ? (it.masterPortrait || it.url) : (it.masterLandscape || it.url)
        const isActive = i === index
        const isWarm = i === index + 1
        const isPrewarm = i === index + 2
        const isLinger = i === index - 1
        return (
          <div
            key={slideId}
            className="slide"
            id={slideId}
            data-video-id={vid || undefined}
            data-publication-id={pubId || undefined}
            data-upload-id={String(it.id)}
            style={{ backgroundImage: useUrl ? `url('${useUrl}')` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            <div className="holder">
              {(isActive || isWarm || isPrewarm || isLinger) ? (
                <FeedVideo
                  src={manifestSrc}
                  active={isActive}
                  warm={isWarm || isPrewarm || isLinger}
                  warmMode={isActive ? 'none' : (isWarm ? 'buffer' : 'attach')}
                  muted={false}
                  poster={useUrl}
                  data-video-id={vid || undefined}
                  onTouchStart={(e) => {
                    try {
                      const t = e.touches && e.touches[0]
                      if (t) {
                        touchStartYRef.current = t.clientY
                        touchLastYRef.current = t.clientY
                        const nowTs = Date.now()
                        touchStartTRef.current = nowTs
                        touchLastTRef.current = nowTs
                      }
                    } catch {}
                  }}
                  onTouchMove={(e) => {
                    try {
                      const t = e.touches && e.touches[0]
                      if (t) {
                        touchLastYRef.current = t.clientY
                        touchLastTRef.current = Date.now()
                      }
                    } catch {}
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    try { if ((e as any).cancelable) e.preventDefault() } catch {}
                    // Avoid duplicate handling when touch just fired
                    try { if (Date.now() - lastTouchTsRef.current < 350) return } catch {}
                    const v = getVideoEl(i)
                    if (i !== index) {
                      // Treat as intent: make it active and play when ready
                      setPendingPlayIndex(i)
                      try { disableSnapNow() } catch {}
                      try { setIndex(i); reanchorToIndex(i) } catch { try { setIndex(i) } catch {} }
                      return
                    }
                    if (!v) { setPendingPlayIndex(i); return }
                    if (!unlocked) setUnlocked(true)
                    try {
                      // TEMP DEBUG: click toggle
                      console.log('[Feed] click video toggle', { i, wasPaused: v.paused, ended: v.ended, currentSrc: (v as any).currentSrc, src: v.getAttribute('src') })
                      if (v.paused || v.ended) {
                        // Optimistically mark started so opacity flips immediately
                        setStartedMap((prev) => (prev[i] ? prev : { ...prev, [i]: true }))
                        setPlayingIndex(i)
                        v.muted = false
                        const p = v.play()
                        if (p && typeof p.then === 'function') {
                          p.catch(() => { setPendingPlayIndex(i) })
                        }
                      } else {
                        v.pause()
                      }
                    } catch {}
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation()
                    try { if ((e as any).cancelable) e.preventDefault() } catch {}
                    const now = Date.now()
                    if (now - lastTouchTsRef.current < 300) return
                    lastTouchTsRef.current = now
                    // Detect a small, decisive swipe to page-step
                    const dy = touchLastYRef.current - touchStartYRef.current // +down, -up
                    const dt = Math.max(1, touchLastTRef.current - touchStartTRef.current)
                    const vmag = Math.abs(dy) / dt // px/ms
                    const SWIPE_DIST = 14
                    const SWIPE_VEL = 0.5
                    if (dy < -SWIPE_DIST || (dy < 0 && vmag > SWIPE_VEL)) {
                      if (i < items.length - 1) {
                        try { disableSnapNow(); reanchorToIndex(i + 1) } catch {}
                        return
                      }
                    } else if (dy > SWIPE_DIST || (dy > 0 && vmag > SWIPE_VEL)) {
                      if (i > 0) {
                        try { disableSnapNow(); reanchorToIndex(i - 1) } catch {}
                        return
                      }
                    }
                    const v = getVideoEl(i)
                    if (i !== index) {
                      setPendingPlayIndex(i)
                      try { disableSnapNow() } catch {}
                      try { setIndex(i); reanchorToIndex(i) } catch { try { setIndex(i) } catch {} }
                      return
                    }
                    if (!v) { setPendingPlayIndex(i); return }
                    if (!unlocked) setUnlocked(true)
                    try {
                      // TEMP DEBUG: touch toggle
                      console.log('[Feed] touch video toggle', { i, wasPaused: v.paused, ended: v.ended, currentSrc: (v as any).currentSrc, src: v.getAttribute('src') })
                      if (v.paused || v.ended) {
                        setStartedMap((prev) => (prev[i] ? prev : { ...prev, [i]: true }))
                        setPlayingIndex(i)
                        v.muted = false
                        const p = v.play()
                        if (p && typeof p.then === 'function') {
                          p.catch(() => { setPendingPlayIndex(i) })
                        }
                      } else {
                        v.pause()
                      }
                    } catch {}
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
              ) : (
                // Placeholder holder without a video element; clicking will reanchor and mount HLSVideo
                <div
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  onClick={(e) => { e.stopPropagation(); setPendingPlayIndex(i); try { disableSnapNow(); setIndex(i); reanchorToIndex(i) } catch { try { setIndex(i) } catch {} } }}
                />
              )}
              {/* Like and Comment controls (always visible, right side) */}
              {it.publicationId != null && (
                <div
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: '40%',
                    transform: 'translateY(-50%)',
                    display: 'grid',
                    gap: 12,
                    alignItems: 'center',
                    justifyItems: 'center',
                    zIndex: 5,
                  }}
                >
                  <div style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
                    <button
                      aria-label={likedMap[it.publicationId] ? 'Unlike' : 'Like'}
                      aria-pressed={likedMap[it.publicationId] ? true : false}
                      onClick={(e) => { e.stopPropagation(); ensureLikeSummary(it.publicationId); toggleLike(it.publicationId) }}
                      disabled={!!likeBusy[it.publicationId]}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        margin: 0,
                        display: 'grid',
                        placeItems: 'center',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      {likedMap[it.publicationId] ? (
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="#e53935" stroke="#e53935" strokeWidth="1.5" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12.1 21.35l-1.1-1.02C5.14 15.24 2 12.36 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.86-3.14 6.74-8.9 11.83l-1 1.02z" />
                        </svg>
                      ) : (
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" xmlns="http://www.w3.org/2000/svg">
                          <path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.86 3.14 6.74 8.9 11.83l1.1 1.02 1.1-1.02C20.86 15.24 24 12.36 24 8.5 24 5.42 21.58 3 18.5 3c-1.74 0-3.41.81-4.5 2.09C13.91 3.81 12.24 3 10.5 3z" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); ensureLikeSummary(it.publicationId); openLikers(it.publicationId) }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        margin: 0,
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      {likesCountMap[it.publicationId] != null ? likesCountMap[it.publicationId] : (typeof it.likesCount === 'number' ? it.likesCount : 0)}
                    </button>
                  </div>
                  <div style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
                    {/* Comment icon */}
                    <button
                      aria-label={'Comments'}
                      onClick={(e) => { e.stopPropagation(); ensureCommentCountHydrated(it.publicationId, it.commentsCount ?? null); openComments(it.publicationId) }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        margin: 0,
                        display: 'grid',
                        placeItems: 'center',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      {it.publicationId != null && commentedByMeMap[it.publicationId] ? (
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="#f5c518" stroke="#f5c518" strokeWidth="1.5" xmlns="http://www.w3.org/2000/svg">
                          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v9z" />
                        </svg>
                      ) : (
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" xmlns="http://www.w3.org/2000/svg">
                          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v9z" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); ensureCommentCountHydrated(it.publicationId, it.commentsCount ?? null); openComments(it.publicationId) }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        margin: 0,
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      {commentsCountMap[it.publicationId] != null ? commentsCountMap[it.publicationId] : (typeof it.commentsCount === 'number' ? it.commentsCount : 0)}
                    </button>
                  </div>
                </div>
              )}
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
    [items, isPortrait, posterAvail, playingIndex, startedMap, likesCountMap, likedMap, likeBusy, commentsCountMap, commentedByMeMap, isAuthed]
  )

  function reanchorToIndex(curIndex: number) {
    const r = railRef.current
    if (!r) return
    const slideEl = r.children[curIndex] as HTMLElement | undefined
    const targetTop = slideEl ? slideEl.offsetTop : curIndex * getSlideHeight()
    const lockMs = 300
    // Imperatively force instant jump (no smooth, no snap) for this reanchor window
    try { r.style.scrollBehavior = 'auto' } catch {}
    try { r.style.scrollSnapType = 'none' } catch {}
    // Keep state toggles for consistency, but imperative styles ensure immediate effect
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
        // Restore snap immediately so finger swipes snap again (mandatory for the controlled jump only)
        try { r.style.scrollSnapType = 'y mandatory' } catch {}
        // Programmatic scroll behavior can remain 'auto'; React state may set 'smooth' later
        try { r.style.scrollBehavior = 'auto' } catch {}
        // Keep state toggles synchronized, but the inline style above guarantees instant jump
        setTimeout(() => {
          // After the jump, return to user-friendly defaults: auto behavior + proximity snaps
          setSmoothEnabled(false)
          setSnapEnabled(true)
          // Ensure previous slide audio is stopped once docked
          pauseNonCurrent(curIndex)
        }, 50)
      }, 180)
    })
    return () => cancelAnimationFrame(id1)
  }

  // Prepare the rail for an instant programmatic jump before the next paint
  function disableSnapNow() {
    const r = railRef.current
    if (!r) return
    try { r.style.scrollBehavior = 'auto' } catch {}
    try { r.style.scrollSnapType = 'none' } catch {}
  }

  useEffect(() => {
    return reanchorToIndex(index) || undefined
  }, [isPortrait])

  useEffect(() => {
    const handler = () => { reanchorToIndex(index) }
    window.addEventListener('orientationchange', handler)
    return () => window.removeEventListener('orientationchange', handler)
  }, [index])

  // When a new feed of items is loaded (e.g., changing channels), reanchor decisively to the current index
  useEffect(() => {
    if (!items.length) return
    // Ensure we dock the current index (usually 0) immediately after items render
    const id = window.setTimeout(() => { disableSnapNow(); reanchorToIndex(index) }, 50)
    return () => window.clearTimeout(id)
  }, [itemsFeedKeyRef.current])

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
          }
        })
      },
      { root: r, threshold: Array.from({ length: 11 }, (_, i) => i / 10) }
    )
    slidesEl.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [items, unlocked])

  // Load likes summary for the active slide when index changes
  useEffect(() => {
    const it = items[index]
    if (it && it.publicationId != null) {
      ensureLikeSummary(it.publicationId)
    }
  }, [index, items])

  // Auto-close comments drawer when advancing to a different slide
  useEffect(() => {
    if (!commentsOpen) return
    const it = items[index]
    const activePub = it && it.publicationId != null ? Number(it.publicationId) : null
    if (commentsForPub != null && activePub != null && activePub !== commentsForPub) {
      setCommentsOpen(false)
    }
  }, [index, items, commentsOpen, commentsForPub])

  // Dwell-based persist of last-active and save on page hide
  const persistTimerRef = useRef<number | null>(null)
  const schedulePersist = useCallback((i: number) => {
    try { if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current) } catch {}
    persistTimerRef.current = (setTimeout(() => {
      try { saveLastActiveFor(feedMode, i) } catch {}
    }, 380) as unknown) as number
  }, [feedMode, items])

  useEffect(() => {
    schedulePersist(index)
  }, [index, schedulePersist])

  useEffect(() => {
    const onHide = () => { try { saveLastActiveFor(feedMode, index) } catch {} }
    const onBeforeUnload = () => { try { saveLastActiveFor(feedMode, index) } catch {} }
    try { document.addEventListener('visibilitychange', onHide) } catch {}
    try { window.addEventListener('pagehide', onHide) } catch {}
    try { window.addEventListener('beforeunload', onBeforeUnload) } catch {}
    return () => {
      try { document.removeEventListener('visibilitychange', onHide) } catch {}
      try { window.removeEventListener('pagehide', onHide) } catch {}
      try { window.removeEventListener('beforeunload', onBeforeUnload) } catch {}
    }
  }, [feedMode, index])

  // No shared video element; each slide manages its own via HLSVideo

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
    try { saveLastActiveFor(feedMode, index) } catch {}
    saveSnapshot()
    const match = flattenSpaces(spaceList).find((s) => s.id === spaceId)
    const spaceUlid = match?.ulid ?? null
    const target: FeedMode = { kind: 'space', spaceId, spaceUlid }
    if (!hasSnapshot(target)) {
      firstVisitKeyRef.current = feedKey(target)
      setRestorePoster(null)
      setRestoring(true)
      setSnapEnabled(false)
      setSmoothEnabled(false)
      setIndex(0)
      setStartedMap({})
      setPlayingIndex(null)
      const r = railRef.current; if (r) r.scrollTop = 0
      const until = Date.now() + 700
      ignoreScrollUntil.current = until
      ignoreIoUntil.current = until
    } else {
      firstVisitKeyRef.current = null
    }
    // Proactively disable snap/smooth for the upcoming programmatic jump
    disableSnapNow()
    // Persist last selected feed; do not modify the URL params
    if (spaceUlid) { writeLastFeed(spaceUlid) }
    setFeedMode({ kind: 'space', spaceId, spaceUlid })
    setDrawerOpen(false)
  }

  // Legacy feed removed

  const handleSelectGlobal = () => {
    try { saveLastActiveFor(feedMode, index) } catch {}
    saveSnapshot()
    const target: FeedMode = { kind: 'global' }
    if (!hasSnapshot(target)) {
      firstVisitKeyRef.current = feedKey(target)
      setRestorePoster(null)
      setRestoring(true)
      setSnapEnabled(false)
      setSmoothEnabled(false)
      setIndex(0)
      setStartedMap({})
      setPlayingIndex(null)
      const r = railRef.current; if (r) r.scrollTop = 0
      const until = Date.now() + 700
      ignoreScrollUntil.current = until
      ignoreIoUntil.current = until
    } else {
      firstVisitKeyRef.current = null
    }
    // Proactively disable snap/smooth for the upcoming programmatic jump
    disableSnapNow()
    // Persist last selected feed as global
    writeLastFeedGlobal()
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
        title={space.ulid ? `ULID: ${space.ulid}` : undefined}
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
    { label: 'My Uploads', href: '/uploads', enabled: true },
  ]

  const upcomingLinks = [
    { label: 'My Groups', note: 'Coming soon' },
    { label: 'My Channels', note: 'Coming soon' },
    { label: 'My Messages', note: 'Coming soon' },
  ]

  return (
    <div style={{ height: '100dvh', overflow: 'hidden', background: '#000', ['--header-h' as any]: 'calc(env(safe-area-inset-top, 0px) + 44px)' }}>
      <SharedNav
        drawerOpen={drawerOpen}
        drawerMode={drawerMode}
        openDrawer={openDrawer}
        closeDrawer={closeDrawer}
        currentFeedLabel={currentFeedLabel}
        isAuthed={isAuthed}
        mineOnly={mineOnly}
        onChangeMineOnly={(checked) => setMineOnly(checked)}
        navLinks={navLinks}
        upcomingLinks={upcomingLinks}
        renderSpacesPanel={renderSpacesPanel}
        onPrefetch={prefetchForHref}
        activeSpaceId={activeSpaceId}
        isGlobalActive={feedMode.kind === 'global'}
        onSelectGlobal={() => {
          handleSelectGlobal()
          setDrawerOpen(false)
        }}
        onSelectSpace={(sid) => {
          handleSelectSpace(sid)
          setDrawerOpen(false)
        }}
      />
      {/* Tap-to-start overlay removed per requirements */}
      <div
        ref={railRef}
        onScroll={onScroll}
        style={{
          position: 'fixed',
          top: 'var(--header-h, calc(env(safe-area-inset-top, 0px) + 28px))',
          left: 0,
          right: 0,
          bottom: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
          // Use proximity for user scrolling; programmatic jumps temporarily override inline
          scrollSnapType: snapEnabled ? 'y proximity' as const : 'none' as const,
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
          {modalSrc && (
            <FeedVideo
              src={modalSrc}
              active={true}
              warm={false}
              muted={false}
              controls
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
            />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); closeModal() }}
            style={{ position: 'fixed', top: 14, right: 14, zIndex: 51, background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 16, padding: '6px 10px' }}
          >
            Close
          </button>
        </div>
      )}
      {likersOpen && (
        <div
          onClick={() => setLikersOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 16 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, 92vw)', maxHeight: '80vh', background: 'rgba(22,22,22,0.96)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 600 }}>Likes</div>
              <button onClick={() => setLikersOpen(false)} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, padding: '6px 10px' }}>Close</button>
            </div>
            <div style={{ overflowY: 'auto' }}>
              {likersItems.length === 0 && !likersLoading ? (
                <div style={{ padding: 16, color: '#aaa' }}>No likes yet.</div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {likersItems.map((u) => (
                    <li key={`${u.userId}-${u.createdAt}`} style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ fontSize: 15 }}>{u.displayName || u.email || `User ${u.userId}`}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{new Date(u.createdAt).toLocaleString()}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {likersCursor ? (
                <button disabled={likersLoading} onClick={() => loadMoreLikers()} style={{ background: '#222', color: '#fff', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 8, padding: '6px 10px' }}>{likersLoading ? 'Loading…' : 'Load More'}</button>
              ) : (
                <span style={{ fontSize: 12, opacity: 0.7, padding: '6px 0' }}>End of list</span>
              )}
            </div>
          </div>
        </div>
      )}
      {commentsOpen && (
        <div
          onClick={() => setCommentsOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 55 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(16,16,16,0.98)', borderTop: '1px solid rgba(255,255,255,0.15)', maxHeight: '70vh', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
            <div style={{ padding: '10px 14px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 600 }}>Comments</div>
              <button onClick={() => setCommentsOpen(false)} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, padding: '6px 10px' }}>Close</button>
            </div>
            <div style={{ overflowY: 'auto' }}>
              {commentsItems.length === 0 && !commentsLoading ? (
                <div style={{ padding: 16, color: '#aaa' }}>No comments yet. Be the first!</div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {commentsItems.map((c) => (
                    <li key={c.id} style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#fff' }}>
                      <div style={{ fontSize: 14, opacity: 0.9 }}>{c.displayName || c.email || `User ${c.userId}`}</div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.35, marginTop: 4 }}>{c.body}</div>
                      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>{new Date(c.createdAt).toLocaleString()}</div>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
                {commentsCursor ? (
                  <button disabled={commentsLoading} onClick={() => loadMoreComments()} style={{ background: '#222', color: '#fff', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 8, padding: '6px 10px' }}>{commentsLoading ? 'Loading…' : 'Load More'}</button>
                ) : (
                  <span style={{ fontSize: 12, opacity: 0.7 }}>End of comments</span>
                )}
              </div>
            </div>
            <div style={{ padding: 10, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <textarea
                value={commentText}
                onChange={(e) => setCommentText((e.target as any).value)}
                onFocus={() => { setCommentRows(3); try { (document.activeElement as any)?.scrollIntoView?.({ block: 'nearest' }) } catch {}; setTimeout(() => window.scrollTo?.(0, document.body.scrollHeight), 0) }}
                onBlur={() => { if (!commentText.trim()) { setCommentRows(1) } }}
                placeholder={isAuthed ? 'Write a comment…' : 'Sign in to comment'}
                disabled={!isAuthed || commentBusy}
                rows={commentRows}
                style={{ flex: 1, background: '#111', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: '10px 12px', fontSize: 16, lineHeight: 1.35, resize: 'none' as any, outline: 'none' }}
              />
              <button onClick={submitComment} disabled={!isAuthed || commentBusy || !commentText.trim()} style={{ background: '#1976d2', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: '10px 12px' }}>{commentBusy ? 'Posting…' : 'Post'}</button>
            </div>
          </div>
        </div>
      )}
      {restoring && (
        <div
          style={{
            position: 'fixed',
            top: 'var(--header-h, 0px)',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1500,
            background: restorePoster ? `#000 url('${restorePoster}') center / cover no-repeat` : '#000',
            transition: 'opacity 160ms ease',
            opacity: 1,
            pointerEvents: 'none',
          }}
        />
      )}
      <style>{`
        .slide{position:relative; width:100vw; height:calc(100dvh - var(--header-h, 0px)); scroll-snap-align:start; scroll-snap-stop:normal; background:#000; background-size:cover; background-position:center; background-repeat:no-repeat;}
        .holder{position:absolute; inset:0;}
      `}</style>
    </div>
  )
}
