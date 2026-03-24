import crypto from 'crypto'
import { trace, SpanStatusCode } from '@opentelemetry/api'
import { DomainError } from '../../core/errors'
import { getLogger } from '../../lib/logger'
import * as messageAnalyticsSvc from '../message-analytics/service'
import * as messageAttributionSvc from '../message-attribution/service'
import { getPaymentProvider, registerPaymentProvider } from './provider'
import * as repo from './repo'
import type {
  CreateCheckoutSessionInput,
  PaymentCatalogKind,
  PaymentCatalogStatus,
  PaymentMode,
  PaymentProvider,
  PaymentWebhookVerifyInput,
  PaymentCatalogItemRow,
  PaymentProviderConfigRow,
  PaymentWebhookParsedCompletion,
  PaymentCheckoutSessionRow,
} from './types'
import { capturePaypalOrder, paypalProviderAdapter } from './providers/paypal'

const paymentLogger = getLogger({ component: 'features.payments' })
const tracer = trace.getTracer('aws.payments')

registerPaymentProvider(paypalProviderAdapter)

const PROVIDERS: readonly PaymentProvider[] = ['paypal']
const MODES: readonly PaymentMode[] = ['sandbox', 'live']
const CATALOG_KINDS: readonly PaymentCatalogKind[] = ['donate_campaign', 'subscribe_plan']
const CATALOG_STATUSES: readonly PaymentCatalogStatus[] = ['draft', 'active', 'archived']

function normalizeProvider(raw: any): PaymentProvider {
  const v = String(raw || '').trim().toLowerCase()
  if ((PROVIDERS as readonly string[]).includes(v)) return v as PaymentProvider
  throw new DomainError('invalid_payment_provider', 'invalid_payment_provider', 400)
}

function normalizeMode(raw: any, fallback: PaymentMode = 'sandbox'): PaymentMode {
  if (raw == null || raw === '') return fallback
  const v = String(raw || '').trim().toLowerCase()
  if ((MODES as readonly string[]).includes(v)) return v as PaymentMode
  throw new DomainError('invalid_payment_mode', 'invalid_payment_mode', 400)
}

function normalizeIntent(raw: any): 'donate' | 'subscribe' {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'donate' || v === 'subscribe') return v
  throw new DomainError('invalid_payment_intent', 'invalid_payment_intent', 400)
}

function normalizeCatalogKind(raw: any): PaymentCatalogKind {
  const v = String(raw || '').trim().toLowerCase()
  if ((CATALOG_KINDS as readonly string[]).includes(v)) return v as PaymentCatalogKind
  throw new DomainError('invalid_payment_catalog_kind', 'invalid_payment_catalog_kind', 400)
}

function normalizeCatalogStatus(raw: any): PaymentCatalogStatus {
  const v = String(raw || '').trim().toLowerCase()
  if ((CATALOG_STATUSES as readonly string[]).includes(v)) return v as PaymentCatalogStatus
  throw new DomainError('invalid_payment_catalog_status', 'invalid_payment_catalog_status', 400)
}

function normalizeCurrency(raw: any): string {
  const v = String(raw || 'USD').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(v)) throw new DomainError('invalid_payment_currency', 'invalid_payment_currency', 400)
  return v
}

function normalizeNullablePath(raw: any, code: string): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim()
  if (!v.startsWith('/')) throw new DomainError(code, code, 400)
  if (v.length > 1200) throw new DomainError(code, code, 400)
  return v
}

function normalizeAmountCents(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new DomainError('invalid_payment_amount_cents', 'invalid_payment_amount_cents', 400)
  return Math.round(n)
}

function normalizePositiveId(raw: any, code: string): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError(code, code, 400)
  return Math.round(n)
}

function normalizeItemKey(raw: any): string {
  const v = String(raw || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(v)) {
    throw new DomainError('invalid_payment_catalog_item_key', 'invalid_payment_catalog_item_key', 400)
  }
  return v
}

function normalizeLabel(raw: any): string {
  const v = String(raw || '').trim()
  if (!v || v.length > 160) throw new DomainError('invalid_payment_catalog_label', 'invalid_payment_catalog_label', 400)
  return v
}

