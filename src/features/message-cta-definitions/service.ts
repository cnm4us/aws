import { context, trace } from '@opentelemetry/api'
import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import { getPool } from '../../db'
import { getLogger } from '../../lib/logger'
import { PERM } from '../../security/perm'
import { can } from '../../security/permissions'
import * as repo from './repo'
import type {
  MessageCtaApiActionConfig,
  MessageCtaDefinitionConfig,
  MessageCtaDefinitionDto,
  MessageCtaDefinitionRow,
  MessageCtaDefinitionStatus,
  MessageCtaExecutorType,
  MessageCtaIntentKey,
  MessageCtaInternalLinkConfig,
  MessageCtaProvider,
  MessageCtaProviderCheckoutConfig,
  MessageCtaRuntimeResolution,
  MessageCtaScopeType,
  MessageCtaVerificationFlowConfig,
} from './types'

const ctaLogger = getLogger({ component: 'features.message-cta-definitions' })

const STATUSES: readonly MessageCtaDefinitionStatus[] = ['draft', 'active', 'archived']
const SCOPE_TYPES: readonly MessageCtaScopeType[] = ['global', 'space']
const INTENT_KEYS: readonly MessageCtaIntentKey[] = [
  'login',
  'register',
  'donate',
  'subscribe',
  'upgrade',
  'verify_email',
  'verify_phone',
  'visit_sponsor',
  'visit_link',
]
const EXECUTOR_TYPES: readonly MessageCtaExecutorType[] = ['internal_link', 'provider_checkout', 'verification_flow', 'api_action']
const PROVIDERS: readonly MessageCtaProvider[] = ['mock', 'paypal', 'stripe', 'square']

function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function normalizeName(raw: unknown): string {
  const value = String(raw ?? '').trim()
  if (!value) throw new DomainError('invalid_name', 'invalid_name', 400)
  if (value.length > 120) throw new DomainError('invalid_name', 'invalid_name', 400)
  return value
}

function normalizeLabel(raw: unknown): string {
  const value = String(raw ?? '').trim()
  if (!value) throw new DomainError('invalid_label_default', 'invalid_label_default', 400)
  if (value.length > 100) throw new DomainError('invalid_label_default', 'invalid_label_default', 400)
  return value
}

function normalizeStatus(raw: unknown, fallback: MessageCtaDefinitionStatus = 'draft'): MessageCtaDefinitionStatus {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, STATUSES)) throw new DomainError('invalid_status', 'invalid_status', 400)
  return value
}

function normalizeScopeType(raw: unknown, fallback: MessageCtaScopeType = 'global'): MessageCtaScopeType {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, SCOPE_TYPES)) throw new DomainError('invalid_scope_type', 'invalid_scope_type', 400)
  return value
}

function normalizeScopeSpaceId(raw: unknown, scopeType: MessageCtaScopeType): number | null {
  if (scopeType === 'global') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new DomainError('invalid_scope_space_id', 'invalid_scope_space_id', 400)
  return Math.round(value)
}

function normalizeIntentKey(raw: unknown, fallback: MessageCtaIntentKey = 'visit_link'): MessageCtaIntentKey {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, INTENT_KEYS)) throw new DomainError('invalid_intent_key', 'invalid_intent_key', 400)
  return value
}

function normalizeExecutorType(raw: unknown, fallback: MessageCtaExecutorType = 'internal_link'): MessageCtaExecutorType {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, EXECUTOR_TYPES)) throw new DomainError('invalid_executor_type', 'invalid_executor_type', 400)
  return value
}

