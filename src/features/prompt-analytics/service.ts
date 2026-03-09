import crypto from 'crypto'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { DomainError } from '../../core/errors'
import { getLogger } from '../../lib/logger'
import * as promptRepo from '../prompts/repo'
import type {
  PromptAnalyticsCtaKind,
  PromptAnalyticsDayRow,
  PromptAnalyticsInputEvent,
  PromptAnalyticsKpis,
  PromptAnalyticsPromptKind,
  PromptAnalyticsPromptRow,
  PromptAnalyticsReport,
  PromptAnalyticsSurface,
  PromptAnalyticsViewerState,
} from './types'
import * as repo from './repo'

const analyticsLogger = getLogger({ component: 'features.prompt_analytics' })
const tracer = trace.getTracer('aws.prompt.analytics')

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

function normalizeSurface(raw: any): PromptAnalyticsSurface | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (v !== 'global_feed') throw new DomainError('invalid_surface', 'invalid_surface', 400)
  return 'global_feed'
}

function normalizeViewerState(raw: any): PromptAnalyticsViewerState | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (v === 'anonymous' || v === 'authenticated') return v
  throw new DomainError('invalid_viewer_state', 'invalid_viewer_state', 400)
}

function normalizePromptId(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('invalid_prompt_id', 'invalid_prompt_id', 400)
  return Math.round(n)
}

function normalizeCategory(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (!v) return null
  if (!/^[a-z0-9_-]{1,64}$/.test(v)) throw new DomainError('invalid_prompt_category', 'invalid_prompt_category', 400)
  return v
}

function normalizeSessionId(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim()
  if (!v) return null
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(v)) throw new DomainError('invalid_session_id', 'invalid_session_id', 400)
  return v
}

function normalizePromptKind(raw: any): PromptAnalyticsPromptKind {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (v === 'prompt_full' || v === 'prompt_overlay') return v
  throw new DomainError('invalid_prompt_kind', 'invalid_prompt_kind', 400)
}

function normalizeEvent(raw: any): PromptAnalyticsInputEvent {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'impression' || v === 'click' || v === 'dismiss' || v === 'auth_start' || v === 'auth_complete') return v
  throw new DomainError('bad_event', 'bad_event', 400)
}

function normalizeCtaKind(raw: any): PromptAnalyticsCtaKind {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (v === 'primary' || v === 'secondary') return v
  throw new DomainError('bad_cta_kind', 'bad_cta_kind', 400)
}

function mapToEventType(event: PromptAnalyticsInputEvent, ctaKind: PromptAnalyticsCtaKind) {
  if (event === 'impression') return 'prompt_impression' as const
  if (event === 'dismiss') return 'prompt_dismiss' as const
  if (event === 'auth_start') return 'auth_start_from_prompt' as const
  if (event === 'auth_complete') return 'auth_complete_from_prompt' as const
  return ctaKind === 'secondary' ? 'prompt_click_secondary' : 'prompt_click_primary'
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
  surface: PromptAnalyticsSurface
  promptId: number
  ctaKind: PromptAnalyticsCtaKind
  identity: string
  bucketStartMs: number
}): string {
  return crypto
    .createHash('sha256')
    .update(`${input.eventType}|${input.surface}|${input.promptId}|${input.ctaKind || '-'}|${input.identity}|${input.bucketStartMs}`)
    .digest('hex')
}

async function maybeLookupPromptMeta(promptId: number): Promise<{ promptKind: PromptAnalyticsPromptKind; promptCategory: string | null }> {
  const row = await promptRepo.getById(promptId)
  if (!row) return { promptKind: null, promptCategory: null }
  const promptKind = row.kind === 'prompt_overlay' ? 'prompt_overlay' : 'prompt_full'
  const promptCategory = row.category ? String(row.category).trim().toLowerCase() : null
  return { promptKind, promptCategory }
}

type RecordPromptEventInput = {
  event: PromptAnalyticsInputEvent | string
  surface?: PromptAnalyticsSurface | string | null
  viewerState?: PromptAnalyticsViewerState | string | null
  sessionId?: string | null
  userId?: number | null
  promptId: number
  promptKind?: PromptAnalyticsPromptKind | string | null
  promptCategory?: string | null
  ctaKind?: PromptAnalyticsCtaKind | string | null
  occurredAt?: Date
}

