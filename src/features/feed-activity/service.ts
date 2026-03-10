import crypto from 'crypto'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { DomainError } from '../../core/errors'
import { getLogger } from '../../lib/logger'
import { buildCanonicalAnalyticsEvent } from '../analytics-events/contract'
import { dispatchCanonicalAnalyticsEvent } from '../analytics-sink/service'
import * as repo from './repo'
import type {
  FeedActivityDayRow,
  FeedActivityEventType,
  FeedActivityInputEvent,
  FeedActivityKpis,
  FeedActivityReport,
  FeedActivitySurface,
  FeedActivityViewerState,
} from './types'

const activityLogger = getLogger({ component: 'features.feed_activity' })
const tracer = trace.getTracer('aws.feed.activity')

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

function normalizeEvent(raw: any): FeedActivityInputEvent {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'session_start' || v === 'slide_impression' || v === 'slide_complete' || v === 'session_end') return v
  throw new DomainError('invalid_feed_activity_event', 'invalid_feed_activity_event', 400)
}

function normalizeSurface(raw: any): FeedActivitySurface {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'global_feed') return 'global_feed'
  throw new DomainError('invalid_feed_activity_surface', 'invalid_feed_activity_surface', 400)
}

function normalizeViewerState(raw: any): FeedActivityViewerState {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'anonymous' || v === 'authenticated') return v
  throw new DomainError('invalid_feed_activity_viewer_state', 'invalid_feed_activity_viewer_state', 400)
}

function normalizeSessionId(raw: any): string {
  const v = String(raw || '').trim()
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(v)) {
    throw new DomainError('invalid_feed_activity_session_id', 'invalid_feed_activity_session_id', 400)
  }
  return v
}

function normalizeUserId(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('invalid_feed_activity_user_id', 'invalid_feed_activity_user_id', 400)
  return Math.round(n)
}

function normalizeContentId(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('invalid_feed_activity_content_id', 'invalid_feed_activity_content_id', 400)
  return Math.round(n)
}

