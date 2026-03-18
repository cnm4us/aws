import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import { context, trace } from '@opentelemetry/api'
import { getLogger } from '../../lib/logger'
import * as repo from './repo'
import type {
  MessageAudienceSegment,
  MessageBackgroundMode,
  MessageCreative,
  MessageDto,
  MessageSurface,
  MessageTieBreakStrategy,
  MessageVideoPlaybackMode,
  MessageRow,
  MessageStatus,
  MessageType,
  MessageWidgetPosition,
} from './types'

const messagesLogger = getLogger({ component: 'features.messages' })

const STATUSES: readonly MessageStatus[] = ['draft', 'active', 'paused', 'archived']
const BACKGROUND_MODES: readonly MessageBackgroundMode[] = ['none', 'image', 'video']
const VIDEO_PLAYBACK_MODES: readonly MessageVideoPlaybackMode[] = ['muted_autoplay', 'tap_to_play_sound']
const WIDGET_POSITIONS: readonly MessageWidgetPosition[] = ['top', 'middle', 'bottom']
const SURFACES: readonly MessageSurface[] = ['global_feed']
const AUDIENCE_SEGMENTS: readonly MessageAudienceSegment[] = ['anonymous', 'authenticated_non_subscriber', 'authenticated_subscriber']
const TIE_BREAK_STRATEGIES: readonly MessageTieBreakStrategy[] = ['first', 'round_robin', 'weighted_random']
const MESSAGE_TYPES: readonly MessageType[] = [
  'register_login',
  'fund_drive',
  'subscription_upgrade',
  'sponsor_message',
  'feature_announcement',
]

function annotateAdminMessageWrite(row: MessageRow, detail: 'admin.messages.create' | 'admin.messages.update' | 'admin.messages.clone' | 'admin.messages.status' | 'admin.messages.delete', actorUserId: number, extra?: Record<string, unknown>) {
  const messageId = Number(row.id || 0)
  const messageType = normalizeMessageType((row as any).type, 'register_login')
  const appliesToSurface = normalizeSurface((row as any).applies_to_surface, 'global_feed')
  const audienceSegment = normalizeAudienceSegment((row as any).audience_segment, 'anonymous')
  const status = normalizeStatus((row as any).status, 'draft')
  const campaignKey = row.campaign_key == null || String(row.campaign_key).trim() === '' ? null : String(row.campaign_key)
  const priority = Number(row.priority || 0)
  const name = String(row.name || '')

  const span = trace.getSpan(context.active())
  if (span) {
    span.setAttribute('app.operation', 'admin.messages.write')
    span.setAttribute('app.operation_detail', detail)
    span.setAttribute('app.message_id', String(messageId))
    span.setAttribute('app.message_type', messageType)
    span.setAttribute('app.applies_to_surface', appliesToSurface)
    span.setAttribute('app.audience_segment', audienceSegment)
    span.setAttribute('app.message_status', status)
    span.setAttribute('app.message_priority', String(priority))
    span.setAttribute('app.outcome', 'success')
    if (campaignKey) span.setAttribute('app.message_campaign_key', campaignKey)
  }

  messagesLogger.info(
    {
      event: detail,
      message_id: messageId,
      user_id: actorUserId,
      app_operation: 'admin.messages.write',
      app_operation_detail: detail,
      app_message_type: messageType,
      app_applies_to_surface: appliesToSurface,
      app_audience_segment: audienceSegment,
      app_message_status: status,
      app_message_priority: priority,
      app_message_campaign_key: campaignKey,
      message_name: name,
      ...(extra || {}),
    },
    detail
  )
}

function isEnumValue<T extends string>(value: any, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function normalizeName(raw: any): string {
  const value = String(raw ?? '').trim()
  if (!value) throw new DomainError('invalid_name', 'invalid_name', 400)
  if (value.length > 120) throw new DomainError('invalid_name', 'invalid_name', 400)
  return value
}

function normalizeHeadline(raw: any): string {
  const value = String(raw ?? '').trim()
  if (!value) throw new DomainError('invalid_headline', 'invalid_headline', 400)
  if (value.length > 280) throw new DomainError('invalid_headline', 'invalid_headline', 400)
  return value
}

function normalizeBody(raw: any): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (value.length > 6000) throw new DomainError('invalid_body', 'invalid_body', 400)
  return value
}

function normalizeLabel(raw: any, key: string, required = true): string | null {
  const value = String(raw ?? '').trim()
  if (!value) {
    if (required) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
    return null
  }
  if (value.length > 100) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return value
}

