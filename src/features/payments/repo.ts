import { getPool } from '../../db'
import type {
  PaymentCatalogItemRow,
  PaymentCatalogKind,
  PaymentCatalogStatus,
  PaymentCheckoutSessionRow,
  PaymentCheckoutStatus,
  PaymentMode,
  PaymentIntent,
  PaymentProvider,
  PaymentProviderConfigRow,
  PaymentSubscriptionAction,
  PaymentSubscriptionRow,
  PaymentSubscriptionStatus,
  PaymentTransactionRow,
  PaymentTransactionStatus,
  PaymentWebhookEventRow,
  PaymentWebhookProcessingState,
} from './types'

export async function getProviderConfig(params: { provider: PaymentProvider; mode: PaymentMode }): Promise<PaymentProviderConfigRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT * FROM payment_provider_configs WHERE provider = ? AND mode = ? LIMIT 1`,
    [params.provider, params.mode]
  )
  return ((rows as any[])[0] || null) as PaymentProviderConfigRow | null
}

export async function listProviderConfigsByProvider(provider: PaymentProvider): Promise<PaymentProviderConfigRow[]> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT * FROM payment_provider_configs WHERE provider = ? ORDER BY mode ASC`,
    [provider]
  )
  return (rows as any[]) as PaymentProviderConfigRow[]
}

export async function upsertProviderConfig(input: {
  provider: PaymentProvider
  mode: PaymentMode
  status: 'disabled' | 'enabled'
  donateEnabled: boolean
  subscribeEnabled: boolean
  credentialsJson: string
  webhookId: string | null
  webhookSecret: string | null
  notes: string | null
  actorUserId: number
}): Promise<void> {
  const db = getPool()
  await db.query(
    `INSERT INTO payment_provider_configs
      (
        provider, mode, status,
        donate_enabled, subscribe_enabled,
        credentials_json, webhook_id, webhook_secret, notes,
        created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        donate_enabled = VALUES(donate_enabled),
        subscribe_enabled = VALUES(subscribe_enabled),
        credentials_json = VALUES(credentials_json),
        webhook_id = VALUES(webhook_id),
        webhook_secret = VALUES(webhook_secret),
        notes = VALUES(notes),
        updated_by = VALUES(updated_by),
        updated_at = CURRENT_TIMESTAMP`,
    [
      input.provider,
      input.mode,
      input.status,
      input.donateEnabled ? 1 : 0,
      input.subscribeEnabled ? 1 : 0,
      input.credentialsJson,
      input.webhookId,
      input.webhookSecret,
      input.notes,
      input.actorUserId,
      input.actorUserId,
    ]
  )
}

export async function listCatalogItems(params?: {
  kind?: PaymentCatalogKind | null
  status?: PaymentCatalogStatus | null
  includeArchived?: boolean
  limit?: number
}): Promise<PaymentCatalogItemRow[]> {
  const db = getPool()
  const where: string[] = []
  const args: any[] = []
  if (params?.kind) {
    where.push('kind = ?')
    args.push(params.kind)
  }
  if (params?.status) {
    where.push('status = ?')
    args.push(params.status)
  } else if (!params?.includeArchived) {
    where.push(`status <> 'archived'`)
  }
  let sql = `SELECT * FROM payment_catalog_items`
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`
  sql += ` ORDER BY kind ASC, status ASC, id DESC`
  const lim = Number(params?.limit || 200)
  if (Number.isFinite(lim) && lim > 0) {
    sql += ` LIMIT ${Math.min(Math.max(Math.floor(lim), 1), 1000)}`
  }
  const [rows] = await db.query(sql, args)
  return (rows as any[]) as PaymentCatalogItemRow[]
}

export async function getCatalogItemById(id: number): Promise<PaymentCatalogItemRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM payment_catalog_items WHERE id = ? LIMIT 1`, [id])
  return ((rows as any[])[0] || null) as PaymentCatalogItemRow | null
}

