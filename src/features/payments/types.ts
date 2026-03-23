export type PaymentProvider = 'paypal'
export type PaymentMode = 'sandbox' | 'live'
export type PaymentIntent = 'donate' | 'subscribe'

export type PaymentProviderConfigStatus = 'disabled' | 'enabled'
export type PaymentCatalogKind = 'donate_campaign' | 'subscribe_plan'
export type PaymentCatalogStatus = 'draft' | 'active' | 'archived'
export type PaymentCheckoutStatus = 'pending' | 'redirected' | 'completed' | 'failed' | 'canceled' | 'expired'
export type PaymentWebhookProcessingState = 'pending' | 'processed' | 'ignored' | 'failed'

export type PaymentProviderConfigRow = {
  id: number
  provider: PaymentProvider
  mode: PaymentMode
  status: PaymentProviderConfigStatus
  donate_enabled: number
  subscribe_enabled: number
  credentials_json: string
  webhook_id: string | null
  webhook_secret: string | null
  notes: string | null
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
}

export type PaymentCatalogItemRow = {
  id: number
  kind: PaymentCatalogKind
  item_key: string
  label: string
  status: PaymentCatalogStatus
  amount_cents: number | null
  currency: string
  provider: PaymentProvider
  provider_ref: string | null
  config_json: string
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
}

export type PaymentCheckoutSessionRow = {
  id: number
  checkout_id: string
  provider: PaymentProvider
  mode: PaymentMode
  intent: PaymentIntent
  status: PaymentCheckoutStatus
  user_id: number | null
  message_id: number | null
  message_campaign_key: string | null
  message_intent_id: string | null
  message_cta_definition_id: number | null
  catalog_item_id: number | null
  amount_cents: number | null
  currency: string
  provider_session_id: string | null
  provider_order_id: string | null
  return_url: string | null
  cancel_url: string | null
  metadata_json: string
  completed_at: string | null
  failed_at: string | null
  expired_at: string | null
  created_at: string
  updated_at: string
}

export type PaymentWebhookEventRow = {
  id: number
  provider: PaymentProvider
  mode: PaymentMode
  provider_event_id: string | null
  event_type: string
  dedupe_key: string
  signature_valid: number
  processing_state: PaymentWebhookProcessingState
  error_message: string | null
  payload_json: string
  headers_json: string | null
  received_at: string
  processed_at: string | null
  created_at: string
}

export type CreateCheckoutSessionInput = {
  provider: PaymentProvider
  mode: PaymentMode
  intent: PaymentIntent
  userId?: number | null
  messageId?: number | null
  messageCampaignKey?: string | null
  messageIntentId?: string | null
  messageCtaDefinitionId?: number | null
  catalogItemId?: number | null
  amountCents?: number | null
  currency?: string
  returnUrl?: string | null
  cancelUrl?: string | null
  metadata?: Record<string, unknown>
}

export type PaymentProviderCheckoutRequest = {
  checkoutId: string
  mode: PaymentMode
  intent: PaymentIntent
  credentials: Record<string, unknown>
  amountCents: number | null
  currency: string
  returnUrl: string | null
  cancelUrl: string | null
  metadata: Record<string, unknown>
}

export type PaymentProviderCheckoutResult = {
  providerSessionId: string
  redirectUrl: string
  providerOrderId?: string | null
}

export type PaymentWebhookVerifyInput = {
  mode: PaymentMode
  credentials: Record<string, unknown>
  webhookId: string | null
  webhookSecret: string | null
  headers: Record<string, string | string[] | undefined>
  rawBody: string
}

export type PaymentWebhookVerifyResult = {
  valid: boolean
  providerEventId: string | null
  eventType: string
  payload: Record<string, unknown>
  dedupeSource: string
}

export type PaymentWebhookParsedCompletion = {
  checkoutStatus: PaymentCheckoutStatus | null
  providerSessionId: string | null
  providerOrderId: string | null
  providerSubscriptionId: string | null
  outcomeReason: string | null
}
