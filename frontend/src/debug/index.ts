import { bootstrapFromQuery, colorFor, currentFlags, enabled as cfgEnabled, idMatches, installStorageSync, reloadFlags, type Namespace } from './config'
import { getCallsite } from './callsite'

type MetaArg = Record<string, any> | (() => Record<string, any>) | undefined

type LogLevel = 'log' | 'info' | 'warn' | 'error'

type LogOpts = { id?: string | null; ctx?: string }

function nowMs(): number {
  try { return performance.now() } catch { return Date.now() }
}

const START_MS = nowMs()

function fmtDelta(): string {
  const d = Math.max(0, nowMs() - START_MS)
  return `+${Math.round(d)}ms`
}

function pickMeta(meta?: MetaArg): any | undefined {
  try { return typeof meta === 'function' ? (meta as any)() : meta } catch { return undefined }
}

function baseEnabled(ns?: Namespace): boolean { return cfgEnabled(ns) }

function nsEnabled(ns: Namespace, id?: string | null): boolean {
  if (!baseEnabled(ns)) return false
  if (!id) return true
  return idMatches(ns, id)
}

function makePrefix(ns: Namespace, ctx?: string): [string, string] {
  const color = colorFor(ns)
  const css = `background:${color}; color:#fff; border-radius:4px; padding:1px 5px; font-weight:600;`
  const base = ns.toUpperCase()
  const label = ctx && ctx.length ? `${base}:${ctx}` : base
  return [`%c[${label}]`, css]
}

function callsiteTag(): string {
  const cs = getCallsite(0)
  if (!cs || !cs.file) return ''
  const file = cs.file.split(/[\\/]/).pop() || cs.file
  const where = cs.line != null ? `${file}:${cs.line}` : file
  return where
}

function output(level: LogLevel, ns: Namespace, event: string, meta?: MetaArg, id?: string | null, ctx?: string) {
  if (!nsEnabled(ns, id)) return
  // Avoid doing extra work before here
  const [label, css] = makePrefix(ns, ctx)
  const where = callsiteTag()
  const delta = fmtDelta()
  const body = pickMeta(meta)
  const args: any[] = [label + ` ${event} ${delta}` + (where ? ` [${where}]` : ''), css]
  if (body !== undefined) args.push(body)
  try {
    // eslint-disable-next-line no-console
    ;(console as any)[level](...args)
  } catch {}
}

function outputGroup(ns: Namespace, title: string, fn: () => void, id?: string | null, ctx?: string) {
  if (!nsEnabled(ns, id)) return
  const [label, css] = makePrefix(ns, ctx)
  const where = callsiteTag()
  const delta = fmtDelta()
  try {
    // eslint-disable-next-line no-console
    console.groupCollapsed(`${label} ${title} ${delta}` + (where ? ` [${where}]` : ''), css)
    fn()
  } catch {}
  finally {
    try { console.groupEnd() } catch {}
  }
}

const counters = new Map<string, number>()

function onceKey(ns: Namespace, key: string): string { return `${ns}:${key}` }

let fetchPatched = false

function installFetchDebug() {
  try {
    if (typeof window === 'undefined') return
    const w: any = window as any
    if (!w.fetch || fetchPatched) return
    const origFetch: typeof window.fetch = w.fetch.bind(w)
    fetchPatched = true
    w.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const start = nowMs()
      // If network debug is not enabled, delegate directly
      if (!baseEnabled('network')) return origFetch(input as any, init as any)
      let url = '[unknown]'
      let method = 'GET'
      try {
        if (typeof input === 'string' || input instanceof URL) {
          url = String(input)
          method = (init && init.method) ? String(init.method).toUpperCase() : 'GET'
        } else {
          url = input.url
          method = (input as any).method ? String((input as any).method).toUpperCase() : 'GET'
        }
      } catch {}

      const log = (event: string, extra: Record<string, any>) => {
        try {
          debug.log(
            'network',
            event,
            {
              method,
              url,
              durationMs: Math.round(Math.max(0, nowMs() - start)),
              ...extra,
            },
            { ctx: 'fetch' }
          )
        } catch {}
      }

      try {
        const p = origFetch(input as any, init as any)
        if (!p || typeof (p as any).then !== 'function') {
          return p
        }
        return (p as Promise<Response>).then(
          (res) => {
            try {
              const status = res.status
              const ok = res.ok
              let size: number | string | undefined
              try {
                const len = res.headers && res.headers.get && res.headers.get('content-length')
                if (len != null) {
                  const n = Number(len)
                  size = Number.isFinite(n) ? n : len
                }
              } catch {}
              log('fetch', { status, ok, size })
            } catch {}
            return res
          },
          (err) => {
            log('fetch error', { error: err?.message || String(err) })
            throw err
          }
        )
      } catch (err: any) {
        log('fetch error', { error: err?.message || String(err) })
        throw err
      }
    }
  } catch {}
}

