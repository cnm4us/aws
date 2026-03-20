import { currentFlags, reloadFlags } from './config'

export type DebugControlKind = 'boolean' | 'string'

export type DebugControlGroup = 'master' | 'namespace' | 'filter' | 'structured' | 'legacy'

export type DebugControlDef = {
  key: string
  label: string
  description: string
  kind: DebugControlKind
  group: DebugControlGroup
  queryParam?: string
  defaultValue?: string
}

export const DEBUG_CONTROL_DEFS: DebugControlDef[] = [
  {
    key: 'DEBUG',
    label: 'Debug Master',
    description: 'Master switch for dlog namespace logging.',
    kind: 'boolean',
    group: 'master',
    queryParam: 'debug',
    defaultValue: '',
  },
  {
    key: 'DEBUG_ALLOW_PROD',
    label: 'Allow In Prod',
    description: 'Allow debug flags to work in production builds.',
    kind: 'boolean',
    group: 'master',
    queryParam: 'debug_allow_prod',
    defaultValue: '',
  },
  {
    key: 'DEBUG_FEED',
    label: 'Feed',
    description: 'Feed interactions and flow logs.',
    kind: 'boolean',
    group: 'namespace',
    queryParam: 'debug_feed',
    defaultValue: '',
  },
  {
    key: 'DEBUG_SLIDES',
    label: 'Slides',
    description: 'Slide render/index logs.',
    kind: 'boolean',
    group: 'namespace',
    queryParam: 'debug_slides',
    defaultValue: '',
  },
  {
    key: 'DEBUG_AUTH',
    label: 'Auth',
    description: 'Auth bootstrap logs.',
    kind: 'boolean',
    group: 'namespace',
    queryParam: 'debug_auth',
    defaultValue: '',
  },
  {
    key: 'DEBUG_VIDEO',
    label: 'Video',
    description: 'Video/HLS lifecycle logs.',
    kind: 'boolean',
    group: 'namespace',
    queryParam: 'debug_video',
    defaultValue: '',
  },
  {
    key: 'DEBUG_NETWORK',
    label: 'Network',
    description: 'Fetch tracing logs.',
    kind: 'boolean',
    group: 'namespace',
    queryParam: 'debug_network',
    defaultValue: '',
  },
  {
    key: 'DEBUG_RENDER',
    label: 'Render',
    description: 'Per-component render tracing logs.',
    kind: 'boolean',
    group: 'namespace',
    queryParam: 'debug_render',
    defaultValue: '',
  },
  {
    key: 'DEBUG_PERF',
    label: 'Perf',
    description: 'Performance timing logs.',
    kind: 'boolean',
    group: 'namespace',
    queryParam: 'debug_perf',
    defaultValue: '',
  },
  {
    key: 'DEBUG_PERM',
    label: 'Permissions',
    description: 'Permissions/roles logs.',
    kind: 'boolean',
    group: 'namespace',
    queryParam: 'debug_perm',
    defaultValue: '',
  },
  {
    key: 'DEBUG_ERRORS',
    label: 'Errors',
    description: 'Reserved error namespace logs.',
    kind: 'boolean',
    group: 'namespace',
    queryParam: 'debug_errors',
    defaultValue: '',
  },
  {
    key: 'DEBUG_FEED_ID',
    label: 'Feed ID Filter',
    description: 'Limit feed logs to matching IDs (comma list, wildcard suffix supported).',
    kind: 'string',
    group: 'filter',
    queryParam: 'debug_feed_id',
    defaultValue: '',
  },
  {
    key: 'DEBUG_SLIDE_ID',
    label: 'Slide ID Filter',
    description: 'Limit slide logs to matching IDs (comma list, wildcard suffix supported).',
    kind: 'string',
    group: 'filter',
    queryParam: 'debug_slide_id',
    defaultValue: '',
  },
  {
    key: 'DEBUG_VIDEO_ID',
    label: 'Video ID Filter',
    description: 'Limit video logs to matching IDs (comma list, wildcard suffix supported).',
    kind: 'string',
    group: 'filter',
    queryParam: 'debug_video_id',
    defaultValue: '',
  },
  {
    key: 'browser:debug',
    label: 'Browser Debug Emit',
    description: 'Enable structured browser debug emission to /api/debug/browser-log.',
    kind: 'boolean',
    group: 'structured',
    queryParam: 'browser_debug',
    defaultValue: '',
  },
  {
    key: 'message:debug',
    label: 'Message Debug',
    description: 'Enable message-specific structured debug events.',
    kind: 'boolean',
    group: 'structured',
    queryParam: 'message_debug',
    defaultValue: '',
  },
  {
    key: 'message:debug:events',
    label: 'Message Event Allowlist',
    description: 'Comma-separated event names/prefixes (supports * suffix). Empty = all events.',
    kind: 'string',
    group: 'structured',
    defaultValue: '',
  },
  {
    key: 'message:debug:sample',
    label: 'Message Event Sample Rate',
    description: 'Sampling rate from 0 to 1 (e.g., 0.25). Empty = no sampling.',
    kind: 'string',
    group: 'structured',
    defaultValue: '',
  },
  {
    key: 'message:debug:level',
    label: 'Message Minimum Level',
    description: 'Minimum level to emit: debug|info|warn|error.',
    kind: 'string',
    group: 'structured',
    defaultValue: '',
  },
  {
    key: 'DEBUG_SLIDES_ID',
    label: 'Slides ID Filter (Legacy Alias)',
    description: 'Legacy alias for DEBUG_SLIDE_ID.',
    kind: 'string',
    group: 'legacy',
    defaultValue: '',
  },
]

