import * as repo from './repo'
import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import { getPool } from '../../db'
import type {
  MessageJourneyAnonProgressRow,
  MessageJourneyInstanceDto,
  MessageJourneyInstanceIdentityType,
  MessageJourneyInstanceRow,
  MessageJourneyInstanceState,
  MessageJourneyDto,
  MessageJourneyProgressState,
  MessageJourneyRow,
  MessageJourneyProgressRow,
  MessageJourneyStatus,
  MessageJourneyStepDto,
  MessageJourneyStepRow,
  MessageJourneyStepStatus,
} from './types'

type MessageJourneySignalEvent =
  | 'impression'
  | 'click'
  | 'pass_through'
  | 'dismiss'
  | 'auth_complete'
  | 'donation_complete'
  | 'subscription_complete'
  | 'upgrade_complete'

type JourneyGoalEventKey =
  | 'auth.register_complete'
  | 'auth.login_complete'
  | 'support.subscribe_complete'
  | 'support.donate_complete'

const JOURNEY_STATUS_VALUES: readonly MessageJourneyStatus[] = ['draft', 'active', 'paused', 'archived']
const STEP_STATUS_VALUES: readonly MessageJourneyStepStatus[] = ['draft', 'active', 'archived']
const JOURNEY_INSTANCE_STATE_VALUES: readonly MessageJourneyInstanceState[] = ['active', 'completed', 'abandoned', 'expired']
const JOURNEY_INSTANCE_IDENTITY_TYPE_VALUES: readonly MessageJourneyInstanceIdentityType[] = ['user', 'anon']
const JOURNEY_SURFACE_VALUES = ['global_feed', 'group_feed', 'channel_feed'] as const
type JourneySurface = (typeof JOURNEY_SURFACE_VALUES)[number]
const TARGETING_MODE_VALUES = ['all', 'selected'] as const
const JOURNEY_GOAL_EVENT_KEYS: readonly JourneyGoalEventKey[] = [
  'auth.register_complete',
  'auth.login_complete',
  'support.subscribe_complete',
  'support.donate_complete',
]

function isEnumValue<T extends string>(value: any, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function normalizeJourneyName(raw: any): string {
  const value = String(raw ?? '').trim()
  if (!value) throw new DomainError('invalid_name', 'invalid_name', 400)
  if (value.length > 120) throw new DomainError('invalid_name', 'invalid_name', 400)
  return value
}

function normalizeJourneyKey(raw: any): string {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) throw new DomainError('invalid_journey_key', 'invalid_journey_key', 400)
  if (!/^[a-z0-9_:-]{1,64}$/.test(value)) throw new DomainError('invalid_journey_key', 'invalid_journey_key', 400)
  return value
}

function normalizeCampaignCategory(raw: any): string | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return null
  if (value.length > 64) throw new DomainError('invalid_campaign_category', 'invalid_campaign_category', 400)
  if (!/^[a-z0-9_-]+$/.test(value)) throw new DomainError('invalid_campaign_category', 'invalid_campaign_category', 400)
  return value
}

function isDuplicateJourneyKeyError(err: any): boolean {
  const code = String(err?.code || '')
  const errno = Number(err?.errno || 0)
  const msg = String(err?.sqlMessage || err?.message || '').toLowerCase()
  if (code === 'ER_DUP_ENTRY' || errno === 1062) {
    return msg.includes('uniq_feed_message_journeys_key') || msg.includes('journey_key')
  }
  return false
}

function normalizeStepKey(raw: any): string {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) throw new DomainError('invalid_step_key', 'invalid_step_key', 400)
  if (!/^[a-z0-9_:-]{1,64}$/.test(value)) throw new DomainError('invalid_step_key', 'invalid_step_key', 400)
  return value
}

function normalizeDescription(raw: any): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (value.length > 500) throw new DomainError('invalid_description', 'invalid_description', 400)
  return value
}

function normalizeJourneyStatus(raw: any, fallback: MessageJourneyStatus = 'draft'): MessageJourneyStatus {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, JOURNEY_STATUS_VALUES)) throw new DomainError('invalid_status', 'invalid_status', 400)
  return value
}

function normalizeStepStatus(raw: any, fallback: MessageJourneyStepStatus = 'draft'): MessageJourneyStepStatus {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, STEP_STATUS_VALUES)) throw new DomainError('invalid_step_status', 'invalid_step_status', 400)
  return value
}

function normalizeJourneyInstanceState(raw: any, fallback: MessageJourneyInstanceState = 'active'): MessageJourneyInstanceState {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, JOURNEY_INSTANCE_STATE_VALUES)) {
    throw new DomainError('invalid_journey_instance_state', 'invalid_journey_instance_state', 400)
  }
  return value
}

function normalizeJourneyInstanceIdentityType(raw: any): MessageJourneyInstanceIdentityType {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!isEnumValue(value, JOURNEY_INSTANCE_IDENTITY_TYPE_VALUES)) {
    throw new DomainError('invalid_journey_identity_type', 'invalid_journey_identity_type', 400)
  }
  return value
}

function normalizeJourneyIdentityKey(raw: any): string {
  const value = String(raw ?? '').trim()
  if (!value) throw new DomainError('invalid_journey_identity_key', 'invalid_journey_identity_key', 400)
  if (value.length > 120) throw new DomainError('invalid_journey_identity_key', 'invalid_journey_identity_key', 400)
  return value
}

function normalizeJourneyCompletedReason(raw: any): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (value.length > 120) throw new DomainError('invalid_journey_completed_reason', 'invalid_journey_completed_reason', 400)
  return value
}

function normalizeJourneyCompletedEventKey(raw: any): string | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return null
  if (value.length > 120) throw new DomainError('invalid_journey_completed_event_key', 'invalid_journey_completed_event_key', 400)
  if (!/^[a-z0-9_:-]+$/.test(value)) throw new DomainError('invalid_journey_completed_event_key', 'invalid_journey_completed_event_key', 400)
  return value
}

function normalizeJourneySurface(raw: any, fallback: JourneySurface = 'global_feed'): JourneySurface {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if ((JOURNEY_SURFACE_VALUES as readonly string[]).includes(value)) return value as JourneySurface
  throw new DomainError('invalid_applies_to_surface', 'invalid_applies_to_surface', 400)
}

function normalizeJourneySurfaceTargeting(raw: any, fallbackSurface: JourneySurface): Array<{
  surface: JourneySurface
  targetingMode: 'all' | 'selected'
  targetIds: number[]
}> {
  const input = Array.isArray(raw) ? raw : []
  const out: Array<{ surface: JourneySurface; targetingMode: 'all' | 'selected'; targetIds: number[] }> = []
  const seen = new Set<string>()
  for (const item of input) {
    const surface = normalizeJourneySurface((item as any)?.surface, fallbackSurface)
    if (seen.has(surface)) continue
    seen.add(surface)
    const modeRaw = String((item as any)?.targetingMode ?? (item as any)?.targeting_mode ?? '').trim().toLowerCase()
    const targetingMode = (TARGETING_MODE_VALUES as readonly string[]).includes(modeRaw) && modeRaw === 'selected' ? 'selected' : 'all'
    const idsRaw = Array.isArray((item as any)?.targetIds)
      ? (item as any).targetIds
      : (Array.isArray((item as any)?.target_ids) ? (item as any).target_ids : [])
    const targetIds: number[] = Array.from(new Set(
      idsRaw.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0).map((n: number) => Math.round(n))
    )) as number[]
    if ((surface === 'group_feed' || surface === 'channel_feed') && targetingMode === 'selected' && targetIds.length === 0) {
      throw new DomainError('invalid_surface_targeting', 'invalid_surface_targeting', 400)
    }
    out.push({ surface, targetingMode, targetIds })
  }
  if (!out.length) out.push({ surface: fallbackSurface, targetingMode: 'all', targetIds: [] })
  return out
}

