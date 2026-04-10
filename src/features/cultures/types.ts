export const CULTURE_INTERACTION_STYLES = [
  'low_conflict',
  'supportive',
  'debate',
  'structured',
  'broadcast',
  'playful',
  'mixed',
] as const

export const CULTURE_TONE_EXPECTATIONS = [
  'welcoming',
  'respectful',
  'non_confrontational',
  'friendly',
  'calm',
  'constructive',
  'light',
  'courteous',
  'patient',
  'inclusive',
] as const

export const CULTURE_DISRUPTION_SIGNALS = [
  'person_directed_hostility',
  'dismissive_language',
  'aggressive_commands',
  'needless_escalation',
  'taunting',
  'contemptuous_tone',
  'mocking_targeted_participant',
  'shaming_language',
  'insult_like_framing',
  'repeated_confrontation',
] as const

export const CULTURE_TOLERANCE_LEVELS = ['very_low', 'low', 'medium', 'high'] as const

export const CULTURE_AI_HINTS = [
  'low_conflict_environment',
  'supportive_environment',
  'adversarial_environment',
  'debate_environment',
  'professional_environment',
  'mixed_environment',
] as const

export type CultureInteractionStyle = (typeof CULTURE_INTERACTION_STYLES)[number]
export type CultureToneExpectation = (typeof CULTURE_TONE_EXPECTATIONS)[number]
export type CultureDisruptionSignal = (typeof CULTURE_DISRUPTION_SIGNALS)[number]
export type CultureToleranceLevel = (typeof CULTURE_TOLERANCE_LEVELS)[number]
export type CultureAiHint = (typeof CULTURE_AI_HINTS)[number]

export type CultureDefinitionVersion = `v${number}`

export type CultureTolerance = {
  hostility: CultureToleranceLevel
  confrontation: CultureToleranceLevel
  person_directed_profanity: CultureToleranceLevel
  mockery?: CultureToleranceLevel
  personal_attacks?: CultureToleranceLevel
}

export type CultureDefinitionV1 = {
  id: string
  name: string
  version: CultureDefinitionVersion
  summary?: string
  interaction_style: CultureInteractionStyle
  tone_expectations: CultureToneExpectation[]
  disruption_signals: CultureDisruptionSignal[]
  tolerance: CultureTolerance
  ai_hint?: CultureAiHint
  internal_notes?: string
}

export type CultureDefinitionInput = Partial<CultureDefinitionV1> & Record<string, unknown>

export type CultureDefinitionMetadataContext = {
  cultureKey?: string | null
  cultureName?: string | null
  defaultVersion?: CultureDefinitionVersion
}

export type CultureAiPayload = {
  culture: {
    id: string
    name: string
    version: CultureDefinitionVersion
    interaction_style: CultureInteractionStyle
    tone_expectations: CultureToneExpectation[]
    disruption_signals: CultureDisruptionSignal[]
    tolerance: CultureTolerance
    ai_hint?: CultureAiHint
  }
}

export type CultureDefinitionValidationError = {
  path: string
  keyword: string
  message: string
}

export type CultureDefinitionValidationResult =
  | { ok: true; value: CultureDefinitionV1 }
  | { ok: false; errors: CultureDefinitionValidationError[] }
