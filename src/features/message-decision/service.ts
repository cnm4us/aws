import crypto from 'crypto'
import { DomainError } from '../../core/errors'
import {
  PROMPT_COOLDOWN_SECONDS_AFTER_PROMPT,
  PROMPT_MAX_PROMPTS_PER_SESSION,
  PROMPT_MIN_SLIDES_BEFORE_FIRST_PROMPT,
  PROMPT_MIN_SLIDES_BETWEEN_PROMPTS,
  PROMPT_MIN_WATCH_SECONDS_BEFORE_FIRST_PROMPT,
} from '../../config'
import * as messagesSvc from '../messages/service'
import * as repo from './repo'
import type {
  PromptAudienceSegment,
  PromptDecisionInput,
  PromptDecisionReasonCode,
  PromptDecisionResult,
  PromptDecisionSessionRow,
  PromptDecisionSurface,
} from './types'

const ALLOWED_SURFACES: readonly PromptDecisionSurface[] = ['global_feed']
const SESSION_ID_RE = /^[a-zA-Z0-9:_-]{8,120}$/

export const ANON_SESSION_COOKIE = 'anon_session_id'
export const ANON_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

type SessionSuppressionState = {
  convertedPromptIds: Set<number>
}

function normalizeSurface(raw: any): PromptDecisionSurface {
  const value = String(raw ?? '').trim().toLowerCase()
  if ((ALLOWED_SURFACES as readonly string[]).includes(value)) return value as PromptDecisionSurface
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

function parseCounters(raw: any): PromptDecisionInput['counters'] {
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
    promptsShownThisSession: messagesShownThisSession,
    slidesSinceLastPrompt: slidesSinceLastMessage,
    lastPromptShownAt: lastMessageShownAt,
    lastPromptId: lastMessageId,
  }
}

