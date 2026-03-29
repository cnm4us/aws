import crypto from 'crypto'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { DomainError } from '../../core/errors'
import { getLogger } from '../../lib/logger'
import { buildCanonicalAnalyticsEvent } from '../analytics-events/contract'
import { dispatchCanonicalAnalyticsEvent } from '../analytics-sink/service'
import * as messageRepo from '../messages/repo'
import type {
  MessageAnalyticsCtaKind,
  MessageAnalyticsDayRow,
  MessageAnalyticsInputEvent,
  MessageAnalyticsKpis,
  MessageAnalyticsMessageRow,
  MessageAnalyticsReport,
  MessageAnalyticsSurface,
  MessageAnalyticsViewerState,
} from './types'
import * as repo from './repo'

const analyticsLogger = getLogger({ component: 'features.message_analytics' })
const tracer = trace.getTracer('aws.message.analytics')

const DEDUPE_WINDOW_SECONDS = 5
const AUTH_ATTRIBUTION_WINDOW_HOURS = 24
const RAW_RETENTION_DAYS = 90
const ROLLUP_RETENTION_DAYS = 365

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

function toUtcDateTimeString(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
}

function toUtcDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

function parseYmd(raw: any, key: string): Date {
  const value = String(raw || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  const d = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(d.getTime())) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return d
}

function normalizeSurface(raw: any): MessageAnalyticsSurface | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (v === 'global_feed' || v === 'group_feed' || v === 'channel_feed') return v
  throw new DomainError('invalid_surface', 'invalid_surface', 400)
}

function normalizeViewerState(raw: any): MessageAnalyticsViewerState | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (v === 'anonymous' || v === 'authenticated') return v
  throw new DomainError('invalid_viewer_state', 'invalid_viewer_state', 400)
}

function normalizeMessageId(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('invalid_message_id', 'invalid_message_id', 400)
  return Math.round(n)
}

function normalizeMessageType(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (!v) return null
  if (!['register_login', 'fund_drive', 'subscription_upgrade', 'sponsor_message', 'feature_announcement'].includes(v)) {
    throw new DomainError('invalid_message_type', 'invalid_message_type', 400)
  }
  return v
}

function normalizeCampaignKey(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (!v) return null
  if (!/^[a-z0-9_-]{1,64}$/.test(v)) throw new DomainError('invalid_message_campaign_key', 'invalid_message_campaign_key', 400)
  return v
}

function normalizeSessionId(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim()
  if (!v) return null
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(v)) throw new DomainError('invalid_session_id', 'invalid_session_id', 400)
  return v
}

function normalizeEvent(raw: any): MessageAnalyticsInputEvent {
  const v = String(raw || '').trim().toLowerCase()
  if (
    v === 'impression' ||
    v === 'click' ||
    v === 'pass_through' ||
    v === 'dismiss' ||
    v === 'auth_start' ||
    v === 'auth_complete' ||
    v === 'donation_complete' ||
    v === 'subscription_complete' ||
    v === 'upgrade_complete'
  ) return v
  throw new DomainError('invalid_message_event', 'invalid_message_event', 400)
}

function normalizeCtaKind(raw: any): MessageAnalyticsCtaKind {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (v === 'primary' || v === 'secondary') return v
  throw new DomainError('invalid_message_cta_kind', 'invalid_message_cta_kind', 400)
}

function normalizeFlow(raw: any): 'login' | 'register' | 'donate' | 'subscribe' | 'upgrade' | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (v === 'login' || v === 'register' || v === 'donate' || v === 'subscribe' || v === 'upgrade') return v
  throw new DomainError('invalid_message_flow', 'invalid_message_flow', 400)
}

function normalizeIntentId(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) {
    throw new DomainError('invalid_message_intent_id', 'invalid_message_intent_id', 400)
  }
  return v
}

function normalizeSequenceKey(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim()
  if (!v) return null
  if (v.length > 191) throw new DomainError('invalid_message_sequence_key', 'invalid_message_sequence_key', 400)
  return v
}

