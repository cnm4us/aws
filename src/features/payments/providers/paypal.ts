import { DomainError } from '../../../core/errors'
import type {
  PaymentProviderCheckoutRequest,
  PaymentProviderCheckoutResult,
  PaymentWebhookVerifyInput,
  PaymentWebhookVerifyResult,
} from '../types'
import type { PaymentProviderAdapter } from '../provider'

export const paypalProviderAdapter: PaymentProviderAdapter = {
  provider: 'paypal',
  async createCheckoutSession(_input: PaymentProviderCheckoutRequest): Promise<PaymentProviderCheckoutResult> {
    throw new DomainError('paypal_not_implemented', 'paypal_not_implemented', 501)
  },
  async verifyWebhook(_input: PaymentWebhookVerifyInput): Promise<PaymentWebhookVerifyResult> {
    throw new DomainError('paypal_not_implemented', 'paypal_not_implemented', 501)
  },
}

