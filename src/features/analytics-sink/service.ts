import { metrics, SpanStatusCode, trace } from '@opentelemetry/api'
import { getLogger } from '../../lib/logger'
import type { CanonicalAnalyticsEvent } from '../analytics-events/contract'

type SinkProvider = 'none' | 'posthog'
type SinkOutcome =
  | 'success'
  | 'failure'
  | 'dropped_disabled'
  | 'dropped_sampled'
  | 'dropped_provider'
  | 'dropped_misconfigured'
  | 'dropped_invalid_event'

type SinkConfig = {
  enabled: boolean
  provider: SinkProvider
  sampleRate: number
  timeoutMs: number
  posthogHost: string
  posthogApiKey: string | null
}

type SinkStats = {
  attempted: number
  success: number
  failure: number
  droppedDisabled: number
  droppedSampled: number
  droppedProvider: number
  droppedMisconfigured: number
  droppedInvalidEvent: number
}

const sinkLogger = getLogger({ component: 'features.analytics_sink' })
const tracer = trace.getTracer('aws.analytics.sink')
const meter = metrics.getMeter('aws.analytics.sink')
const sinkDispatchCounter = meter.createCounter('analytics.sink.dispatch_total', {
  description: 'Dispatch attempts and outcomes for external analytics sink events',
})

const sinkStats: SinkStats = {
  attempted: 0,
  success: 0,
  failure: 0,
  droppedDisabled: 0,
  droppedSampled: 0,
  droppedProvider: 0,
  droppedMisconfigured: 0,
  droppedInvalidEvent: 0,
}

