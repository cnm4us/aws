import { getPool } from '../../db'
import type {
  MessageJourneyProgressRow,
  MessageJourneyProgressState,
  MessageJourneyRow,
  MessageJourneyStatus,
  MessageJourneyStepRow,
  MessageJourneyStepStatus,
} from './types'

const JOURNEY_SELECT_SQL = `
  SELECT
    id,
    journey_key,
    name,
    applies_to_surface,
    status,
    description,
    eligibility_ruleset_id,
    created_by,
    updated_by,
    created_at,
    updated_at
  FROM feed_message_journeys
`

const STEP_SELECT_SQL = `
  SELECT
    id,
    journey_id,
    step_key,
    step_order,
    message_id,
    status,
    config_json,
    created_at,
    updated_at
  FROM feed_message_journey_steps
`

const PROGRESS_SELECT_SQL = `
  SELECT
    id,
    user_id,
    journey_id,
    step_id,
    state,
    first_seen_at,
    last_seen_at,
    completed_at,
    completed_by_outcome_id,
    session_id,
    metadata_json,
    created_at,
    updated_at
  FROM feed_user_message_journey_progress
`

async function rowExists(tableName: string, id: number): Promise<boolean> {
  const db = getPool()
  const [rows] = await db.query(`SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`, [id])
  return !!(rows as any[])[0]
}

async function getStepJourneyId(stepId: number): Promise<number | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT journey_id FROM feed_message_journey_steps WHERE id = ? LIMIT 1`, [stepId])
  const row = (rows as any[])[0]
  if (!row) return null
  return Number(row.journey_id)
}

type JourneyCreateInput = {
  journeyKey: string
  name: string
  appliesToSurface: 'global_feed' | 'group_feed' | 'channel_feed'
  status: MessageJourneyStatus
  description: string | null
  eligibilityRulesetId: number | null
  createdBy: number
  updatedBy: number
}

type JourneyUpdateInput = Partial<JourneyCreateInput>

type StepCreateInput = {
  journeyId: number
  stepKey: string
  stepOrder: number
  messageId: number
  status: MessageJourneyStepStatus
  configJson: string
}

type StepUpdateInput = Partial<StepCreateInput>

type ProgressUpsertInput = {
  userId: number
  journeyId: number
  stepId: number
  state: MessageJourneyProgressState
  firstSeenAt?: string | null
  lastSeenAt?: string | null
  completedAt?: string | null
  completedByOutcomeId?: number | null
  sessionId?: string | null
  metadataJson?: string
}

type ProgressUpdateInput = Partial<Omit<ProgressUpsertInput, 'userId' | 'journeyId' | 'stepId'>>

export async function listJourneys(params?: {
  status?: MessageJourneyStatus | null
  includeArchived?: boolean
  limit?: number
}): Promise<MessageJourneyRow[]> {
  const db = getPool()
  const where: string[] = ['1=1']
  const args: any[] = []
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)

  if (!params?.includeArchived) where.push(`status <> 'archived'`)
  if (params?.status) {
    where.push('status = ?')
    args.push(params.status)
  }

  const [rows] = await db.query(
    `${JOURNEY_SELECT_SQL}
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC
      LIMIT ?`,
    [...args, limit]
  )
  return rows as MessageJourneyRow[]
}

export async function getJourneyById(id: number): Promise<MessageJourneyRow | null> {
  const db = getPool()
  const [rows] = await db.query(`${JOURNEY_SELECT_SQL} WHERE id = ? LIMIT 1`, [id])
  return ((rows as any[])[0] as MessageJourneyRow) || null
}

export async function getJourneyByKey(journeyKey: string): Promise<MessageJourneyRow | null> {
  const db = getPool()
  const [rows] = await db.query(`${JOURNEY_SELECT_SQL} WHERE journey_key = ? LIMIT 1`, [journeyKey])
  return ((rows as any[])[0] as MessageJourneyRow) || null
}

export async function createJourney(input: JourneyCreateInput): Promise<MessageJourneyRow> {
  if (input.eligibilityRulesetId != null && !(await rowExists('feed_message_eligibility_rulesets', Number(input.eligibilityRulesetId)))) {
    throw new Error('invalid_ruleset_id')
  }
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO feed_message_journeys (
      journey_key,
      name,
      applies_to_surface,
      status,
      description,
      eligibility_ruleset_id,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.journeyKey,
      input.name,
      input.appliesToSurface,
      input.status,
      input.description,
      input.eligibilityRulesetId,
      input.createdBy,
      input.updatedBy,
    ]
  )

  const id = Number((result as any).insertId)
  const row = await getJourneyById(id)
  if (!row) throw new Error('failed_to_create_message_journey')
  return row
}

export async function updateJourney(id: number, patch: JourneyUpdateInput): Promise<MessageJourneyRow> {
  if (patch.eligibilityRulesetId !== undefined && patch.eligibilityRulesetId != null) {
    if (!(await rowExists('feed_message_eligibility_rulesets', Number(patch.eligibilityRulesetId)))) {
      throw new Error('invalid_ruleset_id')
    }
  }
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []

  if (patch.journeyKey !== undefined) { sets.push('journey_key = ?'); args.push(patch.journeyKey) }
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.appliesToSurface !== undefined) { sets.push('applies_to_surface = ?'); args.push(patch.appliesToSurface) }
  if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status) }
  if (patch.description !== undefined) { sets.push('description = ?'); args.push(patch.description) }
  if (patch.eligibilityRulesetId !== undefined) { sets.push('eligibility_ruleset_id = ?'); args.push(patch.eligibilityRulesetId) }
  if (patch.updatedBy !== undefined) { sets.push('updated_by = ?'); args.push(patch.updatedBy) }

  if (sets.length) {
    await db.query(`UPDATE feed_message_journeys SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  }

  const row = await getJourneyById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function removeJourney(id: number): Promise<boolean> {
  const db = getPool()
  const [result] = await db.query(`DELETE FROM feed_message_journeys WHERE id = ?`, [id])
  return Number((result as any)?.affectedRows || 0) > 0
}

