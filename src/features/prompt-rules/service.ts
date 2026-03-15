import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import { getLogger } from '../../lib/logger'
import * as repo from './repo'
import type {
  PromptAudienceSegment,
  PromptRuleDto,
  PromptRuleRow,
  PromptRuleSurface,
  PromptRuleTieBreak,
  PromptType,
} from './types'

const rulesLogger = getLogger({ component: 'features.prompt_rules' })

const SURFACES: readonly PromptRuleSurface[] = ['global_feed']
const AUDIENCE_SEGMENTS: readonly PromptAudienceSegment[] = ['anonymous', 'authenticated_non_subscriber', 'authenticated_subscriber']
const PROMPT_TYPES: readonly PromptType[] = ['register_login', 'fund_drive', 'subscription_upgrade', 'sponsor_message', 'feature_announcement']
const TIE_BREAKS: readonly PromptRuleTieBreak[] = ['random']

const DEFAULTS = {
  appliesToSurface: 'global_feed' as PromptRuleSurface,
  audienceSegment: 'anonymous' as PromptAudienceSegment,
  promptType: 'register_login' as PromptType,
  minSlidesViewed: 6,
  minWatchSeconds: 45,
  priority: 100,
  tieBreakStrategy: 'random' as PromptRuleTieBreak,
}

function isEnumValue<T extends string>(value: any, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function normalizeName(raw: any): string {
  const value = String(raw ?? '').trim()
  if (!value) throw new DomainError('invalid_name', 'invalid_name', 400)
  if (value.length > 120) throw new DomainError('invalid_name', 'invalid_name', 400)
  return value
}

function normalizeBool(raw: any, fallback: boolean): boolean {
  if (raw === undefined || raw === null || raw === '') return fallback
  if (raw === true || raw === false) return raw
  const value = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return fallback
}

function normalizeSurface(raw: any, fallback = DEFAULTS.appliesToSurface): PromptRuleSurface {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, SURFACES)) throw new DomainError('invalid_applies_to_surface', 'invalid_applies_to_surface', 400)
  return value
}

function normalizeAudienceSegment(raw: any, fallback = DEFAULTS.audienceSegment): PromptAudienceSegment {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, AUDIENCE_SEGMENTS)) throw new DomainError('invalid_audience_segment', 'invalid_audience_segment', 400)
  return value
}

function normalizePromptType(raw: any, fallback = DEFAULTS.promptType): PromptType {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, PROMPT_TYPES)) throw new DomainError('invalid_prompt_type', 'invalid_prompt_type', 400)
  return value
}

function normalizeTieBreak(raw: any, fallback = DEFAULTS.tieBreakStrategy): PromptRuleTieBreak {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, TIE_BREAKS)) throw new DomainError('invalid_tie_break_strategy', 'invalid_tie_break_strategy', 400)
  return value
}