export const debug = {
  // Flags lifecycle
  reloadFlags,
  currentFlags,
  bootstrapFromQuery,
  installStorageSync,

  enabled(ns?: Namespace): boolean { return baseEnabled(ns) },

  log(ns: Namespace, event: string, meta?: MetaArg, opts?: LogOpts) {
    output('log', ns, event, meta, opts?.id ?? null, opts?.ctx)
  },
  info(ns: Namespace, event: string, meta?: MetaArg, opts?: LogOpts) {
    output('info', ns, event, meta, opts?.id ?? null, opts?.ctx)
  },
  warn(ns: Namespace, event: string, meta?: MetaArg, opts?: LogOpts) {
    output('warn', ns, event, meta, opts?.id ?? null, opts?.ctx)
  },
  error(ns: Namespace, event: string, meta?: MetaArg, opts?: LogOpts) {
    output('error', ns, event, meta, opts?.id ?? null, opts?.ctx)
  },

  group(ns: Namespace, title: string, fn: () => void, opts?: LogOpts) {
    outputGroup(ns, title, fn, opts?.id ?? null, opts?.ctx)
  },

  time(ns: Namespace, label: string) {
    if (!baseEnabled(ns)) return
    try { console.time(`[${ns}] ${label}`) } catch {}
  },
  timeEnd(ns: Namespace, label: string) {
    if (!baseEnabled(ns)) return
    try { console.timeEnd(`[${ns}] ${label}`) } catch {}
  },

  mark(ns: Namespace, name: string) {
    if (!baseEnabled(ns)) return
    try { performance.mark(`[${ns}] ${name}`) } catch {}
  },
  measure(ns: Namespace, name: string, startMark: string, endMark: string) {
    if (!baseEnabled(ns)) return
    try { performance.measure(`[${ns}] ${name}`, startMark, endMark) } catch {}
  },

  once(ns: Namespace, key: string, event: string, meta?: MetaArg, opts?: LogOpts) {
    const k = onceKey(ns, key)
    if (counters.has(k)) return
    counters.set(k, 1)
    output('log', ns, event, meta, opts?.id ?? null, opts?.ctx)
  },
  limit(ns: Namespace, key: string, max: number, event: string, meta?: MetaArg, opts?: LogOpts) {
    const k = onceKey(ns, key)
    const n = (counters.get(k) || 0) + 1
    counters.set(k, n)
    if (n <= max) output('log', ns, event, meta, opts?.id ?? null, opts?.ctx)
  },
  sample(ns: Namespace, rate: number, event: string, meta?: MetaArg, opts?: LogOpts) {
    if (rate <= 0) return
    if (rate >= 1) { output('log', ns, event, meta, opts?.id ?? null, opts?.ctx); return }
    const r = Math.random()
    if (r < rate) output('log', ns, event, meta, opts?.id ?? null, opts?.ctx)
  },

  scope(ns: Namespace, baseMeta?: Record<string, any>, baseId?: string | null) {
    const withBase = (meta?: MetaArg): MetaArg => {
      if (!meta) return baseMeta
      return () => ({ ...(baseMeta || {}), ...(typeof meta === 'function' ? (meta as any)() : meta) })
    }
    return {
      log: (event: string, meta?: MetaArg, opts?: LogOpts) => debug.log(ns, event, withBase(meta), { id: opts?.id ?? baseId ?? null, ctx: opts?.ctx }),
      info: (event: string, meta?: MetaArg, opts?: LogOpts) => debug.info(ns, event, withBase(meta), { id: opts?.id ?? baseId ?? null, ctx: opts?.ctx }),
      warn: (event: string, meta?: MetaArg, opts?: LogOpts) => debug.warn(ns, event, withBase(meta), { id: opts?.id ?? baseId ?? null, ctx: opts?.ctx }),
      error: (event: string, meta?: MetaArg, opts?: LogOpts) => debug.error(ns, event, withBase(meta), { id: opts?.id ?? baseId ?? null, ctx: opts?.ctx }),
      group: (title: string, fn: () => void, opts?: LogOpts) => debug.group(ns, title, fn, { id: opts?.id ?? baseId ?? null, ctx: opts?.ctx } as any),
    }
  },

  installNetworkDebug() {
    installFetchDebug()
  },

  attachGlobal() {
    try {
      if (!currentFlags().masterOn) return
      if ((import.meta as any)?.env?.DEV) {
        ;(window as any).dlog = debug
      }
    } catch {}
  },
}

export default debug
