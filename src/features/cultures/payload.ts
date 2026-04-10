import { type CultureAiPayload, type CultureDefinitionV1 } from './types'

export function buildAiCulturePayload(definition: CultureDefinitionV1): CultureAiPayload {
  const payload: CultureAiPayload = {
    culture: {
      id: definition.id,
      name: definition.name,
      version: definition.version,
      interaction_style: definition.interaction_style,
      discourse_mode: definition.discourse_mode,
      credibility_expectation: definition.credibility_expectation,
      interaction_mode: definition.interaction_mode,
      emotional_intensity: definition.emotional_intensity,
      tone_expectations: [...definition.tone_expectations],
      disruption_signals: [...definition.disruption_signals],
      content_boundaries: {
        sexual_content: definition.content_boundaries.sexual_content,
        graphic_violence: definition.content_boundaries.graphic_violence,
        strong_language: definition.content_boundaries.strong_language,
      },
      tolerance: {
        hostility: definition.tolerance.hostility,
        confrontation: definition.tolerance.confrontation,
        person_directed_profanity: definition.tolerance.person_directed_profanity,
        ...(definition.tolerance.mockery ? { mockery: definition.tolerance.mockery } : {}),
        ...(definition.tolerance.personal_attacks
          ? { personal_attacks: definition.tolerance.personal_attacks }
          : {}),
      },
      ...(definition.ai_hint ? { ai_hint: definition.ai_hint } : {}),
    },
  }
  return payload
}
