import {
  getAllowedSignalFamiliesForPolarity,
  type ModerationSignalFamily,
  type ModerationSignalPolarity,
} from './types'

export type ModerationSignalClassification = {
  polarity: ModerationSignalPolarity
  signal_family: ModerationSignalFamily
}

export const DEFERRED_SIGNAL_ID_ALIAS_CANDIDATES = [
  'aggressive_command',
  'curious_question',
  'encouraging_response',
  'helpful_suggestion',
] as const

const KNOWN_SIGNAL_CLASSIFICATIONS: Record<string, ModerationSignalClassification> = {
  clear_explanation: { polarity: 'positive', signal_family: 'clarity' },
  clear_fact_opinion_separation: { polarity: 'positive', signal_family: 'clarity' },
  evidence_reference: { polarity: 'positive', signal_family: 'reasoning' },
  source_attribution: { polarity: 'positive', signal_family: 'reasoning' },
  reasoned_argument: { polarity: 'positive', signal_family: 'reasoning' },
  curious_questions: { polarity: 'positive', signal_family: 'engagement' },
  curious_question: { polarity: 'positive', signal_family: 'engagement' },
  respectful_disagreement: { polarity: 'positive', signal_family: 'engagement' },
  measured_delivery: { polarity: 'positive', signal_family: 'tone_positive' },
  friendly_sharing: { polarity: 'positive', signal_family: 'tone_positive' },
  welcoming_language: { polarity: 'positive', signal_family: 'tone_positive' },
  supportive_acknowledgment: { polarity: 'positive', signal_family: 'tone_positive' },
  encouraging_responses: { polarity: 'positive', signal_family: 'tone_positive' },
  encouraging_response: { polarity: 'positive', signal_family: 'tone_positive' },
  lighthearted_engagement: { polarity: 'positive', signal_family: 'engagement' },
  playful_exaggeration: { polarity: 'positive', signal_family: 'engagement' },
  clearly_signaled_satire: { polarity: 'positive', signal_family: 'engagement' },
  helpful_suggestions: { polarity: 'positive', signal_family: 'reasoning' },
  helpful_suggestion: { polarity: 'positive', signal_family: 'reasoning' },

  dismissive_language: { polarity: 'disruptive', signal_family: 'discourse_tone' },
  contemptuous_tone: { polarity: 'disruptive', signal_family: 'discourse_tone' },
  degrading_sarcasm: { polarity: 'disruptive', signal_family: 'discourse_tone' },
  mocking_targeted_participant: { polarity: 'disruptive', signal_family: 'targeting' },
  insult_like_framing: { polarity: 'disruptive', signal_family: 'targeting' },
  shaming_language: { polarity: 'disruptive', signal_family: 'targeting' },
  needless_escalation: { polarity: 'disruptive', signal_family: 'aggression' },
  provocative_derailment: { polarity: 'disruptive', signal_family: 'discourse_quality' },
  repeated_confrontation: { polarity: 'disruptive', signal_family: 'aggression' },
  bad_faith_argumentation: { polarity: 'disruptive', signal_family: 'discourse_quality' },
  unsupported_factual_assertion: { polarity: 'disruptive', signal_family: 'credibility' },
  absence_of_attribution: { polarity: 'disruptive', signal_family: 'credibility' },
  aggressive_commands: { polarity: 'disruptive', signal_family: 'aggression' },
  aggressive_command: { polarity: 'disruptive', signal_family: 'aggression' },
  audience_incitement_style_framing: { polarity: 'disruptive', signal_family: 'aggression' },
  person_directed_hostility: { polarity: 'disruptive', signal_family: 'targeting' },

  qualified_language: { polarity: 'positive', signal_family: 'clarity' },
  assertive_language: { polarity: 'disruptive', signal_family: 'credibility' },
  direct_identifiers: { polarity: 'disruptive', signal_family: 'privacy_identity' },
  indirect_identifiers: { polarity: 'disruptive', signal_family: 'privacy_identity' },
  factual_assertion: { polarity: 'positive', signal_family: 'reasoning' },
}

export function getKnownSignalClassification(
  signalId: string
): ModerationSignalClassification | null {
  const normalized = String(signalId || '').trim().toLowerCase()
  return KNOWN_SIGNAL_CLASSIFICATIONS[normalized] || null
}

export function inferSignalClassificationFromMetadata(
  metadata: Record<string, unknown> | null
): ModerationSignalClassification | null {
  if (!metadata) return null
  const cultureRoles = Array.isArray(metadata.culture_roles)
    ? metadata.culture_roles.map((value) => String(value || '').trim().toLowerCase())
    : []
  if (cultureRoles.includes('positive')) {
    return { polarity: 'positive', signal_family: 'tone_positive' }
  }
  if (cultureRoles.includes('disruption')) {
    return { polarity: 'disruptive', signal_family: 'discourse_quality' }
  }

  const seedSources = Array.isArray(metadata.seed_sources)
    ? metadata.seed_sources.map((value) => String(value || '').trim().toLowerCase())
    : []
  if (seedSources.includes('culture_positive')) {
    return { polarity: 'positive', signal_family: 'tone_positive' }
  }
  if (seedSources.includes('culture_disruption')) {
    return { polarity: 'disruptive', signal_family: 'discourse_quality' }
  }

  const backfilledFrom = String(metadata.backfilled_from || '').trim().toLowerCase()
  if (backfilledFrom.includes('positive')) {
    return { polarity: 'positive', signal_family: 'tone_positive' }
  }
  if (backfilledFrom.includes('disruption')) {
    return { polarity: 'disruptive', signal_family: 'discourse_quality' }
  }

  return null
}

export function deriveSignalClassification(input: {
  signalId: string
  metadataJson?: Record<string, unknown> | null
  polarity?: string | null
  signalFamily?: string | null
}): ModerationSignalClassification | null {
  const polarity = String(input.polarity || '').trim().toLowerCase()
  const signalFamily = String(input.signalFamily || '').trim().toLowerCase()
  if (
    (polarity === 'positive' || polarity === 'disruptive') &&
    getAllowedSignalFamiliesForPolarity(polarity as ModerationSignalPolarity).includes(
      signalFamily as ModerationSignalFamily
    )
  ) {
    return {
      polarity: polarity as ModerationSignalPolarity,
      signal_family: signalFamily as ModerationSignalFamily,
    }
  }

  return (
    getKnownSignalClassification(input.signalId) ||
    inferSignalClassificationFromMetadata(input.metadataJson || null)
  )
}

export function listDeferredSignalIdAliases(signalIds: Iterable<string>): string[] {
  const seen = new Set<string>()
  const candidates = new Set<string>(DEFERRED_SIGNAL_ID_ALIAS_CANDIDATES)
  for (const rawSignalId of signalIds) {
    const signalId = String(rawSignalId || '').trim().toLowerCase()
    if (signalId && candidates.has(signalId)) seen.add(signalId)
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}
