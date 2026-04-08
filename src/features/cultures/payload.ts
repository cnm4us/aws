import { type CultureAiPayload, type CultureDefinitionV1 } from './types'

export function buildAiCulturePayload(definition: CultureDefinitionV1): CultureAiPayload {
  const payload: CultureAiPayload = {
    culture: {
      id: definition.id,
      name: definition.name,
      version: definition.version,
      interaction_style: definition.interaction_style,
      tone_expectations: [...definition.tone_expectations],
      disruption_signals: [...definition.disruption_signals],
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