function normalizeWatchSeconds(raw: any): number {
  if (raw == null || raw === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new DomainError('invalid_feed_activity_watch_seconds', 'invalid_feed_activity_watch_seconds', 400)
  return Math.max(0, Math.min(60 * 60 * 24, Math.round(n)))
}

function mapEvent(inputEvent: FeedActivityInputEvent): FeedActivityEventType {
  if (inputEvent === 'session_start') return 'feed_session_start'
  if (inputEvent === 'slide_impression') return 'feed_slide_impression'
  if (inputEvent === 'slide_complete') return 'feed_slide_complete'
  return 'feed_session_end'
}

function dedupeIdentity(input: { sessionId: string; userId: number | null }): string {
  if (input.userId != null && Number.isFinite(Number(input.userId)) && Number(input.userId) > 0) {
    return `u:${Math.round(Number(input.userId))}`
  }
  return `s:${input.sessionId}`
}

function dedupeKey(input: {
  eventType: FeedActivityEventType
  surface: FeedActivitySurface
  identity: string
  contentId: number | null
  dedupeBucket: string
}): string {
  return crypto
    .createHash('sha256')
    .update(`${input.eventType}|${input.surface}|${input.identity}|${input.contentId == null ? '-' : String(input.contentId)}|${input.dedupeBucket}`)
    .digest('hex')
}

type RecordFeedActivityInput = {
  event: FeedActivityInputEvent | string
  surface?: FeedActivitySurface | string | null
  viewerState?: FeedActivityViewerState | string | null
  sessionId?: string | null
  userId?: number | string | null
  contentId?: number | string | null
  watchSeconds?: number | string | null
  occurredAt?: Date
}

export async function recordFeedActivityEvent(input: RecordFeedActivityInput): Promise<{
  inserted: boolean
  countedInRollup: boolean
  inputEvent: FeedActivityInputEvent
  eventType: FeedActivityEventType
  surface: FeedActivitySurface
  contentId: number | null
}> {
  return tracer.startActiveSpan('feed.activity.ingest', { attributes: { 'app.operation': 'feed.activity.ingest' } }, async (span) => {
    try {
      const inputEvent = normalizeEvent(input.event)
      const eventType = mapEvent(inputEvent)
      const surface = normalizeSurface(input.surface == null || input.surface === '' ? 'global_feed' : input.surface)
      const userId = normalizeUserId(input.userId)
      const viewerState = input.viewerState == null || input.viewerState === ''
        ? (userId != null ? 'authenticated' : 'anonymous')
        : normalizeViewerState(input.viewerState)
      const sessionId = normalizeSessionId(input.sessionId)
      const contentId = normalizeContentId(input.contentId)
      const watchSeconds = normalizeWatchSeconds(input.watchSeconds)

      if ((eventType === 'feed_slide_impression' || eventType === 'feed_slide_complete') && contentId == null) {
        throw new DomainError('invalid_feed_activity_content_id', 'invalid_feed_activity_content_id', 400)
      }
      if (eventType === 'feed_session_end' && watchSeconds <= 0) {
        throw new DomainError('invalid_feed_activity_watch_seconds', 'invalid_feed_activity_watch_seconds', 400)
      }

      const nowDate = input.occurredAt instanceof Date && Number.isFinite(input.occurredAt.getTime()) ? input.occurredAt : new Date()
      const canonical = buildCanonicalAnalyticsEvent({
        eventName: eventType,
        occurredAt: nowDate,
        surface,
        viewerState,
        sessionId,
        userId,
        contentId,
        meta: {
          input_event: inputEvent,
          source_route: 'feed_activity_events',
        },
      })

      const occurredAt = toUtcDateTimeString(canonical.occurredAt)
      const occurredMs = canonical.occurredAt.getTime()
      const dayUtc = toUtcDateString(canonical.occurredAt)
      const identity = dedupeIdentity({ sessionId: canonical.sessionId || sessionId, userId: canonical.userId })
      const dedupeBucket = (eventType === 'feed_session_start' || eventType === 'feed_session_end')
        ? `m:${Math.floor(occurredMs / (60 * 1000))}`
        : 'session'
      const key = dedupeKey({
        eventType,
        surface: canonical.surface,
        identity,
        contentId: canonical.contentId,
        dedupeBucket,
      })

      const inserted = await repo.insertEvent({
        eventType,
        surface: canonical.surface,
        viewerState: canonical.viewerState,
        sessionId: canonical.sessionId || sessionId,
        userId: canonical.userId,
        contentId: canonical.contentId,
        watchSeconds: eventType === 'feed_session_end' ? watchSeconds : 0,
        occurredAt,
        dedupeKey: key,
      })

      if (inserted.inserted) {
        await repo.upsertDailyCount({
          dateUtc: dayUtc,
          surface: canonical.surface,
          viewerState: canonical.viewerState,
          eventType,
          contentId: canonical.contentId,
          totalEventsDelta: 1,
          watchSecondsDelta: eventType === 'feed_session_end' ? watchSeconds : 0,
        })
        void dispatchCanonicalAnalyticsEvent({
          event: canonical,
          source: 'feed.activity.ingest',
        }).catch(() => {})
      }

      if (inserted.inserted && Math.random() < 0.02) {
        void repo.purgeExpiredData({ rawRetentionDays: RAW_RETENTION_DAYS, rollupRetentionDays: ROLLUP_RETENTION_DAYS })
      }

      span.setAttributes({
        'app.surface': canonical.surface,
        'app.event_name': canonical.eventName,
        'app.outcome': inserted.inserted ? 'success' : 'redirect',
        ...(canonical.contentId != null ? { 'app.content_id': String(canonical.contentId) } : {}),
        'feed.activity.deduped': inserted.inserted ? false : true,
      })
      span.setStatus({ code: SpanStatusCode.OK })

      activityLogger.info(
        {
          app_operation: 'feed.activity.ingest',
          app_surface: canonical.surface,
          app_event_name: canonical.eventName,
          app_content_id: canonical.contentId,
          feed_activity_event_type: eventType,
          feed_activity_deduped: !inserted.inserted,
          feed_activity_watch_seconds: eventType === 'feed_session_end' ? watchSeconds : 0,
          viewer_state: canonical.viewerState,
          user_id: canonical.userId,
          session_id: canonical.sessionId || sessionId,
        },
        'feed.activity.ingest'
      )

      return {
        inserted: inserted.inserted,
        countedInRollup: inserted.inserted,
        inputEvent,
        eventType,
        surface: canonical.surface,
        contentId: canonical.contentId,
      }
    } catch (err: any) {
      span.recordException(err)
      span.setAttributes({ 'app.outcome': 'client_error' })
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'feed_activity_ingest_failed') })
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
  viewerState?: any
}): {
  fromDate: string
  toDate: string
  surface: FeedActivitySurface | null
  viewerState: FeedActivityViewerState | null
} {
  const now = new Date()
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const defaultFrom = new Date(defaultTo.getTime() - 6 * 24 * 60 * 60 * 1000)

  const from = input.fromDate ? parseYmd(input.fromDate, 'from_date') : defaultFrom
  const to = input.toDate ? parseYmd(input.toDate, 'to_date') : defaultTo
  if (from.getTime() > to.getTime()) throw new DomainError('invalid_date_range', 'invalid_date_range', 400)

  const rangeDays = Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1
  if (rangeDays > 180) throw new DomainError('date_range_too_large', 'date_range_too_large', 400)

  return {
    fromDate: toUtcDateString(from),
    toDate: toUtcDateString(to),
    surface: input.surface == null || input.surface === '' ? null : normalizeSurface(input.surface),
    viewerState: input.viewerState == null || input.viewerState === '' ? null : normalizeViewerState(input.viewerState),
  }
}

