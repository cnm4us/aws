export type PromptRuleSurface = 'global_feed'
export type PromptAudienceSegment = 'anonymous' | 'authenticated_non_subscriber' | 'authenticated_subscriber'
export type PromptType =
  | 'register_login'
  | 'fund_drive'
  | 'subscription_upgrade'
  | 'sponsor_message'
  | 'feature_announcement'
export type PromptRuleTieBreak = 'random'

export type PromptRuleRow = {
  id: number
  name: string
  enabled: number
  applies_to_surface: PromptRuleSurface
  audience_segment: PromptAudienceSegment
  prompt_type: PromptType
  min_slides_viewed: number
  min_watch_seconds: number
  priority: number
  tie_break_strategy: PromptRuleTieBreak
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
}

export type PromptRuleDto = {
  id: number
  name: string
  enabled: boolean
  appliesToSurface: PromptRuleSurface
  audienceSegment: PromptAudienceSegment
  promptType: PromptType
  minSlidesViewed: number
  minWatchSeconds: number
  priority: number
  tieBreakStrategy: PromptRuleTieBreak
  createdBy: number
  updatedBy: number
  createdAt: string
  updatedAt: string
}
