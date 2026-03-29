export type MessageAnalyticsSurface = 'global_feed' | 'group_feed' | 'channel_feed'
export type MessageAnalyticsViewerState = 'anonymous' | 'authenticated'
export type MessageAnalyticsCtaKind = 'primary' | 'secondary' | null

export type MessageAnalyticsInputEvent =
  | 'impression'
  | 'click'
  | 'pass_through'
  | 'dismiss'
  | 'auth_start'
  | 'auth_complete'
  | 'donation_complete'
  | 'subscription_complete'
  | 'upgrade_complete'

export type MessageAnalyticsEventType =
  | 'message_impression'
  | 'message_click'
  | 'message_dismiss'
  | 'auth_start_from_message'
  | 'auth_complete_from_message'
  | 'donation_complete_from_message'
  | 'subscription_complete_from_message'
  | 'upgrade_complete_from_message'

export type MessageAnalyticsEventRow = {
  id: number
  event_type: MessageAnalyticsEventType
  surface: MessageAnalyticsSurface
  viewer_state: MessageAnalyticsViewerState
  session_id: string | null
  user_id: number | null
  message_id: number
  message_campaign_key: string | null
  cta_kind: string | null
  message_cta_slot: number | null
  message_cta_definition_id: number | null
  message_cta_intent_key: string | null
  message_cta_executor_type: string | null
  flow: 'login' | 'register' | 'donate' | 'subscribe' | 'upgrade' | null
  intent_id: string | null
  message_sequence_key: string | null
  attributed: number
  occurred_at: string
  dedupe_bucket_start: string
  dedupe_key: string
  created_at: string
}

export type MessageAnalyticsKpis = {
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

export type MessageAnalyticsMessageRow = {
  messageId: number
  messageName: string | null
  messageType: string | null
  messageCampaignKey: string | null
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

export type MessageAnalyticsDayRow = {
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

export type MessageAnalyticsReport = {
  range: {
    fromDate: string
    toDate: string
    surface: MessageAnalyticsSurface | null
    messageId: number | null
    messageType: string | null
    messageCampaignKey: string | null
    viewerState: MessageAnalyticsViewerState | null
  }
  kpis: MessageAnalyticsKpis
  byMessage: MessageAnalyticsMessageRow[]
  byDay: MessageAnalyticsDayRow[]
}