function coerceInt(v: any): number {
  const n = Number(v || 0)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n)
}

function rate(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return numerator / denominator
}

function buildKpis(input: {
  sessionsStarted: number
  sessionsEnded: number
  slideImpressions: number
  slideCompletes: number
  totalWatchSeconds: number
}): FeedActivityKpis {
  const denom = input.sessionsEnded > 0 ? input.sessionsEnded : input.sessionsStarted
  return {
    totals: input,
    rates: {
      completionRate: rate(input.slideCompletes, input.slideImpressions),
      avgWatchSecondsPerSession: rate(input.totalWatchSeconds, denom),
    },
  }
}

export async function getFeedActivityReportForAdmin(input: {
  fromDate?: any
  toDate?: any
  surface?: any
  viewerState?: any
}): Promise<FeedActivityReport> {
  return tracer.startActiveSpan('feed.activity.query', { attributes: { 'app.operation': 'feed.activity.query' } }, async (span) => {
    try {
      const range = normalizeReportRange(input)
      const filter = {
        fromDate: range.fromDate,
        toDate: range.toDate,
        surface: range.surface,
        viewerState: range.viewerState,
      }
      const [totalsRaw, byDayRaw] = await Promise.all([
        repo.getTotalsFromDaily(filter),
        repo.getByDayFromDaily(filter),
      ])

      const kpis = buildKpis({
        sessionsStarted: coerceInt(totalsRaw.sessions_started),
        sessionsEnded: coerceInt(totalsRaw.sessions_ended),
        slideImpressions: coerceInt(totalsRaw.slide_impressions),
        slideCompletes: coerceInt(totalsRaw.slide_completes),
        totalWatchSeconds: coerceInt(totalsRaw.total_watch_seconds),
      })

      const byDay: FeedActivityDayRow[] = (byDayRaw || []).map((r: any) => {
        const totals = {
          sessionsStarted: coerceInt(r.sessions_started),
          sessionsEnded: coerceInt(r.sessions_ended),
          slideImpressions: coerceInt(r.slide_impressions),
          slideCompletes: coerceInt(r.slide_completes),
          totalWatchSeconds: coerceInt(r.total_watch_seconds),
        }
        const denom = totals.sessionsEnded > 0 ? totals.sessionsEnded : totals.sessionsStarted
        return {
          dateUtc: String(r.date_utc),
          totals,
          rates: {
            completionRate: rate(totals.slideCompletes, totals.slideImpressions),
            avgWatchSecondsPerSession: rate(totals.totalWatchSeconds, denom),
          },
        }
      })

      span.setAttributes({
        ...(range.surface ? { 'app.surface': range.surface } : {}),
        ...(range.viewerState ? { 'feed.activity.viewer_state': range.viewerState } : {}),
        'feed.activity.result_rows': byDay.length,
        'app.outcome': 'success',
      })
      span.setStatus({ code: SpanStatusCode.OK })

      activityLogger.info(
        {
          app_operation: 'feed.activity.query',
          app_surface: range.surface,
          viewer_state: range.viewerState,
          from_date: range.fromDate,
          to_date: range.toDate,
          result_rows: byDay.length,
        },
        'feed.activity.query'
      )

      return {
        range: {
          fromDate: range.fromDate,
          toDate: range.toDate,
          surface: range.surface,
          viewerState: range.viewerState,
        },
        kpis,
        byDay,
      }
    } catch (err: any) {
      span.recordException(err)
      span.setAttributes({ 'app.outcome': 'client_error' })
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'feed_activity_query_failed') })
      throw err
    } finally {
      span.end()
    }
  })
}
