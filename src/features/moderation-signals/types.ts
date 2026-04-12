export const MODERATION_SIGNAL_STATUSES = [
  'draft',
  'active',
  'inactive',
  'archived',
] as const

export type ModerationSignalStatus = (typeof MODERATION_SIGNAL_STATUSES)[number]

export const MODERATION_SIGNAL_POLARITIES = [
  'positive',
  'disruptive',
] as const

export type ModerationSignalPolarity = (typeof MODERATION_SIGNAL_POLARITIES)[number]

export const MODERATION_SIGNAL_POSITIVE_FAMILIES = [
  'clarity',
  'engagement',
  'reasoning',
  'tone_positive',
] as const

export const MODERATION_SIGNAL_DISRUPTIVE_FAMILIES = [
  'discourse_tone',
  'discourse_quality',
  'targeting',
  'aggression',
  'safety_harm',
  'privacy_identity',
  'sexual_exploitation',
  'credibility',
] as const

export const MODERATION_SIGNAL_FAMILIES = [
  ...MODERATION_SIGNAL_POSITIVE_FAMILIES,
  ...MODERATION_SIGNAL_DISRUPTIVE_FAMILIES,
] as const

export type ModerationSignalFamily = (typeof MODERATION_SIGNAL_FAMILIES)[number]

const MODERATION_SIGNAL_FAMILIES_BY_POLARITY: Record<
  ModerationSignalPolarity,
  readonly ModerationSignalFamily[]
> = {
  positive: MODERATION_SIGNAL_POSITIVE_FAMILIES,
  disruptive: MODERATION_SIGNAL_DISRUPTIVE_FAMILIES,
}

export function getAllowedSignalFamiliesForPolarity(
  polarity: ModerationSignalPolarity
): readonly ModerationSignalFamily[] {
  return MODERATION_SIGNAL_FAMILIES_BY_POLARITY[polarity]
}

export type ModerationSignalRecord = {
  signal_id: string
  label: string
  short_description: string | null
  long_description: string | null
  polarity: ModerationSignalPolarity
  signal_family: ModerationSignalFamily
  status: ModerationSignalStatus
  metadata_json: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
}

export type ModerationSignalUsageCounts = {
  rules: number
  culture_positive: number
  culture_disruption: number
  future_mappings: number
  total: number
}

export type ModerationSignalWithUsage = ModerationSignalRecord & {
  usage_counts: ModerationSignalUsageCounts
}

export type ModerationSignalRuleUsage = {
  id: number
  slug: string
  title: string
  current_version: number | null
}

export type ModerationSignalCultureUsage = {
  id: number
  name: string
}

export type ModerationSignalUsageDetail = {
  rules: ModerationSignalRuleUsage[]
  culture_positive: ModerationSignalCultureUsage[]
  culture_disruption: ModerationSignalCultureUsage[]
}

export type ModerationSignalUpsertInput = {
  signal_id: string
  label: string
  short_description?: string | null
  long_description?: string | null
  polarity?: ModerationSignalPolarity | null
  signal_family?: ModerationSignalFamily | null
  status?: ModerationSignalStatus
  metadata_json?: Record<string, unknown> | null
}

export type ModerationSignalSeed = Required<Pick<
  ModerationSignalUpsertInput,
  'signal_id' | 'label' | 'status'
>> & Omit<ModerationSignalUpsertInput, 'signal_id' | 'label' | 'status'>

export type ModerationSignalClassificationSnapshot = {
  signal_id: string
  label: string
  polarity: string | null
  signal_family: string | null
  metadata_json: Record<string, unknown> | null
}

export type ModerationSignalClassificationGap = {
  signal_id: string
  label: string
  reason: 'missing_classification'
}

export type ModerationSignalClassificationCoverage = {
  total: number
  classified: number
  missing_polarity: number
  missing_signal_family: number
  missing_any: number
  unresolved: ModerationSignalClassificationGap[]
}

export type ModerationSignalClassificationBackfillResult = {
  total: number
  updated: number
  unchanged: number
  coverage: ModerationSignalClassificationCoverage
  deferred_signal_id_aliases: string[]
}
