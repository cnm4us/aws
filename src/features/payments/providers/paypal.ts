import crypto from 'crypto'
import { DomainError } from '../../../core/errors'
import type {
  PaymentProviderCheckoutRequest,
  PaymentProviderCheckoutResult,
  PaymentProviderSubscriptionRequest,
  PaymentProviderSubscriptionResult,
  PaymentWebhookParsedCompletion,
  PaymentWebhookVerifyInput,
  PaymentWebhookVerifyResult,
} from '../types'
import type { PaymentProviderAdapter } from '../provider'

const PAYPAL_BASE: Record<'sandbox' | 'live', string> = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
}

function parseCredentials(input: Record<string, unknown>): { clientId: string; clientSecret: string } {
  const clientId = String(input?.clientId ?? input?.client_id ?? '').trim()
  const clientSecret = String(input?.clientSecret ?? input?.client_secret ?? '').trim()
  if (!clientId || !clientSecret) {
    throw new DomainError('paypal_credentials_missing', 'paypal_credentials_missing', 400)
  }
  return { clientId, clientSecret }
}

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; data: any }> {
  const response = await fetch(url, init)
  const text = await response.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch {}
  return { status: response.status, data }
}

async function getAccessToken(input: {
  mode: 'sandbox' | 'live'
  clientId: string
  clientSecret: string
}): Promise<string> {
  const auth = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')
  const body = new URLSearchParams({ grant_type: 'client_credentials' }).toString()
  const url = `${PAYPAL_BASE[input.mode]}/v1/oauth2/token`
  const res = await fetchJson(url, {
    method: 'POST',
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  })
  if (res.status < 200 || res.status >= 300) {
    const errName = String(res.data?.error || '').trim()
    const errDesc = String(res.data?.error_description || '').trim()
    const detail = [res.status, errName, errDesc].filter(Boolean).join(':')
    throw new DomainError(`paypal_access_token_failed${detail ? `:${detail}` : ''}`, 'paypal_access_token_failed', 502)
  }
  const token = String(res.data?.access_token || '').trim()
  if (!token) throw new DomainError('paypal_access_token_missing', 'paypal_access_token_missing', 502)
  return token
}

function normalizeReturnUrl(pathLike: string | null): string | null {
  if (!pathLike) return null
  if (!pathLike.startsWith('/')) return null
  const origin = String(process.env.PUBLIC_APP_ORIGIN || process.env.PUBLIC_CANONICAL_ORIGIN || 'https://aws.bawebtech.com').trim().replace(/\/+$/, '')
  return `${origin}${pathLike}`
}

function normalizeAmount(input: PaymentProviderCheckoutRequest): { value: string; currency_code: string } {
  const cents = Number(input.amountCents)
  const safeCents = Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 100
  return {
    value: (safeCents / 100).toFixed(2),
    currency_code: String(input.currency || 'USD').toUpperCase(),
  }
}

function findApproveUrl(links: any[]): string | null {
  for (const link of links || []) {
    const rel = String(link?.rel || '').toLowerCase()
    if ((rel === 'approve' || rel === 'payer-action') && String(link?.href || '').trim()) {
      return String(link.href).trim()
    }
  }
  return null
}

function getHeader(headers: Record<string, string | string[] | undefined>, key: string): string {
  const v = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()]
  if (Array.isArray(v)) return String(v[0] || '')
  return String(v || '')
}

function parseWebhookPayload(rawBody: string): Record<string, unknown> {
  try {
    const payload = JSON.parse(rawBody)
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload as Record<string, unknown>
  } catch {}
  throw new DomainError('paypal_webhook_invalid_json', 'paypal_webhook_invalid_json', 400)
}

function hashDedupeSource(rawBody: string): string {
  return crypto.createHash('sha256').update(rawBody).digest('hex')
}

