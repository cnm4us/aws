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
import * as messageCtasSvc from '../features/message-cta-definitions/service'
import * as uploadsSvc from '../features/uploads/service'
import * as messageAnalyticsSvc from '../features/message-analytics/service'
import * as messageAttributionSvc from '../features/message-attribution/service'
import * as spacesRepo from '../features/spaces/repo'
import { getLogger } from '../lib/logger'

export const feedMessagesRouter = Router()
const feedMessagesLogger = getLogger({ component: 'routes.feed_messages' })
const MESSAGE_DEBUG_ENABLED = String(process.env.MESSAGE_DEBUG || '0') === '1'
const feedMessageDecisionPaths = ['/api/feed/message-decision']
const feedMessageFetchPaths = ['/api/feed/messages/:id']
const feedMessageEventPaths = ['/api/feed/message-events']
const feedMessageAuthIntentPaths = ['/api/feed/message-auth-intent']
const feedMessageMockCompletionPaths = ['/api/cta/mock/complete']

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
    const body = req.method === 'GET' ? (req.query || {}) : (req.body || {})

    const cookies = parseCookies(req.headers.cookie)
    const cookieSessionId = cookies[ANON_SESSION_COOKIE] ? String(cookies[ANON_SESSION_COOKIE]).trim() : null
    const audienceSegment = await resolveAudienceSegment(req.user?.id)

    const { input, createdSessionId } = buildDecisionInput({
      body,
      cookieSessionId,
      audienceSegment,
      userId: req.user?.id ? Number(req.user.id) : null,
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
    if (String(process.env.MESSAGE_DEBUG || '0') === '1' && req.user?.id) {
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
            message_id: decision.messageId,
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
      const userSuppressedCount = Number((decision.debug as any)?.selection?.userSuppressedCount || 0)
      if (userSuppressedCount > 0) {
        span.setAttribute('app.suppression_scope', 'campaign_or_message')
        span.setAttribute('app.suppression_reason', 'completion')
        span.setAttribute('app.suppressed_candidates', String(userSuppressedCount))
      }
      if (decision.messageId != null) span.setAttribute('app.message_id', String(decision.messageId))
    }

    return res.json({
      should_insert: decision.shouldInsert,
      message_id: decision.messageId,
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

    const message = await messagesSvc.getActiveMessageForFeedById(id)
    const ctaSlotsRaw = Array.isArray((message as any)?.creative?.widgets?.cta?.slots)
      ? ((message as any).creative.widgets.cta.slots as any[])
      : []
    const ctaDefinitionIds = Array.from(
      new Set(
        ctaSlotsRaw
          .map((slot) => Number(slot?.ctaDefinitionId ?? slot?.cta_definition_id))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.round(value))
      )
    )
    const resolvedCtaDefinitions = ctaDefinitionIds.length
      ? await messageCtasSvc.resolveRuntimeDefinitionsById({ ids: ctaDefinitionIds })
      : new Map<number, any>()
    const resolvedCtaSlots = ctaSlotsRaw
      .map((slotRaw) => {
        const slot = Number(slotRaw?.slot || 0)
        const definitionId = Number((slotRaw?.ctaDefinitionId ?? slotRaw?.cta_definition_id) || 0)
        if (!Number.isFinite(slot) || slot < 1 || slot > 3) return null
        if (!Number.isFinite(definitionId) || definitionId <= 0) return null
        const resolved = resolvedCtaDefinitions.get(Math.round(definitionId))
        if (!resolved) return null
        const labelOverride = slotRaw?.labelOverride ?? slotRaw?.label_override
        const styleOverride = slotRaw?.styleOverride ?? slotRaw?.style_override
        return {
          slot: Math.round(slot),
          cta_definition_id: Math.round(definitionId),
          label: labelOverride ? String(labelOverride) : String(resolved.label || ''),
          label_override: labelOverride ? String(labelOverride) : null,
          style_override: styleOverride && typeof styleOverride === 'object' ? styleOverride : null,
          intent_key: String(resolved.intentKey || ''),
          executor_type: String(resolved.executorType || ''),
          executor_config: resolved.executorConfig || {},
        }
      })
      .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot))
      .sort((a, b) => a.slot - b.slot)

    let media: any = null
    const backgroundMode = String(message.creative?.background?.mode || 'none').toLowerCase()
    const creativeMediaUploadId =
      message.creative?.background?.uploadId != null
        ? Number(message.creative.background.uploadId)
        : null
    const mediaUploadId = creativeMediaUploadId != null && Number.isFinite(creativeMediaUploadId) && creativeMediaUploadId > 0
      ? creativeMediaUploadId
      : message.mediaUploadId
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
              uploadsSvc.getUploadPublicMessageBackgroundCdnUrl(Number(upload.id), {
                mode: 'image',
                usage: 'message_bg',
                orientation,
                dpr,
              }),
              uploadsSvc.getUploadPublicMessageBackgroundCdnUrl(Number(upload.id), {
                mode: 'image',
                usage: 'message_bg',
                orientation: 'portrait',
                dpr,
              }),
              uploadsSvc.getUploadPublicMessageBackgroundCdnUrl(Number(upload.id), {
                mode: 'image',
                usage: 'message_bg',
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
              uploadsSvc.getUploadPublicMessageBackgroundCdnUrl(Number(upload.id), {
                mode: 'video',
              }),
              uploadsSvc.getUploadPublicMessagePosterCdnUrl(Number(upload.id)).catch(() => null),
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
      span.setAttribute('app.message_id', String(message.id))
      span.setAttribute('app.message_type', String(message.type || 'register_login'))
      span.setAttribute('app.outcome', 'shown')
    }

    return res.json({
      message: {
        id: message.id,
        type: message.type || 'register_login',
        campaign_key: message.campaignKey,
        headline: message.headline,
        body: message.body,
        cta_primary_label: message.ctaPrimaryLabel,
        cta_primary_href: message.ctaPrimaryHref,
        cta_secondary_label: message.ctaSecondaryLabel,
        cta_secondary_href: message.ctaSecondaryHref,
        cta_slots: resolvedCtaSlots,
        creative: message.creative,
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
    const messageCampaignKey = body.message_campaign_key ? String(body.message_campaign_key) : null
    const ctaKind = body.message_cta_kind ? String(body.message_cta_kind) : (body.cta_kind ? String(body.cta_kind) : null)
    const sessionId = body.message_session_id
      ? String(body.message_session_id).trim()
      : (body.session_id ? String(body.session_id).trim() : null)
    const messageId = body.message_id
    const flow = body.message_flow ? String(body.message_flow).trim().toLowerCase() : (body.flow ? String(body.flow).trim().toLowerCase() : null)
    const messageCtaSlot = body.message_cta_slot != null && body.message_cta_slot !== '' ? Number(body.message_cta_slot) : null
    const messageCtaDefinitionId = body.message_cta_definition_id != null && body.message_cta_definition_id !== '' ? Number(body.message_cta_definition_id) : null
    const messageCtaIntentKey = body.message_cta_intent_key ? String(body.message_cta_intent_key).trim().toLowerCase() : null
    const messageCtaExecutorType = body.message_cta_executor_type ? String(body.message_cta_executor_type).trim().toLowerCase() : null
    const intentId = body.message_intent_id
      ? String(body.message_intent_id).trim().toLowerCase()
      : (body.intent_id ? String(body.intent_id).trim().toLowerCase() : null)
    const messageSequenceKey = body.message_sequence_key ? String(body.message_sequence_key).trim() : null

    const tracked = await messageAnalyticsSvc.recordMessageEvent({
      event: body.event,
      messageId,
      messageCampaignKey,
      ctaKind,
      messageCtaSlot,
      messageCtaDefinitionId,
      messageCtaIntentKey,
      messageCtaExecutorType,
      flow,
      intentId,
      messageSequenceKey,
      surface: body.surface || 'global_feed',
      sessionId,
      viewerState: req.user?.id ? 'authenticated' : 'anonymous',
      userId: req.user?.id ? Number(req.user.id) : null,
    })
    if (String(body.event || '').trim().toLowerCase() === 'auth_start' && intentId) {
      try {
        await messageAttributionSvc.markAuthIntentStarted({ intentId })
      } catch {}
    }
    const normalizedEvent = String(body.event || '').trim().toLowerCase()
    if (
      req.user?.id &&
      (normalizedEvent === 'auth_complete' || normalizedEvent === 'donation_complete' || normalizedEvent === 'subscription_complete' || normalizedEvent === 'upgrade_complete')
    ) {
      try {
        await messageAttributionSvc.upsertUserSuppressionFromCompletion({
          userId: Number(req.user.id),
          scope: messageCampaignKey ? 'campaign' : 'message',
          campaignKey: messageCampaignKey,
          messageId,
          sourceIntentId: intentId,
          reason: normalizedEvent === 'auth_complete' ? 'auth_complete' : 'flow_complete',
        })
      } catch {}
    }
    await recordMessageSessionEvent({
      sessionId,
      surface: String(body.surface || 'global_feed').trim().toLowerCase() as MessageDecisionSurface,
      messageId,
      event: body.event,
    })

    const opByEvent: Record<string, string> = {
      impression: 'feed.message.render',
      click: 'feed.message.click',
      pass_through: 'feed.message.pass_through',
      dismiss: 'feed.message.dismiss',
      auth_start: 'feed.message.auth_start',
      auth_complete: 'feed.message.auth_complete',
      donation_complete: 'feed.message.donation_complete',
      subscription_complete: 'feed.message.subscription_complete',
      upgrade_complete: 'feed.message.upgrade_complete',
    }
    const outcomeByEvent: Record<string, string> = {
      impression: 'shown',
      click: 'clicked',
      pass_through: 'pass_through',
      dismiss: 'dismissed',
      auth_start: 'auth_start',
      auth_complete: 'auth_complete',
      donation_complete: 'donation_complete',
      subscription_complete: 'subscription_complete',
      upgrade_complete: 'upgrade_complete',
    }

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.surface', tracked.surface)
      span.setAttribute('app.operation', 'analytics.ingest')
      span.setAttribute('app.operation_detail', opByEvent[tracked.inputEvent] || 'feed.message.event')
      span.setAttribute('app.message_id', String(tracked.messageId))
      span.setAttribute('app.outcome', outcomeByEvent[tracked.inputEvent] || 'shown')
      if (sessionId) span.setAttribute('app.message_session_id', sessionId)
      if (intentId) span.setAttribute('app.message_intent_id', intentId)
      if (flow) span.setAttribute('app.message_flow', flow)
      if (messageCtaSlot != null && Number.isFinite(messageCtaSlot)) span.setAttribute('app.message_cta_slot', String(Math.round(messageCtaSlot)))
      if (messageCtaDefinitionId != null && Number.isFinite(messageCtaDefinitionId)) span.setAttribute('app.message_cta_definition_id', String(Math.round(messageCtaDefinitionId)))
      if (messageCtaIntentKey) span.setAttribute('app.message_cta_intent_key', messageCtaIntentKey)
      if (messageCtaExecutorType) span.setAttribute('app.message_cta_executor_type', messageCtaExecutorType)
    }

    ;(req.log || feedMessagesLogger).info(
      {
        app_surface: tracked.surface,
        app_operation: 'analytics.ingest',
        app_operation_detail: opByEvent[tracked.inputEvent] || 'feed.message.event',
        app_outcome: outcomeByEvent[tracked.inputEvent] || 'shown',
        message_id: tracked.messageId,
        message_campaign_key: messageCampaignKey,
        cta_kind: ctaKind,
        message_flow: flow,
        message_cta_slot: messageCtaSlot,
        message_cta_definition_id: messageCtaDefinitionId,
        message_cta_intent_key: messageCtaIntentKey,
        message_cta_executor_type: messageCtaExecutorType,
        message_intent_id: intentId,
        message_sequence_key: messageSequenceKey,
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

feedMessagesRouter.get(feedMessageMockCompletionPaths, async (req: any, res: any, next: any) => {
  try {
    const q = req.query || {}
    const rawFlow = String(q.message_flow || q.flow || '').trim().toLowerCase()
    const eventByFlow: Record<string, 'donation_complete' | 'subscription_complete' | 'upgrade_complete'> = {
      donate: 'donation_complete',
      subscribe: 'subscription_complete',
      upgrade: 'upgrade_complete',
    }
    const event = eventByFlow[rawFlow]
    if (!event) return res.status(400).send('invalid_flow')

    const messageId = q.message_id
    const messageCampaignKey = q.message_campaign_key ? String(q.message_campaign_key) : null
    const ctaKind = q.message_cta_kind ? String(q.message_cta_kind) : (q.cta_kind ? String(q.cta_kind) : null)
    const messageCtaSlot = q.message_cta_slot != null && q.message_cta_slot !== '' ? Number(q.message_cta_slot) : null
    const messageCtaDefinitionId = q.message_cta_definition_id != null && q.message_cta_definition_id !== '' ? Number(q.message_cta_definition_id) : null
    const messageCtaIntentKey = q.message_cta_intent_key ? String(q.message_cta_intent_key).trim().toLowerCase() : null
    const messageCtaExecutorType = q.message_cta_executor_type ? String(q.message_cta_executor_type).trim().toLowerCase() : null
    const sessionId = q.message_session_id ? String(q.message_session_id).trim() : (q.session_id ? String(q.session_id).trim() : null)
    const intentId = q.message_intent_id ? String(q.message_intent_id).trim().toLowerCase() : (q.intent_id ? String(q.intent_id).trim().toLowerCase() : null)
    const messageSequenceKey = q.message_sequence_key ? String(q.message_sequence_key).trim() : null

    await messageAnalyticsSvc.recordMessageEvent({
      event,
      messageId,
      messageCampaignKey,
      ctaKind,
      messageCtaSlot,
      messageCtaDefinitionId,
      messageCtaIntentKey,
      messageCtaExecutorType,
      flow: rawFlow,
      intentId,
      messageSequenceKey,
      surface: q.surface || 'global_feed',
      sessionId,
      viewerState: req.user?.id ? 'authenticated' : 'anonymous',
      userId: req.user?.id ? Number(req.user.id) : null,
    })
    if (req.user?.id) {
      try {
        await messageAttributionSvc.upsertUserSuppressionFromCompletion({
          userId: Number(req.user.id),
          scope: messageCampaignKey ? 'campaign' : 'message',
          campaignKey: messageCampaignKey,
          messageId,
          sourceIntentId: intentId,
          reason: 'flow_complete',
        })
      } catch {}
    }
    await recordMessageSessionEvent({
      sessionId,
      surface: String(q.surface || 'global_feed').trim().toLowerCase() as MessageDecisionSurface,
      messageId,
      event,
    })

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.surface', String(q.surface || 'global_feed').trim().toLowerCase())
      span.setAttribute('app.operation', 'feed.message.mock_complete')
      span.setAttribute('app.operation_detail', `feed.message.${event}`)
      span.setAttribute('app.message_id', String(Number(messageId || 0) || 0))
      span.setAttribute('app.outcome', event)
      if (intentId) span.setAttribute('app.message_intent_id', intentId)
      if (rawFlow) span.setAttribute('app.message_flow', rawFlow)
      if (messageCtaSlot != null && Number.isFinite(messageCtaSlot)) span.setAttribute('app.message_cta_slot', String(Math.round(messageCtaSlot)))
      if (messageCtaDefinitionId != null && Number.isFinite(messageCtaDefinitionId)) span.setAttribute('app.message_cta_definition_id', String(Math.round(messageCtaDefinitionId)))
      if (messageCtaIntentKey) span.setAttribute('app.message_cta_intent_key', messageCtaIntentKey)
      if (messageCtaExecutorType) span.setAttribute('app.message_cta_executor_type', messageCtaExecutorType)
    }

    ;(req.log || feedMessagesLogger).info({
      app_operation: 'feed.message.mock_complete',
      app_operation_detail: `feed.message.${event}`,
      app_outcome: event,
      app_surface: String(q.surface || 'global_feed').trim().toLowerCase(),
      message_id: Number(messageId || 0) || null,
      message_campaign_key: messageCampaignKey,
      cta_kind: ctaKind,
      message_flow: rawFlow || null,
      message_cta_slot: messageCtaSlot,
      message_cta_definition_id: messageCtaDefinitionId,
      message_cta_intent_key: messageCtaIntentKey,
      message_cta_executor_type: messageCtaExecutorType,
      message_intent_id: intentId,
      message_sequence_key: messageSequenceKey,
      message_session_id: sessionId,
    }, 'feed.message.mock_complete')

    let returnTo = String(q.return || '/').trim()
    if (returnTo === '/channels/global-feed' || returnTo === '/channels/global') returnTo = '/'
    if (!returnTo.startsWith('/')) return res.redirect('/')
    return res.redirect(returnTo)
  } catch (err) {
    return next(err)
  }
})

feedMessagesRouter.post(feedMessageAuthIntentPaths, async (req: any, res: any, next: any) => {
  try {
    const body = (req.body || {}) as any
    const issued = await messageAttributionSvc.issueAuthIntent({
      flow: body.message_flow ?? body.flow,
      surface: body.surface ?? 'global_feed',
      messageId: body.message_id ?? body.messageId,
      messageCampaignKey: body.message_campaign_key ?? body.messageCampaignKey ?? null,
      messageSessionId: body.message_session_id ?? body.messageSessionId ?? null,
      messageSequenceKey: body.message_sequence_key ?? body.messageSequenceKey ?? null,
      viewerState: req.user?.id ? 'authenticated' : 'anonymous',
      anonKey: body.anon_key ?? null,
      userId: req.user?.id ? Number(req.user.id) : null,
    })

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.surface', String(body.surface || 'global_feed').trim().toLowerCase())
      span.setAttribute('app.operation', 'feed.message.auth_intent')
      span.setAttribute('app.operation_detail', 'feed.message.auth_intent.issue')
      span.setAttribute('app.outcome', 'success')
      span.setAttribute('app.message_intent_id', issued.intentId)
      span.setAttribute('app.message_flow', String(body.message_flow ?? body.flow ?? '').trim().toLowerCase())
    }

    ;(req.log || feedMessagesLogger).info(
      {
        app_operation: 'feed.message.auth_intent',
        app_operation_detail: 'feed.message.auth_intent.issue',
        app_outcome: 'success',
        app_surface: String(body.surface || 'global_feed').trim().toLowerCase(),
        message_id: Number(body.message_id || 0) || null,
        message_campaign_key: body.message_campaign_key ? String(body.message_campaign_key) : null,
        message_session_id: body.message_session_id ? String(body.message_session_id).trim() : null,
        message_intent_id: issued.intentId,
        message_flow: String(body.message_flow ?? body.flow ?? '').trim().toLowerCase() || null,
      },
      'feed.message.auth_intent'
    )

    return res.json({ ok: true, message_intent_id: issued.intentId, expires_at: issued.expiresAt })
  } catch (err) {
    return next(err)
  }
})
