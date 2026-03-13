import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import { getLogger } from '../../lib/logger'
import * as repo from './repo'
import type { PromptRuleAuthState, PromptRuleDto, PromptRuleRow, PromptRuleSurface, PromptRuleTieBreak } from './types'

const rulesLogger = getLogger({ component: 'features.prompt_rules' })

const SURFACES: readonly PromptRuleSurface[] = ['global_feed']
const AUTH_STATES: readonly PromptRuleAuthState[] = ['anonymous']
const TIE_BREAKS: readonly PromptRuleTieBreak[] = ['random']

const DEFAULTS = {
  appliesToSurface: 'global_feed' as PromptRuleSurface,
  authState: 'anonymous' as PromptRuleAuthState,
  minSlidesViewed: 6,
  minWatchSeconds: 45,
  maxPromptsPerSession: 2,
  minSlidesBetweenPrompts: 15,
  cooldownSecondsAfterPrompt: 900,
  promptCategoryAllowlist: ['register_prompt'],
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

function normalizeAuthState(raw: any, fallback = DEFAULTS.authState): PromptRuleAuthState {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, AUTH_STATES)) throw new DomainError('invalid_auth_state', 'invalid_auth_state', 400)
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

function parseAllowlist(raw: any): string[] {
  if (Array.isArray(raw)) {
    const cleaned = raw.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
    const unique = Array.from(new Set(cleaned))
    if (unique.some((c) => !/^[a-z0-9_-]+$/.test(c))) throw new DomainError('invalid_prompt_category_allowlist', 'invalid_prompt_category_allowlist', 400)
    return unique
  }

  const text = String(raw ?? '').trim()
  if (!text) return []

  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) throw new Error('bad')
      return parseAllowlist(parsed)
    } catch {
      throw new DomainError('invalid_prompt_category_allowlist', 'invalid_prompt_category_allowlist', 400)
    }
  }

  const split = text.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const unique = Array.from(new Set(split))
  if (unique.some((c) => !/^[a-z0-9_-]+$/.test(c))) throw new DomainError('invalid_prompt_category_allowlist', 'invalid_prompt_category_allowlist', 400)
  return unique
}

