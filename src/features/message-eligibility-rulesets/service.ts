import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import type {
  MessageEligibilityCriteria,
  MessageEligibilityRulesetDto,
  MessageEligibilityRulesetRow,
  MessageEligibilityRulesetStatus,
} from './types'
import { normalizeEligibilityCriteria } from './validate'

const STATUSES: readonly MessageEligibilityRulesetStatus[] = ['draft', 'active', 'archived']

function isEnumValue<T extends string>(value: any, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function normalizeName(raw: any): string {
  const value = String(raw ?? '').trim()
  if (!value) throw new DomainError('invalid_name', 'invalid_name', 400)
  if (value.length > 120) throw new DomainError('invalid_name', 'invalid_name', 400)
  return value
}

function normalizeDescription(raw: any): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (value.length > 500) throw new DomainError('invalid_description', 'invalid_description', 400)
  return value
}

function normalizeStatus(raw: any, fallback: MessageEligibilityRulesetStatus = 'draft'): MessageEligibilityRulesetStatus {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, STATUSES)) throw new DomainError('invalid_status', 'invalid_status', 400)
  return value
}

function parseCriteriaRaw(raw: any): MessageEligibilityCriteria {
  if (raw == null || raw === '') {
    return {
      version: 1,
      inclusion: [],
      exclusion: [],
    }
  }
  return normalizeEligibilityCriteria(raw)
}

function parseCriteriaJsonSafe(raw: any): MessageEligibilityCriteria {
  try {
    return normalizeEligibilityCriteria(raw)
  } catch {
    return {
      version: 1,
      inclusion: [],
      exclusion: [],
    }
  }
}

function toDto(row: MessageEligibilityRulesetRow): MessageEligibilityRulesetDto {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    status: normalizeStatus(row.status),
    description: row.description == null ? null : String(row.description),
    criteria: parseCriteriaJsonSafe((row as any).criteria_json),
    createdBy: Number(row.created_by || 0),
    updatedBy: Number(row.updated_by || 0),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

export async function listRulesetsForAdmin(params?: {
  limit?: number
  includeArchived?: boolean
  status?: any
}): Promise<MessageEligibilityRulesetDto[]> {
  const status = params?.status == null || params?.status === '' ? null : normalizeStatus(params.status)
  const rows = await repo.list({
    limit: params?.limit,
    includeArchived: params?.includeArchived,
    status,
  })
  return rows.map(toDto)
}

export async function getRulesetForAdmin(id: number): Promise<MessageEligibilityRulesetDto> {
  const rulesetId = Number(id)
  if (!Number.isFinite(rulesetId) || rulesetId <= 0) throw new DomainError('bad_id', 'bad_id', 400)
  const row = await repo.getById(rulesetId)
  if (!row) throw new NotFoundError('message_eligibility_ruleset_not_found')
  return toDto(row)
}

export async function createRulesetForAdmin(input: any, actorUserId: number): Promise<MessageEligibilityRulesetDto> {
  const userId = Number(actorUserId)
  if (!Number.isFinite(userId) || userId <= 0) throw new ForbiddenError('forbidden')

  const criteria = parseCriteriaRaw(input?.criteria ?? input?.criteria_json)
  const row = await repo.create({
    name: normalizeName(input?.name),
    status: normalizeStatus(input?.status, 'draft'),
    description: normalizeDescription(input?.description),
    criteriaJson: JSON.stringify(criteria),
    createdBy: userId,
    updatedBy: userId,
  })
  return toDto(row)
}

export async function updateRulesetForAdmin(id: number, patch: any, actorUserId: number): Promise<MessageEligibilityRulesetDto> {
  const userId = Number(actorUserId)
  if (!Number.isFinite(userId) || userId <= 0) throw new ForbiddenError('forbidden')
  const rulesetId = Number(id)
  if (!Number.isFinite(rulesetId) || rulesetId <= 0) throw new DomainError('bad_id', 'bad_id', 400)

  const existing = await repo.getById(rulesetId)
  if (!existing) throw new NotFoundError('message_eligibility_ruleset_not_found')
  const existingDto = toDto(existing)

  const nextName =
    patch?.name !== undefined ? normalizeName(patch.name) : existingDto.name
  const nextStatus =
    patch?.status !== undefined ? normalizeStatus(patch.status, existingDto.status) : existingDto.status
  const nextDescription =
    patch?.description !== undefined ? normalizeDescription(patch.description) : existingDto.description
  const nextCriteria =
    patch?.criteria !== undefined || patch?.criteria_json !== undefined
      ? parseCriteriaRaw(patch?.criteria ?? patch?.criteria_json)
      : existingDto.criteria

  const row = await repo.update(rulesetId, {
    name: nextName,
    status: nextStatus,
    description: nextDescription,
    criteriaJson: JSON.stringify(nextCriteria),
    updatedBy: userId,
  })
  return toDto(row)
}

export async function deleteRulesetForAdmin(id: number, actorUserId: number): Promise<void> {
  const userId = Number(actorUserId)
  if (!Number.isFinite(userId) || userId <= 0) throw new ForbiddenError('forbidden')
  const rulesetId = Number(id)
  if (!Number.isFinite(rulesetId) || rulesetId <= 0) throw new DomainError('bad_id', 'bad_id', 400)

  const existing = await repo.getById(rulesetId)
  if (!existing) throw new NotFoundError('message_eligibility_ruleset_not_found')
  const removed = await repo.remove(rulesetId)
  if (!removed) throw new NotFoundError('message_eligibility_ruleset_not_found')
}

export async function listActiveRulesetsById(ids: number[]): Promise<Map<number, MessageEligibilityRulesetDto>> {
  const rows = await repo.listByIds(ids)
  const out = new Map<number, MessageEligibilityRulesetDto>()
  for (const row of rows) {
    if (normalizeStatus(row.status) !== 'active') continue
    const dto = toDto(row)
    out.set(dto.id, dto)
  }
  return out
}