function normalizeOptionalUuid(raw: any, code: string): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) throw new DomainError(code, code, 400)
  return v
}

function normalizeJsonConfig(raw: any): Record<string, unknown> {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object') return raw as Record<string, unknown>
  try {
    const parsed = JSON.parse(String(raw))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    throw new Error('invalid')
  } catch {
    throw new DomainError('invalid_payment_catalog_config_json', 'invalid_payment_catalog_config_json', 400)
  }
}

function parseJsonObject(raw: any): Record<string, unknown> {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  try {
    const parsed = JSON.parse(String(raw))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {}
  return {}
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(String(raw))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {}
  return {}
}

function normalizeNullableString(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim()
  return v || null
}

function normalizeNullablePositiveInt(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n)
}

async function emitMessageCompletionFromCheckout(input: {
  session: PaymentCheckoutSessionRow
  parsed: PaymentWebhookParsedCompletion
}): Promise<void> {
  const session = input.session
  if (!session.message_id || Number(session.message_id) <= 0) return
  if (session.status !== 'completed') return

  const metadata = parseMetadata(session.metadata_json)
  const checkoutIntent = String(metadata.checkout_intent || '').trim().toLowerCase()
  const flow = checkoutIntent === 'upgrade'
    ? 'upgrade'
    : (session.intent === 'donate' ? 'donate' : 'subscribe')

  const event = flow === 'donate'
    ? 'donation_complete'
    : (flow === 'upgrade' ? 'upgrade_complete' : 'subscription_complete')

  const messageSessionId = normalizeNullableString(metadata.message_session_id)
  const messageSequenceKey = normalizeNullableString(metadata.message_sequence_key)
  const ctaKind = normalizeNullableString(metadata.message_cta_kind)
  const messageCtaSlot = normalizeNullablePositiveInt(metadata.message_cta_slot)
  const messageCtaIntentKey = normalizeNullableString(metadata.message_cta_intent_key)?.toLowerCase() || null
  const messageCtaExecutorType = normalizeNullableString(metadata.message_cta_executor_type)?.toLowerCase() || null

  await messageAnalyticsSvc.recordMessageEvent({
    event,
    messageId: Number(session.message_id),
    messageCampaignKey: session.message_campaign_key || null,
    ctaKind: ctaKind as any,
    messageCtaSlot,
    messageCtaDefinitionId: session.message_cta_definition_id == null ? null : Number(session.message_cta_definition_id),
    messageCtaIntentKey,
    messageCtaExecutorType,
    flow: flow as any,
    intentId: session.message_intent_id || null,
    messageSequenceKey,
    surface: 'global_feed',
    sessionId: messageSessionId,
    viewerState: session.user_id ? 'authenticated' : 'anonymous',
    userId: session.user_id == null ? null : Number(session.user_id),
  })

  if (session.user_id && Number(session.user_id) > 0) {
    await messageAttributionSvc.upsertUserSuppressionFromCompletion({
      userId: Number(session.user_id),
      scope: session.message_campaign_key ? 'campaign' : 'message',
      campaignKey: session.message_campaign_key || null,
      messageId: Number(session.message_id),
      sourceIntentId: session.message_intent_id || null,
      reason: 'flow_complete',
    })
  }
}

function toDateTimeUtc(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
}

function createCheckoutId(): string {
  return crypto.randomUUID().toLowerCase()
}

function headersToSerializable(input: Record<string, string | string[] | undefined>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(input || {})) {
    const key = String(k || '').trim().toLowerCase()
    if (!key) continue
    if (typeof v === 'string') out[key] = v
    else if (Array.isArray(v)) out[key] = v.map((x) => String(x))
  }
  return out
}

function buildWebhookDedupeKey(input: {
  provider: PaymentProvider
  mode: PaymentMode
  providerEventId: string | null
  dedupeSource: string
}): string {
  const src = input.providerEventId
    ? `${input.provider}|${input.mode}|event:${input.providerEventId}`
    : `${input.provider}|${input.mode}|source:${input.dedupeSource}`
  return crypto.createHash('sha256').update(src).digest('hex')
}