function mapRow(row: PromptRuleRow): PromptRuleDto {
  let allowlist: string[] = []
  try {
    const parsed = row.prompt_category_allowlist_json ? JSON.parse(String(row.prompt_category_allowlist_json)) : []
    if (Array.isArray(parsed)) allowlist = parsed.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
  } catch {
    allowlist = []
  }

  return {
    id: Number(row.id),
    name: String(row.name || ''),
    enabled: Number(row.enabled || 0) === 1,
    appliesToSurface: row.applies_to_surface,
    authState: row.auth_state,
    minSlidesViewed: Number(row.min_slides_viewed || 0),
    minWatchSeconds: Number(row.min_watch_seconds || 0),
    maxPromptsPerSession: Number(row.max_prompts_per_session || 0),
    minSlidesBetweenPrompts: Number(row.min_slides_between_prompts || 0),
    cooldownSecondsAfterPrompt: Number(row.cooldown_seconds_after_prompt ?? row.cooldown_seconds_after_dismiss ?? 0),
    cooldownSecondsAfterDismiss: Number(row.cooldown_seconds_after_prompt ?? row.cooldown_seconds_after_dismiss ?? 0),
    promptCategoryAllowlist: allowlist,
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
  authState?: any
}): Promise<PromptRuleDto[]> {
  const enabledRaw = params?.enabled
  const enabled = enabledRaw === undefined || enabledRaw === null || enabledRaw === ''
    ? null
    : normalizeBool(enabledRaw, true)
  const appliesToSurface = params?.appliesToSurface ? normalizeSurface(params.appliesToSurface) : null
  const authState = params?.authState ? normalizeAuthState(params.authState) : null

  const rows = await repo.list({
    limit: params?.limit,
    enabled,
    appliesToSurface,
    authState,
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
  const authState = normalizeAuthState(input?.authState ?? input?.auth_state)
  const minSlidesViewed = normalizeInt(input?.minSlidesViewed ?? input?.min_slides_viewed, 'min_slides_viewed', 0, 5000, DEFAULTS.minSlidesViewed)
  const minWatchSeconds = normalizeInt(input?.minWatchSeconds ?? input?.min_watch_seconds, 'min_watch_seconds', 0, 86400, DEFAULTS.minWatchSeconds)
  const maxPromptsPerSession = normalizeInt(input?.maxPromptsPerSession ?? input?.max_prompts_per_session, 'max_prompts_per_session', 0, 100000, DEFAULTS.maxPromptsPerSession)
  const minSlidesBetweenPrompts = normalizeInt(input?.minSlidesBetweenPrompts ?? input?.min_slides_between_prompts, 'min_slides_between_prompts', 0, 2000, DEFAULTS.minSlidesBetweenPrompts)
  const cooldownSecondsAfterPrompt = normalizeInt(
    input?.cooldownSecondsAfterPrompt ?? input?.cooldown_seconds_after_prompt ?? input?.cooldownSecondsAfterDismiss ?? input?.cooldown_seconds_after_dismiss,
    'cooldown_seconds_after_prompt',
    0,
    604800,
    DEFAULTS.cooldownSecondsAfterPrompt
  )
  const promptCategoryAllowlist = parseAllowlist(input?.promptCategoryAllowlist ?? input?.prompt_category_allowlist ?? DEFAULTS.promptCategoryAllowlist)
  const priority = normalizeInt(input?.priority, 'priority', -100000, 100000, DEFAULTS.priority)
  const tieBreakStrategy = normalizeTieBreak(input?.tieBreakStrategy ?? input?.tie_break_strategy)

  const row = await repo.create({
    name,
    enabled,
    appliesToSurface,
    authState,
    minSlidesViewed,
    minWatchSeconds,
    maxPromptsPerSession,
    minSlidesBetweenPrompts,
    cooldownSecondsAfterPrompt,
    promptCategoryAllowlistJson: JSON.stringify(promptCategoryAllowlist),
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
  const nextAuthState =
    patch?.authState !== undefined || patch?.auth_state !== undefined
      ? normalizeAuthState(patch?.authState ?? patch?.auth_state, current.authState)
      : current.authState
  const nextMinSlidesViewed =
    patch?.minSlidesViewed !== undefined || patch?.min_slides_viewed !== undefined
      ? normalizeInt(patch?.minSlidesViewed ?? patch?.min_slides_viewed, 'min_slides_viewed', 0, 5000, current.minSlidesViewed)
      : current.minSlidesViewed
  const nextMinWatchSeconds =
    patch?.minWatchSeconds !== undefined || patch?.min_watch_seconds !== undefined
      ? normalizeInt(patch?.minWatchSeconds ?? patch?.min_watch_seconds, 'min_watch_seconds', 0, 86400, current.minWatchSeconds)
      : current.minWatchSeconds
  const nextMaxPromptsPerSession =
    patch?.maxPromptsPerSession !== undefined || patch?.max_prompts_per_session !== undefined
      ? normalizeInt(patch?.maxPromptsPerSession ?? patch?.max_prompts_per_session, 'max_prompts_per_session', 0, 100000, current.maxPromptsPerSession)
      : current.maxPromptsPerSession
  const nextMinSlidesBetweenPrompts =
    patch?.minSlidesBetweenPrompts !== undefined || patch?.min_slides_between_prompts !== undefined
      ? normalizeInt(patch?.minSlidesBetweenPrompts ?? patch?.min_slides_between_prompts, 'min_slides_between_prompts', 0, 2000, current.minSlidesBetweenPrompts)
      : current.minSlidesBetweenPrompts
  const nextCooldownSecondsAfterPrompt =
    patch?.cooldownSecondsAfterPrompt !== undefined ||
    patch?.cooldown_seconds_after_prompt !== undefined ||
    patch?.cooldownSecondsAfterDismiss !== undefined ||
    patch?.cooldown_seconds_after_dismiss !== undefined
      ? normalizeInt(
          patch?.cooldownSecondsAfterPrompt ??
            patch?.cooldown_seconds_after_prompt ??
            patch?.cooldownSecondsAfterDismiss ??
            patch?.cooldown_seconds_after_dismiss,
          'cooldown_seconds_after_prompt',
          0,
          604800,
          current.cooldownSecondsAfterPrompt
        )
      : current.cooldownSecondsAfterPrompt
  const nextPromptCategoryAllowlist =
    patch?.promptCategoryAllowlist !== undefined || patch?.prompt_category_allowlist !== undefined
      ? parseAllowlist(patch?.promptCategoryAllowlist ?? patch?.prompt_category_allowlist)
      : current.promptCategoryAllowlist
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
    authState: nextAuthState,
    minSlidesViewed: nextMinSlidesViewed,
    minWatchSeconds: nextMinWatchSeconds,
    maxPromptsPerSession: nextMaxPromptsPerSession,
    minSlidesBetweenPrompts: nextMinSlidesBetweenPrompts,
    cooldownSecondsAfterPrompt: nextCooldownSecondsAfterPrompt,
    promptCategoryAllowlistJson: JSON.stringify(nextPromptCategoryAllowlist),
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
