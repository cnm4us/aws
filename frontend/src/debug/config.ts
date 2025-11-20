// Debug configuration: flags, namespace enablement, id filters, colors

export type Namespace =
  | 'feed'
  | 'slides'
  | 'auth'
  | 'video'
  | 'network'
  | 'render'
  | 'perf'
  | 'perm'
  | 'errors'

export type Flags = {
  masterOn: boolean
  allowInProd: boolean
  dev: boolean
  ns: Record<Namespace, boolean>
  idFilters: Partial<Record<Namespace, string[] | null>> & {
    feed?: string[] | null
    slides?: string[] | null
    video?: string[] | null
  }
}

const COLOR_MAP: Record<Namespace, string> = {
  feed: '#4CAF50',
  slides: '#03A9F4',
  auth: '#9C27B0',
  video: '#FF9800',
  network: '#00BCD4',
  render: '#607D8B',
  perf: '#795548',
  perm: '#8BC34A',
  errors: '#E53935',
}

export function colorFor(ns: Namespace): string {
  return COLOR_MAP[ns] || '#888'
}

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function isTruthy(v: string | null | undefined): boolean {
  if (v == null) return false
  const s = String(v).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

function parseList(v: string | null | undefined): string[] | null {
  if (!v) return null
  const s = String(v)
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.length ? parts : null
}

function getEnvBool(name: string): boolean {
  try {
    const v = (import.meta as any)?.env?.[name]
    return isTruthy(typeof v === 'string' ? v : v ? '1' : '')
  } catch { return false }
}

const DEV: boolean = (() => {
  try { return Boolean((import.meta as any)?.env?.DEV) } catch { return true }
})()

let FLAGS: Flags = {
  masterOn: false,
  allowInProd: false,
  dev: DEV,
  ns: {
    feed: false,
    slides: false,
    auth: false,
    video: false,
    network: false,
    render: false,
    perf: false,
    perm: false,
    errors: false,
  },
  idFilters: { feed: null, slides: null, video: null },
}

export function currentFlags(): Flags { return FLAGS }

export function reloadFlags(): Flags {
  const allowInProd = getEnvBool('VITE_ALLOW_DEBUG_IN_PROD') || isTruthy(lsGet('DEBUG_ALLOW_PROD'))
  const masterOn = isTruthy(lsGet('DEBUG')) && (DEV || allowInProd)

  const nsFlag = (key: string) => masterOn && isTruthy(lsGet(key))

  FLAGS = {
    masterOn,
    allowInProd,
    dev: DEV,
    ns: {
      feed: nsFlag('DEBUG_FEED'),
      slides: nsFlag('DEBUG_SLIDES'),
      auth: nsFlag('DEBUG_AUTH'),
      video: nsFlag('DEBUG_VIDEO'),
      network: nsFlag('DEBUG_NETWORK'),
      render: nsFlag('DEBUG_RENDER'),
      perf: nsFlag('DEBUG_PERF'),
      perm: nsFlag('DEBUG_PERM'),
      errors: nsFlag('DEBUG_ERRORS'),
    },
    idFilters: {
      feed: parseList(lsGet('DEBUG_FEED_ID')),
      slides: parseList(lsGet('DEBUG_SLIDE_ID') || lsGet('DEBUG_SLIDES_ID')),
      video: parseList(lsGet('DEBUG_VIDEO_ID')),
    },
  }
  return FLAGS
}

export function enabled(ns?: Namespace): boolean {
  const f = FLAGS
  if (!f.masterOn) return false
  if (!ns) return true
  return !!f.ns[ns]
}

export function idMatches(ns: Namespace, id?: string | null): boolean {
  if (!id) return true
  const list = FLAGS.idFilters[ns as keyof Flags['idFilters']]
  if (!list || !list.length) return true
  for (const entry of list) {
    if (entry === id) return true
    if (entry.endsWith('*') && id.startsWith(entry.slice(0, -1))) return true
  }
  return false
}

export function bootstrapFromQuery(): void {
  // Optional: copy simple query flags into localStorage on first load
  try {
    const q = new URLSearchParams(window.location.search)
    if (!q.has('debug')) return
    const on = q.get('debug')
    if (!on) return
    localStorage.setItem('DEBUG', isTruthy(on) ? '1' : '')
    const pairs: Array<[string, string]> = [
      ['debug_allow_prod', 'DEBUG_ALLOW_PROD'],
      ['debug_feed', 'DEBUG_FEED'],
      ['debug_slides', 'DEBUG_SLIDES'],
      ['debug_auth', 'DEBUG_AUTH'],
      ['debug_video', 'DEBUG_VIDEO'],
      ['debug_network', 'DEBUG_NETWORK'],
      ['debug_render', 'DEBUG_RENDER'],
      ['debug_perf', 'DEBUG_PERF'],
      ['debug_perm', 'DEBUG_PERM'],
      ['debug_errors', 'DEBUG_ERRORS'],
      ['debug_feed_id', 'DEBUG_FEED_ID'],
      ['debug_slide_id', 'DEBUG_SLIDE_ID'],
      ['debug_video_id', 'DEBUG_VIDEO_ID'],
    ]
    for (const [qk, lk] of pairs) {
      if (q.has(qk)) {
        const v = q.get(qk)
        if (v != null) localStorage.setItem(lk, v)
      }
    }
  } catch {}
}

export function installStorageSync(handler: () => void): void {
  try {
    window.addEventListener('storage', (e) => {
      if (!e.key) return
      if (e.key.startsWith('DEBUG')) {
        handler()
      }
    })
  } catch {}
}
