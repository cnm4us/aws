import * as repo from './repo'
import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import { getPool } from '../../db'
import type {
  MessageJourneyDto,
  MessageJourneyProgressState,
  MessageJourneyRow,
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

const JOURNEY_STATUS_VALUES: readonly MessageJourneyStatus[] = ['draft', 'active', 'archived']
const STEP_STATUS_VALUES: readonly MessageJourneyStepStatus[] = ['draft', 'active', 'archived']
const JOURNEY_SURFACE_VALUES = ['global_feed', 'group_feed', 'channel_feed'] as const
type JourneySurface = (typeof JOURNEY_SURFACE_VALUES)[number]
const TARGETING_MODE_VALUES = ['all', 'selected'] as const

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
  return {
    id: Number(row.id),
    journeyKey: String(row.journey_key || ''),
    name: String(row.name || ''),
    appliesToSurface,
    surfaceTargeting,
    status: normalizeJourneyStatus(row.status),
    description: row.description == null ? null : String(row.description),
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

  const row = await repo.createJourney({
    journeyKey: normalizeJourneyKey(input?.journeyKey ?? input?.journey_key),
    name: normalizeJourneyName(input?.name),
    appliesToSurface,
    surfaceTargeting,
    status: normalizeJourneyStatus(input?.status, 'draft'),
    description: normalizeDescription(input?.description),
    eligibilityRulesetId: normalizeNullablePositiveInt(input?.eligibilityRulesetId ?? input?.eligibility_ruleset_id, 'invalid_ruleset_id'),
    createdBy: userId,
    updatedBy: userId,
  })
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

  const row = await repo.updateJourney(journeyId, {
    journeyKey:
      patch?.journeyKey !== undefined || patch?.journey_key !== undefined
        ? normalizeJourneyKey(patch?.journeyKey ?? patch?.journey_key)
        : existingDto.journeyKey,
    name: patch?.name !== undefined ? normalizeJourneyName(patch?.name) : existingDto.name,
    appliesToSurface: nextAppliesToSurface,
    surfaceTargeting: nextSurfaceTargeting,
    status: patch?.status !== undefined ? normalizeJourneyStatus(patch?.status, existingDto.status) : existingDto.status,
    description: patch?.description !== undefined ? normalizeDescription(patch?.description) : existingDto.description,
    eligibilityRulesetId:
      patch?.eligibilityRulesetId !== undefined || patch?.eligibility_ruleset_id !== undefined
        ? normalizeNullablePositiveInt(patch?.eligibilityRulesetId ?? patch?.eligibility_ruleset_id, 'invalid_ruleset_id')
        : existingDto.eligibilityRulesetId,
    updatedBy: userId,
  })
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

export async function recordJourneySignalFromMessageEvent(input: {
  userId: number | null
  messageId: number
  event: MessageJourneySignalEvent
  sessionId?: string | null
  occurredAt?: Date
}): Promise<{ stepsMatched: number; progressed: number; ignored: number }> {
  const userId = Number(input.userId || 0)
  const messageId = Number(input.messageId || 0)
  if (!Number.isFinite(userId) || userId <= 0) {
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
    const existing = await repo.getProgressByUserStep(userId, Number(step.id))
    if (!existing) {
      const metadata = JSON.stringify({
        source: 'message_event',
        source_event: input.event,
        source_message_id: messageId,
        last_event_at: ts,
      })
      await repo.upsertProgress({
        userId,
        journeyId: Number(step.journey_id),
        stepId: Number(step.id),
        state: eventState,
        firstSeenAt: eventState === 'shown' ? ts : null,
        lastSeenAt: ts,
        completedAt: eventState === 'completed' ? ts : null,
        sessionId: input.sessionId ?? null,
        metadataJson: metadata,
      })
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

    await repo.updateProgressById(Number(existing.id), {
      state: to,
      firstSeenAt: existing.first_seen_at || (to === 'shown' ? ts : null),
      lastSeenAt: ts,
      completedAt: to === 'completed' ? (existing.completed_at || ts) : existing.completed_at,
      sessionId: input.sessionId ?? existing.session_id,
      metadataJson,
    })
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
  const messageId = Number(input.messageId || 0)
  if (!Number.isFinite(userId) || userId <= 0) return { stepsMatched: 0, progressed: 0, ignored: 0 }
  if (!Number.isFinite(messageId) || messageId <= 0) return { stepsMatched: 0, progressed: 0, ignored: 0 }

  const steps = await repo.listActiveStepsByMessageId(messageId)
  if (!steps.length) return { stepsMatched: 0, progressed: 0, ignored: 0 }

  const ts = toUtcDateTimeString(input.occurredAt instanceof Date && Number.isFinite(input.occurredAt.getTime()) ? input.occurredAt : new Date())
  let progressed = 0
  let ignored = 0

  for (const step of steps) {
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

    if (!nextState) {
      ignored += 1
      continue
    }

    const existing = await repo.getProgressByUserStep(userId, Number(step.id))
    if (!existing) {
      await repo.upsertProgress({
        userId,
        journeyId: Number(step.journey_id),
        stepId: Number(step.id),
        state: nextState,
        firstSeenAt: null,
        lastSeenAt: ts,
        completedAt: nextState === 'completed' ? ts : null,
        completedByOutcomeId: nextState === 'completed' ? Number(input.outcomeRowId) : null,
        sessionId: input.sessionId ?? null,
        metadataJson: JSON.stringify({
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
        }),
      })
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
    await repo.updateProgressById(Number(existing.id), {
      state: nextState,
      firstSeenAt: existing.first_seen_at || null,
      lastSeenAt: ts,
      completedAt: nextState === 'completed' ? (existing.completed_at || ts) : existing.completed_at,
      completedByOutcomeId: nextState === 'completed' ? (existing.completed_by_outcome_id || Number(input.outcomeRowId)) : existing.completed_by_outcome_id,
      sessionId: input.sessionId ?? existing.session_id,
      metadataJson,
    })
    progressed += 1
  }

  return { stepsMatched: steps.length, progressed, ignored }
}