export async function configureProvider(input: {
  provider: PaymentProvider | string
  mode: PaymentMode | string
  status: 'disabled' | 'enabled' | string
  donateEnabled?: boolean
  subscribeEnabled?: boolean
  credentials: Record<string, unknown>
  webhookId?: string | null
  webhookSecret?: string | null
  notes?: string | null
  actorUserId: number
}): Promise<void> {
  const provider = normalizeProvider(input.provider)
  const mode = normalizeMode(input.mode)
  const status = String(input.status || '').trim().toLowerCase()
  if (status !== 'disabled' && status !== 'enabled') {
    throw new DomainError('invalid_payment_provider_status', 'invalid_payment_provider_status', 400)
  }
  const actorUserId = normalizePositiveId(input.actorUserId, 'invalid_actor_user_id')
  if (!actorUserId) throw new DomainError('invalid_actor_user_id', 'invalid_actor_user_id', 400)

  await repo.upsertProviderConfig({
    provider,
    mode,
    status: status as 'disabled' | 'enabled',
    donateEnabled: Boolean(input.donateEnabled),
    subscribeEnabled: Boolean(input.subscribeEnabled),
    credentialsJson: JSON.stringify(input.credentials || {}),
    webhookId: input.webhookId ? String(input.webhookId).trim() : null,
    webhookSecret: input.webhookSecret ? String(input.webhookSecret).trim() : null,
    notes: input.notes ? String(input.notes).trim() : null,
    actorUserId,
  })
}

export async function listProviderConfigsForAdmin(provider: PaymentProvider | string = 'paypal'): Promise<{
  provider: PaymentProvider
  rows: PaymentProviderConfigRow[]
}> {
  const normalizedProvider = normalizeProvider(provider)
  const rows = await repo.listProviderConfigsByProvider(normalizedProvider)
  return { provider: normalizedProvider, rows }
}

export async function getProviderConfigForAdmin(input: {
  provider: PaymentProvider | string
  mode: PaymentMode | string
}): Promise<PaymentProviderConfigRow | null> {
  const provider = normalizeProvider(input.provider)
  const mode = normalizeMode(input.mode)
  return await repo.getProviderConfig({ provider, mode })
}

export async function listCatalogItemsForAdmin(input?: {
  kind?: PaymentCatalogKind | string | null
  status?: PaymentCatalogStatus | string | null
  includeArchived?: boolean
  limit?: number
}): Promise<PaymentCatalogItemRow[]> {
  const kind = input?.kind ? normalizeCatalogKind(input.kind) : null
  const status = input?.status ? normalizeCatalogStatus(input.status) : null
  return await repo.listCatalogItems({
    kind,
    status,
    includeArchived: Boolean(input?.includeArchived),
    limit: input?.limit || 500,
  })
}

export async function getCatalogItemForAdmin(id: number): Promise<PaymentCatalogItemRow | null> {
  const normalizedId = normalizePositiveId(id, 'invalid_payment_catalog_id')
  if (!normalizedId) throw new DomainError('invalid_payment_catalog_id', 'invalid_payment_catalog_id', 400)
  return await repo.getCatalogItemById(normalizedId)
}

export async function createCatalogItemForAdmin(input: {
  kind: PaymentCatalogKind | string
  itemKey: string
  label: string
  status: PaymentCatalogStatus | string
  amountCents?: number | null
  currency?: string
  provider?: PaymentProvider | string
  providerRef?: string | null
  configJson?: string | Record<string, unknown> | null
  actorUserId: number
}): Promise<PaymentCatalogItemRow> {
  const actorUserId = normalizePositiveId(input.actorUserId, 'invalid_actor_user_id')
  if (!actorUserId) throw new DomainError('invalid_actor_user_id', 'invalid_actor_user_id', 400)
  const created = await repo.insertCatalogItem({
    kind: normalizeCatalogKind(input.kind),
    itemKey: normalizeItemKey(input.itemKey),
    label: normalizeLabel(input.label),
    status: normalizeCatalogStatus(input.status),
    amountCents: normalizeAmountCents(input.amountCents),
    currency: normalizeCurrency(input.currency),
    provider: normalizeProvider(input.provider || 'paypal'),
    providerRef: input.providerRef == null || input.providerRef === '' ? null : String(input.providerRef).trim(),
    configJson: JSON.stringify(normalizeJsonConfig(input.configJson)),
    actorUserId,
  })
  if (!created) throw new DomainError('payment_catalog_create_failed', 'payment_catalog_create_failed', 500)
  return created
}

