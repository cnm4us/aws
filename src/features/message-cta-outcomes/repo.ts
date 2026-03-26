import { getPool } from '../../db'
import type { MessageCtaOutcomeRow } from './types'

const SELECT_SQL = `
  SELECT
    id,
    outcome_id,
    source_event_id,
    source_event_type,
    outcome_type,
    outcome_status,
    occurred_at,
    session_id,
    user_id,
    message_id,
    message_campaign_key,
    delivery_context,
    journey_id,
    journey_step_id,
    cta_slot,
    cta_definition_id,
    cta_intent_key,
    cta_executor_type,
    payload_json,
    created_at,
    updated_at
  FROM feed_message_cta_outcomes
`

type InsertInput = {
  outcomeId: string
  sourceEventId: number | null
  sourceEventType: string
  outcomeType: MessageCtaOutcomeRow['outcome_type']
  outcomeStatus: MessageCtaOutcomeRow['outcome_status']
  occurredAt: string
  sessionId: string | null
  userId: number | null
  messageId: number
  messageCampaignKey: string | null
  deliveryContext: MessageCtaOutcomeRow['delivery_context']
  journeyId: number | null
  journeyStepId: number | null
  ctaSlot: number | null
  ctaDefinitionId: number | null
  ctaIntentKey: string | null
  ctaExecutorType: string | null
  payloadJson: string
}

export async function getById(id: number): Promise<MessageCtaOutcomeRow | null> {
  const db = getPool()
  const [rows] = await db.query(`${SELECT_SQL} WHERE id = ? LIMIT 1`, [id])
  return ((rows as any[])[0] as MessageCtaOutcomeRow) || null
}

export async function getByOutcomeId(outcomeId: string): Promise<MessageCtaOutcomeRow | null> {
  const db = getPool()
  const [rows] = await db.query(`${SELECT_SQL} WHERE outcome_id = ? LIMIT 1`, [outcomeId])
  return ((rows as any[])[0] as MessageCtaOutcomeRow) || null
}

export async function insertOrGet(input: InsertInput): Promise<{ row: MessageCtaOutcomeRow; inserted: boolean }> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO feed_message_cta_outcomes (
      outcome_id,
      source_event_id,
      source_event_type,
      outcome_type,
      outcome_status,
      occurred_at,
      session_id,
      user_id,
      message_id,
      message_campaign_key,
      delivery_context,
      journey_id,
      journey_step_id,
      cta_slot,
      cta_definition_id,
      cta_intent_key,
      cta_executor_type,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      id = LAST_INSERT_ID(id),
      updated_at = CURRENT_TIMESTAMP`,
    [
      input.outcomeId,
      input.sourceEventId,
      input.sourceEventType,
      input.outcomeType,
      input.outcomeStatus,
      input.occurredAt,
      input.sessionId,
      input.userId,
      input.messageId,
      input.messageCampaignKey,
      input.deliveryContext,
      input.journeyId,
      input.journeyStepId,
      input.ctaSlot,
      input.ctaDefinitionId,
      input.ctaIntentKey,
      input.ctaExecutorType,
      input.payloadJson,
    ]
  )

  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_upsert_cta_outcome')
  const inserted = Number((result as any)?.affectedRows || 0) === 1
  return { row, inserted }
}