function normalizeInternalHref(raw: any, key: string, required = true): string | null {
  const value = String(raw ?? '').trim()
  if (!value) {
    if (required) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
    return null
  }
  if (value.length > 1200) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  if (!value.startsWith('/')) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  if (value.startsWith('//')) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  if (/^\/[\s]/.test(value) || /\s/.test(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  try {
    const url = new URL(value, 'https://aws.bawebtech.com')
    if (url.origin !== 'https://aws.bawebtech.com') throw new Error('invalid')
  } catch {
    throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  }
  return value
}

function normalizeCampaignKey(raw: any): string | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return null
  if (value.length > 64) throw new DomainError('invalid_campaign_key', 'invalid_campaign_key', 400)
  if (!/^[a-z0-9_-]+$/.test(value)) throw new DomainError('invalid_campaign_key', 'invalid_campaign_key', 400)
  return value
}

function normalizeMessageType(raw: any, fallback: MessageType = 'register_login'): MessageType {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, MESSAGE_TYPES)) throw new DomainError('invalid_message_type', 'invalid_message_type', 400)
  return value
}

function normalizeSurface(raw: any, fallback: MessageSurface = 'global_feed'): MessageSurface {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, SURFACES)) throw new DomainError('invalid_applies_to_surface', 'invalid_applies_to_surface', 400)
  return value
}

function normalizeAudienceSegment(raw: any, fallback: MessageAudienceSegment = 'anonymous'): MessageAudienceSegment {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, AUDIENCE_SEGMENTS)) throw new DomainError('invalid_audience_segment', 'invalid_audience_segment', 400)
  return value
}

function normalizeTieBreakStrategy(raw: any, fallback: MessageTieBreakStrategy = 'round_robin'): MessageTieBreakStrategy {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, TIE_BREAK_STRATEGIES)) throw new DomainError('invalid_tie_break_strategy', 'invalid_tie_break_strategy', 400)
  return value
}

function normalizePriority(raw: any, fallback = 100): number {
  const value = raw == null || raw === '' ? fallback : Number(raw)
  if (!Number.isFinite(value)) throw new DomainError('invalid_priority', 'invalid_priority', 400)
  return Math.round(Math.min(Math.max(value, -100000), 100000))
}

function normalizeStatus(raw: any, fallback: MessageStatus = 'draft'): MessageStatus {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, STATUSES)) throw new DomainError('invalid_status', 'invalid_status', 400)
  return value
}

