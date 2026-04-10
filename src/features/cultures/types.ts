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
  'inclusive',
  'empathetic',
  'constructive',
  'measured',
  'informational',
  'playful',
  'direct',
  'rigorous',
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
export const CULTURE_CONTENT_BOUNDARY_LEVELS = ['restricted', 'moderate', 'open'] as const
export const CULTURE_DISCOURSE_MODES = ['structured', 'expressive'] as const
export const CULTURE_CREDIBILITY_EXPECTATIONS = ['low', 'medium', 'high'] as const
export const CULTURE_INTERACTION_MODES = ['broadcast', 'discussion', 'mixed'] as const
export const CULTURE_EMOTIONAL_INTENSITY_LEVELS = ['low', 'medium', 'high'] as const

export const CULTURE_AI_HINTS = [
  'low_conflict_environment',
  'supportive_environment',
  'debate_environment',
  'expert_environment',
  'news_environment',
  'satire_environment',
  'open_expression_environment',
] as const

export type CultureInteractionStyle = (typeof CULTURE_INTERACTION_STYLES)[number]
export type CultureToneExpectation = (typeof CULTURE_TONE_EXPECTATIONS)[number]
export type CultureDisruptionSignal = (typeof CULTURE_DISRUPTION_SIGNALS)[number]
export type CultureToleranceLevel = (typeof CULTURE_TOLERANCE_LEVELS)[number]
export type CultureContentBoundaryLevel = (typeof CULTURE_CONTENT_BOUNDARY_LEVELS)[number]
export type CultureDiscourseMode = (typeof CULTURE_DISCOURSE_MODES)[number]
export type CultureCredibilityExpectation = (typeof CULTURE_CREDIBILITY_EXPECTATIONS)[number]
export type CultureInteractionMode = (typeof CULTURE_INTERACTION_MODES)[number]
export type CultureEmotionalIntensityLevel = (typeof CULTURE_EMOTIONAL_INTENSITY_LEVELS)[number]
export type CultureAiHint = (typeof CULTURE_AI_HINTS)[number]

export type CultureDefinitionVersion = `v${number}`

export type CultureTolerance = {
  hostility: CultureToleranceLevel
  confrontation: CultureToleranceLevel
  person_directed_profanity: CultureToleranceLevel
  mockery?: CultureToleranceLevel
  personal_attacks?: CultureToleranceLevel
}

export type CultureContentBoundaries = {
  sexual_content: CultureContentBoundaryLevel
  graphic_violence: CultureContentBoundaryLevel
  strong_language: CultureContentBoundaryLevel
}

export type CultureDefinitionV1 = {
  id: string
  name: string
  version: CultureDefinitionVersion
  summary?: string
  interaction_style: CultureInteractionStyle
  discourse_mode: CultureDiscourseMode
  credibility_expectation: CultureCredibilityExpectation
  interaction_mode: CultureInteractionMode
  emotional_intensity: CultureEmotionalIntensityLevel
  tone_expectations: CultureToneExpectation[]
  disruption_signals: CultureDisruptionSignal[]
  content_boundaries: CultureContentBoundaries
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
    discourse_mode: CultureDiscourseMode
    credibility_expectation: CultureCredibilityExpectation
    interaction_mode: CultureInteractionMode
    emotional_intensity: CultureEmotionalIntensityLevel
    tone_expectations: CultureToneExpectation[]
    disruption_signals: CultureDisruptionSignal[]
    content_boundaries: CultureContentBoundaries
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
