import {
  validateCultureDefinitionV1,
  buildAiCulturePayload,
  createDefaultCultureDefinitionV1,
} from '../src/features/cultures'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

const baseline = {
  id: 'pleasant_spaces',
  name: 'Pleasant Spaces',
  version: 'v1',
  summary:
    'Low-conflict environments for casual, enjoyable, and welcoming interaction.',
  interaction_style: 'low_conflict',
  tone_expectations: [
    'welcoming',
    'respectful',
    'non_confrontational',
    'friendly',
    'calm',
    'constructive',
  ],
  disruption_signals: [
    'person_directed_hostility',
    'dismissive_language',
    'aggressive_commands',
    'needless_escalation',
    'contemptuous_tone',
    'insult_like_framing',
  ],
  tolerance: {
    hostility: 'very_low',
    confrontation: 'low',
    person_directed_profanity: 'very_low',
    mockery: 'low',
    personal_attacks: 'very_low',
  },
  ai_hint: 'low_conflict_environment',
  internal_notes: 'Testing baseline object.',
}

const valid = validateCultureDefinitionV1(baseline)
assert(valid.ok, `Expected baseline object to validate: ${JSON.stringify((valid as any).errors || [])}`)

if (valid.ok) {
  const payload = buildAiCulturePayload(valid.value)
  assert(payload.culture.id === 'pleasant_spaces', 'Payload should preserve culture id')
  assert(!('summary' in (payload.culture as any)), 'Payload should exclude summary')
  assert(!('internal_notes' in (payload.culture as any)), 'Payload should exclude internal notes')
}

const invalidUnknown = validateCultureDefinitionV1({
  ...baseline,
  unknown_key: 'x',
})
assert(!invalidUnknown.ok, 'Expected additionalProperties validation failure')

const invalidEnum = validateCultureDefinitionV1({
  ...baseline,
  interaction_style: 'hostile',
})
assert(!invalidEnum.ok, 'Expected enum validation failure')

const defaultObj = createDefaultCultureDefinitionV1({
  cultureName: 'Pleasant Spaces',
  cultureKey: 'pleasant_spaces',
})
const defaultValidation = validateCultureDefinitionV1(defaultObj)
assert(defaultValidation.ok, 'Expected default object to validate')

console.log('[culture-definition-v1-smoke] ok')
