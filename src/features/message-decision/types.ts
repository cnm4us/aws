export type MessageDecisionSurface = 'global_feed' | 'group_feed' | 'channel_feed'
export type MessageViewerState = 'anonymous' | 'authenticated_non_subscriber' | 'authenticated_subscriber'

export type MessageDecisionReasonCode =
  | 'eligible'
  | 'no_active_message'
  | 'below_threshold'
  | 'cap_reached'
  | 'cooldown_active'
  | 'no_candidate'
  | 'back_to_back_blocked'

export type MessageDecisionSessionRow = {
  id: number
  session_id: string
  surface: MessageDecisionSurface
  viewer_state: MessageViewerState
  slides_viewed: number
  watch_seconds: number
  messages_shown_this_session: number
  slides_since_last_message: number
  last_message_shown_at: string | null
  converted_message_ids_json: string | null
  last_shown_message_id: number | null
  last_decision_reason: string | null
  created_at: string
  updated_at: string
}

export type MessageDecisionInput = {
  surface: MessageDecisionSurface
  surfaceTarget: {
    groupId: number | null
    channelId: number | null
  }
  sessionId: string
  userId: number | null
  anonVisitorId?: string | null
  viewerState: MessageViewerState
  counters: {
    slidesViewed: number
    watchSeconds: number
    messagesShownThisSession: number
    slidesSinceLastMessage: number
    lastMessageShownAt: string | null
    lastMessageId: number | null
  }
}

export type MessageDecisionResult = {
  shouldInsert: boolean
  messageId: number | null
  insertAfterIndex: number | null
  reasonCode: MessageDecisionReasonCode
  sessionId: string
  debug?: Record<string, unknown>
}
