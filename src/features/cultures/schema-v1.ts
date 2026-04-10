import {
  CULTURE_AI_HINTS,
  CULTURE_CREDIBILITY_EXPECTATIONS,
  CULTURE_CONTENT_BOUNDARY_LEVELS,
  CULTURE_DISCOURSE_MODES,
  CULTURE_EMOTIONAL_INTENSITY_LEVELS,
  CULTURE_INTERACTION_STYLES,
  CULTURE_INTERACTION_MODES,
  CULTURE_SIGNAL_ID_PATTERN,
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
    'discourse_mode',
    'credibility_expectation',
    'interaction_mode',
    'emotional_intensity',
    'tone_expectations',
    'positive_signals',
    'disruption_signals',
    'content_boundaries',
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
    discourse_mode: {
      type: 'string',
      title: 'Discourse Mode',
      enum: [...CULTURE_DISCOURSE_MODES],
      description:
        'Whether the culture expects reasoned structure or allows more performative expression.',
    },
    credibility_expectation: {
      type: 'string',
      title: 'Credibility Expectation',
      enum: [...CULTURE_CREDIBILITY_EXPECTATIONS],
      description: 'Expected level of support signals for factual assertions.',
    },
    interaction_mode: {
      type: 'string',
      title: 'Interaction Mode',
      enum: [...CULTURE_INTERACTION_MODES],
      description:
        'Whether communication is primarily speaker-to-audience, participant-to-participant, or both.',
    },
    emotional_intensity: {
      type: 'string',
      title: 'Emotional Intensity',
      enum: [...CULTURE_EMOTIONAL_INTENSITY_LEVELS],
      description: 'Expected or tolerated level of emotional intensity in delivery.',
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
    positive_signals: {
      type: 'array',
      title: 'Positive Signals',
      description: 'Observable behaviors that align well with this culture.',
      items: {
        type: 'string',
        pattern: CULTURE_SIGNAL_ID_PATTERN,
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
        pattern: CULTURE_SIGNAL_ID_PATTERN,
      },
      uniqueItems: true,
    },
    content_boundaries: {
      type: 'object',
      title: 'Content Boundaries',
      additionalProperties: false,
      required: ['sexual_content', 'graphic_violence', 'strong_language'],
      properties: {
        sexual_content: {
          type: 'string',
          enum: [...CULTURE_CONTENT_BOUNDARY_LEVELS],
        },
        graphic_violence: {
          type: 'string',
          enum: [...CULTURE_CONTENT_BOUNDARY_LEVELS],
        },
        strong_language: {
          type: 'string',
          enum: [...CULTURE_CONTENT_BOUNDARY_LEVELS],
        },
      },
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