export async function insertCatalogItem(input: {
  kind: PaymentCatalogKind
  itemKey: string
  label: string
  status: PaymentCatalogStatus
  amountCents: number | null
  currency: string
  provider: PaymentProvider
  providerRef: string | null
  configJson: string
  actorUserId: number
}): Promise<PaymentCatalogItemRow | null> {
  const db = getPool()
  const [res] = await db.query(
    `INSERT INTO payment_catalog_items
      (
        kind, item_key, label, status,
        amount_cents, currency, provider, provider_ref, config_json,
        created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.kind,
      input.itemKey,
      input.label,
      input.status,
      input.amountCents,
      input.currency,
      input.provider,
      input.providerRef,
      input.configJson,
      input.actorUserId,
      input.actorUserId,
    ]
  )
  const id = Number((res as any)?.insertId || 0)
  if (!id) return null
  return await getCatalogItemById(id)
}

export async function updateCatalogItem(input: {
  id: number
  kind: PaymentCatalogKind
  itemKey: string
  label: string
  status: PaymentCatalogStatus
  amountCents: number | null
  currency: string
  provider: PaymentProvider
  providerRef: string | null
  configJson: string
  actorUserId: number
}): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE payment_catalog_items
      SET
        kind = ?,
        item_key = ?,
        label = ?,
        status = ?,
        amount_cents = ?,
        currency = ?,
        provider = ?,
        provider_ref = ?,
        config_json = ?,
        updated_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [
      input.kind,
      input.itemKey,
      input.label,
      input.status,
      input.amountCents,
      input.currency,
      input.provider,
      input.providerRef,
      input.configJson,
      input.actorUserId,
      input.id,
    ]
  )
}

export async function insertCheckoutSession(input: {
  checkoutId: string
  provider: PaymentProvider
  mode: PaymentMode
  intent: 'donate' | 'subscribe'
  userId: number | null
  messageId: number | null
  messageCampaignKey: string | null
  messageIntentId: string | null
  messageCtaDefinitionId: number | null
  catalogItemId: number | null
  amountCents: number | null
  currency: string
  returnUrl: string | null
  cancelUrl: string | null
  metadataJson: string
}): Promise<PaymentCheckoutSessionRow | null> {
  const db = getPool()
  const [res] = await db.query(
    `INSERT INTO payment_checkout_sessions
      (
        checkout_id, provider, mode, intent, status,
        user_id, message_id, message_campaign_key, message_intent_id, message_cta_definition_id, catalog_item_id,
        amount_cents, currency, return_url, cancel_url, metadata_json
      )
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.checkoutId,
      input.provider,
      input.mode,
      input.intent,
      input.userId,
      input.messageId,
      input.messageCampaignKey,
      input.messageIntentId,
      input.messageCtaDefinitionId,
      input.catalogItemId,
      input.amountCents,
      input.currency,
      input.returnUrl,
      input.cancelUrl,
      input.metadataJson,
    ]
  )
  const id = Number((res as any)?.insertId || 0)
  if (!id) return null
  const [rows] = await db.query(`SELECT * FROM payment_checkout_sessions WHERE id = ? LIMIT 1`, [id])
  return ((rows as any[])[0] || null) as PaymentCheckoutSessionRow | null
}