function mapToEventType(event: MessageAnalyticsInputEvent) {
  if (event === 'impression') return 'message_impression' as const
  if (event === 'pass_through' || event === 'dismiss') return 'message_dismiss' as const
  if (event === 'auth_start') return 'auth_start_from_message' as const
  if (event === 'auth_complete') return 'auth_complete_from_message' as const
  if (event === 'donation_complete') return 'donation_complete_from_message' as const
  if (event === 'subscription_complete') return 'subscription_complete_from_message' as const
  if (event === 'upgrade_complete') return 'upgrade_complete_from_message' as const
  return 'message_click' as const
}

function computeRate(numerator: number, denominator: number): number {
  const num = Number(numerator || 0)
  const den = Number(denominator || 0)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0
  return num / den
}

function percentage(rate: number): string {
  return `${(Math.max(0, rate) * 100).toFixed(2)}%`
}

function dedupeBucket(nowMs: number): { bucketStartMs: number; bucketStart: string } {
  const sizeMs = DEDUPE_WINDOW_SECONDS * 1000
  const bucketMs = Math.floor(nowMs / sizeMs) * sizeMs
  return {
    bucketStartMs: bucketMs,
    bucketStart: toUtcDateTimeString(new Date(bucketMs)),
  }
}

function dedupeIdentity(input: { sessionId: string | null; userId: number | null }): string {
  if (input.userId != null && Number.isFinite(Number(input.userId)) && Number(input.userId) > 0) {
    return `u:${Math.round(Number(input.userId))}`
  }
  if (input.sessionId) return `s:${input.sessionId}`
  return 'none'
}

function dedupeKey(input: {
  eventType: string
  surface: MessageAnalyticsSurface
  messageId: number
  ctaKind: MessageAnalyticsCtaKind
  messageCtaSlot: number | null
  messageCtaDefinitionId: number | null
  identity: string
  bucketStartMs: number
}): string {
  return crypto
    .createHash('sha256')
    .update(
      `${input.eventType}|${input.surface}|${input.messageId}|${input.ctaKind || '-'}|${input.messageCtaSlot ?? '-'}|${input.messageCtaDefinitionId ?? '-'}|${input.identity}|${input.bucketStartMs}`
    )
    .digest('hex')
}

async function maybeLookupMessageMeta(messageId: number): Promise<{ messageCampaignKey: string | null }> {
  const row = await messageRepo.getById(messageId)
  if (!row) return { messageCampaignKey: null }
  const messageCampaignKey = row.campaign_key ? String(row.campaign_key).trim().toLowerCase() : null
  return { messageCampaignKey }
}

type RecordMessageEventInput = {
  event: MessageAnalyticsInputEvent | string
  surface?: MessageAnalyticsSurface | string | null
  viewerState?: MessageAnalyticsViewerState | string | null
  sessionId?: string | null
  userId?: number | string | null
  messageId: number | string | null | undefined
  messageCampaignKey?: string | null
  ctaKind?: MessageAnalyticsCtaKind | string | null
  messageCtaSlot?: number | string | null
  messageCtaDefinitionId?: number | string | null
  messageCtaIntentKey?: string | null
  messageCtaExecutorType?: string | null
  flow?: 'login' | 'register' | 'donate' | 'subscribe' | 'upgrade' | string | null
  intentId?: string | null
  messageSequenceKey?: string | null
  occurredAt?: Date
}

function normalizeMessageCtaSlot(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1 || n > 3) throw new DomainError('invalid_message_cta_slot', 'invalid_message_cta_slot', 400)
  return Math.round(n)
}

function normalizeMessageCtaDefinitionId(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('invalid_message_cta_definition_id', 'invalid_message_cta_definition_id', 400)
  return Math.round(n)
}

function normalizeMessageCtaKey(raw: any, code: string): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (!v) return null
  if (!/^[a-z0-9_:-]{1,64}$/.test(v)) throw new DomainError(code, code, 400)
  return v
}

