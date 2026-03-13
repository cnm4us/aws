import { getPool } from '../../db'
import type { PromptDecisionSessionRow, PromptDecisionSurface, PromptViewerState } from './types'

export async function getSessionByKey(sessionId: string, surface: PromptDecisionSurface): Promise<PromptDecisionSessionRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT *
       FROM prompt_decision_sessions
      WHERE session_id = ? AND surface = ?
      LIMIT 1`,
    [sessionId, surface]
  )
  return ((rows as any[])[0] as PromptDecisionSessionRow) || null
}

export async function createSession(input: {
  sessionId: string
  surface: PromptDecisionSurface
  viewerState: PromptViewerState
  slidesViewed: number
  watchSeconds: number
  promptsShownThisSession: number
  slidesSinceLastPrompt: number
  lastPromptShownAt: string | null
  lastPromptId: number | null
  lastDecisionReason: string | null
}): Promise<PromptDecisionSessionRow> {
  const db = getPool()
  await db.query(
    `INSERT INTO prompt_decision_sessions
      (
        session_id, surface, viewer_state,
        slides_viewed, watch_seconds,
        prompts_shown_this_session, slides_since_last_prompt,
        last_prompt_shown_at, last_shown_prompt_id,
        last_decision_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.sessionId,
      input.surface,
      input.viewerState,
      input.slidesViewed,
      input.watchSeconds,
      input.promptsShownThisSession,
      input.slidesSinceLastPrompt,
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
  viewerState?: PromptViewerState
  slidesViewed?: number
  watchSeconds?: number
  promptsShownThisSession?: number
  slidesSinceLastPrompt?: number
  lastPromptShownAt?: string | null
  lastPromptId?: number | null
  lastDecisionReason?: string | null
}): Promise<void> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []

  if (patch.viewerState !== undefined) { sets.push('viewer_state = ?'); args.push(patch.viewerState) }
  if (patch.slidesViewed !== undefined) { sets.push('slides_viewed = ?'); args.push(patch.slidesViewed) }
  if (patch.watchSeconds !== undefined) { sets.push('watch_seconds = ?'); args.push(patch.watchSeconds) }
  if (patch.promptsShownThisSession !== undefined) { sets.push('prompts_shown_this_session = ?'); args.push(patch.promptsShownThisSession) }
  if (patch.slidesSinceLastPrompt !== undefined) { sets.push('slides_since_last_prompt = ?'); args.push(patch.slidesSinceLastPrompt) }
  if (patch.lastPromptShownAt !== undefined) { sets.push('last_prompt_shown_at = ?'); args.push(patch.lastPromptShownAt) }
  if (patch.lastPromptId !== undefined) { sets.push('last_shown_prompt_id = ?'); args.push(patch.lastPromptId) }
  if (patch.lastDecisionReason !== undefined) { sets.push('last_decision_reason = ?'); args.push(patch.lastDecisionReason) }

  if (!sets.length) return
  await db.query(`UPDATE prompt_decision_sessions SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
}