async function assertJourneySurfaceTargetingTargetIds(targeting: Array<{
  surface: JourneySurface
  targetingMode: 'all' | 'selected'
  targetIds: number[]
}>): Promise<void> {
  const groupIds = Array.from(new Set(
    targeting
      .filter((item) => item.surface === 'group_feed' && item.targetingMode === 'selected')
      .flatMap((item) => item.targetIds)
      .map((n) => Math.round(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0)
  ))
  const channelIds = Array.from(new Set(
    targeting
      .filter((item) => item.surface === 'channel_feed' && item.targetingMode === 'selected')
      .flatMap((item) => item.targetIds)
      .map((n) => Math.round(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0)
  ))

  if (!groupIds.length && !channelIds.length) return
  const db = getPool()

  if (groupIds.length) {
    const placeholders = groupIds.map(() => '?').join(',')
    const [rows] = await db.query(
      `SELECT id FROM spaces WHERE type = 'group' AND id IN (${placeholders})`,
      groupIds as any
    )
    const found = new Set((rows as any[]).map((row) => Math.round(Number(row.id || 0))).filter((n) => Number.isFinite(n) && n > 0))
    if (found.size !== groupIds.length) throw new DomainError('invalid_surface_targeting', 'invalid_surface_targeting', 400)
  }

  if (channelIds.length) {
    const placeholders = channelIds.map(() => '?').join(',')
    const [rows] = await db.query(
      `SELECT id
         FROM spaces
        WHERE type = 'channel'
          AND slug NOT IN ('global', 'global-feed')
          AND id IN (${placeholders})`,
      channelIds as any
    )
    const found = new Set((rows as any[]).map((row) => Math.round(Number(row.id || 0))).filter((n) => Number.isFinite(n) && n > 0))
    if (found.size !== channelIds.length) throw new DomainError('invalid_surface_targeting', 'invalid_surface_targeting', 400)
  }
}

function normalizePositiveInt(raw: any, code: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError(code, code, 400)
  return Math.round(n)
}

function normalizeNullablePositiveInt(raw: any, code: string): number | null {
  if (raw == null || raw === '') return null
  return normalizePositiveInt(raw, code)
}

function normalizeActorUserId(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new ForbiddenError('forbidden')
  return Math.round(n)
}

function parseConfig(raw: any): Record<string, any> {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>
    } catch {}
  }
  throw new DomainError('invalid_config_json', 'invalid_config_json', 400)
}

function normalizeJourneyConfigForAdmin(rawConfig: Record<string, any>): Record<string, any> {
  const cfg: Record<string, any> = { ...rawConfig }
  const goalsRaw = (cfg as any).goal_rules
  if (goalsRaw == null) {
    delete (cfg as any).goal_rules
    return cfg
  }
  if (!goalsRaw || typeof goalsRaw !== 'object' || Array.isArray(goalsRaw)) {
    throw new DomainError('invalid_goal_rules', 'invalid_goal_rules', 400)
  }
  const anyOfRaw = (goalsRaw as any).any_of
  if (anyOfRaw == null) {
    (cfg as any).goal_rules = { any_of: [] }
    return cfg
  }
  if (!Array.isArray(anyOfRaw)) {
    throw new DomainError('invalid_goal_rules', 'invalid_goal_rules', 400)
  }
  const normalized = Array.from(new Set(
    anyOfRaw
      .map((v) => String(v || '').trim().toLowerCase())
      .filter((v) => (JOURNEY_GOAL_EVENT_KEYS as readonly string[]).includes(v))
  )) as JourneyGoalEventKey[]
  ;(cfg as any).goal_rules = { any_of: normalized }
  return cfg
}

function evaluateJourneyGoalCompletion(config: Record<string, any>, eventKey: string | null): boolean {
  const key = String(eventKey || '').trim().toLowerCase()
  if (!key) return false
  const goals = (config as any)?.goal_rules
  const anyOf = Array.isArray(goals?.any_of) ? goals.any_of : []
  if (!anyOf.length) return false
  return anyOf.map((v: any) => String(v || '').trim().toLowerCase()).includes(key)
}

function normalizeJourneyStepConfigForAdmin(rawConfig: Record<string, any>): Record<string, any> {
  const config: Record<string, any> = { ...rawConfig }
  const policyRaw = String(config.progression_policy || config.progressionPolicy || '').trim().toLowerCase()
  if (!policyRaw) {
    delete config.progression_policy
    delete config.progressionPolicy
    delete config.progression_slot
    delete config.progressionSlot
    delete config.progression_intent_key
    delete config.progressionIntentKey
    return config
  }

  if (
    policyRaw !== 'on_any_click' &&
    policyRaw !== 'on_any_completion' &&
    policyRaw !== 'on_cta_slot_completion' &&
    policyRaw !== 'on_intent_completion'
  ) {
    throw new DomainError('invalid_progression_policy', 'invalid_progression_policy', 400)
  }

  delete config.progressionPolicy
  delete config.progressionSlot
  delete config.progressionIntentKey
  config.progression_policy = policyRaw

  if (policyRaw === 'on_cta_slot_completion') {
    const slot = Number(config.progression_slot)
    if (!Number.isFinite(slot) || slot <= 0) {
      throw new DomainError('invalid_progression_slot', 'invalid_progression_slot', 400)
    }
    config.progression_slot = Math.round(slot)
    if (config.progression_intent_key != null && String(config.progression_intent_key).trim() !== '') {
      const intent = String(config.progression_intent_key).trim().toLowerCase()
      if (!/^[a-z0-9_:-]{1,64}$/.test(intent)) {
        throw new DomainError('invalid_progression_intent_key', 'invalid_progression_intent_key', 400)
      }
      config.progression_intent_key = intent
    } else {
      delete config.progression_intent_key
    }
    return config
  }

  if (policyRaw === 'on_intent_completion') {
    const intent = String(config.progression_intent_key ?? '').trim().toLowerCase()
    if (!intent || !/^[a-z0-9_:-]{1,64}$/.test(intent)) {
      throw new DomainError('invalid_progression_intent_key', 'invalid_progression_intent_key', 400)
    }
    config.progression_intent_key = intent
    if (config.progression_slot != null && String(config.progression_slot).trim() !== '') {
      const slot = Number(config.progression_slot)
      if (!Number.isFinite(slot) || slot <= 0) {
        throw new DomainError('invalid_progression_slot', 'invalid_progression_slot', 400)
      }
      config.progression_slot = Math.round(slot)
    } else {
      delete config.progression_slot
    }
    return config
  }

  delete config.progression_slot
  delete config.progression_intent_key
  return config
}

