import crypto from 'crypto'
import { DomainError } from '../../core/errors'
import {
  MESSAGE_COOLDOWN_SECONDS_AFTER_MESSAGE,
  MESSAGE_MAX_MESSAGES_PER_SESSION,
  MESSAGE_MIN_SLIDES_BEFORE_FIRST_MESSAGE,
  MESSAGE_MIN_SLIDES_BETWEEN_MESSAGES,
  MESSAGE_MIN_WATCH_SECONDS_BEFORE_FIRST_MESSAGE,
} from '../../config'
import * as messagesSvc from '../messages/service'
import * as repo from './repo'
import type {
  MessageAudienceSegment,
  MessageDecisionInput,
  MessageDecisionReasonCode,
  MessageDecisionResult,
  MessageDecisionSessionRow,
  MessageDecisionSurface,
} from './types'

const ALLOWED_SURFACES: readonly MessageDecisionSurface[] = ['global_feed']
const SESSION_ID_RE = /^[a-zA-Z0-9:_-]{8,120}$/

export const ANON_SESSION_COOKIE = 'anon_session_id'
export const ANON_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

type SessionSuppressionState = {
  convertedMessageIds: Set<number>
}

function normalizeSurface(raw: any): MessageDecisionSurface {
  const value = String(raw ?? '').trim().toLowerCase()
  if ((ALLOWED_SURFACES as readonly string[]).includes(value)) return value as MessageDecisionSurface
  throw new DomainError('invalid_surface', 'invalid_surface', 400)
}

function normalizeCounter(raw: any, key: string, min: number, max: number, fallback: number): number {
  const value = raw == null || raw === '' ? fallback : Number(raw)
  if (!Number.isFinite(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  const rounded = Math.round(value)
  if (rounded < min || rounded > max) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return rounded
}

function normalizeDateTime(raw: any, key: string): string | null {
  if (raw == null || raw === '') return null
  const date = new Date(String(raw))
  if (!Number.isFinite(date.getTime())) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function normalizeMessageId(raw: any): number | null {
  if (raw == null || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new DomainError('invalid_last_message_id', 'invalid_last_message_id', 400)
  return Math.round(value)
}

function isValidSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value)
}

function generateSessionId(): string {
  try {
    const uuid = crypto.randomUUID()
    if (isValidSessionId(uuid)) return uuid
  } catch {}
  return crypto.randomBytes(24).toString('hex')
}

function deterministicScore(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex')
}

function parseCounters(raw: any): MessageDecisionInput['counters'] {
  const src = raw && typeof raw === 'object' ? raw : {}
  const countersRaw = src.counters && typeof src.counters === 'object' ? src.counters : src
  const slidesViewed = normalizeCounter(countersRaw.slides_viewed ?? countersRaw.slidesViewed, 'slides_viewed', 0, 1000000, 0)
  const watchSeconds = normalizeCounter(countersRaw.watch_seconds ?? countersRaw.watchSeconds, 'watch_seconds', 0, 7 * 24 * 60 * 60, 0)
  const messagesShownThisSession = normalizeCounter(
    countersRaw.messages_shown_this_session ??
      countersRaw.messagesShownThisSession,
    'messages_shown_this_session',
    0,
    10000,
    0
  )
  const slidesSinceLastMessage = normalizeCounter(
    countersRaw.slides_since_last_message ??
      countersRaw.slidesSinceLastMessage,
    'slides_since_last_message',
    0,
    1000000,
    0
  )
  const lastMessageShownAt = normalizeDateTime(
    countersRaw.last_message_shown_at ??
      countersRaw.lastMessageShownAt,
    'last_message_shown_at'
  )
  const lastMessageId = normalizeMessageId(
    countersRaw.last_message_id ??
      countersRaw.lastMessageId
  )

  return {
    slidesViewed,
    watchSeconds,
    messagesShownThisSession: messagesShownThisSession,
    slidesSinceLastMessage: slidesSinceLastMessage,
    lastMessageShownAt: lastMessageShownAt,
    lastMessageId: lastMessageId,
  }
}

function parseConvertedMessageIds(raw: any): Set<number> {
  if (!raw) return new Set<number>()
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return new Set<number>()
    const out = new Set<number>()
    for (const v of parsed) {
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) continue
      out.add(Math.round(n))
    }
    return out
  } catch {
    return new Set<number>()
  }
}