function normalizePathLike(raw: unknown, key: string): string {
  const value = String(raw ?? '').trim()
  if (!value) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  if (value.length > 1200) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  if (!value.startsWith('/')) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  if (value.startsWith('//')) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  if (/\s/.test(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return value
}

function normalizeOptionalPathLike(raw: unknown, key: string): string | null {
  if (raw == null || raw === '') return null
  return normalizePathLike(raw, key)
}

function normalizeNullableKey(raw: unknown, key: string): string | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return null
  if (value.length > 64) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  if (!/^[a-z0-9_-]+$/.test(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return value
}

function normalizeBool(raw: unknown, fallback = false): boolean {
  if (raw == null || raw === '') return fallback
  if (typeof raw === 'boolean') return raw
  const value = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return fallback
}

function parseConfig(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid')
      }
      return parsed as Record<string, unknown>
    } catch {
      throw new DomainError('invalid_config_json', 'invalid_config_json', 400)
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  throw new DomainError('invalid_config_json', 'invalid_config_json', 400)
}

function validateIntentExecutor(intentKey: MessageCtaIntentKey, executorType: MessageCtaExecutorType): void {
  if (intentKey === 'login' || intentKey === 'register') {
    if (executorType !== 'internal_link' && executorType !== 'verification_flow') {
      throw new DomainError('invalid_intent_executor_pair', 'invalid_intent_executor_pair', 400)
    }
    return
  }

  if (intentKey === 'donate' || intentKey === 'subscribe' || intentKey === 'upgrade') {
    if (executorType !== 'provider_checkout' && executorType !== 'internal_link') {
      throw new DomainError('invalid_intent_executor_pair', 'invalid_intent_executor_pair', 400)
    }
    return
  }

  if (intentKey === 'verify_email' || intentKey === 'verify_phone') {
    if (executorType !== 'verification_flow' && executorType !== 'api_action') {
      throw new DomainError('invalid_intent_executor_pair', 'invalid_intent_executor_pair', 400)
    }
    return
  }
}

function normalizeInternalLinkConfig(configRaw: Record<string, unknown>): MessageCtaInternalLinkConfig {
  return {
    href: normalizePathLike(configRaw.href, 'href'),
    successReturn: normalizeOptionalPathLike(configRaw.successReturn, 'success_return'),
    openInNewTab: normalizeBool(configRaw.openInNewTab, false),
  }
}

function normalizeProviderCheckoutConfig(configRaw: Record<string, unknown>, intentKey: MessageCtaIntentKey): MessageCtaProviderCheckoutConfig {
  const provider = String(configRaw.provider ?? '').trim().toLowerCase()
  if (!isEnumValue(provider, PROVIDERS)) {
    throw new DomainError('invalid_provider', 'invalid_provider', 400)
  }

  const mode = String(configRaw.mode ?? '').trim().toLowerCase()
  if (mode !== 'donate' && mode !== 'subscribe' && mode !== 'upgrade') {
    throw new DomainError('invalid_mode', 'invalid_mode', 400)
  }

  if ((intentKey === 'donate' && mode !== 'donate') || (intentKey === 'subscribe' && mode !== 'subscribe') || (intentKey === 'upgrade' && mode !== 'upgrade')) {
    throw new DomainError('invalid_mode_for_intent', 'invalid_mode_for_intent', 400)
  }

  return {
    provider,
    mode,
    returnUrl: normalizePathLike(configRaw.returnUrl, 'return_url'),
    cancelUrl: normalizeOptionalPathLike(configRaw.cancelUrl, 'cancel_url'),
    campaignKey: normalizeNullableKey(configRaw.campaignKey, 'campaign_key'),
    planKey: normalizeNullableKey(configRaw.planKey, 'plan_key'),
  }
}

function normalizeVerificationFlowConfig(configRaw: Record<string, unknown>, intentKey: MessageCtaIntentKey): MessageCtaVerificationFlowConfig {
  const method = String(configRaw.method ?? '').trim().toLowerCase()
  if (method !== 'email' && method !== 'phone' && method !== 'identity') {
    throw new DomainError('invalid_method', 'invalid_method', 400)
  }

  if (intentKey === 'verify_email' && method !== 'email') {
    throw new DomainError('invalid_method_for_intent', 'invalid_method_for_intent', 400)
  }
  if (intentKey === 'verify_phone' && method !== 'phone') {
    throw new DomainError('invalid_method_for_intent', 'invalid_method_for_intent', 400)
  }

  return {
    method,
    startPath: normalizePathLike(configRaw.startPath, 'start_path'),
    successReturn: normalizeOptionalPathLike(configRaw.successReturn, 'success_return'),
  }
}

function normalizeApiActionConfig(configRaw: Record<string, unknown>): MessageCtaApiActionConfig {
  const method = String(configRaw.httpMethod ?? 'POST').trim().toUpperCase()
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new DomainError('invalid_http_method', 'invalid_http_method', 400)
  }

  return {
    endpointPath: normalizePathLike(configRaw.endpointPath, 'endpoint_path'),
    httpMethod: method as MessageCtaApiActionConfig['httpMethod'],
    successReturn: normalizeOptionalPathLike(configRaw.successReturn, 'success_return'),
  }
}

function normalizeConfigForExecutor(
  executorType: MessageCtaExecutorType,
  configRaw: Record<string, unknown>,
  intentKey: MessageCtaIntentKey
): MessageCtaDefinitionConfig {
  switch (executorType) {
    case 'internal_link':
      return normalizeInternalLinkConfig(configRaw)
    case 'provider_checkout':
      return normalizeProviderCheckoutConfig(configRaw, intentKey)
    case 'verification_flow':
      return normalizeVerificationFlowConfig(configRaw, intentKey)
    case 'api_action':
      return normalizeApiActionConfig(configRaw)
    default:
      throw new DomainError('invalid_executor_type', 'invalid_executor_type', 400)
  }
}

function parseConfigJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }

  const value = String(raw ?? '').trim()
  if (!value) return {}

  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function toDto(row: MessageCtaDefinitionRow): MessageCtaDefinitionDto {
  const intentKey = normalizeIntentKey(row.intent_key)
  const executorType = normalizeExecutorType(row.executor_type)
  const configRaw = parseConfigJson((row as any).config_json)
  const config = normalizeConfigForExecutor(executorType, configRaw, intentKey)

  return {
    id: Number(row.id),
    name: normalizeName(row.name),
    status: normalizeStatus(row.status),
    scopeType: normalizeScopeType(row.scope_type),
    scopeSpaceId: row.scope_space_id == null ? null : Number(row.scope_space_id),
    intentKey,
    executorType,
    labelDefault: normalizeLabel(row.label_default),
    config,
    createdBy: Number(row.created_by),
    updatedBy: Number(row.updated_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

async function listManageableSpaceIds(actorUserId: number): Promise<number[]> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT DISTINCT s.id
       FROM spaces s
       LEFT JOIN user_space_roles usr ON usr.space_id = s.id AND usr.user_id = ?
       LEFT JOIN roles r ON r.id = usr.role_id
      WHERE s.owner_user_id = ?
         OR r.name IN ('space_admin', 'group_admin', 'channel_admin')`,
    [actorUserId, actorUserId]
  )
  return (rows as any[])
    .map((row) => Number(row.id))
    .filter((value) => Number.isFinite(value) && value > 0)
}

async function hasScopeAccess(actorUserId: number, scopeType: MessageCtaScopeType, scopeSpaceId: number | null): Promise<boolean> {
  const siteAdmin = await can(actorUserId, PERM.VIDEO_DELETE_ANY)
  if (scopeType === 'global') return siteAdmin
  if (siteAdmin) return true
  if (!scopeSpaceId) return false

  if (await can(actorUserId, PERM.SPACE_MANAGE, { spaceId: scopeSpaceId })) return true
  if (await can(actorUserId, PERM.SPACE_ASSIGN_ROLES, { spaceId: scopeSpaceId })) return true
  if (await can(actorUserId, PERM.SPACE_MANAGE_MEMBERS, { spaceId: scopeSpaceId })) return true

  const manageableIds = await listManageableSpaceIds(actorUserId)
  return manageableIds.includes(scopeSpaceId)
}

function annotateCtaWrite(operation: string, dto: MessageCtaDefinitionDto, actorUserId: number): void {
  const span = trace.getSpan(context.active())
  if (span) {
    span.setAttribute('app.operation', 'admin.message_ctas.write')
    span.setAttribute('app.operation_detail', operation)
    span.setAttribute('app.message_cta_definition_id', String(dto.id))
    span.setAttribute('app.message_cta_scope_type', dto.scopeType)
    if (dto.scopeSpaceId != null) span.setAttribute('app.message_cta_scope_space_id', String(dto.scopeSpaceId))
    span.setAttribute('app.message_cta_intent', dto.intentKey)
    span.setAttribute('app.message_cta_executor', dto.executorType)
    span.setAttribute('app.message_cta_status', dto.status)
    span.setAttribute('app.outcome', 'success')
  }

  ctaLogger.info(
    {
      event: operation,
      user_id: actorUserId,
      message_cta_definition_id: dto.id,
      message_cta_scope_type: dto.scopeType,
      message_cta_scope_space_id: dto.scopeSpaceId,
      message_cta_intent: dto.intentKey,
      message_cta_executor: dto.executorType,
      message_cta_status: dto.status,
      app_operation: 'admin.message_ctas.write',
      app_operation_detail: operation,
    },
    operation
  )
}

type NormalizedDefinitionInput = {
  name: string
  status: MessageCtaDefinitionStatus
  scopeType: MessageCtaScopeType
  scopeSpaceId: number | null
  intentKey: MessageCtaIntentKey
  executorType: MessageCtaExecutorType
  labelDefault: string
  config: MessageCtaDefinitionConfig
}

function normalizeDefinitionInput(input: Record<string, unknown>, fallback?: MessageCtaDefinitionDto): NormalizedDefinitionInput {
  const scopeType = normalizeScopeType(input.scopeType ?? fallback?.scopeType, fallback?.scopeType ?? 'global')
  const scopeSpaceId = normalizeScopeSpaceId(input.scopeSpaceId ?? fallback?.scopeSpaceId, scopeType)
  const intentKey = normalizeIntentKey(input.intentKey ?? fallback?.intentKey, fallback?.intentKey ?? 'visit_link')
  const executorType = normalizeExecutorType(input.executorType ?? fallback?.executorType, fallback?.executorType ?? 'internal_link')
  validateIntentExecutor(intentKey, executorType)

  const configRaw = parseConfig(input.config ?? fallback?.config)
  const config = normalizeConfigForExecutor(executorType, configRaw, intentKey)

  return {
    name: normalizeName(input.name ?? fallback?.name),
    status: normalizeStatus(input.status ?? fallback?.status, fallback?.status ?? 'draft'),
    scopeType,
    scopeSpaceId,
    intentKey,
    executorType,
    labelDefault: normalizeLabel(input.labelDefault ?? fallback?.labelDefault),
    config,
  }
}

export async function listMessageCtaDefinitionsForAdmin(params: {
  actorUserId: number
  limit?: number
  includeArchived?: boolean
  status?: MessageCtaDefinitionStatus | null
  scopeType?: MessageCtaScopeType | null
  scopeSpaceId?: number | null
  intentKey?: MessageCtaIntentKey | null
  executorType?: MessageCtaExecutorType | null
}): Promise<MessageCtaDefinitionDto[]> {
  const actorUserId = Number(params.actorUserId)
  if (!Number.isFinite(actorUserId) || actorUserId <= 0) throw new ForbiddenError('forbidden')

  const siteAdmin = await can(actorUserId, PERM.VIDEO_DELETE_ANY)
  const manageableSpaceIds = siteAdmin ? [] : await listManageableSpaceIds(actorUserId)
  const rows = await repo.list({
    limit: params.limit,
    includeArchived: params.includeArchived,
    status: params.status,
    scopeType: params.scopeType,
    scopeSpaceId: params.scopeSpaceId,
    intentKey: params.intentKey,
    executorType: params.executorType,
  })

  return rows
    .filter((row) => {
      const scopeType = normalizeScopeType(row.scope_type)
      const scopeSpaceId = row.scope_space_id == null ? null : Number(row.scope_space_id)
      if (siteAdmin) return true
      if (scopeType === 'global') return false
      if (!scopeSpaceId) return false
      return manageableSpaceIds.includes(scopeSpaceId)
    })
    .map((row) => toDto(row))
}

export async function getMessageCtaDefinitionForAdmin(id: number, actorUserId: number): Promise<MessageCtaDefinitionDto> {
  const itemId = Number(id)
  const userId = Number(actorUserId)
  if (!Number.isFinite(itemId) || itemId <= 0) throw new DomainError('bad_id', 'bad_id', 400)
  if (!Number.isFinite(userId) || userId <= 0) throw new ForbiddenError('forbidden')

  const row = await repo.getById(itemId)
  if (!row) throw new NotFoundError('not_found')
  const dto = toDto(row)

  const allowed = await hasScopeAccess(userId, dto.scopeType, dto.scopeSpaceId)
  if (!allowed) throw new ForbiddenError('forbidden')
  return dto
}

export async function createMessageCtaDefinitionForAdmin(input: Record<string, unknown>, actorUserId: number): Promise<MessageCtaDefinitionDto> {
  const userId = Number(actorUserId)
  if (!Number.isFinite(userId) || userId <= 0) throw new ForbiddenError('forbidden')

  const normalized = normalizeDefinitionInput(input)
  const allowed = await hasScopeAccess(userId, normalized.scopeType, normalized.scopeSpaceId)
  if (!allowed) throw new ForbiddenError('forbidden')

  const row = await repo.create({
    name: normalized.name,
    status: normalized.status,
    scopeType: normalized.scopeType,
    scopeSpaceId: normalized.scopeSpaceId,
    intentKey: normalized.intentKey,
    executorType: normalized.executorType,
    labelDefault: normalized.labelDefault,
    configJson: JSON.stringify(normalized.config),
    createdBy: userId,
    updatedBy: userId,
  })

  const dto = toDto(row)
  annotateCtaWrite('admin.message_ctas.create', dto, userId)
  return dto
}

export async function updateMessageCtaDefinitionForAdmin(
  id: number,
  patch: Record<string, unknown>,
  actorUserId: number
): Promise<MessageCtaDefinitionDto> {
  const itemId = Number(id)
  const userId = Number(actorUserId)
  if (!Number.isFinite(itemId) || itemId <= 0) throw new DomainError('bad_id', 'bad_id', 400)
  if (!Number.isFinite(userId) || userId <= 0) throw new ForbiddenError('forbidden')

  const current = await getMessageCtaDefinitionForAdmin(itemId, userId)
  const normalized = normalizeDefinitionInput(patch, current)
  const allowed = await hasScopeAccess(userId, normalized.scopeType, normalized.scopeSpaceId)
  if (!allowed) throw new ForbiddenError('forbidden')

  const row = await repo.update(itemId, {
    name: normalized.name,
    status: normalized.status,
    scopeType: normalized.scopeType,
    scopeSpaceId: normalized.scopeSpaceId,
    intentKey: normalized.intentKey,
    executorType: normalized.executorType,
    labelDefault: normalized.labelDefault,
    configJson: JSON.stringify(normalized.config),
    updatedBy: userId,
  })

  const dto = toDto(row)
  annotateCtaWrite('admin.message_ctas.update', dto, userId)
  return dto
}

export async function archiveMessageCtaDefinitionForAdmin(id: number, actorUserId: number): Promise<MessageCtaDefinitionDto> {
  return updateMessageCtaDefinitionForAdmin(id, { status: 'archived' }, actorUserId)
}

export async function cloneMessageCtaDefinitionForAdmin(id: number, actorUserId: number): Promise<MessageCtaDefinitionDto> {
  const source = await getMessageCtaDefinitionForAdmin(id, actorUserId)
  const cloned = await createMessageCtaDefinitionForAdmin(
    {
      name: `${source.name} (Copy)`,
      status: 'draft',
      scopeType: source.scopeType,
      scopeSpaceId: source.scopeSpaceId,
      intentKey: source.intentKey,
      executorType: source.executorType,
      labelDefault: source.labelDefault,
      config: source.config,
    },
    actorUserId
  )
  return cloned
}

export async function resolveRuntimeDefinitionsById(params: {
  ids: number[]
  actorUserId?: number | null
  includeArchived?: boolean
}): Promise<Map<number, MessageCtaRuntimeResolution>> {
  const ids = Array.from(new Set((params.ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))))
  const map = new Map<number, MessageCtaRuntimeResolution>()
  if (!ids.length) return map

  const rows = await repo.listByIds(ids)
  const actorUserId = params.actorUserId != null ? Number(params.actorUserId) : null

  for (const row of rows) {
    const dto = toDto(row)
    if (!params.includeArchived && dto.status === 'archived') continue

    if (actorUserId && Number.isFinite(actorUserId) && actorUserId > 0) {
      const allowed = await hasScopeAccess(actorUserId, dto.scopeType, dto.scopeSpaceId)
      if (!allowed) continue
    }

    map.set(dto.id, {
      definitionId: dto.id,
      intentKey: dto.intentKey,
      executorType: dto.executorType,
      label: dto.labelDefault,
      executorConfig: dto.config,
    })
  }

  return map
}

export const MESSAGE_CTA_INTENT_KEYS = INTENT_KEYS
export const MESSAGE_CTA_EXECUTOR_TYPES = EXECUTOR_TYPES
export const MESSAGE_CTA_SCOPE_TYPES = SCOPE_TYPES
export const MESSAGE_CTA_STATUSES = STATUSES
