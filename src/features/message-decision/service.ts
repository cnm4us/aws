import crypto from 'crypto'
import { DomainError } from '../../core/errors'
import {
  MESSAGE_COOLDOWN_SECONDS_AFTER_MESSAGE,
  MESSAGE_MAX_MESSAGES_PER_SESSION,
  MESSAGE_MIN_SLIDES_BEFORE_FIRST_MESSAGE,
  MESSAGE_MIN_SLIDES_BETWEEN_MESSAGES,
  MESSAGE_MIN_WATCH_SECONDS_BEFORE_FIRST_MESSAGE,
  MESSAGE_SELECTION_STRATEGY,
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

const ALLOWED_SURFACES: readonly MessageDecisionSurface[] = ['global_feed', 'group_feed', 'channel_feed']
const SESSION_ID_RE = /^[a-zA-Z0-9:_-]{8,120}$/

export const ANON_SESSION_COOKIE = 'anon_session_id'
export const ANON_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
export type JourneySubjectType = 'user' | 'anon'

export function toJourneySubjectId(params: { userId?: number | null; anonKey?: string | null }): string | null {
  const uid = params.userId != null && Number.isFinite(Number(params.userId)) && Number(params.userId) > 0
    ? Math.round(Number(params.userId))
    : 0
  if (uid > 0) return `user:${uid}`
  const anon = String(params.anonKey || '').trim()
  if (!anon) return null
  return `anon:${anon}`
}

export function toJourneySubjectType(params: { userId?: number | null; anonKey?: string | null }): JourneySubjectType | null {
  const uid = params.userId != null && Number.isFinite(Number(params.userId)) && Number(params.userId) > 0
    ? Math.round(Number(params.userId))
    : 0
  if (uid > 0) return 'user'
  const anon = String(params.anonKey || '').trim()
  if (anon) return 'anon'
  return null
}

function toJourneySubjectTypeFromSubjectId(raw: any): JourneySubjectType | null {
  const value = String(raw || '').trim().toLowerCase()
  if (value.startsWith('user:')) return 'user'
  if (value.startsWith('anon:')) return 'anon'
  return null
}

async function resolveJourneySubject(params: {
  userId?: number | null
  anonKey?: string | null
}): Promise<{
  rawJourneySubjectId: string | null
  rawJourneySubjectType: JourneySubjectType | null
  resolvedJourneySubjectId: string | null
  resolvedJourneySubjectType: JourneySubjectType | null
  resolutionSource: 'auth' | 'anon' | 'linked_anon' | null
}> {
  const rawJourneySubjectId = toJourneySubjectId(params)
  const rawJourneySubjectType = toJourneySubjectType(params)

  if (rawJourneySubjectType === 'user') {
    return {
      rawJourneySubjectId,
      rawJourneySubjectType,
      resolvedJourneySubjectId: rawJourneySubjectId,
      resolvedJourneySubjectType: 'user',
      resolutionSource: 'auth',
    }
  }

  if (rawJourneySubjectType === 'anon' && rawJourneySubjectId) {
    try {
      const link = await messageJourneysRepo.getJourneySubjectLinkBySourceSubjectId(rawJourneySubjectId)
      const canonical = String((link as any)?.canonical_subject_id || '').trim()
      const canonicalType = toJourneySubjectTypeFromSubjectId(canonical)
      if (canonical && canonicalType) {
        return {
          rawJourneySubjectId,
          rawJourneySubjectType,
          resolvedJourneySubjectId: canonical,
          resolvedJourneySubjectType: canonicalType,
          resolutionSource: 'linked_anon',
        }
      }
    } catch {}
    return {
      rawJourneySubjectId,
      rawJourneySubjectType,
      resolvedJourneySubjectId: rawJourneySubjectId,
      resolvedJourneySubjectType: 'anon',
      resolutionSource: 'anon',
    }
  }

  return {
    rawJourneySubjectId,
    rawJourneySubjectType,
    resolvedJourneySubjectId: rawJourneySubjectId,
    resolvedJourneySubjectType: rawJourneySubjectType,
    resolutionSource: null,
  }
}

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

function normalizeOptionalPositiveInt(raw: any): number | null {
  if (raw == null || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value)
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
  campaignCategory: string | null
  messageType: string
  priority: number
  deliveryScope: 'standalone_only' | 'journey_only' | 'both'
  eligibilityRulesetId: number | null
  journeyId?: number | null
  journeyStepId?: number | null
  journeyStepOrder?: number | null
  journeyStepKey?: string | null
  journeyRulesetId?: number | null
  journeyCampaignCategory?: string | null
  journeyInstanceId?: number | null
  journeyRunState?: 'active' | 'completed' | 'abandoned' | 'expired' | null
  journeyReentryPolicy?: JourneyReentryPolicy | null
  journeyReentryTriggered?: boolean
  deliveryContext?: 'standalone' | 'journey'
  surfaceTargeting?: Array<{
    surface: MessageDecisionSurface
    targetingMode: 'all' | 'selected'
    targetIds: number[]
  }>
  standaloneTargetMatch?: boolean
  standaloneTargetingMode?: 'all' | 'selected' | null
}

type CandidateDropReason = {
  messageId: number
  reason: string
  targetingMode?: 'all' | 'selected' | null
  targetType?: 'global_feed' | 'group_feed' | 'channel_feed' | null
  targetId?: number | null
  targetMatch?: boolean | null
}

type SupportProfile = {
  isAuthenticated: boolean
  isSubscriber: boolean
  activeSubscriptionTierKeys: string[]
  completedIntents: Set<'donate' | 'subscribe' | 'upgrade'>
  donationEvents: Array<{ occurredAtMs: number; amountCents: number }>
}

type JourneyReentryPolicy = 'never_reenter' | 'reenter_after_days' | 'allow_restart'
type JourneyRuntimePolicy = {
  reentryPolicy: JourneyReentryPolicy
  reentryCooldownDays: number
  journeyExpiresAfterDays: number | null
  stepExpiresAfterDays: number | null
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
    const id = (c.journeyStepId != null && Number(c.journeyStepId) > 0)
      ? c.journeyRulesetId
      : c.eligibilityRulesetId
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

function resolveCandidateRulesetId(candidate: EligibleMessageCandidate): number | null {
  const inJourney = candidate.journeyStepId != null && Number(candidate.journeyStepId) > 0
  if (inJourney) {
    return candidate.journeyRulesetId == null ? null : Number(candidate.journeyRulesetId)
  }
  return candidate.eligibilityRulesetId == null ? null : Number(candidate.eligibilityRulesetId)
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

  const tieBreak = MESSAGE_SELECTION_STRATEGY || 'round_robin'

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

function matchesSurfaceTargeting(params: {
  surface: MessageDecisionSurface
  groupId: number | null
  channelId: number | null
  targeting: Array<{ surface: MessageDecisionSurface; targetingMode: 'all' | 'selected'; targetIds: number[] }>
}): boolean {
  const row = (params.targeting || []).find((item) => String(item.surface || '').toLowerCase() === params.surface)
  if (!row) return false
  const mode = String(row.targetingMode || 'all').toLowerCase() === 'selected' ? 'selected' : 'all'
  if (params.surface === 'global_feed') return true
  if (mode === 'all') return true
  const targetId = params.surface === 'group_feed' ? params.groupId : params.channelId
  if (targetId == null || !Number.isFinite(targetId) || targetId <= 0) return false
  return Array.isArray(row.targetIds) && row.targetIds.some((id) => Number(id) === Number(targetId))
}

function resolveTargetTypeForSurface(surface: MessageDecisionSurface): 'global_feed' | 'group_feed' | 'channel_feed' {
  return surface === 'group_feed' ? 'group_feed' : (surface === 'channel_feed' ? 'channel_feed' : 'global_feed')
}

function resolveTargetIdForSurface(surface: MessageDecisionSurface, surfaceTarget: { groupId: number | null; channelId: number | null }): number | null {
  if (surface === 'group_feed') return surfaceTarget.groupId
  if (surface === 'channel_feed') return surfaceTarget.channelId
  return null
}

function resolveSurfaceTargetingMode(
  targeting: Array<{ surface: MessageDecisionSurface; targetingMode: 'all' | 'selected'; targetIds: number[] }>,
  surface: MessageDecisionSurface
): 'all' | 'selected' | null {
  const row = (targeting || []).find((item) => String(item.surface || '').toLowerCase() === surface)
  if (!row) return null
  return String(row.targetingMode || '').toLowerCase() === 'selected' ? 'selected' : 'all'
}

function dateToMs(raw: string | null): number | null {
  if (!raw) return null
  const date = new Date(String(raw).replace(' ', 'T') + 'Z')
  if (!Number.isFinite(date.getTime())) return null
  return date.getTime()
}

function parseJourneyRuntimePolicyFromConfigRaw(raw: any): JourneyRuntimePolicy {
  let cfg: Record<string, any> = {}
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cfg = parsed as Record<string, any>
  } catch {}

  const reentryPolicyRaw = String(cfg.reentry_policy || cfg.reentryPolicy || '').trim().toLowerCase()
  const reentryPolicy: JourneyReentryPolicy =
    reentryPolicyRaw === 'allow_restart'
      ? 'allow_restart'
      : (reentryPolicyRaw === 'reenter_after_days' ? 'reenter_after_days' : 'never_reenter')

  const cooldownNum = Number(cfg.reentry_cooldown_days ?? cfg.reentryCooldownDays ?? 0)
  const reentryCooldownDays = Number.isFinite(cooldownNum) && cooldownNum > 0 ? Math.round(cooldownNum) : 0

  const journeyExpNum = Number(cfg.journey_expires_after_days ?? cfg.journeyExpiresAfterDays ?? 0)
  const journeyExpiresAfterDays =
    Number.isFinite(journeyExpNum) && journeyExpNum > 0 ? Math.round(journeyExpNum) : null

  const stepExpNum = Number(cfg.step_expires_after_days ?? cfg.stepExpiresAfterDays ?? 0)
  const stepExpiresAfterDays =
    Number.isFinite(stepExpNum) && stepExpNum > 0 ? Math.round(stepExpNum) : null

  return {
    reentryPolicy,
    reentryCooldownDays,
    journeyExpiresAfterDays,
    stepExpiresAfterDays,
  }
}

function isJourneyTerminalState(stateRaw: any): boolean {
  const state = String(stateRaw || '').trim().toLowerCase()
  return state === 'completed' || state === 'abandoned' || state === 'expired'
}

function parseJourneyPolicyMap(
  steps: Array<any>
): Map<number, JourneyRuntimePolicy> {
  const out = new Map<number, JourneyRuntimePolicy>()
  for (const step of steps) {
    const journeyId = Number((step as any).journey_id || 0)
    if (!Number.isFinite(journeyId) || journeyId <= 0) continue
    if (out.has(journeyId)) continue
    out.set(journeyId, parseJourneyRuntimePolicyFromConfigRaw((step as any).journey_config_json))
  }
  return out
}

function isPastDays(referenceMs: number | null, days: number): boolean {
  if (!referenceMs || !Number.isFinite(referenceMs)) return false
  if (!Number.isFinite(days) || days <= 0) return false
  return nowMs() >= (referenceMs + (days * 24 * 60 * 60 * 1000))
}

async function applyJourneyGating(params: {
  userId: number | null
  anonVisitorId?: string | null
  resolvedJourneySubjectId?: string | null
  surface: MessageDecisionSurface
  surfaceTarget: { groupId: number | null; channelId: number | null }
  candidates: EligibleMessageCandidate[]
}): Promise<{
  eligible: EligibleMessageCandidate[]
  rejectedCount: number
  dropReasons: CandidateDropReason[]
}> {
  const inputCandidates = params.candidates
  if (!inputCandidates.length) {
    return { eligible: [], rejectedCount: 0, dropReasons: [] }
  }

  const candidateAttachedSteps = await messageJourneysRepo.listActiveStepsByMessageIds(inputCandidates.map((c) => c.messageId))
  if (!candidateAttachedSteps.length) {
    const eligible = inputCandidates
      .filter((c) => c.deliveryScope !== 'journey_only')
      .map((c) => ({ ...c, deliveryContext: 'standalone' as const }))
    const rejected = inputCandidates.length - eligible.length
    const dropReasons = rejected > 0
      ? inputCandidates
          .filter((c) => c.deliveryScope === 'journey_only')
          .slice(0, 40)
          .map((c) => ({ messageId: c.messageId, reason: 'journey_only_message' }))
      : []
    return { eligible, rejectedCount: rejected, dropReasons }
  }
  const attachedJourneyIds = Array.from(
    new Set(candidateAttachedSteps.map((step) => Number((step as any).journey_id || 0)).filter((n) => Number.isFinite(n) && n > 0))
  )
  const steps = await messageJourneysRepo.listActiveStepsByJourneyIds(attachedJourneyIds)
  if (!steps.length) {
    return { eligible: [], rejectedCount: inputCandidates.length, dropReasons: inputCandidates.slice(0, 40).map((c) => ({ messageId: c.messageId, reason: 'journey_not_active' })) }
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
  const journeyTargetingMap = await messageJourneysRepo.listSurfaceTargetingByJourneyIds(Array.from(stepsByJourney.keys()))
  const journeyIds = Array.from(stepsByJourney.keys())
  const journeyPolicyMap = parseJourneyPolicyMap(steps as any[])

  const dropReasons: CandidateDropReason[] = []
  const eligible: EligibleMessageCandidate[] = []
  let rejectedCount = 0

  const userId = params.userId != null && Number.isFinite(Number(params.userId)) && Number(params.userId) > 0
    ? Math.round(Number(params.userId))
    : null
  const anonVisitorId = userId == null ? String(params.anonVisitorId || '').trim() : ''
  const journeySubjectId = String(params.resolvedJourneySubjectId || toJourneySubjectId({ userId, anonKey: anonVisitorId || null }) || '').trim() || null
  if (userId == null) {
    const terminalJourneys = new Set<number>()
    const restartJourneys = new Set<number>()
    const activeInstanceByJourney = new Map<number, any>()
    if (anonVisitorId) {
      let instanceRows: any[] = []
      if (journeySubjectId) {
        instanceRows = await messageJourneysRepo.listJourneyInstancesBySubjectJourneyIds(journeySubjectId, journeyIds)
      }
      for (const row of instanceRows as any[]) {
        const journeyId = Number(row?.journey_id || 0)
        if (!Number.isFinite(journeyId) || journeyId <= 0) continue
        const policy = journeyPolicyMap.get(journeyId) || {
          reentryPolicy: 'never_reenter' as JourneyReentryPolicy,
          reentryCooldownDays: 0,
          journeyExpiresAfterDays: null,
          stepExpiresAfterDays: null,
        }

        let state = String(row?.state || '').trim().toLowerCase()
        if (state === 'active' && policy.journeyExpiresAfterDays && policy.journeyExpiresAfterDays > 0) {
          const refMs =
            dateToMs((row as any).first_seen_at || null) ??
            dateToMs((row as any).last_seen_at || null) ??
            dateToMs((row as any).updated_at || null) ??
            dateToMs((row as any).created_at || null)
          if (isPastDays(refMs, policy.journeyExpiresAfterDays)) {
            state = 'expired'
            try {
              await messageJourneysRepo.updateJourneyInstanceById(Number((row as any).id), {
                state: 'expired',
                completedReason: String((row as any).completed_reason || 'journey_expired'),
                completedAt: toUtcDateTimeFromMs(nowMs()),
                lastSeenAt: toUtcDateTimeFromMs(nowMs()),
              })
            } catch {}
          }
        }

        if (!isJourneyTerminalState(state)) {
          if (state === 'active' && !activeInstanceByJourney.has(journeyId)) {
            activeInstanceByJourney.set(journeyId, row)
          }
          continue
        }
        if (activeInstanceByJourney.has(journeyId)) continue
        if (policy.reentryPolicy === 'allow_restart') {
          try {
            const created = await messageJourneysRepo.createJourneyInstance({
              journeyId,
              identityType: 'anon',
              identityKey: anonVisitorId,
              journeySubjectId,
              state: 'active',
              currentStepId: null,
              firstSeenAt: null,
              lastSeenAt: toUtcDateTimeFromMs(nowMs()),
              metadataJson: JSON.stringify({
                source: 'reentry',
                previous_instance_id: Number((row as any).id || 0),
                previous_state: String((row as any).state || ''),
                restarted_at: new Date().toISOString(),
              }),
            })
            activeInstanceByJourney.set(journeyId, created)
            restartJourneys.add(journeyId)
          } catch {}
          continue
        }
        if (policy.reentryPolicy === 'reenter_after_days' && policy.reentryCooldownDays > 0) {
          const refMs =
            dateToMs((row as any).completed_at || null) ??
            dateToMs((row as any).last_seen_at || null) ??
            dateToMs((row as any).updated_at || null)
          if (isPastDays(refMs, policy.reentryCooldownDays)) {
            try {
              const created = await messageJourneysRepo.createJourneyInstance({
                journeyId,
                identityType: 'anon',
                identityKey: anonVisitorId,
                journeySubjectId,
                state: 'active',
                currentStepId: null,
                firstSeenAt: null,
                lastSeenAt: toUtcDateTimeFromMs(nowMs()),
                metadataJson: JSON.stringify({
                  source: 'reentry',
                  previous_instance_id: Number((row as any).id || 0),
                  previous_state: String((row as any).state || ''),
                  restarted_at: new Date().toISOString(),
                }),
              })
              activeInstanceByJourney.set(journeyId, created)
              restartJourneys.add(journeyId)
            } catch {}
            continue
          }
        }
        terminalJourneys.add(journeyId)
      }
    }
    const completedByJourneyStep = new Set<string>()
    if (anonVisitorId) {
      const activeInstanceIds = Array.from(activeInstanceByJourney.values())
        .map((row: any) => Number(row?.id || 0))
        .filter((id) => Number.isFinite(id) && id > 0)
      const canonicalProgressRows = activeInstanceIds.length
        ? await messageJourneysRepo.listCanonicalProgressByInstanceIds(activeInstanceIds)
        : []
      const canonicalByInstance = new Set(
        canonicalProgressRows
          .map((row: any) => Number((row as any)?.journey_instance_id || 0))
          .filter((id: number) => Number.isFinite(id) && id > 0)
      )
      const missingInstanceIds = activeInstanceIds.filter((id) => !canonicalByInstance.has(id))
      const fallbackAnonProgressRows = missingInstanceIds.length
        ? await messageJourneysRepo.listAnonProgressByVisitorInstanceIds(anonVisitorId, missingInstanceIds)
        : []
      for (const row of [...canonicalProgressRows, ...fallbackAnonProgressRows]) {
        if (restartJourneys.has(Number((row as any).journey_id || 0))) continue
        if (String((row as any).state || '') !== 'completed') continue
        completedByJourneyStep.add(`${Number((row as any).journey_id)}:${Number((row as any).step_id)}`)
      }
    }
    const activeStepByJourney = new Map<number, (typeof steps)[number]>()
    for (const [journeyId, journeySteps] of stepsByJourney.entries()) {
      if (terminalJourneys.has(journeyId) && !restartJourneys.has(journeyId)) continue
      const sorted = journeySteps
        .slice()
        .sort((a, b) => Number(a.step_order) - Number(b.step_order) || Number(a.id) - Number(b.id))
      let next = sorted.find((step) => !completedByJourneyStep.has(`${journeyId}:${Number(step.id)}`))
      if (!next && restartJourneys.has(journeyId)) next = sorted[0]
      if (next) activeStepByJourney.set(journeyId, next)
    }
    for (const [journeyId, step] of activeStepByJourney.entries()) {
      const existing = activeInstanceByJourney.get(journeyId) as any
      if (existing) {
        const existingStepId = Number(existing?.current_step_id || 0)
        if (!Number.isFinite(existingStepId) || existingStepId <= 0 || existingStepId !== Number(step.id)) {
          try {
            await messageJourneysRepo.updateJourneyInstanceById(Number(existing.id), {
              currentStepId: Number(step.id),
              lastSeenAt: toUtcDateTimeFromMs(nowMs()),
            })
            existing.current_step_id = Number(step.id)
          } catch {}
        }
        continue
      }
      try {
        const created = await messageJourneysRepo.createJourneyInstance({
          journeyId,
          identityType: 'anon',
          identityKey: anonVisitorId,
          journeySubjectId,
          state: 'active',
          currentStepId: Number(step.id),
          firstSeenAt: toUtcDateTimeFromMs(nowMs()),
          lastSeenAt: toUtcDateTimeFromMs(nowMs()),
          metadataJson: JSON.stringify({
            source: 'journey_decision',
            reason: 'ensure_active_instance',
            created_at: new Date().toISOString(),
          }),
        })
        activeInstanceByJourney.set(journeyId, created)
      } catch {}
    }

    for (const c of inputCandidates) {
      const attached = stepsByMessage.get(Number(c.messageId)) || []
      if (!attached.length) {
        if (c.deliveryScope === 'journey_only') {
          rejectedCount += 1
          if (dropReasons.length < 40) dropReasons.push({ messageId: c.messageId, reason: 'journey_only_message' })
          continue
        }
        if (c.standaloneTargetMatch === false) {
          rejectedCount += 1
          if (dropReasons.length < 40) {
            dropReasons.push({
              messageId: c.messageId,
              reason: 'target_miss',
              targetingMode: c.standaloneTargetingMode ?? null,
              targetType: resolveTargetTypeForSurface(params.surface),
              targetId: resolveTargetIdForSurface(params.surface, params.surfaceTarget),
              targetMatch: false,
            })
          }
          continue
        }
        eligible.push({ ...c, deliveryContext: 'standalone' })
        continue
      }
      if (c.deliveryScope === 'standalone_only') {
        rejectedCount += 1
        if (dropReasons.length < 40) dropReasons.push({ messageId: c.messageId, reason: 'journey_scope_conflict' })
        continue
      }
      if (attached.every((step) => terminalJourneys.has(Number((step as any).journey_id || 0)))) {
        rejectedCount += 1
        if (dropReasons.length < 40) dropReasons.push({ messageId: c.messageId, reason: 'journey_terminal_state' })
        continue
      }
      const matchingSurface = attached.some((step) => {
        if (terminalJourneys.has(Number((step as any).journey_id || 0))) return false
        const journeyId = Number((step as any).journey_id || 0)
        const targeting = journeyTargetingMap.get(journeyId)
        if (targeting && targeting.length) {
          return matchesSurfaceTargeting({
            surface: params.surface,
            groupId: params.surfaceTarget.groupId,
            channelId: params.surfaceTarget.channelId,
            targeting: targeting as any,
          })
        }
        return String((step as any).journey_surface || 'global_feed') === params.surface
      })
      if (!matchingSurface) {
        rejectedCount += 1
        if (dropReasons.length < 40) dropReasons.push({ messageId: c.messageId, reason: 'journey_surface_mismatch' })
        continue
      }
      const matches = attached
        .filter((step) => {
          if (terminalJourneys.has(Number(step.journey_id))) return false
          const active = activeStepByJourney.get(Number(step.journey_id))
          return !!active && Number(active.id) === Number(step.id)
        })
        .sort((a, b) => Number(a.step_order) - Number(b.step_order) || Number(a.id) - Number(b.id))
      if (!matches.length) {
        rejectedCount += 1
        if (dropReasons.length < 40) dropReasons.push({ messageId: c.messageId, reason: 'journey_step_not_current' })
        continue
      }
      const step = matches[0] as any
      const journeyId = Number(step.journey_id)
      const activeInstance = activeInstanceByJourney.get(journeyId) || null
      const policy = journeyPolicyMap.get(journeyId) || null
      eligible.push({
        ...c,
        journeyId,
        journeyStepId: Number(step.id),
        journeyStepOrder: Number(step.step_order || 0),
        journeyStepKey: String(step.step_key || ''),
        journeyRulesetId: step.journey_ruleset_id == null ? null : Number(step.journey_ruleset_id),
        journeyCampaignCategory:
          step.journey_campaign_category == null || String(step.journey_campaign_category).trim() === ''
            ? null
            : String(step.journey_campaign_category).trim().toLowerCase(),
        journeyInstanceId:
          activeInstance && Number.isFinite(Number((activeInstance as any).id)) && Number((activeInstance as any).id) > 0
            ? Number((activeInstance as any).id)
            : null,
        journeyRunState:
          activeInstance && String((activeInstance as any).state || '').trim()
            ? (String((activeInstance as any).state).trim().toLowerCase() as any)
            : 'active',
        journeyReentryPolicy: policy?.reentryPolicy || null,
        journeyReentryTriggered: restartJourneys.has(journeyId),
        deliveryContext: 'journey',
      })
    }
    return { eligible, rejectedCount, dropReasons }
  }

  const terminalJourneys = new Set<number>()
  const restartJourneys = new Set<number>()
  const activeInstanceByJourney = new Map<number, any>()
  {
    let instanceRows: any[] = []
    if (journeySubjectId) {
      instanceRows = await messageJourneysRepo.listJourneyInstancesBySubjectJourneyIds(journeySubjectId, journeyIds)
    }
    for (const row of instanceRows as any[]) {
      const journeyId = Number(row?.journey_id || 0)
      if (!Number.isFinite(journeyId) || journeyId <= 0) continue
      const policy = journeyPolicyMap.get(journeyId) || {
        reentryPolicy: 'never_reenter' as JourneyReentryPolicy,
        reentryCooldownDays: 0,
        journeyExpiresAfterDays: null,
        stepExpiresAfterDays: null,
      }

      let state = String(row?.state || '').trim().toLowerCase()
      if (state === 'active' && policy.journeyExpiresAfterDays && policy.journeyExpiresAfterDays > 0) {
        const refMs =
          dateToMs((row as any).first_seen_at || null) ??
          dateToMs((row as any).last_seen_at || null) ??
          dateToMs((row as any).updated_at || null) ??
          dateToMs((row as any).created_at || null)
        if (isPastDays(refMs, policy.journeyExpiresAfterDays)) {
          state = 'expired'
          try {
            await messageJourneysRepo.updateJourneyInstanceById(Number((row as any).id), {
              state: 'expired',
              completedReason: String((row as any).completed_reason || 'journey_expired'),
              completedAt: toUtcDateTimeFromMs(nowMs()),
              lastSeenAt: toUtcDateTimeFromMs(nowMs()),
            })
          } catch {}
        }
      }

      if (!isJourneyTerminalState(state)) {
        if (state === 'active' && !activeInstanceByJourney.has(journeyId)) {
          activeInstanceByJourney.set(journeyId, row)
        }
        continue
      }
      if (activeInstanceByJourney.has(journeyId)) continue
      if (policy.reentryPolicy === 'allow_restart') {
        try {
          const created = await messageJourneysRepo.createJourneyInstance({
            journeyId,
            identityType: 'user',
            identityKey: String(userId),
            journeySubjectId,
            state: 'active',
            currentStepId: null,
            firstSeenAt: null,
            lastSeenAt: toUtcDateTimeFromMs(nowMs()),
            metadataJson: JSON.stringify({
              source: 'reentry',
              previous_instance_id: Number((row as any).id || 0),
              previous_state: String((row as any).state || ''),
              restarted_at: new Date().toISOString(),
            }),
          })
          activeInstanceByJourney.set(journeyId, created)
          restartJourneys.add(journeyId)
        } catch {}
        continue
      }
      if (policy.reentryPolicy === 'reenter_after_days' && policy.reentryCooldownDays > 0) {
        const refMs =
          dateToMs((row as any).completed_at || null) ??
          dateToMs((row as any).last_seen_at || null) ??
          dateToMs((row as any).updated_at || null)
        if (isPastDays(refMs, policy.reentryCooldownDays)) {
          try {
            const created = await messageJourneysRepo.createJourneyInstance({
              journeyId,
              identityType: 'user',
              identityKey: String(userId),
              journeySubjectId,
              state: 'active',
              currentStepId: null,
              firstSeenAt: null,
              lastSeenAt: toUtcDateTimeFromMs(nowMs()),
              metadataJson: JSON.stringify({
                source: 'reentry',
                previous_instance_id: Number((row as any).id || 0),
                previous_state: String((row as any).state || ''),
                restarted_at: new Date().toISOString(),
              }),
            })
            activeInstanceByJourney.set(journeyId, created)
            restartJourneys.add(journeyId)
          } catch {}
          continue
        }
      }
      terminalJourneys.add(journeyId)
    }
  }
  const activeInstanceIds = Array.from(activeInstanceByJourney.values())
    .map((row: any) => Number(row?.id || 0))
    .filter((id) => Number.isFinite(id) && id > 0)
  const canonicalProgressRows = activeInstanceIds.length
    ? await messageJourneysRepo.listCanonicalProgressByInstanceIds(activeInstanceIds)
    : []
  const canonicalByInstance = new Set(
    canonicalProgressRows
      .map((row: any) => Number((row as any)?.journey_instance_id || 0))
      .filter((id: number) => Number.isFinite(id) && id > 0)
  )
  const missingInstanceIds = activeInstanceIds.filter((id) => !canonicalByInstance.has(id))
  const fallbackUserProgressRows = missingInstanceIds.length
    ? await messageJourneysRepo.listProgressByUserInstanceIds(userId, missingInstanceIds)
    : []
  const completedByJourneyStep = new Set<string>()
  for (const row of [...canonicalProgressRows, ...fallbackUserProgressRows]) {
    if (restartJourneys.has(Number((row as any).journey_id || 0))) continue
    if (String(row.state) !== 'completed') continue
    completedByJourneyStep.add(`${Number(row.journey_id)}:${Number(row.step_id)}`)
  }

  const activeStepByJourney = new Map<number, (typeof steps)[number]>()
  for (const [journeyId, journeySteps] of stepsByJourney.entries()) {
    if (terminalJourneys.has(journeyId) && !restartJourneys.has(journeyId)) continue
    const sorted = journeySteps
      .slice()
      .sort((a, b) => Number(a.step_order) - Number(b.step_order) || Number(a.id) - Number(b.id))
    let next = sorted.find((step) => !completedByJourneyStep.has(`${journeyId}:${Number(step.id)}`))
    if (!next && restartJourneys.has(journeyId)) next = sorted[0]
    if (next) activeStepByJourney.set(journeyId, next)
  }
  for (const [journeyId, step] of activeStepByJourney.entries()) {
    const existing = activeInstanceByJourney.get(journeyId) as any
    if (existing) {
      const existingStepId = Number(existing?.current_step_id || 0)
      if (!Number.isFinite(existingStepId) || existingStepId <= 0 || existingStepId !== Number(step.id)) {
        try {
          await messageJourneysRepo.updateJourneyInstanceById(Number(existing.id), {
            currentStepId: Number(step.id),
            lastSeenAt: toUtcDateTimeFromMs(nowMs()),
          })
          existing.current_step_id = Number(step.id)
        } catch {}
      }
      continue
    }
    try {
      const created = await messageJourneysRepo.createJourneyInstance({
        journeyId,
        identityType: 'user',
        identityKey: String(userId),
        journeySubjectId,
        state: 'active',
        currentStepId: Number(step.id),
        firstSeenAt: toUtcDateTimeFromMs(nowMs()),
        lastSeenAt: toUtcDateTimeFromMs(nowMs()),
        metadataJson: JSON.stringify({
          source: 'journey_decision',
          reason: 'ensure_active_instance',
          created_at: new Date().toISOString(),
        }),
      })
      activeInstanceByJourney.set(journeyId, created)
    } catch {}
  }

  for (const c of inputCandidates) {
    const attached = stepsByMessage.get(Number(c.messageId)) || []
    if (!attached.length) {
      if (c.deliveryScope === 'journey_only') {
        rejectedCount += 1
        if (dropReasons.length < 40) dropReasons.push({ messageId: c.messageId, reason: 'journey_only_message' })
        continue
      }
      if (c.standaloneTargetMatch === false) {
        rejectedCount += 1
        if (dropReasons.length < 40) {
          dropReasons.push({
            messageId: c.messageId,
            reason: 'target_miss',
            targetingMode: c.standaloneTargetingMode ?? null,
            targetType: resolveTargetTypeForSurface(params.surface),
            targetId: resolveTargetIdForSurface(params.surface, params.surfaceTarget),
            targetMatch: false,
          })
        }
        continue
      }
      eligible.push({ ...c, deliveryContext: 'standalone' })
      continue
    }
    if (c.deliveryScope === 'standalone_only') {
      rejectedCount += 1
      if (dropReasons.length < 40) dropReasons.push({ messageId: c.messageId, reason: 'journey_scope_conflict' })
      continue
    }
    if (attached.every((step) => terminalJourneys.has(Number((step as any).journey_id || 0)))) {
      rejectedCount += 1
      if (dropReasons.length < 40) dropReasons.push({ messageId: c.messageId, reason: 'journey_terminal_state' })
      continue
    }
    const attachedOnSurface = attached.filter((step) => {
      if (terminalJourneys.has(Number((step as any).journey_id || 0))) return false
      const journeyId = Number((step as any).journey_id || 0)
      const targeting = journeyTargetingMap.get(journeyId)
      if (targeting && targeting.length) {
        return matchesSurfaceTargeting({
          surface: params.surface,
          groupId: params.surfaceTarget.groupId,
          channelId: params.surfaceTarget.channelId,
          targeting: targeting as any,
        })
      }
      return String((step as any).journey_surface || 'global_feed') === params.surface
    })
    if (!attachedOnSurface.length) {
      rejectedCount += 1
      if (dropReasons.length < 40) dropReasons.push({ messageId: c.messageId, reason: 'journey_surface_mismatch' })
      continue
    }
    const matches = attachedOnSurface
      .filter((step) => {
        if (terminalJourneys.has(Number(step.journey_id))) return false
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
    const journeyId = Number((step as any).journey_id)
    const activeInstance = activeInstanceByJourney.get(journeyId) || null
    const policy = journeyPolicyMap.get(journeyId) || null
    eligible.push({
      ...c,
      journeyId,
      journeyStepId: Number(step.id),
      journeyStepOrder: Number(step.step_order),
      journeyStepKey: String(step.step_key || ''),
      journeyRulesetId: step.journey_ruleset_id == null ? null : Number(step.journey_ruleset_id),
      journeyCampaignCategory:
        step.journey_campaign_category == null || String(step.journey_campaign_category).trim() === ''
          ? null
          : String(step.journey_campaign_category).trim().toLowerCase(),
      journeyInstanceId:
        activeInstance && Number.isFinite(Number((activeInstance as any).id)) && Number((activeInstance as any).id) > 0
          ? Number((activeInstance as any).id)
          : null,
      journeyRunState:
        activeInstance && String((activeInstance as any).state || '').trim()
          ? (String((activeInstance as any).state).trim().toLowerCase() as any)
          : 'active',
      journeyReentryPolicy: policy?.reentryPolicy || null,
      journeyReentryTriggered: restartJourneys.has(journeyId),
      deliveryContext: 'journey',
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
  const groupId = normalizeOptionalPositiveInt(
    params.body?.group_id ?? params.body?.groupId ?? params.body?.surface_group_id ?? params.body?.surfaceGroupId
  )
  const channelId = normalizeOptionalPositiveInt(
    params.body?.channel_id ?? params.body?.channelId ?? params.body?.surface_channel_id ?? params.body?.surfaceChannelId
  )

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
      surfaceTarget: {
        groupId,
        channelId,
      },
      sessionId,
      userId: params.userId != null && Number.isFinite(Number(params.userId)) && Number(params.userId) > 0 ? Number(params.userId) : null,
      anonVisitorId:
        (params.userId != null && Number.isFinite(Number(params.userId)) && Number(params.userId) > 0)
          ? null
          : sessionId,
      viewerState: params.viewerState,
      counters,
    },
    createdSessionId,
  }
}

export async function decideMessage(input: MessageDecisionInput, opts?: { includeDebug?: boolean }): Promise<MessageDecisionResult> {
  const subjectResolution = await resolveJourneySubject({
    userId: input.userId,
    anonKey: input.anonVisitorId || input.sessionId || null,
  })
  const journeySubjectId = subjectResolution.rawJourneySubjectId
  const journeySubjectType = subjectResolution.rawJourneySubjectType
  const journeySubjectIdResolved = subjectResolution.resolvedJourneySubjectId
  const journeySubjectTypeResolved = subjectResolution.resolvedJourneySubjectType
  const journeySubjectResolutionSource = subjectResolution.resolutionSource
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
  let suppressionAppliedCount = 0
  let suppressionBypassedJourneyCount = 0
  let rulesetRejectedCount = 0
  let journeyRejectedCount = 0
  let candidateCountBeforeJourney = 0
  let selectedPriority: number | null = null
  let selectedCampaignKey: string | null = null
  let selectedCampaignCategory: string | null = null
  let selectedRulesetId: number | null = null
  let selectedJourneyId: number | null = null
  let selectedJourneyStepId: number | null = null
  let selectedJourneyStepOrder: number | null = null
  let selectedJourneyStepKey: string | null = null
  let selectedJourneyRulesetId: number | null = null
  let selectedJourneyCampaignCategory: string | null = null
  let selectedJourneyInstanceId: number | null = null
  let selectedJourneyRunState: 'active' | 'completed' | 'abandoned' | 'expired' | null = null
  let selectedJourneyReentryPolicy: JourneyReentryPolicy | null = null
  let selectedJourneyReentryTriggered = false
  let selectedDeliveryContext: 'standalone' | 'journey' | null = null
  let selectedTargetingMode: 'all' | 'selected' | null = null
  const selectedTargetType: 'global_feed' | 'group_feed' | 'channel_feed' = resolveTargetTypeForSurface(input.surface)
  const selectedTargetId: number | null = resolveTargetIdForSurface(input.surface, input.surfaceTarget)
  let selectedTargetMatch: boolean | null = null
  let targetRejectedCount = 0
  let rejectedTargetingMode: 'all' | 'selected' | null = null
  let rejectedRulesetId: number | null = null
  let rulesetResult: 'none' | 'pass' | 'reject' = 'none'
  let rulesetReason: string | null = null
  const candidateDropReasons: CandidateDropReason[] = []

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
      })

      if (!messages.length) {
        reasonCode = 'no_active_message'
      } else {
        const candidates: EligibleMessageCandidate[] = []
        for (const message of messages) {
          const candidateId = Number(message.id || 0)
          if (!Number.isFinite(candidateId) || candidateId <= 0) continue
          if (isMessageSuppressed(candidateId, merged.suppression)) continue
          const surfaceTargeting: Array<{
            surface: MessageDecisionSurface
            targetingMode: 'all' | 'selected'
            targetIds: number[]
          }> = Array.isArray((message as any).surfaceTargeting)
            ? (message as any).surfaceTargeting.map((item: any) => ({
                surface: String(item?.surface || 'global_feed').toLowerCase() as MessageDecisionSurface,
                targetingMode: String(item?.targetingMode || 'all').toLowerCase() === 'selected' ? 'selected' : 'all',
                targetIds: Array.isArray(item?.targetIds)
                  ? item.targetIds
                      .map((id: any) => Number(id))
                      .filter((id: number) => Number.isFinite(id) && id > 0)
                      .map((id: number) => Math.round(id))
                  : [],
              }))
            : [{ surface: String((message as any).appliesToSurface || 'global_feed').toLowerCase() as MessageDecisionSurface, targetingMode: 'all', targetIds: [] }]
          const standaloneTargetingMode = resolveSurfaceTargetingMode(surfaceTargeting, input.surface)
          const standaloneTargetMatch = matchesSurfaceTargeting({
            surface: input.surface,
            groupId: input.surfaceTarget.groupId,
            channelId: input.surfaceTarget.channelId,
            targeting: surfaceTargeting,
          })
          candidates.push({
            messageId: candidateId,
            campaignKey: (message as any).campaignKey == null ? null : String((message as any).campaignKey),
            campaignCategory:
              (message as any).campaignCategory == null || String((message as any).campaignCategory).trim() === ''
                ? null
                : String((message as any).campaignCategory).trim().toLowerCase(),
            messageType: String(message.type || 'register_login'),
            priority: Number(message.priority || 0),
            deliveryScope:
              (String((message as any).deliveryScope || 'both').toLowerCase() === 'journey_only'
                ? 'journey_only'
                : (String((message as any).deliveryScope || 'both').toLowerCase() === 'standalone_only' ? 'standalone_only' : 'both')),
            eligibilityRulesetId:
              (message as any).eligibilityRulesetId == null ? null : Number((message as any).eligibilityRulesetId),
            surfaceTargeting,
            standaloneTargetMatch,
            standaloneTargetingMode,
          })
        }

        let eligible = candidates.filter((candidate) => {
          if (candidate.deliveryScope !== 'standalone_only') return true
          const matched = candidate.standaloneTargetMatch !== false
          if (!matched) {
            targetRejectedCount += 1
            if (rejectedTargetingMode == null) rejectedTargetingMode = candidate.standaloneTargetingMode ?? null
            if (candidateDropReasons.length < 40) {
              candidateDropReasons.push({
                messageId: candidate.messageId,
                reason: 'target_miss',
                targetingMode: candidate.standaloneTargetingMode ?? null,
                targetType: selectedTargetType,
                targetId: selectedTargetId,
                targetMatch: false,
              })
            }
          }
          return matched
        })

        candidateCountBeforeJourney = eligible.length
        if (eligible.length > 0) {
          const gated = await applyJourneyGating({
            userId: input.userId,
            anonVisitorId: input.anonVisitorId || input.sessionId || null,
            resolvedJourneySubjectId: journeySubjectIdResolved,
            surface: input.surface,
            surfaceTarget: input.surfaceTarget,
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

        if (input.userId != null && input.userId > 0 && eligible.length > 0) {
          const filtered: EligibleMessageCandidate[] = []
          for (const c of eligible) {
            const deliveryContext = String((c as any).deliveryContext || '').trim().toLowerCase()
            if (deliveryContext === 'journey') {
              suppressionBypassedJourneyCount += 1
              filtered.push(c)
              continue
            }
            suppressionAppliedCount += 1
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
                .map((c) => resolveCandidateRulesetId(c))
                .filter((id): id is number => Number.isFinite(id as any) && Number(id) > 0)
            )
          )
          const rulesetsById = await messageEligibilityRulesetsSvc.listActiveRulesetsById(rulesetIds)
          const profile = await buildSupportProfile(input.userId, rulesetsById, eligible)
          const rulesetFiltered: EligibleMessageCandidate[] = []
          for (const c of eligible) {
            const rulesetId = resolveCandidateRulesetId(c)
            const ruleset = rulesetId == null ? null : (rulesetsById.get(Number(rulesetId)) || null)
            const evalResult = evaluateRuleset(ruleset, profile)
            if (!evalResult.pass) {
              rulesetRejectedCount += 1
              if (rejectedRulesetId == null && rulesetId != null && Number.isFinite(Number(rulesetId)) && Number(rulesetId) > 0) {
                rejectedRulesetId = Math.round(Number(rulesetId))
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
            selectedCampaignKey =
              selected.campaignKey == null || String(selected.campaignKey).trim() === ''
                ? null
                : String(selected.campaignKey).trim().toLowerCase()
            selectedCampaignCategory =
              selected.campaignCategory == null || String(selected.campaignCategory).trim() === ''
                ? null
                : String(selected.campaignCategory).trim().toLowerCase()
            selectedRulesetId = resolveCandidateRulesetId(selected)
            selectedJourneyId = selected.journeyId == null ? null : Number(selected.journeyId)
            selectedJourneyStepId = selected.journeyStepId == null ? null : Number(selected.journeyStepId)
            selectedJourneyStepOrder = selected.journeyStepOrder == null ? null : Number(selected.journeyStepOrder)
            selectedJourneyStepKey = selected.journeyStepKey == null ? null : String(selected.journeyStepKey)
            selectedJourneyRulesetId = selected.journeyRulesetId == null ? null : Number(selected.journeyRulesetId)
            selectedJourneyCampaignCategory =
              selected.journeyCampaignCategory == null || String(selected.journeyCampaignCategory).trim() === ''
                ? null
                : String(selected.journeyCampaignCategory).trim().toLowerCase()
            selectedJourneyInstanceId =
              selected.journeyInstanceId == null || !Number.isFinite(Number(selected.journeyInstanceId))
                ? null
                : Number(selected.journeyInstanceId)
            selectedJourneyRunState =
              selected.journeyRunState == null
                ? null
                : (String(selected.journeyRunState).trim().toLowerCase() as any)
            selectedJourneyReentryPolicy =
              selected.journeyReentryPolicy == null
                ? null
                : (String(selected.journeyReentryPolicy).trim().toLowerCase() as JourneyReentryPolicy)
            selectedJourneyReentryTriggered = !!selected.journeyReentryTriggered
            selectedDeliveryContext = selected.deliveryContext === 'journey' ? 'journey' : 'standalone'
            selectedTargetingMode = resolveSurfaceTargetingMode(selected.surfaceTargeting || [], input.surface)
            selectedTargetMatch = true
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
        surfaceTarget: input.surfaceTarget,
        viewerState: input.viewerState,
        journeySubjectId,
        journeySubjectType,
        journeySubjectIdResolved,
        journeySubjectTypeResolved,
        journeySubjectResolutionSource,
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
        suppressionAppliedCount,
        suppressionBypassedJourneyCount,
        rulesetRejectedCount,
        journeyRejectedCount,
        rulesetResult,
        rulesetReason,
        selectedRulesetId,
        selectedCampaignCategory,
        selectedJourneyId,
        selectedJourneyStepId,
        selectedJourneyStepOrder,
        selectedJourneyStepKey,
        selectedJourneyRulesetId,
        selectedJourneyCampaignCategory,
        selectedJourneyInstanceId,
        selectedJourneyRunState,
        selectedJourneyReentryPolicy,
        selectedJourneyReentryTriggered,
        selectedDeliveryContext,
        surfaceContext: input.surface,
        targetType: selectedTargetType,
        targetId: selectedTargetId,
        targetingMode: selectedTargetingMode ?? rejectedTargetingMode,
        targetMatch: selectedTargetMatch ?? (targetRejectedCount > 0 ? false : null),
        targetRejectedCount,
        rejectedRulesetId,
        selectedPriority,
        selectedCampaignKey,
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