function normalizeInt(raw: any, key: string, min: number, max: number, fallback: number): number {
  const value = raw === undefined || raw === null || raw === '' ? fallback : Number(raw)
  if (!Number.isFinite(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  const rounded = Math.round(value)
  if (rounded < min || rounded > max) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return rounded
}

function mapRow(row: PromptRuleRow): PromptRuleDto {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    enabled: Number(row.enabled || 0) === 1,
    appliesToSurface: row.applies_to_surface,
    audienceSegment: row.audience_segment,
    promptType: row.prompt_type,
    minSlidesViewed: Number(row.min_slides_viewed || 0),
    minWatchSeconds: Number(row.min_watch_seconds || 0),
    priority: Number(row.priority || 0),
    tieBreakStrategy: row.tie_break_strategy,
    createdBy: Number(row.created_by || 0),
    updatedBy: Number(row.updated_by || 0),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

export async function listForAdmin(params?: {
  limit?: number
  enabled?: any
  appliesToSurface?: any
  audienceSegment?: any
  promptType?: any
}): Promise<PromptRuleDto[]> {
  const enabledRaw = params?.enabled
  const enabled = enabledRaw === undefined || enabledRaw === null || enabledRaw === ''
    ? null
    : normalizeBool(enabledRaw, true)
  const appliesToSurface = params?.appliesToSurface ? normalizeSurface(params.appliesToSurface) : null
  const audienceSegment = params?.audienceSegment ? normalizeAudienceSegment(params.audienceSegment) : null
  const promptType = params?.promptType ? normalizePromptType(params.promptType) : null

  const rows = await repo.list({
    limit: params?.limit,
    enabled,
    appliesToSurface,
    audienceSegment,
    promptType,
  })
  return rows.map(mapRow)
}

export async function getForAdmin(id: number): Promise<PromptRuleDto> {
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('prompt_rule_not_found')
  return mapRow(row)
}

export async function createForAdmin(input: any, actorUserId: number): Promise<PromptRuleDto> {
  if (!actorUserId) throw new ForbiddenError()

  const name = normalizeName(input?.name)
  const enabled = normalizeBool(input?.enabled, true)
  const appliesToSurface = normalizeSurface(input?.appliesToSurface ?? input?.applies_to_surface)
  const audienceSegment = normalizeAudienceSegment(input?.audienceSegment ?? input?.audience_segment)
  const promptType = normalizePromptType(input?.promptType ?? input?.prompt_type)
  const minSlidesViewed = normalizeInt(input?.minSlidesViewed ?? input?.min_slides_viewed, 'min_slides_viewed', 0, 5000, DEFAULTS.minSlidesViewed)
  const minWatchSeconds = normalizeInt(input?.minWatchSeconds ?? input?.min_watch_seconds, 'min_watch_seconds', 0, 86400, DEFAULTS.minWatchSeconds)
  const priority = normalizeInt(input?.priority, 'priority', -100000, 100000, DEFAULTS.priority)
  const tieBreakStrategy = normalizeTieBreak(input?.tieBreakStrategy ?? input?.tie_break_strategy)

  const row = await repo.create({
    name,
    enabled,
    appliesToSurface,
    audienceSegment,
    promptType,
    minSlidesViewed,
    minWatchSeconds,
    priority,
    tieBreakStrategy,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  })

  rulesLogger.info({ event: 'admin.prompt_rules.create', rule_id: row.id, user_id: actorUserId, app_operation: 'admin.prompt_rules.write' }, 'admin.prompt_rules.create')
  return mapRow(row)
}

export async function updateForAdmin(id: number, patch: any, actorUserId: number): Promise<PromptRuleDto> {
  if (!actorUserId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('prompt_rule_not_found')

  const current = mapRow(existing)

  const nextName = patch?.name !== undefined ? normalizeName(patch.name) : current.name
  const nextEnabled =
    patch?.enabled !== undefined ? normalizeBool(patch.enabled, current.enabled)
    : (patch?.enabledFlag !== undefined ? normalizeBool(patch.enabledFlag, current.enabled) : current.enabled)
  const nextSurface =
    patch?.appliesToSurface !== undefined || patch?.applies_to_surface !== undefined
      ? normalizeSurface(patch?.appliesToSurface ?? patch?.applies_to_surface, current.appliesToSurface)
      : current.appliesToSurface
  const nextAudienceSegment =
    patch?.audienceSegment !== undefined || patch?.audience_segment !== undefined
      ? normalizeAudienceSegment(patch?.audienceSegment ?? patch?.audience_segment, current.audienceSegment)
      : current.audienceSegment
  const nextPromptType =
    patch?.promptType !== undefined || patch?.prompt_type !== undefined
      ? normalizePromptType(patch?.promptType ?? patch?.prompt_type, current.promptType)
      : current.promptType
  const nextMinSlidesViewed =
    patch?.minSlidesViewed !== undefined || patch?.min_slides_viewed !== undefined
      ? normalizeInt(patch?.minSlidesViewed ?? patch?.min_slides_viewed, 'min_slides_viewed', 0, 5000, current.minSlidesViewed)
      : current.minSlidesViewed
  const nextMinWatchSeconds =
    patch?.minWatchSeconds !== undefined || patch?.min_watch_seconds !== undefined
      ? normalizeInt(patch?.minWatchSeconds ?? patch?.min_watch_seconds, 'min_watch_seconds', 0, 86400, current.minWatchSeconds)
      : current.minWatchSeconds
  const nextPriority =
    patch?.priority !== undefined
      ? normalizeInt(patch?.priority, 'priority', -100000, 100000, current.priority)
      : current.priority
  const nextTieBreakStrategy =
    patch?.tieBreakStrategy !== undefined || patch?.tie_break_strategy !== undefined
      ? normalizeTieBreak(patch?.tieBreakStrategy ?? patch?.tie_break_strategy, current.tieBreakStrategy)
      : current.tieBreakStrategy

  const row = await repo.update(id, {
    name: nextName,
    enabled: nextEnabled,
    appliesToSurface: nextSurface,
    audienceSegment: nextAudienceSegment,
    promptType: nextPromptType,
    minSlidesViewed: nextMinSlidesViewed,
    minWatchSeconds: nextMinWatchSeconds,
    priority: nextPriority,
    tieBreakStrategy: nextTieBreakStrategy,
    updatedBy: actorUserId,
  })

  rulesLogger.info({ event: 'admin.prompt_rules.update', rule_id: id, user_id: actorUserId, app_operation: 'admin.prompt_rules.write' }, 'admin.prompt_rules.update')
  return mapRow(row)
}

export async function toggleEnabledForAdmin(id: number, enabledRaw: any, actorUserId: number): Promise<PromptRuleDto> {
  if (!actorUserId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('prompt_rule_not_found')
  const enabled = normalizeBool(enabledRaw, Number(existing.enabled) === 1)
  const row = await repo.update(id, {
    enabled,
    updatedBy: actorUserId,
  })
  rulesLogger.info({ event: 'admin.prompt_rules.toggle', rule_id: id, enabled, user_id: actorUserId, app_operation: 'admin.prompt_rules.write' }, 'admin.prompt_rules.toggle')
  return mapRow(row)
}
