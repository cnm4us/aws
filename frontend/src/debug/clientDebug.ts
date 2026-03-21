import { readClientDebugConfig } from './unifiedConfig'

export type ClientDebugLevel = 'debug' | 'info' | 'warn' | 'error'

export type ClientDebugPayload = {
  name: string
  at: string
  [key: string]: any
}

export type ClientDebugEventPayload = {
  ts: string
  category: string
  event: string
  level: ClientDebugLevel
  debug_event_id?: string | null
  debug_seq?: number | null
  path: string
  browser_session_id: string
  message_session_id?: string | null
  user_id?: number | null
  payload?: Record<string, any> | null
}

export type ClientDebugContext = {
  path: string
  messageSessionId?: string | null
  userId?: number | null
  surface?: string | null
  spaceId?: number | null
  spaceType?: string | null
  spaceSlug?: string | null
  spaceName?: string | null
}

export type StructuredClientDebugInput = {
  category: string
  event: string
  level?: ClientDebugLevel
  payload?: Record<string, any> | null
}

export type ClientDebugEnableOptions = {
  envFlag?: string
  queryParam?: string
  storageKey?: string
  globalFlag?: string
}

export type ClientDebugDomBridgeSpec = {
  domEventName: string
  category: string
}

const BROWSER_DEBUG_BATCH_SIZE = 20
const BROWSER_DEBUG_FLUSH_MS = 1_000
const DEBUG_LEVEL_ORDER: Record<ClientDebugLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const browserDebugQueue: ClientDebugEventPayload[] = []
let browserDebugFlushTimer: number | null = null
let browserDebugFlushInFlight: Promise<void> | null = null
let clientDebugSeq = 0

function readEnvFlag(name?: string): boolean {
  if (!name) return false
  try {
    return String((import.meta as any)?.env?.[name] || '').trim() === '1'
  } catch {
    return false
  }
}

