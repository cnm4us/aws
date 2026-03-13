import crypto from 'crypto'
import { DomainError } from '../../core/errors'
import * as promptsSvc from '../prompts/service'
import * as promptRulesSvc from '../prompt-rules/service'
import * as repo from './repo'
import type { PromptDecisionInput, PromptDecisionReasonCode, PromptDecisionResult, PromptDecisionSessionRow, PromptDecisionSurface, PromptViewerState } from './types'

const ALLOWED_SURFACES: readonly PromptDecisionSurface[] = ['global_feed']
const SESSION_ID_RE = /^[a-zA-Z0-9:_-]{8,120}$/

export const ANON_SESSION_COOKIE = 'anon_session_id'
export const ANON_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function normalizeSurface(raw: any): PromptDecisionSurface {
  const value = String(raw ?? '').trim().toLowerCase()
  if ((ALLOWED_SURFACES as readonly string[]).includes(value)) return value as PromptDecisionSurface
  throw new DomainError('invalid_surface', 'invalid_surface', 400)
}

function normalizeCounter(raw: any, key: string, min: number, max: number, fallback: number): number {
  const value = raw == null || raw === '' ? fallback : Number(raw)
  if (!Number.isFinite(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  const rounded = Math.round(value)
  if (rounded < min || rounded > max) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return rounded
}

function normalizeDateTime(raw: any, key: string): string | null {
  if (raw == null || raw === '') return null
  const date = new Date(String(raw))
  if (!Number.isFinite(date.getTime())) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function normalizePromptId(raw: any): number | null {
  if (raw == null || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new DomainError('invalid_last_prompt_id', 'invalid_last_prompt_id', 400)
  return Math.round(value)
}

function isValidSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value)
}

function generateSessionId(): string {
  try {
    const uuid = crypto.randomUUID()
    if (isValidSessionId(uuid)) return uuid
  } catch {}
  return crypto.randomBytes(24).toString('hex')
}

function deterministicScore(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex')
}

function parseCounters(raw: any): PromptDecisionInput['counters'] {
  const src = raw && typeof raw === 'object' ? raw : {}
  const countersRaw = src.counters && typeof src.counters === 'object' ? src.counters : src
  const slidesViewed = normalizeCounter(countersRaw.slides_viewed ?? countersRaw.slidesViewed, 'slides_viewed', 0, 1000000, 0)
  const watchSeconds = normalizeCounter(countersRaw.watch_seconds ?? countersRaw.watchSeconds, 'watch_seconds', 0, 7 * 24 * 60 * 60, 0)
  const promptsShownThisSession = normalizeCounter(
    countersRaw.prompts_shown_this_session ?? countersRaw.promptsShownThisSession,
    'prompts_shown_this_session',
    0,
    10000,
    0
  )
  const slidesSinceLastPrompt = normalizeCounter(
    countersRaw.slides_since_last_prompt ?? countersRaw.slidesSinceLastPrompt,
    'slides_since_last_prompt',
    0,
    1000000,
    0
  )
  const lastPromptShownAt = normalizeDateTime(
    countersRaw.last_prompt_shown_at ?? countersRaw.lastPromptShownAt ?? countersRaw.last_prompt_dismissed_at ?? countersRaw.lastPromptDismissedAt,
    'last_prompt_shown_at'
  )
  const lastPromptId = normalizePromptId(countersRaw.last_prompt_id ?? countersRaw.lastPromptId)

  return {
    slidesViewed,
    watchSeconds,
    promptsShownThisSession,
    slidesSinceLastPrompt,
    lastPromptShownAt,
    lastPromptId,
  }
}

function mergeSessionState(existing: PromptDecisionSessionRow | null, input: PromptDecisionInput): {
  viewerState: PromptViewerState
  slidesViewed: number
  watchSeconds: number
  promptsShownThisSession: number
  slidesSinceLastPrompt: number
  lastPromptShownAt: string | null
  lastPromptId: number | null
} {
  if (!existing) {
    return {
      viewerState: input.viewerState,
      slidesViewed: input.counters.slidesViewed,
      watchSeconds: input.counters.watchSeconds,
      promptsShownThisSession: input.counters.promptsShownThisSession,
      slidesSinceLastPrompt: input.counters.slidesSinceLastPrompt,
      lastPromptShownAt: input.counters.lastPromptShownAt,
      lastPromptId: input.counters.lastPromptId,
    }
  }

  return {
    viewerState: input.viewerState,
    slidesViewed: Math.max(Number(existing.slides_viewed || 0), input.counters.slidesViewed),
    watchSeconds: Math.max(Number(existing.watch_seconds || 0), input.counters.watchSeconds),
    promptsShownThisSession: Math.max(Number(existing.prompts_shown_this_session || 0), input.counters.promptsShownThisSession),
    slidesSinceLastPrompt:
      input.counters.slidesSinceLastPrompt !== undefined && input.counters.slidesSinceLastPrompt !== null
        ? input.counters.slidesSinceLastPrompt
        : Number(existing.slides_since_last_prompt || 0),
    lastPromptShownAt: input.counters.lastPromptShownAt || existing.last_prompt_shown_at || existing.last_prompt_dismissed_at || null,
    lastPromptId: input.counters.lastPromptId ?? (existing.last_shown_prompt_id == null ? null : Number(existing.last_shown_prompt_id)),
  }
}

function nowMs(): number {
  return Date.now()
}

function dateToMs(raw: string | null): number | null {
  if (!raw) return null
  const date = new Date(String(raw).replace(' ', 'T') + 'Z')
  if (!Number.isFinite(date.getTime())) return null
  return date.getTime()
}

export function buildDecisionInput(params: {
  body: any
  cookieSessionId: string | null
  viewerState: PromptViewerState
}): { input: PromptDecisionInput; createdSessionId: string | null } {
  const surface = normalizeSurface(params.body?.surface)

  const bodySessionRaw = String(params.body?.session_id ?? params.body?.sessionId ?? '').trim()
  const bodySessionId = bodySessionRaw && isValidSessionId(bodySessionRaw) ? bodySessionRaw : null

  let sessionId = params.cookieSessionId && isValidSessionId(params.cookieSessionId)
    ? params.cookieSessionId
    : (bodySessionId || null)

  let createdSessionId: string | null = null
  if (!sessionId) {
    sessionId = generateSessionId()
    createdSessionId = sessionId
  }

  const counters = parseCounters(params.body || {})

  return {
    input: {
      surface,
      sessionId,
      viewerState: params.viewerState,
      counters,
    },
    createdSessionId,
  }
}

export async function decidePrompt(input: PromptDecisionInput, opts?: { includeDebug?: boolean }): Promise<PromptDecisionResult> {
  const existing = await repo.getSessionByKey(input.sessionId, input.surface)
  const merged = mergeSessionState(existing, input)

  if (!existing) {
    await repo.createSession({
      sessionId: input.sessionId,
      surface: input.surface,
      viewerState: merged.viewerState,
      slidesViewed: merged.slidesViewed,
      watchSeconds: merged.watchSeconds,
      promptsShownThisSession: merged.promptsShownThisSession,
      slidesSinceLastPrompt: merged.slidesSinceLastPrompt,
      lastPromptShownAt: merged.lastPromptShownAt,
      lastPromptId: merged.lastPromptId,
      lastDecisionReason: null,
    })
  } else {
    await repo.updateSession(existing.id, {
      viewerState: merged.viewerState,
      slidesViewed: merged.slidesViewed,
      watchSeconds: merged.watchSeconds,
      promptsShownThisSession: merged.promptsShownThisSession,
      slidesSinceLastPrompt: merged.slidesSinceLastPrompt,
      lastPromptShownAt: merged.lastPromptShownAt,
      lastPromptId: merged.lastPromptId,
    })
  }

  let reasonCode: PromptDecisionReasonCode = 'no_enabled_rule'
  let promptId: number | null = null
  let ruleId: number | null = null
  let ruleName: string | null = null

  if (merged.viewerState === 'authenticated') {
    reasonCode = 'viewer_authenticated'
  } else {
    const rules = await promptRulesSvc.listForAdmin({
      enabled: true,
      appliesToSurface: input.surface,
      authState: 'anonymous',
      limit: 100,
    })

    if (!rules.length) {
      reasonCode = 'no_enabled_rule'
    } else {
      let matched = false
      let lastBlockedReason: PromptDecisionReasonCode = 'no_enabled_rule'
      let lastBlockedRuleId: number | null = null
      let lastBlockedRuleName: string | null = null

      for (const rule of rules) {
        const currentRuleId = Number(rule.id)
        const currentRuleName = String(rule.name || '')
        let currentReason: PromptDecisionReasonCode = 'eligible'
        let currentPromptId: number | null = null

        if (merged.promptsShownThisSession >= rule.maxPromptsPerSession) {
          currentReason = 'cap_reached'
        } else {
          const lastShownMs = dateToMs(merged.lastPromptShownAt)
          if (
            lastShownMs != null &&
            rule.cooldownSecondsAfterPrompt > 0 &&
            nowMs() - lastShownMs < rule.cooldownSecondsAfterPrompt * 1000
          ) {
            currentReason = 'cooldown_active'
          } else if (
            merged.slidesViewed < rule.minSlidesViewed ||
            merged.watchSeconds < rule.minWatchSeconds ||
            (merged.promptsShownThisSession > 0 && merged.slidesSinceLastPrompt < rule.minSlidesBetweenPrompts)
          ) {
            currentReason = 'below_threshold'
          } else {
            let prompts = await promptsSvc.listActiveForFeed({ limit: 300 })
            if (rule.promptCategoryAllowlist.length) {
              const allowed = new Set(rule.promptCategoryAllowlist.map((x) => String(x).trim().toLowerCase()))
              prompts = prompts.filter((p: any) => allowed.has(String(p.category || '').trim().toLowerCase()))
            }

            if (!prompts.length) {
              currentReason = 'no_candidate'
            } else {
              const byPriority = new Map<number, typeof prompts>()
              for (const prompt of prompts) {
                const pr = Number(prompt.priority || 0)
                const group = byPriority.get(pr) || []
                group.push(prompt)
                byPriority.set(pr, group)
              }

              const priorities = Array.from(byPriority.keys()).sort((a, b) => a - b)
              const lastPromptId = merged.lastPromptId
              let selected: any = null
              let fallbackSelected: any = null

              for (const pr of priorities) {
                const group = (byPriority.get(pr) || []).slice()
                group.sort((a: any, b: any) => {
                  const sa = deterministicScore(`${input.sessionId}:${rule.id}:${a.id}`)
                  const sb = deterministicScore(`${input.sessionId}:${rule.id}:${b.id}`)
                  if (sa < sb) return -1
                  if (sa > sb) return 1
                  return Number(a.id) - Number(b.id)
                })
                if (!fallbackSelected && group.length) fallbackSelected = group[0]
                const candidate = group.find((p: any) => Number(p.id) !== Number(lastPromptId || 0)) || null
                if (candidate) {
                  selected = candidate
                  break
                }
              }

              if (!selected && fallbackSelected) selected = fallbackSelected

              if (!selected) {
                currentReason = 'no_candidate'
              } else {
                currentPromptId = Number(selected.id)
                currentReason = 'eligible'
              }
            }
          }
        }

        if (currentReason === 'eligible' && currentPromptId != null) {
          matched = true
          reasonCode = 'eligible'
          promptId = currentPromptId
          ruleId = currentRuleId
          ruleName = currentRuleName
          break
        }

        lastBlockedReason = currentReason
        lastBlockedRuleId = currentRuleId
        lastBlockedRuleName = currentRuleName
      }

      if (!matched) {
        reasonCode = lastBlockedReason
        ruleId = lastBlockedRuleId
        ruleName = lastBlockedRuleName
      }
    }
  }

  const result: PromptDecisionResult = {
    shouldInsert: reasonCode === 'eligible' && promptId != null,
    promptId,
    insertAfterIndex: null,
    reasonCode,
    ruleId,
    ruleName,
    sessionId: input.sessionId,
  }

  const persisted = await repo.getSessionByKey(input.sessionId, input.surface)
  if (persisted) {
    const lastPromptShownAt = result.shouldInsert ? normalizeDateTime(new Date().toISOString(), 'last_prompt_shown_at') : undefined
    await repo.updateSession(persisted.id, {
      lastDecisionReason: reasonCode,
      lastPromptShownAt,
      lastPromptId: result.shouldInsert ? result.promptId : undefined,
    })
  }

  if (opts?.includeDebug) {
    result.debug = {
      input: {
        surface: input.surface,
        viewerState: input.viewerState,
        counters: input.counters,
      },
      mergedSession: {
        viewerState: merged.viewerState,
        slidesViewed: merged.slidesViewed,
        watchSeconds: merged.watchSeconds,
        promptsShownThisSession: merged.promptsShownThisSession,
        slidesSinceLastPrompt: merged.slidesSinceLastPrompt,
        lastPromptShownAt: merged.lastPromptShownAt,
        lastPromptId: merged.lastPromptId,
      },
      rule: ruleId ? { id: ruleId, name: ruleName } : null,
      reasonCode,
    }
  }

  return result
}
