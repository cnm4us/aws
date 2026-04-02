import { getPool } from '../../db'
import type {
  MessageJourneyAnonProgressRow,
  MessageJourneyCanonicalProgressRow,
  MessageJourneyInstanceIdentityType,
  MessageJourneyInstanceRow,
  MessageJourneyInstanceState,
  MessageJourneyProgressRow,
  MessageJourneyProgressState,
  MessageJourneyRow,
  MessageJourneyStatus,
  MessageJourneyStepRow,
  MessageJourneyStepStatus,
} from './types'

type JourneyTargetingInput = Array<{
  surface: 'global_feed' | 'group_feed' | 'channel_feed'
  targetingMode: 'all' | 'selected'
  targetIds?: number[] | null
}>

type JourneyTargetingRow = {
  surface: 'global_feed' | 'group_feed' | 'channel_feed'
  targetingMode: 'all' | 'selected'
  targetIds: number[]
}

const JOURNEY_SELECT_SQL = `
  SELECT
    id,
    journey_key,
    campaign_category,
    name,
    applies_to_surface,
    status,
    description,
    config_json,
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
    journey_instance_id,
    journey_subject_id,
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

const ANON_PROGRESS_SELECT_SQL = `
  SELECT
    id,
    anon_visitor_id,
    journey_id,
    journey_instance_id,
    journey_subject_id,
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
  FROM feed_anon_message_journey_progress
`

const INSTANCE_SELECT_SQL = `
  SELECT
    id,
    journey_id,
    identity_type,
    identity_key,
    journey_subject_id,
    state,
    current_step_id,
    completed_reason,
    completed_event_key,
    first_seen_at,
    last_seen_at,
    completed_at,
    metadata_json,
    created_at,
    updated_at
  FROM feed_message_journey_instances
`

const SUBJECT_LINK_SELECT_SQL = `
  SELECT
    id,
    source_subject_id,
    canonical_subject_id,
    link_reason,
    metadata_json,
    created_at,
    updated_at
  FROM feed_journey_subject_links
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

function deriveJourneySubjectId(identityType: MessageJourneyInstanceIdentityType, identityKey: string): string {
  return `${identityType}:${identityKey}`
}

function normalizeJourneySubjectId(raw: any): string | null {
  const value = String(raw || '').trim()
  if (!value) return null
  return value
}

type JourneyCreateInput = {
  journeyKey: string
  campaignCategory: string | null
  name: string
  appliesToSurface: 'global_feed' | 'group_feed' | 'channel_feed'
  status: MessageJourneyStatus
  description: string | null
  configJson: string
  eligibilityRulesetId: number | null
  createdBy: number
  updatedBy: number
  surfaceTargeting?: JourneyTargetingInput | null
}

type JourneyUpdateInput = Partial<JourneyCreateInput>

