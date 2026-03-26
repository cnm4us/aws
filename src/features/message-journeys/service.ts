import * as repo from './repo'
import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
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

function toJourneyDto(row: MessageJourneyRow): MessageJourneyDto {
  return {
    id: Number(row.id),
    journeyKey: String(row.journey_key || ''),
    name: String(row.name || ''),
    status: normalizeJourneyStatus(row.status),
    description: row.description == null ? null : String(row.description),
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
    rulesetId: row.ruleset_id == null ? null : Number(row.ruleset_id),
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
  return rows.map(toJourneyDto)
}

export async function getJourneyForAdmin(id: number): Promise<MessageJourneyDto> {
  const journeyId = normalizePositiveInt(id, 'bad_id')
  const row = await repo.getJourneyById(journeyId)
  if (!row) throw new NotFoundError('message_journey_not_found')
  return toJourneyDto(row)
}

export async function createJourneyForAdmin(input: any, actorUserId: number): Promise<MessageJourneyDto> {
  const userId = normalizeActorUserId(actorUserId)

  const row = await repo.createJourney({
    journeyKey: normalizeJourneyKey(input?.journeyKey ?? input?.journey_key),
    name: normalizeJourneyName(input?.name),
    status: normalizeJourneyStatus(input?.status, 'draft'),
    description: normalizeDescription(input?.description),
    createdBy: userId,
    updatedBy: userId,
  })
  return toJourneyDto(row)
}

export async function updateJourneyForAdmin(id: number, patch: any, actorUserId: number): Promise<MessageJourneyDto> {
  const userId = normalizeActorUserId(actorUserId)
  const journeyId = normalizePositiveInt(id, 'bad_id')
  const existing = await repo.getJourneyById(journeyId)
  if (!existing) throw new NotFoundError('message_journey_not_found')
  const existingDto = toJourneyDto(existing)

  const row = await repo.updateJourney(journeyId, {
    journeyKey:
      patch?.journeyKey !== undefined || patch?.journey_key !== undefined
        ? normalizeJourneyKey(patch?.journeyKey ?? patch?.journey_key)
        : existingDto.journeyKey,
    name: patch?.name !== undefined ? normalizeJourneyName(patch?.name) : existingDto.name,
    status: patch?.status !== undefined ? normalizeJourneyStatus(patch?.status, existingDto.status) : existingDto.status,
    description: patch?.description !== undefined ? normalizeDescription(patch?.description) : existingDto.description,
    updatedBy: userId,
  })
  return toJourneyDto(row)
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

  const row = await repo.createStep({
    journeyId,
    stepKey: normalizeStepKey(input?.stepKey ?? input?.step_key),
    stepOrder: normalizePositiveInt(input?.stepOrder ?? input?.step_order, 'invalid_step_order'),
    messageId: normalizePositiveInt(input?.messageId ?? input?.message_id, 'invalid_message_id'),
    rulesetId: normalizeNullablePositiveInt(input?.rulesetId ?? input?.ruleset_id, 'invalid_ruleset_id'),
    status: normalizeStepStatus(input?.status, 'draft'),
    configJson: JSON.stringify(parseConfig(input?.config ?? input?.config_json)),
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
    rulesetId:
      patch?.rulesetId !== undefined || patch?.ruleset_id !== undefined
        ? normalizeNullablePositiveInt(patch?.rulesetId ?? patch?.ruleset_id, 'invalid_ruleset_id')
        : existing.rulesetId,
    status: patch?.status !== undefined ? normalizeStepStatus(patch?.status, existing.status) : existing.status,
    configJson:
      patch?.config !== undefined || patch?.config_json !== undefined
        ? JSON.stringify(parseConfig(patch?.config ?? patch?.config_json))
        : JSON.stringify(existing.config || {}),
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