const DEBUG_CONTROL_KEYS = new Set(DEBUG_CONTROL_DEFS.map((entry) => entry.key))

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage || null
  } catch {
    return null
  }
}

function normalizeString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

export function listDebugControls(): DebugControlDef[] {
  return DEBUG_CONTROL_DEFS.slice()
}

export function readDebugControlValues(): Record<string, string> {
  const storage = safeStorage()
  const values: Record<string, string> = {}
  for (const entry of DEBUG_CONTROL_DEFS) {
    const v = storage ? normalizeString(storage.getItem(entry.key)) : ''
    values[entry.key] = v
  }
  return values
}

export function applyDebugControlValues(updates: Record<string, string | boolean | null | undefined>): void {
  const storage = safeStorage()
  if (!storage) return
  for (const [key, raw] of Object.entries(updates || {})) {
    if (!DEBUG_CONTROL_KEYS.has(key)) continue
    if (raw == null) {
      try { storage.removeItem(key) } catch {}
      continue
    }
    if (typeof raw === 'boolean') {
      try {
        if (raw) storage.setItem(key, '1')
        else storage.removeItem(key)
      } catch {}
      continue
    }
    const next = normalizeString(raw)
    try {
      if (next.length) storage.setItem(key, next)
      else storage.removeItem(key)
    } catch {}
  }
}

export function clearDebugControlValues(): void {
  const storage = safeStorage()
  if (!storage) return
  for (const entry of DEBUG_CONTROL_DEFS) {
    try { storage.removeItem(entry.key) } catch {}
  }
}

export function buildDebugControlSnippet(values?: Record<string, string>): string {
  const src = values || readDebugControlValues()
  const lines: string[] = []
  for (const entry of DEBUG_CONTROL_DEFS) {
    const v = normalizeString(src[entry.key] || '')
    if (!v) continue
    lines.push(`localStorage.setItem(${JSON.stringify(entry.key)}, ${JSON.stringify(v)});`)
  }
  if (!lines.length) return '// no active debug flags'
  return `${lines.join('\n')}\nlocation.reload();`
}

export function readDebugControlState() {
  const values = readDebugControlValues()
  const flags = reloadFlags()
  return {
    values,
    flags,
    derived: {
      masterOn: flags.masterOn,
      namespaceOn: Object.entries(flags.ns)
        .filter(([, enabled]) => !!enabled)
        .map(([name]) => name),
    },
    snapshotAt: new Date().toISOString(),
  }
}

export function currentDebugFlags() {
  return currentFlags()
}