function normalizeJourneyTargeting(input: JourneyTargetingInput | null | undefined, fallbackSurface: string): JourneyTargetingRow[] {
  const src = Array.isArray(input) ? input : []
  const out = new Map<string, JourneyTargetingRow>()
  for (const item of src) {
    const surface = String(item?.surface || '').toLowerCase()
    if (surface !== 'global_feed' && surface !== 'group_feed' && surface !== 'channel_feed') continue
    const targetingMode = String(item?.targetingMode || '').toLowerCase() === 'selected' ? 'selected' : 'all'
    const targetIds = Array.isArray(item?.targetIds)
      ? Array.from(new Set(item!.targetIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
      : []
    out.set(surface, { surface: surface as any, targetingMode, targetIds })
  }
  if (!out.size) {
    const normalizedFallback = String(fallbackSurface || 'global_feed').toLowerCase()
    const fallback = (normalizedFallback === 'group_feed' || normalizedFallback === 'channel_feed') ? normalizedFallback : 'global_feed'
    out.set(fallback, { surface: fallback as any, targetingMode: 'all', targetIds: [] })
  }
  return Array.from(out.values())
}

export async function listSurfaceTargetingByJourneyIds(journeyIds: number[]): Promise<Map<number, JourneyTargetingRow[]>> {
  const uniq = Array.from(new Set(journeyIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  const result = new Map<number, JourneyTargetingRow[]>()
  if (!uniq.length) return result
  const db = getPool()
  const placeholders = uniq.map(() => '?').join(',')
  const [surfaceRows] = await db.query(
    `SELECT journey_id, surface, targeting_mode
       FROM feed_message_journey_surfaces
      WHERE journey_id IN (${placeholders})`,
    uniq
  )
  const [targetRows] = await db.query(
    `SELECT journey_id, surface, target_id
       FROM feed_message_journey_targets
      WHERE journey_id IN (${placeholders})`,
    uniq
  )
  const keyMap = new Map<string, JourneyTargetingRow>()
  for (const row of surfaceRows as any[]) {
    const journeyId = Number(row.journey_id || 0)
    if (!journeyId) continue
    const surface = String(row.surface || '').toLowerCase()
    if (surface !== 'global_feed' && surface !== 'group_feed' && surface !== 'channel_feed') continue
    const targetingMode = String(row.targeting_mode || '').toLowerCase() === 'selected' ? 'selected' : 'all'
    const entry: JourneyTargetingRow = { surface: surface as any, targetingMode, targetIds: [] }
    const key = `${journeyId}:${surface}`
    keyMap.set(key, entry)
    const list = result.get(journeyId) || []
    list.push(entry)
    result.set(journeyId, list)
  }
  for (const row of targetRows as any[]) {
    const journeyId = Number(row.journey_id || 0)
    const targetId = Number(row.target_id || 0)
    if (!journeyId || !targetId) continue
    const surface = String(row.surface || '').toLowerCase()
    if (surface !== 'group_feed' && surface !== 'channel_feed') continue
    const key = `${journeyId}:${surface}`
    const entry = keyMap.get(key)
    if (!entry) continue
    if (!entry.targetIds.includes(targetId)) entry.targetIds.push(targetId)
  }
  for (const [, list] of result) {
    list.sort((a, b) => a.surface.localeCompare(b.surface))
    for (const item of list) item.targetIds.sort((a, b) => a - b)
  }
  return result
}

async function saveSurfaceTargeting(journeyId: number, fallbackSurface: string, input: JourneyTargetingInput | null | undefined): Promise<void> {
  const db = getPool()
  const targeting = normalizeJourneyTargeting(input, fallbackSurface)
  await db.query(`DELETE FROM feed_message_journey_targets WHERE journey_id = ?`, [journeyId])
  await db.query(`DELETE FROM feed_message_journey_surfaces WHERE journey_id = ?`, [journeyId])
  for (const item of targeting) {
    await db.query(
      `INSERT INTO feed_message_journey_surfaces (journey_id, surface, targeting_mode) VALUES (?, ?, ?)`,
      [journeyId, item.surface, item.targetingMode]
    )
    if (item.surface === 'group_feed' || item.surface === 'channel_feed') {
      for (const targetId of item.targetIds) {
        await db.query(
          `INSERT IGNORE INTO feed_message_journey_targets (journey_id, surface, target_id) VALUES (?, ?, ?)`,
          [journeyId, item.surface, targetId]
        )
      }
    }
  }
}

type StepCreateInput = {
  journeyId: number
  stepKey: string
  stepOrder: number
  messageId: number
  status: MessageJourneyStepStatus
  configJson: string
}

type StepUpdateInput = Partial<StepCreateInput>

type JourneySubjectLinkUpsertInput = {
  sourceSubjectId: string
  canonicalSubjectId: string
  linkReason?: string | null
  metadataJson?: string | null
}

type ProgressUpsertInput = {
  userId: number
  journeyId: number
  journeyInstanceId?: number | null
  journeySubjectId?: string | null
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

type AnonProgressUpsertInput = {
  anonVisitorId: string
  journeyId: number
  journeyInstanceId?: number | null
  journeySubjectId?: string | null
  stepId: number
  state: MessageJourneyProgressState
  firstSeenAt?: string | null
  lastSeenAt?: string | null
  completedAt?: string | null
  completedByOutcomeId?: number | null
  sessionId?: string | null
  metadataJson?: string
}

type AnonProgressUpdateInput = Partial<Omit<AnonProgressUpsertInput, 'anonVisitorId' | 'journeyId' | 'stepId'>>

type JourneyInstanceUpsertInput = {
  journeyId: number
  identityType: MessageJourneyInstanceIdentityType
  identityKey: string
  journeySubjectId?: string | null
  state: MessageJourneyInstanceState
  currentStepId?: number | null
  completedReason?: string | null
  completedEventKey?: string | null
  firstSeenAt?: string | null
  lastSeenAt?: string | null
  completedAt?: string | null
  metadataJson?: string
}

type CanonicalProgressUpsertInput = {
  journeySubjectId: string
  journeyId: number
  journeyInstanceId?: number | null
  stepId: number
  state: MessageJourneyProgressState
  firstSeenAt?: string | null
  lastSeenAt?: string | null
  completedAt?: string | null
  completedByOutcomeId?: number | null
  sessionId?: string | null
  metadataJson?: string | null
}

type JourneyInstanceUpdateInput = Partial<Omit<JourneyInstanceUpsertInput, 'journeyId' | 'identityType' | 'identityKey'>>

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
      campaign_category,
        name,
        applies_to_surface,
        status,
        description,
        config_json,
        eligibility_ruleset_id,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.journeyKey,
      input.campaignCategory,
        input.name,
        input.appliesToSurface,
        input.status,
        input.description,
        input.configJson,
        input.eligibilityRulesetId,
      input.createdBy,
      input.updatedBy,
    ]
  )

  const id = Number((result as any).insertId)
  await saveSurfaceTargeting(id, input.appliesToSurface, input.surfaceTargeting)
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
  if (patch.campaignCategory !== undefined) { sets.push('campaign_category = ?'); args.push(patch.campaignCategory) }
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.appliesToSurface !== undefined) { sets.push('applies_to_surface = ?'); args.push(patch.appliesToSurface) }
  if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status) }
  if (patch.description !== undefined) { sets.push('description = ?'); args.push(patch.description) }
  if (patch.configJson !== undefined) { sets.push('config_json = ?'); args.push(patch.configJson) }
  if (patch.eligibilityRulesetId !== undefined) { sets.push('eligibility_ruleset_id = ?'); args.push(patch.eligibilityRulesetId) }
  if (patch.updatedBy !== undefined) { sets.push('updated_by = ?'); args.push(patch.updatedBy) }

  if (sets.length) {
    await db.query(`UPDATE feed_message_journeys SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  }
  if (patch.surfaceTargeting !== undefined || patch.appliesToSurface !== undefined) {
    const [surfaceRows] = await db.query(`SELECT applies_to_surface FROM feed_message_journeys WHERE id = ? LIMIT 1`, [id])
    const fallbackSurface = String(((surfaceRows as any[])[0] as any)?.applies_to_surface || 'global_feed')
    await saveSurfaceTargeting(id, fallbackSurface, patch.surfaceTargeting)
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
       j.applies_to_surface AS journey_surface,
       j.campaign_category AS journey_campaign_category,
       j.config_json AS journey_config_json
     FROM feed_message_journey_steps s
     JOIN feed_message_journeys j
       ON j.id = s.journey_id
    WHERE s.message_id = ?
      AND s.status = 'active'
      AND j.status = 'active'
    ORDER BY s.step_order ASC, s.id ASC`,
    [messageId]
  )
  return rows as Array<MessageJourneyStepRow & { journey_status: MessageJourneyStatus; journey_ruleset_id: number | null; journey_surface: string; journey_campaign_category: string | null; journey_config_json: string }>
}

