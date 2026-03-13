export type PromptRuleSurface = 'global_feed'
export type PromptRuleAuthState = 'anonymous'
export type PromptRuleTieBreak = 'random'

export type PromptRuleRow = {
  id: number
  name: string
  enabled: number
  applies_to_surface: PromptRuleSurface
  auth_state: PromptRuleAuthState
  min_slides_viewed: number
  min_watch_seconds: number
  max_prompts_per_session: number
  min_slides_between_prompts: number
  cooldown_seconds_after_prompt: number
  cooldown_seconds_after_dismiss?: number
  prompt_category_allowlist_json: string | null
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
  authState: PromptRuleAuthState
  minSlidesViewed: number
  minWatchSeconds: number
  maxPromptsPerSession: number
  minSlidesBetweenPrompts: number
  cooldownSecondsAfterPrompt: number
  cooldownSecondsAfterDismiss?: number
  promptCategoryAllowlist: string[]
  priority: number
  tieBreakStrategy: PromptRuleTieBreak
  createdBy: number
  updatedBy: number
  createdAt: string
  updatedAt: string
}