export async function capturePaypalOrder(input: {
  mode: 'sandbox' | 'live'
  credentials: Record<string, unknown>
  providerOrderId: string
}): Promise<{ orderId: string; captureId: string | null; status: string }> {
  const creds = parseCredentials(input.credentials || {})
  const token = await getAccessToken({
    mode: input.mode,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  })
  const orderId = String(input.providerOrderId || '').trim()
  if (!orderId) throw new DomainError('paypal_order_id_missing', 'paypal_order_id_missing', 400)
  const res = await fetchJson(`${PAYPAL_BASE[input.mode]}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({}),
  })
  if (res.status < 200 || res.status >= 300) {
    const errName = String(res.data?.name || '').trim()
    const detail = [res.status, errName].filter(Boolean).join(':')
    throw new DomainError(`paypal_capture_failed${detail ? `:${detail}` : ''}`, 'paypal_capture_failed', 502)
  }
  const status = String(res.data?.status || '').trim().toUpperCase()
  const purchaseUnit = Array.isArray(res.data?.purchase_units) ? res.data.purchase_units[0] : null
  const captures = Array.isArray(purchaseUnit?.payments?.captures) ? purchaseUnit.payments.captures : []
  const captureId = captures.length ? String(captures[0]?.id || '').trim() || null : null
  return { orderId, captureId, status }
}

export const paypalProviderAdapter: PaymentProviderAdapter = {
  provider: 'paypal',

  async createCheckoutSession(input: PaymentProviderCheckoutRequest): Promise<PaymentProviderCheckoutResult> {
    const creds = parseCredentials(input.credentials || {})
    const token = await getAccessToken({
      mode: input.mode,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    })
    const returnUrl = normalizeReturnUrl(input.returnUrl) || normalizeReturnUrl('/') || 'https://aws.bawebtech.com/'
    const cancelUrl = normalizeReturnUrl(input.cancelUrl) || returnUrl
    const amount = normalizeAmount(input)
    const itemLabelRaw = input?.metadata?.catalog_item_label != null
      ? String(input.metadata.catalog_item_label || '').trim()
      : ''
    const itemLabel = itemLabelRaw || (input.intent === 'donate' ? 'Donation' : 'Support')
    const itemDescription = input.intent === 'donate'
      ? `${itemLabel} donation`
      : itemLabel

    const payload: any = {
      intent: 'CAPTURE',
      processing_instruction: 'ORDER_COMPLETE_ON_PAYMENT_APPROVAL',
      purchase_units: [
        {
          custom_id: input.checkoutId,
          description: itemDescription.slice(0, 127),
          amount: {
            ...amount,
            breakdown: {
              item_total: {
                currency_code: amount.currency_code,
                value: amount.value,
              },
            },
          },
          items: [
            {
              name: itemLabel.slice(0, 127),
              quantity: '1',
              unit_amount: {
                currency_code: amount.currency_code,
                value: amount.value,
              },
              category: 'DIGITAL_GOODS',
            },
          ],
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: returnUrl,
            cancel_url: cancelUrl,
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
          },
        },
      },
    }

    const res = await fetchJson(`${PAYPAL_BASE[input.mode]}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (res.status < 200 || res.status >= 300) {
      throw new DomainError('paypal_create_order_failed', 'paypal_create_order_failed', 502)
    }
    const providerOrderId = String(res.data?.id || '').trim()
    const redirectUrl = findApproveUrl(Array.isArray(res.data?.links) ? res.data.links : [])
    if (!providerOrderId || !redirectUrl) {
      throw new DomainError('paypal_create_order_invalid_response', 'paypal_create_order_invalid_response', 502)
    }
    return {
      providerSessionId: providerOrderId,
      providerOrderId,
      redirectUrl,
    }
  },

  async createSubscriptionSession(input: PaymentProviderSubscriptionRequest): Promise<PaymentProviderSubscriptionResult> {
    const creds = parseCredentials(input.credentials || {})
    const token = await getAccessToken({
      mode: input.mode,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    })
    const returnUrl = normalizeReturnUrl(input.returnUrl) || normalizeReturnUrl('/') || 'https://aws.bawebtech.com/'
    const cancelUrl = normalizeReturnUrl(input.cancelUrl) || returnUrl
    const providerPlanId = String(input.providerPlanId || '').trim()
    if (!providerPlanId) {
      throw new DomainError('paypal_provider_plan_id_missing', 'paypal_provider_plan_id_missing', 400)
    }

    const payload: any = {
      plan_id: providerPlanId,
      custom_id: input.checkoutId,
      application_context: {
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }

    const res = await fetchJson(`${PAYPAL_BASE[input.mode]}/v1/billing/subscriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (res.status < 200 || res.status >= 300) {
      throw new DomainError('paypal_subscription_create_failed', 'paypal_subscription_create_failed', 502)
    }
    const providerSubscriptionId = String(res.data?.id || '').trim()
    const redirectUrl = findApproveUrl(Array.isArray(res.data?.links) ? res.data.links : [])
    if (!providerSubscriptionId || !redirectUrl) {
      throw new DomainError('paypal_subscription_create_invalid_response', 'paypal_subscription_create_invalid_response', 502)
    }
    return {
      providerSessionId: providerSubscriptionId,
      providerSubscriptionId,
      redirectUrl,
    }
  },

  async verifyWebhook(input: PaymentWebhookVerifyInput): Promise<PaymentWebhookVerifyResult> {
    const creds = parseCredentials(input.credentials || {})
    const token = await getAccessToken({
      mode: input.mode,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    })
    const payload = parseWebhookPayload(input.rawBody)
    const providerEventId = payload?.id != null ? String((payload as any).id || '').trim() : null
    const eventType = String((payload as any)?.event_type || '').trim() || 'unknown'

    const webhookId = String(input.webhookId || '').trim()
    if (!webhookId) {
      return {
        valid: false,
        providerEventId: providerEventId || null,
        eventType,
        payload,
        dedupeSource: providerEventId || hashDedupeSource(input.rawBody),
      }
    }

    const verifyBody = {
      auth_algo: getHeader(input.headers, 'paypal-auth-algo'),
      cert_url: getHeader(input.headers, 'paypal-cert-url'),
      transmission_id: getHeader(input.headers, 'paypal-transmission-id'),
      transmission_sig: getHeader(input.headers, 'paypal-transmission-sig'),
      transmission_time: getHeader(input.headers, 'paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: payload,
    }
    const verifyRes = await fetchJson(`${PAYPAL_BASE[input.mode]}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(verifyBody),
    })
    const verificationStatus = String(verifyRes.data?.verification_status || '').trim().toUpperCase()
    const valid = verifyRes.status >= 200 && verifyRes.status < 300 && verificationStatus === 'SUCCESS'
    return {
      valid,
      providerEventId: providerEventId || null,
      eventType,
      payload,
      dedupeSource: providerEventId || hashDedupeSource(input.rawBody),
    }
  },

  parseCompletion(input: PaymentWebhookVerifyResult): PaymentWebhookParsedCompletion {
    const eventType = String(input.eventType || '').trim().toUpperCase()
    const resource: any = input.payload?.resource && typeof input.payload.resource === 'object' ? input.payload.resource : {}
    const resourceId = resource?.id != null ? String(resource.id || '').trim() : null
    const orderIdFromRelated = resource?.supplementary_data?.related_ids?.order_id != null
      ? String(resource.supplementary_data.related_ids.order_id || '').trim()
      : null
    const isSubscriptionEvent = eventType.startsWith('BILLING.SUBSCRIPTION.')
    const providerSubscriptionId = isSubscriptionEvent && resourceId ? resourceId : null
    const providerOrderId = orderIdFromRelated || (!isSubscriptionEvent ? resourceId : null)
    const providerSessionId = providerSubscriptionId || providerOrderId

    if (eventType === 'CHECKOUT.ORDER.COMPLETED' || eventType === 'PAYMENT.CAPTURE.COMPLETED' || eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      return {
        checkoutStatus: 'completed',
        providerSessionId,
        providerOrderId,
        providerSubscriptionId,
        outcomeReason: 'completed',
      }
    }
    if (eventType === 'CHECKOUT.ORDER.VOIDED' || eventType === 'BILLING.SUBSCRIPTION.CANCELLED' || eventType === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      return {
        checkoutStatus: 'canceled',
        providerSessionId,
        providerOrderId,
        providerSubscriptionId,
        outcomeReason: 'canceled',
      }
    }
    if (eventType === 'PAYMENT.CAPTURE.DENIED' || eventType === 'PAYMENT.CAPTURE.REVERSED' || eventType === 'PAYMENT.CAPTURE.REFUNDED') {
      return {
        checkoutStatus: 'failed',
        providerSessionId,
        providerOrderId,
        providerSubscriptionId,
        outcomeReason: 'failed',
      }
    }
    return {
      checkoutStatus: null,
      providerSessionId,
      providerOrderId,
      providerSubscriptionId,
      outcomeReason: 'event_ignored',
    }
  },

  async cancelSubscription(input): Promise<void> {
    const creds = parseCredentials(input.credentials || {})
    const token = await getAccessToken({
      mode: input.mode,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    })
    const subscriptionId = String(input.subscriptionId || '').trim()
    if (!subscriptionId) throw new DomainError('paypal_subscription_id_missing', 'paypal_subscription_id_missing', 400)
    const res = await fetchJson(`${PAYPAL_BASE[input.mode]}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ reason: String(input.reason || 'Canceled by customer').slice(0, 127) }),
    })
    if (res.status < 200 || res.status >= 300) {
      throw new DomainError('paypal_subscription_cancel_failed', 'paypal_subscription_cancel_failed', 502)
    }
  },

  async resumeSubscription(input): Promise<void> {
    const creds = parseCredentials(input.credentials || {})
    const token = await getAccessToken({
      mode: input.mode,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    })
    const subscriptionId = String(input.subscriptionId || '').trim()
    if (!subscriptionId) throw new DomainError('paypal_subscription_id_missing', 'paypal_subscription_id_missing', 400)
    const res = await fetchJson(`${PAYPAL_BASE[input.mode]}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/activate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ reason: String(input.reason || 'Reactivated by customer').slice(0, 127) }),
    })
    if (res.status < 200 || res.status >= 300) {
      throw new DomainError('paypal_subscription_resume_failed', 'paypal_subscription_resume_failed', 502)
    }
  },

  async changeSubscriptionPlan(input): Promise<void> {
    const creds = parseCredentials(input.credentials || {})
    const token = await getAccessToken({
      mode: input.mode,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    })
    const subscriptionId = String(input.subscriptionId || '').trim()
    const providerPlanId = String(input.providerPlanId || '').trim()
    if (!subscriptionId) throw new DomainError('paypal_subscription_id_missing', 'paypal_subscription_id_missing', 400)
    if (!providerPlanId) throw new DomainError('paypal_provider_plan_id_missing', 'paypal_provider_plan_id_missing', 400)
    const res = await fetchJson(`${PAYPAL_BASE[input.mode]}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/revise`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ plan_id: providerPlanId }),
    })
    if (res.status < 200 || res.status >= 300) {
      throw new DomainError('paypal_subscription_change_plan_failed', 'paypal_subscription_change_plan_failed', 502)
    }
  },
}
