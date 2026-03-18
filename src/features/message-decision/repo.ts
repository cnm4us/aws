import { getPool } from '../../db'
import type { PromptAudienceSegment, PromptDecisionSessionRow, PromptDecisionSurface } from './types'

const MESSAGE_DECISION_SESSION_SELECT_SQL = `
  SELECT
    id,
    session_id,
    surface,
    viewer_state,
    slides_viewed,
    watch_seconds,
    messages_shown_this_session AS prompts_shown_this_session,
    slides_since_last_message AS slides_since_last_prompt,
    converted_message_ids_json AS converted_prompt_ids_json,
    last_message_shown_at AS last_prompt_shown_at,
    last_shown_message_id AS last_shown_prompt_id,
    last_decision_reason,
    created_at,
    updated_at
  FROM message_decision_sessions
`

export async function getSessionByKey(sessionId: string, surface: PromptDecisionSurface): Promise<PromptDecisionSessionRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `${MESSAGE_DECISION_SESSION_SELECT_SQL}
      WHERE session_id = ? AND surface = ?
      LIMIT 1`,
    [sessionId, surface]
  )
  return ((rows as any[])[0] as PromptDecisionSessionRow) || null
}

export async function createSession(input: {
  sessionId: string
  surface: PromptDecisionSurface
  audienceSegment: PromptAudienceSegment
  slidesViewed: number
  watchSeconds: number
  promptsShownThisSession: number
  slidesSinceLastPrompt: number
  lastPromptShownAt: string | null
  convertedPromptIdsJson: string | null
  lastPromptId: number | null
  lastDecisionReason: string | null
}): Promise<PromptDecisionSessionRow> {
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
      input.promptsShownThisSession,
      input.slidesSinceLastPrompt,
      input.convertedPromptIdsJson,
      input.lastPromptShownAt,
      input.lastPromptId,
      input.lastDecisionReason,
    ]
  )
  const row = await getSessionByKey(input.sessionId, input.surface)
  if (!row) throw new Error('failed_to_create_prompt_decision_session')
  return row
}

export async function updateSession(id: number, patch: {
  audienceSegment?: PromptAudienceSegment
  slidesViewed?: number
  watchSeconds?: number
  promptsShownThisSession?: number
  slidesSinceLastPrompt?: number
  lastPromptShownAt?: string | null
  convertedPromptIdsJson?: string | null
  lastPromptId?: number | null
  lastDecisionReason?: string | null
}): Promise<void> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []

  if (patch.audienceSegment !== undefined) { sets.push('viewer_state = ?'); args.push(patch.audienceSegment) }
  if (patch.slidesViewed !== undefined) { sets.push('slides_viewed = ?'); args.push(patch.slidesViewed) }
  if (patch.watchSeconds !== undefined) { sets.push('watch_seconds = ?'); args.push(patch.watchSeconds) }
  if (patch.promptsShownThisSession !== undefined) { sets.push('messages_shown_this_session = ?'); args.push(patch.promptsShownThisSession) }
  if (patch.slidesSinceLastPrompt !== undefined) { sets.push('slides_since_last_message = ?'); args.push(patch.slidesSinceLastPrompt) }
  if (patch.convertedPromptIdsJson !== undefined) { sets.push('converted_message_ids_json = ?'); args.push(patch.convertedPromptIdsJson) }
  if (patch.lastPromptShownAt !== undefined) { sets.push('last_message_shown_at = ?'); args.push(patch.lastPromptShownAt) }
  if (patch.lastPromptId !== undefined) { sets.push('last_shown_message_id = ?'); args.push(patch.lastPromptId) }
  if (patch.lastDecisionReason !== undefined) { sets.push('last_decision_reason = ?'); args.push(patch.lastDecisionReason) }

  if (!sets.length) return
  await db.query(`UPDATE message_decision_sessions SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
}
