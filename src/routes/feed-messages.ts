import { Router } from 'express'
import { context, trace } from '@opentelemetry/api'
import { parseCookies } from '../utils/cookies'
import { can } from '../security/permissions'
import { PERM } from '../security/perm'
import {
  buildDecisionInput,
  ANON_SESSION_COOKIE,
  ANON_SESSION_TTL_MS,
  decideMessage,
  recordMessageSessionEvent,
} from '../features/message-decision/service'
import type { MessageAudienceSegment, MessageDecisionSurface } from '../features/message-decision/types'
import * as messagesSvc from '../features/messages/service'
import * as uploadsSvc from '../features/uploads/service'
import * as messageAnalyticsSvc from '../features/message-analytics/service'
import * as spacesRepo from '../features/spaces/repo'
import { getLogger } from '../lib/logger'

export const feedMessagesRouter = Router()
const feedMessagesLogger = getLogger({ component: 'routes.feed_messages' })
const MESSAGE_DEBUG_ENABLED = String(process.env.MESSAGE_DEBUG || process.env.PROMPT_DEBUG || '0') === '1'
const feedMessageDecisionPaths = ['/api/feed/message-decision']
const feedMessageFetchPaths = ['/api/feed/messages/:id']
const feedMessageEventPaths = ['/api/feed/message-events']

let globalSubscriptionSpaceCache: { spaceId: number | null; expiresAtMs: number } = { spaceId: null, expiresAtMs: 0 }

async function getGlobalSubscriptionSpaceId(): Promise<number | null> {
  const now = Date.now()
  if (globalSubscriptionSpaceCache.expiresAtMs > now) return globalSubscriptionSpaceCache.spaceId
  try {
    const candidate = await spacesRepo.findGlobalSpaceCandidate()
    const spaceId = candidate?.id != null ? Number(candidate.id) : null
    globalSubscriptionSpaceCache = {
      spaceId: Number.isFinite(spaceId as number) && (spaceId as number) > 0 ? (spaceId as number) : null,
      expiresAtMs: now + 60_000,
    }
  } catch {
    globalSubscriptionSpaceCache = { spaceId: null, expiresAtMs: now + 10_000 }
  }
  return globalSubscriptionSpaceCache.spaceId
}

async function resolveAudienceSegment(userIdRaw: any): Promise<MessageAudienceSegment> {
  const userId = Number(userIdRaw || 0)
  if (!Number.isFinite(userId) || userId <= 0) return 'anonymous'
  const globalSpaceId = await getGlobalSubscriptionSpaceId()
  if (!globalSpaceId) return 'authenticated_non_subscriber'
  try {
    const subscribed = await spacesRepo.hasActiveSubscription(globalSpaceId, userId)
    return subscribed ? 'authenticated_subscriber' : 'authenticated_non_subscriber'
  } catch {
    return 'authenticated_non_subscriber'
  }
}

async function handleDecision(req: any, res: any, next: any) {
  try {
    const body = req.method === 'GET'
      ? {
          surface: req.query?.surface,
          session_id: req.query?.session_id,
          slides_viewed: req.query?.slides_viewed,
          watch_seconds: req.query?.watch_seconds,
          prompts_shown_this_session: req.query?.prompts_shown_this_session,
          slides_since_last_prompt: req.query?.slides_since_last_prompt,
          last_prompt_shown_at: req.query?.last_prompt_shown_at,
          last_prompt_id: req.query?.last_prompt_id,
        }
      : (req.body || {})

    const cookies = parseCookies(req.headers.cookie)
    const cookieSessionId = cookies[ANON_SESSION_COOKIE] ? String(cookies[ANON_SESSION_COOKIE]).trim() : null
    const audienceSegment = await resolveAudienceSegment(req.user?.id)

    const { input, createdSessionId } = buildDecisionInput({
      body,
      cookieSessionId,
      audienceSegment,
    })

    if (audienceSegment === 'anonymous' && (createdSessionId || !cookieSessionId || cookieSessionId !== input.sessionId)) {
      const protoHeader = String(req.headers['x-forwarded-proto'] || '')
      const secure = protoHeader.toLowerCase() === 'https' || req.secure
      res.cookie(ANON_SESSION_COOKIE, input.sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: ANON_SESSION_TTL_MS,
        path: '/',
      })
    }

    let includeDebug = false
    if (String(process.env.MESSAGE_DEBUG || process.env.PROMPT_DEBUG || '0') === '1' && req.user?.id) {
      try {
        includeDebug = await can(Number(req.user.id), PERM.VIDEO_DELETE_ANY)
      } catch {
        includeDebug = false
      }
    }

    const decision = await decideMessage(input, { includeDebug })

    if (MESSAGE_DEBUG_ENABLED) {
      ;(req.log || feedMessagesLogger).debug(
        {
          app_surface: input.surface,
          app_operation: 'feed.message.decide',
          audience_segment: audienceSegment,
          session_id: input.sessionId,
          counters: input.counters,
          decision: {
            should_insert: decision.shouldInsert,
            message_id: decision.promptId,
            reason_code: decision.reasonCode,
          },
          decision_debug: decision.debug || null,
        },
        'message.decision.debug'
      )
    }

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.surface', 'global_feed')
      span.setAttribute('app.operation', 'feed.message.decide')
      span.setAttribute('app.audience_segment', audienceSegment)
      span.setAttribute('app.decision_reason', decision.reasonCode)
      span.setAttribute('app.outcome', decision.shouldInsert ? 'shown' : 'blocked')
      if (decision.promptId != null) span.setAttribute('app.message_id', String(decision.promptId))
    }

    return res.json({
      should_insert: decision.shouldInsert,
      prompt_id: decision.promptId,
      insert_after_index: decision.insertAfterIndex,
      reason_code: decision.reasonCode,
      session_id: decision.sessionId,
      debug: decision.debug,
    })
  } catch (err) {
    return next(err)
  }
}

