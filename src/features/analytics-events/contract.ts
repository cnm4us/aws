import { DomainError } from '../../core/errors'

export type AnalyticsEventName =
  | 'feed_session_start'
  | 'feed_slide_impression'
  | 'feed_slide_complete'
  | 'feed_session_end'
  | 'prompt_impression'
  | 'prompt_click_primary'
  | 'prompt_click_secondary'
  | 'prompt_dismiss'
  | 'auth_start_from_prompt'
  | 'auth_complete_from_prompt'

export type AnalyticsSurface = 'global_feed' | 'group_feed' | 'channel_feed' | 'my_feed'
export type AnalyticsViewerState = 'anonymous' | 'authenticated'
export type AnalyticsMetaPrimitive = string | number | boolean | null
export type AnalyticsMeta = Record<string, AnalyticsMetaPrimitive>

export type CanonicalAnalyticsEvent = {
  eventName: AnalyticsEventName
  occurredAt: Date
  surface: AnalyticsSurface
  viewerState: AnalyticsViewerState
  sessionId: string | null
  userId: number | null
  promptId: number | null
  contentId: number | null
  spaceId: number | null
  spaceType: 'group' | 'channel' | 'personal' | null
  spaceSlug: string | null
  spaceName: string | null
  meta: AnalyticsMeta
}

const META_ALLOWLIST = new Set(['input_event', 'prompt_category', 'cta_kind', 'source_route'])

function asDate(raw: any): Date {
  if (raw instanceof Date && Number.isFinite(raw.getTime())) return raw
  const parsed = new Date(raw)
  if (Number.isFinite(parsed.getTime())) return parsed
  throw new DomainError('invalid_analytics_occurred_at', 'invalid_analytics_occurred_at', 400)
}

function asSurface(raw: any): AnalyticsSurface {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'global_feed') return 'global_feed'
  if (v === 'group_feed') return 'group_feed'
  if (v === 'channel_feed') return 'channel_feed'
  if (v === 'my_feed') return 'my_feed'
  throw new DomainError('invalid_analytics_surface', 'invalid_analytics_surface', 400)
}

function asViewerState(raw: any): AnalyticsViewerState {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'anonymous' || v === 'authenticated') return v
  throw new DomainError('invalid_analytics_viewer_state', 'invalid_analytics_viewer_state', 400)
}

function asSessionId(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw).trim()
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(v)) {
    throw new DomainError('invalid_analytics_session_id', 'invalid_analytics_session_id', 400)
  }
  return v
}

function asUserId(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('invalid_analytics_user_id', 'invalid_analytics_user_id', 400)
  return Math.round(n)
}

function asPositiveId(raw: any, code: string): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError(code, code, 400)
  return Math.round(n)
}

function asSpaceType(raw: any): 'group' | 'channel' | 'personal' | null {
  if (raw == null || raw === '') return null
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'group' || v === 'channel' || v === 'personal') return v
  throw new DomainError('invalid_analytics_space_type', 'invalid_analytics_space_type', 400)
}

function asSpaceSlug(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw || '').trim().toLowerCase()
  if (!v) return null
  if (!/^[a-z0-9-]{1,120}$/.test(v)) throw new DomainError('invalid_analytics_space_slug', 'invalid_analytics_space_slug', 400)
  return v
}

function asSpaceName(raw: any): string | null {
  if (raw == null || raw === '') return null
  const v = String(raw || '').trim()
  if (!v) return null
  if (v.length > 160) throw new DomainError('invalid_analytics_space_name', 'invalid_analytics_space_name', 400)
  return v
}

function asEventName(raw: any): AnalyticsEventName {
  const v = String(raw || '').trim().toLowerCase()
  if (
    v === 'feed_session_start' ||
    v === 'feed_slide_impression' ||
    v === 'feed_slide_complete' ||
    v === 'feed_session_end' ||
    v === 'prompt_impression' ||
    v === 'prompt_click_primary' ||
    v === 'prompt_click_secondary' ||
    v === 'prompt_dismiss' ||
    v === 'auth_start_from_prompt' ||
    v === 'auth_complete_from_prompt'
  ) {
    return v
  }
  throw new DomainError('invalid_analytics_event_name', 'invalid_analytics_event_name', 400)
}

function sanitizeMetaValue(raw: any): AnalyticsMetaPrimitive {
  if (raw == null) return null
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new DomainError('invalid_analytics_meta_value', 'invalid_analytics_meta_value', 400)
    return raw
  }
  const value = String(raw).trim().toLowerCase()
  if (!value) return null
  if (!/^[a-z0-9:_\-.]{1,64}$/.test(value)) {
    throw new DomainError('invalid_analytics_meta_value', 'invalid_analytics_meta_value', 400)
  }
  return value
}

export function sanitizeAnalyticsMeta(raw: any): AnalyticsMeta {
  if (raw == null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DomainError('invalid_analytics_meta', 'invalid_analytics_meta', 400)
  }
  const out: AnalyticsMeta = {}
  for (const [keyRaw, valueRaw] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(keyRaw || '').trim().toLowerCase()
    if (!META_ALLOWLIST.has(key)) throw new DomainError('invalid_analytics_meta_key', 'invalid_analytics_meta_key', 400)
    out[key] = sanitizeMetaValue(valueRaw)
  }
  return out
}

export function buildCanonicalAnalyticsEvent(input: {
  eventName: AnalyticsEventName | string
  occurredAt: Date | string
  surface: AnalyticsSurface | string
  viewerState: AnalyticsViewerState | string
  sessionId?: string | null
  userId?: number | null
  promptId?: number | null
  contentId?: number | null
  spaceId?: number | null
  spaceType?: 'group' | 'channel' | 'personal' | string | null
  spaceSlug?: string | null
  spaceName?: string | null
  meta?: AnalyticsMeta | null
}): CanonicalAnalyticsEvent {
  return {
    eventName: asEventName(input.eventName),
    occurredAt: asDate(input.occurredAt),
    surface: asSurface(input.surface),
    viewerState: asViewerState(input.viewerState),
    sessionId: asSessionId(input.sessionId),
    userId: asUserId(input.userId),
    promptId: asPositiveId(input.promptId, 'invalid_analytics_prompt_id'),
    contentId: asPositiveId(input.contentId, 'invalid_analytics_content_id'),
    spaceId: asPositiveId(input.spaceId, 'invalid_analytics_space_id'),
    spaceType: asSpaceType(input.spaceType),
    spaceSlug: asSpaceSlug(input.spaceSlug),
    spaceName: asSpaceName(input.spaceName),
    meta: sanitizeAnalyticsMeta(input.meta),
  }
}