export function isClientDebugEnabled(opts?: ClientDebugEnableOptions): boolean {
  try {
    if (readEnvFlag(opts?.envFlag)) return true
    if (typeof window === 'undefined') return false
    const qs = new URLSearchParams(window.location.search || '')
    if (opts?.queryParam && qs.get(opts.queryParam) === '1') return true
    if (qs.get('browser_debug') === '1') return true
    if (opts?.storageKey && window.localStorage.getItem(opts.storageKey) === '1') return true
    if (window.localStorage.getItem('browser:debug') === '1') return true
    if (opts?.globalFlag && (window as any)[opts.globalFlag] === true) return true
    if ((window as any).__BROWSER_DEBUG__ === true) return true
  } catch {}
  return false
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

function getBrowserDebugSessionId(): string | null {
  try {
    if (typeof window === 'undefined') return null
    const key = 'browser:debug:session'
    const existing = window.sessionStorage.getItem(key)
    if (existing) return existing
    const next = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    window.sessionStorage.setItem(key, next)
    return next
  } catch {
    return null
  }
}

function eventMatchesFilter(eventName: string, filter: string): boolean {
  if (!filter) return false
  if (filter.endsWith('*')) return eventName.startsWith(filter.slice(0, -1))
  return eventName === filter
}

function normalizeLevel(value: unknown): ClientDebugLevel {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return 'debug'
}

function nextClientDebugMeta(existing?: Record<string, any> | null): { debug_event_id: string; debug_seq: number } {
  const existingId = String(existing?.debug_event_id || '').trim()
  const existingSeq = Number(existing?.debug_seq)
  if (existingId && Number.isFinite(existingSeq) && existingSeq > 0) {
    return { debug_event_id: existingId, debug_seq: existingSeq }
  }
  clientDebugSeq += 1
  const debug_event_id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `dbg-${Date.now()}-${Math.random().toString(16).slice(2)}-${clientDebugSeq}`
  return { debug_event_id, debug_seq: clientDebugSeq }
}

function idMatchesFilter(idValue: string, filter: string): boolean {
  if (!filter) return false
  if (filter.endsWith('*')) return idValue.startsWith(filter.slice(0, -1))
  return idValue === filter
}

function shouldDropByUnifiedConfig(
  cfg: ReturnType<typeof readClientDebugConfig>,
  category: string,
  eventName: string,
  level: ClientDebugLevel,
  detail?: Record<string, any>
): boolean {
  if (!cfg.enabled && !cfg.emit) return true

  if (cfg.namespaces.length > 0) {
    const ns = String(category || '').trim().toLowerCase()
    if (!cfg.namespaces.some((entry) => String(entry || '').trim().toLowerCase() === ns)) {
      return true
    }
  }

  const minLevel = normalizeLevel(cfg.level || 'debug')
  if ((DEBUG_LEVEL_ORDER[level] || 0) < (DEBUG_LEVEL_ORDER[minLevel] || DEBUG_LEVEL_ORDER.debug)) {
    return true
  }

  if (cfg.includeEvents.length > 0) {
    let included = false
    for (const filter of cfg.includeEvents) {
      if (eventMatchesFilter(eventName, filter)) {
        included = true
        break
      }
    }
    if (!included) return true
  }

  if (cfg.excludeEvents.length > 0) {
    for (const filter of cfg.excludeEvents) {
      if (eventMatchesFilter(eventName, filter)) return true
    }
  }

  if (cfg.idFilters.length > 0) {
    const rawId = detail?.id ?? detail?.message_id ?? detail?.slide_id ?? detail?.active_sequence_key
    const idValue = rawId == null ? '' : String(rawId).trim()
    if (!idValue) return true
    let matched = false
    for (const filter of cfg.idFilters) {
      if (idMatchesFilter(idValue, filter)) {
        matched = true
        break
      }
    }
    if (!matched) return true
  }

  if (cfg.sessionFilters.length > 0) {
    const rawSid = detail?.session_id ?? detail?.message_session_id
    const sid = rawSid == null ? '' : String(rawSid).trim()
    if (!sid) return true
    let matched = false
    for (const filter of cfg.sessionFilters) {
      if (idMatchesFilter(sid, filter)) {
        matched = true
        break
      }
    }
    if (!matched) return true
  }

  if (cfg.sample != null) {
    const sample = Number(cfg.sample)
    if (Number.isFinite(sample) && sample >= 0 && sample < 1) {
      if (Math.random() >= sample) return true
    }
  }

  return false
}

async function flushBrowserDebugQueue(): Promise<void> {
  if (!browserDebugQueue.length) return
  if (browserDebugFlushInFlight) {
    await browserDebugFlushInFlight
    if (!browserDebugQueue.length) return
  }
  const csrfToken = getCsrfToken()
  const batch = browserDebugQueue.splice(0, BROWSER_DEBUG_BATCH_SIZE)
  browserDebugFlushInFlight = (async () => {
    try {
      await fetch('/api/debug/browser-log', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify({ events: batch }),
      })
    } catch {
      browserDebugQueue.unshift(...batch)
    } finally {
      browserDebugFlushInFlight = null
    }
  })()
  await browserDebugFlushInFlight
}

function scheduleBrowserDebugFlush() {
  if (browserDebugFlushTimer != null || typeof window === 'undefined') return
  browserDebugFlushTimer = window.setTimeout(() => {
    browserDebugFlushTimer = null
    void flushBrowserDebugQueue()
  }, BROWSER_DEBUG_FLUSH_MS)
}

function enqueueBrowserDebugEvent(event: ClientDebugEventPayload) {
  browserDebugQueue.push(event)
  if (browserDebugQueue.length >= BROWSER_DEBUG_BATCH_SIZE) {
    void flushBrowserDebugQueue()
    return
  }
  scheduleBrowserDebugFlush()
}

