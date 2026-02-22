import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import FeedVideo from '../components/FeedVideo'
import SharedNav from '../ui/SharedNav'
import { prefetchForHref } from '../ui/routes'
import styles from '../styles/feed.module.css'
import debug from '../debug'
import useRenderDebug from '../debug/useRenderDebug'

const LazyReportModal = React.lazy(() => import('./ReportModal'))
const LazyJumpToSpaceModal = React.lazy(() => import('./JumpToSpaceModal'))

type UploadItem = {
  id: number
  url: string
  posterPortrait?: string
  posterLandscape?: string
  masterPortrait?: string
  masterLandscape?: string
  productionUlid?: string | null
  // Stable, public video identifier (prefer production ULID; fallback to asset UUID)
  videoId?: string | null
  ownerId?: number | null
  ownerName?: string | null
  ownerEmail?: string | null
  ownerAvatarUrl?: string | null
  publicationId?: number | null
  spaceId?: number | null
  publishedAt?: string | null
  likesCount?: number | null
  commentsCount?: number | null
   likedByMe?: boolean | null
   commentedByMe?: boolean | null
   reportedByMe?: boolean | null
  hasStory?: boolean | null
  storyPreview?: string | null
  hasCaptions?: boolean | null
}

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
  roles: string[]
  isSiteAdmin?: boolean
  hasAnySpaceAdmin?: boolean
  hasAnySpaceModerator?: boolean
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

function isGlobalFeedSlug(slug: string | null | undefined): boolean {
  const s = String(slug || '').trim().toLowerCase()
  return s === 'global' || s === 'global-feed'
}

function readPinFromUrl(): string | null {
  try {
    const search = typeof window !== 'undefined' ? (window.location.search || '') : ''
    if (!search) return null
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    const pin = params.get('pin')
    if (!pin) return null
    const decoded = String(pin).trim()
    return decoded ? decoded : null
  } catch {
    return null
  }
}

function parseCanonicalFromPath(): { kind: 'group' | 'channel'; slug: string } | null {
  try {
    const p = typeof window !== 'undefined' ? (window.location.pathname || '') : ''
    const m = p.match(/^\/(groups|channels)\/(?:([^\/]+))\/?$/)
    if (!m) return null
    const kind = m[1] === 'groups' ? 'group' : 'channel'
    const slug = decodeURIComponent(m[2] || '').trim()
    if (!slug) return null
    return { kind, slug }
  } catch {
    return null
  }
}

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

function buildUploadItem(raw: any, owner?: { id: number | null; displayName?: string | null; email?: string | null; avatarUrl?: string | null } | null, publication?: any | null): UploadItem {
  const posterPortrait = raw.poster_portrait_cdn || raw.poster_portrait_s3 || raw.poster_cdn || raw.poster_s3 || ''
  const posterLandscape = raw.poster_landscape_cdn || raw.poster_landscape_s3 || ''
  const master = raw.cdn_master || raw.s3_master || ''
  const { portrait: masterPortrait, landscape: masterLandscape } = swapOrientation(master)
  const ownerId = owner?.id != null ? Number(owner.id) : (raw.user_id != null ? Number(raw.user_id) : null)
  const ownerName = owner?.displayName ?? null
  const ownerEmail = owner?.email ?? null
  const ownerAvatarUrl = owner?.avatarUrl ?? null
  const publicationId = publication?.id != null ? Number(publication.id) : null
  const spaceId = publication?.space_id != null ? Number(publication.space_id) : (raw.space_id != null ? Number(raw.space_id) : null)
  const publishedAt = publication?.published_at ? String(publication.published_at) : null
  const likesCount = typeof publication?.likes_count === 'number' ? Number(publication.likes_count) : null
  const commentsCount = typeof publication?.comments_count === 'number' ? Number(publication.comments_count) : null
  const likedByMe = typeof (publication as any)?.liked_by_me === 'boolean' ? Boolean((publication as any).liked_by_me) : null
  const commentedByMe = typeof (publication as any)?.commented_by_me === 'boolean' ? Boolean((publication as any).commented_by_me) : null
  const reportedByMe = typeof (publication as any)?.reported_by_me === 'boolean' ? Boolean((publication as any).reported_by_me) : null
  const hasStory = typeof (publication as any)?.has_story === 'boolean' ? Boolean((publication as any).has_story) : null
  const storyPreview = typeof (publication as any)?.story_preview === 'string' ? String((publication as any).story_preview) : null
  const hasCaptions = typeof (publication as any)?.has_captions === 'boolean' ? Boolean((publication as any).has_captions) : null
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
    productionUlid,
    videoId,
    ownerId,
    ownerName,
    ownerEmail,
    ownerAvatarUrl,
    publicationId,
    spaceId,
    publishedAt,
    likesCount,
    commentsCount,
    likedByMe,
    commentedByMe,
    reportedByMe,
    hasStory,
    storyPreview,
    hasCaptions,
  }
}

// Legacy feed removed: feeds are driven by publications only.

