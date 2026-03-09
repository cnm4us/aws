import { getPool } from '../../db'
import type { PromptRuleRow } from './types'

type PromptRuleCreateInput = {
  name: string
  enabled: boolean
  appliesToSurface: string
  authState: string
  minSlidesViewed: number
  minWatchSeconds: number
  maxPromptsPerSession: number
  minSlidesBetweenPrompts: number
  cooldownSecondsAfterDismiss: number
  promptCategoryAllowlistJson: string
  priority: number
  tieBreakStrategy: string
  createdBy: number
  updatedBy: number
}

type PromptRuleUpdateInput = Partial<PromptRuleCreateInput>

export async function list(params?: {
  limit?: number
  enabled?: boolean | null
  appliesToSurface?: string | null
  authState?: string | null
}): Promise<PromptRuleRow[]> {
  const db = getPool()
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)
  const where: string[] = ['1=1']
  const args: any[] = []

  if (params?.enabled != null) {
    where.push('enabled = ?')
    args.push(params.enabled ? 1 : 0)
  }
  if (params?.appliesToSurface) {
    where.push('applies_to_surface = ?')
    args.push(params.appliesToSurface)
  }
  if (params?.authState) {
    where.push('auth_state = ?')
    args.push(params.authState)
  }

  const [rows] = await db.query(
    `SELECT *
       FROM prompt_rules
      WHERE ${where.join(' AND ')}
      ORDER BY priority ASC, id DESC
      LIMIT ?`,
    [...args, limit]
  )
  return rows as any[]
}

export async function getById(id: number): Promise<PromptRuleRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM prompt_rules WHERE id = ? LIMIT 1`, [id])
  return ((rows as any[])[0] as PromptRuleRow) || null
}

export async function create(input: PromptRuleCreateInput): Promise<PromptRuleRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO prompt_rules
      (
        name, enabled, applies_to_surface, auth_state,
        min_slides_viewed, min_watch_seconds,
        max_prompts_per_session, min_slides_between_prompts,
        cooldown_seconds_after_dismiss, prompt_category_allowlist_json,
        priority, tie_break_strategy, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.enabled ? 1 : 0,
      input.appliesToSurface,
      input.authState,
      input.minSlidesViewed,
      input.minWatchSeconds,
      input.maxPromptsPerSession,
      input.minSlidesBetweenPrompts,
      input.cooldownSecondsAfterDismiss,
      input.promptCategoryAllowlistJson,
      input.priority,
      input.tieBreakStrategy,
      input.createdBy,
      input.updatedBy,
    ]
  )
  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_create_prompt_rule')
  return row
}

export async function update(id: number, patch: PromptRuleUpdateInput): Promise<PromptRuleRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []

  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.enabled !== undefined) { sets.push('enabled = ?'); args.push(patch.enabled ? 1 : 0) }
  if (patch.appliesToSurface !== undefined) { sets.push('applies_to_surface = ?'); args.push(patch.appliesToSurface) }
  if (patch.authState !== undefined) { sets.push('auth_state = ?'); args.push(patch.authState) }
  if (patch.minSlidesViewed !== undefined) { sets.push('min_slides_viewed = ?'); args.push(patch.minSlidesViewed) }
  if (patch.minWatchSeconds !== undefined) { sets.push('min_watch_seconds = ?'); args.push(patch.minWatchSeconds) }
  if (patch.maxPromptsPerSession !== undefined) { sets.push('max_prompts_per_session = ?'); args.push(patch.maxPromptsPerSession) }
  if (patch.minSlidesBetweenPrompts !== undefined) { sets.push('min_slides_between_prompts = ?'); args.push(patch.minSlidesBetweenPrompts) }
  if (patch.cooldownSecondsAfterDismiss !== undefined) { sets.push('cooldown_seconds_after_dismiss = ?'); args.push(patch.cooldownSecondsAfterDismiss) }
  if (patch.promptCategoryAllowlistJson !== undefined) { sets.push('prompt_category_allowlist_json = ?'); args.push(patch.promptCategoryAllowlistJson) }
  if (patch.priority !== undefined) { sets.push('priority = ?'); args.push(patch.priority) }
  if (patch.tieBreakStrategy !== undefined) { sets.push('tie_break_strategy = ?'); args.push(patch.tieBreakStrategy) }
  if (patch.updatedBy !== undefined) { sets.push('updated_by = ?'); args.push(patch.updatedBy) }

  if (!sets.length) {
    const row = await getById(id)
    if (!row) throw new Error('not_found')
    return row
  }

  await db.query(`UPDATE prompt_rules SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  const row = await getById(id)
  if (!row) throw new Error('not_found')
  return row
}