export async function recordMessageEvent(input: RecordMessageEventInput): Promise<{
  inserted: boolean
  countedInRollup: boolean
  inputEvent: MessageAnalyticsInputEvent
  eventType: string
  surface: MessageAnalyticsSurface
  messageId: number
  attributed: boolean
}> {
  return tracer.startActiveSpan('message.analytics.ingest', { attributes: { 'app.operation': 'analytics.ingest', 'app.operation_detail': 'message.analytics.ingest' } }, async (span) => {
    try {
      const event = normalizeEvent(input.event)
      const surface = input.surface == null || input.surface === '' ? 'global_feed' : normalizeSurface(input.surface)
      if (!surface) throw new DomainError('invalid_surface', 'invalid_surface', 400)
      const messageId = normalizeMessageId(input.messageId)
      if (messageId == null) throw new DomainError('invalid_message_id', 'invalid_message_id', 400)

      const viewerState = input.viewerState == null || input.viewerState === ''
        ? (input.userId != null && Number(input.userId) > 0 ? 'authenticated' : 'anonymous')
        : (normalizeViewerState(input.viewerState) || 'anonymous')

      const sessionId = normalizeSessionId(input.sessionId)
      const userId = input.userId != null && Number.isFinite(Number(input.userId)) && Number(input.userId) > 0
        ? Math.round(Number(input.userId))
        : null

      let messageCampaignKey = normalizeCampaignKey(input.messageCampaignKey)
      const ctaKind = normalizeCtaKind(input.ctaKind)
      const messageCtaSlot = normalizeMessageCtaSlot(input.messageCtaSlot)
      const messageCtaDefinitionId = normalizeMessageCtaDefinitionId(input.messageCtaDefinitionId)
      const messageCtaIntentKey = normalizeMessageCtaKey(input.messageCtaIntentKey, 'invalid_message_cta_intent_key')
      const messageCtaExecutorType = normalizeMessageCtaKey(input.messageCtaExecutorType, 'invalid_message_cta_executor_type')
      const flow = normalizeFlow(input.flow)
      const intentId = normalizeIntentId(input.intentId)
      const messageSequenceKey = normalizeSequenceKey(input.messageSequenceKey)
      const eventType = mapToEventType(event)

      if (!messageCampaignKey) {
        try {
          const looked = await maybeLookupMessageMeta(messageId)
          if (!messageCampaignKey) messageCampaignKey = looked.messageCampaignKey
        } catch {}
      }

      const nowDate = input.occurredAt instanceof Date && Number.isFinite(input.occurredAt.getTime()) ? input.occurredAt : new Date()
      const canonical = buildCanonicalAnalyticsEvent({
        eventName: eventType,
        occurredAt: nowDate,
        surface,
        viewerState,
        sessionId,
        userId,
        messageId,
        meta: {
          input_event: event,
          ...(messageCampaignKey ? { message_campaign_key: messageCampaignKey } : {}),
          ...(ctaKind ? { cta_kind: ctaKind } : {}),
          ...(messageCtaSlot != null ? { message_cta_slot: messageCtaSlot } : {}),
          ...(messageCtaDefinitionId != null ? { message_cta_definition_id: messageCtaDefinitionId } : {}),
          ...(messageCtaIntentKey ? { message_cta_intent_key: messageCtaIntentKey } : {}),
          ...(messageCtaExecutorType ? { message_cta_executor_type: messageCtaExecutorType } : {}),
          ...(flow ? { flow } : {}),
          ...(intentId ? { intent_id: intentId } : {}),
          ...(messageSequenceKey ? { message_sequence_key: messageSequenceKey } : {}),
          source_route: 'feed_message_events',
        },
      })

      const nowMs = nowDate.getTime()
      const occurredAt = toUtcDateTimeString(canonical.occurredAt)
      const dayUtc = toUtcDateString(canonical.occurredAt)
      const bucket = dedupeBucket(nowMs)
      const identity = dedupeIdentity({ sessionId: canonical.sessionId, userId: canonical.userId })
      const key = dedupeKey({
        eventType,
        surface,
        messageId: canonical.messageId || messageId,
        ctaKind,
        messageCtaSlot,
        messageCtaDefinitionId,
        identity,
        bucketStartMs: bucket.bucketStartMs,
      })

      let attributed = true
      if (eventType === 'auth_complete_from_message') {
        const sinceMs = nowMs - AUTH_ATTRIBUTION_WINDOW_HOURS * 60 * 60 * 1000
        const hasStart = await repo.hasRecentAuthStart({
          sessionId: canonical.sessionId,
          userId: canonical.userId,
          messageId: canonical.messageId || messageId,
          sinceDateTimeUtc: toUtcDateTimeString(new Date(sinceMs)),
        })
        attributed = hasStart
      }

      const inserted = await repo.insertEvent({
        eventType,
        surface,
        viewerState: canonical.viewerState,
        sessionId: canonical.sessionId,
        userId: canonical.userId,
        messageId: canonical.messageId || messageId,
        messageCampaignKey,
        ctaKind,
        messageCtaSlot,
        messageCtaDefinitionId,
        messageCtaIntentKey,
        messageCtaExecutorType,
        flow,
        intentId,
        messageSequenceKey,
        attributed,
        occurredAt,
        dedupeBucketStart: bucket.bucketStart,
        dedupeKey: key,
      })

      const countInRollup = eventType !== 'auth_complete_from_message' || attributed
      if (inserted.inserted && countInRollup) {
        await tracer.startActiveSpan(
          'analytics.rollup',
          {
            attributes: {
              'app.operation': 'analytics.rollup',
              'app.operation_detail': 'message.analytics.rollup',
              'app.surface': surface,
              'analytics.rollup.table': 'feed_message_daily_stats',
            },
          },
          async (rollupSpan) => {
            try {
              await repo.upsertDailyCount({
                dateUtc: dayUtc,
                surface,
                messageId: canonical.messageId || messageId,
                messageCampaignKey,
                viewerState: canonical.viewerState,
                eventType,
                totalDelta: 1,
              })
              rollupSpan.setAttributes({ 'app.outcome': 'success' })
              rollupSpan.setStatus({ code: SpanStatusCode.OK })
            } catch (err: any) {
              rollupSpan.recordException(err)
              rollupSpan.setAttributes({ 'app.outcome': 'server_error' })
              rollupSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'analytics_rollup_failed') })
              throw err
            } finally {
              rollupSpan.end()
            }
          }
        )
      }

      if (inserted.inserted) {
        void dispatchCanonicalAnalyticsEvent({
          event: canonical,
          source: 'message.analytics.ingest',
        }).catch(() => {})
      }

      if (inserted.inserted && Math.random() < 0.02) {
        void repo.purgeExpiredData({ rawRetentionDays: RAW_RETENTION_DAYS, rollupRetentionDays: ROLLUP_RETENTION_DAYS })
      }

      span.setAttributes({
        'app.surface': surface,
        'app.message_id': String(canonical.messageId || messageId),
        ...(messageCampaignKey ? { 'app.message_campaign_key': messageCampaignKey } : {}),
        'app.outcome': inserted.inserted ? 'success' : 'redirect',
        'app.event_name': canonical.eventName,
        'message.analytics.event_type': eventType,
        'message.analytics.deduped': inserted.inserted ? false : true,
        'message.analytics.attributed': attributed,
        ...(flow ? { 'message.analytics.flow': flow } : {}),
        ...(intentId ? { 'message.analytics.intent_id': intentId } : {}),
      })
      span.setStatus({ code: SpanStatusCode.OK })

      analyticsLogger.info(
        {
          app_operation: 'analytics.ingest',
          app_operation_detail: 'message.analytics.ingest',
          app_surface: surface,
          app_message_id: canonical.messageId || messageId,
          app_message_campaign_key: messageCampaignKey,
          app_event_name: canonical.eventName,
          message_event_type: eventType,
          message_event_deduped: !inserted.inserted,
          message_event_attributed: attributed,
          message_flow: flow,
          message_intent_id: intentId,
          message_sequence_key: messageSequenceKey,
          viewer_state: canonical.viewerState,
          user_id: canonical.userId,
          session_id: canonical.sessionId,
        },
        'message.analytics.ingest'
      )

      return {
        inserted: inserted.inserted,
        countedInRollup: Boolean(inserted.inserted && countInRollup),
        inputEvent: event,
        eventType,
        surface,
        messageId: canonical.messageId || messageId,
        attributed,
      }
    } catch (err: any) {
      span.recordException(err)
      span.setAttributes({ 'app.outcome': 'client_error' })
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'message_analytics_ingest_failed') })
      throw err
    } finally {
      span.end()
    }
  })
}

