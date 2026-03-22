import crypto from 'crypto'
import { MESSAGE_AUTH_INTENT_TTL_MINUTES } from '../../config'
import { DomainError } from '../../core/errors'
import * as repo from './repo'
import type {
  MessageAttributionFlow,
  MessageAttributionIntentState,
  MessageAttributionSurface,
  MessageAttributionViewerState,
  MessageAuthIntentRow,
  MessageSuppressionReason,
  MessageSuppressionScope,
} from './types'

const INTENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SESSION_ID_RE = /^[a-zA-Z0-9:_-]{8,120}$/
const CAMPAIGN_KEY_RE = /^[a-z0-9_-]{1,64}$/i

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

function toUtcDateTimeString(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
}

export function generateIntentId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(16)}-${crypto.randomBytes(16).toString('hex').slice(0, 20)}`
  }
}

function normalizeFlow(raw: any): MessageAttributionFlow {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'login' || v === 'register') return v
  throw new DomainError('invalid_message_auth_flow', 'invalid_message_auth_flow', 400)
}

function normalizeSurface(raw: any): MessageAttributionSurface {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'global_feed') return v
  throw new DomainError('invalid_surface', 'invalid_surface', 400)
}

function normalizeViewerState(raw: any): MessageAttributionViewerState {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'anonymous' || v === 'authenticated') return v
  throw new DomainError('invalid_viewer_state', 'invalid_viewer_state', 400)
}

function normalizeMessageId(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('invalid_message_id', 'invalid_message_id', 400)
  return Math.round(n)
}

function normalizeIntentId(raw: any): string {
  const value = String(raw || '').trim()
  if (!INTENT_ID_RE.test(value)) throw new DomainError('invalid_intent_id', 'invalid_intent_id', 400)
  return value.toLowerCase()
}

function normalizeSessionId(raw: any): string | null {
  if (raw == null || raw === '') return null
  const value = String(raw).trim()
  if (!value) return null
  if (!SESSION_ID_RE.test(value)) throw new DomainError('invalid_message_session_id', 'invalid_message_session_id', 400)
  return value
}

function normalizeCampaignKey(raw: any): string | null {
  if (raw == null || raw === '') return null
  const value = String(raw).trim().toLowerCase()
  if (!value) return null
  if (!CAMPAIGN_KEY_RE.test(value)) throw new DomainError('invalid_message_campaign_key', 'invalid_message_campaign_key', 400)
  return value
}

function normalizeSequenceKey(raw: any): string | null {
  if (raw == null || raw === '') return null
  const value = String(raw).trim()
  if (!value) return null
  if (value.length > 191) throw new DomainError('invalid_message_sequence_key', 'invalid_message_sequence_key', 400)
  return value
}

function normalizeAnonKey(raw: any): string | null {
  if (raw == null || raw === '') return null
  const value = String(raw).trim()
  if (!value) return null
  if (value.length > 191) throw new DomainError('invalid_anon_key', 'invalid_anon_key', 400)
  return value
}

function normalizeUserId(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('invalid_user_id', 'invalid_user_id', 400)
  return Math.round(n)
}

function toSuppressionKey(scope: MessageSuppressionScope, messageId: number | null, campaignKey: string | null): string {
  if (scope === 'campaign') {
    if (!campaignKey) throw new DomainError('missing_campaign_key_for_suppression', 'missing_campaign_key_for_suppression', 400)
    return `c:${campaignKey}`
  }
  if (!messageId || messageId <= 0) throw new DomainError('missing_message_id_for_suppression', 'missing_message_id_for_suppression', 400)
  return `m:${messageId}`
}

function assertIntentRowUsable(intent: MessageAuthIntentRow, nowUtc: Date): void {
  if (intent.state === 'completed') throw new DomainError('intent_already_consumed', 'intent_already_consumed', 409)
  if (intent.state === 'expired') throw new DomainError('intent_expired', 'intent_expired', 410)
  if (intent.consumed_at) throw new DomainError('intent_already_consumed', 'intent_already_consumed', 409)
  if (intent.expires_at) {
    const expires = new Date(String(intent.expires_at).replace(' ', 'T') + 'Z')
    if (Number.isFinite(expires.getTime()) && expires.getTime() <= nowUtc.getTime()) {
      throw new DomainError('intent_expired', 'intent_expired', 410)
    }
  }
}

export async function issueAuthIntent(input: {
  flow: MessageAttributionFlow | string
  surface?: MessageAttributionSurface | string
  messageId: number | string
  messageCampaignKey?: string | null
  messageSessionId?: string | null
  messageSequenceKey?: string | null
  viewerState?: MessageAttributionViewerState | string
  anonKey?: string | null
  userId?: number | string | null
  now?: Date
  intentId?: string
}): Promise<{ intentId: string; expiresAt: string }> {
  const now = input.now instanceof Date && Number.isFinite(input.now.getTime()) ? input.now : new Date()
  const flow = normalizeFlow(input.flow)
  const surface = normalizeSurface(input.surface || 'global_feed')
  const messageId = normalizeMessageId(input.messageId)
  const messageCampaignKey = normalizeCampaignKey(input.messageCampaignKey)
  const messageSessionId = normalizeSessionId(input.messageSessionId)
  const messageSequenceKey = normalizeSequenceKey(input.messageSequenceKey)
  const userId = normalizeUserId(input.userId)
  const viewerState = normalizeViewerState(input.viewerState || (userId ? 'authenticated' : 'anonymous'))
  const anonKey = normalizeAnonKey(input.anonKey)
  const intentId = input.intentId ? normalizeIntentId(input.intentId) : normalizeIntentId(generateIntentId())
  const expiresAtDate = new Date(now.getTime() + MESSAGE_AUTH_INTENT_TTL_MINUTES * 60 * 1000)
  const expiresAt = toUtcDateTimeString(expiresAtDate)

  await repo.createAuthIntent({
    intentId,
    flow,
    surface,
    messageId,
    messageCampaignKey,
    messageSessionId,
    messageSequenceKey,
    viewerState,
    anonKey,
    userId,
    expiresAt,
  })
  return { intentId, expiresAt }
}

export async function markAuthIntentStarted(input: {
  intentId: string
  now?: Date
}): Promise<{ updated: boolean }> {
  const intentId = normalizeIntentId(input.intentId)
  const now = input.now instanceof Date && Number.isFinite(input.now.getTime()) ? input.now : new Date()
  const nowUtc = toUtcDateTimeString(now)
  return repo.updateAuthIntentState({
    intentId,
    nextState: 'started',
    onlyIfStateIn: ['created'],
    onlyIfNotConsumed: true,
    onlyIfNotExpiredAfter: nowUtc,
  })
}

export async function consumeAuthIntentForCompletion(input: {
  intentId: string
  userId: number | string
  now?: Date
}): Promise<{
  consumed: boolean
  intent: MessageAuthIntentRow
}> {
  const intentId = normalizeIntentId(input.intentId)
  const userId = normalizeUserId(input.userId)
  if (!userId) throw new DomainError('invalid_user_id', 'invalid_user_id', 400)
  const now = input.now instanceof Date && Number.isFinite(input.now.getTime()) ? input.now : new Date()
  const nowUtc = toUtcDateTimeString(now)

  const intent = await repo.getAuthIntentById(intentId)
  if (!intent) throw new DomainError('intent_not_found', 'intent_not_found', 404)
  assertIntentRowUsable(intent, now)

  const update = await repo.updateAuthIntentState({
    intentId,
    nextState: 'completed',
    consumedAt: nowUtc,
    userId,
    onlyIfStateIn: ['created', 'started'],
    onlyIfNotConsumed: true,
    onlyIfNotExpiredAfter: nowUtc,
  })

  const fresh = await repo.getAuthIntentById(intentId)
  if (!fresh) throw new DomainError('intent_not_found', 'intent_not_found', 404)
  return { consumed: update.updated, intent: fresh }
}

export async function expireStaleAuthIntents(now?: Date): Promise<{ expired: number }> {
  const date = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date()
  const cutoff = toUtcDateTimeString(date)
  const res = await repo.expireAuthIntents(cutoff)
  return { expired: res.updated }
}

export async function upsertUserSuppressionFromCompletion(input: {
  userId: number | string
  scope: MessageSuppressionScope
  messageId?: number | string | null
  campaignKey?: string | null
  sourceIntentId?: string | null
  reason?: MessageSuppressionReason
}): Promise<void> {
  const userId = normalizeUserId(input.userId)
  if (!userId) throw new DomainError('invalid_user_id', 'invalid_user_id', 400)
  const scope = input.scope
  if (scope !== 'message' && scope !== 'campaign') throw new DomainError('invalid_suppression_scope', 'invalid_suppression_scope', 400)
  const messageId = input.messageId == null || input.messageId === '' ? null : normalizeMessageId(input.messageId)
  const campaignKey = normalizeCampaignKey(input.campaignKey)
  const sourceIntentId = input.sourceIntentId ? normalizeIntentId(input.sourceIntentId) : null
  const reason: MessageSuppressionReason = input.reason === 'flow_complete' ? 'flow_complete' : 'auth_complete'
  const suppressionKey = toSuppressionKey(scope, messageId, campaignKey)
  await repo.upsertUserSuppression({
    userId,
    scope,
    suppressionKey,
    messageId,
    campaignKey,
    reason,
    sourceIntentId,
  })
}

export async function isUserSuppressed(input: {
  userId: number | string
  messageId?: number | string | null
  campaignKey?: string | null
}): Promise<boolean> {
  const userId = normalizeUserId(input.userId)
  if (!userId) return false
  const messageId = input.messageId == null || input.messageId === '' ? null : normalizeMessageId(input.messageId)
  const campaignKey = normalizeCampaignKey(input.campaignKey)
  const rows = await repo.getUserSuppressions({
    userId,
    messageId,
    campaignKey,
  })
  return rows.length > 0
}

export async function getAuthIntentById(input: { intentId: string }): Promise<MessageAuthIntentRow | null> {
  return repo.getAuthIntentById(normalizeIntentId(input.intentId))
}

export function isValidIntentStateTransition(from: MessageAttributionIntentState, to: MessageAttributionIntentState): boolean {
  if (from === to) return true
  if (from === 'created' && (to === 'started' || to === 'completed' || to === 'expired')) return true
  if (from === 'started' && (to === 'completed' || to === 'expired')) return true
  return false
}
