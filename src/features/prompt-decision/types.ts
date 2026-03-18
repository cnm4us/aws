export type PromptDecisionSurface = 'global_feed'
export type PromptAudienceSegment = 'anonymous' | 'authenticated_non_subscriber' | 'authenticated_subscriber'

export type PromptDecisionReasonCode =
  | 'eligible'
  | 'no_active_prompt'
  | 'below_threshold'
  | 'cap_reached'
  | 'cooldown_active'
  | 'no_candidate'
  | 'back_to_back_blocked'

export type PromptDecisionSessionRow = {
  id: number
  session_id: string
  surface: PromptDecisionSurface
  viewer_state: PromptAudienceSegment
  slides_viewed: number
  watch_seconds: number
  prompts_shown_this_session: number
  slides_since_last_prompt: number
  last_prompt_shown_at: string | null
  converted_prompt_ids_json: string | null
  last_shown_prompt_id: number | null
  last_decision_reason: string | null
  created_at: string
  updated_at: string
}

export type PromptDecisionInput = {
  surface: PromptDecisionSurface
  sessionId: string
  audienceSegment: PromptAudienceSegment
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
  sessionId: string
  debug?: Record<string, unknown>
}

// Phase F1 compatibility aliases for message terminology.
export type MessageDecisionSurface = PromptDecisionSurface
export type MessageDecisionAudienceSegment = PromptAudienceSegment
export type MessageDecisionReasonCode = PromptDecisionReasonCode
export type MessageDecisionSessionRow = PromptDecisionSessionRow
export type MessageDecisionInput = PromptDecisionInput
export type MessageDecisionResult = PromptDecisionResult
