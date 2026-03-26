import crypto from 'crypto'
import { context, trace } from '@opentelemetry/api'
import { DomainError } from '../../core/errors'
import { getLogger } from '../../lib/logger'
import * as messageCtasSvc from '../message-cta-definitions/service'
import * as messageJourneysSvc from '../message-journeys/service'
import type { MessageCtaCompletionContract } from '../message-cta-definitions/types'
import * as repo from './repo'
import type {
  MessageCtaOutcomeStatus,
  MessageCtaOutcomeType,
  MessageDeliveryContext,
} from './types'

const logger = getLogger({ component: 'features.message-cta-outcomes' })

function toUtcDateTime(input: Date): string {
  const y = input.getUTCFullYear()
  const m = String(input.getUTCMonth() + 1).padStart(2, '0')
  const d = String(input.getUTCDate()).padStart(2, '0')
  const hh = String(input.getUTCHours()).padStart(2, '0')
  const mm = String(input.getUTCMinutes()).padStart(2, '0')
  const ss = String(input.getUTCSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function normalizeOutcomeType(raw: any): MessageCtaOutcomeType {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'click' || v === 'return' || v === 'verified_complete' || v === 'webhook_complete' || v === 'failed' || v === 'abandoned') return v
  throw new DomainError('invalid_cta_outcome_type', 'invalid_cta_outcome_type', 400)
}

function normalizeOutcomeStatus(raw: any): MessageCtaOutcomeStatus {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'pending' || v === 'success' || v === 'failure') return v
  throw new DomainError('invalid_cta_outcome_status', 'invalid_cta_outcome_status', 400)
}

function normalizeDeliveryContext(raw: any, fallback: MessageDeliveryContext = 'standalone'): MessageDeliveryContext {
  const v = String(raw || '').trim().toLowerCase()
  if (!v) return fallback
  if (v === 'standalone' || v === 'journey') return v
  throw new DomainError('invalid_delivery_context', 'invalid_delivery_context', 400)
}

function normalizeOutcomeId(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (!v) return null
  if (v.length > 64) throw new DomainError('invalid_cta_outcome_id', 'invalid_cta_outcome_id', 400)
  if (!/^[a-z0-9:_-]+$/.test(v)) throw new DomainError('invalid_cta_outcome_id', 'invalid_cta_outcome_id', 400)
  return v
}

function normalizeNullablePositiveInt(raw: any, code: string): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError(code, code, 400)
  return Math.round(n)
}

function normalizeNullableKey(raw: any, code: string): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (!v) return null
  if (!/^[a-z0-9_:-]{1,64}$/.test(v)) throw new DomainError(code, code, 400)
  return v
}

function normalizeNullableCampaignKey(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (!v) return null
  if (!/^[a-z0-9_-]{1,64}$/.test(v)) throw new DomainError('invalid_message_campaign_key', 'invalid_message_campaign_key', 400)
  return v
}

function computeOutcomeId(input: {
  sourceEventType: string
  sourceEventId: number | null
  messageId: number
  sessionId: string | null
  ctaDefinitionId: number | null
  ctaSlot: number | null
  occurredAt: string
}): string {
  const base = `${input.sourceEventType}|${input.sourceEventId ?? '-'}|${input.messageId}|${input.sessionId ?? '-'}|${input.ctaDefinitionId ?? '-'}|${input.ctaSlot ?? '-'}|${input.occurredAt}`
  return `auto:${crypto.createHash('sha256').update(base).digest('hex').slice(0, 24)}`
}

export function isCompletionSatisfied(input: {
  completionContract: MessageCtaCompletionContract
  outcomeType: MessageCtaOutcomeType
  outcomeStatus: MessageCtaOutcomeStatus
}): boolean {
  const { completionContract, outcomeType, outcomeStatus } = input
  if (completionContract === 'none') return false
  if (completionContract === 'on_click') return outcomeType === 'click' && outcomeStatus === 'success'
  if (completionContract === 'on_return') return outcomeType === 'return' && outcomeStatus === 'success'
  if (completionContract === 'on_verified') {
    return (outcomeType === 'verified_complete' || outcomeType === 'webhook_complete') && outcomeStatus === 'success'
  }
  return false
}