function normalizeReportRange(input: {
  fromDate?: any
  toDate?: any
  surface?: any
  messageId?: any
  messageType?: any
  messageCampaignKey?: any
  viewerState?: any
}): {
  fromDate: string
  toDate: string
  fromDateTime: string
  toDateTimeExclusive: string
  surface: MessageAnalyticsSurface | null
  messageId: number | null
  messageType: string | null
  messageCampaignKey: string | null
  viewerState: MessageAnalyticsViewerState | null
} {
  const now = new Date()
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const defaultFrom = new Date(defaultTo.getTime() - 6 * 24 * 60 * 60 * 1000)

  const from = input.fromDate ? parseYmd(input.fromDate, 'from_date') : defaultFrom
  const to = input.toDate ? parseYmd(input.toDate, 'to_date') : defaultTo
  if (from.getTime() > to.getTime()) throw new DomainError('invalid_date_range', 'invalid_date_range', 400)

  const rangeDays = Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1
  if (rangeDays > 180) throw new DomainError('date_range_too_large', 'date_range_too_large', 400)

  const fromDate = toUtcDateString(from)
  const toDate = toUtcDateString(to)
  const fromDateTime = `${fromDate} 00:00:00`
  const toDateExclusiveObj = new Date(to.getTime() + 24 * 60 * 60 * 1000)
  const toDateTimeExclusive = `${toUtcDateString(toDateExclusiveObj)} 00:00:00`

  return {
    fromDate,
    toDate,
    fromDateTime,
    toDateTimeExclusive,
    surface: normalizeSurface(input.surface),
    messageId: normalizeMessageId(input.messageId),
    messageType: normalizeMessageType(input.messageType),
    messageCampaignKey: normalizeCampaignKey(input.messageCampaignKey),
    viewerState: normalizeViewerState(input.viewerState),
  }
}