function suppressionStateFromRow(row: MessageDecisionSessionRow | null): SessionSuppressionState {
  return {
    convertedMessageIds: parseConvertedMessageIds(row?.converted_message_ids_json),
  }
}

function serializeSuppressionState(state: SessionSuppressionState): {
  convertedMessageIdsJson: string
} {
  const converted = Array.from(state.convertedMessageIds).sort((a, b) => a - b)
  return {
    convertedMessageIdsJson: JSON.stringify(converted),
  }
}

function isMessageSuppressed(messageId: number, state: SessionSuppressionState): boolean {
  return state.convertedMessageIds.has(messageId)
}

function mergeSessionState(existing: MessageDecisionSessionRow | null, input: MessageDecisionInput): {
  audienceSegment: MessageAudienceSegment
  slidesViewed: number
  watchSeconds: number
  messagesShownThisSession: number
  slidesSinceLastMessage: number
  lastMessageShownAt: string | null
  lastMessageId: number | null
  suppression: SessionSuppressionState
} {
  if (!existing) {
    return {
      audienceSegment: input.audienceSegment,
      slidesViewed: input.counters.slidesViewed,
      watchSeconds: input.counters.watchSeconds,
      messagesShownThisSession: input.counters.messagesShownThisSession,
      slidesSinceLastMessage: input.counters.slidesSinceLastMessage,
      lastMessageShownAt: input.counters.lastMessageShownAt,
      lastMessageId: input.counters.lastMessageId,
      suppression: { convertedMessageIds: new Set<number>() },
    }
  }

  return {
    audienceSegment: input.audienceSegment,
    slidesViewed: Math.max(Number(existing.slides_viewed || 0), input.counters.slidesViewed),
    watchSeconds: Math.max(Number(existing.watch_seconds || 0), input.counters.watchSeconds),
    // Server-authoritative counter; incremented when a message is actually selected.
    // This avoids client refreshes resetting rotation behavior.
    messagesShownThisSession: Number(existing.messages_shown_this_session || 0),
    slidesSinceLastMessage:
      input.counters.slidesSinceLastMessage !== undefined && input.counters.slidesSinceLastMessage !== null
        ? input.counters.slidesSinceLastMessage
        : Number(existing.slides_since_last_message || 0),
    lastMessageShownAt: input.counters.lastMessageShownAt || existing.last_message_shown_at || null,
    lastMessageId: input.counters.lastMessageId ?? (existing.last_shown_message_id == null ? null : Number(existing.last_shown_message_id)),
    suppression: suppressionStateFromRow(existing),
  }
}

function nowMs(): number {
  return Date.now()
}

type EligibleMessageCandidate = {
  messageId: number
  messageType: string
  priority: number
  tieBreakStrategy: 'first' | 'round_robin' | 'weighted_random'
}

function selectMessageCandidate(
  candidates: EligibleMessageCandidate[],
  input: MessageDecisionInput,
  merged: ReturnType<typeof mergeSessionState>
): EligibleMessageCandidate | null {
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]

  const sorted = candidates
    .slice()
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      if (a.messageId !== b.messageId) return a.messageId - b.messageId
      return 0
    })

  const tieBreak = sorted[0]?.tieBreakStrategy || 'round_robin'

  if (tieBreak === 'round_robin') {
    const base = Math.max(0, Math.round(Number(merged.messagesShownThisSession || 0)))
    return sorted[base % sorted.length]
  }

  if (tieBreak === 'weighted_random') {
    const seed = `${input.sessionId}:${merged.messagesShownThisSession}:${merged.slidesViewed}:${merged.watchSeconds}:weighted_random`
    const hash = deterministicScore(seed)
    const numeric = Number.parseInt(hash.slice(0, 12), 16)
    const idx = Number.isFinite(numeric) ? numeric % sorted.length : 0
    return sorted[idx]
  }

  return sorted[0]
}

