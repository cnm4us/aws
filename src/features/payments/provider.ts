import { DomainError } from '../../core/errors'
import type {
  PaymentWebhookParsedCompletion,
  PaymentProvider,
  PaymentProviderCheckoutRequest,
  PaymentProviderCheckoutResult,
  PaymentProviderSubscriptionRequest,
  PaymentProviderSubscriptionResult,
  PaymentWebhookVerifyInput,
  PaymentWebhookVerifyResult,
} from './types'

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider
  createCheckoutSession(input: PaymentProviderCheckoutRequest): Promise<PaymentProviderCheckoutResult>
  createSubscriptionSession?(input: PaymentProviderSubscriptionRequest): Promise<PaymentProviderSubscriptionResult>
  verifyWebhook(input: PaymentWebhookVerifyInput): Promise<PaymentWebhookVerifyResult>
  parseCompletion(input: PaymentWebhookVerifyResult): PaymentWebhookParsedCompletion
  cancelSubscription?(input: {
    mode: 'sandbox' | 'live'
    credentials: Record<string, unknown>
    subscriptionId: string
    reason?: string | null
  }): Promise<void>
  resumeSubscription?(input: {
    mode: 'sandbox' | 'live'
    credentials: Record<string, unknown>
    subscriptionId: string
    reason?: string | null
  }): Promise<void>
  changeSubscriptionPlan?(input: {
    mode: 'sandbox' | 'live'
    credentials: Record<string, unknown>
    subscriptionId: string
    providerPlanId: string
  }): Promise<void>
}

const registry = new Map<PaymentProvider, PaymentProviderAdapter>()

export function registerPaymentProvider(adapter: PaymentProviderAdapter): void {
  registry.set(adapter.provider, adapter)
}

export function getPaymentProvider(provider: PaymentProvider): PaymentProviderAdapter {
  const adapter = registry.get(provider)
  if (!adapter) throw new DomainError('payment_provider_not_registered', 'payment_provider_not_registered', 500)
  return adapter
}
