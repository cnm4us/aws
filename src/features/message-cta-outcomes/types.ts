export type MessageCtaOutcomeType =
  | 'click'
  | 'return'
  | 'verified_complete'
  | 'webhook_complete'
  | 'failed'
  | 'abandoned'

export type MessageCtaOutcomeStatus = 'pending' | 'success' | 'failure'

export type MessageDeliveryContext = 'standalone' | 'journey'

export type MessageCtaOutcomeRow = {
  id: number
  outcome_id: string
  source_event_id: number | null
  source_event_type: string
  outcome_type: MessageCtaOutcomeType
  outcome_status: MessageCtaOutcomeStatus
  occurred_at: string
  session_id: string | null
  user_id: number | null
  message_id: number
  message_campaign_key: string | null
  delivery_context: MessageDeliveryContext
  journey_id: number | null
  journey_step_id: number | null
  cta_slot: number | null
  cta_definition_id: number | null
  cta_intent_key: string | null
  cta_executor_type: string | null
  payload_json: string
  created_at: string
  updated_at: string
}