function dateToMs(raw: string | null): number | null {
  if (!raw) return null
  const date = new Date(String(raw).replace(' ', 'T') + 'Z')
  if (!Number.isFinite(date.getTime())) return null
  return date.getTime()
}

export function buildDecisionInput(params: {
  body: any
  cookieSessionId: string | null
  audienceSegment: MessageAudienceSegment
}): { input: MessageDecisionInput; createdSessionId: string | null } {
  const surface = normalizeSurface(params.body?.surface)

  const bodySessionRaw = String(params.body?.message_session_id ?? params.body?.messageSessionId ?? params.body?.session_id ?? params.body?.sessionId ?? '').trim()
  const bodySessionId = bodySessionRaw && isValidSessionId(bodySessionRaw) ? bodySessionRaw : null

  let sessionId = params.cookieSessionId && isValidSessionId(params.cookieSessionId)
    ? params.cookieSessionId
    : (bodySessionId || null)

  let createdSessionId: string | null = null
  if (!sessionId) {
    sessionId = generateSessionId()
    createdSessionId = sessionId
  }

  const counters = parseCounters(params.body || {})

  return {
    input: {
      surface,
      sessionId,
      audienceSegment: params.audienceSegment,
      counters,
    },
    createdSessionId,
  }
}

export async function decideMessage(input: MessageDecisionInput, opts?: { includeDebug?: boolean }): Promise<MessageDecisionResult> {
  const existing = await repo.getSessionByKey(input.sessionId, input.surface)
  const merged = mergeSessionState(existing, input)
  const suppressionJson = serializeSuppressionState(merged.suppression)

  if (!existing) {
    await repo.createSession({
      sessionId: input.sessionId,
      surface: input.surface,
      audienceSegment: merged.audienceSegment,
      slidesViewed: merged.slidesViewed,
      watchSeconds: merged.watchSeconds,
      messagesShownThisSession: merged.messagesShownThisSession,
      slidesSinceLastMessage: merged.slidesSinceLastMessage,
      convertedMessageIdsJson: suppressionJson.convertedMessageIdsJson,
      lastMessageShownAt: merged.lastMessageShownAt,
      lastMessageId: merged.lastMessageId,
      lastDecisionReason: null,
    })
  } else {
    await repo.updateSession(existing.id, {
      audienceSegment: merged.audienceSegment,
      slidesViewed: merged.slidesViewed,
      watchSeconds: merged.watchSeconds,
      messagesShownThisSession: merged.messagesShownThisSession,
      slidesSinceLastMessage: merged.slidesSinceLastMessage,
      convertedMessageIdsJson: suppressionJson.convertedMessageIdsJson,
      lastMessageShownAt: merged.lastMessageShownAt,
      lastMessageId: merged.lastMessageId,
    })
  }

  let reasonCode: MessageDecisionReasonCode = 'no_active_message'
  let messageId: number | null = null
  let selectionEngine: 'message_pool' = 'message_pool'
  let candidateCount = 0
  let selectedPriority: number | null = null

  if (merged.messagesShownThisSession >= MESSAGE_MAX_MESSAGES_PER_SESSION) {
    reasonCode = 'cap_reached'
  } else {
    const lastShownMs = dateToMs(merged.lastMessageShownAt)
    if (
      lastShownMs != null &&
      MESSAGE_COOLDOWN_SECONDS_AFTER_MESSAGE > 0 &&
      nowMs() - lastShownMs < MESSAGE_COOLDOWN_SECONDS_AFTER_MESSAGE * 1000
    ) {
      reasonCode = 'cooldown_active'
    } else if (
      (merged.messagesShownThisSession <= 0 &&
        (merged.slidesViewed < MESSAGE_MIN_SLIDES_BEFORE_FIRST_MESSAGE ||
          merged.watchSeconds < MESSAGE_MIN_WATCH_SECONDS_BEFORE_FIRST_MESSAGE)) ||
      (merged.messagesShownThisSession > 0 && merged.slidesSinceLastMessage < MESSAGE_MIN_SLIDES_BETWEEN_MESSAGES)
    ) {
      reasonCode = 'below_threshold'
    } else {
      const messages = await messagesSvc.listActiveForFeed({
        limit: 300,
        appliesToSurface: input.surface,
        audienceSegment: merged.audienceSegment,
      })

      if (!messages.length) {
        reasonCode = 'no_active_message'
      } else {
        const candidates: EligibleMessageCandidate[] = []
        for (const message of messages) {
          const candidateId = Number(message.id || 0)
          if (!Number.isFinite(candidateId) || candidateId <= 0) continue
          if (isMessageSuppressed(candidateId, merged.suppression)) continue
          const tieBreakRaw = String((message as any).tieBreakStrategy || '').trim().toLowerCase()
          const tieBreakStrategy: 'first' | 'round_robin' | 'weighted_random' =
            tieBreakRaw === 'first' || tieBreakRaw === 'weighted_random' || tieBreakRaw === 'round_robin'
              ? tieBreakRaw
              : 'round_robin'
          candidates.push({
            messageId: candidateId,
            messageType: String(message.type || 'register_login'),
            priority: Number(message.priority || 0),
            tieBreakStrategy,
          })
        }

        candidateCount = candidates.length
        if (!candidateCount) {
          reasonCode = 'no_candidate'
        } else {
          const selected = selectMessageCandidate(candidates, input, merged)
          if (!selected) {
            reasonCode = 'no_candidate'
          } else {
            reasonCode = 'eligible'
            messageId = selected.messageId
            selectedPriority = selected.priority
          }
        }
      }
    }
  }

  const result: MessageDecisionResult = {
    shouldInsert: reasonCode === 'eligible' && messageId != null,
    messageId,
    insertAfterIndex: null,
    reasonCode,
    sessionId: input.sessionId,
  }

  const persisted = await repo.getSessionByKey(input.sessionId, input.surface)
  if (persisted) {
    const lastMessageShownAt = result.shouldInsert ? normalizeDateTime(new Date().toISOString(), 'last_message_shown_at') : undefined
    const nextShownCount = result.shouldInsert
      ? Number(persisted.messages_shown_this_session || 0) + 1
      : Number(persisted.messages_shown_this_session || 0)
    await repo.updateSession(persisted.id, {
      lastDecisionReason: reasonCode,
      messagesShownThisSession: nextShownCount,
      slidesSinceLastMessage: result.shouldInsert ? 0 : undefined,
      lastMessageShownAt,
      lastMessageId: result.shouldInsert ? result.messageId : undefined,
    })
  }

  if (opts?.includeDebug) {
    result.debug = {
      input: {
        surface: input.surface,
        audienceSegment: input.audienceSegment,
        counters: input.counters,
      },
      mergedSession: {
        audienceSegment: merged.audienceSegment,
        slidesViewed: merged.slidesViewed,
        watchSeconds: merged.watchSeconds,
        messagesShownThisSession: merged.messagesShownThisSession,
        slidesSinceLastMessage: merged.slidesSinceLastMessage,
        lastMessageShownAt: merged.lastMessageShownAt,
        lastMessageId: merged.lastMessageId,
        convertedMessageIds: Array.from(merged.suppression.convertedMessageIds),
      },
      selection: {
        engine: selectionEngine,
        candidateCount,
        selectedPriority,
      },
      reasonCode,
    }
  }

  return result
}

export async function recordMessageSessionEvent(input: {
  sessionId: string | null | undefined
  surface: MessageDecisionSurface
  messageId: number | null | undefined
  event: string
}): Promise<void> {
  const sessionId = String(input.sessionId || '').trim()
  if (!sessionId || !isValidSessionId(sessionId)) return
  const messageId = Number(input.messageId || 0)
  if (!Number.isFinite(messageId) || messageId <= 0) return

  const normalizedEvent = String(input.event || '').trim().toLowerCase()
  if (!['auth_complete', 'flow_complete'].includes(normalizedEvent)) return

  const existing = await repo.getSessionByKey(sessionId, input.surface)
  if (!existing) return
  const suppression = suppressionStateFromRow(existing)
  suppression.convertedMessageIds.add(messageId)

  const serialized = serializeSuppressionState(suppression)
  await repo.updateSession(Number(existing.id), {
    convertedMessageIdsJson: serialized.convertedMessageIdsJson,
  })
}