export async function recordCtaOutcome(input: {
  outcomeId?: string | null
  sourceEventType: string
  sourceEventId?: number | null
  outcomeType: MessageCtaOutcomeType | string
  outcomeStatus: MessageCtaOutcomeStatus | string
  occurredAt?: Date
  sessionId?: string | null
  userId?: number | null
  messageId: number
  messageCampaignKey?: string | null
  deliveryContext?: MessageDeliveryContext | null
  journeyId?: number | null
  journeyStepId?: number | null
  ctaSlot?: number | null
  ctaDefinitionId?: number | null
  ctaIntentKey?: string | null
  ctaExecutorType?: string | null
  payload?: Record<string, unknown>
}): Promise<{
  id: number
  outcomeId: string
  inserted: boolean
  completionContract: MessageCtaCompletionContract
  completed: boolean
  journeySignal: { stepsMatched: number; progressed: number; ignored: number } | null
}> {
  const messageId = normalizeNullablePositiveInt(input.messageId, 'invalid_message_id')
  if (messageId == null) throw new DomainError('invalid_message_id', 'invalid_message_id', 400)
  const occurred = input.occurredAt instanceof Date && Number.isFinite(input.occurredAt.getTime())
    ? input.occurredAt
    : new Date()
  const occurredAt = toUtcDateTime(occurred)
  const sourceEventType = String(input.sourceEventType || '').trim().toLowerCase() || 'unknown'
  const sourceEventId = normalizeNullablePositiveInt(input.sourceEventId, 'invalid_source_event_id')
  const outcomeType = normalizeOutcomeType(input.outcomeType)
  const outcomeStatus = normalizeOutcomeStatus(input.outcomeStatus)
  const sessionId = input.sessionId == null || input.sessionId === '' ? null : String(input.sessionId).trim()
  const userId = normalizeNullablePositiveInt(input.userId, 'invalid_user_id')
  const messageCampaignKey = normalizeNullableCampaignKey(input.messageCampaignKey)
  const deliveryContext = normalizeDeliveryContext(input.deliveryContext, 'standalone')
  const journeyId = normalizeNullablePositiveInt(input.journeyId, 'invalid_journey_id')
  const journeyStepId = normalizeNullablePositiveInt(input.journeyStepId, 'invalid_journey_step_id')
  const ctaSlot = normalizeNullablePositiveInt(input.ctaSlot, 'invalid_message_cta_slot')
  const ctaDefinitionId = normalizeNullablePositiveInt(input.ctaDefinitionId, 'invalid_message_cta_definition_id')
  const ctaIntentKey = normalizeNullableKey(input.ctaIntentKey, 'invalid_message_cta_intent_key')
  const ctaExecutorType = normalizeNullableKey(input.ctaExecutorType, 'invalid_message_cta_executor_type')
  const payloadJson = JSON.stringify((input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)) ? input.payload : {})

  const outcomeId = normalizeOutcomeId(input.outcomeId) || computeOutcomeId({
    sourceEventType,
    sourceEventId,
    messageId,
    sessionId,
    ctaDefinitionId,
    ctaSlot,
    occurredAt,
  })

  let completionContract: MessageCtaCompletionContract = 'on_click'
  if (ctaDefinitionId != null) {
    const defs = await messageCtasSvc.resolveRuntimeDefinitionsById({
      ids: [ctaDefinitionId],
      includeArchived: true,
    })
    const def = defs.get(ctaDefinitionId)
    if (def?.completionContract) completionContract = def.completionContract
  }

  const completed = isCompletionSatisfied({
    completionContract,
    outcomeType,
    outcomeStatus,
  })

  const saved = await repo.insertOrGet({
    outcomeId,
    sourceEventId,
    sourceEventType,
    outcomeType,
    outcomeStatus,
    occurredAt,
    sessionId,
    userId,
    messageId,
    messageCampaignKey,
    deliveryContext,
    journeyId,
    journeyStepId,
    ctaSlot,
    ctaDefinitionId,
    ctaIntentKey,
    ctaExecutorType,
    payloadJson,
  })

  let journeySignal: { stepsMatched: number; progressed: number; ignored: number } | null = null
  try {
    journeySignal = await messageJourneysSvc.recordJourneySignalFromCtaOutcome({
      outcomeRowId: Number(saved.row.id),
      userId,
      messageId,
      sessionId,
      ctaSlot,
      ctaIntentKey,
      outcomeType,
      outcomeStatus,
      completed,
      occurredAt: occurred,
    })
  } catch {}

  const span = trace.getSpan(context.active())
  if (span) {
    span.setAttribute('app.cta_outcome_id', outcomeId)
    span.setAttribute('app.cta_outcome_type', outcomeType)
    span.setAttribute('app.cta_outcome_status', outcomeStatus)
    span.setAttribute('app.cta_completion_contract', completionContract)
    span.setAttribute('app.cta_completed', completed ? 1 : 0)
  }

  logger.info({
    app_operation: 'message.cta_outcome.record',
    app_outcome: saved.inserted ? 'created' : 'deduped',
    message_id: messageId,
    message_campaign_key: messageCampaignKey,
    cta_outcome_id: outcomeId,
    cta_outcome_type: outcomeType,
    cta_outcome_status: outcomeStatus,
    cta_completion_contract: completionContract,
    cta_completed: completed,
    journey_steps_matched: journeySignal ? Number(journeySignal.stepsMatched || 0) : 0,
    journey_progressed: journeySignal ? Number(journeySignal.progressed || 0) : 0,
    journey_ignored: journeySignal ? Number(journeySignal.ignored || 0) : 0,
    message_cta_definition_id: ctaDefinitionId,
    message_cta_slot: ctaSlot,
    message_cta_intent_key: ctaIntentKey,
    message_cta_executor_type: ctaExecutorType,
    app_delivery_context: deliveryContext,
    app_journey_id: journeyId,
    app_journey_step_id: journeyStepId,
  }, 'message.cta_outcome.record')

  return {
    id: Number(saved.row.id),
    outcomeId,
    inserted: saved.inserted,
    completionContract,
    completed,
    journeySignal,
  }
}
