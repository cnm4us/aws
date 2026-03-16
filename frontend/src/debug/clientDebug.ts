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
  path: string
  browser_session_id: string
  prompt_session_id?: string | null
  user_id?: number | null
  payload?: Record<string, any> | null
}

export type ClientDebugContext = {
  path: string
  promptSessionId?: string | null
  userId?: number | null
  surface?: string | null
  spaceId?: number | null
  spaceType?: string | null
  spaceSlug?: string | null
  spaceName?: string | null
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

const browserDebugQueue: ClientDebugEventPayload[] = []
let browserDebugFlushTimer: number | null = null
let browserDebugFlushInFlight: Promise<void> | null = null

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
  if (!opts?.enabled) return
  const payload: ClientDebugPayload = {
    name,
    at: new Date().toISOString(),
    ...(detail || {}),
  }
  try {
    window.dispatchEvent(new CustomEvent(domEventName, { detail: payload }))
  } catch {}
  try {
    // eslint-disable-next-line no-console
    console.debug(opts?.consoleLabel || `[${domEventName}]`, payload)
  } catch {}
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
    const ctx = getContext()
    enqueueBrowserDebugEvent({
      ts: String(detail?.at || new Date().toISOString()),
      category,
      event: String(detail?.name || 'unknown'),
      level: 'debug',
      path: ctx.path,
      browser_session_id: browserSessionId,
      prompt_session_id: ctx.promptSessionId || null,
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
