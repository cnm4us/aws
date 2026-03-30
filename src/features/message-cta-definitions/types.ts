export type MessageCtaDefinitionStatus = 'draft' | 'active' | 'archived'
export type MessageCtaScopeType = 'global' | 'space'

export type MessageCtaIntentKey =
  | 'support'
  | 'defer'
  | 'login'
  | 'register'
  | 'donate'
  | 'subscribe'
  | 'upgrade'
  | 'verify_email'
  | 'verify_phone'
  | 'visit_sponsor'
  | 'visit_link'

export type MessageCtaExecutorType =
  | 'internal_link'
  | 'provider_checkout'
  | 'verification_flow'
  | 'api_action'
  | 'advance_slide'

export type MessageCtaCompletionContract =
  | 'on_click'
  | 'on_return'
  | 'on_verified'
  | 'none'

export type MessageCtaProvider = 'mock' | 'paypal' | 'stripe' | 'square'

export type MessageCtaInternalLinkConfig = {
  href: string
  successReturn?: string | null
  openInNewTab?: boolean
}

export type MessageCtaProviderCheckoutConfig = {
  provider: MessageCtaProvider
  mode: 'donate' | 'subscribe' | 'upgrade'
  returnUrl: string
  cancelUrl?: string | null
  campaignKey?: string | null
  planKey?: string | null
}

export type MessageCtaVerificationFlowConfig = {
  method: 'email' | 'phone' | 'identity'
  startPath: string
  successReturn?: string | null
}

export type MessageCtaApiActionConfig = {
  endpointPath: string
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  successReturn?: string | null
}

export type MessageCtaAdvanceSlideConfig = {
  mode?: 'next_slide'
}

export type MessageCtaDefinitionConfig =
  | MessageCtaInternalLinkConfig
  | MessageCtaProviderCheckoutConfig
  | MessageCtaVerificationFlowConfig
  | MessageCtaApiActionConfig
  | MessageCtaAdvanceSlideConfig

export type MessageCtaDefinitionRow = {
  id: number
  name: string
  status: MessageCtaDefinitionStatus
  scope_type: MessageCtaScopeType
  scope_space_id: number | null
  intent_key: MessageCtaIntentKey
  executor_type: MessageCtaExecutorType
  completion_contract: MessageCtaCompletionContract
  label_default: string
  config_json: string
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
}

export type MessageCtaDefinitionDto = {
  id: number
  name: string
  status: MessageCtaDefinitionStatus
  scopeType: MessageCtaScopeType
  scopeSpaceId: number | null
  intentKey: MessageCtaIntentKey
  executorType: MessageCtaExecutorType
  completionContract: MessageCtaCompletionContract
  labelDefault: string
  config: MessageCtaDefinitionConfig
  createdBy: number
  updatedBy: number
  createdAt: string
  updatedAt: string
}

export type MessageCtaRuntimeResolution = {
  definitionId: number
  intentKey: MessageCtaIntentKey
  executorType: MessageCtaExecutorType
  completionContract: MessageCtaCompletionContract
  label: string
  executorConfig: MessageCtaDefinitionConfig
}
