export type ClientDebugLevel = 'debug' | 'info' | 'warn' | 'error'

export type ClientDebugConfig = {
  enabled: boolean
  emit: boolean
  namespaces: string[]
  includeEvents: string[]
  excludeEvents: string[]
  level: ClientDebugLevel
  sample: number | null
  idFilters: string[]
  sessionFilters: string[]
  legacy: {
    used: boolean
    keys: string[]
  }
}

type MaybeString = string | null | undefined

const LEGACY_NS_KEY_MAP: Array<{ key: string; ns: string }> = [
  { key: 'DEBUG_FEED', ns: 'feed' },
  { key: 'DEBUG_SLIDES', ns: 'slides' },
  { key: 'DEBUG_AUTH', ns: 'auth' },
  { key: 'DEBUG_VIDEO', ns: 'video' },
  { key: 'DEBUG_NETWORK', ns: 'network' },
  { key: 'DEBUG_RENDER', ns: 'render' },
  { key: 'DEBUG_PERF', ns: 'perf' },
  { key: 'DEBUG_PERM', ns: 'perm' },
  { key: 'DEBUG_ERRORS', ns: 'errors' },
]

function safeLocationSearch(): string {
  try {
    if (typeof window === 'undefined') return ''
    return String(window.location.search || '')
  } catch {
    return ''
  }
}

function readLs(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null
    const storage = window.localStorage
    if (!storage) return null
    const v = storage.getItem(key)
    return v == null ? null : String(v)
  } catch {
    return null
  }
}

function qsGet(params: URLSearchParams, key: string): string | null {
  try {
    const v = params.get(key)
    return v == null ? null : String(v)
  } catch {
    return null
  }
}

function asBool(value: MaybeString): boolean | undefined {
  if (value == null) return undefined
  const raw = String(value).trim().toLowerCase()
  if (!raw) return undefined
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  return undefined
}

function asList(value: MaybeString): string[] | undefined {
  if (value == null) return undefined
  const list = String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (!list.length) return []
  return Array.from(new Set(list))
}

function asLevel(value: MaybeString): ClientDebugLevel | undefined {
  if (value == null) return undefined
  const raw = String(value).trim().toLowerCase()
  if (raw === 'info' || raw === 'warn' || raw === 'error') return raw
  if (raw === 'debug') return 'debug'
  if (!raw) return undefined
  return 'debug'
}

function asSample(value: MaybeString): number | null | undefined {
  if (value == null) return undefined
  const raw = String(value).trim()
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function readNewKey(params: URLSearchParams, storageKey: string, queryKey: string): string | null {
  const fromLs = readLs(storageKey)
  const fromQs = qsGet(params, queryKey)
  return fromQs != null ? fromQs : fromLs
}

export function readClientDebugConfig(): ClientDebugConfig {
  const params = new URLSearchParams(safeLocationSearch())
  const legacyKeysUsed = new Set<string>()

  // Canonical keys (new contract).
  const nextEnabled = asBool(readNewKey(params, 'CLIENT_DEBUG', 'client_debug'))
  const nextEmit = asBool(readNewKey(params, 'CLIENT_DEBUG_EMIT', 'client_debug_emit'))
  const nextNs = asList(readNewKey(params, 'CLIENT_DEBUG_NS', 'client_debug_ns'))
  const nextEvents = asList(readNewKey(params, 'CLIENT_DEBUG_EVENTS', 'client_debug_events'))
  const nextExclude = asList(readNewKey(params, 'CLIENT_DEBUG_EXCLUDE', 'client_debug_exclude'))
  const nextLevel = asLevel(readNewKey(params, 'CLIENT_DEBUG_LEVEL', 'client_debug_level'))
  const nextSample = asSample(readNewKey(params, 'CLIENT_DEBUG_SAMPLE', 'client_debug_sample'))
  const nextIds = asList(readNewKey(params, 'CLIENT_DEBUG_ID', 'client_debug_id'))
  const nextSessions = asList(readNewKey(params, 'CLIENT_DEBUG_SESSION', 'client_debug_session'))

  // Legacy keys (compatibility contract).
  const legacyDebugMaster = asBool(qsGet(params, 'debug') ?? readLs('DEBUG'))
  if (legacyDebugMaster !== undefined) legacyKeysUsed.add('DEBUG')

  const legacyEmitBrowser = asBool(qsGet(params, 'browser_debug') ?? readLs('browser:debug'))
  if (legacyEmitBrowser !== undefined) legacyKeysUsed.add('browser:debug')
  const legacyEmitMessage = asBool(qsGet(params, 'message_debug') ?? readLs('message:debug'))
  if (legacyEmitMessage !== undefined) legacyKeysUsed.add('message:debug')

  const legacyNsSet = new Set<string>()
  for (const { key, ns } of LEGACY_NS_KEY_MAP) {
    const queryKey = key.toLowerCase()
    const enabled = asBool(qsGet(params, queryKey) ?? readLs(key))
    if (enabled) legacyNsSet.add(ns)
    if (enabled !== undefined) legacyKeysUsed.add(key)
  }
  if (legacyEmitMessage) legacyNsSet.add('message')
  if (legacyEmitBrowser) {
    legacyNsSet.add('index')
    legacyNsSet.add('sequence')
  }

  const legacyEvents = asList(readLs('message:debug:events'))
  if (legacyEvents !== undefined) legacyKeysUsed.add('message:debug:events')
  const legacyLevel = asLevel(readLs('message:debug:level'))
  if (legacyLevel !== undefined) legacyKeysUsed.add('message:debug:level')
  const legacySample = asSample(readLs('message:debug:sample'))
  if (legacySample !== undefined) legacyKeysUsed.add('message:debug:sample')

  const legacyIds = asList(readLs('DEBUG_FEED_ID') || readLs('DEBUG_SLIDE_ID') || readLs('DEBUG_VIDEO_ID'))
  if (legacyIds !== undefined) {
    if (readLs('DEBUG_FEED_ID')) legacyKeysUsed.add('DEBUG_FEED_ID')
    if (readLs('DEBUG_SLIDE_ID')) legacyKeysUsed.add('DEBUG_SLIDE_ID')
    if (readLs('DEBUG_VIDEO_ID')) legacyKeysUsed.add('DEBUG_VIDEO_ID')
  }

  const enabled = nextEnabled ?? !!(legacyDebugMaster || legacyEmitBrowser || legacyEmitMessage)
  const emit = nextEmit ?? !!(legacyEmitBrowser || legacyEmitMessage)
  const namespaces = nextNs ?? Array.from(legacyNsSet.values())
  const includeEvents = nextEvents ?? (legacyEvents || [])
  const excludeEvents = nextExclude ?? []
  const level = nextLevel ?? legacyLevel ?? 'debug'
  const sample = nextSample !== undefined ? nextSample : (legacySample !== undefined ? legacySample : null)
  const idFilters = nextIds ?? (legacyIds || [])
  const sessionFilters = nextSessions ?? []

  return {
    enabled,
    emit,
    namespaces,
    includeEvents,
    excludeEvents,
    level,
    sample,
    idFilters,
    sessionFilters,
    legacy: {
      used: legacyKeysUsed.size > 0,
      keys: Array.from(legacyKeysUsed.values()).sort(),
    },
  }
}

