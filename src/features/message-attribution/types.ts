export type MessageAttributionSurface = 'global_feed' | 'group_feed' | 'channel_feed'
export type MessageAttributionViewerState = 'anonymous' | 'authenticated'
export type MessageAttributionFlow = 'login' | 'register'
export type MessageAttributionIntentState = 'created' | 'started' | 'completed' | 'expired'
export type MessageSuppressionScope = 'message' | 'campaign'
export type MessageSuppressionReason = 'auth_complete' | 'flow_complete'

export type MessageAuthIntentRow = {
  intent_id: string
  flow: MessageAttributionFlow
  state: MessageAttributionIntentState
  surface: MessageAttributionSurface
  message_id: number
  message_campaign_key: string | null
  message_session_id: string | null
  message_sequence_key: string | null
  viewer_state: MessageAttributionViewerState
  anon_key: string | null
  user_id: number | null
  expires_at: string | null
  consumed_at: string | null
  created_at: string
  updated_at: string
}

export type MessageSuppressionRow = {
  id: number
  user_id: number
  scope: MessageSuppressionScope
  suppression_key: string
  message_id: number | null
  campaign_key: string | null
  reason: MessageSuppressionReason
  source_intent_id: string | null
  created_at: string
  updated_at: string
}