export async function updateCheckoutSessionAfterProviderStart(input: {
  checkoutId: string
  status: Extract<PaymentCheckoutStatus, 'redirected'>
  providerSessionId: string
  providerOrderId: string | null
}): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE payment_checkout_sessions
        SET status = ?, provider_session_id = ?, provider_order_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE checkout_id = ?`,
    [input.status, input.providerSessionId, input.providerOrderId, input.checkoutId]
  )
}

export async function updateCheckoutSessionStatus(input: {
  checkoutId?: string
  id?: number
  status: PaymentCheckoutStatus
  failedReason?: string | null
  providerSessionId?: string | null
  providerOrderId?: string | null
}): Promise<void> {
  const db = getPool()
  const sets: string[] = [
    `status = ?`,
    `completed_at = CASE WHEN ? = 'completed' THEN UTC_TIMESTAMP() ELSE completed_at END`,
    `failed_at = CASE WHEN ? = 'failed' THEN UTC_TIMESTAMP() ELSE failed_at END`,
    `updated_at = CURRENT_TIMESTAMP`,
  ]
  const args: any[] = [input.status, input.status, input.status]
  if (input.providerSessionId) {
    sets.push(`provider_session_id = COALESCE(NULLIF(provider_session_id,''), ?)`); args.push(input.providerSessionId)
  }
  if (input.providerOrderId) {
    sets.push(`provider_order_id = COALESCE(NULLIF(provider_order_id,''), ?)`); args.push(input.providerOrderId)
  }
  let where = ''
  if (input.id && Number.isFinite(input.id) && input.id > 0) {
    where = `id = ?`
    args.push(Math.round(input.id))
  } else if (input.checkoutId) {
    where = `checkout_id = ?`
    args.push(input.checkoutId)
  } else {
    return
  }
  await db.query(
    `UPDATE payment_checkout_sessions SET ${sets.join(', ')} WHERE ${where}`,
    args
  )
}

export async function getCheckoutSessionByProviderSession(params: {
  provider: PaymentProvider
  providerSessionId: string
}): Promise<PaymentCheckoutSessionRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT * FROM payment_checkout_sessions
      WHERE provider = ? AND provider_session_id = ?
      ORDER BY id DESC LIMIT 1`,
    [params.provider, params.providerSessionId]
  )
  return ((rows as any[])[0] || null) as PaymentCheckoutSessionRow | null
}

export async function getCheckoutSessionById(id: number): Promise<PaymentCheckoutSessionRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM payment_checkout_sessions WHERE id = ? LIMIT 1`, [id])
  return ((rows as any[])[0] || null) as PaymentCheckoutSessionRow | null
}

export async function getCheckoutSessionByCheckoutId(checkoutId: string): Promise<PaymentCheckoutSessionRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM payment_checkout_sessions WHERE checkout_id = ? LIMIT 1`, [checkoutId])
  return ((rows as any[])[0] || null) as PaymentCheckoutSessionRow | null
}

export async function getCheckoutSessionByProviderOrder(params: {
  provider: PaymentProvider
  providerOrderId: string
}): Promise<PaymentCheckoutSessionRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT * FROM payment_checkout_sessions
      WHERE provider = ? AND provider_order_id = ?
      ORDER BY id DESC LIMIT 1`,
    [params.provider, params.providerOrderId]
  )
  return ((rows as any[])[0] || null) as PaymentCheckoutSessionRow | null
}

export async function insertWebhookEvent(input: {
  provider: PaymentProvider
  mode: PaymentMode
  providerEventId: string | null
  eventType: string
  dedupeKey: string
  signatureValid: boolean
  payloadJson: string
  headersJson: string | null
  receivedAtUtc: string
}): Promise<{ inserted: boolean; row: PaymentWebhookEventRow | null }> {
  const db = getPool()
  const [res] = await db.query(
    `INSERT IGNORE INTO payment_webhook_events
      (
        provider, mode, provider_event_id, event_type,
        dedupe_key, signature_valid, processing_state,
        payload_json, headers_json, received_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      input.provider,
      input.mode,
      input.providerEventId,
      input.eventType,
      input.dedupeKey,
      input.signatureValid ? 1 : 0,
      input.payloadJson,
      input.headersJson,
      input.receivedAtUtc,
    ]
  )
  const inserted = Number((res as any)?.affectedRows || 0) > 0
  const [rows] = await db.query(
    `SELECT * FROM payment_webhook_events WHERE dedupe_key = ? LIMIT 1`,
    [input.dedupeKey]
  )
  return { inserted, row: ((rows as any[])[0] || null) as PaymentWebhookEventRow | null }
}

