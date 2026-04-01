export type MessageJourneyStatus = 'draft' | 'active' | 'paused' | 'archived'

export type MessageJourneyRow = {
  id: number
  journey_key: string
  campaign_category: string | null
  name: string
  applies_to_surface: 'global_feed' | 'group_feed' | 'channel_feed'
  status: MessageJourneyStatus
  description: string | null
  config_json: string
  eligibility_ruleset_id: number | null
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
}

export type MessageJourneyStepStatus = 'draft' | 'active' | 'archived'

export type MessageJourneyStepRow = {
  id: number
  journey_id: number
  step_key: string
  step_order: number
  message_id: number
  status: MessageJourneyStepStatus
  config_json: string
  created_at: string
  updated_at: string
}

export type MessageJourneyProgressState = 'eligible' | 'shown' | 'clicked' | 'completed' | 'skipped' | 'expired' | 'suppressed'
export type MessageJourneyInstanceIdentityType = 'user' | 'anon'
export type MessageJourneyInstanceState = 'active' | 'completed' | 'abandoned' | 'expired'

export type MessageJourneyInstanceRow = {
  id: number
  journey_id: number
  identity_type: MessageJourneyInstanceIdentityType
  identity_key: string
  journey_subject_id: string | null
  state: MessageJourneyInstanceState
  current_step_id: number | null
  completed_reason: string | null
  completed_event_key: string | null
  first_seen_at: string | null
  last_seen_at: string | null
  completed_at: string | null
  metadata_json: string
  created_at: string
  updated_at: string
}

export type MessageJourneyProgressRow = {
  id: number
  user_id: number
  journey_id: number
  journey_instance_id: number | null
  journey_subject_id: string | null
  step_id: number
  state: MessageJourneyProgressState
  first_seen_at: string | null
  last_seen_at: string | null
  completed_at: string | null
  completed_by_outcome_id: number | null
  session_id: string | null
  metadata_json: string
  created_at: string
  updated_at: string
}

export type MessageJourneyAnonProgressRow = {
  id: number
  anon_visitor_id: string
  journey_id: number
  journey_instance_id: number | null
  journey_subject_id: string | null
  step_id: number
  state: MessageJourneyProgressState
  first_seen_at: string | null
  last_seen_at: string | null
  completed_at: string | null
  completed_by_outcome_id: number | null
  session_id: string | null
  metadata_json: string
  created_at: string
  updated_at: string
}

export type MessageJourneyDto = {
  id: number
  journeyKey: string
  campaignCategory: string | null
  name: string
  appliesToSurface: 'global_feed' | 'group_feed' | 'channel_feed'
  surfaceTargeting: Array<{
    surface: 'global_feed' | 'group_feed' | 'channel_feed'
    targetingMode: 'all' | 'selected'
    targetIds: number[]
  }>
  status: MessageJourneyStatus
  description: string | null
  config: Record<string, any>
  eligibilityRulesetId: number | null
  createdBy: number
  updatedBy: number
  createdAt: string
  updatedAt: string
}

export type MessageJourneyStepDto = {
  id: number
  journeyId: number
  stepKey: string
  stepOrder: number
  messageId: number
  status: MessageJourneyStepStatus
  config: Record<string, any>
  createdAt: string
  updatedAt: string
}

export type MessageJourneyInstanceDto = {
  id: number
  journeyId: number
  identityType: MessageJourneyInstanceIdentityType
  identityKey: string
  journeySubjectId: string | null
  state: MessageJourneyInstanceState
  currentStepId: number | null
  completedReason: string | null
  completedEventKey: string | null
  firstSeenAt: string | null
  lastSeenAt: string | null
  completedAt: string | null
  metadata: Record<string, any>
  createdAt: string
  updatedAt: string
}