export async function listActiveStepsByMessageIds(messageIds: number[]): Promise<Array<MessageJourneyStepRow & { journey_status: MessageJourneyStatus; journey_ruleset_id: number | null; journey_surface: string; journey_campaign_category: string | null }>> {
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
       j.applies_to_surface AS journey_surface,
       j.campaign_category AS journey_campaign_category,
       j.config_json AS journey_config_json
     FROM feed_message_journey_steps s
     JOIN feed_message_journeys j
       ON j.id = s.journey_id
    WHERE s.message_id IN (${placeholders})
      AND s.status = 'active'
      AND j.status = 'active'
    ORDER BY s.journey_id ASC, s.step_order ASC, s.id ASC`,
    uniq
  )
  return rows as Array<MessageJourneyStepRow & { journey_status: MessageJourneyStatus; journey_ruleset_id: number | null; journey_surface: string; journey_campaign_category: string | null; journey_config_json: string }>
}

export async function listActiveStepsByJourneyIds(journeyIds: number[]): Promise<Array<MessageJourneyStepRow & { journey_status: MessageJourneyStatus; journey_ruleset_id: number | null; journey_surface: string; journey_campaign_category: string | null; journey_config_json: string }>> {
  const uniq = Array.from(new Set((journeyIds || []).map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n))))
  if (!uniq.length) return []
  const db = getPool()
  const placeholders = uniq.map(() => '?').join(',')
  const [rows] = await db.query(
    `SELECT
       s.id,
       s.journey_id,
       s.step_key,
       s.step_order,
       s.message_id,
       s.status,
       s.ruleset_id,
       s.config_json,
       s.created_at,
       s.updated_at,
       j.status AS journey_status,
       j.eligibility_ruleset_id AS journey_ruleset_id,
       j.applies_to_surface AS journey_surface,
       j.campaign_category AS journey_campaign_category,
       j.config_json AS journey_config_json
     FROM feed_message_journey_steps s
     JOIN feed_message_journeys j ON j.id = s.journey_id
     WHERE s.journey_id IN (${placeholders})
       AND s.status = 'active'
       AND j.status = 'active'
     ORDER BY s.journey_id ASC, s.step_order ASC, s.id ASC`,
    uniq
  )
  return rows as Array<MessageJourneyStepRow & { journey_status: MessageJourneyStatus; journey_ruleset_id: number | null; journey_surface: string; journey_campaign_category: string | null; journey_config_json: string }>
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

export async function shiftStepOrdersAtOrAfter(journeyId: number, startOrder: number, delta: number): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE feed_message_journey_steps
        SET step_order = step_order + ?
      WHERE journey_id = ?
        AND step_order >= ?`,
    [delta, journeyId, startOrder]
  )
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
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [userId, stepId]
  )
  return ((rows as any[])[0] as MessageJourneyProgressRow) || null
}

export async function getProgressByUserInstanceStep(userId: number, journeyInstanceId: number, stepId: number): Promise<MessageJourneyProgressRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `${PROGRESS_SELECT_SQL}
      WHERE user_id = ?
        AND journey_instance_id = ?
        AND step_id = ?
      LIMIT 1`,
    [userId, journeyInstanceId, stepId]
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