export async function markWebhookEventProcessed(input: {
  dedupeKey: string
  processingState: PaymentWebhookProcessingState
  errorMessage?: string | null
}): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE payment_webhook_events
      SET processing_state = ?,
          error_message = ?,
          processed_at = CASE WHEN ? IN ('processed','ignored','failed') THEN UTC_TIMESTAMP() ELSE processed_at END
      WHERE dedupe_key = ?`,
    [input.processingState, input.errorMessage || null, input.processingState, input.dedupeKey]
  )
}

export async function upsertPaymentTransaction(input: {
  checkoutSessionId: number
  checkoutId: string
  provider: PaymentProvider
  mode: PaymentMode
  intent: 'donate' | 'subscribe'
  status: PaymentTransactionStatus
  source: 'webhook' | 'return'
  providerEventId: string | null
  providerEventType: string | null
  providerSessionId: string | null
  providerOrderId: string | null
  providerSubscriptionId: string | null
  userId: number | null
  messageId: number | null
  messageCampaignKey: string | null
  messageIntentId: string | null
  messageCtaDefinitionId: number | null
  catalogItemId: number | null
  amountCents: number | null
  currency: string
  occurredAtUtc: string
}): Promise<void> {
  const db = getPool()
  await db.query(
    `INSERT INTO payment_transactions
      (
        checkout_session_id, checkout_id, provider, mode, intent, status, source,
        provider_event_id, provider_event_type, provider_session_id, provider_order_id, provider_subscription_id,
        user_id, message_id, message_campaign_key, message_intent_id, message_cta_definition_id, catalog_item_id,
        amount_cents, currency, occurred_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        source = VALUES(source),
        provider_event_id = COALESCE(VALUES(provider_event_id), provider_event_id),
        provider_event_type = COALESCE(VALUES(provider_event_type), provider_event_type),
        provider_session_id = COALESCE(VALUES(provider_session_id), provider_session_id),
        provider_order_id = COALESCE(VALUES(provider_order_id), provider_order_id),
        provider_subscription_id = COALESCE(VALUES(provider_subscription_id), provider_subscription_id),
        amount_cents = COALESCE(VALUES(amount_cents), amount_cents),
        currency = COALESCE(VALUES(currency), currency),
        occurred_at = VALUES(occurred_at),
        updated_at = CURRENT_TIMESTAMP`,
    [
      input.checkoutSessionId,
      input.checkoutId,
      input.provider,
      input.mode,
      input.intent,
      input.status,
      input.source,
      input.providerEventId,
      input.providerEventType,
      input.providerSessionId,
      input.providerOrderId,
      input.providerSubscriptionId,
      input.userId,
      input.messageId,
      input.messageCampaignKey,
      input.messageIntentId,
      input.messageCtaDefinitionId,
      input.catalogItemId,
      input.amountCents,
      input.currency,
      input.occurredAtUtc,
    ]
  )
}

export async function upsertPaymentSubscription(input: {
  provider: PaymentProvider
  mode: PaymentMode
  providerSubscriptionId: string
  status: PaymentSubscriptionStatus
  userId: number | null
  checkoutSessionId: number | null
  checkoutId: string | null
  providerOrderId: string | null
  catalogItemId: number | null
  amountCents: number | null
  currency: string
  messageId: number | null
  messageCampaignKey: string | null
  lastEventType: string | null
  lastEventAtUtc: string
  clearPendingAction?: boolean
}): Promise<void> {
  const db = getPool()
  const clearPendingAction = input.clearPendingAction !== false
  await db.query(
    `INSERT INTO payment_subscriptions
      (
        provider, mode, provider_subscription_id, status,
        user_id, checkout_session_id, checkout_id, provider_order_id, catalog_item_id,
        amount_cents, currency, message_id, message_campaign_key,
        last_event_type, last_event_at,
        pending_action, pending_plan_key, pending_requested_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        user_id = COALESCE(VALUES(user_id), user_id),
        checkout_session_id = COALESCE(VALUES(checkout_session_id), checkout_session_id),
        checkout_id = COALESCE(VALUES(checkout_id), checkout_id),
        provider_order_id = COALESCE(VALUES(provider_order_id), provider_order_id),
        catalog_item_id = COALESCE(VALUES(catalog_item_id), catalog_item_id),
        amount_cents = COALESCE(VALUES(amount_cents), amount_cents),
        currency = COALESCE(VALUES(currency), currency),
        message_id = COALESCE(VALUES(message_id), message_id),
        message_campaign_key = COALESCE(VALUES(message_campaign_key), message_campaign_key),
        last_event_type = COALESCE(VALUES(last_event_type), last_event_type),
        last_event_at = VALUES(last_event_at),
        pending_action = CASE WHEN ? = 1 THEN NULL ELSE pending_action END,
        pending_plan_key = CASE WHEN ? = 1 THEN NULL ELSE pending_plan_key END,
        pending_requested_at = CASE WHEN ? = 1 THEN NULL ELSE pending_requested_at END,
        updated_at = CURRENT_TIMESTAMP`,
    [
      input.provider,
      input.mode,
      input.providerSubscriptionId,
      input.status,
      input.userId,
      input.checkoutSessionId,
      input.checkoutId,
      input.providerOrderId,
      input.catalogItemId,
      input.amountCents,
      input.currency,
      input.messageId,
      input.messageCampaignKey,
      input.lastEventType,
      input.lastEventAtUtc,
      clearPendingAction ? 1 : 0,
      clearPendingAction ? 1 : 0,
      clearPendingAction ? 1 : 0,
    ]
  )
}

export async function listRecentTransactionsForUser(input: {
  userId: number
  limit?: number
}): Promise<PaymentTransactionRow[]> {
  const db = getPool()
  const lim = Number.isFinite(Number(input.limit)) ? Math.max(1, Math.min(200, Math.floor(Number(input.limit)))) : 50
  const [rows] = await db.query(
    `SELECT * FROM payment_transactions
      WHERE user_id = ?
      ORDER BY occurred_at DESC, id DESC
      LIMIT ${lim}`,
    [input.userId]
  )
  return (rows as any[]) as PaymentTransactionRow[]
}

export async function sumCompletedTransactionsForUser(input: {
  userId: number
  sinceUtc?: string | null
}): Promise<number> {
  const db = getPool()
  let sql = `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payment_transactions WHERE user_id = ? AND status = 'completed'`
  const args: any[] = [input.userId]
  if (input.sinceUtc) {
    sql += ` AND occurred_at >= ?`
    args.push(input.sinceUtc)
  }
  const [rows] = await db.query(sql, args)
  const n = Number((rows as any[])[0]?.total || 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

export async function sumCompletedCheckoutSessionsForUser(input: {
  userId: number
  sinceUtc?: string | null
  intent?: PaymentIntent | null
}): Promise<number> {
  const db = getPool()
  let sql = `SELECT COALESCE(SUM(amount_cents), 0) AS total
             FROM payment_checkout_sessions
             WHERE user_id = ?
               AND status = 'completed'`
  const args: any[] = [input.userId]
  if (input.intent) {
    sql += ` AND intent = ?`
    args.push(input.intent)
  }
  if (input.sinceUtc) {
    sql += ` AND COALESCE(completed_at, updated_at, created_at) >= ?`
    args.push(input.sinceUtc)
  }
  const [rows] = await db.query(sql, args)
  const n = Number((rows as any[])[0]?.total || 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

export async function listSubscriptionsForUser(input: {
  userId: number
  limit?: number
}): Promise<PaymentSubscriptionRow[]> {
  const db = getPool()
  const lim = Number.isFinite(Number(input.limit)) ? Math.max(1, Math.min(200, Math.floor(Number(input.limit)))) : 20
  const [rows] = await db.query(
    `SELECT * FROM payment_subscriptions
      WHERE user_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT ${lim}`,
    [input.userId]
  )
  return (rows as any[]) as PaymentSubscriptionRow[]
}

export async function getSubscriptionByIdForUser(input: {
  id: number
  userId: number
}): Promise<PaymentSubscriptionRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT * FROM payment_subscriptions WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.id, input.userId]
  )
  return ((rows as any[])[0] || null) as PaymentSubscriptionRow | null
}

export async function setSubscriptionPendingAction(input: {
  id: number
  action: PaymentSubscriptionAction
  pendingPlanKey?: string | null
  requestedAtUtc: string
}): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE payment_subscriptions
      SET pending_action = ?,
          pending_plan_key = ?,
          pending_requested_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [input.action, input.pendingPlanKey || null, input.requestedAtUtc, input.id]
  )
}