function coerceInt(v: any): number {
  const n = Number(v || 0)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n)
}

function buildKpis(input: {
  impressions: number
  clicksPrimary: number
  clicksSecondary: number
  dismiss: number
  authStart: number
  authComplete: number
  impressionsUnique: number
  clicksTotalUnique: number
  dismissUnique: number
  authStartUnique: number
  authCompleteUnique: number
}): MessageAnalyticsKpis {
  const clicksTotal = input.clicksPrimary + input.clicksSecondary
  return {
    totals: {
      impressions: input.impressions,
      clicksPrimary: input.clicksPrimary,
      clicksSecondary: input.clicksSecondary,
      clicksTotal,
      dismiss: input.dismiss,
      authStart: input.authStart,
      authComplete: input.authComplete,
    },
    uniqueSessions: {
      impressions: input.impressionsUnique,
      clicksTotal: input.clicksTotalUnique,
      dismiss: input.dismissUnique,
      authStart: input.authStartUnique,
      authComplete: input.authCompleteUnique,
    },
    rates: {
      ctr: computeRate(clicksTotal, input.impressions),
      dismissRate: computeRate(input.dismiss, input.impressions),
      authStartRate: computeRate(input.authStart, input.impressions),
      authCompletionRate: computeRate(input.authComplete, input.impressions),
      completionPerStart: computeRate(input.authComplete, input.authStart),
    },
  }
}

