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
import * as messageAttributionSvc from '../message-attribution/service'
import * as messageEligibilityRulesetsSvc from '../message-eligibility-rulesets/service'
import * as messageJourneysRepo from '../message-journeys/repo'
import * as repo from './repo'
import type { MessageEligibilityRule, MessageEligibilityRulesetDto } from '../message-eligibility-rulesets/types'
import type {
  MessageViewerState,
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
  viewerState: MessageViewerState
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
      viewerState: input.viewerState,
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
    viewerState: input.viewerState,
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
  campaignKey: string | null
  messageType: string
  priority: number
  tieBreakStrategy: 'first' | 'round_robin' | 'weighted_random'
  eligibilityRulesetId: number | null
  journeyId?: number | null
  journeyStepId?: number | null
  journeyStepOrder?: number | null
  journeyStepKey?: string | null
}

type SupportProfile = {
  isAuthenticated: boolean
  isSubscriber: boolean
  activeSubscriptionTierKeys: string[]
  completedIntents: Set<'donate' | 'subscribe' | 'upgrade'>
  donationEvents: Array<{ occurredAtMs: number; amountCents: number }>
}

function toUtcDateTimeFromMs(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`
}

function collectDonationLookbackDays(
  rulesets: Map<number, MessageEligibilityRulesetDto>,
  candidates: EligibleMessageCandidate[]
): number {
  let maxDays = 0
  for (const c of candidates) {
    const id = c.eligibilityRulesetId
    if (!id) continue
    const ruleset = rulesets.get(id)
    if (!ruleset) continue
    const all = [...ruleset.criteria.inclusion, ...ruleset.criteria.exclusion]
    for (const r of all) {
      if (r.op === 'support.donated_within_days') maxDays = Math.max(maxDays, Number(r.value || 0))
      if (r.op === 'support.donated_amount_last_days_gte') maxDays = Math.max(maxDays, Number(r.value?.days || 0))
    }
  }
  return maxDays
}

async function buildSupportProfile(
  userId: number | null,
  rulesets: Map<number, MessageEligibilityRulesetDto>,
  candidates: EligibleMessageCandidate[]
): Promise<SupportProfile> {
  if (userId == null || userId <= 0) {
    return {
      isAuthenticated: false,
      isSubscriber: false,
      activeSubscriptionTierKeys: [],
      completedIntents: new Set(),
      donationEvents: [],
    }
  }

  const lookbackDays = collectDonationLookbackDays(rulesets, candidates)
  const sinceUtc = lookbackDays > 0 ? toUtcDateTimeFromMs(nowMs() - lookbackDays * 24 * 60 * 60 * 1000) : null

  const [tierKeys, completedIntents, donationRows] = await Promise.all([
    repo.getUserActiveSubscriptionTierKeys(userId),
    repo.getCompletedIntentSet(userId),
    repo.listCompletedDonationTransactions(userId, sinceUtc),
  ])

  return {
    isAuthenticated: true,
    isSubscriber: tierKeys.length > 0,
    activeSubscriptionTierKeys: tierKeys,
    completedIntents,
    donationEvents: donationRows
      .map((r) => ({
        occurredAtMs: Date.parse(String(r.occurredAt).replace(' ', 'T') + 'Z'),
        amountCents: Number(r.amountCents || 0),
      }))
      .filter((r) => Number.isFinite(r.occurredAtMs) && Number.isFinite(r.amountCents)),
  }
}

function evaluateRule(profile: SupportProfile, rule: MessageEligibilityRule): boolean {
  if (rule.op === 'user.is_authenticated') return profile.isAuthenticated === rule.value
  if (rule.op === 'support.is_subscriber') return profile.isSubscriber === rule.value
  if (rule.op === 'support.subscription_tier_in') {
    const wanted = new Set((rule.value || []).map((v) => String(v).trim().toLowerCase()).filter(Boolean))
    return profile.activeSubscriptionTierKeys.some((k) => wanted.has(String(k).toLowerCase()))
  }
  if (rule.op === 'support.completed_intent_in') {
    const wanted = (rule.value || []).map((v) => String(v).trim().toLowerCase()).filter(Boolean)
    return wanted.some((intent) => profile.completedIntents.has(intent as any))
  }
  if (rule.op === 'support.donated_within_days') {
    const cutoffMs = nowMs() - Number(rule.value || 0) * 24 * 60 * 60 * 1000
    return profile.donationEvents.some((e) => e.occurredAtMs >= cutoffMs)
  }
  if (rule.op === 'support.donated_amount_last_days_gte') {
    const cutoffMs = nowMs() - Number(rule.value.days || 0) * 24 * 60 * 60 * 1000
    let total = 0
    for (const e of profile.donationEvents) {
      if (e.occurredAtMs >= cutoffMs) total += e.amountCents
    }
    return total >= Number(rule.value.cents || 0)
  }
  return false
}

function evaluateRuleset(
  ruleset: MessageEligibilityRulesetDto | null,
  profile: SupportProfile
): { pass: boolean; reason: string | null } {
  if (!ruleset) return { pass: true, reason: null }

  for (const rule of ruleset.criteria.exclusion) {
    if (evaluateRule(profile, rule)) return { pass: false, reason: `ruleset_exclusion:${rule.op}` }
  }
  for (const rule of ruleset.criteria.inclusion) {
    if (!evaluateRule(profile, rule)) return { pass: false, reason: `ruleset_inclusion_miss:${rule.op}` }
  }
  return { pass: true, reason: null }
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

async function applyJourneyGating(params: {
  userId: number | null
  candidates: EligibleMessageCandidate[]
}): Promise<{
  eligible: EligibleMessageCandidate[]
  rejectedCount: number
  dropReasons: Array<{ messageId: number; reason: string }>
}> {
  const inputCandidates = params.candidates
  if (!inputCandidates.length) {
    return { eligible: [], rejectedCount: 0, dropReasons: [] }
  }

  const steps = await messageJourneysRepo.listActiveStepsByMessageIds(inputCandidates.map((c) => c.messageId))
  if (!steps.length) {
    return { eligible: inputCandidates, rejectedCount: 0, dropReasons: [] }
  }

  const stepsByMessage = new Map<number, typeof steps>()
  const stepsByJourney = new Map<number, typeof steps>()
  for (const step of steps) {
    const messageId = Number(step.message_id)
    const journeyId = Number(step.journey_id)
    if (!stepsByMessage.has(messageId)) stepsByMessage.set(messageId, [])
    stepsByMessage.get(messageId)!.push(step)
    if (!stepsByJourney.has(journeyId)) stepsByJourney.set(journeyId, [])
    stepsByJourney.get(journeyId)!.push(step)
  }

  const dropReasons: Array<{ messageId: number; reason: string }> = []
  const eligible: EligibleMessageCandidate[] = []
  let rejectedCount = 0

  const userId = params.userId != null && Number.isFinite(Number(params.userId)) && Number(params.userId) > 0
    ? Math.round(Number(params.userId))
    : null
  if (userId == null) {
    for (const c of inputCandidates) {
      const attached = stepsByMessage.get(Number(c.messageId)) || []
      if (!attached.length) {
        eligible.push(c)
        continue
      }
      rejectedCount += 1
      if (dropReasons.length < 40) dropReasons.push({ messageId: c.messageId, reason: 'journey_requires_user' })
    }
    return { eligible, rejectedCount, dropReasons }
  }

  const progressRows = await messageJourneysRepo.listProgressByUserJourneyIds(userId, Array.from(stepsByJourney.keys()))
  const completedByJourneyStep = new Set<string>()
  for (const row of progressRows) {
    if (String(row.state) !== 'completed') continue
    completedByJourneyStep.add(`${Number(row.journey_id)}:${Number(row.step_id)}`)
  }

  const activeStepByJourney = new Map<number, (typeof steps)[number]>()
  for (const [journeyId, journeySteps] of stepsByJourney.entries()) {
    const sorted = journeySteps
      .slice()
      .sort((a, b) => Number(a.step_order) - Number(b.step_order) || Number(a.id) - Number(b.id))
    const next = sorted.find((step) => !completedByJourneyStep.has(`${journeyId}:${Number(step.id)}`))
    if (next) activeStepByJourney.set(journeyId, next)
  }

  for (const c of inputCandidates) {
    const attached = stepsByMessage.get(Number(c.messageId)) || []
    if (!attached.length) {
      eligible.push(c)
      continue
    }
    const matches = attached
      .filter((step) => {
        const active = activeStepByJourney.get(Number(step.journey_id))
        return !!active && Number(active.id) === Number(step.id)
      })
      .sort((a, b) => Number(a.step_order) - Number(b.step_order) || Number(a.journey_id) - Number(b.journey_id) || Number(a.id) - Number(b.id))

    if (!matches.length) {
      rejectedCount += 1
      if (dropReasons.length < 40) dropReasons.push({ messageId: c.messageId, reason: 'journey_step_not_current' })
      continue
    }

    const step = matches[0]
    eligible.push({
      ...c,
      journeyId: Number(step.journey_id),
      journeyStepId: Number(step.id),
      journeyStepOrder: Number(step.step_order),
      journeyStepKey: String(step.step_key || ''),
    })
  }

  return { eligible, rejectedCount, dropReasons }
}

export function buildDecisionInput(params: {
  body: any
  cookieSessionId: string | null
  viewerState: MessageViewerState
  userId?: number | null
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
      userId: params.userId != null && Number.isFinite(Number(params.userId)) && Number(params.userId) > 0 ? Number(params.userId) : null,
      viewerState: params.viewerState,
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
      viewerState: merged.viewerState,
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
      viewerState: merged.viewerState,
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
  let candidateCountBeforeRuleset = 0
  let userSuppressedCount = 0
  let rulesetRejectedCount = 0
  let journeyRejectedCount = 0
  let candidateCountBeforeJourney = 0
  let selectedPriority: number | null = null
  let selectedRulesetId: number | null = null
  let selectedJourneyId: number | null = null
  let selectedJourneyStepId: number | null = null
  let selectedJourneyStepOrder: number | null = null
  let selectedJourneyStepKey: string | null = null
  let rejectedRulesetId: number | null = null
  let rulesetResult: 'none' | 'pass' | 'reject' = 'none'
  let rulesetReason: string | null = null
  const candidateDropReasons: Array<{ messageId: number; reason: string }> = []

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
            campaignKey: (message as any).campaignKey == null ? null : String((message as any).campaignKey),
            messageType: String(message.type || 'register_login'),
            priority: Number(message.priority || 0),
            tieBreakStrategy,
            eligibilityRulesetId:
              (message as any).eligibilityRulesetId == null ? null : Number((message as any).eligibilityRulesetId),
          })
        }

        let eligible = candidates
        if (input.userId != null && input.userId > 0 && candidates.length > 0) {
          const filtered: EligibleMessageCandidate[] = []
          for (const c of candidates) {
            const suppressed = await messageAttributionSvc.isUserSuppressed({
              userId: input.userId,
              messageId: c.messageId,
              campaignKey: c.campaignKey,
            })
            if (suppressed) {
              userSuppressedCount += 1
              continue
            }
            filtered.push(c)
          }
          eligible = filtered
        }

        candidateCountBeforeRuleset = eligible.length
        if (eligible.length > 0) {
          const rulesetIds = Array.from(
            new Set(
              eligible
                .map((c) => (c.eligibilityRulesetId == null ? null : Number(c.eligibilityRulesetId)))
                .filter((id): id is number => Number.isFinite(id as any) && Number(id) > 0)
            )
          )
          const rulesetsById = await messageEligibilityRulesetsSvc.listActiveRulesetsById(rulesetIds)
          const profile = await buildSupportProfile(input.userId, rulesetsById, eligible)
          const rulesetFiltered: EligibleMessageCandidate[] = []
          for (const c of eligible) {
            const ruleset =
              c.eligibilityRulesetId == null
                ? null
                : (rulesetsById.get(Number(c.eligibilityRulesetId)) || null)
            const evalResult = evaluateRuleset(ruleset, profile)
            if (!evalResult.pass) {
              rulesetRejectedCount += 1
              if (rejectedRulesetId == null && c.eligibilityRulesetId != null && Number.isFinite(Number(c.eligibilityRulesetId)) && Number(c.eligibilityRulesetId) > 0) {
                rejectedRulesetId = Math.round(Number(c.eligibilityRulesetId))
              }
              if (candidateDropReasons.length < 40) {
                candidateDropReasons.push({
                  messageId: c.messageId,
                  reason: evalResult.reason || 'ruleset_rejected',
                })
              }
              continue
            }
            rulesetFiltered.push(c)
          }
          eligible = rulesetFiltered
          if (candidateCountBeforeRuleset > 0) {
            if (eligible.length > 0) {
              rulesetResult = 'pass'
            } else if (rulesetRejectedCount > 0) {
              rulesetResult = 'reject'
              rulesetReason = candidateDropReasons[0]?.reason || 'ruleset_rejected'
            }
          }
        }

        candidateCountBeforeJourney = eligible.length
        if (eligible.length > 0) {
          const gated = await applyJourneyGating({
            userId: input.userId,
            candidates: eligible,
          })
          journeyRejectedCount = gated.rejectedCount
          if (gated.dropReasons.length) {
            for (const reason of gated.dropReasons) {
              if (candidateDropReasons.length >= 40) break
              candidateDropReasons.push(reason)
            }
          }
          eligible = gated.eligible
        }

        candidateCount = eligible.length
        if (!candidateCount) {
          reasonCode = 'no_candidate'
        } else {
          const selected = selectMessageCandidate(eligible, input, merged)
          if (!selected) {
            reasonCode = 'no_candidate'
          } else {
            reasonCode = 'eligible'
            messageId = selected.messageId
            selectedPriority = selected.priority
            selectedRulesetId = selected.eligibilityRulesetId == null ? null : Number(selected.eligibilityRulesetId)
            selectedJourneyId = selected.journeyId == null ? null : Number(selected.journeyId)
            selectedJourneyStepId = selected.journeyStepId == null ? null : Number(selected.journeyStepId)
            selectedJourneyStepOrder = selected.journeyStepOrder == null ? null : Number(selected.journeyStepOrder)
            selectedJourneyStepKey = selected.journeyStepKey == null ? null : String(selected.journeyStepKey)
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
        viewerState: input.viewerState,
        counters: input.counters,
      },
      mergedSession: {
        viewerState: merged.viewerState,
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
        candidateCountBeforeRuleset,
        candidateCountBeforeJourney,
        userSuppressedCount,
        rulesetRejectedCount,
        journeyRejectedCount,
        rulesetResult,
        rulesetReason,
        selectedRulesetId,
        selectedJourneyId,
        selectedJourneyStepId,
        selectedJourneyStepOrder,
        selectedJourneyStepKey,
        rejectedRulesetId,
        selectedPriority,
        candidateDropReasons,
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
  if (!['auth_complete', 'flow_complete', 'donation_complete', 'subscription_complete', 'upgrade_complete'].includes(normalizedEvent)) return

  const existing = await repo.getSessionByKey(sessionId, input.surface)
  if (!existing) return
  const suppression = suppressionStateFromRow(existing)
  suppression.convertedMessageIds.add(messageId)

  const serialized = serializeSuppressionState(suppression)
  await repo.updateSession(Number(existing.id), {
    convertedMessageIdsJson: serialized.convertedMessageIdsJson,
  })
}
