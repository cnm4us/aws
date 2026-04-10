export const MODERATION_SIGNAL_STATUSES = [
  'draft',
  'active',
  'inactive',
  'archived',
] as const

export type ModerationSignalStatus = (typeof MODERATION_SIGNAL_STATUSES)[number]

export type ModerationSignalRecord = {
  signal_id: string
  label: string
  short_description: string | null
  long_description: string | null
  status: ModerationSignalStatus
  metadata_json: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
}

export type ModerationSignalUsageCounts = {
  rules: number
  culture_positive: number
  culture_disruption: number
  total: number
}

export type ModerationSignalWithUsage = ModerationSignalRecord & {
  usage_counts: ModerationSignalUsageCounts
}

export type ModerationSignalUpsertInput = {
  signal_id: string
  label: string
  short_description?: string | null
  long_description?: string | null
  status?: ModerationSignalStatus
  metadata_json?: Record<string, unknown> | null
}

export type ModerationSignalSeed = Required<Pick<
  ModerationSignalUpsertInput,
  'signal_id' | 'label' | 'status'
>> & Omit<ModerationSignalUpsertInput, 'signal_id' | 'label' | 'status'>
