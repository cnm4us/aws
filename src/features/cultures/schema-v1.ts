import {
  CULTURE_AI_HINTS,
  CULTURE_DISRUPTION_SIGNALS,
  CULTURE_INTERACTION_STYLES,
  CULTURE_TOLERANCE_LEVELS,
  CULTURE_TONE_EXPECTATIONS,
} from './types'

export const CULTURE_DEFINITION_SCHEMA_V1_ID =
  'https://bawebtech.com/schemas/culture-definition-v1.json'

export const CULTURE_DEFINITION_SCHEMA_V1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: CULTURE_DEFINITION_SCHEMA_V1_ID,
  title: 'Culture Definition v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'version',
    'interaction_style',
    'tone_expectations',
    'disruption_signals',
    'tolerance',
  ],
  properties: {
    id: {
      type: 'string',
      title: 'Culture ID',
      pattern: '^[a-z][a-z0-9_\\-]*$',
      description: 'Stable machine-readable identifier.',
    },
    name: {
      type: 'string',
      title: 'Culture Name',
      minLength: 1,
      description:
        'Human-readable label for admins, logs, and AI traceability. Metadata only; should not be relied on for behavioral interpretation.',
    },
    version: {
      type: 'string',
      title: 'Schema Instance Version',
      pattern: '^v[0-9]+$',
      description: 'Version of this culture definition object.',
    },
    summary: {
      type: 'string',
      title: 'Editor Summary',
      description:
        'Optional short human-readable summary for admin UI and documentation.',
    },
    interaction_style: {
      type: 'string',
      title: 'Interaction Style',
      enum: [...CULTURE_INTERACTION_STYLES],
      description: 'High-level interaction baseline for the culture.',
    },
    tone_expectations: {
      type: 'array',
      title: 'Tone Expectations',
      description: 'Positive tone qualities expected in the culture.',
      items: {
        type: 'string',
        enum: [...CULTURE_TONE_EXPECTATIONS],
      },
      uniqueItems: true,
    },
    disruption_signals: {
      type: 'array',
      title: 'Disruption Signals',
      description:
        'Signals that indicate content is drifting away from the expected culture tone.',
      items: {
        type: 'string',
        enum: [...CULTURE_DISRUPTION_SIGNALS],
      },
      uniqueItems: true,
    },
    tolerance: {
      type: 'object',
      title: 'Tolerance',
      additionalProperties: false,
      required: ['hostility', 'confrontation', 'person_directed_profanity'],
      properties: {
        hostility: {
          type: 'string',
          enum: [...CULTURE_TOLERANCE_LEVELS],
        },
        confrontation: {
          type: 'string',
          enum: [...CULTURE_TOLERANCE_LEVELS],
        },
        person_directed_profanity: {
          type: 'string',
          enum: [...CULTURE_TOLERANCE_LEVELS],
        },
        mockery: {
          type: 'string',
          enum: [...CULTURE_TOLERANCE_LEVELS],
        },
        personal_attacks: {
          type: 'string',
          enum: [...CULTURE_TOLERANCE_LEVELS],
        },
      },
    },
    ai_hint: {
      type: 'string',
      title: 'AI Hint',
      enum: [...CULTURE_AI_HINTS],
      description: 'Optional compact classifier hint for AI. Supplemental only.',
    },
    internal_notes: {
      type: 'string',
      title: 'Internal Notes',
      description:
        'Optional internal admin notes. Not required for AI payload.',
    },
  },
} as const