function toJourneyDto(
  row: MessageJourneyRow,
  targetingMap?: Map<number, Array<{ surface: 'global_feed' | 'group_feed' | 'channel_feed'; targetingMode: 'all' | 'selected'; targetIds: number[] }>>
): MessageJourneyDto {
  const appliesToSurface = normalizeJourneySurface((row as any).applies_to_surface, 'global_feed')
  const surfaceTargeting = targetingMap?.get(Number(row.id)) || [{ surface: appliesToSurface, targetingMode: 'all' as const, targetIds: [] }]
  let config: Record<string, any> = {}
  try {
    const parsed = JSON.parse(String((row as any).config_json || '{}'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = normalizeJourneyConfigForAdmin(parsed as Record<string, any>)
  } catch {}
  return {
    id: Number(row.id),
    journeyKey: String(row.journey_key || ''),
    campaignCategory: row.campaign_category == null || String(row.campaign_category).trim() === '' ? null : String(row.campaign_category),
    name: String(row.name || ''),
    appliesToSurface,
    surfaceTargeting,
    status: normalizeJourneyStatus(row.status),
    description: row.description == null ? null : String(row.description),
    config,
    eligibilityRulesetId: row.eligibility_ruleset_id == null ? null : Number(row.eligibility_ruleset_id),
    createdBy: Number(row.created_by || 0),
    updatedBy: Number(row.updated_by || 0),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

function toStepDto(row: MessageJourneyStepRow): MessageJourneyStepDto {
  let config: Record<string, any> = {}
  try {
    const parsed = JSON.parse(String(row.config_json || '{}'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed
  } catch {}
  return {
    id: Number(row.id),
    journeyId: Number(row.journey_id),
    stepKey: String(row.step_key || ''),
    stepOrder: Number(row.step_order || 0),
    messageId: Number(row.message_id || 0),
    status: normalizeStepStatus(row.status),
    config,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

function toJourneyInstanceDto(row: MessageJourneyInstanceRow): MessageJourneyInstanceDto {
  let metadata: Record<string, any> = {}
  try {
    const parsed = JSON.parse(String(row.metadata_json || '{}'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed
  } catch {}
  return {
    id: Number(row.id),
    journeyId: Number(row.journey_id),
    identityType: normalizeJourneyInstanceIdentityType(row.identity_type),
    identityKey: String(row.identity_key || ''),
    state: normalizeJourneyInstanceState(row.state),
    currentStepId: row.current_step_id == null ? null : Number(row.current_step_id),
    completedReason: row.completed_reason == null ? null : String(row.completed_reason),
    completedEventKey: row.completed_event_key == null ? null : String(row.completed_event_key),
    firstSeenAt: row.first_seen_at == null ? null : String(row.first_seen_at),
    lastSeenAt: row.last_seen_at == null ? null : String(row.last_seen_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
    metadata,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

export async function listJourneysForAdmin(params?: {
  limit?: number
  includeArchived?: boolean
  status?: any
}): Promise<MessageJourneyDto[]> {
  const status = params?.status == null || params?.status === '' ? null : normalizeJourneyStatus(params.status)
  const rows = await repo.listJourneys({
    limit: params?.limit,
    includeArchived: params?.includeArchived,
    status,
  })
  const targetingMap = await repo.listSurfaceTargetingByJourneyIds(rows.map((row) => Number((row as any).id || 0)))
  return rows.map((row) => toJourneyDto(row, targetingMap))
}

export async function getJourneyForAdmin(id: number): Promise<MessageJourneyDto> {
  const journeyId = normalizePositiveInt(id, 'bad_id')
  const row = await repo.getJourneyById(journeyId)
  if (!row) throw new NotFoundError('message_journey_not_found')
  const targetingMap = await repo.listSurfaceTargetingByJourneyIds([Number(row.id)])
  return toJourneyDto(row, targetingMap)
}

export async function createJourneyForAdmin(input: any, actorUserId: number): Promise<MessageJourneyDto> {
  const userId = normalizeActorUserId(actorUserId)
  const appliesToSurface = normalizeJourneySurface(input?.appliesToSurface ?? input?.applies_to_surface, 'global_feed')
  const surfaceTargeting = normalizeJourneySurfaceTargeting(input?.surfaceTargeting ?? input?.surface_targeting, appliesToSurface)
  await assertJourneySurfaceTargetingTargetIds(surfaceTargeting)

  let row: MessageJourneyRow
  try {
    row = await repo.createJourney({
      journeyKey: normalizeJourneyKey(input?.journeyKey ?? input?.journey_key),
      campaignCategory: normalizeCampaignCategory(input?.campaignCategory ?? input?.campaign_category),
      name: normalizeJourneyName(input?.name),
      appliesToSurface,
      surfaceTargeting,
      status: normalizeJourneyStatus(input?.status, 'draft'),
      description: normalizeDescription(input?.description),
      configJson: JSON.stringify(normalizeJourneyConfigForAdmin(parseConfig(input?.config ?? input?.config_json))),
      eligibilityRulesetId: normalizeNullablePositiveInt(input?.eligibilityRulesetId ?? input?.eligibility_ruleset_id, 'invalid_ruleset_id'),
      createdBy: userId,
      updatedBy: userId,
    })
  } catch (err: any) {
    if (isDuplicateJourneyKeyError(err)) {
      throw new DomainError('duplicate_journey_key', 'duplicate_journey_key', 409)
    }
    throw err
  }
  const targetingMap = await repo.listSurfaceTargetingByJourneyIds([Number(row.id)])
  return toJourneyDto(row, targetingMap)
}

export async function updateJourneyForAdmin(id: number, patch: any, actorUserId: number): Promise<MessageJourneyDto> {
  const userId = normalizeActorUserId(actorUserId)
  const journeyId = normalizePositiveInt(id, 'bad_id')
  const existing = await repo.getJourneyById(journeyId)
  if (!existing) throw new NotFoundError('message_journey_not_found')
  const existingDto = toJourneyDto(existing)

  const nextAppliesToSurface =
    patch?.appliesToSurface !== undefined || patch?.applies_to_surface !== undefined
      ? normalizeJourneySurface(patch?.appliesToSurface ?? patch?.applies_to_surface, existingDto.appliesToSurface)
      : existingDto.appliesToSurface
  const nextSurfaceTargeting =
    patch?.surfaceTargeting !== undefined || patch?.surface_targeting !== undefined
      ? normalizeJourneySurfaceTargeting(
          patch?.surfaceTargeting ?? patch?.surface_targeting,
          nextAppliesToSurface
        )
      : undefined
  if (nextSurfaceTargeting) await assertJourneySurfaceTargetingTargetIds(nextSurfaceTargeting)

  let row: MessageJourneyRow
  try {
    row = await repo.updateJourney(journeyId, {
      journeyKey:
        patch?.journeyKey !== undefined || patch?.journey_key !== undefined
          ? normalizeJourneyKey(patch?.journeyKey ?? patch?.journey_key)
          : existingDto.journeyKey,
      campaignCategory:
        patch?.campaignCategory !== undefined || patch?.campaign_category !== undefined
          ? normalizeCampaignCategory(patch?.campaignCategory ?? patch?.campaign_category)
          : existingDto.campaignCategory,
      name: patch?.name !== undefined ? normalizeJourneyName(patch?.name) : existingDto.name,
      appliesToSurface: nextAppliesToSurface,
      surfaceTargeting: nextSurfaceTargeting,
      status: patch?.status !== undefined ? normalizeJourneyStatus(patch?.status, existingDto.status) : existingDto.status,
      description: patch?.description !== undefined ? normalizeDescription(patch?.description) : existingDto.description,
      configJson:
        patch?.config !== undefined || patch?.config_json !== undefined
          ? JSON.stringify(normalizeJourneyConfigForAdmin(parseConfig(patch?.config ?? patch?.config_json)))
          : JSON.stringify(normalizeJourneyConfigForAdmin(existingDto.config || {})),
      eligibilityRulesetId:
        patch?.eligibilityRulesetId !== undefined || patch?.eligibility_ruleset_id !== undefined
          ? normalizeNullablePositiveInt(patch?.eligibilityRulesetId ?? patch?.eligibility_ruleset_id, 'invalid_ruleset_id')
          : existingDto.eligibilityRulesetId,
      updatedBy: userId,
    })
  } catch (err: any) {
    if (isDuplicateJourneyKeyError(err)) {
      throw new DomainError('duplicate_journey_key', 'duplicate_journey_key', 409)
    }
    throw err
  }
  const targetingMap = await repo.listSurfaceTargetingByJourneyIds([Number(row.id)])
  return toJourneyDto(row, targetingMap)
}

export async function deleteJourneyForAdmin(id: number, actorUserId: number): Promise<void> {
  normalizeActorUserId(actorUserId)
  const journeyId = normalizePositiveInt(id, 'bad_id')
  const existing = await repo.getJourneyById(journeyId)
  if (!existing) throw new NotFoundError('message_journey_not_found')
  const removed = await repo.removeJourney(journeyId)
  if (!removed) throw new NotFoundError('message_journey_not_found')
}

export async function listJourneyStepsForAdmin(journeyIdRaw: number, params?: {
  includeArchived?: boolean
  status?: any
}): Promise<MessageJourneyStepDto[]> {
  const journeyId = normalizePositiveInt(journeyIdRaw, 'bad_id')
  const journey = await repo.getJourneyById(journeyId)
  if (!journey) throw new NotFoundError('message_journey_not_found')
  const status = params?.status == null || params?.status === '' ? null : normalizeStepStatus(params.status)
  const rows = await repo.listStepsByJourneyId(journeyId, {
    includeArchived: params?.includeArchived,
    status,
  })
  return rows.map(toStepDto)
}

export async function createJourneyStepForAdmin(journeyIdRaw: number, input: any, actorUserId: number): Promise<MessageJourneyStepDto> {
  normalizeActorUserId(actorUserId)
  const journeyId = normalizePositiveInt(journeyIdRaw, 'bad_id')
  const journey = await repo.getJourneyById(journeyId)
  if (!journey) throw new NotFoundError('message_journey_not_found')

  const existingSteps = await repo.listStepsByJourneyId(journeyId, { includeArchived: true })
  const nextStepOrder =
    existingSteps.length > 0
      ? Math.max(...existingSteps.map((row) => Number((row as any).step_order || 0))) + 1
      : 1
  let nextStepKey = `step_${nextStepOrder}`
  const existingKeys = new Set(existingSteps.map((row) => String((row as any).step_key || '').trim().toLowerCase()).filter(Boolean))
  if (existingKeys.has(nextStepKey)) {
    let suffix = 2
    while (existingKeys.has(`${nextStepKey}_${suffix}`)) suffix += 1
    nextStepKey = `${nextStepKey}_${suffix}`
  }

  const row = await repo.createStep({
    journeyId,
    stepKey: nextStepKey,
    stepOrder: nextStepOrder,
    messageId: normalizePositiveInt(input?.messageId ?? input?.message_id, 'invalid_message_id'),
    status: normalizeStepStatus(input?.status, 'draft'),
    configJson: JSON.stringify(normalizeJourneyStepConfigForAdmin(parseConfig(input?.config ?? input?.config_json))),
  })
  return toStepDto(row)
}

export async function updateJourneyStepForAdmin(journeyIdRaw: number, stepIdRaw: number, patch: any, actorUserId: number): Promise<MessageJourneyStepDto> {
  normalizeActorUserId(actorUserId)
  const journeyId = normalizePositiveInt(journeyIdRaw, 'bad_id')
  const stepId = normalizePositiveInt(stepIdRaw, 'bad_step_id')
  const step = await repo.getStepById(stepId)
  if (!step || Number(step.journey_id) !== journeyId) throw new NotFoundError('message_journey_step_not_found')
  const existing = toStepDto(step)

  const row = await repo.updateStep(stepId, {
    journeyId,
    stepKey:
      patch?.stepKey !== undefined || patch?.step_key !== undefined
        ? normalizeStepKey(patch?.stepKey ?? patch?.step_key)
        : existing.stepKey,
    stepOrder:
      patch?.stepOrder !== undefined || patch?.step_order !== undefined
        ? normalizePositiveInt(patch?.stepOrder ?? patch?.step_order, 'invalid_step_order')
        : existing.stepOrder,
    messageId:
      patch?.messageId !== undefined || patch?.message_id !== undefined
        ? normalizePositiveInt(patch?.messageId ?? patch?.message_id, 'invalid_message_id')
        : existing.messageId,
    status: patch?.status !== undefined ? normalizeStepStatus(patch?.status, existing.status) : existing.status,
    configJson:
      patch?.config !== undefined || patch?.config_json !== undefined
        ? JSON.stringify(normalizeJourneyStepConfigForAdmin(parseConfig(patch?.config ?? patch?.config_json)))
        : JSON.stringify(normalizeJourneyStepConfigForAdmin(existing.config || {})),
  })
  return toStepDto(row)
}

export async function deleteJourneyStepForAdmin(journeyIdRaw: number, stepIdRaw: number, actorUserId: number): Promise<void> {
  normalizeActorUserId(actorUserId)
  const journeyId = normalizePositiveInt(journeyIdRaw, 'bad_id')
  const stepId = normalizePositiveInt(stepIdRaw, 'bad_step_id')
  const step = await repo.getStepById(stepId)
  if (!step || Number(step.journey_id) !== journeyId) throw new NotFoundError('message_journey_step_not_found')
  const removed = await repo.removeStep(stepId)
  if (!removed) throw new NotFoundError('message_journey_step_not_found')
}

export async function cloneJourneyStepForAdmin(journeyIdRaw: number, stepIdRaw: number, actorUserId: number): Promise<MessageJourneyStepDto> {
  normalizeActorUserId(actorUserId)
  const journeyId = normalizePositiveInt(journeyIdRaw, 'bad_id')
  const stepId = normalizePositiveInt(stepIdRaw, 'bad_step_id')
  const source = await repo.getStepById(stepId)
  if (!source || Number(source.journey_id) !== journeyId) throw new NotFoundError('message_journey_step_not_found')

  const sourceDto = toStepDto(source)
  const insertOrder = Math.max(1, Number(sourceDto.stepOrder) + 1)
  const existingSteps = await repo.listStepsByJourneyId(journeyId, { includeArchived: true })
  const existingKeys = new Set(
    existingSteps
      .map((row) => String((row as any).step_key || '').trim().toLowerCase())
      .filter(Boolean)
  )
  let nextStepKey = `step_${insertOrder}`
  if (existingKeys.has(nextStepKey)) {
    let suffix = 2
    while (existingKeys.has(`${nextStepKey}_${suffix}`)) suffix += 1
    nextStepKey = `${nextStepKey}_${suffix}`
  }

  await repo.shiftStepOrdersAtOrAfter(journeyId, insertOrder, 1)
  const row = await repo.createStep({
    journeyId,
    stepKey: nextStepKey,
    stepOrder: insertOrder,
    messageId: Number(sourceDto.messageId),
    status: normalizeStepStatus(sourceDto.status, 'draft'),
    configJson: JSON.stringify(normalizeJourneyStepConfigForAdmin(sourceDto.config || {})),
  })
  return toStepDto(row)
}

export async function listJourneyStepRefsForMessage(messageIdRaw: number): Promise<Array<{
  journeyId: number
  journeyKey: string
  journeyStatus: MessageJourneyStatus
  stepId: number
  stepKey: string
  stepOrder: number
}>> {
  const messageId = normalizePositiveInt(messageIdRaw, 'bad_message_id')
  const rows = await repo.listJourneyStepRefsByMessageId(messageId)
  return rows.map((row) => ({
    journeyId: Number((row as any).journey_id),
    journeyKey: String((row as any).journey_key || ''),
    journeyStatus: normalizeJourneyStatus((row as any).journey_status, 'draft'),
    stepId: Number((row as any).step_id),
    stepKey: String((row as any).step_key || ''),
    stepOrder: Number((row as any).step_order || 0),
  }))
}

export async function getJourneyInstanceForIdentity(input: {
  journeyId: any
  identityType: any
  identityKey: any
}): Promise<MessageJourneyInstanceDto | null> {
  const journeyId = normalizePositiveInt(input?.journeyId, 'bad_journey_id')
  const identityType = normalizeJourneyInstanceIdentityType(input?.identityType)
  const identityKey = normalizeJourneyIdentityKey(input?.identityKey)
  const row = await repo.getJourneyInstanceByIdentity({ journeyId, identityType, identityKey })
  return row ? toJourneyInstanceDto(row) : null
}

export async function listJourneyInstancesForIdentity(input: {
  identityType: any
  identityKey: any
  state?: any
}): Promise<MessageJourneyInstanceDto[]> {
  const identityType = normalizeJourneyInstanceIdentityType(input?.identityType)
  const identityKey = normalizeJourneyIdentityKey(input?.identityKey)
  const state = input?.state == null || input?.state === '' ? null : normalizeJourneyInstanceState(input?.state)
  const rows = await repo.listJourneyInstancesByIdentity({ identityType, identityKey, state })
  return rows.map((row) => toJourneyInstanceDto(row))
}

export async function upsertJourneyInstanceForIdentity(input: {
  journeyId: any
  identityType: any
  identityKey: any
  state: any
  currentStepId?: any
  completedReason?: any
  completedEventKey?: any
  firstSeenAt?: any
  lastSeenAt?: any
  completedAt?: any
  metadata?: Record<string, any> | null
}): Promise<MessageJourneyInstanceDto> {
  const journeyId = normalizePositiveInt(input?.journeyId, 'bad_journey_id')
  const identityType = normalizeJourneyInstanceIdentityType(input?.identityType)
  const identityKey = normalizeJourneyIdentityKey(input?.identityKey)
  const state = normalizeJourneyInstanceState(input?.state)
  const currentStepId = normalizeNullablePositiveInt(input?.currentStepId, 'invalid_current_step_id')
  const firstSeenAt = normalizeOptionalDateTime(input?.firstSeenAt, 'invalid_first_seen_at')
  const lastSeenAt = normalizeOptionalDateTime(input?.lastSeenAt, 'invalid_last_seen_at')
  const completedAt = normalizeOptionalDateTime(input?.completedAt, 'invalid_completed_at')
  const completedReason = normalizeJourneyCompletedReason(input?.completedReason)
  const completedEventKey = normalizeJourneyCompletedEventKey(input?.completedEventKey)
  const metadataJson = JSON.stringify(
    input?.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata
      : {}
  )
  const row = await repo.upsertJourneyInstance({
    journeyId,
    identityType,
    identityKey,
    state,
    currentStepId,
    completedReason,
    completedEventKey,
    firstSeenAt,
    lastSeenAt,
    completedAt,
    metadataJson,
  })
  return toJourneyInstanceDto(row)
}

export async function updateJourneyInstanceById(input: {
  id: any
  state?: any
  currentStepId?: any
  completedReason?: any
  completedEventKey?: any
  firstSeenAt?: any
  lastSeenAt?: any
  completedAt?: any
  metadata?: Record<string, any> | null
}): Promise<MessageJourneyInstanceDto> {
  const id = normalizePositiveInt(input?.id, 'bad_id')
  const patch: {
    state?: MessageJourneyInstanceState
    currentStepId?: number | null
    completedReason?: string | null
    completedEventKey?: string | null
    firstSeenAt?: string | null
    lastSeenAt?: string | null
    completedAt?: string | null
    metadataJson?: string
  } = {}
  if (input?.state !== undefined) patch.state = normalizeJourneyInstanceState(input.state)
  if (input?.currentStepId !== undefined) patch.currentStepId = normalizeNullablePositiveInt(input.currentStepId, 'invalid_current_step_id')
  if (input?.completedReason !== undefined) patch.completedReason = normalizeJourneyCompletedReason(input.completedReason)
  if (input?.completedEventKey !== undefined) patch.completedEventKey = normalizeJourneyCompletedEventKey(input.completedEventKey)
  if (input?.firstSeenAt !== undefined) patch.firstSeenAt = normalizeOptionalDateTime(input.firstSeenAt, 'invalid_first_seen_at')
  if (input?.lastSeenAt !== undefined) patch.lastSeenAt = normalizeOptionalDateTime(input.lastSeenAt, 'invalid_last_seen_at')
  if (input?.completedAt !== undefined) patch.completedAt = normalizeOptionalDateTime(input.completedAt, 'invalid_completed_at')
  if (input?.metadata !== undefined) {
    patch.metadataJson = JSON.stringify(
      input?.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
        ? input.metadata
        : {}
    )
  }
  const row = await repo.updateJourneyInstanceById(id, patch)
  return toJourneyInstanceDto(row)
}

function eventToState(event: MessageJourneySignalEvent): MessageJourneyProgressState {
  if (event === 'impression') return 'shown'
  if (event === 'click') return 'clicked'
  if (event === 'pass_through' || event === 'dismiss') return 'skipped'
  return 'completed'
}

function canTransition(from: MessageJourneyProgressState, to: MessageJourneyProgressState): boolean {
  if (from === to) return true
  if (from === 'completed') return false
  if (from === 'expired' || from === 'suppressed') return false

  if (to === 'completed') return true
  if (to === 'clicked') return from === 'eligible' || from === 'shown' || from === 'skipped'
  if (to === 'shown') return from === 'eligible'
  if (to === 'skipped') return from === 'eligible' || from === 'shown'

  return false
}

function mergeMetadata(existingRaw: string, patch: Record<string, any>): string {
  let base: Record<string, any> = {}
  try {
    const parsed = JSON.parse(existingRaw || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed as Record<string, any>
  } catch {}
  return JSON.stringify({ ...base, ...patch })
}

function toUtcDateTimeString(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function parseMetadata(raw: string | null | undefined): Record<string, any> {
  try {
    const parsed = JSON.parse(String(raw || '{}'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>
  } catch {}
  return {}
}

function mergeInstanceStateByPrecedence(
  a: MessageJourneyInstanceState,
  b: MessageJourneyInstanceState
): MessageJourneyInstanceState {
  const rank = (value: MessageJourneyInstanceState): number => {
    if (value === 'completed') return 4
    if (value === 'expired') return 3
    if (value === 'abandoned') return 2
    return 1
  }
  return rank(a) >= rank(b) ? a : b
}

function progressStateRank(value: MessageJourneyProgressState): number {
  if (value === 'completed') return 7
  if (value === 'clicked') return 5
  if (value === 'skipped') return 4
  if (value === 'suppressed') return 4
  if (value === 'expired') return 4
  if (value === 'shown') return 3
  return 2
}

function maxDateTime(a: string | null, b: string | null): string | null {
  if (!a) return b || null
  if (!b) return a
  return a >= b ? a : b
}

function minDateTime(a: string | null, b: string | null): string | null {
  if (!a) return b || null
  if (!b) return a
  return a <= b ? a : b
}

function preferredProgressState(
  anonRow: MessageJourneyAnonProgressRow,
  userRow: MessageJourneyProgressRow | null
): MessageJourneyProgressState {
  if (!userRow) return anonRow.state
  const anonRank = progressStateRank(anonRow.state)
  const userRank = progressStateRank(userRow.state)
  return anonRank > userRank ? anonRow.state : userRow.state
}

function normalizeOptionalDateTime(raw: any, code: string): string | null {
  if (raw == null || raw === '') return null
  const date = new Date(String(raw))
  if (!Number.isFinite(date.getTime())) throw new DomainError(code, code, 400)
  return toUtcDateTimeString(date)
}

type StepProgressionPolicy =
  | { kind: 'on_any_click' }
  | { kind: 'on_any_completion' }
  | { kind: 'on_cta_slot_completion'; slot: number }
  | { kind: 'on_intent_completion'; intentKey: string }

function parseStepConfig(raw: any): Record<string, any> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, any>
}

function normalizeStepProgressionPolicy(config: Record<string, any>): StepProgressionPolicy {
  const key = String(config.progression_policy || config.progressionPolicy || '').trim().toLowerCase()
  if (key === 'on_any_click') return { kind: 'on_any_click' }
  if (key === 'on_cta_slot_completion') {
    const slot = Number(config.progression_slot ?? config.progressionSlot ?? 0)
    if (Number.isFinite(slot) && slot > 0) return { kind: 'on_cta_slot_completion', slot: Math.round(slot) }
  }
  if (key === 'on_intent_completion') {
    const intent = String(config.progression_intent_key ?? config.progressionIntentKey ?? '').trim().toLowerCase()
    if (intent) return { kind: 'on_intent_completion', intentKey: intent }
  }
  return { kind: 'on_any_completion' }
}

function policyQualifiesCompletion(policy: StepProgressionPolicy, input: {
  ctaSlot: number | null
  ctaIntentKey: string | null
  outcomeType: string
  outcomeStatus: string
  completed: boolean
}): boolean {
  if (policy.kind === 'on_any_click') return input.outcomeType === 'click' && input.outcomeStatus === 'success'
  if (policy.kind === 'on_any_completion') return input.completed
  if (policy.kind === 'on_cta_slot_completion') return input.completed && input.ctaSlot != null && Number(input.ctaSlot) === Number(policy.slot)
  if (policy.kind === 'on_intent_completion') return input.completed && input.ctaIntentKey != null && String(input.ctaIntentKey).toLowerCase() === String(policy.intentKey).toLowerCase()
  return false
}

function mapGoalEventKeyFromCtaOutcome(input: {
  ctaIntentKey?: string | null
  outcomeType: string
  outcomeStatus: string
  completed: boolean
}): JourneyGoalEventKey | null {
  if (!input.completed) return null
  if (String(input.outcomeStatus || '').toLowerCase() !== 'success') return null
  const intent = String(input.ctaIntentKey || '').trim().toLowerCase()
  if (intent === 'register') return 'auth.register_complete'
  if (intent === 'login') return 'auth.login_complete'
  if (intent === 'subscribe') return 'support.subscribe_complete'
  if (intent === 'donate') return 'support.donate_complete'
  return null
}

async function ensureActiveJourneyInstanceIdForStep(input: {
  journeyId: number
  stepId: number
  userId: number
  anonVisitorId: string
  occurredAtTs: string
  source: 'message_event' | 'cta_outcome'
  sourceMessageId: number
}): Promise<number | null> {
  const journeyId = Number(input.journeyId || 0)
  const stepId = Number(input.stepId || 0)
  if (!Number.isFinite(journeyId) || journeyId <= 0) return null
  if (!Number.isFinite(stepId) || stepId <= 0) return null
  const userId = Number(input.userId || 0)
  const anonVisitorId = String(input.anonVisitorId || '').trim()
  if ((!Number.isFinite(userId) || userId <= 0) && !anonVisitorId) return null

  const identityType = userId > 0 ? 'user' : 'anon'
  const identityKey = userId > 0 ? String(Math.round(userId)) : anonVisitorId
  const active = await repo.getActiveJourneyInstanceByIdentity({
    journeyId,
    identityType,
    identityKey,
  })
  if (active && Number(active.id || 0) > 0) return Number(active.id)

  const created = await repo.createJourneyInstance({
    journeyId,
    identityType,
    identityKey,
    state: 'active',
    currentStepId: stepId,
    firstSeenAt: input.occurredAtTs,
    lastSeenAt: input.occurredAtTs,
    completedAt: null,
    completedReason: null,
    completedEventKey: null,
    metadataJson: JSON.stringify({
      source: input.source,
      source_message_id: input.sourceMessageId,
      created_for: 'step_progress',
      created_at: new Date().toISOString(),
      last_event_at: input.occurredAtTs,
    }),
  })
  return Number(created.id || 0) || null
}

export async function recordJourneySignalFromMessageEvent(input: {
  userId: number | null
  anonVisitorId?: string | null
  messageId: number
  event: MessageJourneySignalEvent
  sessionId?: string | null
  occurredAt?: Date
}): Promise<{ stepsMatched: number; progressed: number; ignored: number }> {
  const userId = Number(input.userId || 0)
  const anonVisitorId = String(input.anonVisitorId || '').trim()
  const messageId = Number(input.messageId || 0)
  if ((!Number.isFinite(userId) || userId <= 0) && !anonVisitorId) {
    return { stepsMatched: 0, progressed: 0, ignored: 0 }
  }
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return { stepsMatched: 0, progressed: 0, ignored: 0 }
  }

  const steps = await repo.listActiveStepsByMessageId(messageId)
  if (!steps.length) return { stepsMatched: 0, progressed: 0, ignored: 0 }

  const eventState = eventToState(input.event)
  const ts = toUtcDateTimeString(input.occurredAt instanceof Date && Number.isFinite(input.occurredAt.getTime()) ? input.occurredAt : new Date())

  let progressed = 0
  let ignored = 0

  for (const step of steps) {
    const journeyInstanceId = await ensureActiveJourneyInstanceIdForStep({
      journeyId: Number(step.journey_id),
      stepId: Number(step.id),
      userId,
      anonVisitorId,
      occurredAtTs: ts,
      source: 'message_event',
      sourceMessageId: messageId,
    })
    const existing = userId > 0
      ? await repo.getProgressByUserInstanceStep(userId, Number(journeyInstanceId || 0), Number(step.id))
      : await repo.getAnonProgressByVisitorInstanceStep(anonVisitorId, Number(journeyInstanceId || 0), Number(step.id))
    if (!existing) {
      const metadata = JSON.stringify({
        source: 'message_event',
        source_event: input.event,
        source_message_id: messageId,
        last_event_at: ts,
      })
      if (userId > 0) {
        await repo.upsertProgress({
          userId,
          journeyId: Number(step.journey_id),
          journeyInstanceId,
          stepId: Number(step.id),
          state: eventState,
          firstSeenAt: eventState === 'shown' ? ts : null,
          lastSeenAt: ts,
          completedAt: eventState === 'completed' ? ts : null,
          sessionId: input.sessionId ?? null,
          metadataJson: metadata,
        })
      } else {
        await repo.upsertAnonProgress({
          anonVisitorId,
          journeyId: Number(step.journey_id),
          journeyInstanceId,
          stepId: Number(step.id),
          state: eventState,
          firstSeenAt: eventState === 'shown' ? ts : null,
          lastSeenAt: ts,
          completedAt: eventState === 'completed' ? ts : null,
          sessionId: input.sessionId ?? null,
          metadataJson: metadata,
        })
      }
      progressed += 1
      continue
    }

    const from = existing.state
    const to = eventState
    if (!canTransition(from, to)) {
      ignored += 1
      continue
    }

    const metadataJson = mergeMetadata(existing.metadata_json, {
      source: 'message_event',
      source_event: input.event,
      source_message_id: messageId,
      last_event_at: ts,
    })

    if (userId > 0) {
      await repo.updateProgressById(Number(existing.id), {
        state: to,
        firstSeenAt: existing.first_seen_at || (to === 'shown' ? ts : null),
        lastSeenAt: ts,
        completedAt: to === 'completed' ? (existing.completed_at || ts) : existing.completed_at,
        sessionId: input.sessionId ?? existing.session_id,
        metadataJson,
      })
    } else {
      await repo.updateAnonProgressById(Number(existing.id), {
        state: to,
        firstSeenAt: existing.first_seen_at || (to === 'shown' ? ts : null),
        lastSeenAt: ts,
        completedAt: to === 'completed' ? (existing.completed_at || ts) : existing.completed_at,
        sessionId: input.sessionId ?? existing.session_id,
        metadataJson,
      })
    }
    progressed += 1
  }

  return {
    stepsMatched: steps.length,
    progressed,
    ignored,
  }
}

export async function recordJourneySignalFromCtaOutcome(input: {
  outcomeRowId: number
  userId: number | null
  anonVisitorId?: string | null
  messageId: number
  sessionId?: string | null
  ctaSlot?: number | null
  ctaIntentKey?: string | null
  outcomeType: 'click' | 'return' | 'verified_complete' | 'webhook_complete' | 'failed' | 'abandoned'
  outcomeStatus: 'pending' | 'success' | 'failure'
  completed: boolean
  occurredAt?: Date
}): Promise<{ stepsMatched: number; progressed: number; ignored: number }> {
  const userId = Number(input.userId || 0)
  const anonVisitorId = String(input.anonVisitorId || '').trim()
  const messageId = Number(input.messageId || 0)
  if ((!Number.isFinite(userId) || userId <= 0) && !anonVisitorId) return { stepsMatched: 0, progressed: 0, ignored: 0 }
  if (!Number.isFinite(messageId) || messageId <= 0) return { stepsMatched: 0, progressed: 0, ignored: 0 }

  const steps = await repo.listActiveStepsByMessageId(messageId)
  if (!steps.length) return { stepsMatched: 0, progressed: 0, ignored: 0 }

  const ts = toUtcDateTimeString(input.occurredAt instanceof Date && Number.isFinite(input.occurredAt.getTime()) ? input.occurredAt : new Date())
  const goalEventKey = mapGoalEventKeyFromCtaOutcome({
    ctaIntentKey: input.ctaIntentKey,
    outcomeType: input.outcomeType,
    outcomeStatus: input.outcomeStatus,
    completed: input.completed,
  })
  let progressed = 0
  let ignored = 0

  for (const step of steps) {
    const journeyInstanceId = await ensureActiveJourneyInstanceIdForStep({
      journeyId: Number(step.journey_id),
      stepId: Number(step.id),
      userId,
      anonVisitorId,
      occurredAtTs: ts,
      source: 'cta_outcome',
      sourceMessageId: messageId,
    })
    const config = parseStepConfig((() => {
      try { return JSON.parse(String((step as any).config_json || '{}')) } catch { return {} }
    })())
    const policy = normalizeStepProgressionPolicy(config)
    const qualifiesCompletion = policyQualifiesCompletion(policy, {
      ctaSlot: input.ctaSlot == null ? null : Number(input.ctaSlot),
      ctaIntentKey: input.ctaIntentKey ? String(input.ctaIntentKey).toLowerCase() : null,
      outcomeType: input.outcomeType,
      outcomeStatus: input.outcomeStatus,
      completed: input.completed,
    })

    const nextState: MessageJourneyProgressState | null =
      qualifiesCompletion
        ? 'completed'
        : (input.outcomeType === 'click' && input.outcomeStatus === 'success' ? 'clicked' : null)

    if (goalEventKey && evaluateJourneyGoalCompletion(
      normalizeJourneyConfigForAdmin(
        (() => {
          try { return JSON.parse(String((step as any).journey_config_json || '{}')) } catch { return {} }
        })()
      ),
      goalEventKey
    )) {
      await repo.upsertJourneyInstance({
        journeyId: Number(step.journey_id),
        identityType: userId > 0 ? 'user' : 'anon',
        identityKey: userId > 0 ? String(userId) : anonVisitorId,
        state: 'completed',
        currentStepId: Number(step.id),
        completedReason: 'goal_rule_matched',
        completedEventKey: goalEventKey,
        firstSeenAt: null,
        lastSeenAt: ts,
        completedAt: ts,
        metadataJson: JSON.stringify({
          source: 'cta_outcome',
          source_message_id: messageId,
          cta_slot: input.ctaSlot ?? null,
          cta_intent_key: input.ctaIntentKey || null,
          outcome_type: input.outcomeType,
          outcome_status: input.outcomeStatus,
          goal_event_key: goalEventKey,
          last_event_at: ts,
        }),
      })
    }

    if (!nextState) {
      ignored += 1
      continue
    }

    const existing = userId > 0
      ? await repo.getProgressByUserInstanceStep(userId, Number(journeyInstanceId || 0), Number(step.id))
      : await repo.getAnonProgressByVisitorInstanceStep(anonVisitorId, Number(journeyInstanceId || 0), Number(step.id))
    if (!existing) {
      const metadataJson = JSON.stringify({
        source: 'cta_outcome',
        source_message_id: messageId,
        cta_slot: input.ctaSlot ?? null,
        cta_intent_key: input.ctaIntentKey || null,
        outcome_type: input.outcomeType,
        outcome_status: input.outcomeStatus,
        completion_contract_matched: qualifiesCompletion,
        policy: policy.kind,
        policy_slot: policy.kind === 'on_cta_slot_completion' ? policy.slot : null,
        policy_intent_key: policy.kind === 'on_intent_completion' ? policy.intentKey : null,
        last_event_at: ts,
      })
      if (userId > 0) {
        await repo.upsertProgress({
          userId,
          journeyId: Number(step.journey_id),
          journeyInstanceId,
          stepId: Number(step.id),
          state: nextState,
          firstSeenAt: null,
          lastSeenAt: ts,
          completedAt: nextState === 'completed' ? ts : null,
          completedByOutcomeId: nextState === 'completed' ? Number(input.outcomeRowId) : null,
          sessionId: input.sessionId ?? null,
          metadataJson,
        })
      } else {
        await repo.upsertAnonProgress({
          anonVisitorId,
          journeyId: Number(step.journey_id),
          journeyInstanceId,
          stepId: Number(step.id),
          state: nextState,
          firstSeenAt: null,
          lastSeenAt: ts,
          completedAt: nextState === 'completed' ? ts : null,
          completedByOutcomeId: nextState === 'completed' ? Number(input.outcomeRowId) : null,
          sessionId: input.sessionId ?? null,
          metadataJson,
        })
      }
      progressed += 1
      continue
    }

    if (!canTransition(existing.state, nextState)) {
      ignored += 1
      continue
    }

    const metadataJson = mergeMetadata(existing.metadata_json, {
      source: 'cta_outcome',
      source_message_id: messageId,
      cta_slot: input.ctaSlot ?? null,
      cta_intent_key: input.ctaIntentKey || null,
      outcome_type: input.outcomeType,
      outcome_status: input.outcomeStatus,
      completion_contract_matched: qualifiesCompletion,
      policy: policy.kind,
      policy_slot: policy.kind === 'on_cta_slot_completion' ? policy.slot : null,
      policy_intent_key: policy.kind === 'on_intent_completion' ? policy.intentKey : null,
      last_event_at: ts,
    })
    if (userId > 0) {
      await repo.updateProgressById(Number(existing.id), {
        state: nextState,
        firstSeenAt: existing.first_seen_at || null,
        lastSeenAt: ts,
        completedAt: nextState === 'completed' ? (existing.completed_at || ts) : existing.completed_at,
        completedByOutcomeId: nextState === 'completed' ? (existing.completed_by_outcome_id || Number(input.outcomeRowId)) : existing.completed_by_outcome_id,
        sessionId: input.sessionId ?? existing.session_id,
        metadataJson,
      })
    } else {
      await repo.updateAnonProgressById(Number(existing.id), {
        state: nextState,
        firstSeenAt: existing.first_seen_at || null,
        lastSeenAt: ts,
        completedAt: nextState === 'completed' ? (existing.completed_at || ts) : existing.completed_at,
        completedByOutcomeId: nextState === 'completed' ? (existing.completed_by_outcome_id || Number(input.outcomeRowId)) : existing.completed_by_outcome_id,
        sessionId: input.sessionId ?? existing.session_id,
        metadataJson,
      })
    }
    progressed += 1
  }

  return { stepsMatched: steps.length, progressed, ignored }
}

export async function mergeAnonJourneyStateIntoUserOnAuth(input: {
  userId: any
  anonVisitorId: any
}): Promise<{
  mergedJourneys: number
  mergedProgressRows: number
  skipped: boolean
}> {
  const userId = normalizePositiveInt(input?.userId, 'bad_user_id')
  const anonVisitorId = String(input?.anonVisitorId || '').trim()
  if (!anonVisitorId) return { mergedJourneys: 0, mergedProgressRows: 0, skipped: true }

  const now = toUtcDateTimeString(new Date())
  const mergedAtIso = new Date().toISOString()
  const userKey = String(userId)

  const [anonInstances, userInstances, anonProgressRows, userProgressRows] = await Promise.all([
    repo.listJourneyInstancesByIdentity({ identityType: 'anon', identityKey: anonVisitorId }),
    repo.listJourneyInstancesByIdentity({ identityType: 'user', identityKey: userKey }),
    repo.listAnonProgressByVisitor(anonVisitorId),
    repo.listProgressByUser(userId),
  ])

  const userInstanceByJourney = new Map<number, MessageJourneyInstanceRow>()
  for (const row of userInstances) {
    const journeyId = Number(row.journey_id || 0)
    if (!Number.isFinite(journeyId) || journeyId <= 0) continue
    if (!userInstanceByJourney.has(journeyId)) userInstanceByJourney.set(journeyId, row)
  }

  const anonInstanceByJourney = new Map<number, MessageJourneyInstanceRow>()
  for (const row of anonInstances) {
    const journeyId = Number(row.journey_id || 0)
    if (!Number.isFinite(journeyId) || journeyId <= 0) continue
    if (!anonInstanceByJourney.has(journeyId)) anonInstanceByJourney.set(journeyId, row)
  }

  const anonProgressByJourney = new Map<number, MessageJourneyAnonProgressRow[]>()
  for (const row of anonProgressRows) {
    const journeyId = Number(row.journey_id || 0)
    if (!Number.isFinite(journeyId) || journeyId <= 0) continue
    if (!anonProgressByJourney.has(journeyId)) anonProgressByJourney.set(journeyId, [])
    anonProgressByJourney.get(journeyId)!.push(row)
  }

  const userProgressByStep = new Map<number, MessageJourneyProgressRow>()
  for (const row of userProgressRows) {
    const stepId = Number(row.step_id || 0)
    if (!Number.isFinite(stepId) || stepId <= 0) continue
    if (!userProgressByStep.has(stepId)) userProgressByStep.set(stepId, row)
  }

  const journeyIds = new Set<number>([
    ...Array.from(anonInstanceByJourney.keys()),
    ...Array.from(anonProgressByJourney.keys()),
  ])
  const mergedUserInstanceIdByJourney = new Map<number, number>()

  let mergedJourneys = 0
  for (const journeyId of journeyIds) {
    const sourceInstance = anonInstanceByJourney.get(journeyId) || null
    const existingUserInstance = userInstanceByJourney.get(journeyId) || null
    const mergedState = existingUserInstance
      ? mergeInstanceStateByPrecedence(existingUserInstance.state, sourceInstance?.state || 'active')
      : (sourceInstance?.state || 'active')

    const mergedMetadata = {
      ...parseMetadata(existingUserInstance?.metadata_json),
      ...(sourceInstance ? parseMetadata(sourceInstance.metadata_json) : {}),
      merged_from_anon: true,
      merged_from_anon_key: anonVisitorId,
      merged_to_user_id: userId,
      merged_at: mergedAtIso,
      source: 'auth_merge',
    }

    const mergedUserInstance = await repo.upsertJourneyInstance({
      journeyId,
      identityType: 'user',
      identityKey: userKey,
      state: mergedState,
      currentStepId: existingUserInstance?.current_step_id ?? sourceInstance?.current_step_id ?? null,
      completedReason:
        existingUserInstance?.completed_reason ??
        sourceInstance?.completed_reason ??
        (mergedState === 'completed' ? 'auth_merge' : null),
      completedEventKey:
        existingUserInstance?.completed_event_key ??
        sourceInstance?.completed_event_key ??
        null,
      firstSeenAt: minDateTime(existingUserInstance?.first_seen_at || null, sourceInstance?.first_seen_at || null),
      lastSeenAt: maxDateTime(existingUserInstance?.last_seen_at || null, sourceInstance?.last_seen_at || now),
      completedAt: maxDateTime(existingUserInstance?.completed_at || null, sourceInstance?.completed_at || null),
      metadataJson: JSON.stringify(mergedMetadata),
    })
    if (Number(mergedUserInstance.id || 0) > 0) {
      mergedUserInstanceIdByJourney.set(journeyId, Number(mergedUserInstance.id))
    }

    await repo.upsertJourneyInstance({
      journeyId,
      identityType: 'anon',
      identityKey: anonVisitorId,
      state: 'abandoned',
      currentStepId: sourceInstance?.current_step_id ?? null,
      completedReason: sourceInstance?.completed_reason || 'merged_to_user',
      completedEventKey: sourceInstance?.completed_event_key || null,
      firstSeenAt: sourceInstance?.first_seen_at || null,
      lastSeenAt: now,
      completedAt: sourceInstance?.completed_at || now,
      metadataJson: JSON.stringify({
        ...parseMetadata(sourceInstance?.metadata_json),
        merged_to_user_id: userId,
        merged_at: mergedAtIso,
        source: 'auth_merge',
      }),
    })
    mergedJourneys += 1
  }

  let mergedProgressRows = 0
  for (const anonRow of anonProgressRows) {
    const stepId = Number(anonRow.step_id || 0)
    const journeyId = Number(anonRow.journey_id || 0)
    if (!Number.isFinite(stepId) || stepId <= 0) continue
    if (!Number.isFinite(journeyId) || journeyId <= 0) continue

    const userRow = userProgressByStep.get(stepId) || null
    const mergedState = preferredProgressState(anonRow, userRow)
    const mergedMetadata = {
      ...parseMetadata(userRow?.metadata_json),
      ...parseMetadata(anonRow.metadata_json),
      merged_from_anon: true,
      merged_from_anon_key: anonVisitorId,
      merged_to_user_id: userId,
      merged_at: mergedAtIso,
      source: 'auth_merge',
    }

    const upserted = await repo.upsertProgress({
      userId,
      journeyId,
      journeyInstanceId:
        mergedUserInstanceIdByJourney.get(journeyId) ||
        (userRow?.journey_instance_id != null ? Number(userRow.journey_instance_id) : null),
      stepId,
      state: mergedState,
      firstSeenAt: minDateTime(userRow?.first_seen_at || null, anonRow.first_seen_at || null),
      lastSeenAt: maxDateTime(userRow?.last_seen_at || null, anonRow.last_seen_at || now),
      completedAt: maxDateTime(userRow?.completed_at || null, anonRow.completed_at || null),
      completedByOutcomeId: userRow?.completed_by_outcome_id ?? anonRow.completed_by_outcome_id ?? null,
      sessionId: userRow?.session_id ?? anonRow.session_id ?? null,
      metadataJson: JSON.stringify(mergedMetadata),
    })
    userProgressByStep.set(stepId, upserted)

    await repo.updateAnonProgressById(Number(anonRow.id), {
      metadataJson: JSON.stringify({
        ...parseMetadata(anonRow.metadata_json),
        merged_to_user_id: userId,
        merged_at: mergedAtIso,
        source: 'auth_merge',
      }),
    })
    mergedProgressRows += 1
  }

  return { mergedJourneys, mergedProgressRows, skipped: false }
}
