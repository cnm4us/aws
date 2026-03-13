export type PromptDecisionSurface = 'global_feed'
export type PromptViewerState = 'anonymous' | 'authenticated'

export type PromptDecisionReasonCode =
  | 'eligible'
  | 'viewer_authenticated'
  | 'no_enabled_rule'
  | 'below_threshold'
  | 'cap_reached'
  | 'cooldown_active'
  | 'no_candidate'
  | 'back_to_back_blocked'

export type PromptDecisionSessionRow = {
  id: number
  session_id: string
  surface: PromptDecisionSurface
  viewer_state: PromptViewerState
  slides_viewed: number
  watch_seconds: number
  prompts_shown_this_session: number
  slides_since_last_prompt: number
  last_prompt_shown_at: string | null
  last_prompt_dismissed_at?: string | null
  last_shown_prompt_id: number | null
  last_decision_reason: string | null
  created_at: string
  updated_at: string
}

export type PromptDecisionInput = {
  surface: PromptDecisionSurface
  sessionId: string
  viewerState: PromptViewerState
  counters: {
    slidesViewed: number
    watchSeconds: number
    promptsShownThisSession: number
    slidesSinceLastPrompt: number
    lastPromptShownAt: string | null
    lastPromptId: number | null
  }
}

export type PromptDecisionResult = {
  shouldInsert: boolean
  promptId: number | null
  insertAfterIndex: number | null
  reasonCode: PromptDecisionReasonCode
  ruleId: number | null
  ruleName: string | null
  sessionId: string
  debug?: Record<string, unknown>
}
