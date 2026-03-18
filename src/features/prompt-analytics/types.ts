export type PromptAnalyticsSurface = 'global_feed'
export type PromptAnalyticsViewerState = 'anonymous' | 'authenticated'
export type PromptAnalyticsCtaKind = 'primary' | 'secondary' | null

export type PromptAnalyticsInputEvent = 'impression' | 'click' | 'pass_through' | 'dismiss' | 'auth_start' | 'auth_complete'

export type PromptAnalyticsEventType =
  | 'prompt_impression'
  | 'prompt_click_primary'
  | 'prompt_click_secondary'
  | 'prompt_dismiss'
  | 'auth_start_from_prompt'
  | 'auth_complete_from_prompt'

export type PromptAnalyticsEventRow = {
  id: number
  event_type: PromptAnalyticsEventType
  surface: PromptAnalyticsSurface
  viewer_state: PromptAnalyticsViewerState
  session_id: string | null
  user_id: number | null
  prompt_id: number
  prompt_campaign_key: string | null
  cta_kind: string | null
  attributed: number
  occurred_at: string
  dedupe_bucket_start: string
  dedupe_key: string
  created_at: string
}

export type PromptAnalyticsKpis = {
  totals: {
    impressions: number
    clicksPrimary: number
    clicksSecondary: number
    clicksTotal: number
    dismiss: number
    authStart: number
    authComplete: number
  }
  uniqueSessions: {
    impressions: number
    clicksTotal: number
    dismiss: number
    authStart: number
    authComplete: number
  }
  rates: {
    ctr: number
    dismissRate: number
    authStartRate: number
    authCompletionRate: number
    completionPerStart: number
  }
}

export type PromptAnalyticsPromptRow = {
  promptId: number
  promptName: string | null
  promptType: string | null
  promptCampaignKey: string | null
  totals: {
    impressions: number
    clicksPrimary: number
    clicksSecondary: number
    clicksTotal: number
    dismiss: number
    authStart: number
    authComplete: number
  }
  uniqueSessions: {
    impressions: number
    clicksTotal: number
    dismiss: number
    authStart: number
    authComplete: number
  }
  rates: {
    ctr: number
    dismissRate: number
    authStartRate: number
    authCompletionRate: number
    completionPerStart: number
  }
}

export type PromptAnalyticsDayRow = {
  dateUtc: string
  totals: {
    impressions: number
    clicksTotal: number
    dismiss: number
    authStart: number
    authComplete: number
  }
  rates: {
    ctr: number
    dismissRate: number
    authStartRate: number
    authCompletionRate: number
  }
}

export type PromptAnalyticsReport = {
  range: {
    fromDate: string
    toDate: string
    surface: PromptAnalyticsSurface | null
    promptId: number | null
    promptType: string | null
    promptCampaignKey: string | null
    viewerState: PromptAnalyticsViewerState | null
  }
  kpis: PromptAnalyticsKpis
  byPrompt: PromptAnalyticsPromptRow[]
  byDay: PromptAnalyticsDayRow[]
}

// Phase F1 compatibility aliases for message terminology.
export type MessageAnalyticsSurface = PromptAnalyticsSurface
export type MessageAnalyticsViewerState = PromptAnalyticsViewerState
export type MessageAnalyticsCtaKind = PromptAnalyticsCtaKind
export type MessageAnalyticsInputEvent = PromptAnalyticsInputEvent
export type MessageAnalyticsEventType = PromptAnalyticsEventType
export type MessageAnalyticsEventRow = PromptAnalyticsEventRow
export type MessageAnalyticsKpis = PromptAnalyticsKpis
export type MessageAnalyticsPromptRow = PromptAnalyticsPromptRow
export type MessageAnalyticsDayRow = PromptAnalyticsDayRow
export type MessageAnalyticsReport = PromptAnalyticsReport