export async function getMessageAnalyticsReportForAdmin(input: {
  fromDate?: any
  toDate?: any
  surface?: any
  messageId?: any
  messageType?: any
  messageCampaignKey?: any
  viewerState?: any
}): Promise<MessageAnalyticsReport> {
  return tracer.startActiveSpan('message.analytics.query', { attributes: { 'app.operation': 'analytics.query', 'app.operation_detail': 'message.analytics.query' } }, async (span) => {
    try {
      const range = normalizeReportRange(input)
      const [totalsRaw, byMessageRaw, byDayRaw, uniqueTotalsRaw, uniqueByMessageRaw] = await Promise.all([
        repo.getTotalsFromDaily(range),
        repo.getByMessageFromDaily(range),
        repo.getByDayFromDaily(range),
        repo.getUniqueTotalsFromRaw(range),
        repo.getUniqueByMessageFromRaw(range),
      ])

      const uniqueByMessage = new Map<number, any>()
      for (const row of uniqueByMessageRaw) {
        const messageId = coerceInt((row as any).message_id)
        if (messageId <= 0) continue
        uniqueByMessage.set(messageId, row)
      }

      const kpis = buildKpis({
        impressions: coerceInt((totalsRaw as any).impressions),
        clicksPrimary: coerceInt((totalsRaw as any).clicks_primary),
        clicksSecondary: coerceInt((totalsRaw as any).clicks_secondary),
        dismiss: coerceInt((totalsRaw as any).dismiss),
        authStart: coerceInt((totalsRaw as any).auth_start),
        authComplete: coerceInt((totalsRaw as any).auth_complete),
        impressionsUnique: coerceInt((uniqueTotalsRaw as any).impressions_unique),
        clicksTotalUnique: coerceInt((uniqueTotalsRaw as any).clicks_total_unique),
        dismissUnique: coerceInt((uniqueTotalsRaw as any).dismiss_unique),
        authStartUnique: coerceInt((uniqueTotalsRaw as any).auth_start_unique),
        authCompleteUnique: coerceInt((uniqueTotalsRaw as any).auth_complete_unique),
      })

      const byMessage: MessageAnalyticsMessageRow[] = byMessageRaw.map((row) => {
        const messageId = coerceInt((row as any).message_id)
        const impressions = coerceInt((row as any).impressions)
        const clicksPrimary = coerceInt((row as any).clicks_primary)
        const clicksSecondary = coerceInt((row as any).clicks_secondary)
        const dismiss = coerceInt((row as any).dismiss)
        const authStart = coerceInt((row as any).auth_start)
        const authComplete = coerceInt((row as any).auth_complete)

        const uniq = uniqueByMessage.get(messageId) || {}
        const impressionsUnique = coerceInt(uniq.impressions_unique)
        const clicksTotalUnique = coerceInt(uniq.clicks_total_unique)
        const dismissUnique = coerceInt(uniq.dismiss_unique)
        const authStartUnique = coerceInt(uniq.auth_start_unique)
        const authCompleteUnique = coerceInt(uniq.auth_complete_unique)

        return {
          messageId,
          messageName: (row as any).message_name ? String((row as any).message_name) : null,
          messageType: (row as any).message_type ? String((row as any).message_type) : null,
          messageCampaignKey: (row as any).message_campaign_key ? String((row as any).message_campaign_key) : null,
          totals: {
            impressions,
            clicksPrimary,
            clicksSecondary,
            clicksTotal: clicksPrimary + clicksSecondary,
            dismiss,
            authStart,
            authComplete,
          },
          uniqueSessions: {
            impressions: impressionsUnique,
            clicksTotal: clicksTotalUnique,
            dismiss: dismissUnique,
            authStart: authStartUnique,
            authComplete: authCompleteUnique,
          },
          rates: {
            ctr: computeRate(clicksPrimary + clicksSecondary, impressions),
            dismissRate: computeRate(dismiss, impressions),
            authStartRate: computeRate(authStart, impressions),
            authCompletionRate: computeRate(authComplete, impressions),
            completionPerStart: computeRate(authComplete, authStart),
          },
        }
      })

      const byDay: MessageAnalyticsDayRow[] = byDayRaw.map((row) => {
        const impressions = coerceInt((row as any).impressions)
        const clicksTotal = coerceInt((row as any).clicks_total)
        const dismiss = coerceInt((row as any).dismiss)
        const authStart = coerceInt((row as any).auth_start)
        const authComplete = coerceInt((row as any).auth_complete)
        return {
          dateUtc: String((row as any).date_utc || ''),
          totals: {
            impressions,
            clicksTotal,
            dismiss,
            authStart,
            authComplete,
          },
          rates: {
            ctr: computeRate(clicksTotal, impressions),
            dismissRate: computeRate(dismiss, impressions),
            authStartRate: computeRate(authStart, impressions),
            authCompletionRate: computeRate(authComplete, impressions),
          },
        }
      })

      span.setAttributes({
        ...(range.surface ? { 'app.surface': range.surface } : {}),
        ...(range.messageId != null ? { 'app.message_id': String(range.messageId) } : {}),
        ...(range.messageType ? { 'app.message_type': range.messageType } : {}),
        ...(range.messageCampaignKey ? { 'app.message_campaign_key': range.messageCampaignKey } : {}),
        ...(range.viewerState ? { 'message.analytics.viewer_state': range.viewerState } : {}),
        'message.analytics.result_rows': byMessage.length,
        'app.outcome': 'success',
      })
      span.setStatus({ code: SpanStatusCode.OK })

      analyticsLogger.info(
        {
          app_operation: 'analytics.query',
          app_operation_detail: 'message.analytics.query',
          app_surface: range.surface,
          app_message_id: range.messageId,
          app_message_type: range.messageType,
          app_message_campaign_key: range.messageCampaignKey,
          viewer_state: range.viewerState,
          range_from_date: range.fromDate,
          range_to_date: range.toDate,
          result_rows: byMessage.length,
        },
        'message.analytics.query'
      )

      return {
        range: {
          fromDate: range.fromDate,
          toDate: range.toDate,
          surface: range.surface,
          messageId: range.messageId,
          messageType: range.messageType,
          messageCampaignKey: range.messageCampaignKey,
          viewerState: range.viewerState,
        },
        kpis,
        byMessage,
        byDay,
      }
    } catch (err: any) {
      span.recordException(err)
      span.setAttributes({ 'app.outcome': 'client_error' })
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'message_analytics_query_failed') })
      throw err
    } finally {
      span.end()
    }
  })
}

