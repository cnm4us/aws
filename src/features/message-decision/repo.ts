import { getPool } from '../../db'
import type { MessageAudienceSegment, MessageDecisionSessionRow, MessageDecisionSurface } from './types'

const MESSAGE_DECISION_SESSION_SELECT_SQL = `
  SELECT
    id,
    session_id,
    surface,
    viewer_state,
    slides_viewed,
    watch_seconds,
    messages_shown_this_session,
    slides_since_last_message,
    converted_message_ids_json,
    last_message_shown_at,
    last_shown_message_id,
    last_decision_reason,
    created_at,
    updated_at
  FROM message_decision_sessions
`

export async function getSessionByKey(sessionId: string, surface: MessageDecisionSurface): Promise<MessageDecisionSessionRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `${MESSAGE_DECISION_SESSION_SELECT_SQL}
      WHERE session_id = ? AND surface = ?
      LIMIT 1`,
    [sessionId, surface]
  )
  return ((rows as any[])[0] as MessageDecisionSessionRow) || null
}

export async function createSession(input: {
  sessionId: string
  surface: MessageDecisionSurface
  audienceSegment: MessageAudienceSegment
  slidesViewed: number
  watchSeconds: number
  messagesShownThisSession: number
  slidesSinceLastMessage: number
  lastMessageShownAt: string | null
  convertedMessageIdsJson: string | null
  lastMessageId: number | null
  lastDecisionReason: string | null
}): Promise<MessageDecisionSessionRow> {
  const db = getPool()
  await db.query(
    `INSERT INTO message_decision_sessions
      (
        session_id, surface, viewer_state,
        slides_viewed, watch_seconds,
        messages_shown_this_session, slides_since_last_message,
        converted_message_ids_json,
        last_message_shown_at, last_shown_message_id,
        last_decision_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.sessionId,
      input.surface,
      input.audienceSegment,
      input.slidesViewed,
      input.watchSeconds,
      input.messagesShownThisSession,
      input.slidesSinceLastMessage,
      input.convertedMessageIdsJson,
      input.lastMessageShownAt,
      input.lastMessageId,
      input.lastDecisionReason,
    ]
  )
  const row = await getSessionByKey(input.sessionId, input.surface)
  if (!row) throw new Error('failed_to_create_message_decision_session')
  return row
}

export async function updateSession(id: number, patch: {
  audienceSegment?: MessageAudienceSegment
  slidesViewed?: number
  watchSeconds?: number
  messagesShownThisSession?: number
  slidesSinceLastMessage?: number
  lastMessageShownAt?: string | null
  convertedMessageIdsJson?: string | null
  lastMessageId?: number | null
  lastDecisionReason?: string | null
}): Promise<void> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []

  if (patch.audienceSegment !== undefined) { sets.push('viewer_state = ?'); args.push(patch.audienceSegment) }
  if (patch.slidesViewed !== undefined) { sets.push('slides_viewed = ?'); args.push(patch.slidesViewed) }
  if (patch.watchSeconds !== undefined) { sets.push('watch_seconds = ?'); args.push(patch.watchSeconds) }
  if (patch.messagesShownThisSession !== undefined) { sets.push('messages_shown_this_session = ?'); args.push(patch.messagesShownThisSession) }
  if (patch.slidesSinceLastMessage !== undefined) { sets.push('slides_since_last_message = ?'); args.push(patch.slidesSinceLastMessage) }
  if (patch.convertedMessageIdsJson !== undefined) { sets.push('converted_message_ids_json = ?'); args.push(patch.convertedMessageIdsJson) }
  if (patch.lastMessageShownAt !== undefined) { sets.push('last_message_shown_at = ?'); args.push(patch.lastMessageShownAt) }
  if (patch.lastMessageId !== undefined) { sets.push('last_shown_message_id = ?'); args.push(patch.lastMessageId) }
  if (patch.lastDecisionReason !== undefined) { sets.push('last_decision_reason = ?'); args.push(patch.lastDecisionReason) }

  if (!sets.length) return
  await db.query(`UPDATE message_decision_sessions SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
}

export async function getUserActiveSubscriptionTierKeys(userId: number): Promise<string[]> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT DISTINCT pci.item_key
       FROM payment_subscriptions ps
       LEFT JOIN payment_catalog_items pci ON pci.id = ps.catalog_item_id
      WHERE ps.user_id = ?
        AND ps.status = 'active'
        AND pci.item_key IS NOT NULL
        AND pci.item_key <> ''`,
    [userId]
  )
  return (rows as any[])
    .map((row) => String(row.item_key || '').trim().toLowerCase())
    .filter((v) => v.length > 0)
}

export async function listCompletedDonationTransactions(userId: number, sinceUtc: string | null): Promise<Array<{ occurredAt: string; amountCents: number }>> {
  const db = getPool()
  const args: any[] = [userId]
  let sql = `
    SELECT occurred_at AS occurredAt, amount_cents AS amountCents
      FROM payment_transactions
     WHERE user_id = ?
       AND status = 'completed'
       AND intent = 'donate'
       AND amount_cents IS NOT NULL
  `
  if (sinceUtc) {
    sql += ` AND occurred_at >= ?`
    args.push(sinceUtc)
  }
  sql += ` ORDER BY occurred_at DESC, id DESC`
  const [rows] = await db.query(sql, args)
  return (rows as any[]).map((row) => ({
    occurredAt: String(row.occurredAt),
    amountCents: Number(row.amountCents || 0),
  }))
}

export async function getCompletedIntentSet(userId: number): Promise<Set<'donate' | 'subscribe' | 'upgrade'>> {
  const db = getPool()
  const out = new Set<'donate' | 'subscribe' | 'upgrade'>()

  const [txRows] = await db.query(
    `SELECT DISTINCT intent
       FROM payment_transactions
      WHERE user_id = ?
        AND status = 'completed'
        AND intent IN ('donate', 'subscribe')`,
    [userId]
  )
  for (const row of txRows as any[]) {
    const v = String(row.intent || '').trim().toLowerCase()
    if (v === 'donate' || v === 'subscribe') out.add(v)
  }

  const [evtRows] = await db.query(
    `SELECT 1 AS has_upgrade
       FROM feed_message_events
      WHERE user_id = ?
        AND event_type = 'upgrade_complete_from_message'
      LIMIT 1`,
    [userId]
  )
  if ((evtRows as any[]).length > 0) out.add('upgrade')

  return out
}