function parseConvertedPromptIds(raw: any): Set<number> {
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

function suppressionStateFromRow(row: PromptDecisionSessionRow | null): SessionSuppressionState {
  return {
    convertedPromptIds: parseConvertedPromptIds(row?.converted_prompt_ids_json),
  }
}

function serializeSuppressionState(state: SessionSuppressionState): {
  convertedPromptIdsJson: string
} {
  const converted = Array.from(state.convertedPromptIds).sort((a, b) => a - b)
  return {
    convertedPromptIdsJson: JSON.stringify(converted),
  }
}

function isPromptSuppressed(promptId: number, state: SessionSuppressionState): boolean {
  return state.convertedPromptIds.has(promptId)
}

function mergeSessionState(existing: PromptDecisionSessionRow | null, input: PromptDecisionInput): {
  audienceSegment: PromptAudienceSegment
  slidesViewed: number
  watchSeconds: number
  promptsShownThisSession: number
  slidesSinceLastPrompt: number
  lastPromptShownAt: string | null
  lastPromptId: number | null
  suppression: SessionSuppressionState
} {
  if (!existing) {
    return {
      audienceSegment: input.audienceSegment,
      slidesViewed: input.counters.slidesViewed,
      watchSeconds: input.counters.watchSeconds,
      promptsShownThisSession: input.counters.promptsShownThisSession,
      slidesSinceLastPrompt: input.counters.slidesSinceLastPrompt,
      lastPromptShownAt: input.counters.lastPromptShownAt,
      lastPromptId: input.counters.lastPromptId,
      suppression: { convertedPromptIds: new Set<number>() },
    }
  }

  return {
    audienceSegment: input.audienceSegment,
    slidesViewed: Math.max(Number(existing.slides_viewed || 0), input.counters.slidesViewed),
    watchSeconds: Math.max(Number(existing.watch_seconds || 0), input.counters.watchSeconds),
    // Server-authoritative counter; incremented when a prompt is actually selected.
    // This avoids client refreshes resetting rotation behavior.
    promptsShownThisSession: Number(existing.prompts_shown_this_session || 0),
    slidesSinceLastPrompt:
      input.counters.slidesSinceLastPrompt !== undefined && input.counters.slidesSinceLastPrompt !== null
        ? input.counters.slidesSinceLastPrompt
        : Number(existing.slides_since_last_prompt || 0),
    lastPromptShownAt: input.counters.lastPromptShownAt || existing.last_prompt_shown_at || null,
    lastPromptId: input.counters.lastPromptId ?? (existing.last_shown_prompt_id == null ? null : Number(existing.last_shown_prompt_id)),
    suppression: suppressionStateFromRow(existing),
  }
}

function nowMs(): number {
  return Date.now()
}

type EligiblePromptCandidate = {
  promptId: number
  promptType: string
  priority: number
  tieBreakStrategy: 'first' | 'round_robin' | 'weighted_random'
}

function selectPromptCandidate(
  candidates: EligiblePromptCandidate[],
  input: PromptDecisionInput,
  merged: ReturnType<typeof mergeSessionState>
): EligiblePromptCandidate | null {
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]

  const sorted = candidates
    .slice()
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      if (a.promptId !== b.promptId) return a.promptId - b.promptId
      return 0
    })

  const tieBreak = sorted[0]?.tieBreakStrategy || 'round_robin'

  if (tieBreak === 'round_robin') {
    const base = Math.max(0, Math.round(Number(merged.promptsShownThisSession || 0)))
    return sorted[base % sorted.length]
  }

  if (tieBreak === 'weighted_random') {
    const seed = `${input.sessionId}:${merged.promptsShownThisSession}:${merged.slidesViewed}:${merged.watchSeconds}:weighted_random`
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
  audienceSegment: PromptAudienceSegment
}): { input: PromptDecisionInput; createdSessionId: string | null } {
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

export async function decideMessage(input: PromptDecisionInput, opts?: { includeDebug?: boolean }): Promise<PromptDecisionResult> {
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
      promptsShownThisSession: merged.promptsShownThisSession,
      slidesSinceLastPrompt: merged.slidesSinceLastPrompt,
      convertedPromptIdsJson: suppressionJson.convertedPromptIdsJson,
      lastPromptShownAt: merged.lastPromptShownAt,
      lastPromptId: merged.lastPromptId,
      lastDecisionReason: null,
    })
  } else {
    await repo.updateSession(existing.id, {
      audienceSegment: merged.audienceSegment,
      slidesViewed: merged.slidesViewed,
      watchSeconds: merged.watchSeconds,
      promptsShownThisSession: merged.promptsShownThisSession,
      slidesSinceLastPrompt: merged.slidesSinceLastPrompt,
      convertedPromptIdsJson: suppressionJson.convertedPromptIdsJson,
      lastPromptShownAt: merged.lastPromptShownAt,
      lastPromptId: merged.lastPromptId,
    })
  }

  let reasonCode: PromptDecisionReasonCode = 'no_active_prompt'
  let promptId: number | null = null
  let selectionEngine: 'prompt_pool' = 'prompt_pool'
  let candidateCount = 0
  let selectedPriority: number | null = null

  if (merged.promptsShownThisSession >= PROMPT_MAX_PROMPTS_PER_SESSION) {
    reasonCode = 'cap_reached'
  } else {
    const lastShownMs = dateToMs(merged.lastPromptShownAt)
    if (
      lastShownMs != null &&
      PROMPT_COOLDOWN_SECONDS_AFTER_PROMPT > 0 &&
      nowMs() - lastShownMs < PROMPT_COOLDOWN_SECONDS_AFTER_PROMPT * 1000
    ) {
      reasonCode = 'cooldown_active'
    } else if (
      (merged.promptsShownThisSession <= 0 &&
        (merged.slidesViewed < PROMPT_MIN_SLIDES_BEFORE_FIRST_PROMPT ||
          merged.watchSeconds < PROMPT_MIN_WATCH_SECONDS_BEFORE_FIRST_PROMPT)) ||
      (merged.promptsShownThisSession > 0 && merged.slidesSinceLastPrompt < PROMPT_MIN_SLIDES_BETWEEN_PROMPTS)
    ) {
      reasonCode = 'below_threshold'
    } else {
      const messages = await messagesSvc.listActiveForFeed({
        limit: 300,
        appliesToSurface: input.surface,
        audienceSegment: merged.audienceSegment,
      })

      if (!messages.length) {
        reasonCode = 'no_active_prompt'
      } else {
        const candidates: EligiblePromptCandidate[] = []
        for (const prompt of messages) {
          const candidateId = Number(prompt.id || 0)
          if (!Number.isFinite(candidateId) || candidateId <= 0) continue
          if (isPromptSuppressed(candidateId, merged.suppression)) continue
          const tieBreakRaw = String((prompt as any).tieBreakStrategy || '').trim().toLowerCase()
          const tieBreakStrategy: 'first' | 'round_robin' | 'weighted_random' =
            tieBreakRaw === 'first' || tieBreakRaw === 'weighted_random' || tieBreakRaw === 'round_robin'
              ? tieBreakRaw
              : 'round_robin'
          candidates.push({
            promptId: candidateId,
            promptType: String(prompt.promptType || 'register_login'),
            priority: Number(prompt.priority || 0),
            tieBreakStrategy,
          })
        }

        candidateCount = candidates.length
        if (!candidateCount) {
          reasonCode = 'no_candidate'
        } else {
          const selected = selectPromptCandidate(candidates, input, merged)
          if (!selected) {
            reasonCode = 'no_candidate'
          } else {
            reasonCode = 'eligible'
            promptId = selected.promptId
            selectedPriority = selected.priority
          }
        }
      }
    }
  }

  const result: PromptDecisionResult = {
    shouldInsert: reasonCode === 'eligible' && promptId != null,
    promptId,
    insertAfterIndex: null,
    reasonCode,
    sessionId: input.sessionId,
  }

  const persisted = await repo.getSessionByKey(input.sessionId, input.surface)
  if (persisted) {
    const lastPromptShownAt = result.shouldInsert ? normalizeDateTime(new Date().toISOString(), 'last_prompt_shown_at') : undefined
    const nextShownCount = result.shouldInsert
      ? Number(persisted.prompts_shown_this_session || 0) + 1
      : Number(persisted.prompts_shown_this_session || 0)
    await repo.updateSession(persisted.id, {
      lastDecisionReason: reasonCode,
      promptsShownThisSession: nextShownCount,
      slidesSinceLastPrompt: result.shouldInsert ? 0 : undefined,
      lastPromptShownAt,
      lastPromptId: result.shouldInsert ? result.promptId : undefined,
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
        promptsShownThisSession: merged.promptsShownThisSession,
        slidesSinceLastPrompt: merged.slidesSinceLastPrompt,
        lastPromptShownAt: merged.lastPromptShownAt,
        lastPromptId: merged.lastPromptId,
        convertedPromptIds: Array.from(merged.suppression.convertedPromptIds),
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
  surface: PromptDecisionSurface
  promptId: number | null | undefined
  event: string
}): Promise<void> {
  const sessionId = String(input.sessionId || '').trim()
  if (!sessionId || !isValidSessionId(sessionId)) return
  const promptId = Number(input.promptId || 0)
  if (!Number.isFinite(promptId) || promptId <= 0) return

  const normalizedEvent = String(input.event || '').trim().toLowerCase()
  if (!['auth_complete', 'flow_complete'].includes(normalizedEvent)) return

  const existing = await repo.getSessionByKey(sessionId, input.surface)
  if (!existing) return
  const suppression = suppressionStateFromRow(existing)
  suppression.convertedPromptIds.add(promptId)

  const serialized = serializeSuppressionState(suppression)
  await repo.updateSession(Number(existing.id), {
    convertedPromptIdsJson: serialized.convertedPromptIdsJson,
  })
}

// Phase F1 compatibility aliases for message terminology.
export const decidePrompt = decideMessage
export const recordPromptSessionEvent = recordMessageSessionEvent
