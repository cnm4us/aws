import { getPool } from '../../db'
import type {
  MessageAttributionFlow,
  MessageAttributionIntentState,
  MessageAttributionSurface,
  MessageAttributionViewerState,
  MessageAuthIntentRow,
  MessageSuppressionReason,
  MessageSuppressionScope,
  MessageSuppressionRow,
} from './types'

const MESSAGE_AUTH_INTENT_SELECT = `
  SELECT
    intent_id,
    flow,
    state,
    surface,
    message_id,
    message_campaign_key,
    message_session_id,
    message_sequence_key,
    viewer_state,
    anon_key,
    user_id,
    expires_at,
    consumed_at,
    created_at,
    updated_at
  FROM feed_message_auth_intents
`

export async function createAuthIntent(input: {
  intentId: string
  flow: MessageAttributionFlow
  surface: MessageAttributionSurface
  messageId: number
  messageCampaignKey: string | null
  messageSessionId: string | null
  messageSequenceKey: string | null
  viewerState: MessageAttributionViewerState
  anonKey: string | null
  userId: number | null
  expiresAt: string
}): Promise<void> {
  const db = getPool()
  await db.query(
    `INSERT INTO feed_message_auth_intents
      (
        intent_id, flow, state, surface,
        message_id, message_campaign_key, message_session_id, message_sequence_key,
        viewer_state, anon_key, user_id,
        expires_at
      ) VALUES (?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.intentId,
      input.flow,
      input.surface,
      input.messageId,
      input.messageCampaignKey,
      input.messageSessionId,
      input.messageSequenceKey,
      input.viewerState,
      input.anonKey,
      input.userId,
      input.expiresAt,
    ]
  )
}

export async function getAuthIntentById(intentId: string): Promise<MessageAuthIntentRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `${MESSAGE_AUTH_INTENT_SELECT}
      WHERE intent_id = ?
      LIMIT 1`,
    [intentId]
  )
  return ((rows as any[])[0] as MessageAuthIntentRow) || null
}

export async function updateAuthIntentState(input: {
  intentId: string
  nextState: MessageAttributionIntentState
  onlyIfStateIn?: MessageAttributionIntentState[]
  onlyIfNotConsumed?: boolean
  onlyIfNotExpiredAfter?: string | null
  consumedAt?: string | null
  userId?: number | null
}): Promise<{ updated: boolean }> {
  const db = getPool()
  const sets = ['state = ?']
  const args: any[] = [input.nextState]
  if (input.consumedAt !== undefined) {
    sets.push('consumed_at = ?')
    args.push(input.consumedAt)
  }
  if (input.userId !== undefined) {
    sets.push('user_id = ?')
    args.push(input.userId)
  }

  const where = ['intent_id = ?']
  args.push(input.intentId)
  if (input.onlyIfStateIn && input.onlyIfStateIn.length > 0) {
    where.push(`state IN (${input.onlyIfStateIn.map(() => '?').join(', ')})`)
    args.push(...input.onlyIfStateIn)
  }
  if (input.onlyIfNotConsumed) where.push('consumed_at IS NULL')
  if (input.onlyIfNotExpiredAfter) {
    where.push('(expires_at IS NULL OR expires_at > ?)')
    args.push(input.onlyIfNotExpiredAfter)
  }

  const [result] = await db.query(
    `UPDATE feed_message_auth_intents
        SET ${sets.join(', ')}
      WHERE ${where.join(' AND ')}`,
    args
  )
  return { updated: Number((result as any)?.affectedRows || 0) > 0 }
}

export async function expireAuthIntents(cutoffDateTime: string): Promise<{ updated: number }> {
  const db = getPool()
  const [result] = await db.query(
    `UPDATE feed_message_auth_intents
        SET state = 'expired'
      WHERE state IN ('created','started')
        AND consumed_at IS NULL
        AND expires_at IS NOT NULL
        AND expires_at <= ?`,
    [cutoffDateTime]
  )
  return { updated: Number((result as any)?.affectedRows || 0) }
}

export async function upsertUserSuppression(input: {
  userId: number
  scope: MessageSuppressionScope
  suppressionKey: string
  messageId: number | null
  campaignKey: string | null
  reason: MessageSuppressionReason
  sourceIntentId: string | null
}): Promise<void> {
  const db = getPool()
  await db.query(
    `INSERT INTO feed_message_user_suppressions
      (
        user_id, scope, suppression_key,
        message_id, campaign_key,
        reason, source_intent_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        scope = VALUES(scope),
        message_id = VALUES(message_id),
        campaign_key = VALUES(campaign_key),
        reason = VALUES(reason),
        source_intent_id = VALUES(source_intent_id),
        updated_at = CURRENT_TIMESTAMP`,
    [
      input.userId,
      input.scope,
      input.suppressionKey,
      input.messageId,
      input.campaignKey,
      input.reason,
      input.sourceIntentId,
    ]
  )
}

export async function getUserSuppressions(input: {
  userId: number
  messageId: number | null
  campaignKey: string | null
}): Promise<MessageSuppressionRow[]> {
  const db = getPool()
  const where: string[] = ['user_id = ?']
  const args: any[] = [input.userId]
  if (input.campaignKey && input.messageId != null) {
    where.push('((scope = \'campaign\' AND campaign_key = ?) OR (scope = \'message\' AND message_id = ?))')
    args.push(input.campaignKey, input.messageId)
  } else if (input.campaignKey) {
    where.push('(scope = \'campaign\' AND campaign_key = ?)')
    args.push(input.campaignKey)
  } else if (input.messageId != null) {
    where.push('(scope = \'message\' AND message_id = ?)')
    args.push(input.messageId)
  } else {
    return []
  }
  const [rows] = await db.query(
    `SELECT
        id,
        user_id,
        scope,
        suppression_key,
        message_id,
        campaign_key,
        reason,
        source_intent_id,
        created_at,
        updated_at
      FROM feed_message_user_suppressions
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC
      LIMIT 50`,
    args
  )
  return rows as MessageSuppressionRow[]
}

