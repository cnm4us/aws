import {
  type CultureDefinitionInput,
  type CultureDefinitionMetadataContext,
  type CultureDefinitionV1,
  type CultureDefinitionVersion,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const next = value.trim()
  return next.length ? next : undefined
}

function normalizeInteractionStyle(value: unknown): string | undefined {
  const next = normalizeOptionalString(value)
  if (!next) return undefined
  if (next === 'adversarial') return 'debate'
  if (next === 'professional') return 'structured'
  return next
}

function normalizeAiHint(value: unknown): string | undefined {
  const next = normalizeOptionalString(value)
  if (!next) return undefined
  if (next === 'adversarial_environment') return 'debate_environment'
  if (next === 'professional_environment') return 'expert_environment'
  if (next === 'mixed_environment') return 'open_expression_environment'
  return next
}

function normalizeRequiredString(value: unknown): string | undefined {
  const next = normalizeOptionalString(value)
  return next && next.length ? next : undefined
}

function normalizeUniqueStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const next: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    next.push(trimmed)
  }
  return next
}

export function deriveCultureDefinitionIdFromKey(raw: string): string {
  const source = String(raw || '').trim().toLowerCase()
  const withUnderscores = source
    .replace(/[\s\-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  let id = withUnderscores
  if (!id) id = 'culture'
  if (!/^[a-z]/.test(id)) id = `c_${id}`
  return id
}

function normalizeVersion(raw: unknown, fallback: CultureDefinitionVersion): CultureDefinitionVersion {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  return /^v[0-9]+$/.test(trimmed) ? (trimmed as CultureDefinitionVersion) : fallback
}

function applyMetadataPolicy(
  value: Record<string, unknown>,
  context: CultureDefinitionMetadataContext
): void {
  const defaultVersion = context.defaultVersion || 'v1'

  if (typeof context.cultureName === 'string' && context.cultureName.trim()) {
    value.name = context.cultureName.trim()
  } else {
    const normalizedName = normalizeRequiredString(value.name)
    if (normalizedName) value.name = normalizedName
  }

  if (typeof context.cultureKey === 'string' && context.cultureKey.trim()) {
    value.id = deriveCultureDefinitionIdFromKey(context.cultureKey)
  } else if (typeof value.id === 'string' && value.id.trim()) {
    value.id = deriveCultureDefinitionIdFromKey(value.id)
  } else if (typeof value.name === 'string' && value.name.trim()) {
    value.id = deriveCultureDefinitionIdFromKey(value.name)
  }

  value.version = normalizeVersion(value.version, defaultVersion)
}

function normalizeTolerance(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined
  const tolerance: Record<string, unknown> = { ...raw }

  const knownKeys = [
    'hostility',
    'confrontation',
    'person_directed_profanity',
    'mockery',
    'personal_attacks',
  ] as const

  for (const key of knownKeys) {
    const normalized = normalizeOptionalString(tolerance[key])
    if (normalized) tolerance[key] = normalized
    else if (key in tolerance && typeof tolerance[key] === 'string') delete tolerance[key]
  }

  return tolerance
}

export function normalizeCultureDefinitionInput(
  input: unknown,
  context: CultureDefinitionMetadataContext = {}
): CultureDefinitionInput {
  const source: Record<string, unknown> = isRecord(input) ? input : {}
  const normalized: Record<string, unknown> = { ...source }

  applyMetadataPolicy(normalized, context)

  const summary = normalizeOptionalString(source.summary)
  if (summary) normalized.summary = summary
  else if (typeof source.summary === 'string') delete normalized.summary

  const internalNotes = normalizeOptionalString(source.internal_notes)
  if (internalNotes) normalized.internal_notes = internalNotes
  else if (typeof source.internal_notes === 'string') delete normalized.internal_notes

  const interactionStyle = normalizeInteractionStyle(source.interaction_style)
  if (interactionStyle) normalized.interaction_style = interactionStyle

  const tone = normalizeUniqueStringArray(source.tone_expectations)
  if (tone) normalized.tone_expectations = tone

  const disruption = normalizeUniqueStringArray(source.disruption_signals)
  if (disruption) normalized.disruption_signals = disruption

  const aiHint = normalizeAiHint(source.ai_hint)
  if (aiHint) normalized.ai_hint = aiHint
  else if (typeof source.ai_hint === 'string') delete normalized.ai_hint

  const tolerance = normalizeTolerance(source.tolerance)
  if (tolerance) normalized.tolerance = tolerance

  return normalized as CultureDefinitionInput
}

export function normalizeCultureDefinitionV1(
  input: unknown,
  context: CultureDefinitionMetadataContext = {}
): CultureDefinitionV1 {
  return normalizeCultureDefinitionInput(input, context) as unknown as CultureDefinitionV1
}