export async function updateCatalogItemForAdmin(input: {
  id: number
  kind: PaymentCatalogKind | string
  itemKey: string
  label: string
  status: PaymentCatalogStatus | string
  amountCents?: number | null
  currency?: string
  provider?: PaymentProvider | string
  providerRef?: string | null
  configJson?: string | Record<string, unknown> | null
  actorUserId: number
}): Promise<void> {
  const actorUserId = normalizePositiveId(input.actorUserId, 'invalid_actor_user_id')
  const id = normalizePositiveId(input.id, 'invalid_payment_catalog_id')
  if (!actorUserId) throw new DomainError('invalid_actor_user_id', 'invalid_actor_user_id', 400)
  if (!id) throw new DomainError('invalid_payment_catalog_id', 'invalid_payment_catalog_id', 400)
  await repo.updateCatalogItem({
    id,
    kind: normalizeCatalogKind(input.kind),
    itemKey: normalizeItemKey(input.itemKey),
    label: normalizeLabel(input.label),
    status: normalizeCatalogStatus(input.status),
    amountCents: normalizeAmountCents(input.amountCents),
    currency: normalizeCurrency(input.currency),
    provider: normalizeProvider(input.provider || 'paypal'),
    providerRef: input.providerRef == null || input.providerRef === '' ? null : String(input.providerRef).trim(),
    configJson: JSON.stringify(normalizeJsonConfig(input.configJson)),
    actorUserId,
  })
}