async function fetchSpaceFeed(spaceId: number, opts: { cursor?: string | null; limit?: number; pinProductionUlid?: string | null } = {}): Promise<{ items: UploadItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 20) })
  if (opts.cursor) params.set('cursor', opts.cursor)
  if (!opts.cursor && opts.pinProductionUlid) params.set('pin', String(opts.pinProductionUlid))
  const res = await fetch(`/api/spaces/${spaceId}/feed?${params.toString()}`)
  if (!res.ok) throw new Error('failed to fetch space feed')
  const payload = await res.json()
  const items = Array.isArray(payload?.items)
    ? payload.items.map((entry: any) =>
        buildUploadItem(
          entry.upload,
          entry.owner
            ? {
                id: entry.owner.id ?? null,
                displayName: entry.owner.displayName ?? null,
                email: entry.owner.email ?? null,
                avatarUrl: entry.owner.avatarUrl ?? null,
              }
            : null,
          entry.publication ?? null,
        )
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
        buildUploadItem(
          entry.upload,
          entry.owner
            ? {
                id: entry.owner.id ?? null,
                displayName: entry.owner.displayName ?? null,
                email: entry.owner.email ?? null,
                avatarUrl: entry.owner.avatarUrl ?? null,
              }
            : null,
          entry.publication ?? null,
        )
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
  const [meLoaded, setMeLoaded] = useState(false)
  const [spaceList, setSpaceList] = useState<MySpacesResponse | null>(null)
  const [spacesLoaded, setSpacesLoaded] = useState(false)
  const [spacesLoading, setSpacesLoading] = useState(false)
  const [spacesError, setSpacesError] = useState<string | null>(null)
  const [feedMode, setFeedMode] = useState<FeedMode>({ kind: 'global' })
  const railRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  // Note: individual slide videos are rendered via FeedVideo/HLSVideo; no shared video element
  const [isPortrait, setIsPortrait] = useState<boolean>(() => typeof window !== 'undefined' ? window.matchMedia && window.matchMedia('(orientation: portrait)').matches : true)
  const [posterAvail, setPosterAvail] = useState<Record<string, boolean>>({})
  const railOffsetRef = useRef<number>(0)
  const dragStartOffsetRef = useRef<number>(0)
  const isDraggingRef = useRef<boolean>(false)
  const dragThresholdPassedRef = useRef<boolean>(false)
  const lastWheelAtRef = useRef<number>(0)
  const wheelDeltaAccumRef = useRef<number>(0)
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
  // Fullscreen: track which slide is currently fullscreen (by index)
  const [fsIndex, setFsIndex] = useState<number | null>(null)
  // Likes state keyed by publicationId
  const [likesCountMap, setLikesCountMap] = useState<Record<number, number>>({})
  const [likedMap, setLikedMap] = useState<Record<number, boolean>>({})
  const [likeBusy, setLikeBusy] = useState<Record<number, boolean>>({})
  // Per-space follow state keyed by "spaceId:userId"
  const [followMap, setFollowMap] = useState<Record<string, boolean>>({})
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
  const [commentsOrder, setCommentsOrder] = useState<'oldest' | 'newest'>('newest')
  // Reporting state keyed by publicationId
  const [reportedMap, setReportedMap] = useState<Record<number, boolean>>({})
  const [reportOpen, setReportOpen] = useState(false)
  const [reportForPub, setReportForPub] = useState<number | null>(null)
  // Global feed "jump to space" modal state
  const [jumpOpen, setJumpOpen] = useState(false)
  const [jumpForPub, setJumpForPub] = useState<number | null>(null)
  const [jumpPinUlid, setJumpPinUlid] = useState<string | null>(null)
  // Story overlay state keyed by publicationId
  const [storyOpenForPub, setStoryOpenForPub] = useState<number | null>(null)
  const [storyTextMap, setStoryTextMap] = useState<Record<number, string | null>>({})
  const [storyBusyMap, setStoryBusyMap] = useState<Record<number, boolean>>({})
  // Captions (custom overlay) state
  const [captionsEnabled, setCaptionsEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('captions:enabled') === '1' } catch { return false }
  })
  const [captionText, setCaptionText] = useState<string | null>(null)
  const captionsCuesRef = useRef<Record<number, Array<{ startMs: number; endMs: number; text: string }>>>({})
  const captionsLoadingRef = useRef<Record<number, boolean>>({})
  const captionsCueIndexRef = useRef<Record<number, number>>({})
  const captionsLastTimeMsRef = useRef<Record<number, number>>({})
  const lastCaptionTextRef = useRef<string | null>(null)
  // Who liked modal state
  const [likersOpen, setLikersOpen] = useState(false)
  const [likersForPub, setLikersForPub] = useState<number | null>(null)
  const [likersItems, setLikersItems] = useState<Array<{ userId: number; displayName: string; email: string | null; createdAt: string }>>([])
  const [likersCursor, setLikersCursor] = useState<string | null>(null)
  const [likersLoading, setLikersLoading] = useState(false)
  // Profile peek overlay state
  const [peekOpen, setPeekOpen] = useState(false)
  const [peekUserId, setPeekUserId] = useState<number | null>(null)
  const [peekSpaceId, setPeekSpaceId] = useState<number | null>(null)
  const [peekProfile, setPeekProfile] = useState<{
    userId: number
    displayName: string
    avatarUrl: string | null
    bio: string | null
    memberSince: string | null
    slug?: string | null
  } | null>(null)
  const [peekLoading, setPeekLoading] = useState(false)
  const [peekError, setPeekError] = useState<string | null>(null)
  const [peekFollowing, setPeekFollowing] = useState<boolean | null>(null)
  const [peekFollowersCount, setPeekFollowersCount] = useState<number | null>(null)
  const [peekFollowBusy, setPeekFollowBusy] = useState(false)
  const lastTouchTsRef = useRef<number>(0)
  const touchStartXRef = useRef<number>(0)
  const touchStartYRef = useRef<number>(0)
  const touchStartTRef = useRef<number>(0)
  const touchLastXRef = useRef<number>(0)
  const touchLastYRef = useRef<number>(0)
  const touchLastTRef = useRef<number>(0)
  const suppressDurableRestoreRef = useRef<boolean>(false)
  const restoringRef = useRef<boolean>(false)
  const itemsFeedKeyRef = useRef<string>('')
  const indexReasonRef = useRef<string>('initial')
  const [commentsSortOpen, setCommentsSortOpen] = useState(false)

  const isGlobalBillboard = useMemo(() => {
    if (feedMode.kind === 'global') return true
    if (feedMode.kind !== 'space') return false

    const activeSpace = flattenSpaces(spaceList).find((s) => s.id === feedMode.spaceId) || null
    if (activeSpace && activeSpace.type === 'channel' && isGlobalFeedSlug(activeSpace.slug)) return true

    try {
      const p = typeof window !== 'undefined' ? (window.location.pathname || '') : ''
      const m = p.match(/^\/channels\/([^\/]+)\/?$/)
      if (!m) return false
      const slug = decodeURIComponent(m[1] || '').trim()
      return isGlobalFeedSlug(slug)
    } catch {
      return false
    }
  }, [feedMode, spaceList])

  // Optional per-component render tracing (DEBUG_RENDER)
  useRenderDebug('Feed', {
    index,
    itemsLen: items.length,
    mode: feedMode.kind,
    isAuthed,
    mineOnly,
    playingIndex,
    fsIndex,
    commentsOpen,
  })

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

  function findSpaceSummaryById(spaceId: number | null): SpaceSummary | null {
    if (!spaceId || !spaceList) return null
    return flattenSpaces(spaceList).find((s) => s.id === spaceId) || null
  }

  function followKey(spaceId: number | null, userId: number | null): string | null {
    if (!spaceId || !userId) return null
    return `${spaceId}:${userId}`
  }

  async function ensureLikeSummary(publicationId: number | null | undefined) {
    if (!publicationId || !isAuthed) return
    if (likesCountMap[publicationId] != null && likedMap[publicationId] != null) return
    try {
      try { debug.log('feed', 'like summary fetch start', { publicationId }) } catch {}
      const res = await fetch(`/api/publications/${publicationId}/likes`, { credentials: 'same-origin' })
      if (!res.ok) return
      const data = await res.json()
      setLikesCountMap((m) => ({ ...m, [publicationId]: Number(data?.count ?? 0) }))
      setLikedMap((m) => ({ ...m, [publicationId]: Boolean(data?.liked) }))
      try { debug.log('feed', 'like summary fetched', { publicationId, count: Number(data?.count ?? 0), liked: Boolean(data?.liked) }) } catch {}
    } catch {}
  }

  useEffect(() => {
    // Close story overlay when the user changes slides.
    setStoryOpenForPub(null)
  }, [index])

  const captionsSlideIndex = playingIndex != null ? playingIndex : index

  useEffect(() => {
    // Keep captions in sync with whichever video is actually playing/active.
    setCaptionText(null)
    lastCaptionTextRef.current = null
  }, [captionsSlideIndex])

  async function ensureStory(publicationId: number | null | undefined) {
    if (!publicationId || !isAuthed) return
    if (Object.prototype.hasOwnProperty.call(storyTextMap, publicationId)) return
    if (storyBusyMap[publicationId]) return
    setStoryBusyMap((m) => ({ ...m, [publicationId]: true }))
    try {
      const res = await fetch(`/api/publications/${publicationId}/story`, { credentials: 'same-origin' })
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      const storyText = typeof data?.storyText === 'string' ? String(data.storyText) : null
      setStoryTextMap((m) => ({ ...m, [publicationId]: storyText }))
    } catch {
      // ignore
    } finally {
      setStoryBusyMap((m) => ({ ...m, [publicationId]: false }))
    }
  }

  function persistCaptionsEnabled(next: boolean) {
    setCaptionsEnabled(next)
    try { localStorage.setItem('captions:enabled', next ? '1' : '0') } catch {}
    if (!next) {
      captionsCueIndexRef.current = {}
      captionsLastTimeMsRef.current = {}
      lastCaptionTextRef.current = null
      setCaptionText(null)
    }
  }

  function parseVttTimestampMs(raw: string): number | null {
    const s = String(raw || '').trim()
    const m = s.match(/^(\d{1,2}:)?(\d{2}):(\d{2})\.(\d{3})$/)
    if (!m) return null
    const hasHours = !!m[1]
    const hours = hasHours ? Number(String(m[1]).replace(':', '')) : 0
    const minutes = Number(m[2])
    const seconds = Number(m[3])
    const ms = Number(m[4])
    if (![hours, minutes, seconds, ms].every((n) => Number.isFinite(n))) return null
    return (((hours * 60 + minutes) * 60 + seconds) * 1000 + ms)
  }

  function parseVttCues(vtt: string): Array<{ startMs: number; endMs: number; text: string }> {
    const src = String(vtt || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const blocks = src.split(/\n\n+/).map((b) => b.trim()).filter(Boolean)
    const cues: Array<{ startMs: number; endMs: number; text: string }> = []
    for (const block of blocks) {
      if (block.toUpperCase().startsWith('WEBVTT')) continue
      const lines = block.split('\n').map((l) => l.trimEnd())
      if (!lines.length) continue
      const timeLineIndex = lines.findIndex((l) => l.includes('-->'))
      if (timeLineIndex < 0) continue
      const timeLine = lines[timeLineIndex]
      const parts = timeLine.split('-->').map((p) => p.trim())
      if (parts.length < 2) continue
      const startRaw = parts[0]
      const endRaw = parts[1].split(/\s+/)[0]
      const startMs = parseVttTimestampMs(startRaw)
      const endMs = parseVttTimestampMs(endRaw)
      if (startMs == null || endMs == null) continue
      const textLines = lines.slice(timeLineIndex + 1).filter((l) => l.trim().length)
      if (!textLines.length) continue
      const text = textLines
        .join('\n')
        .replace(/<[^>]+>/g, '')
        .trim()
      if (!text) continue
      cues.push({ startMs, endMs, text })
    }
    cues.sort((a, b) => a.startMs - b.startMs)
    return cues
  }

  function postProcessCaptionsCues(
    cues: Array<{ startMs: number; endMs: number; text: string }>,
    opts: { minCueMs: number; minLastCueMs: number } = { minCueMs: 900, minLastCueMs: 1600 },
  ): Array<{ startMs: number; endMs: number; text: string }> {
    const normalized = Array.isArray(cues) ? cues.slice().sort((a, b) => a.startMs - b.startMs) : []
    if (normalized.length === 0) return []
    const out: Array<{ startMs: number; endMs: number; text: string }> = []
    const countWords = (s: string) => {
      const txt = String(s || '').trim()
      if (!txt) return 0
      return txt.split(/\s+/).filter(Boolean).length
    }
    for (let i = 0; i < normalized.length; i += 1) {
      const raw = normalized[i]
      const startMs = Math.max(0, Math.round(Number(raw.startMs) || 0))
      let endMs = Math.max(startMs + 1, Math.round(Number(raw.endMs) || 0))
      const text = String(raw.text || '').trim()
      if (!text) continue

      const nextStartMs = i + 1 < normalized.length ? Math.max(0, Math.round(Number(normalized[i + 1].startMs) || 0)) : null
      if (nextStartMs != null && endMs >= nextStartMs) endMs = Math.max(startMs + 1, nextStartMs - 1)

      const isLast = i === normalized.length - 1
      const minMs = isLast ? opts.minLastCueMs : opts.minCueMs
      const dur = Math.max(0, endMs - startMs)

      // Merge "hanger" micro-cues into the prior cue when they are very small and close in time.
      // This avoids single-word flashes like a trailing "profile" at the very end.
      const wordCount = countWords(text)
      const isMicro = wordCount > 0 && (wordCount <= 2 || text.length <= 8)
      if (isMicro && out.length) {
        const prev = out[out.length - 1]
        const gapMs = Math.max(0, startMs - prev.endMs)
        if (gapMs <= 800 || isLast) {
          prev.text = `${prev.text} ${text}`.trim()
          prev.endMs = Math.max(prev.endMs, endMs)
          if (nextStartMs != null && prev.endMs >= nextStartMs) prev.endMs = Math.max(prev.startMs + 1, nextStartMs - 1)
          continue
        }
      }

      if (dur < minMs) {
        let extendedEnd = startMs + minMs
        if (nextStartMs != null) extendedEnd = Math.min(extendedEnd, Math.max(startMs + 1, nextStartMs - 1))
        endMs = Math.max(endMs, extendedEnd)
      }

      out.push({ startMs, endMs, text })
    }
    return out
  }

  async function ensureCaptionsCues(publicationId: number) {
    if (captionsCuesRef.current[publicationId]) return
    if (captionsLoadingRef.current[publicationId]) return
    captionsLoadingRef.current[publicationId] = true
    try {
      const res = await fetch(`/api/publications/${publicationId}/captions.vtt`, { credentials: 'same-origin' })
      if (!res.ok) {
        captionsCuesRef.current[publicationId] = []
        return
      }
      const vtt = await res.text()
      captionsCuesRef.current[publicationId] = postProcessCaptionsCues(parseVttCues(vtt))
    } catch {
      captionsCuesRef.current[publicationId] = []
    } finally {
      captionsLoadingRef.current[publicationId] = false
    }
  }

  useEffect(() => {
    if (!captionsEnabled) return
    const active = items[captionsSlideIndex]
    const pubId = active?.publicationId != null ? Number(active.publicationId) : null
    const hasCaps = active?.hasCaptions === true
    if (!pubId || !hasCaps) {
      setCaptionText(null)
      return
    }
    // Avoid overlap: hide captions when story is expanded for this publication.
    if (storyOpenForPub === pubId) {
      setCaptionText(null)
      return
    }
    let cancelled = false
    let boundVideo: HTMLVideoElement | null = null
    let unbind: (() => void) | null = null
    ;(async () => {
      await ensureCaptionsCues(pubId)
      if (cancelled) return
      const resetLoopState = () => {
        captionsCueIndexRef.current[pubId] = 0
        captionsLastTimeMsRef.current[pubId] = 0
        lastCaptionTextRef.current = null
        setCaptionText(null)
      }

	      const tick = () => {
	        if (cancelled) return
	        try {
	          const v: any = getVideoEl(captionsSlideIndex)
	          // (Re)bind video event handlers in case the element gets replaced (HLS reattach, loop behavior, etc).
	          if (v && v instanceof HTMLVideoElement && v !== boundVideo) {
	            try { unbind?.() } catch {}
	            boundVideo = v
	            const onEnded = () => { resetLoopState() }
	            const onSeeked = () => {
	              // Seeking can happen on loop and on user interactions; reset index and let tick re-sync.
	              captionsCueIndexRef.current[pubId] = 0
	              captionsLastTimeMsRef.current[pubId] = Math.max(0, Math.round(Number((v as any).currentTime || 0) * 1000))
	              lastCaptionTextRef.current = null
	              setCaptionText(null)
	            }
	            try {
	              v.addEventListener('ended', onEnded)
	              v.addEventListener('seeked', onSeeked)
	              v.addEventListener('seeking', onSeeked)
	            } catch {}
	            unbind = () => {
	              try {
	                v.removeEventListener('ended', onEnded)
	                v.removeEventListener('seeked', onSeeked)
	                v.removeEventListener('seeking', onSeeked)
	              } catch {}
	            }
	          }

	          const cues = captionsCuesRef.current[pubId] || []
	          if (!v || !cues.length || typeof v.currentTime !== 'number') {
	            if (lastCaptionTextRef.current !== null) {
	              lastCaptionTextRef.current = null
	              setCaptionText(null)
	            }
	            return
	          }

	          const tMs = Math.max(0, Math.round(Number(v.currentTime) * 1000))
	          const prevMs = captionsLastTimeMsRef.current[pubId]
	          // If the video loops (time jumps backwards), reset cue tracking so captions restart cleanly.
	          if (typeof prevMs === 'number' && Number.isFinite(prevMs) && tMs + 500 < prevMs) {
	            resetLoopState()
	          }
	          captionsLastTimeMsRef.current[pubId] = tMs
	          let idx = captionsCueIndexRef.current[pubId] ?? 0
	          if (idx >= cues.length) idx = cues.length - 1
	          if (idx < 0) idx = 0

	          // Advance/rewind index to follow time (handles seeking).
	          while (idx < cues.length && tMs > cues[idx].endMs) idx += 1
	          while (idx > 0 && tMs < cues[idx].startMs) idx -= 1

	          let nextText: string | null = null
	          const cue = cues[idx]
	          if (cue && tMs >= cue.startMs && tMs <= cue.endMs) nextText = cue.text
	          captionsCueIndexRef.current[pubId] = idx

	          if (lastCaptionTextRef.current !== nextText) {
	            lastCaptionTextRef.current = nextText
	            setCaptionText(nextText)
	          }
	        } catch {
	          // Never let captions break the feed loop.
	          captionsCueIndexRef.current[pubId] = 0
	          captionsLastTimeMsRef.current[pubId] = 0
	          if (lastCaptionTextRef.current !== null) {
	            lastCaptionTextRef.current = null
	            setCaptionText(null)
	          }
	        } finally {
	          requestAnimationFrame(tick)
	        }
	      }
	      requestAnimationFrame(tick)
	    })()
    return () => {
      cancelled = true
      try { unbind?.() } catch {}
    }
  }, [captionsEnabled, captionsSlideIndex, items, storyOpenForPub])

  const openProfilePeek = useCallback(
    async (
      ownerId: number | null | undefined,
      contextSpaceId: number | null | undefined,
      initialName?: string | null,
      initialAvatarUrl?: string | null,
    ) => {
      if (!ownerId || !Number.isFinite(ownerId)) return
      const uid = Number(ownerId)
      const spaceId = contextSpaceId && Number.isFinite(contextSpaceId) ? Number(contextSpaceId) : null
      setPeekOpen(true)
      setPeekUserId(uid)
      setPeekSpaceId(spaceId)
      if (initialName || initialAvatarUrl) {
        setPeekProfile({
          userId: uid,
          displayName: initialName || '',
          avatarUrl: initialAvatarUrl || null,
          bio: null,
          memberSince: null,
          slug: undefined,
        })
      } else {
        setPeekProfile(null)
      }
      setPeekLoading(true)
      setPeekError(null)
      setPeekFollowing(null)
      setPeekFollowersCount(null)
      try {
        const res = await fetch(`/api/profile/${uid}`)
        if (!res.ok) throw new Error('profile_failed')
        const data = await res.json()
        const p = data?.profile
        if (p) {
          setPeekProfile((prev) => ({
            userId: Number(p.userId ?? uid),
            displayName: String(p.displayName || prev?.displayName || ''),
            avatarUrl: p.avatarUrl || prev?.avatarUrl || null,
            bio: p.bio ?? prev?.bio ?? null,
            memberSince: p.memberSince ? String(p.memberSince) : prev?.memberSince ?? null,
            slug: typeof p.slug === 'string' && p.slug.length ? String(p.slug) : prev?.slug ?? null,
          }))
        } else {
          setPeekError('Profile not found.')
        }
      } catch {
        setPeekError('Failed to load profile.')
      } finally {
        setPeekLoading(false)
      }

      if (!spaceId || !isAuthed) return
      const space = findSpaceSummaryById(spaceId)
      if (!space || (space.type !== 'group' && space.type !== 'channel')) return
      try {
        const res = await fetch(`/api/spaces/${spaceId}/users/${uid}/follow`, { credentials: 'same-origin' })
        if (!res.ok) return
        const data = await res.json()
        setPeekFollowing(Boolean(data?.following))
        const key = followKey(spaceId, uid)
        if (key) {
          setFollowMap((m) => ({ ...m, [key]: Boolean(data?.following) }))
        }
        const count = typeof data?.followersCount === 'number' ? Number(data.followersCount) : null
        setPeekFollowersCount(count)
      } catch {
        // ignore follow summary errors; overlay is still useful without them
      }
    },
    [isAuthed, spaceList],
  )

  const closeProfilePeek = useCallback(() => {
    setPeekOpen(false)
    setPeekUserId(null)
    setPeekSpaceId(null)
    setPeekProfile(null)
    setPeekError(null)
    setPeekFollowing(null)
    setPeekFollowersCount(null)
    setPeekFollowBusy(false)
  }, [])

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
    try { debug.log('feed', 'comments open', { publicationId: pubId }) } catch {}
    await loadMoreComments(pubId)
  }

  async function loadMoreComments(
    pubId?: number | null,
    orderOverride?: 'oldest' | 'newest',
    replace = false
  ) {
    const publicationId = pubId ?? commentsForPub
    if (!publicationId) return
    if (commentsLoading) return
    setCommentsLoading(true)
    const order = orderOverride ?? commentsOrder
    try {
      try { debug.log('feed', 'comments fetch start', { publicationId, cursor: commentsCursor, order }) } catch {}
      const params = new URLSearchParams({ limit: '50', order })
      if (commentsCursor) params.set('cursor', commentsCursor)
      const res = await fetch(`/api/publications/${publicationId}/comments?${params.toString()}`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('comments_fetch_failed')
      const data = await res.json()
      const items = Array.isArray(data?.items) ? data.items : []
      const mapped = items.map((c: any) => ({
        id: Number(c.id),
        userId: Number(c.userId),
        displayName: String(c.displayName || ''),
        email: c.email ?? null,
        body: String(c.body || ''),
        createdAt: String(c.createdAt || ''),
      }))
      if (replace) {
        setCommentsItems(mapped)
      } else {
        setCommentsItems((prev) => prev.concat(mapped))
      }
      setCommentsCursor(typeof data?.nextCursor === 'string' && data.nextCursor.length ? data.nextCursor : null)
      if (myUserId != null && mapped.some((c) => c.userId === myUserId)) {
        setCommentedByMeMap((m) => ({ ...m, [publicationId]: true }))
      }
      try { debug.log('feed', 'comments fetch done', { publicationId, added: mapped.length, nextCursor: typeof data?.nextCursor === 'string' && data.nextCursor.length ? true : false }) } catch {}
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
      debug.log('feed', 'comment submit start (optimistic +1)', { publicationId: pubId })
      debug.time('perf', `comment submit:${pubId}`)
    } catch {}
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
      try { debug.log('feed', 'comment submit done', { publicationId: pubId, id: created?.id }) } catch {}
    } catch (e) {
      // Roll back optimistic increment
      setCommentsCountMap((m) => ({ ...m, [pubId]: prevCount != null ? prevCount : Math.max(0, (m[pubId] ?? 1) - 1) }))
      try { debug.warn('feed', 'comment submit failed (rollback -1)', { publicationId: pubId }) } catch {}
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
      debug.log('feed', 'like toggle start (optimistic)', { publicationId, from: currentlyLiked, to: !currentlyLiked })
      debug.time('perf', `like toggle:${publicationId}`)
    } catch {}
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
      try { debug.log('feed', 'like toggle server', { publicationId, liked: Boolean(data?.liked), count: Number(data?.count ?? 0) }) } catch {}
    } catch {
      // Rollback on error
      setLikedMap((m) => ({ ...m, [publicationId]: currentlyLiked }))
      setLikesCountMap((m) => ({ ...m, [publicationId]: Math.max(0, (m[publicationId] ?? 0) + (currentlyLiked ? 1 : -1)) }))
      try { debug.warn('feed', 'like toggle failed (rollback)', { publicationId, restore: currentlyLiked }) } catch {}
    } finally {
      setLikeBusy((b) => ({ ...b, [publicationId]: false }))
      try {
        debug.log('feed', 'like toggle end', { publicationId })
        debug.timeEnd('perf', `like toggle:${publicationId}`)
      } catch {}
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

  useEffect(() => {
    if (!peekOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeProfilePeek()
      }
    }
    try { window.addEventListener('keydown', onKey) } catch {}
    return () => {
      try { window.removeEventListener('keydown', onKey) } catch {}
    }
  }, [peekOpen, closeProfilePeek])

  function feedStorageKey(m: FeedMode): string { return userKeyPrefix() + FEED_LAST_PREFIX + feedKey(m) }

  function computeSlideId(it: UploadItem): string {
    const vid = (it as any).videoId ? String((it as any).videoId) : null
    const pubId = it.publicationId != null ? String(it.publicationId) : null
    return vid ? `v-${vid}` : (pubId ? `p-${pubId}` : `u-${it.id}`)
  }

  function saveLastActiveFor(_m: FeedMode, _idx: number) { return }

  function readLastActive(_m: FeedMode): LastActive | null { return null }

  function readVideoProgress(_videoId: string | null | undefined): number | null { return null }

  function writeLastFeed(_spaceUlid: string | null | undefined) { return }
  function writeLastFeedGlobal() { return }
  function readLastFeed(): string | null { return null }

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
  const canonicalTargetRef = useRef<{ kind: 'group' | 'channel'; slug: string } | null>(parseCanonicalFromPath())
  const [canonicalNotFound, setCanonicalNotFound] = useState<boolean>(false)
  const [restoring, setRestoring] = useState<boolean>(false)
  const [restorePoster, setRestorePoster] = useState<string | null>(null)
  const firstVisitKeyRef = useRef<string | null>(null)
  const didInitLastFeedRef = useRef<boolean>(false)
  // Debug: per-slide render counters (keyed by slideId)
  const slideRenderCountRef = useRef<Record<string, number>>({})

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
    indexReasonRef.current = 'snapshot-restore'
    setIndex(Math.max(0, Math.min(snap.index, snap.items.length - 1)))
    // Reanchor by index using layout timing and show a poster overlay to prevent flashes
    const anchor = snap.items[Math.max(0, Math.min(snap.index, snap.items.length - 1))]
    const poster = (isPortrait ? (anchor?.posterPortrait || anchor?.posterLandscape) : (anchor?.posterLandscape || anchor?.posterPortrait)) || null
    setRestorePoster(poster)
    setRestoring(true)
    requestAnimationFrame(() => {
      const targetIndex = Math.max(0, Math.min(snap.index, snap.items.length - 1))
      try { reanchorToIndex(targetIndex, { immediate: true, reason: 'snapshot-restore' }) } catch {}
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
      try {
        const meta = {
          personal: Boolean(data.personal),
          global: Boolean(data.global),
          groups: Array.isArray(data.groups) ? data.groups.length : 0,
          channels: Array.isArray(data.channels) ? data.channels.length : 0,
        }
        debug.log('feed', 'spaces loaded', meta)
        const summarize = (list: SpaceSummary[] | undefined | null) =>
          (Array.isArray(list) ? list : []).map((s) => ({ id: s.id, slug: s.slug, type: s.type, rel: s.relationship }))
        debug.log('perm', 'spaces summary', {
          authed: isAuthed,
          personal: data.personal ? { id: data.personal.id, slug: data.personal.slug, type: data.personal.type, rel: data.personal.relationship } : null,
          global: data.global ? { id: data.global.id, slug: data.global.slug, type: data.global.type, rel: data.global.relationship } : null,
          groups: summarize(data.groups),
          channels: summarize(data.channels),
        })
      } catch {}
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
        try {
          debug.log('auth', 'me loaded', { userId: data.userId })
          debug.log('perm', 'me roles', {
            userId: data.userId,
            email: data.email,
            roles: data.roles,
            isSiteAdmin: Boolean(data.isSiteAdmin),
            spaceRoles: data.spaceRoles,
            personalSpaceId: data.personalSpace?.id ?? null,
          })
        } catch {}
      } catch {
        if (canceled) return
        setMe(null)
        setIsAuthed(false)
        setMyUserId(null)
        setSpaceList(null)
        setSpacesLoaded(false)
        setSpacesError(null)
        setFeedMode((prev) => (prev.kind === 'space' ? { kind: 'global' } : prev))
      } finally { if (!canceled) setMeLoaded(true) }
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

  // If the path is canonical (/groups/:slug or /channels/:slug), prefer it over localStorage restore.
  useEffect(() => {
    const target = canonicalTargetRef.current
    if (!target) return
    if (!spaceList) return
    try {
      const pool = target.kind === 'group' ? (spaceList?.groups || []) : (spaceList?.channels || [])
      let match = pool.find((s) => (s.slug || '') === target.slug)
      // Special-case: Global Feed channel may be exposed via `spaceList.global`
      if (!match && target.kind === 'channel' && spaceList.global && (spaceList.global.slug || '') === target.slug) {
        match = spaceList.global
      }
      // Mark init done to prevent LS-based restore when canonical is present
      didInitLastFeedRef.current = true
      if (match) {
        setCanonicalNotFound(false)
        setFeedMode({ kind: 'space', spaceId: match.id, spaceUlid: match.ulid || null })
      } else if (spacesLoaded && !spacesLoading) {
        setCanonicalNotFound(true)
        // Keep global feed visible but show a simple not-found hint via UI
      }
    } catch {}
  }, [spaceList, spacesLoaded, spacesLoading])

  // Disable persisting last selected feed in localStorage
  useEffect(() => { /* localStorage disabled */ }, [feedMode.kind, feedMode.spaceUlid])

  // Disable restoring last selected feed from localStorage
  useEffect(() => { /* localStorage disabled */ }, [spaceList, myUserId, feedMode.kind])

  useEffect(() => {
    let canceled = false
    const load = async () => {
      // Ensure user identity is known so durable restore can read user‑scoped keys
      if (myUserId == null) return
      // If a canonical path is present but we haven't switched to its feed yet, defer loading
      if (canonicalTargetRef.current && feedMode.kind === 'global') {
        return
      }
      // Fast restore path: reuse prior UI state when available to avoid visible rewind
      if (!canceled && tryRestoreFor(feedMode)) {
        return
      }
      try {
        const perfLabel = `feed load:${feedMode.kind}`
        try { debug.time('perf', perfLabel) } catch {}
        setInitialLoading(true)
        setLoadingMore(false)
        let nextCursor: string | null = null
        let fetchedItems: UploadItem[] = []
        if (feedMode.kind === 'space') {
          const pin = readPinFromUrl()
          const { items: page, nextCursor: cursorStr } = await fetchSpaceFeed(feedMode.spaceId, { pinProductionUlid: pin })
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
        // Seed per-user like/comment state from feed metadata when available.
        try {
          const likeSeeds: Record<number, boolean> = {}
          const commentSeeds: Record<number, boolean> = {}
          const reportSeeds: Record<number, boolean> = {}
          for (const it of fetchedItems) {
            if (it.publicationId != null) {
              if (typeof it.likedByMe === 'boolean') {
                likeSeeds[it.publicationId] = it.likedByMe
              }
              if (typeof it.commentedByMe === 'boolean') {
                commentSeeds[it.publicationId] = it.commentedByMe
              }
              if (typeof it.reportedByMe === 'boolean') {
                reportSeeds[it.publicationId] = it.reportedByMe
              }
            }
          }
          if (Object.keys(likeSeeds).length) {
            setLikedMap((prev) => ({ ...prev, ...likeSeeds }))
          }
          if (Object.keys(commentSeeds).length) {
            setCommentedByMeMap((prev) => ({ ...prev, ...commentSeeds }))
          }
          if (Object.keys(reportSeeds).length) {
            setReportedMap((prev) => ({ ...prev, ...reportSeeds }))
          }
        } catch {}
        // Tag the feed key for which these items belong so we can guard saves
        itemsFeedKeyRef.current = feedKey(feedMode)
        setItems(fetchedItems)
        setCursor(nextCursor)
        // Determine initial index: URL hash > localStorage > default 0
        let targetIndex = 0
        let seekMs: number | null = null
        // Do not restore last video/position when a canonical path is active
        if (!suppressDurableRestoreRef.current && !canonicalTargetRef.current) {
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
        indexReasonRef.current = 'initial-load'
        setIndex(targetIndex)
        const fk = firstVisitKeyRef.current
        if (fk && fk === feedKey(feedMode)) {
          const anchor = fetchedItems[Math.max(0, Math.min(targetIndex, fetchedItems.length - 1))]
          const poster = (isPortrait ? (anchor?.posterPortrait || anchor?.posterLandscape) : (anchor?.posterLandscape || anchor?.posterPortrait)) || null
          setRestorePoster(poster)
          restoringRef.current = true
          setRestoring(true)
          requestAnimationFrame(() => {
            try { reanchorToIndex(targetIndex, { immediate: true, reason: 'initial-load' }) } catch {}
            const v = getVideoEl(targetIndex)
            let doneOnce = false
            const done = () => {
              if (doneOnce) return; doneOnce = true
              setRestoring(false)
              restoringRef.current = false
              setRestorePoster(null)
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
          restoringRef.current = true
          requestAnimationFrame(() => {
            try { reanchorToIndex(targetIndex, { immediate: true, reason: 'initial-load' }) } catch {}
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
        try { debug.timeEnd('perf', `feed load:${feedMode.kind}`) } catch {}
        if (!canceled) setInitialLoading(false)
      }
    }
    load()
    return () => { canceled = true }
  }, [feedMode, mineOnly, myUserId, spacesLoaded])

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

  const logSlides = (event: string, meta?: Record<string, any>) => {
    try {
      if (!debug.enabled('slides')) return
      debug.log('slides', event, meta, { ctx: 'scroll' })
    } catch {}
  }

  type GestureKind = 'tap' | 'swipeUp' | 'swipeDown' | 'none'

  function classifyGesture(): GestureKind {
    const dy = touchLastYRef.current - touchStartYRef.current
    const dx = touchLastXRef.current - touchStartXRef.current
    const dt = Math.max(1, touchLastTRef.current - touchStartTRef.current)
    const absDy = Math.abs(dy)
    const absDx = Math.abs(dx)

    // Very small, quick movement: treat as tap.
    const TAP_DIST = 8 // px
    const TAP_TIME = 250 // ms
    if (absDy <= TAP_DIST && absDx <= TAP_DIST && dt <= TAP_TIME) {
      return 'tap'
    }

    // Only consider as vertical swipe if vertical motion clearly dominates horizontal.
    const dominantVertical = absDy >= absDx * 1.5
    const SWIPE_DIST = 20 // px
    const SWIPE_VEL = 0.3 // px/ms
    const vmag = absDy / dt

    if (dominantVertical && (absDy >= SWIPE_DIST || vmag >= SWIPE_VEL)) {
      return dy < 0 ? 'swipeUp' : 'swipeDown'
    }

    return 'none'
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

  // Track fullscreen changes for the current video's element
  useEffect(() => {
    const v = getVideoEl(index) as any
    if (!v) return
    const onDocFsChange = () => {
      try {
        const curFsEl: any = (document as any).fullscreenElement || (document as any).webkitFullscreenElement || null
        if (curFsEl && v && curFsEl === v) setFsIndex(index)
        else setFsIndex((prev) => (prev === index ? null : prev))
      } catch {}
    }
    const onWebkitBegin = () => { try { setFsIndex(index) } catch {} }
    const onWebkitEnd = () => { try { setFsIndex((prev) => (prev === index ? null : prev)) } catch {} }
    try { document.addEventListener('fullscreenchange', onDocFsChange) } catch {}
    try { (document as any).addEventListener?.('webkitfullscreenchange', onDocFsChange) } catch {}
    try { v.addEventListener?.('webkitbeginfullscreen', onWebkitBegin) } catch {}
    try { v.addEventListener?.('webkitendfullscreen', onWebkitEnd) } catch {}
    return () => {
      try { document.removeEventListener('fullscreenchange', onDocFsChange) } catch {}
      try { (document as any).removeEventListener?.('webkitfullscreenchange', onDocFsChange) } catch {}
      try { v.removeEventListener?.('webkitbeginfullscreen', onWebkitBegin) } catch {}
      try { v.removeEventListener?.('webkitendfullscreen', onWebkitEnd) } catch {}
    }
  }, [index])

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
    // Only trust server-provided signal for a true landscape variant.
    // Portrait-only assets do not include posterLandscape; never infer from
    // fabricated masterLandscape URLs.
    const lp = it.posterLandscape
    return Boolean(lp && lp.length)
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

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    try {
      if ((e as any).cancelable) e.preventDefault()
    } catch {}
    const now = Date.now()
    const dt = now - lastWheelAtRef.current
    if (dt > 400) {
      wheelDeltaAccumRef.current = 0
    }
    wheelDeltaAccumRef.current += e.deltaY
    lastWheelAtRef.current = now
    const THRESHOLD = 40
    if (wheelDeltaAccumRef.current > THRESHOLD) {
      wheelDeltaAccumRef.current = 0
      if (index < items.length - 1) {
        indexReasonRef.current = 'wheel-next'
        reanchorToIndex(index + 1)
      }
    } else if (wheelDeltaAccumRef.current < -THRESHOLD) {
      wheelDeltaAccumRef.current = 0
      if (index > 0) {
        indexReasonRef.current = 'wheel-prev'
        reanchorToIndex(index - 1)
      }
    }
  }

  const slides = useMemo(
    () =>
      items.map((it, i) => {
        // Determine asset capabilities once per item
        const hasLandscape = itemHasLandscape(it)
        // Choose poster to match the asset orientation, not device orientation,
        // so the poster aspect aligns with the frame (prevents visual shrink).
        const desired = hasLandscape ? it.posterLandscape : it.posterPortrait
        const fallback = hasLandscape ? it.posterPortrait : it.posterLandscape
        const useUrl =
          (desired && posterAvail[desired] !== false ? desired : undefined) ||
          (fallback && posterAvail[fallback] !== false ? fallback : undefined)
        // Derive stable attributes for DOM anchoring and analytics
        const vid = (it as any).videoId ? String((it as any).videoId) : null
        const pubId = it.publicationId != null ? String(it.publicationId) : null
        const slideId = vid ? `v-${vid}` : (pubId ? `p-${pubId}` : `u-${it.id}`)
        // Debug: render decision with counters and dependency hints
        try {
          if (debug.enabled('slides')) {
            const cnt = (slideRenderCountRef.current[slideId] || 0) + 1
            slideRenderCountRef.current[slideId] = cnt
            const liked = it.publicationId != null ? likedMap[it.publicationId] : undefined
            const likesCount = it.publicationId != null ? likesCountMap[it.publicationId] : undefined
            const commented = it.publicationId != null ? commentedByMeMap[it.publicationId] : undefined
            const commentsCount = it.publicationId != null ? commentsCountMap[it.publicationId] : undefined
            const deps = {
              liked,
              likesCount,
              commented,
              commentsCount,
              started: startedMap[i] || false,
              playingIndex,
              isAuthed,
              mode: feedMode.kind,
              posterAvailDesired: Boolean(desired && posterAvail[desired] !== false),
              posterAvailFallback: Boolean(fallback && posterAvail[fallback] !== false),
            }
            debug.log(
              'slides',
              'render slide',
              { i, n: cnt, slideId, active: i === index, warm: i === index + 1, portrait: isPortrait, deps },
              { id: slideId, ctx: 'render' }
            )
          }
        } catch {}
        // Choose manifest based on device orientation, but only use landscape variant
        // when the asset truly has a landscape output. Portrait-only assets should
        // continue using the portrait stream even in landscape device orientation.
        // Always play the asset's canonical orientation stream:
        // - Landscape assets: use landscape master in both device orientations
        // - Portrait assets: use portrait master in both device orientations
        const manifestSrc = hasLandscape
          ? (it.masterLandscape || it.url || it.masterPortrait || '')
          : (it.masterPortrait || it.url || '')
        const isLandscapeAsset = hasLandscape
        const isPortraitAsset = !isLandscapeAsset
        const isActive = i === index
        const isWarm = i === index + 1
        const isPrewarm = i === index + 2
        const isPrewarmFar = i > index + 2 && i <= index + 5
        const isLinger = i === index - 1
        // Suppress warming until items belong to the active feed and restore is done
        const allowWarm = Boolean(itemsFeedKeyRef.current && itemsFeedKeyRef.current === feedKey(feedMode) && !restoringRef.current)
        const initials = (() => {
          const name = (it.ownerName || it.ownerEmail || '').trim()
          if (!name) return '?'
          const parts = name.split(/\s+/).filter(Boolean)
          if (!parts.length) return name.slice(0, 1).toUpperCase()
          if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
          return (parts[0][0] + parts[1][0]).toUpperCase()
        })()
        const slideSpaceId = feedMode.kind === 'space' ? feedMode.spaceId : (it.spaceId ?? null)
        const slideSpace = slideSpaceId != null ? findSpaceSummaryById(slideSpaceId) : null
        const fk = followKey(slideSpaceId, it.ownerId ?? null)
        const slideFollowing = fk ? !!followMap[fk] : false
        const canInlineFollow =
          !!slideSpace &&
          (slideSpace.type === 'group' || slideSpace.type === 'channel') &&
          isAuthed &&
          it.ownerId != null &&
          it.ownerId !== myUserId
        const showInlineFollow = canInlineFollow && !slideFollowing
        const alreadyReported =
          it.publicationId != null
            ? (reportedMap[it.publicationId] ?? (typeof it.reportedByMe === 'boolean' ? it.reportedByMe : false))
            : false
        return (
          <div
            key={slideId}
            className={styles.slide}
            id={slideId}
            data-video-id={vid || undefined}
            data-publication-id={pubId || undefined}
            data-upload-id={String(it.id)}
          >
            <div className={styles.holder}>
              {/* Simple frame that fills the slide; poster/video contain within */}
              <div className={styles.frame}>
                {useUrl ? (
                  <img src={useUrl} alt="" draggable={false} className={clsx(styles.poster, (isPortrait && isPortraitAsset) ? styles.fitCover : styles.fitContain)} />
                ) : null}
                {(isActive || (allowWarm && (isWarm || isPrewarm || isPrewarmFar || isLinger))) ? (
                  <FeedVideo
                    src={manifestSrc}
                    active={isActive}
                    warm={isWarm || isPrewarm || isPrewarmFar || isLinger}
                    warmMode={isActive ? 'none' : (isWarm ? 'buffer' : 'attach')}
                    debugId={vid || slideId}
                    muted={false}
                    poster={useUrl}
                    className={clsx(styles.video, (isPortrait && isPortraitAsset) ? styles.fitCover : styles.fitContain)}
                    data-video-id={vid || undefined}
                    onTouchStart={(e) => {
                      try {
                        const t = e.touches && e.touches[0]
                        if (t) {
                          touchStartXRef.current = t.clientX
                          touchStartYRef.current = t.clientY
                          touchLastXRef.current = t.clientX
                          touchLastYRef.current = t.clientY
                          const nowTs = Date.now()
                          touchStartTRef.current = nowTs
                          touchLastTRef.current = nowTs
                          dragStartOffsetRef.current = railOffsetRef.current || 0
                          isDraggingRef.current = false
                          dragThresholdPassedRef.current = false
                        }
                      } catch {}
                    }}
                    onTouchMove={(e) => {
                      try {
                        const t = e.touches && e.touches[0]
                        if (t) {
                          const now = Date.now()
                          touchLastXRef.current = t.clientX
                          touchLastYRef.current = t.clientY
                          touchLastTRef.current = now
                          if (i !== index) return
                          const dyTotal = t.clientY - touchStartYRef.current
                          if (!dragThresholdPassedRef.current && Math.abs(dyTotal) > 5) {
                            dragThresholdPassedRef.current = true
                            isDraggingRef.current = true
                          }
                          if (isDraggingRef.current) {
                            const r = railRef.current
                            const h = getSlideHeight()
                            if (r && h > 0 && items.length > 0) {
                              const maxOffset = 0
                              const minOffset = -h * Math.max(0, items.length - 1)
                              const nextOffset = Math.min(maxOffset, Math.max(minOffset, dragStartOffsetRef.current + dyTotal))
                              railOffsetRef.current = nextOffset
                              try {
                                r.style.transition = 'none'
                                r.style.transform = `translate3d(0, ${nextOffset}px, 0)`
                              } catch {}
                              try { if ((e as any).cancelable) e.preventDefault() } catch {}
                            }
                          }
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
                        // If warm element exists, start playback under this gesture before promotion
                        if (v) {
                          try {
                            setStartedMap((prev) => (prev[i] ? prev : { ...prev, [i]: true }))
                            setPlayingIndex(i)
                            v.muted = false
                            void v.play()
                          } catch {}
                        } else {
                          setPendingPlayIndex(i)
                        }
                        try {
                          indexReasonRef.current = 'tap-promote'
                          reanchorToIndex(i, { reason: 'tap-promote' })
                        } catch {}
                        return
                      }
                      if (!v) { setPendingPlayIndex(i); return }
                      if (!unlocked) setUnlocked(true)
                      try {
                        debug.log('feed', 'click video toggle', { i, wasPaused: v.paused, ended: v.ended, currentSrc: (v as any).currentSrc, src: v.getAttribute('src'), slideId }, { id: slideId })
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
                      lastTouchTsRef.current = now
                      const kind = classifyGesture()
                      const dy = touchLastYRef.current - touchStartYRef.current // +down, -up
                      const didDrag = dragThresholdPassedRef.current && isDraggingRef.current && i === index
                      let handled = false
                      if (didDrag) {
                        let targetIndex = index
                        if (kind === 'swipeUp') {
                          targetIndex = Math.min(items.length - 1, index + 1)
                        } else if (kind === 'swipeDown') {
                          targetIndex = Math.max(0, index - 1)
                        }
                        indexReasonRef.current = targetIndex === index ? 'drag-cancel' : (kind === 'swipeUp' ? 'drag-swipe-up' : kind === 'swipeDown' ? 'drag-swipe-down' : 'drag-cancel')
                        try { reanchorToIndex(targetIndex, { reason: indexReasonRef.current }) } catch {}
                        handled = true
                      }
                      isDraggingRef.current = false
                      dragThresholdPassedRef.current = false
                      if (handled) return
                      // No drag-based snap; interpret as tap or swipe from the classifier.
                      if (kind === 'swipeUp' || kind === 'swipeDown') {
                        const dir = kind === 'swipeUp' ? 1 : -1
                        const targetIndex = Math.max(0, Math.min(items.length - 1, index + dir))
                        if (targetIndex !== index) {
                          indexReasonRef.current = kind === 'swipeUp' ? 'swipe-up' : 'swipe-down'
                          try { reanchorToIndex(targetIndex, { reason: indexReasonRef.current }) } catch {}
                          return
                        }
                        // If swipe resolved to same index, fall through to tap behavior.
                      }
                      const v = getVideoEl(i)
                      if (i !== index) {
                        if (v) {
                          try {
                            setStartedMap((prev) => (prev[i] ? prev : { ...prev, [i]: true }))
                            setPlayingIndex(i)
                            v.muted = false
                            void v.play()
                          } catch {}
                        } else {
                          setPendingPlayIndex(i)
                        }
                        try {
                          indexReasonRef.current = 'swipe-promote'
                          reanchorToIndex(i, { reason: 'swipe-promote' })
                        } catch {}
                        return
                      }
                      if (!v) { setPendingPlayIndex(i); return }
                      if (!unlocked) setUnlocked(true)
                      try {
                        debug.log('feed', 'touch video toggle', { i, wasPaused: v.paused, ended: v.ended, currentSrc: (v as any).currentSrc, src: v.getAttribute('src'), slideId }, { id: slideId })
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
                  />
                ) : null}
              </div>
              {/* Click placeholder to promote inactive slide (outside frame) */}
              {!(isActive || (allowWarm && (isWarm || isPrewarm || isPrewarmFar || isLinger))) && (
                // Placeholder holder without a video element; clicking will reanchor and mount HLSVideo
                <div
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingPlayIndex(i)
                    try {
                      indexReasonRef.current = 'placeholder-promote'
                      reanchorToIndex(i, { reason: 'placeholder-promote' })
                    } catch {}
                  }}
                />
              )}
              {/* Right-side action column */}
              {it.publicationId != null && (
                <div
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: '40%',
                    transform: 'translateY(-50%)',
                    display: 'grid',
                    gap: 34,
                    alignItems: 'center',
                    justifyItems: 'center',
                    zIndex: 5,
                  }}
                >
                  {it.ownerId != null && (
                    <div className={styles.authorAvatarWrap}>
                      <button
                        type="button"
                        className={styles.authorAvatar}
                        onClick={() =>
                          openProfilePeek(
                            it.ownerId ?? null,
                            slideSpaceId,
                            it.ownerName ?? null,
                            it.ownerAvatarUrl ?? null,
                          )
                        }
                        title={it.ownerName ? `View ${it.ownerName}` : 'View author'}
                      >
                        {it.ownerAvatarUrl ? (
                          <img src={it.ownerAvatarUrl} alt={it.ownerName || it.ownerEmail || 'Author avatar'} />
                        ) : (
                          <span className={styles.authorInitials}>{initials}</span>
                        )}
                      </button>
                      {showInlineFollow && slideSpaceId != null && (
                        <button
                          type="button"
                          className={styles.authorFollowButton}
                          onClick={(e) => {
                            e.stopPropagation()
                            const uid = it.ownerId
                            if (!uid) return
                            const sid = slideSpaceId
                            const key = followKey(sid, uid)
                            if (!sid || !key) return
                            const csrf = getCsrfToken()
                            // optimistic: mark as following so button disappears
                            setFollowMap((m) => ({ ...m, [key]: true }))
                            ;(async () => {
                              try {
                                const res = await fetch(`/api/spaces/${sid}/users/${uid}/follow`, {
                                  method: 'POST',
                                  headers: { ...(csrf ? { 'x-csrf-token': csrf } : {}) },
                                  credentials: 'same-origin',
                                })
                                if (!res.ok) throw new Error('inline_follow_failed')
                                const data = await res.json()
                                const serverFollowing = Boolean(data?.following)
                                setFollowMap((m) => ({ ...m, [key]: serverFollowing }))
                              } catch {
                                // rollback
                                setFollowMap((m) => {
                                  const copy = { ...m }
                                  delete copy[key]
                                  return copy
                                })
                              }
                            })()
                          }}
                          aria-label="Follow author in this space"
                        >
                          +
                        </button>
                      )}
                    </div>
                  )}
                  {isGlobalBillboard ? (
                    <div style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
                      <button
                        aria-label={'Jump to space'}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (it.publicationId == null) return
                          setJumpForPub(it.publicationId)
                          setJumpPinUlid(it.productionUlid ?? null)
                          setJumpOpen(true)
                        }}
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
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                          <path d="M7 17L17 7" />
                          <path d="M9 7h8v8" />
                        </svg>
                      </button>
                      <div style={{ fontSize: 12, opacity: 0.85 }}>Jump</div>
                    </div>
                  ) : (
                    <>
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
	                    </>
	                  )}
	                  {it.hasCaptions === true && it.publicationId != null ? (
	                    <div style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
	                      <button
	                        aria-label={captionsEnabled ? 'Hide captions' : 'Show captions'}
	                        aria-pressed={captionsEnabled ? true : false}
	                        onClick={(e) => { e.stopPropagation(); persistCaptionsEnabled(!captionsEnabled) }}
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
	                        <span className={clsx(styles.ccBadge, captionsEnabled ? styles.ccBadgeOn : null)}>CC</span>
	                      </button>
	                      <div style={{ fontSize: 12, opacity: 0.85 }}>CC</div>
	                    </div>
	                  ) : null}
	                  <div style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
	                    <button
	                      aria-label={alreadyReported ? 'Reported' : 'Report'}
	                      aria-pressed={alreadyReported ? true : false}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (it.publicationId == null) return
                        setReportForPub(it.publicationId)
                        setReportOpen(true)
                      }}
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
                      {alreadyReported ? (
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="#ff7043" stroke="#ff7043" strokeWidth="1.5" xmlns="http://www.w3.org/2000/svg">
                          <path d="M6 3h11a1 1 0 0 1 1 1v17l-6-3-6 3V4a1 1 0 0 1 1-1z" />
                        </svg>
                      ) : (
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" xmlns="http://www.w3.org/2000/svg">
                          <path d="M6 3h11a1 1 0 0 1 1 1v17l-6-3-6 3V4a1 1 0 0 1 1-1z" />
                        </svg>
                      )}
                    </button>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>{alreadyReported ? 'Sent' : 'Flag'}</div>
                  </div>
                </div>
              )}
              {/* Fullscreen toggle (active slide only; landscape assets only) */}
              {i === index && isLandscapeAsset && (
                <div className={styles.fullToggle}>
                  <button
                    aria-label={fsIndex === index ? 'Exit full screen' : 'Full screen'}
                    onClick={(e) => {
                      e.stopPropagation()
                      try {
                        const v = getVideoEl(index) as any
                        if (!v) return
                        const doc: any = document
                        if (fsIndex === index) {
                          if (doc.fullscreenElement || doc.webkitFullscreenElement) {
                            try { doc.exitFullscreen?.() } catch {}
                            try { doc.webkitExitFullscreen?.() } catch {}
                          }
                        } else {
                          if (v.requestFullscreen) {
                            v.requestFullscreen({ navigationUI: 'hide' } as any).catch(() => {})
                          } else if (v.webkitEnterFullscreen) {
                            try { v.webkitEnterFullscreen() } catch {}
                          }
                        }
                      } catch {}
                    }}
                    className={`btn btn--overlay btn--sm`}
                  >
                    {fsIndex === index ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 9H5V5" />
                        <path d="M15 9H19V5" />
                        <path d="M9 15H5V19" />
                        <path d="M15 15H19V19" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                        <path d="M16 3h3a2 2 0 0 1 2 2v3" />
                        <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
                        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
              {/* Creator name + optional story (transparent overlay) */}
              <div
                className={clsx(
                  styles.storyPanel,
                  it.publicationId != null && storyOpenForPub === it.publicationId ? styles.storyPanelExpanded : null
                )}
                onClick={(e) => {
                  // Prevent slide tap-to-play from triggering when interacting with the story UI.
                  e.stopPropagation()
                }}
              >
                <div className={styles.storyHeaderRow}>
                  <div className={styles.storyAuthor}>
                    {(it.ownerName || it.ownerEmail || 'Unknown').trim()}
                  </div>
                  {it.hasStory === true && it.publicationId != null ? (
                    <button
                      type="button"
                      className={styles.storyChevron}
                      aria-label={storyOpenForPub === it.publicationId ? 'Collapse story' : 'Expand story'}
                      aria-expanded={storyOpenForPub === it.publicationId}
                      onClick={async (e) => {
                        e.stopPropagation()
                        const pubId = it.publicationId
                        if (!pubId) return
                        if (storyOpenForPub === pubId) {
                          setStoryOpenForPub(null)
                          return
                        }
                        await ensureStory(pubId)
                        setStoryOpenForPub(pubId)
                      }}
                    >
                      {storyOpenForPub === it.publicationId ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                          <path d="M6 15l6-6 6 6" />
                        </svg>
                      )}
                    </button>
                  ) : null}
                </div>
                {it.hasStory === true ? (
                  storyOpenForPub === it.publicationId ? (
                    <div className={styles.storyBody}>
                      {(() => {
                        const pubId = it.publicationId!
                        if (storyBusyMap[pubId]) return 'Loading…'
                        if (Object.prototype.hasOwnProperty.call(storyTextMap, pubId)) {
                          const txt = storyTextMap[pubId]
                          return txt && txt.trim().length ? txt : 'No story.'
                        }
                        // Fallback (should be rare): show preview until fetch completes.
                        return (it.storyPreview || '').trim() || 'Loading…'
                      })()}
                    </div>
                  ) : (
                    <div className={styles.storyPreview}>{((it.storyPreview || '').trim() || '…')}</div>
                  )
                ) : null}
              </div>
              {playingIndex !== i && (
                <div aria-hidden className={styles.playHint}>
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
                    <polygon points="38,28 38,72 72,50" fill="#ffffff" fillOpacity="0.4" />
                  </svg>
                </div>
              )}
            </div>
          </div>
        )
      }),
    [items, index, isPortrait, posterAvail, playingIndex, startedMap, likesCountMap, likedMap, likeBusy, commentsCountMap, commentedByMeMap, reportedMap, isAuthed, feedMode, followMap, spaceList, myUserId, storyOpenForPub, storyTextMap, storyBusyMap, captionsEnabled]
  )

  // Debug: log index changes explicitly (outside slides memo)
  useEffect(() => {
    try {
      if (!debug.enabled('slides')) return
      const it = items[index]
      const slideId = it ? computeSlideId(it) : null
      const reason = indexReasonRef.current || 'unknown'
      debug.log('slides', 'index -> ' + index, { index, slideId, pubId: it?.publicationId ?? null, reason }, { ctx: 'index' })
    } catch {}
  }, [index, items])

  function reanchorToIndex(curIndex: number, opts?: { immediate?: boolean; reason?: string }) {
    const r = railRef.current
    if (!r || !items.length) return
    const clamped = Math.max(0, Math.min(items.length - 1, curIndex))
    const h = getSlideHeight()
    const targetOffset = -clamped * h
    const immediate = opts?.immediate ?? false
    const reason = opts?.reason
    logSlides('reanchor start', { index: clamped, offset: targetOffset, immediate, reason })
    try {
      if (immediate) {
        r.style.transition = 'none'
      } else {
        r.style.transition = 'transform 220ms ease-out'
      }
    } catch {}
    railOffsetRef.current = targetOffset
    try { r.style.transform = `translate3d(0, ${targetOffset}px, 0)` } catch {}
    if (reason) indexReasonRef.current = reason
    if (clamped !== index) setIndex(clamped)
    pauseNonCurrent(clamped)
    logSlides('reanchor end', { index: clamped, offset: targetOffset, immediate, reason })
  }

  useEffect(() => {
    try { reanchorToIndex(index, { immediate: true, reason: 'orientation-change' }) } catch {}
  }, [isPortrait])

  useEffect(() => {
    const handler = () => {
      try { reanchorToIndex(index, { immediate: true, reason: 'orientationchange-event' }) } catch {}
    }
    window.addEventListener('orientationchange', handler)
    return () => window.removeEventListener('orientationchange', handler)
  }, [index])

  // When a new feed of items is loaded (e.g., changing channels), reanchor decisively to the current index
  useEffect(() => {
    if (!items.length) return
    // Ensure we dock the current index (usually 0) immediately after items render
    const id = window.setTimeout(() => {
      try { reanchorToIndex(index, { immediate: true, reason: 'items-change' }) } catch {}
    }, 50)
    return () => window.clearTimeout(id)
  }, [itemsFeedKeyRef.current])

  // Load likes summary for the active slide when index changes
  useEffect(() => {
    if (!isAuthed) return
    if (isGlobalBillboard) return
    const it = items[index]
    if (it && it.publicationId != null) {
      ensureLikeSummary(it.publicationId)
    }
  }, [index, items, isAuthed, isGlobalBillboard])

  // LocalStorage disabled: no dwell-based persistence
  const persistTimerRef = useRef<number | null>(null)
  const schedulePersist = useCallback((_i: number) => { /* disabled */ }, [])

  useEffect(() => { /* disabled */ }, [index, schedulePersist])

  useEffect(() => { /* disabled */ }, [feedMode, index])

  // Load more items when the active index approaches the end of the list.
  useEffect(() => {
    if (!cursor) return
    if (loadingMore) return
    if (!items.length) return
    const remaining = items.length - index
    if (remaining >= 5) return
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
  }, [cursor, feedMode, index, items.length, loadingMore, mineOnly, myUserId])

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
    // Any explicit space selection should clear canonical deep-link mode
    try { canonicalTargetRef.current = null } catch {}
    try { saveLastActiveFor(feedMode, index) } catch {}
    saveSnapshot()
    const match = flattenSpaces(spaceList).find((s) => s.id === spaceId)
    const spaceUlid = match?.ulid ?? null
    // Update URL to canonical slug path when available, without leaving the Feed shell.
    try {
      if (match && match.slug && (match.type === 'group' || match.type === 'channel')) {
        const base = match.type === 'group' ? '/groups/' : '/channels/'
        const slug = encodeURIComponent(match.slug)
        const currentPath = window.location.pathname || '/'
        const targetPath = `${base}${slug}`
        if (currentPath !== targetPath) {
          window.history.pushState({}, '', targetPath)
        }
      }
    } catch {
      // If history manipulation fails, continue with in-place feed switch.
    }
    const target: FeedMode = { kind: 'space', spaceId, spaceUlid }
    if (!hasSnapshot(target)) {
      firstVisitKeyRef.current = feedKey(target)
      setRestorePoster(null)
      setRestoring(true)
      setIndex(0)
      setStartedMap({})
      setPlayingIndex(null)
      try { reanchorToIndex(0, { immediate: true, reason: 'space-switch' }) } catch {}
    } else {
      firstVisitKeyRef.current = null
    }
    // Persist last selected feed; do not modify the URL params
    if (!canonicalTargetRef.current && spaceUlid) { writeLastFeed(spaceUlid) }
    setFeedMode({ kind: 'space', spaceId, spaceUlid })
    setDrawerOpen(false)
  }

  // Legacy feed removed

  const handleSelectGlobal = () => {
    // User explicitly chose Global; exit canonical deep-link mode and normalize URL.
    try { canonicalTargetRef.current = null } catch {}
    try { saveLastActiveFor(feedMode, index) } catch {}
    saveSnapshot()
    const target: FeedMode = { kind: 'global' }
    try {
      const currentPath = window.location.pathname || '/'
      if (currentPath !== '/' && currentPath !== '') {
        window.history.pushState({}, '', '/')
      }
    } catch {
      // If history manipulation fails, continue with in-place feed switch.
    }
    if (!hasSnapshot(target)) {
      firstVisitKeyRef.current = feedKey(target)
      setRestorePoster(null)
      setRestoring(true)
      setIndex(0)
      setStartedMap({})
      setPlayingIndex(null)
      try { reanchorToIndex(0, { immediate: true, reason: 'global-switch' }) } catch {}
    } else {
      firstVisitKeyRef.current = null
    }
    // Persist last selected feed as global
    if (!canonicalTargetRef.current) { writeLastFeedGlobal() }
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
    { label: 'Assets', href: '/assets', enabled: true },
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
        authLoaded={meLoaded}
        isSiteAdmin={Boolean(me?.isSiteAdmin)}
        hasAnySpaceAdmin={Boolean(me?.hasAnySpaceAdmin)}
        hasAnySpaceModerator={Boolean(me?.hasAnySpaceModerator)}
        mineOnly={mineOnly}
        onChangeMineOnly={(checked) => setMineOnly(checked)}
        navLinks={navLinks}
        upcomingLinks={upcomingLinks}
        renderSpacesPanel={renderSpacesPanel}
        onPrefetch={prefetchForHref}
        activeSpaceId={activeSpaceId}
        isGlobalActive={isGlobalBillboard}
        onSelectGlobal={() => {
          handleSelectGlobal()
          setDrawerOpen(false)
        }}
        onSelectSpace={(sid) => {
          handleSelectSpace(sid)
          setDrawerOpen(false)
        }}
      />
      {/* Canonical slug not found notice */}
      {canonicalNotFound && (
        <div style={{ position: 'fixed', top: 'calc(var(--header-h, 44px) + 6px)', left: 8, right: 8, zIndex: 20, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'rgba(33,33,33,0.96)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 14 }}>
            {(canonicalTargetRef.current?.kind === 'group' ? 'Group' : 'Channel')} “{canonicalTargetRef.current?.slug}” not found or no access.
          </div>
        </div>
      )}
      {/* Tap-to-start overlay removed per requirements */}
      <div
        ref={viewportRef}
        onWheel={onWheel}
        style={{
          position: 'fixed',
          top: 'var(--header-h, calc(env(safe-area-inset-top, 0px) + 28px))',
          left: 0,
          right: 0,
          bottom: 0,
          overflow: 'hidden',
          WebkitOverflowScrolling: 'auto',
          touchAction: 'none',
          overscrollBehavior: 'none',
        }}
      >
        <div
          ref={railRef}
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            willChange: 'transform',
            transform: 'translate3d(0, 0, 0)',
          }}
        >
          {slides.length ? (
            slides
          ) : (
            <div style={{ color: '#fff', padding: 20 }}>
              {initialLoading ? 'Loading…' : 'No videos yet.'}
            </div>
          )}
	        </div>
	      </div>
	      {(() => {
	        const active = items[captionsSlideIndex]
	        const pubId = active?.publicationId != null ? Number(active.publicationId) : null
	        const show =
	          captionsEnabled &&
	          !!captionText &&
	          pubId != null &&
	          active?.hasCaptions === true &&
	          storyOpenForPub !== pubId
	        if (!show) return null
	        return (
	          <div className={styles.captionsOverlay} aria-hidden>
	            <div className={styles.captionsPill}>{captionText}</div>
	          </div>
	        )
	      })()}
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
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              background: '#fff',
              borderTop: '1px solid rgba(0,0,0,0.15)',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              maxHeight: '70vh',
              display: 'grid',
              gridTemplateRows: 'auto 1fr auto',
              color: '#000',
            }}
          >
            <div
              style={{
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                color: '#000',
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {(() => {
                  const total =
                    commentsForPub != null && commentsCountMap[commentsForPub] != null
                      ? commentsCountMap[commentsForPub]!
                      : commentsItems.length
                  const label = total === 1 ? '1 comment' : `${total} comments`
                  return label
                })()}
              </div>
              {/* Sort (hamburger) button */}
              <button
                onClick={() => setCommentsSortOpen((v) => !v)}
                style={{
                  position: 'absolute',
                  right: 56,
                  top: 12,
                  background: 'transparent',
                  border: 'none',
                  padding: 4,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Sort comments"
              >
                <div
                  style={{
                    width: 20,
                    height: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ height: 2, background: '#000', borderRadius: 2 }} />
                  <span style={{ height: 2, background: '#000', borderRadius: 2 }} />
                  <span style={{ height: 2, background: '#000', borderRadius: 2 }} />
                </div>
              </button>
              <button
                onClick={() => setCommentsOpen(false)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: 12,
                  background: 'transparent',
                  color: '#000',
                  border: '1px solid rgba(0,0,0,0.25)',
                  borderRadius: 999,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
              {commentsSortOpen && (
                <div
                  style={{
                    position: 'absolute',
                    right: 56,
                    top: 44,
                    background: '#fff',
                    border: '1px solid rgba(0,0,0,0.2)',
                    borderRadius: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                    minWidth: 120,
                    zIndex: 10,
                    overflow: 'hidden',
                  }}
                >
                  {(['newest', 'oldest'] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => {
                        if (commentsOrder === opt) {
                          setCommentsSortOpen(false)
                          return
                        }
                        setCommentsOrder(opt)
                        setCommentsSortOpen(false)
                        if (commentsForPub != null) {
                          void loadMoreComments(commentsForPub, opt, true)
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        width: '100%',
                        padding: '8px 10px',
                        background: commentsOrder === opt ? 'rgba(0,0,0,0.04)' : '#fff',
                        border: 'none',
                        borderBottom: opt === 'newest' ? '1px solid rgba(0,0,0,0.08)' : 'none',
                        color: '#000',
                        fontSize: 14,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ width: 18, marginRight: 6 }}>
                        {commentsOrder === opt ? '✓' : ''}
                      </span>
                      <span>{opt === 'newest' ? 'Newest' : 'Oldest'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ overflowY: 'auto' }}>
              {commentsItems.length === 0 && !commentsLoading ? (
                <div style={{ padding: 16, color: '#555' }}>No comments yet. Be the first!</div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {commentsItems.map((c) => (
                    <li
                      key={c.id}
                      style={{
                        padding: '10px 14px',
                        borderBottom: '1px solid rgba(0,0,0,0.06)',
                        color: '#000',
                      }}
                    >
                      <div style={{ fontSize: 14, opacity: 0.9 }}>{c.displayName || c.email || `User ${c.userId}`}</div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.35, marginTop: 4 }}>{c.body}</div>
                      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6, color: '#555' }}>
                        {new Date(c.createdAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
                {commentsCursor ? (
                  <button
                    disabled={commentsLoading}
                    onClick={() => loadMoreComments()}
                    style={{
                      background: '#f0f0f0',
                      color: '#000',
                      border: '1px solid rgba(0,0,0,0.25)',
                      borderRadius: 8,
                      padding: '6px 10px',
                    }}
                  >
                    {commentsLoading ? 'Loading…' : 'Load More'}
                  </button>
                ) : (
                  <span style={{ fontSize: 12, opacity: 0.7, color: '#666' }}>End of comments</span>
                )}
              </div>
            </div>
            <div
              style={{
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 6,
              }}
            >
              <textarea
                value={commentText}
                onChange={(e) => setCommentText((e.target as any).value)}
                onFocus={() => { setCommentRows(3); try { (document.activeElement as any)?.scrollIntoView?.({ block: 'nearest' }) } catch {}; setTimeout(() => window.scrollTo?.(0, document.body.scrollHeight), 0) }}
                onBlur={() => { if (!commentText.trim()) { setCommentRows(1) } }}
                placeholder={isAuthed ? 'Write a comment…' : 'Sign in to comment'}
                disabled={!isAuthed || commentBusy}
                rows={commentRows}
                style={{
                  flex: 1,
                  background: '#f5f5f5',
                  color: '#000',
                  border: '1px solid rgba(0,0,0,0.2)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 16,
                  lineHeight: 1.35,
                  resize: 'none' as any,
                  outline: 'none',
                }}
              />
              <button
                onClick={submitComment}
                disabled={!isAuthed || commentBusy || !commentText.trim()}
                style={{
                  alignSelf: 'flex-end',
                  background: '#1976d2',
                  color: '#fff',
                  border: '1px solid rgba(0,0,0,0.2)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  marginTop: 2,
                }}
              >
                {commentBusy ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}
      {peekOpen && (
        <div
          onClick={() => closeProfilePeek()}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 55,
            background: 'transparent',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            pointerEvents: 'auto',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(340px, 92vw)',
              marginTop: 'calc(var(--header-h, 44px) + 8px)',
              marginLeft: 8,
              background: 'rgba(15,15,15,0.96)',
              color: '#fff',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.3)',
              boxShadow: '0 6px 18px rgba(0,0,0,0.7)',
              padding: 12,
              fontSize: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.35)',
                  background: 'rgba(0,0,0,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {peekProfile?.avatarUrl ? (
                  <img
                    src={peekProfile.avatarUrl}
                    alt={peekProfile.displayName || 'Profile avatar'}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span style={{ fontSize: 20, fontWeight: 600, opacity: 0.85 }}>
                    {(peekProfile?.displayName || '?').slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                  {peekProfile?.displayName || 'Profile'}
                </div>
                {peekProfile?.memberSince && (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Member since {new Date(peekProfile.memberSince).toLocaleDateString()}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => closeProfilePeek()}
                style={{
                  background: 'transparent',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.4)',
                  borderRadius: 999,
                  padding: '4px 8px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            {peekError && (
              <div style={{ marginBottom: 8, fontSize: 12, color: '#ffb3b3' }}>{peekError}</div>
            )}
            {peekLoading && !peekError && (
              <div style={{ marginBottom: 8, fontSize: 12, opacity: 0.8 }}>Loading…</div>
            )}
            {peekProfile?.bio && !peekLoading && (
              <div style={{ fontSize: 13, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{peekProfile.bio}</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
              <a
                href={
                  peekProfile
                    ? (peekProfile as any).slug
                      ? `/users/${encodeURIComponent((peekProfile as any).slug)}`
                      : `/users/${peekProfile.userId}`
                    : '#'
                }
                style={{ fontSize: 13, color: '#9cf', textDecoration: 'none' }}
              >
                View full profile
              </a>
              {(() => {
                const space = peekSpaceId != null ? findSpaceSummaryById(peekSpaceId) : null
                const canFollow =
                  !!space && (space.type === 'group' || space.type === 'channel') && isAuthed && peekUserId != null && peekUserId !== myUserId
                if (!canFollow) return null
                const following = !!peekFollowing
                return (
                  <button
                    type="button"
                    disabled={peekFollowBusy}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const space = peekSpaceId != null ? findSpaceSummaryById(peekSpaceId) : null
                      const sid = space?.id
                      const uid = peekUserId
                      if (!sid || !uid) return
                      const currentlyFollowing = !!peekFollowing
                      const csrf = getCsrfToken()
                      setPeekFollowBusy(true)
                      setPeekFollowing(!currentlyFollowing)
                      const fk = followKey(sid ?? null, uid ?? null)
                      if (fk) {
                        setFollowMap((m) => ({ ...m, [fk]: !currentlyFollowing }))
                      }
                      setPeekFollowersCount((prev) => {
                        const base = typeof prev === 'number' ? prev : 0
                        const next = base + (currentlyFollowing ? -1 : 1)
                        return next < 0 ? 0 : next
                      })
                      ;(async () => {
                        try {
                          const method = currentlyFollowing ? 'DELETE' : 'POST'
                          const res = await fetch(`/api/spaces/${sid}/users/${uid}/follow`, {
                            method,
                            headers: { ...(csrf ? { 'x-csrf-token': csrf } : {}) },
                            credentials: 'same-origin',
                          })
                          if (!res.ok) throw new Error('follow_toggle_failed')
                          const data = await res.json()
                          const serverFollowing = Boolean(data?.following)
                          setPeekFollowing(serverFollowing)
                          if (fk) {
                            setFollowMap((m) => ({ ...m, [fk]: serverFollowing }))
                          }
                          const count =
                            data && typeof data.followersCount === 'number'
                              ? Number(data.followersCount)
                              : null
                          setPeekFollowersCount(count)
                        } catch {
                          // rollback
                          setPeekFollowing(currentlyFollowing)
                          if (fk) {
                            setFollowMap((m) => ({ ...m, [fk]: currentlyFollowing }))
                          }
                          setPeekFollowersCount((prev) => {
                            const base = typeof prev === 'number' ? prev : 0
                            const next = base + (currentlyFollowing ? 1 : -1)
                            return next < 0 ? 0 : next
                          })
                        } finally {
                          setPeekFollowBusy(false)
                        }
                      })()
                    }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 999,
                      border: '1px solid rgba(255,255,255,0.4)',
                      background: following ? 'rgba(33,150,243,0.3)' : 'rgba(0,0,0,0.4)',
                      color: '#fff',
                      fontSize: 13,
                      cursor: peekFollowBusy ? 'default' : 'pointer',
                    }}
                  >
                    {following ? 'Following' : 'Follow'}
                  </button>
                )
              })()}
            </div>
            {peekFollowersCount != null && peekSpaceId != null && (
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
                {peekFollowersCount} follower{peekFollowersCount === 1 ? '' : 's'} in this space
              </div>
            )}
          </div>
        </div>
      )}
      {reportOpen && reportForPub != null && (
        <React.Suspense
          fallback={
            <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.82)', color: '#fff', display: 'grid', placeItems: 'center' }}>
              Loading…
            </div>
          }
        >
          <LazyReportModal
            publicationId={reportForPub}
            onClose={() => { setReportOpen(false); setReportForPub(null) }}
            onReported={(pubId) => setReportedMap((m) => ({ ...m, [pubId]: true }))}
          />
        </React.Suspense>
      )}
      {jumpOpen && (
        <React.Suspense
          fallback={
            <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'transparent', color: '#fff', display: 'grid', placeItems: 'center' }}>
              Loading…
            </div>
          }
        >
          <LazyJumpToSpaceModal
            open={jumpOpen}
            publicationId={jumpForPub}
            pinProductionUlid={jumpPinUlid}
            onClose={() => { setJumpOpen(false); setJumpForPub(null); setJumpPinUlid(null) }}
          />
        </React.Suspense>
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
      
    </div>
  )
}