feedMessagesRouter.post(feedMessageDecisionPaths, handleDecision)
feedMessagesRouter.get(feedMessageDecisionPaths, handleDecision)

feedMessagesRouter.get(feedMessageFetchPaths, async (req: any, res: any, next: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const orientationRaw = String(req.query?.orientation || '').toLowerCase()
    const orientation: 'portrait' | 'landscape' = orientationRaw === 'landscape' ? 'landscape' : 'portrait'
    const dprRaw = Number(req.query?.dpr)
    const dpr = Number.isFinite(dprRaw) && dprRaw > 0 ? dprRaw : null

    const prompt = await messagesSvc.getActiveMessageForFeedById(id)

    let media: any = null
    const backgroundMode = String(prompt.creative?.background?.mode || 'none').toLowerCase()
    const creativeMediaUploadId =
      prompt.creative?.background?.uploadId != null
        ? Number(prompt.creative.background.uploadId)
        : null
    const mediaUploadId = creativeMediaUploadId != null && Number.isFinite(creativeMediaUploadId) && creativeMediaUploadId > 0
      ? creativeMediaUploadId
      : prompt.mediaUploadId
    if (mediaUploadId != null) {
      try {
        const upload = await uploadsSvc.get(Number(mediaUploadId), {}, { userId: req.user?.id ? Number(req.user.id) : null })
        let publicBackgroundUrl: string | null = null
        let publicPosterUrl: string | null = null
        let portraitBackgroundUrl: string | null = null
        let landscapeBackgroundUrl: string | null = null
        if (backgroundMode === 'image') {
          try {
            const [signedCurrent, signedPortrait, signedLandscape] = await Promise.all([
              uploadsSvc.getUploadPublicPromptBackgroundCdnUrl(Number(upload.id), {
                mode: 'image',
                usage: 'prompt_bg',
                orientation,
                dpr,
              }),
              uploadsSvc.getUploadPublicPromptBackgroundCdnUrl(Number(upload.id), {
                mode: 'image',
                usage: 'prompt_bg',
                orientation: 'portrait',
                dpr,
              }),
              uploadsSvc.getUploadPublicPromptBackgroundCdnUrl(Number(upload.id), {
                mode: 'image',
                usage: 'prompt_bg',
                orientation: 'landscape',
                dpr,
              }),
            ])
            publicBackgroundUrl = signedCurrent.url
            portraitBackgroundUrl = signedPortrait.url
            landscapeBackgroundUrl = signedLandscape.url
          } catch {
            publicBackgroundUrl = null
            portraitBackgroundUrl = null
            landscapeBackgroundUrl = null
          }
        } else if (backgroundMode === 'video') {
          try {
            const [signedVideo, signedPoster] = await Promise.all([
              uploadsSvc.getUploadPublicPromptBackgroundCdnUrl(Number(upload.id), {
                mode: 'video',
              }),
              uploadsSvc.getUploadPublicPromptPosterCdnUrl(Number(upload.id)).catch(() => null),
            ])
            publicBackgroundUrl = signedVideo.url
            publicPosterUrl = signedPoster?.url || null
          } catch {
            publicBackgroundUrl = null
            publicPosterUrl = null
          }
        }
        media = {
          upload_id: Number(upload.id),
          master: publicBackgroundUrl || upload.cdn_master || upload.s3_master || null,
          poster_portrait:
            publicPosterUrl ||
            portraitBackgroundUrl ||
            upload.poster_portrait_cdn ||
            upload.poster_portrait_s3 ||
            upload.poster_cdn ||
            upload.poster_s3 ||
            null,
          poster_landscape:
            publicPosterUrl ||
            landscapeBackgroundUrl ||
            upload.poster_landscape_cdn ||
            upload.poster_landscape_s3 ||
            null,
        }
      } catch {
        media = null
      }
    }

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.surface', 'global_feed')
      span.setAttribute('app.operation', 'feed.message.fetch')
      span.setAttribute('app.message_id', String(prompt.id))
      span.setAttribute('app.message_type', String((prompt as any).promptType || 'register_login'))
      span.setAttribute('app.outcome', 'shown')
    }

    return res.json({
      prompt: {
        id: prompt.id,
        prompt_type: (prompt as any).promptType || 'register_login',
        campaign_key: prompt.campaignKey,
        headline: prompt.headline,
        body: prompt.body,
        cta_primary_label: prompt.ctaPrimaryLabel,
        cta_primary_href: prompt.ctaPrimaryHref,
        cta_secondary_label: prompt.ctaSecondaryLabel,
        cta_secondary_href: prompt.ctaSecondaryHref,
        creative: prompt.creative,
        media,
      },
    })
  } catch (err) {
    return next(err)
  }
})