export async function listProgressByUserInstanceIds(userId: number, journeyInstanceIds: number[]): Promise<MessageJourneyProgressRow[]> {
  const uid = Number(userId || 0)
  if (!Number.isFinite(uid) || uid <= 0) return []
  const uniq = Array.from(new Set(journeyInstanceIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  if (!uniq.length) return []
  const placeholders = uniq.map(() => '?').join(',')
  const db = getPool()
  const [rows] = await db.query(
    `${PROGRESS_SELECT_SQL}
      WHERE user_id = ?
        AND journey_instance_id IN (${placeholders})
      ORDER BY updated_at DESC, id DESC`,
    [uid, ...uniq]
  )
  return rows as MessageJourneyProgressRow[]
}

export async function listProgressByUser(userId: number): Promise<MessageJourneyProgressRow[]> {
  const uid = Number(userId || 0)
  if (!Number.isFinite(uid) || uid <= 0) return []
  const db = getPool()
  const [rows] = await db.query(
    `${PROGRESS_SELECT_SQL}
      WHERE user_id = ?
      ORDER BY updated_at DESC, id DESC`,
    [Math.round(uid)]
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
  const journeyInstanceId = input.journeyInstanceId == null ? null : Number(input.journeyInstanceId)
  if (journeyInstanceId != null && (!Number.isFinite(journeyInstanceId) || journeyInstanceId <= 0)) {
    throw new Error('invalid_journey_instance_id')
  }

  const db = getPool()
  const metadataJson = input.metadataJson ?? '{}'
  const journeySubjectId = normalizeJourneySubjectId(input.journeySubjectId) || `user:${Math.round(Number(input.userId))}`
  await db.query(
    `INSERT INTO feed_user_message_journey_progress (
      user_id,
      journey_id,
      journey_instance_id,
      journey_subject_id,
      step_id,
      state,
      first_seen_at,
      last_seen_at,
      completed_at,
      completed_by_outcome_id,
      session_id,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      journey_id = VALUES(journey_id),
      journey_instance_id = COALESCE(VALUES(journey_instance_id), feed_user_message_journey_progress.journey_instance_id),
      journey_subject_id = COALESCE(feed_user_message_journey_progress.journey_subject_id, VALUES(journey_subject_id)),
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
      journeyInstanceId,
      journeySubjectId,
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

  const row = journeyInstanceId == null
    ? await getProgressByUserStep(input.userId, input.stepId)
    : await getProgressByUserInstanceStep(input.userId, journeyInstanceId, input.stepId)
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

export async function getAnonProgressByVisitorStep(anonVisitorId: string, stepId: number): Promise<MessageJourneyAnonProgressRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `${ANON_PROGRESS_SELECT_SQL}
      WHERE anon_visitor_id = ? AND step_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [anonVisitorId, stepId]
  )
  return ((rows as any[])[0] as MessageJourneyAnonProgressRow) || null
}

export async function getAnonProgressByVisitorInstanceStep(anonVisitorId: string, journeyInstanceId: number, stepId: number): Promise<MessageJourneyAnonProgressRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `${ANON_PROGRESS_SELECT_SQL}
      WHERE anon_visitor_id = ?
        AND journey_instance_id = ?
        AND step_id = ?
      LIMIT 1`,
    [anonVisitorId, journeyInstanceId, stepId]
  )
  return ((rows as any[])[0] as MessageJourneyAnonProgressRow) || null
}

export async function listAnonProgressByVisitorJourney(anonVisitorId: string, journeyId: number): Promise<MessageJourneyAnonProgressRow[]> {
  const db = getPool()
  const [rows] = await db.query(
    `${ANON_PROGRESS_SELECT_SQL}
      WHERE anon_visitor_id = ?
        AND journey_id = ?
      ORDER BY updated_at DESC, id DESC`,
    [anonVisitorId, journeyId]
  )
  return rows as MessageJourneyAnonProgressRow[]
}

export async function listAnonProgressByVisitorJourneyIds(anonVisitorId: string, journeyIds: number[]): Promise<MessageJourneyAnonProgressRow[]> {
  const uniq = Array.from(new Set(journeyIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  if (!uniq.length) return []
  const placeholders = uniq.map(() => '?').join(',')
  const db = getPool()
  const [rows] = await db.query(
    `${ANON_PROGRESS_SELECT_SQL}
      WHERE anon_visitor_id = ?
        AND journey_id IN (${placeholders})
      ORDER BY updated_at DESC, id DESC`,
    [anonVisitorId, ...uniq]
  )
  return rows as MessageJourneyAnonProgressRow[]
}

export async function listAnonProgressByVisitorInstanceIds(anonVisitorId: string, journeyInstanceIds: number[]): Promise<MessageJourneyAnonProgressRow[]> {
  const anon = String(anonVisitorId || '').trim()
  if (!anon) return []
  const uniq = Array.from(new Set(journeyInstanceIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  if (!uniq.length) return []
  const placeholders = uniq.map(() => '?').join(',')
  const db = getPool()
  const [rows] = await db.query(
    `${ANON_PROGRESS_SELECT_SQL}
      WHERE anon_visitor_id = ?
        AND journey_instance_id IN (${placeholders})
      ORDER BY updated_at DESC, id DESC`,
    [anon, ...uniq]
  )
  return rows as MessageJourneyAnonProgressRow[]
}

export async function listAnonProgressByVisitor(anonVisitorId: string): Promise<MessageJourneyAnonProgressRow[]> {
  const anon = String(anonVisitorId || '').trim()
  if (!anon) return []
  const db = getPool()
  const [rows] = await db.query(
    `${ANON_PROGRESS_SELECT_SQL}
      WHERE anon_visitor_id = ?
      ORDER BY updated_at DESC, id DESC`,
    [anon]
  )
  return rows as MessageJourneyAnonProgressRow[]
}

export async function upsertAnonProgress(input: AnonProgressUpsertInput): Promise<MessageJourneyAnonProgressRow> {
  if (!(await rowExists('feed_message_journeys', Number(input.journeyId)))) {
    throw new Error('invalid_journey_id')
  }
  const stepJourneyId = await getStepJourneyId(Number(input.stepId))
  if (stepJourneyId == null) throw new Error('invalid_step_id')
  if (stepJourneyId !== Number(input.journeyId)) throw new Error('step_journey_mismatch')

  const anonVisitorId = String(input.anonVisitorId || '').trim()
  if (!anonVisitorId) throw new Error('invalid_anon_visitor_id')
  const journeyInstanceId = input.journeyInstanceId == null ? null : Number(input.journeyInstanceId)
  if (journeyInstanceId != null && (!Number.isFinite(journeyInstanceId) || journeyInstanceId <= 0)) {
    throw new Error('invalid_journey_instance_id')
  }

  const db = getPool()
  const metadataJson = input.metadataJson ?? '{}'
  const journeySubjectId = normalizeJourneySubjectId(input.journeySubjectId) || `anon:${anonVisitorId}`
  await db.query(
    `INSERT INTO feed_anon_message_journey_progress (
      anon_visitor_id,
      journey_id,
      journey_instance_id,
      journey_subject_id,
      step_id,
      state,
      first_seen_at,
      last_seen_at,
      completed_at,
      completed_by_outcome_id,
      session_id,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      journey_id = VALUES(journey_id),
      journey_instance_id = COALESCE(VALUES(journey_instance_id), feed_anon_message_journey_progress.journey_instance_id),
      journey_subject_id = COALESCE(feed_anon_message_journey_progress.journey_subject_id, VALUES(journey_subject_id)),
      state = VALUES(state),
      first_seen_at = COALESCE(feed_anon_message_journey_progress.first_seen_at, VALUES(first_seen_at)),
      last_seen_at = VALUES(last_seen_at),
      completed_at = COALESCE(VALUES(completed_at), feed_anon_message_journey_progress.completed_at),
      completed_by_outcome_id = COALESCE(VALUES(completed_by_outcome_id), feed_anon_message_journey_progress.completed_by_outcome_id),
      session_id = VALUES(session_id),
      metadata_json = VALUES(metadata_json),
      updated_at = CURRENT_TIMESTAMP`,
    [
      anonVisitorId,
      input.journeyId,
      journeyInstanceId,
      journeySubjectId,
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

  const row = journeyInstanceId == null
    ? await getAnonProgressByVisitorStep(anonVisitorId, input.stepId)
    : await getAnonProgressByVisitorInstanceStep(anonVisitorId, journeyInstanceId, input.stepId)
  if (!row) throw new Error('failed_to_upsert_anon_message_journey_progress')
  return row
}

export async function upsertCanonicalProgress(input: CanonicalProgressUpsertInput): Promise<MessageJourneyCanonicalProgressRow> {
  const journeySubjectId = normalizeJourneySubjectId(input.journeySubjectId)
  if (!journeySubjectId) throw new Error('invalid_journey_subject_id')
  if (input.journeyInstanceId == null || !Number.isFinite(Number(input.journeyInstanceId)) || Number(input.journeyInstanceId) <= 0) {
    throw new Error('invalid_journey_instance_id')
  }
  if (!(await rowExists('feed_message_journey_instances', Number(input.journeyInstanceId)))) {
    throw new Error('invalid_journey_instance_id')
  }
  if (!(await rowExists('feed_message_journey_steps', Number(input.stepId)))) {
    throw new Error('invalid_step_id')
  }
  const stepJourneyId = await getStepJourneyId(Number(input.stepId))
  if (stepJourneyId == null || Number(stepJourneyId) !== Number(input.journeyId)) {
    throw new Error('step_journey_mismatch')
  }

  const db = getPool()
  const metadataJson = input.metadataJson ?? '{}'
  const journeyInstanceId = Math.round(Number(input.journeyInstanceId))
  const journeyId = Math.round(Number(input.journeyId))
  const stepId = Math.round(Number(input.stepId))

  await db.query(
    `INSERT INTO feed_message_journey_progress (
      journey_subject_id,
      journey_id,
      journey_instance_id,
      step_id,
      state,
      first_seen_at,
      last_seen_at,
      completed_at,
      completed_by_outcome_id,
      session_id,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      journey_subject_id = VALUES(journey_subject_id),
      journey_id = VALUES(journey_id),
      state = VALUES(state),
      first_seen_at = COALESCE(feed_message_journey_progress.first_seen_at, VALUES(first_seen_at)),
      last_seen_at = VALUES(last_seen_at),
      completed_at = COALESCE(feed_message_journey_progress.completed_at, VALUES(completed_at)),
      completed_by_outcome_id = COALESCE(feed_message_journey_progress.completed_by_outcome_id, VALUES(completed_by_outcome_id)),
      session_id = COALESCE(VALUES(session_id), feed_message_journey_progress.session_id),
      metadata_json = VALUES(metadata_json),
      updated_at = CURRENT_TIMESTAMP`,
    [
      journeySubjectId,
      journeyId,
      journeyInstanceId,
      stepId,
      input.state,
      input.firstSeenAt ?? null,
      input.lastSeenAt ?? null,
      input.completedAt ?? null,
      input.completedByOutcomeId == null ? null : Math.round(Number(input.completedByOutcomeId)),
      input.sessionId ?? null,
      metadataJson,
    ]
  )

  const [rows] = await db.query(
    `SELECT
      id,
      journey_subject_id,
      journey_id,
      journey_instance_id,
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
     FROM feed_message_journey_progress
     WHERE journey_instance_id = ? AND step_id = ?
     LIMIT 1`,
    [journeyInstanceId, stepId]
  )
  const row = ((rows as any[])[0] as MessageJourneyCanonicalProgressRow) || null
  if (!row) throw new Error('failed_to_upsert_canonical_message_journey_progress')
  return row
}

export async function updateAnonProgressById(id: number, patch: AnonProgressUpdateInput): Promise<MessageJourneyAnonProgressRow> {
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
    await db.query(`UPDATE feed_anon_message_journey_progress SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  }

  const [rows] = await db.query(`${ANON_PROGRESS_SELECT_SQL} WHERE id = ? LIMIT 1`, [id])
  const row = ((rows as any[])[0] as MessageJourneyAnonProgressRow) || null
  if (!row) throw new Error('not_found')
  return row
}

export async function getJourneyInstanceByIdentity(input: {
  journeyId: number
  identityType: MessageJourneyInstanceIdentityType
  identityKey: string
}): Promise<MessageJourneyInstanceRow | null> {
  const journeyId = Number(input.journeyId || 0)
  if (!Number.isFinite(journeyId) || journeyId <= 0) return null
  const identityType = String(input.identityType || '').trim().toLowerCase()
  if (identityType !== 'user' && identityType !== 'anon') return null
  const identityKey = String(input.identityKey || '').trim()
  if (!identityKey) return null
  const db = getPool()
  const [rows] = await db.query(
    `${INSTANCE_SELECT_SQL}
      WHERE journey_id = ?
        AND identity_type = ?
        AND identity_key = ?
      ORDER BY id DESC
      LIMIT 1`,
    [Math.round(journeyId), identityType, identityKey]
  )
  return ((rows as any[])[0] as MessageJourneyInstanceRow) || null
}

export async function getActiveJourneyInstanceByIdentity(input: {
  journeyId: number
  identityType: MessageJourneyInstanceIdentityType
  identityKey: string
}): Promise<MessageJourneyInstanceRow | null> {
  const journeyId = Number(input.journeyId || 0)
  if (!Number.isFinite(journeyId) || journeyId <= 0) return null
  const identityType = String(input.identityType || '').trim().toLowerCase()
  if (identityType !== 'user' && identityType !== 'anon') return null
  const identityKey = String(input.identityKey || '').trim()
  if (!identityKey) return null
  const db = getPool()
  const [rows] = await db.query(
    `${INSTANCE_SELECT_SQL}
      WHERE journey_id = ?
        AND identity_type = ?
        AND identity_key = ?
        AND state = 'active'
      ORDER BY id DESC
      LIMIT 1`,
    [Math.round(journeyId), identityType, identityKey]
  )
  return ((rows as any[])[0] as MessageJourneyInstanceRow) || null
}

export async function listJourneyInstancesByIdentity(input: {
  identityType: MessageJourneyInstanceIdentityType
  identityKey: string
  state?: MessageJourneyInstanceState | null
}): Promise<MessageJourneyInstanceRow[]> {
  const identityType = String(input.identityType || '').trim().toLowerCase()
  if (identityType !== 'user' && identityType !== 'anon') return []
  const identityKey = String(input.identityKey || '').trim()
  if (!identityKey) return []
  const state = input.state ? String(input.state).trim().toLowerCase() : null
  const db = getPool()
  const where = ['identity_type = ?', 'identity_key = ?']
  const args: any[] = [identityType, identityKey]
  if (state === 'active' || state === 'completed' || state === 'abandoned' || state === 'expired') {
    where.push('state = ?')
    args.push(state)
  }
  const [rows] = await db.query(
    `${INSTANCE_SELECT_SQL}
      WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC, id DESC`,
    args
  )
  return rows as MessageJourneyInstanceRow[]
}

export async function listJourneyInstancesByUserJourneyIds(userId: number, journeyIds: number[]): Promise<MessageJourneyInstanceRow[]> {
  const uid = Number(userId || 0)
  if (!Number.isFinite(uid) || uid <= 0) return []
  const uniq = Array.from(new Set(journeyIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  if (!uniq.length) return []
  const db = getPool()
  const placeholders = uniq.map(() => '?').join(',')
  const [rows] = await db.query(
    `${INSTANCE_SELECT_SQL}
      WHERE identity_type = 'user'
        AND identity_key = ?
        AND journey_id IN (${placeholders})
      ORDER BY updated_at DESC, id DESC`,
    [String(Math.round(uid)), ...uniq]
  )
  return rows as MessageJourneyInstanceRow[]
}

export async function listJourneyInstancesBySubjectJourneyIds(journeySubjectId: string, journeyIds: number[]): Promise<MessageJourneyInstanceRow[]> {
  const subject = String(journeySubjectId || '').trim()
  if (!subject) return []
  const uniq = Array.from(new Set(journeyIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  if (!uniq.length) return []
  const db = getPool()
  const placeholders = uniq.map(() => '?').join(',')
  const [rows] = await db.query(
    `${INSTANCE_SELECT_SQL}
      WHERE journey_subject_id = ?
        AND journey_id IN (${placeholders})
      ORDER BY updated_at DESC, id DESC`,
    [subject, ...uniq]
  )
  return rows as MessageJourneyInstanceRow[]
}

export async function getJourneySubjectLinkBySourceSubjectId(sourceSubjectId: string): Promise<{
  id: number
  source_subject_id: string
  canonical_subject_id: string
  link_reason: string
  metadata_json: string
  created_at: string
  updated_at: string
} | null> {
  const source = String(sourceSubjectId || '').trim()
  if (!source) return null
  const db = getPool()
  const [rows] = await db.query(
    `${SUBJECT_LINK_SELECT_SQL}
      WHERE source_subject_id = ?
      LIMIT 1`,
    [source]
  )
  return ((rows as any[])[0] || null) as any
}

export async function upsertJourneySubjectLink(input: JourneySubjectLinkUpsertInput): Promise<void> {
  const source = String(input.sourceSubjectId || '').trim()
  const canonical = String(input.canonicalSubjectId || '').trim()
  if (!source || !canonical) throw new Error('invalid_subject_link')
  const linkReason = String(input.linkReason || 'auth_merge').trim() || 'auth_merge'
  const metadataJson = input.metadataJson == null ? '{}' : String(input.metadataJson || '{}')
  const db = getPool()
  await db.query(
    `INSERT INTO feed_journey_subject_links (
      source_subject_id,
      canonical_subject_id,
      link_reason,
      metadata_json
    ) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      canonical_subject_id = VALUES(canonical_subject_id),
      link_reason = VALUES(link_reason),
      metadata_json = VALUES(metadata_json),
      updated_at = CURRENT_TIMESTAMP`,
    [source, canonical, linkReason, metadataJson]
  )
}

export async function listJourneyInstancesByAnonJourneyIds(anonVisitorId: string, journeyIds: number[]): Promise<MessageJourneyInstanceRow[]> {
  const anon = String(anonVisitorId || '').trim()
  if (!anon) return []
  const uniq = Array.from(new Set(journeyIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  if (!uniq.length) return []
  const db = getPool()
  const placeholders = uniq.map(() => '?').join(',')
  const [rows] = await db.query(
    `${INSTANCE_SELECT_SQL}
      WHERE identity_type = 'anon'
        AND identity_key = ?
        AND journey_id IN (${placeholders})
      ORDER BY updated_at DESC, id DESC`,
    [anon, ...uniq]
  )
  return rows as MessageJourneyInstanceRow[]
}

export async function upsertJourneyInstance(input: JourneyInstanceUpsertInput): Promise<MessageJourneyInstanceRow> {
  if (!(await rowExists('feed_message_journeys', Number(input.journeyId)))) {
    throw new Error('invalid_journey_id')
  }
  const identityType = String(input.identityType || '').trim().toLowerCase()
  if (identityType !== 'user' && identityType !== 'anon') throw new Error('invalid_identity_type')
  const identityKey = String(input.identityKey || '').trim()
  if (!identityKey) throw new Error('invalid_identity_key')
  const state = String(input.state || '').trim().toLowerCase()
  if (state !== 'active' && state !== 'completed' && state !== 'abandoned' && state !== 'expired') {
    throw new Error('invalid_state')
  }
  const currentStepId = input.currentStepId == null ? null : Number(input.currentStepId)
  if (currentStepId != null && (!Number.isFinite(currentStepId) || currentStepId <= 0)) {
    throw new Error('invalid_current_step_id')
  }
  if (currentStepId != null) {
    const stepJourneyId = await getStepJourneyId(Math.round(currentStepId))
    if (stepJourneyId == null) throw new Error('invalid_current_step_id')
    if (stepJourneyId !== Number(input.journeyId)) throw new Error('step_journey_mismatch')
  }
  const db = getPool()
  const metadataJson = input.metadataJson ?? '{}'
  const journeyId = Math.round(Number(input.journeyId))
  const journeySubjectId = normalizeJourneySubjectId(input.journeySubjectId) || deriveJourneySubjectId(identityType as MessageJourneyInstanceIdentityType, identityKey)
  const existing = await getActiveJourneyInstanceByIdentity({
    journeyId,
    identityType: identityType as MessageJourneyInstanceIdentityType,
    identityKey,
  }) || await getJourneyInstanceByIdentity({
    journeyId,
    identityType: identityType as MessageJourneyInstanceIdentityType,
    identityKey,
  })

  if (!existing) {
    const [result]: any = await db.query(
      `INSERT INTO feed_message_journey_instances (
        journey_id,
        identity_type,
        identity_key,
        journey_subject_id,
        state,
        current_step_id,
        completed_reason,
        completed_event_key,
        first_seen_at,
        last_seen_at,
        completed_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        journeyId,
        identityType,
        identityKey,
        journeySubjectId,
        state,
        currentStepId == null ? null : Math.round(currentStepId),
        input.completedReason ?? null,
        input.completedEventKey ?? null,
        input.firstSeenAt ?? null,
        input.lastSeenAt ?? null,
        input.completedAt ?? null,
        metadataJson,
      ]
    )
    const insertedId = Number(result?.insertId || 0)
    if (!Number.isFinite(insertedId) || insertedId <= 0) throw new Error('failed_to_create_message_journey_instance')
    const [insertedRows] = await db.query(`${INSTANCE_SELECT_SQL} WHERE id = ? LIMIT 1`, [insertedId])
    const inserted = ((insertedRows as any[])[0] as MessageJourneyInstanceRow) || null
    if (!inserted) throw new Error('failed_to_create_message_journey_instance')
    return inserted
  }

  return await updateJourneyInstanceById(Number(existing.id), {
    state,
    journeySubjectId,
    currentStepId: currentStepId == null ? null : Math.round(currentStepId),
    completedReason: input.completedReason ?? existing.completed_reason ?? null,
    completedEventKey: input.completedEventKey ?? existing.completed_event_key ?? null,
    firstSeenAt: existing.first_seen_at || input.firstSeenAt || null,
    lastSeenAt: input.lastSeenAt ?? existing.last_seen_at ?? null,
    completedAt: input.completedAt ?? existing.completed_at ?? null,
    metadataJson,
  })
}

export async function createJourneyInstance(input: JourneyInstanceUpsertInput): Promise<MessageJourneyInstanceRow> {
  if (!(await rowExists('feed_message_journeys', Number(input.journeyId)))) throw new Error('invalid_journey_id')
  const identityType = String(input.identityType || '').trim().toLowerCase()
  if (identityType !== 'user' && identityType !== 'anon') throw new Error('invalid_identity_type')
  const identityKey = String(input.identityKey || '').trim()
  if (!identityKey) throw new Error('invalid_identity_key')
  const state = String(input.state || '').trim().toLowerCase()
  if (state !== 'active' && state !== 'completed' && state !== 'abandoned' && state !== 'expired') throw new Error('invalid_state')
  const currentStepId = input.currentStepId == null ? null : Number(input.currentStepId)
  if (currentStepId != null && (!Number.isFinite(currentStepId) || currentStepId <= 0)) throw new Error('invalid_current_step_id')
  if (currentStepId != null) {
    const stepJourneyId = await getStepJourneyId(Math.round(currentStepId))
    if (stepJourneyId == null) throw new Error('invalid_current_step_id')
    if (stepJourneyId !== Number(input.journeyId)) throw new Error('step_journey_mismatch')
  }
  const journeySubjectId = normalizeJourneySubjectId(input.journeySubjectId) || deriveJourneySubjectId(identityType as MessageJourneyInstanceIdentityType, identityKey)
  const db = getPool()
  const [result]: any = await db.query(
    `INSERT INTO feed_message_journey_instances (
      journey_id,
      identity_type,
      identity_key,
      journey_subject_id,
      state,
      current_step_id,
      completed_reason,
      completed_event_key,
      first_seen_at,
      last_seen_at,
      completed_at,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Math.round(Number(input.journeyId)),
      identityType,
      identityKey,
      journeySubjectId,
      state,
      currentStepId == null ? null : Math.round(currentStepId),
      input.completedReason ?? null,
      input.completedEventKey ?? null,
      input.firstSeenAt ?? null,
      input.lastSeenAt ?? null,
      input.completedAt ?? null,
      input.metadataJson ?? '{}',
    ]
  )
  const insertedId = Number(result?.insertId || 0)
  if (!Number.isFinite(insertedId) || insertedId <= 0) throw new Error('failed_to_create_message_journey_instance')
  const [rows] = await db.query(`${INSTANCE_SELECT_SQL} WHERE id = ? LIMIT 1`, [insertedId])
  const row = ((rows as any[])[0] as MessageJourneyInstanceRow) || null
  if (!row) throw new Error('failed_to_create_message_journey_instance')
  return row
}

export async function updateJourneyInstanceById(id: number, patch: JourneyInstanceUpdateInput): Promise<MessageJourneyInstanceRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []

  if (patch.state !== undefined) { sets.push('state = ?'); args.push(patch.state) }
  if (patch.journeySubjectId !== undefined) { sets.push('journey_subject_id = ?'); args.push(patch.journeySubjectId) }
  if (patch.currentStepId !== undefined) { sets.push('current_step_id = ?'); args.push(patch.currentStepId) }
  if (patch.completedReason !== undefined) { sets.push('completed_reason = ?'); args.push(patch.completedReason) }
  if (patch.completedEventKey !== undefined) { sets.push('completed_event_key = ?'); args.push(patch.completedEventKey) }
  if (patch.firstSeenAt !== undefined) { sets.push('first_seen_at = ?'); args.push(patch.firstSeenAt) }
  if (patch.lastSeenAt !== undefined) { sets.push('last_seen_at = ?'); args.push(patch.lastSeenAt) }
  if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); args.push(patch.completedAt) }
  if (patch.metadataJson !== undefined) { sets.push('metadata_json = ?'); args.push(patch.metadataJson) }

  if (sets.length) {
    await db.query(`UPDATE feed_message_journey_instances SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  }

  const [rows] = await db.query(`${INSTANCE_SELECT_SQL} WHERE id = ? LIMIT 1`, [id])
  const row = ((rows as any[])[0] as MessageJourneyInstanceRow) || null
  if (!row) throw new Error('not_found')
  return row
}
