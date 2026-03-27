export type MessageJourneyStatus = 'draft' | 'active' | 'archived'

export type MessageJourneyRow = {
  id: number
  journey_key: string
  name: string
  status: MessageJourneyStatus
  description: string | null
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
  ruleset_id: number | null
  status: MessageJourneyStepStatus
  config_json: string
  created_at: string
  updated_at: string
}

export type MessageJourneyProgressState = 'eligible' | 'shown' | 'clicked' | 'completed' | 'skipped' | 'expired' | 'suppressed'

export type MessageJourneyProgressRow = {
  id: number
  user_id: number
  journey_id: number
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
  name: string
  status: MessageJourneyStatus
  description: string | null
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
  rulesetId: number | null
  status: MessageJourneyStepStatus
  config: Record<string, any>
  createdAt: string
  updatedAt: string
}
