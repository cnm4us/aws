import { DomainError } from '../../core/errors'
import type {
  PaymentProvider,
  PaymentProviderCheckoutRequest,
  PaymentProviderCheckoutResult,
  PaymentWebhookVerifyInput,
  PaymentWebhookVerifyResult,
} from './types'

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider
  createCheckoutSession(input: PaymentProviderCheckoutRequest): Promise<PaymentProviderCheckoutResult>
  verifyWebhook(input: PaymentWebhookVerifyInput): Promise<PaymentWebhookVerifyResult>
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