function parseBoolean(raw: any, fallback: boolean): boolean {
  const v = String(raw ?? '').trim().toLowerCase()
  if (!v) return fallback
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function parseSampleRate(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function parseProvider(raw: any): SinkProvider {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'posthog') return 'posthog'
  return 'none'
}

function parseTimeoutMs(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 2000
  return Math.max(250, Math.min(10000, Math.round(n)))
}

function normalizePosthogHost(raw: any): string {
  const value = String(raw || '').trim()
  if (!value) return 'https://app.posthog.com'
  return value.replace(/\/+$/, '')
}

function readConfig(): SinkConfig {
  return {
    enabled: parseBoolean(process.env.ANALYTICS_SINK_ENABLED, false),
    provider: parseProvider(process.env.ANALYTICS_SINK_PROVIDER),
    sampleRate: parseSampleRate(process.env.ANALYTICS_SINK_SAMPLE_RATE),
    timeoutMs: parseTimeoutMs(process.env.ANALYTICS_SINK_TIMEOUT_MS),
    posthogHost: normalizePosthogHost(process.env.ANALYTICS_SINK_POSTHOG_HOST),
    posthogApiKey: String(process.env.ANALYTICS_SINK_POSTHOG_API_KEY || '').trim() || null,
  }
}

function toDistinctId(event: CanonicalAnalyticsEvent): string | null {
  if (event.userId != null && Number.isFinite(Number(event.userId)) && Number(event.userId) > 0) {
    return `u:${Math.round(Number(event.userId))}`
  }
  if (event.sessionId) return `s:${event.sessionId}`
  return null
}

function toPosthogPayload(event: CanonicalAnalyticsEvent, source: string | null, apiKey: string) {
  const distinctId = toDistinctId(event)
  if (!distinctId) return null
  return {
    api_key: apiKey,
    event: event.eventName,
    distinct_id: distinctId,
    timestamp: event.occurredAt.toISOString(),
    properties: {
      source: source || 'app',
      surface: event.surface,
      viewer_state: event.viewerState,
      session_id: event.sessionId || null,
      user_id: event.userId || null,
      prompt_id: event.promptId || null,
      content_id: event.contentId || null,
      space_id: event.spaceId || null,
      space_type: event.spaceType || null,
      space_slug: event.spaceSlug || null,
      space_name: event.spaceName || null,
      ...event.meta,
    },
  }
}

function recordOutcome(provider: SinkProvider, outcome: SinkOutcome) {
  sinkDispatchCounter.add(1, {
    sink_provider: provider,
    sink_outcome: outcome,
  })
  if (outcome === 'success') sinkStats.success += 1
  else if (outcome === 'failure') sinkStats.failure += 1
  else if (outcome === 'dropped_disabled') sinkStats.droppedDisabled += 1
  else if (outcome === 'dropped_sampled') sinkStats.droppedSampled += 1
  else if (outcome === 'dropped_provider') sinkStats.droppedProvider += 1
  else if (outcome === 'dropped_misconfigured') sinkStats.droppedMisconfigured += 1
  else if (outcome === 'dropped_invalid_event') sinkStats.droppedInvalidEvent += 1
}

async function dispatchToPosthog(input: {
  event: CanonicalAnalyticsEvent
  source: string | null
  config: SinkConfig
}): Promise<void> {
  const payload = toPosthogPayload(input.event, input.source, input.config.posthogApiKey || '')
  if (!payload) {
    recordOutcome('posthog', 'dropped_invalid_event')
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.config.timeoutMs)
  try {
    const response = await fetch(`${input.config.posthogHost}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`posthog_capture_failed:${response.status}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

export function getAnalyticsSinkHealth() {
  const config = readConfig()
  return {
    config: {
      enabled: config.enabled,
      provider: config.provider,
      sampleRate: config.sampleRate,
      timeoutMs: config.timeoutMs,
      posthogHost: config.posthogHost,
      posthogConfigured: Boolean(config.posthogApiKey),
    },
    stats: { ...sinkStats },
  }
}

export async function dispatchCanonicalAnalyticsEvent(input: {
  event: CanonicalAnalyticsEvent
  source?: string | null
}): Promise<void> {
  const config = readConfig()
  const source = input.source ? String(input.source) : null
  sinkStats.attempted += 1

  return tracer.startActiveSpan(
    'analytics.sink.dispatch',
    { attributes: { 'app.operation': 'analytics.sink.dispatch' } },
    async (span) => {
      try {
        span.setAttributes({
          app_operation: 'analytics.sink.dispatch',
          app_event_name: input.event.eventName,
          app_surface: input.event.surface,
          sink_provider: config.provider,
        })

        if (!config.enabled) {
          recordOutcome(config.provider, 'dropped_disabled')
          span.setAttributes({ app_outcome: 'redirect', sink_outcome: 'dropped_disabled' })
          span.setStatus({ code: SpanStatusCode.OK })
          return
        }

        if (config.sampleRate < 1 && Math.random() > config.sampleRate) {
          recordOutcome(config.provider, 'dropped_sampled')
          span.setAttributes({ app_outcome: 'redirect', sink_outcome: 'dropped_sampled' })
          span.setStatus({ code: SpanStatusCode.OK })
          return
        }

        if (config.provider === 'none') {
          recordOutcome(config.provider, 'dropped_provider')
          span.setAttributes({ app_outcome: 'redirect', sink_outcome: 'dropped_provider' })
          span.setStatus({ code: SpanStatusCode.OK })
          return
        }

        if (config.provider === 'posthog' && !config.posthogApiKey) {
          recordOutcome(config.provider, 'dropped_misconfigured')
          span.setAttributes({ app_outcome: 'client_error', sink_outcome: 'dropped_misconfigured' })
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'missing_posthog_api_key' })
          return
        }

        if (config.provider === 'posthog') {
          await dispatchToPosthog({ event: input.event, source, config })
          recordOutcome(config.provider, 'success')
          span.setAttributes({ app_outcome: 'success', sink_outcome: 'success' })
          span.setStatus({ code: SpanStatusCode.OK })
          return
        }

        recordOutcome(config.provider, 'dropped_provider')
        span.setAttributes({ app_outcome: 'redirect', sink_outcome: 'dropped_provider' })
        span.setStatus({ code: SpanStatusCode.OK })
      } catch (err: any) {
        recordOutcome(config.provider, 'failure')
        span.recordException(err)
        span.setAttributes({
          app_outcome: 'server_error',
          sink_outcome: 'failure',
        })
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'analytics_sink_dispatch_failed') })
        sinkLogger.warn(
          {
            app_operation: 'analytics.sink.dispatch',
            app_event_name: input.event.eventName,
            app_surface: input.event.surface,
            sink_provider: config.provider,
            sink_error: String(err?.message || err || 'analytics_sink_dispatch_failed'),
          },
          'analytics.sink.dispatch.failed'
        )
      } finally {
        span.end()
      }
    }
  )
}