export async function createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{
  checkoutId: string
  provider: PaymentProvider
  mode: PaymentMode
  redirectUrl: string
  providerSessionId: string
}> {
  return tracer.startActiveSpan('payments.checkout.create', { attributes: { 'app.operation': 'payments.checkout.create' } }, async (span) => {
    try {
      const provider = normalizeProvider(input.provider)
      const mode = normalizeMode(input.mode)
      const intent = normalizeIntent(input.intent)
      const requestedCurrency = normalizeCurrency(input.currency)
      const requestedAmountCents = normalizeAmountCents(input.amountCents)
      const messageId = normalizePositiveId(input.messageId, 'invalid_message_id')
      const userId = normalizePositiveId(input.userId, 'invalid_user_id')
      const messageCtaDefinitionId = normalizePositiveId(input.messageCtaDefinitionId, 'invalid_message_cta_definition_id')
      const catalogItemId = normalizePositiveId(input.catalogItemId, 'invalid_payment_catalog_item_id')
      const messageIntentId = normalizeOptionalUuid(input.messageIntentId, 'invalid_message_intent_id')
      const returnUrl = normalizeNullablePath(input.returnUrl, 'invalid_payment_return_url')
      const cancelUrl = normalizeNullablePath(input.cancelUrl, 'invalid_payment_cancel_url')
      const campaignKey = input.messageCampaignKey == null ? null : String(input.messageCampaignKey).trim().toLowerCase() || null

      const providerCfg = await repo.getProviderConfig({ provider, mode })
      if (!providerCfg || providerCfg.status !== 'enabled') {
        throw new DomainError('payment_provider_disabled', 'payment_provider_disabled', 400)
      }
      if (intent === 'donate' && !providerCfg.donate_enabled) throw new DomainError('payment_intent_disabled', 'payment_intent_disabled', 400)
      if (intent === 'subscribe' && !providerCfg.subscribe_enabled) throw new DomainError('payment_intent_disabled', 'payment_intent_disabled', 400)

      let catalogItem: PaymentCatalogItemRow | null = null
      if (catalogItemId != null) {
        catalogItem = await repo.getCatalogItemById(catalogItemId)
        if (!catalogItem) throw new DomainError('payment_catalog_item_not_found', 'payment_catalog_item_not_found', 400)
        if (String(catalogItem.status || '').toLowerCase() !== 'active') {
          throw new DomainError('payment_catalog_item_inactive', 'payment_catalog_item_inactive', 400)
        }
        const kind = String(catalogItem.kind || '')
        if ((intent === 'donate' && kind !== 'donate_campaign') || (intent === 'subscribe' && kind !== 'subscribe_plan')) {
          throw new DomainError('payment_catalog_item_kind_mismatch', 'payment_catalog_item_kind_mismatch', 400)
        }
      }

      const catalogCurrency = catalogItem?.currency ? normalizeCurrency(catalogItem.currency) : null
      const currency = catalogCurrency || requestedCurrency
      const catalogAmountCents = catalogItem?.amount_cents != null ? normalizeAmountCents(catalogItem.amount_cents) : null
      // Amount precedence:
      // 1) explicit request amount (used by custom donate on /support)
      // 2) catalog item amount (plan/campaign default)
      // 3) donate fallback $1.00 (legacy behavior)
      const amountCents = requestedAmountCents != null
        ? requestedAmountCents
        : (catalogAmountCents != null ? catalogAmountCents : (intent === 'donate' ? 100 : null))
      if (intent === 'subscribe' && (amountCents == null || amountCents <= 0)) {
        throw new DomainError('invalid_payment_amount_cents', 'invalid_payment_amount_cents', 400)
      }

      const enrichedMetadata: Record<string, unknown> = {
        ...(input.metadata || {}),
        catalog_item_id: catalogItemId ?? null,
      }
      if (catalogItem) {
        enrichedMetadata.catalog_item_key = String(catalogItem.item_key || '')
        enrichedMetadata.catalog_item_kind = String(catalogItem.kind || '')
        enrichedMetadata.catalog_item_provider_ref = catalogItem.provider_ref || null
      }
      enrichedMetadata.selected_amount_cents = amountCents

      const checkoutId = createCheckoutId()
      await repo.insertCheckoutSession({
        checkoutId,
        provider,
        mode,
        intent,
        userId,
        messageId,
        messageCampaignKey: campaignKey,
        messageIntentId,
        messageCtaDefinitionId,
        catalogItemId,
        amountCents,
        currency,
        returnUrl,
        cancelUrl,
        metadataJson: JSON.stringify(enrichedMetadata),
      })

      const adapter = getPaymentProvider(provider)
      const providerStart = await adapter.createCheckoutSession({
        checkoutId,
        mode,
        intent,
        credentials: parseJsonObject(providerCfg.credentials_json),
        amountCents,
        currency,
        returnUrl,
        cancelUrl,
        metadata: enrichedMetadata,
      })

      await repo.updateCheckoutSessionAfterProviderStart({
        checkoutId,
        status: 'redirected',
        providerSessionId: providerStart.providerSessionId,
        providerOrderId: providerStart.providerOrderId || null,
      })

      span.setAttributes({
        'app.outcome': 'success',
        'app.payment_provider': provider,
        'app.payment_mode': mode,
        'app.payment_intent': intent,
        'app.payment_checkout_id': checkoutId,
      })
      span.setStatus({ code: SpanStatusCode.OK })

      paymentLogger.info({
        app_operation: 'payments.checkout.create',
        app_outcome: 'success',
        payment_provider: provider,
        payment_mode: mode,
        payment_intent: intent,
        payment_checkout_id: checkoutId,
        message_id: messageId,
        message_campaign_key: campaignKey,
      }, 'payments.checkout.create')

      return {
        checkoutId,
        provider,
        mode,
        redirectUrl: providerStart.redirectUrl,
        providerSessionId: providerStart.providerSessionId,
      }
    } catch (err: any) {
      span.recordException(err)
      span.setAttributes({ 'app.outcome': 'client_error' })
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'payment_checkout_create_failed') })
      throw err
    } finally {
      span.end()
    }
  })
}