export async function listStepsByJourneyId(journeyId: number, params?: {
  status?: MessageJourneyStepStatus | null
  includeArchived?: boolean
}): Promise<MessageJourneyStepRow[]> {
  const db = getPool()
  const where: string[] = ['journey_id = ?']
  const args: any[] = [journeyId]

  if (!params?.includeArchived) where.push(`status <> 'archived'`)
  if (params?.status) {
    where.push('status = ?')
    args.push(params.status)
  }

  const [rows] = await db.query(
    `${STEP_SELECT_SQL}
      WHERE ${where.join(' AND ')}
      ORDER BY step_order ASC, id ASC`,
    args
  )
  return rows as MessageJourneyStepRow[]
}

export async function listActiveStepsByMessageId(messageId: number): Promise<Array<MessageJourneyStepRow & { journey_status: MessageJourneyStatus; journey_ruleset_id: number | null; journey_surface: string }>> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT
       s.id,
       s.journey_id,
       s.step_key,
       s.step_order,
       s.message_id,
       s.status,
       s.config_json,
       s.created_at,
       s.updated_at,
       j.status AS journey_status,
       j.eligibility_ruleset_id AS journey_ruleset_id,
       j.applies_to_surface AS journey_surface
     FROM feed_message_journey_steps s
     JOIN feed_message_journeys j
       ON j.id = s.journey_id
    WHERE s.message_id = ?
      AND s.status = 'active'
      AND j.status = 'active'
    ORDER BY s.step_order ASC, s.id ASC`,
    [messageId]
  )
  return rows as Array<MessageJourneyStepRow & { journey_status: MessageJourneyStatus; journey_ruleset_id: number | null; journey_surface: string }>
}

export async function listActiveStepsByMessageIds(messageIds: number[]): Promise<Array<MessageJourneyStepRow & { journey_status: MessageJourneyStatus; journey_ruleset_id: number | null; journey_surface: string }>> {
  const uniq = Array.from(new Set(messageIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  if (!uniq.length) return []
  const placeholders = uniq.map(() => '?').join(',')
  const db = getPool()
  const [rows] = await db.query(
    `SELECT
       s.id,
       s.journey_id,
       s.step_key,
       s.step_order,
       s.message_id,
       s.status,
       s.config_json,
       s.created_at,
       s.updated_at,
       j.status AS journey_status,
       j.eligibility_ruleset_id AS journey_ruleset_id,
       j.applies_to_surface AS journey_surface
     FROM feed_message_journey_steps s
     JOIN feed_message_journeys j
       ON j.id = s.journey_id
    WHERE s.message_id IN (${placeholders})
      AND s.status = 'active'
      AND j.status = 'active'
    ORDER BY s.journey_id ASC, s.step_order ASC, s.id ASC`,
    uniq
  )
  return rows as Array<MessageJourneyStepRow & { journey_status: MessageJourneyStatus; journey_ruleset_id: number | null; journey_surface: string }>
}

export async function listJourneyStepRefsByMessageId(messageId: number): Promise<Array<{
  journey_id: number
  journey_key: string
  journey_status: MessageJourneyStatus
  step_id: number
  step_key: string
  step_order: number
}>> {
  const mid = Number(messageId)
  if (!Number.isFinite(mid) || mid <= 0) return []
  const db = getPool()
  const [rows] = await db.query(
    `SELECT
       j.id AS journey_id,
       j.journey_key,
       j.status AS journey_status,
       s.id AS step_id,
       s.step_key,
       s.step_order
     FROM feed_message_journey_steps s
     JOIN feed_message_journeys j ON j.id = s.journey_id
    WHERE s.message_id = ?
      AND s.status <> 'archived'
      AND j.status <> 'archived'
    ORDER BY j.id ASC, s.step_order ASC, s.id ASC`,
    [Math.round(mid)]
  )
  return rows as any[]
}

export async function getStepById(id: number): Promise<MessageJourneyStepRow | null> {
  const db = getPool()
  const [rows] = await db.query(`${STEP_SELECT_SQL} WHERE id = ? LIMIT 1`, [id])
  return ((rows as any[])[0] as MessageJourneyStepRow) || null
}

export async function createStep(input: StepCreateInput): Promise<MessageJourneyStepRow> {
  if (!(await rowExists('feed_message_journeys', Number(input.journeyId)))) {
    throw new Error('invalid_journey_id')
  }
  if (!(await rowExists('feed_messages', Number(input.messageId)))) {
    throw new Error('invalid_message_id')
  }

  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO feed_message_journey_steps (
      journey_id,
      step_key,
      step_order,
      message_id,
      status,
      config_json
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.journeyId,
      input.stepKey,
      input.stepOrder,
      input.messageId,
      input.status,
      input.configJson,
    ]
  )

  const id = Number((result as any).insertId)
  const row = await getStepById(id)
  if (!row) throw new Error('failed_to_create_message_journey_step')
  return row
}

export async function updateStep(id: number, patch: StepUpdateInput): Promise<MessageJourneyStepRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []

  if (patch.journeyId !== undefined) { sets.push('journey_id = ?'); args.push(patch.journeyId) }
  if (patch.stepKey !== undefined) { sets.push('step_key = ?'); args.push(patch.stepKey) }
  if (patch.stepOrder !== undefined) { sets.push('step_order = ?'); args.push(patch.stepOrder) }
  if (patch.messageId !== undefined) { sets.push('message_id = ?'); args.push(patch.messageId) }
  if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status) }
  if (patch.configJson !== undefined) { sets.push('config_json = ?'); args.push(patch.configJson) }

  if (sets.length) {
    await db.query(`UPDATE feed_message_journey_steps SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  }

  const row = await getStepById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function removeStep(id: number): Promise<boolean> {
  const db = getPool()
  const [result] = await db.query(`DELETE FROM feed_message_journey_steps WHERE id = ?`, [id])
  return Number((result as any)?.affectedRows || 0) > 0
}