feedMessagesRouter.post(feedMessageEventPaths, async (req: any, res: any, next: any) => {
  try {
    const body = (req.body || {}) as any
    const promptCampaignKey = body.prompt_campaign_key ? String(body.prompt_campaign_key) : (body.prompt_category ? String(body.prompt_category) : null)
    const ctaKind = body.cta_kind ? String(body.cta_kind) : null
    const sessionId = body.session_id ? String(body.session_id).trim() : null

    const tracked = await messageAnalyticsSvc.recordMessageEvent({
      event: body.event,
      promptId: body.prompt_id,
      promptCampaignKey,
      ctaKind,
      surface: body.surface || 'global_feed',
      sessionId,
      viewerState: req.user?.id ? 'authenticated' : 'anonymous',
      userId: req.user?.id ? Number(req.user.id) : null,
    })
    await recordMessageSessionEvent({
      sessionId,
      surface: String(body.surface || 'global_feed').trim().toLowerCase() as MessageDecisionSurface,
      promptId: body.prompt_id,
      event: body.event,
    })

    const opByEvent: Record<string, string> = {
      impression: 'feed.message.render',
      click: 'feed.message.click',
      pass_through: 'feed.message.pass_through',
      dismiss: 'feed.message.dismiss',
      auth_start: 'feed.message.auth_start',
      auth_complete: 'feed.message.auth_complete',
    }
    const outcomeByEvent: Record<string, string> = {
      impression: 'shown',
      click: 'clicked',
      pass_through: 'pass_through',
      dismiss: 'dismissed',
      auth_start: 'auth_start',
      auth_complete: 'auth_complete',
    }

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.surface', tracked.surface)
      span.setAttribute('app.operation', 'analytics.ingest')
      span.setAttribute('app.operation_detail', opByEvent[tracked.inputEvent] || 'feed.message.event')
      span.setAttribute('app.message_id', String(tracked.promptId))
      span.setAttribute('app.outcome', outcomeByEvent[tracked.inputEvent] || 'shown')
      if (sessionId) span.setAttribute('app.message_session_id', sessionId)
    }

    ;(req.log || feedMessagesLogger).info(
      {
        app_surface: tracked.surface,
        app_operation: 'analytics.ingest',
        app_operation_detail: opByEvent[tracked.inputEvent] || 'feed.message.event',
        app_outcome: outcomeByEvent[tracked.inputEvent] || 'shown',
        message_id: tracked.promptId,
        message_campaign_key: promptCampaignKey,
        cta_kind: ctaKind,
        message_session_id: sessionId,
        message_event_type: tracked.eventType,
        message_event_deduped: !tracked.inserted,
        message_event_attributed: tracked.attributed,
        viewer_user_id: req.user?.id ? Number(req.user.id) : null,
      },
      'feed.message.event'
    )

    return res.json({
      ok: true,
      deduped: !tracked.inserted,
      counted: tracked.countedInRollup,
      attributed: tracked.attributed,
    })
  } catch (err) {
    return next(err)
  }
})
