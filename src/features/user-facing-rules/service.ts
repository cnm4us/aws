import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import type { UserFacingRuleDto, UserFacingRuleMappingDto, UserFacingRuleRow, UserFacingRuleMappingRow } from './types'

function normalizeLabel(raw: any): string {
  const value = String(raw ?? '').trim()
  if (!value || value.length > 255) throw new DomainError('invalid_label', 'invalid_label', 400)
  return value
}

function normalizeOptionalString(raw: any, field: string, max: number): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (value.length > max) throw new DomainError(`invalid_${field}`, `invalid_${field}`, 400)
  return value
}

function normalizeInt(raw: any, field: string, fallback = 0): number {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new DomainError(`invalid_${field}`, `invalid_${field}`, 400)
  return Math.round(n)
}

function normalizeBool(raw: any, fallback = false): boolean {
  if (raw === undefined || raw === null || raw === '') return fallback
  if (typeof raw === 'boolean') return raw
  const text = String(raw).trim().toLowerCase()
  return text === '1' || text === 'true' || text === 'yes' || text === 'on'
}

function normalizeId(raw: any, field: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError(`invalid_${field}`, `invalid_${field}`, 400)
  return Math.round(n)
}

function toRuleDto(row: UserFacingRuleRow): UserFacingRuleDto {
  return {
    id: Number(row.id),
    label: String(row.label || ''),
    shortDescription: row.short_description == null ? null : String(row.short_description),
    groupKey: row.group_key == null ? null : String(row.group_key),
    groupLabel: row.group_label == null ? null : String(row.group_label),
    groupOrder: Number(row.group_order || 0),
    displayOrder: Number(row.display_order || 0),
    isActive: Number(row.is_active || 0) === 1,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

function toMappingDto(row: UserFacingRuleMappingRow): UserFacingRuleMappingDto {
  return {
    id: Number(row.id),
    userFacingRuleId: Number(row.user_facing_rule_id),
    ruleId: Number(row.rule_id),
    priority: Number(row.priority || 100),
    isDefault: Number(row.is_default || 0) === 1,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

async function ensureActor(actorUserId: number): Promise<number> {
  const uid = Number(actorUserId)
  if (!Number.isFinite(uid) || uid <= 0) throw new ForbiddenError('forbidden')
  return Math.round(uid)
}

async function ensureRuleExists(id: number): Promise<void> {
  const options = await repo.listRuleOptions()
  if (!options.some((r) => Number(r.id) === Number(id))) throw new DomainError('invalid_rule_id', 'invalid_rule_id', 400)
}

export async function listUserFacingRulesForAdmin(params?: {
  includeInactive?: boolean
  limit?: number
}): Promise<Array<UserFacingRuleDto & { mappingCount: number; defaultMappingCount: number }>> {
  const rows = await repo.listRules(params)
  const out: Array<UserFacingRuleDto & { mappingCount: number; defaultMappingCount: number }> = []
  for (const row of rows) {
    const mappings = await repo.listMappingsByRuleId(Number(row.id))
    out.push({
      ...toRuleDto(row),
      mappingCount: mappings.length,
      defaultMappingCount: mappings.filter((m) => Number(m.is_default || 0) === 1).length,
    })
  }
  return out
}

export async function getUserFacingRuleForAdmin(id: number): Promise<UserFacingRuleDto & { mappings: UserFacingRuleMappingDto[] }> {
  const ruleId = normalizeId(id, 'id')
  const row = await repo.getRuleById(ruleId)
  if (!row) throw new NotFoundError('user_facing_rule_not_found')
  const mappings = (await repo.listMappingsByRuleId(ruleId)).map(toMappingDto)
  return { ...toRuleDto(row), mappings }
}

export async function createUserFacingRuleForAdmin(input: any, actorUserId: number): Promise<UserFacingRuleDto> {
  await ensureActor(actorUserId)
  const row = await repo.createRule({
    label: normalizeLabel(input?.label),
    shortDescription: normalizeOptionalString(input?.shortDescription ?? input?.short_description, 'short_description', 500),
    groupKey: normalizeOptionalString(input?.groupKey ?? input?.group_key, 'group_key', 64),
    groupLabel: normalizeOptionalString(input?.groupLabel ?? input?.group_label, 'group_label', 128),
    groupOrder: normalizeInt(input?.groupOrder ?? input?.group_order, 'group_order', 0),
    displayOrder: normalizeInt(input?.displayOrder ?? input?.display_order, 'display_order', 0),
    isActive: normalizeBool(input?.isActive ?? input?.is_active, true),
  })
  return toRuleDto(row)
}

export async function updateUserFacingRuleForAdmin(id: number, patch: any, actorUserId: number): Promise<UserFacingRuleDto> {
  await ensureActor(actorUserId)
  const ruleId = normalizeId(id, 'id')
  const existing = await repo.getRuleById(ruleId)
  if (!existing) throw new NotFoundError('user_facing_rule_not_found')
  const row = await repo.updateRule(ruleId, {
    label: patch?.label !== undefined ? normalizeLabel(patch.label) : undefined,
    shortDescription:
      patch?.shortDescription !== undefined || patch?.short_description !== undefined
        ? normalizeOptionalString(patch?.shortDescription ?? patch?.short_description, 'short_description', 500)
        : undefined,
    groupKey:
      patch?.groupKey !== undefined || patch?.group_key !== undefined
        ? normalizeOptionalString(patch?.groupKey ?? patch?.group_key, 'group_key', 64)
        : undefined,
    groupLabel:
      patch?.groupLabel !== undefined || patch?.group_label !== undefined
        ? normalizeOptionalString(patch?.groupLabel ?? patch?.group_label, 'group_label', 128)
        : undefined,
    groupOrder:
      patch?.groupOrder !== undefined || patch?.group_order !== undefined
        ? normalizeInt(patch?.groupOrder ?? patch?.group_order, 'group_order', 0)
        : undefined,
    displayOrder:
      patch?.displayOrder !== undefined || patch?.display_order !== undefined
        ? normalizeInt(patch?.displayOrder ?? patch?.display_order, 'display_order', 0)
        : undefined,
    isActive:
      patch?.isActive !== undefined || patch?.is_active !== undefined
        ? normalizeBool(patch?.isActive ?? patch?.is_active, true)
        : undefined,
  })
  return toRuleDto(row)
}

export async function deleteUserFacingRuleForAdmin(id: number, actorUserId: number): Promise<void> {
  await ensureActor(actorUserId)
  const ruleId = normalizeId(id, 'id')
  const mappings = await repo.listMappingsByRuleId(ruleId)
  for (const mapping of mappings) {
    await repo.removeMapping(Number(mapping.id))
  }
  const removed = await repo.removeRule(ruleId)
  if (!removed) throw new NotFoundError('user_facing_rule_not_found')
}

export async function upsertMappingForAdmin(
  userFacingRuleIdRaw: number,
  input: any,
  actorUserId: number
): Promise<UserFacingRuleMappingDto> {
  await ensureActor(actorUserId)
  const userFacingRuleId = normalizeId(userFacingRuleIdRaw, 'user_facing_rule_id')
  const parent = await repo.getRuleById(userFacingRuleId)
  if (!parent) throw new NotFoundError('user_facing_rule_not_found')

  const mappingId = input?.id != null && input?.id !== '' ? normalizeId(input.id, 'mapping_id') : null
  const ruleId = normalizeId(input?.ruleId ?? input?.rule_id, 'rule_id')
  const priority = normalizeInt(input?.priority, 'priority', 100)
  const isDefault = normalizeBool(input?.isDefault ?? input?.is_default, false)

  await ensureRuleExists(ruleId)

  let row: UserFacingRuleMappingRow
  if (mappingId) {
    const existing = await repo.getMappingById(mappingId)
    if (!existing || Number(existing.user_facing_rule_id) !== userFacingRuleId) {
      throw new NotFoundError('user_facing_rule_mapping_not_found')
    }
    row = await repo.updateMapping(mappingId, { ruleId, priority, isDefault })
  } else {
    const existingPair = await repo.getMappingByRulePair(userFacingRuleId, ruleId)
    row = existingPair
      ? await repo.updateMapping(Number(existingPair.id), { priority, isDefault })
      : await repo.createMapping({ userFacingRuleId, ruleId, priority, isDefault })
  }

  if (isDefault) {
    await repo.clearDefaultMappings(userFacingRuleId, Number(row.id))
    row = (await repo.getMappingById(Number(row.id))) as UserFacingRuleMappingRow
  }
  return toMappingDto(row)
}

export async function replaceMappingsForAdmin(
  userFacingRuleIdRaw: number,
  mappingsRaw: any[],
  actorUserId: number
): Promise<UserFacingRuleMappingDto[]> {
  await ensureActor(actorUserId)
  const userFacingRuleId = normalizeId(userFacingRuleIdRaw, 'user_facing_rule_id')
  const parent = await repo.getRuleById(userFacingRuleId)
  if (!parent) throw new NotFoundError('user_facing_rule_not_found')
  const mappings = Array.isArray(mappingsRaw) ? mappingsRaw : []
  const normalized = mappings.map((entry) => ({
    ruleId: normalizeId(entry?.ruleId ?? entry?.rule_id, 'rule_id'),
    priority: normalizeInt(entry?.priority, 'priority', 100),
    isDefault: normalizeBool(entry?.isDefault ?? entry?.is_default, false),
  }))
  const defaultCount = normalized.filter((m) => m.isDefault).length
  if (defaultCount > 1) throw new DomainError('invalid_multiple_defaults', 'invalid_multiple_defaults', 400)
  for (const item of normalized) await ensureRuleExists(item.ruleId)

  const existing = await repo.listMappingsByRuleId(userFacingRuleId)
  const keepRuleIds = new Set<number>(normalized.map((n) => n.ruleId))
  for (const row of existing) {
    if (!keepRuleIds.has(Number(row.rule_id))) await repo.removeMapping(Number(row.id))
  }
  for (const item of normalized) {
    await upsertMappingForAdmin(userFacingRuleId, item, actorUserId)
  }
  return (await repo.listMappingsByRuleId(userFacingRuleId)).map(toMappingDto)
}

export async function deleteMappingForAdmin(userFacingRuleIdRaw: number, mappingIdRaw: number, actorUserId: number): Promise<void> {
  await ensureActor(actorUserId)
  const userFacingRuleId = normalizeId(userFacingRuleIdRaw, 'user_facing_rule_id')
  const mappingId = normalizeId(mappingIdRaw, 'mapping_id')
  const existing = await repo.getMappingById(mappingId)
  if (!existing || Number(existing.user_facing_rule_id) !== userFacingRuleId) {
    throw new NotFoundError('user_facing_rule_mapping_not_found')
  }
  const removed = await repo.removeMapping(mappingId)
  if (!removed) throw new NotFoundError('user_facing_rule_mapping_not_found')
}

export async function listCanonicalRuleOptionsForAdmin() {
  return repo.listRuleOptions()
}