export function dispatchClientDebugDomEvent(
  domEventName: string,
  name: string,
  detail?: Record<string, any>,
  opts?: { enabled?: boolean; consoleLabel?: string }
) {
  if (opts?.enabled === false) return
  const category = (
    domEventName === 'feed:message-debug' ? 'message'
      : domEventName === 'feed:index-debug' ? 'index'
        : domEventName === 'feed:sequence-hook' ? 'sequence'
          : domEventName
  )
  const cfg = readClientDebugConfig()
  const level = normalizeLevel(detail?.level)
  if (shouldDropByUnifiedConfig(cfg, category, name, level, detail)) return
  const meta = nextClientDebugMeta(detail || null)
  const payload: ClientDebugPayload = {
    name,
    at: new Date().toISOString(),
    debug_event_id: meta.debug_event_id,
    debug_seq: meta.debug_seq,
    ...(detail || {}),
  }
  try {
    window.dispatchEvent(new CustomEvent(domEventName, { detail: payload }))
  } catch {}
  if (cfg.enabled) {
    try {
      const shortId = String(meta.debug_event_id || '').slice(0, 8)
      const consoleTag = `${opts?.consoleLabel || `[${domEventName}]`} [#${meta.debug_seq} ${shortId}]`
      // eslint-disable-next-line no-console
      console.debug(consoleTag, payload)
    } catch {}
  }
}

export function installClientDebugDomBridges(
  specs: ClientDebugDomBridgeSpec[],
  getContext: () => ClientDebugContext,
  opts?: { enabled?: boolean }
): () => void {
  if (!opts?.enabled || typeof window === 'undefined') return () => {}
  const browserSessionId = getBrowserDebugSessionId()
  if (!browserSessionId) return () => {}

  const listeners: Array<{ domEventName: string; listener: EventListener }> = []
  const pushStructuredDebug = (category: string, evt: Event) => {
    const detail = (evt as CustomEvent<Record<string, any> | undefined>)?.detail || {}
    const eventName = String(detail?.name || 'unknown')
    const eventLevel = normalizeLevel(detail?.level)
    const meta = nextClientDebugMeta(detail || null)
    const ctx = getContext()
    enqueueBrowserDebugEvent({
      ts: String(detail?.at || new Date().toISOString()),
      category,
      event: eventName,
      level: eventLevel,
      debug_event_id: meta.debug_event_id,
      debug_seq: meta.debug_seq,
      path: ctx.path,
      browser_session_id: browserSessionId,
      message_session_id: ctx.messageSessionId || null,
      user_id: ctx.userId ?? null,
      payload: {
        surface: ctx.surface || null,
        space_id: ctx.spaceId ?? null,
        space_type: ctx.spaceType || null,
        space_slug: ctx.spaceSlug || null,
        space_name: ctx.spaceName || null,
        detail,
      },
    })
  }

  for (const spec of specs) {
    const listener = ((evt: Event) => pushStructuredDebug(spec.category, evt)) as EventListener
    listeners.push({ domEventName: spec.domEventName, listener })
    window.addEventListener(spec.domEventName, listener)
  }

  const onPageHide = () => { void flushBrowserDebugQueue() }
  window.addEventListener('pagehide', onPageHide)

  return () => {
    for (const { domEventName, listener } of listeners) {
      window.removeEventListener(domEventName, listener)
    }
    window.removeEventListener('pagehide', onPageHide)
    void flushBrowserDebugQueue()
  }
}

export function readEffectiveClientDebugConfig() {
  return readClientDebugConfig()
}

export function emitStructuredClientDebugEvent(input: StructuredClientDebugInput): void {
  try {
    const cfg = readClientDebugConfig()
    if (!cfg.emit) return
    const category = String(input?.category || '').trim()
    const eventName = String(input?.event || '').trim()
    if (!category || !eventName) return
    const level = normalizeLevel(input?.level)
    if (shouldDropByUnifiedConfig(cfg, category, eventName, level, input?.payload || undefined)) return
    const meta = nextClientDebugMeta((input?.payload as any) || null)
    const browserSessionId = getBrowserDebugSessionId()
    if (!browserSessionId) return
    const pathValue = typeof window !== 'undefined'
      ? `${window.location.pathname || '/'}${window.location.search || ''}`
      : '/'
    enqueueBrowserDebugEvent({
      ts: new Date().toISOString(),
      category,
      event: eventName,
      level,
      debug_event_id: meta.debug_event_id,
      debug_seq: meta.debug_seq,
      path: pathValue,
      browser_session_id: browserSessionId,
      message_session_id: null,
      user_id: null,
      payload: input?.payload || null,
    })
  } catch {}
}