export async function recordPromptEvent(input: RecordPromptEventInput): Promise<{
  inserted: boolean
  countedInRollup: boolean
  eventType: string
  attributed: boolean
}> {
  return tracer.startActiveSpan('prompt.analytics.ingest', { attributes: { 'app.operation': 'prompt.analytics.ingest' } }, async (span) => {
    try {
      const event = normalizeEvent(input.event)
      const surface = input.surface == null || input.surface === '' ? 'global_feed' : normalizeSurface(input.surface)
      if (!surface) throw new DomainError('invalid_surface', 'invalid_surface', 400)
      const promptId = normalizePromptId(input.promptId)
      if (promptId == null) throw new DomainError('bad_prompt_id', 'bad_prompt_id', 400)

      const viewerState = input.viewerState == null || input.viewerState === ''
        ? (input.userId != null && Number(input.userId) > 0 ? 'authenticated' : 'anonymous')
        : (normalizeViewerState(input.viewerState) || 'anonymous')

      const sessionId = normalizeSessionId(input.sessionId)
      const userId = input.userId != null && Number.isFinite(Number(input.userId)) && Number(input.userId) > 0
        ? Math.round(Number(input.userId))
        : null

      let promptKind = normalizePromptKind(input.promptKind)
      let promptCategory = normalizeCategory(input.promptCategory)
      const ctaKind = normalizeCtaKind(input.ctaKind)
      const eventType = mapToEventType(event, ctaKind)

      if (!promptKind || !promptCategory) {
        try {
          const looked = await maybeLookupPromptMeta(promptId)
          if (!promptKind) promptKind = looked.promptKind
          if (!promptCategory) promptCategory = looked.promptCategory
        } catch {}
      }

      const nowDate = input.occurredAt instanceof Date && Number.isFinite(input.occurredAt.getTime()) ? input.occurredAt : new Date()
      const nowMs = nowDate.getTime()
      const occurredAt = toUtcDateTimeString(nowDate)
      const dayUtc = toUtcDateString(nowDate)
      const bucket = dedupeBucket(nowMs)
      const identity = dedupeIdentity({ sessionId, userId })
      const key = dedupeKey({
        eventType,
        surface,
        promptId,
        ctaKind,
        identity,
        bucketStartMs: bucket.bucketStartMs,
      })

      let attributed = true
      if (eventType === 'auth_complete_from_prompt') {
        const sinceMs = nowMs - AUTH_ATTRIBUTION_WINDOW_HOURS * 60 * 60 * 1000
        const hasStart = await repo.hasRecentAuthStart({
          sessionId,
          userId,
          promptId,
          sinceDateTimeUtc: toUtcDateTimeString(new Date(sinceMs)),
        })
        attributed = hasStart
      }

      const inserted = await repo.insertEvent({
        eventType,
        surface,
        viewerState,
        sessionId,
        userId,
        promptId,
        promptKind,
        promptCategory,
        ctaKind,
        attributed,
        occurredAt,
        dedupeBucketStart: bucket.bucketStart,
        dedupeKey: key,
      })

      const countInRollup = eventType !== 'auth_complete_from_prompt' || attributed
      if (inserted.inserted && countInRollup) {
        await repo.upsertDailyCount({
          dateUtc: dayUtc,
          surface,
          promptId,
          promptKind,
          promptCategory,
          viewerState,
          eventType,
          totalDelta: 1,
        })
      }

      if (inserted.inserted && Math.random() < 0.02) {
        void repo.purgeExpiredData({ rawRetentionDays: RAW_RETENTION_DAYS, rollupRetentionDays: ROLLUP_RETENTION_DAYS })
      }

      span.setAttributes({
        'app.surface': surface,
        'app.prompt_id': String(promptId),
        ...(promptKind ? { 'app.prompt_kind': promptKind } : {}),
        ...(promptCategory ? { 'app.prompt_category': promptCategory } : {}),
        'app.outcome': inserted.inserted ? 'success' : 'redirect',
        'prompt.analytics.event_type': eventType,
        'prompt.analytics.deduped': inserted.inserted ? false : true,
        'prompt.analytics.attributed': attributed,
      })
      span.setStatus({ code: SpanStatusCode.OK })

      analyticsLogger.info(
        {
          app_operation: 'prompt.analytics.ingest',
          app_surface: surface,
          app_prompt_id: promptId,
          app_prompt_kind: promptKind,
          app_prompt_category: promptCategory,
          prompt_event_type: eventType,
          prompt_event_deduped: !inserted.inserted,
          prompt_event_attributed: attributed,
          viewer_state: viewerState,
          user_id: userId,
          session_id: sessionId,
        },
        'prompt.analytics.ingest'
      )

      return {
        inserted: inserted.inserted,
        countedInRollup: Boolean(inserted.inserted && countInRollup),
        eventType,
        attributed,
      }
    } catch (err: any) {
      span.recordException(err)
      span.setAttributes({ 'app.outcome': 'client_error' })
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'prompt_analytics_ingest_failed') })
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
  promptId?: any
  promptCategory?: any
  viewerState?: any
}): {
  fromDate: string
  toDate: string
  fromDateTime: string
  toDateTimeExclusive: string
  surface: PromptAnalyticsSurface | null
  promptId: number | null
  promptCategory: string | null
  viewerState: PromptAnalyticsViewerState | null
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
    promptId: normalizePromptId(input.promptId),
    promptCategory: normalizeCategory(input.promptCategory),
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
}): PromptAnalyticsKpis {
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

export async function getPromptAnalyticsReportForAdmin(input: {
  fromDate?: any
  toDate?: any
  surface?: any
  promptId?: any
  promptCategory?: any
  viewerState?: any
}): Promise<PromptAnalyticsReport> {
  return tracer.startActiveSpan('prompt.analytics.query', { attributes: { 'app.operation': 'prompt.analytics.query' } }, async (span) => {
    try {
      const range = normalizeReportRange(input)
      const [totalsRaw, byPromptRaw, byDayRaw, uniqueTotalsRaw, uniqueByPromptRaw] = await Promise.all([
        repo.getTotalsFromDaily(range),
        repo.getByPromptFromDaily(range),
        repo.getByDayFromDaily(range),
        repo.getUniqueTotalsFromRaw(range),
        repo.getUniqueByPromptFromRaw(range),
      ])

      const uniqueByPrompt = new Map<number, any>()
      for (const row of uniqueByPromptRaw) {
        const promptId = coerceInt((row as any).prompt_id)
        if (promptId <= 0) continue
        uniqueByPrompt.set(promptId, row)
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

      const byPrompt: PromptAnalyticsPromptRow[] = byPromptRaw.map((row) => {
        const promptId = coerceInt((row as any).prompt_id)
        const impressions = coerceInt((row as any).impressions)
        const clicksPrimary = coerceInt((row as any).clicks_primary)
        const clicksSecondary = coerceInt((row as any).clicks_secondary)
        const dismiss = coerceInt((row as any).dismiss)
        const authStart = coerceInt((row as any).auth_start)
        const authComplete = coerceInt((row as any).auth_complete)

        const uniq = uniqueByPrompt.get(promptId) || {}
        const impressionsUnique = coerceInt(uniq.impressions_unique)
        const clicksTotalUnique = coerceInt(uniq.clicks_total_unique)
        const dismissUnique = coerceInt(uniq.dismiss_unique)
        const authStartUnique = coerceInt(uniq.auth_start_unique)
        const authCompleteUnique = coerceInt(uniq.auth_complete_unique)

        return {
          promptId,
          promptName: (row as any).prompt_name ? String((row as any).prompt_name) : null,
          promptKind: (row as any).prompt_kind ? String((row as any).prompt_kind) : null,
          promptCategory: (row as any).prompt_category ? String((row as any).prompt_category) : null,
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

      const byDay: PromptAnalyticsDayRow[] = byDayRaw.map((row) => {
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
        ...(range.promptId != null ? { 'app.prompt_id': String(range.promptId) } : {}),
        ...(range.promptCategory ? { 'app.prompt_category': range.promptCategory } : {}),
        ...(range.viewerState ? { 'prompt.analytics.viewer_state': range.viewerState } : {}),
        'prompt.analytics.result_rows': byPrompt.length,
        'app.outcome': 'success',
      })
      span.setStatus({ code: SpanStatusCode.OK })

      analyticsLogger.info(
        {
          app_operation: 'prompt.analytics.query',
          app_surface: range.surface,
          app_prompt_id: range.promptId,
          app_prompt_category: range.promptCategory,
          viewer_state: range.viewerState,
          range_from_date: range.fromDate,
          range_to_date: range.toDate,
          result_rows: byPrompt.length,
        },
        'prompt.analytics.query'
      )

      return {
        range: {
          fromDate: range.fromDate,
          toDate: range.toDate,
          surface: range.surface,
          promptId: range.promptId,
          promptCategory: range.promptCategory,
          viewerState: range.viewerState,
        },
        kpis,
        byPrompt,
        byDay,
      }
    } catch (err: any) {
      span.recordException(err)
      span.setAttributes({ 'app.outcome': 'client_error' })
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'prompt_analytics_query_failed') })
      throw err
    } finally {
      span.end()
    }
  })
}

export function buildPromptAnalyticsCsv(report: PromptAnalyticsReport): string {
  const header = [
    'prompt_id',
    'prompt_name',
    'prompt_kind',
    'prompt_category',
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
  for (const row of report.byPrompt) {
    rows.push([
      String(row.promptId),
      row.promptName || '',
      row.promptKind || '',
      row.promptCategory || '',
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