export async function ingestWebhook(input: {
  provider: PaymentProvider | string
  mode: PaymentMode | string
  verifyInput: PaymentWebhookVerifyInput
}): Promise<{ deduped: boolean; eventType: string; providerEventId: string | null }> {
  return tracer.startActiveSpan('payments.webhook.ingest', { attributes: { 'app.operation': 'payments.webhook.ingest' } }, async (span) => {
    try {
      const provider = normalizeProvider(input.provider)
      const mode = normalizeMode(input.mode)
      const providerCfg = await repo.getProviderConfig({ provider, mode })
      if (!providerCfg || providerCfg.status !== 'enabled') {
        throw new DomainError('payment_provider_disabled', 'payment_provider_disabled', 400)
      }
      const providerCredentials = parseJsonObject(providerCfg.credentials_json)
      const adapter = getPaymentProvider(provider)
      const verified = await adapter.verifyWebhook({
        ...input.verifyInput,
        credentials: providerCredentials,
        webhookId: providerCfg.webhook_id || null,
        webhookSecret: providerCfg.webhook_secret || null,
      })
      const dedupeKey = buildWebhookDedupeKey({
        provider,
        mode,
        providerEventId: verified.providerEventId,
        dedupeSource: verified.dedupeSource,
      })

      const saved = await repo.insertWebhookEvent({
        provider,
        mode,
        providerEventId: verified.providerEventId,
        eventType: verified.eventType,
        dedupeKey,
        signatureValid: verified.valid,
        payloadJson: JSON.stringify(verified.payload || {}),
        headersJson: JSON.stringify(headersToSerializable(input.verifyInput.headers || {})),
        receivedAtUtc: toDateTimeUtc(new Date()),
      })

      if (!verified.valid) {
        await repo.markWebhookEventProcessed({
          dedupeKey,
          processingState: 'failed',
          errorMessage: 'invalid_signature',
        })
        throw new DomainError('invalid_payment_webhook_signature', 'invalid_payment_webhook_signature', 400)
      }

      let derivedPaymentStatus: string | null = null
      if (saved.inserted) {
        const parsed: PaymentWebhookParsedCompletion = adapter.parseCompletion(verified)
        derivedPaymentStatus = parsed.checkoutStatus || null
        try {
          if (parsed.checkoutStatus) {
            let session = parsed.providerSessionId
              ? await repo.getCheckoutSessionByProviderSession({ provider, providerSessionId: parsed.providerSessionId })
              : null
            if (!session && parsed.providerOrderId) {
              session = await repo.getCheckoutSessionByProviderOrder({ provider, providerOrderId: parsed.providerOrderId })
            }
            if (session) {
              await repo.updateCheckoutSessionStatus({
                id: session.id,
                status: parsed.checkoutStatus,
                providerSessionId: parsed.providerSessionId || null,
                providerOrderId: parsed.providerOrderId || null,
              })
              if (parsed.checkoutStatus === 'completed') {
                const refreshed = await repo.getCheckoutSessionById(Number(session.id))
                const forEmit = refreshed || { ...session, status: 'completed' as const }
                await emitMessageCompletionFromCheckout({ session: forEmit, parsed })
              }
              await repo.markWebhookEventProcessed({
                dedupeKey,
                processingState: 'processed',
                errorMessage: null,
              })
            } else {
              await repo.markWebhookEventProcessed({
                dedupeKey,
                processingState: 'ignored',
                errorMessage: 'session_not_found',
              })
            }
          } else {
            await repo.markWebhookEventProcessed({
              dedupeKey,
              processingState: 'ignored',
              errorMessage: parsed.outcomeReason || 'event_ignored',
            })
          }
        } catch (err: any) {
          await repo.markWebhookEventProcessed({
            dedupeKey,
            processingState: 'failed',
            errorMessage: String(err?.message || 'webhook_processing_failed').slice(0, 500),
          })
          throw err
        }
      }

      span.setAttributes({
        'app.outcome': 'success',
        'app.payment_provider': provider,
        'app.payment_mode': mode,
        'app.payment_webhook_deduped': saved.inserted ? 0 : 1,
      })
      if (derivedPaymentStatus) span.setAttribute('app.payment_status', derivedPaymentStatus)
      if (verified.providerEventId) span.setAttribute('app.payment_provider_event_id', verified.providerEventId)
      span.setStatus({ code: SpanStatusCode.OK })

      return {
        deduped: !saved.inserted,
        eventType: verified.eventType,
        providerEventId: verified.providerEventId,
      }
    } catch (err: any) {
      span.recordException(err)
      span.setAttributes({ 'app.outcome': 'client_error' })
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'payment_webhook_ingest_failed') })
      throw err
    } finally {
      span.end()
    }
  })
}