export function buildMessageAnalyticsCsv(report: MessageAnalyticsReport): string {
  const header = [
    'message_id',
    'message_name',
    'message_type',
    'message_campaign_key',
    'impressions',
    'clicks_primary',
    'clicks_secondary',
    'clicks_total',
    'dismiss',
    'auth_start',
    'auth_complete',
    'unique_impressions',
    'unique_clicks_total',
    'unique_dismiss',
    'unique_auth_start',
    'unique_auth_complete',
    'ctr',
    'dismiss_rate',
    'auth_start_rate',
    'auth_completion_rate',
    'completion_per_start',
  ]

  const rows: string[][] = [header]
  for (const row of report.byMessage) {
    rows.push([
      String(row.messageId),
      row.messageName || '',
      row.messageType || '',
      row.messageCampaignKey || '',
      String(row.totals.impressions),
      String(row.totals.clicksPrimary),
      String(row.totals.clicksSecondary),
      String(row.totals.clicksTotal),
      String(row.totals.dismiss),
      String(row.totals.authStart),
      String(row.totals.authComplete),
      String(row.uniqueSessions.impressions),
      String(row.uniqueSessions.clicksTotal),
      String(row.uniqueSessions.dismiss),
      String(row.uniqueSessions.authStart),
      String(row.uniqueSessions.authComplete),
      percentage(row.rates.ctr),
      percentage(row.rates.dismissRate),
      percentage(row.rates.authStartRate),
      percentage(row.rates.authCompletionRate),
      percentage(row.rates.completionPerStart),
    ])
  }

  return rows
    .map((cells) =>
      cells
        .map((cell) => {
          const value = String(cell || '')
          if (!/[",\n]/.test(value)) return value
          return `"${value.replace(/"/g, '""')}"`
        })
        .join(',')
    )
    .join('\n')
}
