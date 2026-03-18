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