export async function getProgressByUserStep(userId: number, stepId: number): Promise<MessageJourneyProgressRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `${PROGRESS_SELECT_SQL}
      WHERE user_id = ? AND step_id = ?
      LIMIT 1`,
    [userId, stepId]
  )
  return ((rows as any[])[0] as MessageJourneyProgressRow) || null
}

export async function listProgressByUserJourney(userId: number, journeyId: number): Promise<MessageJourneyProgressRow[]> {
  const db = getPool()
  const [rows] = await db.query(
    `${PROGRESS_SELECT_SQL}
      WHERE user_id = ?
        AND journey_id = ?
      ORDER BY updated_at DESC, id DESC`,
    [userId, journeyId]
  )
  return rows as MessageJourneyProgressRow[]
}

export async function listProgressByUserJourneyIds(userId: number, journeyIds: number[]): Promise<MessageJourneyProgressRow[]> {
  const uniq = Array.from(new Set(journeyIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  if (!uniq.length) return []
  const placeholders = uniq.map(() => '?').join(',')
  const db = getPool()
  const [rows] = await db.query(
    `${PROGRESS_SELECT_SQL}
      WHERE user_id = ?
        AND journey_id IN (${placeholders})
      ORDER BY updated_at DESC, id DESC`,
    [userId, ...uniq]
  )
  return rows as MessageJourneyProgressRow[]
}

export async function upsertProgress(input: ProgressUpsertInput): Promise<MessageJourneyProgressRow> {
  if (!(await rowExists('feed_message_journeys', Number(input.journeyId)))) {
    throw new Error('invalid_journey_id')
  }
  const stepJourneyId = await getStepJourneyId(Number(input.stepId))
  if (stepJourneyId == null) throw new Error('invalid_step_id')
  if (stepJourneyId !== Number(input.journeyId)) throw new Error('step_journey_mismatch')

  const db = getPool()
  const metadataJson = input.metadataJson ?? '{}'
  await db.query(
    `INSERT INTO feed_user_message_journey_progress (
      user_id,
      journey_id,
      step_id,
      state,
      first_seen_at,
      last_seen_at,
      completed_at,
      completed_by_outcome_id,
      session_id,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      journey_id = VALUES(journey_id),
      state = VALUES(state),
      first_seen_at = COALESCE(feed_user_message_journey_progress.first_seen_at, VALUES(first_seen_at)),
      last_seen_at = VALUES(last_seen_at),
      completed_at = COALESCE(VALUES(completed_at), feed_user_message_journey_progress.completed_at),
      completed_by_outcome_id = COALESCE(VALUES(completed_by_outcome_id), feed_user_message_journey_progress.completed_by_outcome_id),
      session_id = VALUES(session_id),
      metadata_json = VALUES(metadata_json),
      updated_at = CURRENT_TIMESTAMP`,
    [
      input.userId,
      input.journeyId,
      input.stepId,
      input.state,
      input.firstSeenAt ?? null,
      input.lastSeenAt ?? null,
      input.completedAt ?? null,
      input.completedByOutcomeId ?? null,
      input.sessionId ?? null,
      metadataJson,
    ]
  )

  const row = await getProgressByUserStep(input.userId, input.stepId)
  if (!row) throw new Error('failed_to_upsert_message_journey_progress')
  return row
}

export async function updateProgressById(id: number, patch: ProgressUpdateInput): Promise<MessageJourneyProgressRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []

  if (patch.state !== undefined) { sets.push('state = ?'); args.push(patch.state) }
  if (patch.firstSeenAt !== undefined) { sets.push('first_seen_at = ?'); args.push(patch.firstSeenAt) }
  if (patch.lastSeenAt !== undefined) { sets.push('last_seen_at = ?'); args.push(patch.lastSeenAt) }
  if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); args.push(patch.completedAt) }
  if (patch.completedByOutcomeId !== undefined) { sets.push('completed_by_outcome_id = ?'); args.push(patch.completedByOutcomeId) }
  if (patch.sessionId !== undefined) { sets.push('session_id = ?'); args.push(patch.sessionId) }
  if (patch.metadataJson !== undefined) { sets.push('metadata_json = ?'); args.push(patch.metadataJson) }

  if (sets.length) {
    await db.query(`UPDATE feed_user_message_journey_progress SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  }

  const [rows] = await db.query(`${PROGRESS_SELECT_SQL} WHERE id = ? LIMIT 1`, [id])
  const row = ((rows as any[])[0] as MessageJourneyProgressRow) || null
  if (!row) throw new Error('not_found')
  return row
}