function normalizeMediaUploadId(raw: any): number | null {
  if (raw == null || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new DomainError('invalid_media_upload_id', 'invalid_media_upload_id', 400)
  return Math.round(value)
}

function toMysqlDateTime(input: Date): string {
  const y = input.getUTCFullYear()
  const m = String(input.getUTCMonth() + 1).padStart(2, '0')
  const d = String(input.getUTCDate()).padStart(2, '0')
  const hh = String(input.getUTCHours()).padStart(2, '0')
  const mm = String(input.getUTCMinutes()).padStart(2, '0')
  const ss = String(input.getUTCSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function normalizeDateTime(raw: any, key: string): string | null {
  if (raw == null || raw === '') return null
  const date = new Date(String(raw))
  if (!Number.isFinite(date.getTime())) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return toMysqlDateTime(date)
}

function normalizeDateWindow(startsAtRaw: any, endsAtRaw: any): { startsAt: string | null; endsAt: string | null } {
  const startsAt = normalizeDateTime(startsAtRaw, 'starts_at')
  const endsAt = normalizeDateTime(endsAtRaw, 'ends_at')
  if (startsAt && endsAt && startsAt > endsAt) {
    throw new DomainError('invalid_date_window', 'invalid_date_window', 400)
  }
  return { startsAt, endsAt }
}

type LegacyMessageFields = {
  headline: string
  body: string | null
  ctaPrimaryLabel: string
  ctaPrimaryHref: string
  ctaSecondaryLabel: string | null
  ctaSecondaryHref: string | null
  mediaUploadId: number | null
}

function normalizeHexColor(raw: any, key: string, fallback: string): string {
  const value = String(raw ?? '').trim()
  if (!value) return fallback
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return value.toUpperCase()
}

function normalizeOpacity(raw: any, key: string, fallback: number): number {
  const value = raw == null || raw === '' ? fallback : Number(raw)
  if (!Number.isFinite(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  const clipped = Math.min(1, Math.max(0, value))
  return Math.round(clipped * 100) / 100
}

function normalizeWidgetPosition(raw: any, key: string, fallback: MessageWidgetPosition): MessageWidgetPosition {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, WIDGET_POSITIONS)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return value
}

function normalizeBackgroundMode(raw: any, key: string, fallback: MessageBackgroundMode): MessageBackgroundMode {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, BACKGROUND_MODES)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return value
}

function normalizeVideoPlaybackMode(raw: any, key: string, fallback: MessageVideoPlaybackMode): MessageVideoPlaybackMode {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return fallback
  if (!isEnumValue(value, VIDEO_PLAYBACK_MODES)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  return value
}

function normalizeOffsetPct(raw: any, key: string, fallback: number): number {
  const value = raw == null || raw === '' ? fallback : Number(raw)
  if (!Number.isFinite(value)) throw new DomainError(`invalid_${key}`, `invalid_${key}`, 400)
  const rounded = Math.round(value)
  // New semantics: offsets are downward-only from the anchor point.
  // Clamp to preserve backward compatibility with existing saved negatives.
  return Math.min(80, Math.max(0, rounded))
}

function normalizeBoolLoose(raw: any, fallback: boolean): boolean {
  if (raw == null || raw === '') return fallback
  if (typeof raw === 'boolean') return raw
  const value = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return fallback
}

function parseCreativeRaw(raw: any): any | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      throw new DomainError('invalid_creative_json', 'invalid_creative_json', 400)
    }
  }
  if (typeof raw === 'object') return raw
  throw new DomainError('invalid_creative_json', 'invalid_creative_json', 400)
}

function buildLegacyCreative(legacy: LegacyMessageFields): MessageCreative {
  return {
    version: 1,
    background: {
      mode: legacy.mediaUploadId ? 'image' : 'none',
      videoPlaybackMode: 'muted_autoplay',
      uploadId: legacy.mediaUploadId,
      overlayColor: '#000000',
      overlayOpacity: 0.35,
    },
    widgets: {
      message: {
        enabled: true,
        position: 'middle',
        yOffsetPct: 0,
        bgColor: '#0B1320',
        bgOpacity: 0.55,
        textColor: '#FFFFFF',
        label: 'Join the Community',
        headline: legacy.headline,
        body: legacy.body,
        primaryLabel: legacy.ctaPrimaryLabel,
        primaryHref: legacy.ctaPrimaryHref,
        secondaryLabel: legacy.ctaSecondaryLabel,
        secondaryHref: legacy.ctaSecondaryHref,
      },
      auth: {
        enabled: false,
        position: 'bottom',
        yOffsetPct: 0,
        bgColor: '#0B1320',
        bgOpacity: 0.55,
        textColor: '#FFFFFF',
      },
    },
  }
}

function normalizeCreative(raw: any, legacy: LegacyMessageFields): MessageCreative {
  const parsed = parseCreativeRaw(raw)
  const base = buildLegacyCreative(legacy)
  if (!parsed) return base

  const src = parsed && typeof parsed === 'object' ? parsed : {}
  const backgroundSrc = src.background && typeof src.background === 'object' ? src.background : {}
  const widgetsSrc = src.widgets && typeof src.widgets === 'object' ? src.widgets : {}
  const messageSrc = widgetsSrc.message && typeof widgetsSrc.message === 'object' ? widgetsSrc.message : {}
  const authSrc = widgetsSrc.auth && typeof widgetsSrc.auth === 'object' ? widgetsSrc.auth : {}

  const msgEnabled = normalizeBoolLoose(messageSrc.enabled, base.widgets.message.enabled)
  const authEnabled = normalizeBoolLoose(authSrc.enabled, base.widgets.auth.enabled)
  if (!msgEnabled && !authEnabled) throw new DomainError('invalid_creative_widgets', 'invalid_creative_widgets', 400)

  const messageSecondaryLabel = normalizeLabel(
    messageSrc.secondaryLabel ?? messageSrc.secondary_label ?? base.widgets.message.secondaryLabel,
    'creative_message_secondary_label',
    false
  )
  const messageSecondaryHref = normalizeInternalHref(
    messageSrc.secondaryHref ?? messageSrc.secondary_href ?? base.widgets.message.secondaryHref,
    'creative_message_secondary_href',
    false
  )
  if ((messageSecondaryLabel && !messageSecondaryHref) || (!messageSecondaryLabel && messageSecondaryHref)) {
    throw new DomainError('invalid_creative_message_secondary_cta', 'invalid_creative_message_secondary_cta', 400)
  }

  return {
    version: 1,
    background: {
      mode: normalizeBackgroundMode(backgroundSrc.mode, 'creative_background_mode', base.background.mode),
      videoPlaybackMode: normalizeVideoPlaybackMode(
        backgroundSrc.videoPlaybackMode ?? backgroundSrc.video_playback_mode,
        'creative_background_video_playback_mode',
        base.background.videoPlaybackMode
      ),
      uploadId: normalizeMediaUploadId(backgroundSrc.uploadId ?? backgroundSrc.upload_id ?? base.background.uploadId),
      overlayColor: normalizeHexColor(backgroundSrc.overlayColor ?? backgroundSrc.overlay_color, 'creative_background_overlay_color', base.background.overlayColor),
      overlayOpacity: normalizeOpacity(backgroundSrc.overlayOpacity ?? backgroundSrc.overlay_opacity, 'creative_background_overlay_opacity', base.background.overlayOpacity),
    },
    widgets: {
      message: {
        enabled: msgEnabled,
        position: normalizeWidgetPosition(messageSrc.position, 'creative_message_position', base.widgets.message.position),
        yOffsetPct: normalizeOffsetPct(messageSrc.yOffsetPct ?? messageSrc.y_offset_pct, 'creative_message_y_offset_pct', base.widgets.message.yOffsetPct),
        bgColor: normalizeHexColor(messageSrc.bgColor ?? messageSrc.bg_color, 'creative_message_bg_color', base.widgets.message.bgColor),
        bgOpacity: normalizeOpacity(messageSrc.bgOpacity ?? messageSrc.bg_opacity, 'creative_message_bg_opacity', base.widgets.message.bgOpacity),
        textColor: normalizeHexColor(messageSrc.textColor ?? messageSrc.text_color, 'creative_message_text_color', base.widgets.message.textColor),
        label: String(normalizeLabel(messageSrc.label ?? base.widgets.message.label, 'creative_message_label', true) || ''),
        headline: normalizeHeadline(messageSrc.headline ?? base.widgets.message.headline),
        body: normalizeBody(messageSrc.body ?? base.widgets.message.body),
        primaryLabel: String(normalizeLabel(messageSrc.primaryLabel ?? messageSrc.primary_label ?? base.widgets.message.primaryLabel, 'creative_message_primary_label', true) || ''),
        primaryHref: String(normalizeInternalHref(messageSrc.primaryHref ?? messageSrc.primary_href ?? base.widgets.message.primaryHref, 'creative_message_primary_href', true) || ''),
        secondaryLabel: messageSecondaryLabel,
        secondaryHref: messageSecondaryHref,
      },
      auth: {
        enabled: authEnabled,
        position: normalizeWidgetPosition(authSrc.position, 'creative_auth_position', base.widgets.auth.position),
        yOffsetPct: normalizeOffsetPct(authSrc.yOffsetPct ?? authSrc.y_offset_pct, 'creative_auth_y_offset_pct', base.widgets.auth.yOffsetPct),
        bgColor: normalizeHexColor(authSrc.bgColor ?? authSrc.bg_color, 'creative_auth_bg_color', base.widgets.auth.bgColor),
        bgOpacity: normalizeOpacity(authSrc.bgOpacity ?? authSrc.bg_opacity, 'creative_auth_bg_opacity', base.widgets.auth.bgOpacity),
        textColor: normalizeHexColor(authSrc.textColor ?? authSrc.text_color, 'creative_auth_text_color', base.widgets.auth.textColor),
      },
    },
  }
}

function resolveCreativeFromRow(row: MessageRow): MessageCreative {
  const legacy: LegacyMessageFields = {
    headline: String(row.headline || ''),
    body: row.body == null ? null : String(row.body),
    ctaPrimaryLabel: String(row.cta_primary_label || ''),
    ctaPrimaryHref: String(row.cta_primary_href || ''),
    ctaSecondaryLabel: row.cta_secondary_label == null ? null : String(row.cta_secondary_label),
    ctaSecondaryHref: row.cta_secondary_href == null ? null : String(row.cta_secondary_href),
    mediaUploadId: row.media_upload_id == null ? null : Number(row.media_upload_id),
  }
  try {
    return normalizeCreative((row as any).creative_json, legacy)
  } catch (err: any) {
    messagesLogger.warn({ event: 'messages.creative.fallback', message_id: Number(row.id || 0), reason: String(err?.message || 'invalid_creative') }, 'messages.creative.fallback')
    return buildLegacyCreative(legacy)
  }
}

function mapRow(row: MessageRow): MessageDto {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    headline: String(row.headline || ''),
    body: row.body == null ? null : String(row.body),
    ctaPrimaryLabel: String(row.cta_primary_label || ''),
    ctaPrimaryHref: String(row.cta_primary_href || ''),
    ctaSecondaryLabel: row.cta_secondary_label == null ? null : String(row.cta_secondary_label),
    ctaSecondaryHref: row.cta_secondary_href == null ? null : String(row.cta_secondary_href),
    mediaUploadId: row.media_upload_id == null ? null : Number(row.media_upload_id),
    creative: resolveCreativeFromRow(row),
    type: normalizeMessageType((row as any).type, 'register_login'),
    appliesToSurface: normalizeSurface((row as any).applies_to_surface, 'global_feed'),
    audienceSegment: normalizeAudienceSegment((row as any).audience_segment, 'anonymous'),
    tieBreakStrategy: normalizeTieBreakStrategy((row as any).tie_break_strategy, 'round_robin'),
    campaignKey: row.campaign_key == null || String(row.campaign_key).trim() === '' ? null : String(row.campaign_key),
    priority: Number(row.priority || 0),
    status: row.status,
    startsAt: row.starts_at == null ? null : String(row.starts_at),
    endsAt: row.ends_at == null ? null : String(row.ends_at),
    createdBy: Number(row.created_by || 0),
    updatedBy: Number(row.updated_by || 0),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

export async function listForAdmin(params: {
  includeArchived?: boolean
  limit?: number
  status?: any
  messageType?: any
  appliesToSurface?: any
  audienceSegment?: any
  campaignKey?: any
}): Promise<MessageDto[]> {
  const status = params.status == null || params.status === '' ? null : normalizeStatus(params.status)
  const messageType = params.messageType == null || params.messageType === '' ? null : normalizeMessageType(params.messageType)
  const appliesToSurface = params.appliesToSurface == null || params.appliesToSurface === '' ? null : normalizeSurface(params.appliesToSurface)
  const audienceSegment = params.audienceSegment == null || params.audienceSegment === '' ? null : normalizeAudienceSegment(params.audienceSegment)
  const campaignKey = params.campaignKey == null || params.campaignKey === '' ? null : normalizeCampaignKey(params.campaignKey)

  const rows = await repo.list({
    includeArchived: Boolean(params.includeArchived),
    limit: params.limit,
    status,
    messageType,
    appliesToSurface,
    audienceSegment,
    campaignKey,
  })
  return rows.map(mapRow)
}

export async function getForAdmin(id: number): Promise<MessageDto> {
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('message_not_found')
  return mapRow(row)
}

export async function createForAdmin(input: any, actorUserId: number): Promise<MessageDto> {
  if (!actorUserId) throw new ForbiddenError()

  const name = normalizeName(input?.name)
  const headline = normalizeHeadline(input?.headline)
  const body = normalizeBody(input?.body)
  const ctaPrimaryLabel = String(normalizeLabel(input?.ctaPrimaryLabel ?? input?.cta_primary_label, 'cta_primary_label', true) || '')
  const ctaPrimaryHref = String(normalizeInternalHref(input?.ctaPrimaryHref ?? input?.cta_primary_href, 'cta_primary_href', true) || '')

  const ctaSecondaryLabel = normalizeLabel(input?.ctaSecondaryLabel ?? input?.cta_secondary_label, 'cta_secondary_label', false)
  const ctaSecondaryHref = normalizeInternalHref(input?.ctaSecondaryHref ?? input?.cta_secondary_href, 'cta_secondary_href', false)
  if ((ctaSecondaryLabel && !ctaSecondaryHref) || (!ctaSecondaryLabel && ctaSecondaryHref)) {
    throw new DomainError('invalid_secondary_cta', 'invalid_secondary_cta', 400)
  }

  const mediaUploadId = normalizeMediaUploadId(input?.mediaUploadId ?? input?.media_upload_id)
  const messageType = normalizeMessageType(input?.type ?? input?.messageType, 'register_login')
  const appliesToSurface = normalizeSurface(input?.appliesToSurface ?? input?.applies_to_surface, 'global_feed')
  const audienceSegment = normalizeAudienceSegment(input?.audienceSegment ?? input?.audience_segment, 'anonymous')
  const tieBreakStrategy = normalizeTieBreakStrategy(input?.tieBreakStrategy ?? input?.tie_break_strategy, 'round_robin')
  const creative = normalizeCreative(input?.creative ?? input?.creative_json, {
    headline,
    body,
    ctaPrimaryLabel,
    ctaPrimaryHref,
    ctaSecondaryLabel,
    ctaSecondaryHref,
    mediaUploadId,
  })
  const campaignKey = normalizeCampaignKey(input?.campaignKey ?? input?.campaign_key)
  const priority = normalizePriority(input?.priority, 100)
  const status = normalizeStatus(input?.status, 'draft')
  const { startsAt, endsAt } = normalizeDateWindow(input?.startsAt ?? input?.starts_at, input?.endsAt ?? input?.ends_at)

  const row = await repo.create({
    name,
    headline,
    body,
    ctaPrimaryLabel,
    ctaPrimaryHref,
    ctaSecondaryLabel,
    ctaSecondaryHref,
    mediaUploadId,
    creativeJson: JSON.stringify(creative),
    messageType,
    appliesToSurface,
    audienceSegment,
    tieBreakStrategy,
    campaignKey,
    priority,
    status,
    startsAt,
    endsAt,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  })

  annotateAdminMessageWrite(row, 'admin.messages.create', actorUserId)
  return mapRow(row)
}

export async function updateForAdmin(id: number, patch: any, actorUserId: number): Promise<MessageDto> {
  if (!actorUserId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('message_not_found')

  const nextName = patch?.name !== undefined ? normalizeName(patch.name) : existing.name
  const nextHeadline = patch?.headline !== undefined ? normalizeHeadline(patch.headline) : existing.headline
  const nextBody = patch?.body !== undefined ? normalizeBody(patch.body) : (existing.body == null ? null : String(existing.body))

  const primaryLabelInput = patch?.ctaPrimaryLabel ?? patch?.cta_primary_label
  const primaryHrefInput = patch?.ctaPrimaryHref ?? patch?.cta_primary_href
  const secondaryLabelInput = patch?.ctaSecondaryLabel ?? patch?.cta_secondary_label
  const secondaryHrefInput = patch?.ctaSecondaryHref ?? patch?.cta_secondary_href

  const nextCtaPrimaryLabel =
    patch?.ctaPrimaryLabel !== undefined || patch?.cta_primary_label !== undefined
      ? String(normalizeLabel(primaryLabelInput, 'cta_primary_label', true) || '')
      : String(existing.cta_primary_label)
  const nextCtaPrimaryHref =
    patch?.ctaPrimaryHref !== undefined || patch?.cta_primary_href !== undefined
      ? String(normalizeInternalHref(primaryHrefInput, 'cta_primary_href', true) || '')
      : String(existing.cta_primary_href)

  const nextCtaSecondaryLabel =
    patch?.ctaSecondaryLabel !== undefined || patch?.cta_secondary_label !== undefined
      ? normalizeLabel(secondaryLabelInput, 'cta_secondary_label', false)
      : (existing.cta_secondary_label == null ? null : String(existing.cta_secondary_label))
  const nextCtaSecondaryHref =
    patch?.ctaSecondaryHref !== undefined || patch?.cta_secondary_href !== undefined
      ? normalizeInternalHref(secondaryHrefInput, 'cta_secondary_href', false)
      : (existing.cta_secondary_href == null ? null : String(existing.cta_secondary_href))

  if ((nextCtaSecondaryLabel && !nextCtaSecondaryHref) || (!nextCtaSecondaryLabel && nextCtaSecondaryHref)) {
    throw new DomainError('invalid_secondary_cta', 'invalid_secondary_cta', 400)
  }

  const nextMediaUploadId =
    patch?.mediaUploadId !== undefined || patch?.media_upload_id !== undefined
      ? normalizeMediaUploadId(patch?.mediaUploadId ?? patch?.media_upload_id)
      : (existing.media_upload_id == null ? null : Number(existing.media_upload_id))
  const nextCreativeJson =
    patch?.creative !== undefined || patch?.creative_json !== undefined
      ? JSON.stringify(normalizeCreative(patch?.creative ?? patch?.creative_json, {
        headline: nextHeadline,
        body: nextBody,
        ctaPrimaryLabel: nextCtaPrimaryLabel,
        ctaPrimaryHref: nextCtaPrimaryHref,
        ctaSecondaryLabel: nextCtaSecondaryLabel,
        ctaSecondaryHref: nextCtaSecondaryHref,
        mediaUploadId: nextMediaUploadId,
      }))
      : ((existing as any).creative_json == null ? null : String((existing as any).creative_json))
  const nextMessageType =
    patch?.type !== undefined || patch?.messageType !== undefined
      ? normalizeMessageType(
          patch?.type ?? patch?.messageType,
          normalizeMessageType((existing as any).type, 'register_login')
        )
      : normalizeMessageType((existing as any).type, 'register_login')
  const nextAppliesToSurface =
    patch?.appliesToSurface !== undefined || patch?.applies_to_surface !== undefined
      ? normalizeSurface(patch?.appliesToSurface ?? patch?.applies_to_surface, normalizeSurface((existing as any).applies_to_surface, 'global_feed'))
      : normalizeSurface((existing as any).applies_to_surface, 'global_feed')
  const nextAudienceSegment =
    patch?.audienceSegment !== undefined || patch?.audience_segment !== undefined
      ? normalizeAudienceSegment(
        patch?.audienceSegment ?? patch?.audience_segment,
        normalizeAudienceSegment((existing as any).audience_segment, 'anonymous')
      )
      : normalizeAudienceSegment((existing as any).audience_segment, 'anonymous')
  const nextTieBreakStrategy =
    patch?.tieBreakStrategy !== undefined || patch?.tie_break_strategy !== undefined
      ? normalizeTieBreakStrategy(
        patch?.tieBreakStrategy ?? patch?.tie_break_strategy,
        normalizeTieBreakStrategy((existing as any).tie_break_strategy, 'round_robin')
      )
      : normalizeTieBreakStrategy((existing as any).tie_break_strategy, 'round_robin')

  const nextCampaignKey =
    patch?.campaignKey !== undefined || patch?.campaign_key !== undefined
      ? normalizeCampaignKey(patch?.campaignKey ?? patch?.campaign_key)
      : (existing.campaign_key == null || String(existing.campaign_key).trim() === '' ? null : String(existing.campaign_key))
  const nextPriority = patch?.priority !== undefined ? normalizePriority(patch.priority, Number(existing.priority)) : Number(existing.priority)
  const nextStatus = patch?.status !== undefined ? normalizeStatus(patch.status, existing.status) : existing.status

  const startsAtRaw = patch?.startsAt ?? patch?.starts_at
  const endsAtRaw = patch?.endsAt ?? patch?.ends_at
  const nextStartsAt =
    patch?.startsAt !== undefined || patch?.starts_at !== undefined
      ? normalizeDateTime(startsAtRaw, 'starts_at')
      : (existing.starts_at == null ? null : String(existing.starts_at))
  const nextEndsAt =
    patch?.endsAt !== undefined || patch?.ends_at !== undefined
      ? normalizeDateTime(endsAtRaw, 'ends_at')
      : (existing.ends_at == null ? null : String(existing.ends_at))
  if (nextStartsAt && nextEndsAt && nextStartsAt > nextEndsAt) {
    throw new DomainError('invalid_date_window', 'invalid_date_window', 400)
  }

  const row = await repo.update(id, {
    name: nextName,
    headline: nextHeadline,
    body: nextBody,
    ctaPrimaryLabel: nextCtaPrimaryLabel,
    ctaPrimaryHref: nextCtaPrimaryHref,
    ctaSecondaryLabel: nextCtaSecondaryLabel,
    ctaSecondaryHref: nextCtaSecondaryHref,
    mediaUploadId: nextMediaUploadId,
    creativeJson: nextCreativeJson,
    messageType: nextMessageType,
    appliesToSurface: nextAppliesToSurface,
    audienceSegment: nextAudienceSegment,
    tieBreakStrategy: nextTieBreakStrategy,
    campaignKey: nextCampaignKey,
    priority: nextPriority,
    status: nextStatus,
    startsAt: nextStartsAt,
    endsAt: nextEndsAt,
    updatedBy: actorUserId,
  })

  annotateAdminMessageWrite(row, 'admin.messages.update', actorUserId)
  return mapRow(row)
}

export async function cloneForAdmin(id: number, actorUserId: number): Promise<MessageDto> {
  if (!actorUserId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('message_not_found')

  const row = await repo.create({
    name: `${String(existing.name || 'Message')} (Copy)`,
    headline: existing.headline,
    body: existing.body == null ? null : String(existing.body),
    ctaPrimaryLabel: String(existing.cta_primary_label || ''),
    ctaPrimaryHref: String(existing.cta_primary_href || ''),
    ctaSecondaryLabel: existing.cta_secondary_label == null ? null : String(existing.cta_secondary_label),
    ctaSecondaryHref: existing.cta_secondary_href == null ? null : String(existing.cta_secondary_href),
    mediaUploadId: existing.media_upload_id == null ? null : Number(existing.media_upload_id),
    creativeJson: (existing as any).creative_json == null ? null : String((existing as any).creative_json),
    messageType: normalizeMessageType((existing as any).type, 'register_login'),
    appliesToSurface: normalizeSurface((existing as any).applies_to_surface, 'global_feed'),
    audienceSegment: normalizeAudienceSegment((existing as any).audience_segment, 'anonymous'),
    tieBreakStrategy: normalizeTieBreakStrategy((existing as any).tie_break_strategy, 'round_robin'),
    campaignKey: existing.campaign_key == null || String(existing.campaign_key).trim() === '' ? null : String(existing.campaign_key),
    priority: Number(existing.priority || 100),
    status: 'draft',
    startsAt: existing.starts_at == null ? null : String(existing.starts_at),
    endsAt: existing.ends_at == null ? null : String(existing.ends_at),
    createdBy: actorUserId,
    updatedBy: actorUserId,
  })

  annotateAdminMessageWrite(row, 'admin.messages.clone', actorUserId, { cloned_from_message_id: id })
  return mapRow(row)
}

export async function updateStatusForAdmin(id: number, statusRaw: any, actorUserId: number): Promise<MessageDto> {
  if (!actorUserId) throw new ForbiddenError()
  const status = normalizeStatus(statusRaw)
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('message_not_found')

  const row = await repo.update(id, {
    status,
    updatedBy: actorUserId,
  })

  annotateAdminMessageWrite(row, 'admin.messages.status', actorUserId)
  return mapRow(row)
}

export async function deleteForAdmin(id: number, actorUserId: number): Promise<void> {
  if (!actorUserId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('message_not_found')
  const removed = await repo.remove(id)
  if (!removed) throw new NotFoundError('message_not_found')
  annotateAdminMessageWrite(existing, 'admin.messages.delete', actorUserId)
}

export async function listActiveForFeed(params?: {
  messageType?: any
  appliesToSurface?: any
  audienceSegment?: any
  campaignKey?: any
  limit?: number
}): Promise<MessageDto[]> {
  const messageType = params?.messageType == null || params?.messageType === '' ? null : normalizeMessageType(params.messageType)
  const appliesToSurface = params?.appliesToSurface == null || params?.appliesToSurface === '' ? null : normalizeSurface(params.appliesToSurface)
  const audienceSegment = params?.audienceSegment == null || params?.audienceSegment === '' ? null : normalizeAudienceSegment(params.audienceSegment)
  const campaignKey = params?.campaignKey == null || params?.campaignKey === '' ? null : normalizeCampaignKey(params.campaignKey)
  const rows = await repo.listActiveForFeed({ messageType, appliesToSurface, audienceSegment, campaignKey, limit: params?.limit })
  return rows.map(mapRow)
}

export async function getActiveForFeedById(id: number): Promise<MessageDto> {
  const messageId = Number(id)
  if (!Number.isFinite(messageId) || messageId <= 0) throw new DomainError('bad_id', 'bad_id', 400)
  const row = await repo.getById(messageId)
  if (!row) throw new NotFoundError('message_not_found')
  if (row.status !== 'active') throw new NotFoundError('message_not_found')
  const now = Date.now()
  const startsAtMs = row.starts_at ? Date.parse(String(row.starts_at).replace(' ', 'T') + 'Z') : null
  const endsAtMs = row.ends_at ? Date.parse(String(row.ends_at).replace(' ', 'T') + 'Z') : null
  if (startsAtMs != null && Number.isFinite(startsAtMs) && startsAtMs > now) throw new NotFoundError('message_not_found')
  if (endsAtMs != null && Number.isFinite(endsAtMs) && endsAtMs < now) throw new NotFoundError('message_not_found')
  return mapRow(row)
}

// Phase F1 compatibility aliases for message terminology.
export const listMessagesForAdmin = listForAdmin
export const getMessageForAdmin = getForAdmin
export const createMessageForAdmin = createForAdmin
export const updateMessageForAdmin = updateForAdmin
export const cloneMessageForAdmin = cloneForAdmin
export const updateMessageStatusForAdmin = updateStatusForAdmin
export const deleteMessageForAdmin = deleteForAdmin
export const listActiveMessagesForFeed = listActiveForFeed
export const getActiveMessageForFeedById = getActiveForFeedById