export async function completePaypalOrderFromReturn(input: {
  providerOrderId: string
  payerId?: string | null
}): Promise<{ returnUrl: string; checkoutId: string; status: 'completed' | 'already_completed' }> {
  return tracer.startActiveSpan('payments.checkout.return', { attributes: { 'app.operation': 'payments.checkout.return' } }, async (span) => {
    try {
      const providerOrderId = String(input.providerOrderId || '').trim()
      if (!providerOrderId) throw new DomainError('invalid_payment_provider_order_id', 'invalid_payment_provider_order_id', 400)

      const session = await repo.getCheckoutSessionByProviderOrder({
        provider: 'paypal',
        providerOrderId,
      })
      if (!session) throw new DomainError('payment_checkout_not_found', 'payment_checkout_not_found', 404)

      const metadata = parseMetadata(session.metadata_json)
      const returnUrl = normalizeNullablePath(metadata.final_return_path || session.return_url, 'invalid_payment_return_url') || '/'
      if (session.status === 'completed') {
        span.setAttributes({
          'app.outcome': 'success',
          'app.payment_provider': 'paypal',
          'app.payment_mode': session.mode,
          'app.payment_checkout_id': session.checkout_id,
          'app.payment_status': 'completed',
        })
        span.setStatus({ code: SpanStatusCode.OK })
        return { returnUrl, checkoutId: session.checkout_id, status: 'already_completed' as const }
      }

      const providerCfg = await repo.getProviderConfig({ provider: 'paypal', mode: session.mode })
      if (!providerCfg || providerCfg.status !== 'enabled') {
        throw new DomainError('payment_provider_disabled', 'payment_provider_disabled', 400)
      }
      const providerCredentials = parseJsonObject(providerCfg.credentials_json)
      const captured = await capturePaypalOrder({
        mode: session.mode,
        credentials: providerCredentials,
        providerOrderId,
      })
      if (captured.status !== 'COMPLETED') {
        throw new DomainError('paypal_capture_not_completed', 'paypal_capture_not_completed', 409)
      }

      await repo.updateCheckoutSessionStatus({
        id: Number(session.id),
        status: 'completed',
        providerSessionId: captured.orderId || providerOrderId,
        providerOrderId,
      })
      const refreshed = await repo.getCheckoutSessionById(Number(session.id))
      const forEmit = refreshed || { ...session, status: 'completed' as const }
      await emitMessageCompletionFromCheckout({
        session: forEmit,
        parsed: {
          checkoutStatus: 'completed',
          providerSessionId: captured.orderId || providerOrderId,
          providerOrderId,
          providerSubscriptionId: null,
          outcomeReason: 'capture_from_return',
        },
      })

      span.setAttributes({
        'app.outcome': 'success',
        'app.payment_provider': 'paypal',
        'app.payment_mode': session.mode,
        'app.payment_checkout_id': session.checkout_id,
        'app.payment_status': 'completed',
      })
      span.setStatus({ code: SpanStatusCode.OK })

      paymentLogger.info({
        app_operation: 'payments.checkout.return',
        app_operation_detail: 'payments.checkout.capture',
        app_outcome: 'success',
        payment_provider: 'paypal',
        payment_mode: session.mode,
        payment_checkout_id: session.checkout_id,
        payment_order_id: providerOrderId,
      }, 'payments.checkout.return')

      return { returnUrl, checkoutId: session.checkout_id, status: 'completed' as const }
    } catch (err: any) {
      span.recordException(err)
      span.setAttributes({ 'app.outcome': 'client_error' })
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'payment_checkout_return_failed') })
      throw err
    } finally {
      span.end()
    }
  })
}
