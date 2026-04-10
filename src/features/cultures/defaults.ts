import {
  type CultureDefinitionMetadataContext,
  type CultureDefinitionV1,
  type CultureDefinitionVersion,
} from './types'
import { deriveCultureDefinitionIdFromKey } from './normalize'

export function createDefaultCultureDefinitionV1(
  context: CultureDefinitionMetadataContext = {}
): CultureDefinitionV1 {
  const version: CultureDefinitionVersion = context.defaultVersion || 'v1'
  const name = String(context.cultureName || 'Untitled Culture').trim() || 'Untitled Culture'
  const id = deriveCultureDefinitionIdFromKey(
    String(context.cultureKey || context.cultureName || 'culture')
  )

  return {
    id,
    name,
    version,
    summary: '',
    interaction_style: 'mixed',
    tone_expectations: [],
    disruption_signals: [],
    tolerance: {
      hostility: 'medium',
      confrontation: 'medium',
      person_directed_profanity: 'medium',
    },
    ai_hint: 'open_expression_environment',
    internal_notes: '',
  }
}
