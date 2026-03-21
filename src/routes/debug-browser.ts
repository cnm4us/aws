import { Router } from 'express'
import fs from 'fs/promises'
import path from 'path'

type BrowserDebugEventInput = {
  ts?: unknown
  category?: unknown
  event?: unknown
  level?: unknown
  debug_event_id?: unknown
  debug_seq?: unknown
  path?: unknown
  browser_session_id?: unknown
  message_session_id?: unknown
  user_id?: unknown
  payload?: unknown
}

type BrowserDebugEventRecord = {
  ts: string
  category: string
  event: string
  level: 'debug' | 'info' | 'warn' | 'error'
  debug_event_id: string | null
  debug_seq: number | null
  path: string | null
  browser_session_id: string | null
  message_session_id: string | null
  user_id: number | null
  payload: Record<string, any> | null
}

const MAX_EVENT_BATCH = 100
const MAX_STRING_LENGTH = 1_000
const MAX_OBJECT_KEYS = 40
const MAX_ARRAY_ITEMS = 20
const MAX_DEPTH = 5
const REDACTED_KEYS = new Set([
  'authorization',
  'cookie',
  'cookies',
  'csrf',
  'password',
  'secret',
  'token',
  'x-csrf-token',
])

let debugConsoleFilePath: string | null = null
let appendChain: Promise<void> = Promise.resolve()

function sanitizePrimitive(value: unknown): unknown {
  if (value == null) return null
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  return String(value)
}

function sanitizeValue(value: unknown, depth = 0): any {
  if (depth >= MAX_DEPTH) return '[max_depth]'
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return sanitizePrimitive(value)
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((entry) => sanitizeValue(entry, depth + 1))
  }
  if (typeof value === 'object') {
    const result: Record<string, any> = {}
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)
    for (const [rawKey, rawVal] of entries) {
      const key = String(rawKey)
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        result[key] = '[redacted]'
        continue
      }
      result[key] = sanitizeValue(rawVal, depth + 1)
    }
    return result
  }
  return sanitizePrimitive(value)
}

function normalizeLevel(value: unknown): BrowserDebugEventRecord['level'] {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return 'debug'
}

function normalizeRecord(input: BrowserDebugEventInput): BrowserDebugEventRecord | null {
  const category = String(input?.category || '').trim().slice(0, 64)
  const event = String(input?.event || '').trim().slice(0, 128)
  if (!category || !event) return null
  const tsCandidate = String(input?.ts || '').trim()
  const ts = tsCandidate || new Date().toISOString()
  const pathValue = String(input?.path || '').trim()
  const browserSessionId = String(input?.browser_session_id || '').trim()
  const messageSessionId = String(input?.message_session_id || '').trim()
  const debugEventId = String(input?.debug_event_id || '').trim()
  const debugSeqRaw = Number(input?.debug_seq)
  const userIdRaw = Number(input?.user_id)
  return {
    ts,
    category,
    event,
    level: normalizeLevel(input?.level),
    debug_event_id: debugEventId ? debugEventId.slice(0, 128) : null,
    debug_seq: Number.isFinite(debugSeqRaw) && debugSeqRaw > 0 ? Math.trunc(debugSeqRaw) : null,
    path: pathValue ? pathValue.slice(0, 512) : null,
    browser_session_id: browserSessionId ? browserSessionId.slice(0, 128) : null,
    message_session_id: messageSessionId ? messageSessionId.slice(0, 128) : null,
    user_id: Number.isFinite(userIdRaw) && userIdRaw > 0 ? userIdRaw : null,
    payload: sanitizeValue(input?.payload) || null,
  }
}

async function ensureDebugConsoleFilePath(): Promise<string> {
  if (debugConsoleFilePath) return debugConsoleFilePath
  const dir = path.resolve(process.cwd(), 'debug', 'console')
  await fs.mkdir(dir, { recursive: true })
  debugConsoleFilePath = path.join(dir, `browser-debug-${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}.ndjson`)
  return debugConsoleFilePath
}

async function appendBrowserDebugLines(lines: string[]): Promise<void> {
  if (!lines.length) return
  const targetPath = await ensureDebugConsoleFilePath()
  await fs.appendFile(targetPath, `${lines.join('\n')}\n`, 'utf8')
}

export const debugBrowserRouter = Router()

debugBrowserRouter.post('/api/debug/browser-log', async (req: any, res: any, next: any) => {
  try {
    const body = req.body || {}
    const eventsRaw = Array.isArray(body?.events) ? body.events : []
    const accepted = (eventsRaw as BrowserDebugEventInput[])
      .slice(0, MAX_EVENT_BATCH)
      .map((entry: BrowserDebugEventInput) => normalizeRecord(entry))
      .filter((entry: BrowserDebugEventRecord | null): entry is BrowserDebugEventRecord => Boolean(entry))

    if (!accepted.length) {
      return res.status(400).json({ error: 'no_valid_events' })
    }

    appendChain = appendChain.then(() => appendBrowserDebugLines(accepted.map((entry: BrowserDebugEventRecord) => JSON.stringify(entry)))).catch(() => {})
    await appendChain

    return res.json({ ok: true, accepted: accepted.length })
  } catch (err) {
    return next(err)
  }
})
