export type MessageEligibilityRulesetStatus = 'draft' | 'active' | 'archived'

export type MessageEligibilityRuleOp =
  | 'user.is_authenticated'
  | 'support.is_subscriber'
  | 'support.subscription_tier_in'
  | 'support.donated_within_days'
  | 'support.donated_amount_last_days_gte'
  | 'support.completed_intent_in'

export type MessageEligibilityRule =
  | { op: 'user.is_authenticated'; value: boolean }
  | { op: 'support.is_subscriber'; value: boolean }
  | { op: 'support.subscription_tier_in'; value: string[] }
  | { op: 'support.donated_within_days'; value: number }
  | { op: 'support.donated_amount_last_days_gte'; value: { days: number; cents: number } }
  | { op: 'support.completed_intent_in'; value: string[] }

export type MessageEligibilityCriteria = {
  version: 1
  inclusion: MessageEligibilityRule[]
  exclusion: MessageEligibilityRule[]
}

export type MessageEligibilityRulesetRow = {
  id: number
  name: string
  status: MessageEligibilityRulesetStatus
  description: string | null
  criteria_json: string
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
}

export type MessageEligibilityRulesetDto = {
  id: number
  name: string
  status: MessageEligibilityRulesetStatus
  description: string | null
  criteria: MessageEligibilityCriteria
  createdBy: number
  updatedBy: number
  createdAt: string
  updatedAt: string
}
