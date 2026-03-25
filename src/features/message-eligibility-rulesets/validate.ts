import { DomainError } from '../../core/errors'
import type { MessageEligibilityCriteria, MessageEligibilityRule } from './types'

const ALLOWED_COMPLETED_INTENTS = new Set(['donate', 'subscribe', 'upgrade'])

function assertInteger(value: any, key: string, min = 0): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return n
}

function assertStringArray(value: any, key: string): string[] {
  if (!Array.isArray(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  const out = value
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => entry.length > 0)
  if (!out.length) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return Array.from(new Set(out))
}

function normalizeRule(raw: any): MessageEligibilityRule {
  if (!raw || typeof raw !== 'object') throw new DomainError('invalid_ruleset_rule', 'invalid_ruleset_rule', 400)
  const op = String((raw as any).op ?? '').trim()

  if (op === 'user.is_authenticated' || op === 'support.is_subscriber') {
    if (typeof (raw as any).value !== 'boolean') throw new DomainError('invalid_ruleset_rule_value', 'invalid_ruleset_rule_value', 400)
    return { op, value: (raw as any).value }
  }
  if (op === 'support.subscription_tier_in') {
    return { op, value: assertStringArray((raw as any).value, 'ruleset_rule_value') }
  }
  if (op === 'support.donated_within_days') {
    return { op, value: assertInteger((raw as any).value, 'ruleset_rule_value', 1) }
  }
  if (op === 'support.donated_amount_last_days_gte') {
    const src = (raw as any).value
    if (!src || typeof src !== 'object') throw new DomainError('invalid_ruleset_rule_value', 'invalid_ruleset_rule_value', 400)
    return {
      op,
      value: {
        days: assertInteger((src as any).days, 'ruleset_rule_days', 1),
        cents: assertInteger((src as any).cents, 'ruleset_rule_cents', 0),
      },
    }
  }
  if (op === 'support.completed_intent_in') {
    const intents = assertStringArray((raw as any).value, 'ruleset_rule_value')
    const invalid = intents.find((intent) => !ALLOWED_COMPLETED_INTENTS.has(intent))
    if (invalid) throw new DomainError('invalid_ruleset_rule_value', 'invalid_ruleset_rule_value', 400)
    return { op, value: intents as Array<'donate' | 'subscribe' | 'upgrade'> }
  }

  throw new DomainError('invalid_ruleset_rule_op', 'invalid_ruleset_rule_op', 400)
}

function normalizeRuleArray(raw: any, key: string): MessageEligibilityRule[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return raw.map((rule) => normalizeRule(rule))
}

export function normalizeEligibilityCriteria(raw: any): MessageEligibilityCriteria {
  const source = typeof raw === 'string' ? (() => {
    try {
      return JSON.parse(raw)
    } catch {
      throw new DomainError('invalid_criteria_json', 'invalid_criteria_json', 400)
    }
  })() : raw

  if (!source || typeof source !== 'object') throw new DomainError('invalid_criteria_json', 'invalid_criteria_json', 400)
  const version = assertInteger((source as any).version ?? 1, 'criteria_version', 1)
  if (version !== 1) throw new DomainError('invalid_criteria_version', 'invalid_criteria_version', 400)

  return {
    version: 1,
    inclusion: normalizeRuleArray((source as any).inclusion, 'criteria_inclusion'),
    exclusion: normalizeRuleArray((source as any).exclusion, 'criteria_exclusion'),
  }
}
