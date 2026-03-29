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
import type { MessageDecisionSurface, MessageViewerState } from '../features/message-decision/types'
import * as messagesSvc from '../features/messages/service'
import * as messageCtasSvc from '../features/message-cta-definitions/service'
import * as messageCtaOutcomesSvc from '../features/message-cta-outcomes/service'
import * as uploadsSvc from '../features/uploads/service'
import * as messageAnalyticsSvc from '../features/message-analytics/service'
import * as messageAttributionSvc from '../features/message-attribution/service'
import * as messageJourneysSvc from '../features/message-journeys/service'
import * as paymentsSvc from '../features/payments/service'
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
const checkoutPagePaths = ['/checkout/:intent']
const paypalWebhookPaths = ['/api/payments/paypal/webhook', '/api/payments/paypal/webhook/:mode']
const paypalReturnPaths = ['/api/payments/paypal/return']
const subscriptionActionPaths = ['/api/payments/subscriptions/:id/:action']

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

async function resolveViewerState(userIdRaw: any): Promise<MessageViewerState> {
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

type CheckoutIntent = 'donate' | 'subscribe' | 'upgrade'
type PaymentIntent = 'donate' | 'subscribe'

function normalizeCheckoutIntent(raw: any): CheckoutIntent {
  const value = String(raw || '').trim().toLowerCase()
  if (value === 'donate' || value === 'subscribe' || value === 'upgrade') return value
  throw new Error('invalid_checkout_intent')
}

function toPaymentIntent(intent: CheckoutIntent): PaymentIntent {
  return intent === 'donate' ? 'donate' : 'subscribe'
}

function normalizeReturnPath(raw: any, fallback = '/'): string {
  const value = String(raw || '').trim()
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (value.length > 1200) return fallback
  return value
}

function mapSubscriptionActionErrorToUserMessage(err: any): string {
  const haystack = [
    err?.code,
    err?.message,
    err?.cause?.code,
    err?.cause?.message,
    err?.error,
  ]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' | ')
  if (!haystack) return 'Unable to process subscription action right now.'
  if (haystack.includes('subscription_action_invalid_for_status')) return 'This action is not available for the current subscription status.'
  if (haystack.includes('subscription_action_already_pending')) return 'A subscription action is already pending provider confirmation.'
  if (haystack.includes('subscription_target_plan_not_found') || haystack.includes('subscription_target_plan_provider_ref_missing')) {
    return 'Unable to change plan right now. Please choose a different plan or try again.'
  }
  if (haystack.includes('payment_provider_disabled')) return 'Payment provider is currently unavailable.'
  if (haystack.includes('subscription_not_found')) return 'Subscription not found.'
  return 'Unable to process subscription action right now.'
}

function parsePositiveInt(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n)
}

function parseNonNegativeInt(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

function htmlEscape(value: any): string {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function listEnabledCheckoutModes(intent: CheckoutIntent): Promise<Array<{ provider: 'paypal'; mode: 'sandbox' | 'live'; label: string }>> {
  const cfg = await paymentsSvc.listProviderConfigsForAdmin('paypal')
  const modes: Array<{ provider: 'paypal'; mode: 'sandbox' | 'live'; label: string }> = []
  for (const row of cfg.rows || []) {
    if (String(row.status) !== 'enabled') continue
    if (intent === 'donate' && !Number(row.donate_enabled || 0)) continue
    if ((intent === 'subscribe' || intent === 'upgrade') && !Number(row.subscribe_enabled || 0)) continue
    const mode = String(row.mode || '').toLowerCase() === 'live' ? 'live' : 'sandbox'
    modes.push({
      provider: 'paypal',
      mode,
      label: mode === 'live' ? 'PayPal (Live)' : 'PayPal (Sandbox)',
    })
  }
  return modes
}

async function handleDecision(req: any, res: any, next: any) {
  try {
    const body = req.method === 'GET' ? (req.query || {}) : (req.body || {})

    const cookies = parseCookies(req.headers.cookie)
    const cookieSessionId = cookies[ANON_SESSION_COOKIE] ? String(cookies[ANON_SESSION_COOKIE]).trim() : null
    const viewerState = await resolveViewerState(req.user?.id)

    const { input, createdSessionId } = buildDecisionInput({
      body,
      cookieSessionId,
      viewerState,
      userId: req.user?.id ? Number(req.user.id) : null,
    })

    if (viewerState === 'anonymous' && (createdSessionId || !cookieSessionId || cookieSessionId !== input.sessionId)) {
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

    let includeDebugResponse = false
    if (String(process.env.MESSAGE_DEBUG || '0') === '1' && req.user?.id) {
      try {
        includeDebugResponse = await can(Number(req.user.id), PERM.VIDEO_DELETE_ANY)
      } catch {
        includeDebugResponse = false
      }
    }

    // Always compute internal decision debug so telemetry tags remain accurate.
    // Response exposure remains gated by MESSAGE_DEBUG + site-admin checks.
    const decision = await decideMessage(input, { includeDebug: true })

    if (MESSAGE_DEBUG_ENABLED) {
      ;(req.log || feedMessagesLogger).debug(
        {
          app_surface: input.surface,
          app_operation: 'feed.message.decide',
          viewer_state: viewerState,
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

    const selectionDebug = ((decision.debug as any)?.selection || {}) as any
    const targetRejectedCount = Number(selectionDebug.targetRejectedCount || 0)
    const targetMatchValue =
      typeof selectionDebug.targetMatch === 'boolean'
        ? selectionDebug.targetMatch
        : (targetRejectedCount > 0 ? false : null)
    const targetMissReason =
      Array.isArray(selectionDebug.candidateDropReasons)
        ? ((selectionDebug.candidateDropReasons.find((r: any) => String(r?.reason || '') === 'target_miss')?.reason) || null)
        : null
    ;(req.log || feedMessagesLogger).info(
      {
        app_surface: input.surface,
        app_surface_context: selectionDebug.surfaceContext || input.surface,
        app_operation: 'feed.message.decide',
        app_outcome: decision.shouldInsert ? 'shown' : 'blocked',
        viewer_state: viewerState,
        session_id: input.sessionId,
        message_id: decision.messageId,
        reason_code: decision.reasonCode,
        candidate_count: Number(selectionDebug.candidateCount || 0),
        candidate_count_before_ruleset: Number(selectionDebug.candidateCountBeforeRuleset || 0),
        candidate_count_before_journey: Number(selectionDebug.candidateCountBeforeJourney || 0),
        ruleset_rejected_count: Number(selectionDebug.rulesetRejectedCount || 0),
        journey_rejected_count: Number(selectionDebug.journeyRejectedCount || 0),
        message_ruleset_result: selectionDebug.rulesetResult || 'none',
        message_ruleset_reason: selectionDebug.rulesetReason || null,
        message_ruleset_id:
          selectionDebug.selectedRulesetId != null
            ? Number(selectionDebug.selectedRulesetId)
            : (selectionDebug.rejectedRulesetId != null ? Number(selectionDebug.rejectedRulesetId) : null),
        message_journey_id:
          selectionDebug.selectedJourneyId != null && Number.isFinite(Number(selectionDebug.selectedJourneyId))
            ? Number(selectionDebug.selectedJourneyId)
            : null,
        message_journey_step_id:
          selectionDebug.selectedJourneyStepId != null && Number.isFinite(Number(selectionDebug.selectedJourneyStepId))
            ? Number(selectionDebug.selectedJourneyStepId)
            : null,
        message_journey_step_order:
          selectionDebug.selectedJourneyStepOrder != null && Number.isFinite(Number(selectionDebug.selectedJourneyStepOrder))
            ? Number(selectionDebug.selectedJourneyStepOrder)
            : null,
        message_journey_step_key: selectionDebug.selectedJourneyStepKey || null,
        message_journey_ruleset_id:
          selectionDebug.selectedJourneyRulesetId != null && Number.isFinite(Number(selectionDebug.selectedJourneyRulesetId))
            ? Number(selectionDebug.selectedJourneyRulesetId)
            : null,
        message_delivery_context:
          selectionDebug.selectedDeliveryContext === 'journey'
            ? 'journey'
            : (selectionDebug.selectedDeliveryContext === 'standalone' ? 'standalone' : null),
        app_targeting_mode: selectionDebug.targetingMode || null,
        app_target_type: selectionDebug.targetType || null,
        app_target_id:
          selectionDebug.targetId != null && Number.isFinite(Number(selectionDebug.targetId))
            ? Number(selectionDebug.targetId)
            : null,
        app_target_match: targetMatchValue,
        app_target_rejected_count: targetRejectedCount,
        app_target_reject_reason: targetMissReason,
        journey_drop_reason:
          Array.isArray(selectionDebug.candidateDropReasons)
            ? ((selectionDebug.candidateDropReasons.find((r: any) => String(r?.reason || '').startsWith('journey_'))?.reason) || null)
            : null,
      },
      'feed.message.decide'
    )

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.surface', input.surface)
      span.setAttribute('app.surface_context', String((decision.debug as any)?.selection?.surfaceContext || input.surface))
      span.setAttribute('app.operation', 'feed.message.decide')
      span.setAttribute('app.viewer_state', viewerState)
      span.setAttribute('app.targeting_model', 'ruleset_only')
      span.setAttribute('app.decision_reason', decision.reasonCode)
      span.setAttribute('app.outcome', decision.shouldInsert ? 'shown' : 'blocked')
      const userSuppressedCount = Number((decision.debug as any)?.selection?.userSuppressedCount || 0)
      if (userSuppressedCount > 0) {
        span.setAttribute('app.suppression_scope', 'campaign_or_message')
        span.setAttribute('app.suppression_reason', 'completion')
        span.setAttribute('app.suppressed_candidates', String(userSuppressedCount))
      }
      if (decision.messageId != null) span.setAttribute('app.message_id', String(decision.messageId))
      const journeyIdRaw = (decision.debug as any)?.selection?.selectedJourneyId
      const journeyStepIdRaw = (decision.debug as any)?.selection?.selectedJourneyStepId
      const journeyStepOrderRaw = (decision.debug as any)?.selection?.selectedJourneyStepOrder
      const journeyStepKeyRaw = (decision.debug as any)?.selection?.selectedJourneyStepKey
      const journeyRulesetIdRaw = (decision.debug as any)?.selection?.selectedJourneyRulesetId
      const deliveryContextRaw = String((decision.debug as any)?.selection?.selectedDeliveryContext || '').trim().toLowerCase()
      const journeyRejectedCount = Number((decision.debug as any)?.selection?.journeyRejectedCount || 0)
      const candidateCountBeforeJourney = Number((decision.debug as any)?.selection?.candidateCountBeforeJourney || 0)
      span.setAttribute('app.journey_rejected_count', String(journeyRejectedCount))
      span.setAttribute('app.journey_candidate_count_before', String(candidateCountBeforeJourney))
      if (journeyIdRaw != null && Number.isFinite(Number(journeyIdRaw)) && Number(journeyIdRaw) > 0) {
        span.setAttribute('app.journey_id', String(Math.round(Number(journeyIdRaw))))
      }
      if (journeyStepIdRaw != null && Number.isFinite(Number(journeyStepIdRaw)) && Number(journeyStepIdRaw) > 0) {
        span.setAttribute('app.journey_step_id', String(Math.round(Number(journeyStepIdRaw))))
      }
      if (journeyStepOrderRaw != null && Number.isFinite(Number(journeyStepOrderRaw)) && Number(journeyStepOrderRaw) > 0) {
        span.setAttribute('app.journey_step_order', String(Math.round(Number(journeyStepOrderRaw))))
      }
      if (journeyStepKeyRaw != null && String(journeyStepKeyRaw).trim() !== '') {
        span.setAttribute('app.journey_step_key', String(journeyStepKeyRaw).trim())
      }
      if (journeyRulesetIdRaw != null && Number.isFinite(Number(journeyRulesetIdRaw)) && Number(journeyRulesetIdRaw) > 0) {
        span.setAttribute('app.journey_ruleset_id', String(Math.round(Number(journeyRulesetIdRaw))))
      }
      if (deliveryContextRaw === 'journey' || deliveryContextRaw === 'standalone') {
        span.setAttribute('app.delivery_context', deliveryContextRaw)
      }
      const journeyDropReason =
        Array.isArray((decision.debug as any)?.selection?.candidateDropReasons)
          ? (((decision.debug as any).selection.candidateDropReasons.find((r: any) => String(r?.reason || '').startsWith('journey_'))?.reason) || '')
          : ''
      if (journeyDropReason) span.setAttribute('app.journey_drop_reason', journeyDropReason)
      const rulesetResult = String((decision.debug as any)?.selection?.rulesetResult || 'none')
      const rulesetReason = String((decision.debug as any)?.selection?.rulesetReason || '')
      const rulesetIdRaw = (decision.debug as any)?.selection?.selectedRulesetId ?? (decision.debug as any)?.selection?.rejectedRulesetId
      span.setAttribute('app.message_ruleset_result', rulesetResult)
      if (rulesetReason) span.setAttribute('app.message_ruleset_reason', rulesetReason)
      if (rulesetIdRaw != null && Number.isFinite(Number(rulesetIdRaw)) && Number(rulesetIdRaw) > 0) {
        span.setAttribute('app.message_ruleset_id', String(Math.round(Number(rulesetIdRaw))))
      }
      const targetModeRaw = (decision.debug as any)?.selection?.targetingMode
      const targetTypeRaw = (decision.debug as any)?.selection?.targetType
      const targetIdRaw = (decision.debug as any)?.selection?.targetId
      const targetMatchRaw = (decision.debug as any)?.selection?.targetMatch
      const targetRejectedCountRaw = Number((decision.debug as any)?.selection?.targetRejectedCount || 0)
      const targetMissReasonRaw =
        Array.isArray((decision.debug as any)?.selection?.candidateDropReasons)
          ? (((decision.debug as any).selection.candidateDropReasons.find((r: any) => String(r?.reason || '') === 'target_miss')?.reason) || '')
          : ''
      if (targetModeRaw) span.setAttribute('app.targeting_mode', String(targetModeRaw))
      if (targetTypeRaw) span.setAttribute('app.target_type', String(targetTypeRaw))
      if (targetIdRaw != null && Number.isFinite(Number(targetIdRaw)) && Number(targetIdRaw) > 0) {
        span.setAttribute('app.target_id', String(Math.round(Number(targetIdRaw))))
      }
      if (typeof targetMatchRaw === 'boolean') {
        span.setAttribute('app.target_match', targetMatchRaw ? 'true' : 'false')
      } else if (targetRejectedCountRaw > 0) {
        span.setAttribute('app.target_match', 'false')
      }
      if (targetRejectedCountRaw > 0) span.setAttribute('app.target_rejected_count', String(targetRejectedCountRaw))
      if (targetMissReasonRaw) span.setAttribute('app.target_reject_reason', String(targetMissReasonRaw))
    }

    return res.json({
      should_insert: decision.shouldInsert,
      message_id: decision.messageId,
      insert_after_index: decision.insertAfterIndex,
      reason_code: decision.reasonCode,
      session_id: decision.sessionId,
      ...(includeDebugResponse ? { debug: decision.debug } : {}),
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
    const messageJourneyId = body.message_journey_id != null && body.message_journey_id !== '' ? Number(body.message_journey_id) : null
    const messageJourneyStepId = body.message_journey_step_id != null && body.message_journey_step_id !== '' ? Number(body.message_journey_step_id) : null
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
    let journeySignalResult: { stepsMatched: number; progressed: number; ignored: number } | null = null
    let ctaOutcomeCompleted = false
    try {
      const mapOutcome = (): { type: 'click' | 'verified_complete'; status: 'success' } | null => {
        if (normalizedEvent === 'click') return { type: 'click', status: 'success' }
        if (
          normalizedEvent === 'auth_complete' ||
          normalizedEvent === 'donation_complete' ||
          normalizedEvent === 'subscription_complete' ||
          normalizedEvent === 'upgrade_complete'
        ) return { type: 'verified_complete', status: 'success' }
        return null
      }
      const mapped = mapOutcome()
      if (mapped) {
        const ctaOutcome = await messageCtaOutcomesSvc.recordCtaOutcome({
          outcomeId: intentId ? `intent:${intentId}:${normalizedEvent}` : null,
          sourceEventType: 'feed.message.event',
          outcomeType: mapped.type,
          outcomeStatus: mapped.status,
          sessionId,
          userId: req.user?.id ? Number(req.user.id) : null,
          anonVisitorId: req.user?.id ? null : sessionId,
          messageId,
          messageCampaignKey,
          deliveryContext: messageJourneyId && messageJourneyStepId ? 'journey' : 'standalone',
          journeyId: Number.isFinite(Number(messageJourneyId)) && Number(messageJourneyId) > 0 ? Number(messageJourneyId) : null,
          journeyStepId: Number.isFinite(Number(messageJourneyStepId)) && Number(messageJourneyStepId) > 0 ? Number(messageJourneyStepId) : null,
          ctaSlot: messageCtaSlot,
          ctaDefinitionId: messageCtaDefinitionId,
          ctaIntentKey: messageCtaIntentKey,
          ctaExecutorType: messageCtaExecutorType,
          payload: {
            input_event: normalizedEvent,
            flow,
            message_sequence_key: messageSequenceKey || null,
          },
        })
        ctaOutcomeCompleted = Boolean(ctaOutcome.completed)
        if (ctaOutcome.journeySignal) journeySignalResult = ctaOutcome.journeySignal
      }
    } catch {}
    if (
      req.user?.id &&
      (
        normalizedEvent === 'auth_complete' ||
        normalizedEvent === 'donation_complete' ||
        normalizedEvent === 'subscription_complete' ||
        normalizedEvent === 'upgrade_complete' ||
        ctaOutcomeCompleted
      )
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
    if (
      normalizedEvent === 'impression' ||
      normalizedEvent === 'pass_through' ||
      normalizedEvent === 'dismiss'
    ) {
      try {
        journeySignalResult = await messageJourneysSvc.recordJourneySignalFromMessageEvent({
          userId: req.user?.id ? Number(req.user.id) : null,
          anonVisitorId: req.user?.id ? null : sessionId,
          messageId: Number(messageId || 0),
          event: normalizedEvent,
          sessionId,
        })
      } catch {}
    }

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
      span.setAttribute('app.event_type', tracked.eventType)
      span.setAttribute('app.message_id', String(tracked.messageId))
      span.setAttribute('app.outcome', outcomeByEvent[tracked.inputEvent] || 'shown')
      if (ctaKind) span.setAttribute('app.cta_kind', ctaKind)
      if (sessionId) span.setAttribute('app.message_session_id', sessionId)
      if (intentId) span.setAttribute('app.message_intent_id', intentId)
      if (flow) span.setAttribute('app.message_flow', flow)
      if (messageCtaSlot != null && Number.isFinite(messageCtaSlot)) span.setAttribute('app.message_cta_slot', String(Math.round(messageCtaSlot)))
      if (messageCtaDefinitionId != null && Number.isFinite(messageCtaDefinitionId)) span.setAttribute('app.message_cta_definition_id', String(Math.round(messageCtaDefinitionId)))
      if (messageCtaIntentKey) span.setAttribute('app.message_cta_intent_key', messageCtaIntentKey)
      if (messageCtaExecutorType) span.setAttribute('app.message_cta_executor_type', messageCtaExecutorType)
      if (journeySignalResult) {
        span.setAttribute('app.journey_steps_matched', String(Math.round(Number(journeySignalResult.stepsMatched || 0))))
        span.setAttribute('app.journey_progressed', String(Math.round(Number(journeySignalResult.progressed || 0))))
        span.setAttribute('app.journey_ignored', String(Math.round(Number(journeySignalResult.ignored || 0))))
      }
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
        journey_steps_matched: journeySignalResult ? Number(journeySignalResult.stepsMatched || 0) : 0,
        journey_progressed: journeySignalResult ? Number(journeySignalResult.progressed || 0) : 0,
        journey_ignored: journeySignalResult ? Number(journeySignalResult.ignored || 0) : 0,
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

feedMessagesRouter.get(checkoutPagePaths, async (req: any, res: any, next: any) => {
  try {
    const intent = normalizeCheckoutIntent(req.params.intent)
    const returnPath = normalizeReturnPath(req.query?.return, '/')
    const cancelPath = normalizeReturnPath(req.query?.cancel, returnPath)
    const messageId = parsePositiveInt(req.query?.message_id)
    const messageCampaignKey = req.query?.message_campaign_key ? String(req.query.message_campaign_key).trim().toLowerCase() : null
    const messageSessionId = req.query?.message_session_id ? String(req.query.message_session_id).trim() : null
    const messageIntentId = req.query?.message_intent_id ? String(req.query.message_intent_id).trim().toLowerCase() : null
    const messageCtaSlot = parsePositiveInt(req.query?.message_cta_slot)
    const messageCtaDefinitionId = parsePositiveInt(req.query?.message_cta_definition_id)
    const messageCtaKind = req.query?.message_cta_kind ? String(req.query.message_cta_kind).trim().toLowerCase() : null
    const messageCtaIntentKey = req.query?.message_cta_intent_key ? String(req.query.message_cta_intent_key).trim().toLowerCase() : null
    const messageCtaExecutorType = req.query?.message_cta_executor_type ? String(req.query.message_cta_executor_type).trim().toLowerCase() : null
    const messageSequenceKey = req.query?.message_sequence_key ? String(req.query.message_sequence_key).trim() : null
    const supportSource = req.query?.support_source ? String(req.query.support_source).trim() : null
    const catalogItemId = parsePositiveInt(req.query?.catalog_item_id)
    const amountCents = parseNonNegativeInt(req.query?.amount_cents)
    const preselectedProviderMode = req.query?.provider_mode ? String(req.query.provider_mode).trim().toLowerCase() : null
    const modes = await listEnabledCheckoutModes(intent)
    const error = req.query?.error ? String(req.query.error) : ''
    let selectedItemLabel: string | null = null
    let selectedItemAmountCents: number | null = amountCents
    let selectedItemCurrency = 'USD'
    if (catalogItemId != null) {
      try {
        const items = await paymentsSvc.listCatalogItemsForAdmin({ status: 'active', includeArchived: false, limit: 500 })
        const selected = items.find((item) => Number(item.id) === Number(catalogItemId)) || null
        if (selected) {
          selectedItemLabel = String(selected.label || selected.item_key || '').trim() || null
          if (selectedItemAmountCents == null && selected.amount_cents != null) {
            const n = Number(selected.amount_cents)
            if (Number.isFinite(n) && n >= 0) selectedItemAmountCents = Math.round(n)
          }
          selectedItemCurrency = String(selected.currency || 'USD').toUpperCase()
        }
      } catch {}
    }

    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    let html = '<!doctype html><html lang="en"><head><meta charset="utf-8" />'
    html += '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />'
    html += `<title>${htmlEscape(intent)} checkout</title>`
    html += '<style>html,body{margin:0;padding:0;background:#05070a;color:#eef2ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}main{max-width:640px;margin:0 auto;padding:24px 16px 36px}h1{margin:0 0 10px}p{opacity:.9}label{display:block;margin:8px 0}.card{border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:14px;background:rgba(255,255,255,.03)}.summary{margin:12px 0;border:1px solid rgba(125,180,255,.35);background:rgba(70,120,220,.14)}.error{margin:12px 0;padding:10px;border-radius:8px;background:rgba(255,81,81,.12);border:1px solid rgba(255,81,81,.35)}button,a.btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:9px;border:1px solid rgba(255,255,255,.18);background:#0b2f84;color:#fff;text-decoration:none;font-weight:600}a.btn{background:transparent}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.hint{font-size:.92rem;opacity:.82}</style>'
    html += '</head><body><main>'
    html += `<h1>${htmlEscape(intent === 'upgrade' ? 'Upgrade checkout' : `${intent[0].toUpperCase()}${intent.slice(1)} checkout`)}</h1>`
    html += '<p>Choose a payment provider to continue.</p>'
    if (selectedItemLabel || selectedItemAmountCents != null) {
      const isRecurring = intent === 'subscribe'
      const amt = selectedItemAmountCents == null
        ? 'Flexible amount'
        : `$${(selectedItemAmountCents / 100).toFixed(2)} ${htmlEscape(selectedItemCurrency)}${isRecurring ? ' / month' : ''}`
      const selectionText = selectedItemLabel || (intent === 'subscribe' ? 'Subscription' : 'Donation')
      html += '<div class="card summary">'
      html += `<div><strong>Selection:</strong> ${htmlEscape(isRecurring ? `${selectionText} - Monthly Subscription` : selectionText)}</div>`
      html += `<div class="hint"><strong>Amount:</strong> ${amt}</div>`
      html += '</div>'
    }
    if (error) html += `<div class="error">${htmlEscape(error)}</div>`
    if (!modes.length) {
      html += '<div class="card"><p>No payment providers are enabled for this flow.</p>'
      html += `<div class="row"><a class="btn" href="${htmlEscape(returnPath)}">Back</a></div></div>`
      html += '</main></body></html>'
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.send(html)
    }
    html += `<form method="post" action="/checkout/${htmlEscape(intent)}" class="card">`
    html += `<input type="hidden" name="csrf" value="${htmlEscape(csrfToken)}" />`
    html += `<input type="hidden" name="return" value="${htmlEscape(returnPath)}" />`
    html += `<input type="hidden" name="cancel" value="${htmlEscape(cancelPath)}" />`
    if (messageId != null) html += `<input type="hidden" name="message_id" value="${messageId}" />`
    if (messageCampaignKey) html += `<input type="hidden" name="message_campaign_key" value="${htmlEscape(messageCampaignKey)}" />`
    if (messageSessionId) html += `<input type="hidden" name="message_session_id" value="${htmlEscape(messageSessionId)}" />`
    if (messageIntentId) html += `<input type="hidden" name="message_intent_id" value="${htmlEscape(messageIntentId)}" />`
    if (messageCtaKind) html += `<input type="hidden" name="message_cta_kind" value="${htmlEscape(messageCtaKind)}" />`
    if (messageCtaSlot != null) html += `<input type="hidden" name="message_cta_slot" value="${messageCtaSlot}" />`
    if (messageCtaDefinitionId != null) html += `<input type="hidden" name="message_cta_definition_id" value="${messageCtaDefinitionId}" />`
    if (messageCtaIntentKey) html += `<input type="hidden" name="message_cta_intent_key" value="${htmlEscape(messageCtaIntentKey)}" />`
    if (messageCtaExecutorType) html += `<input type="hidden" name="message_cta_executor_type" value="${htmlEscape(messageCtaExecutorType)}" />`
    if (messageSequenceKey) html += `<input type="hidden" name="message_sequence_key" value="${htmlEscape(messageSequenceKey)}" />`
    if (supportSource) html += `<input type="hidden" name="support_source" value="${htmlEscape(supportSource)}" />`
    if (catalogItemId != null) html += `<input type="hidden" name="catalog_item_id" value="${catalogItemId}" />`
    if (amountCents != null) html += `<input type="hidden" name="amount_cents" value="${amountCents}" />`
    html += '<div class="hint">Provider</div>'
    for (const [idx, opt] of modes.entries()) {
      const value = `${opt.provider}:${opt.mode}`
      const isSelected = preselectedProviderMode
        ? preselectedProviderMode === value
        : idx === 0
      html += `<label><input type="radio" name="provider_mode" value="${htmlEscape(value)}"${isSelected ? ' checked' : ''} /> ${htmlEscape(opt.label)}</label>`
    }
    html += '<div class="row"><button type="submit">Continue</button>'
    html += `<a class="btn" href="${htmlEscape(cancelPath)}">Cancel</a></div>`
    html += '</form></main></body></html>'
    res.set('Content-Type', 'text/html; charset=utf-8')
    return res.send(html)
  } catch (err) {
    return next(err)
  }
})

feedMessagesRouter.post(checkoutPagePaths, async (req: any, res: any, next: any) => {
  try {
    const intent = normalizeCheckoutIntent(req.params.intent)
    const rawProviderMode = String(req.body?.provider_mode || '').trim().toLowerCase()
    const [providerRaw, modeRaw] = rawProviderMode.split(':')
    const provider = providerRaw === 'paypal' ? 'paypal' : 'paypal'
    const mode = modeRaw === 'live' ? 'live' : 'sandbox'
    const returnPath = normalizeReturnPath(req.body?.return, '/')
    const cancelPath = normalizeReturnPath(req.body?.cancel, returnPath)
    const messageId = parsePositiveInt(req.body?.message_id)
    const messageCampaignKey = req.body?.message_campaign_key ? String(req.body.message_campaign_key).trim().toLowerCase() : null
    const messageIntentId = req.body?.message_intent_id ? String(req.body.message_intent_id).trim().toLowerCase() : null
    const messageCtaDefinitionId = parsePositiveInt(req.body?.message_cta_definition_id)
    const messageSessionId = req.body?.message_session_id ? String(req.body.message_session_id).trim() : null
    const messageSequenceKey = req.body?.message_sequence_key ? String(req.body.message_sequence_key).trim() : null
    const messageCtaSlot = parsePositiveInt(req.body?.message_cta_slot)
    const messageCtaKind = req.body?.message_cta_kind ? String(req.body.message_cta_kind).trim().toLowerCase() : null
    const messageCtaIntentKey = req.body?.message_cta_intent_key ? String(req.body.message_cta_intent_key).trim().toLowerCase() : null
    const messageCtaExecutorType = req.body?.message_cta_executor_type ? String(req.body.message_cta_executor_type).trim().toLowerCase() : null
    const catalogItemId = parsePositiveInt(req.body?.catalog_item_id)
    const amountCents = parseNonNegativeInt(req.body?.amount_cents)

    const providerReturnPath = '/api/payments/paypal/return'

    try {
      const started = await paymentsSvc.createCheckoutSession({
        provider,
        mode,
        intent: toPaymentIntent(intent),
        userId: req.user?.id ? Number(req.user.id) : null,
        messageId,
        messageCampaignKey,
        messageIntentId,
        messageCtaDefinitionId,
        catalogItemId,
        amountCents,
        returnUrl: providerReturnPath,
        cancelUrl: cancelPath,
        metadata: {
          checkout_intent: intent,
          source: 'message_cta',
          support_source: req.body?.support_source ? String(req.body.support_source).trim() : null,
          final_return_path: returnPath,
          catalog_item_id: catalogItemId,
          amount_cents: amountCents,
          message_session_id: messageSessionId,
          message_sequence_key: messageSequenceKey,
          message_cta_slot: messageCtaSlot,
          message_cta_kind: messageCtaKind,
          message_cta_intent_key: messageCtaIntentKey,
          message_cta_executor_type: messageCtaExecutorType,
        },
      })
      const span = trace.getSpan(context.active())
      if (span) {
        span.setAttribute('app.operation', 'payments.checkout.start')
        span.setAttribute('app.operation_detail', 'payments.checkout.redirect')
        span.setAttribute('app.payment_provider', started.provider)
        span.setAttribute('app.payment_mode', started.mode)
        span.setAttribute('app.payment_intent', intent)
        span.setAttribute('app.payment_checkout_id', started.checkoutId)
        if (catalogItemId != null) span.setAttribute('app.payment_catalog_item_id', String(catalogItemId))
        if (amountCents != null) span.setAttribute('app.payment_amount_cents', String(amountCents))
        if (req.body?.support_source) span.setAttribute('app.support_source', String(req.body.support_source))
        span.setAttribute('app.outcome', 'redirect')
        if (messageId != null) span.setAttribute('app.message_id', String(messageId))
      }
      ;(req.log || feedMessagesLogger).info({
        app_operation: 'payments.checkout.start',
        app_operation_detail: 'payments.checkout.redirect',
        app_outcome: 'redirect',
        payment_provider: started.provider,
        payment_mode: started.mode,
        payment_intent: intent,
        payment_checkout_id: started.checkoutId,
        payment_catalog_item_id: catalogItemId,
        payment_amount_cents: amountCents,
        support_source: req.body?.support_source ? String(req.body.support_source) : null,
        message_id: messageId,
      }, 'payments.checkout.start')
      return res.redirect(started.redirectUrl)
    } catch (err: any) {
      if (String(err?.code || '') === 'paypal_not_implemented' && (intent === 'donate' || intent === 'subscribe' || intent === 'upgrade')) {
        const mock = new URL('/api/cta/mock/complete', `${req.protocol}://${req.get('host')}`)
        if (messageId != null) mock.searchParams.set('message_id', String(messageId))
        if (messageCampaignKey) mock.searchParams.set('message_campaign_key', messageCampaignKey)
        if (messageSessionId) mock.searchParams.set('message_session_id', messageSessionId)
        if (messageCtaKind) mock.searchParams.set('message_cta_kind', messageCtaKind)
        if (messageCtaSlot != null) mock.searchParams.set('message_cta_slot', String(messageCtaSlot))
        if (messageCtaDefinitionId != null) mock.searchParams.set('message_cta_definition_id', String(messageCtaDefinitionId))
        if (messageCtaIntentKey) mock.searchParams.set('message_cta_intent_key', messageCtaIntentKey)
        if (messageCtaExecutorType) mock.searchParams.set('message_cta_executor_type', messageCtaExecutorType)
        mock.searchParams.set('message_flow', intent)
        if (messageIntentId) mock.searchParams.set('message_intent_id', messageIntentId)
        if (messageSequenceKey) mock.searchParams.set('message_sequence_key', messageSequenceKey)
        mock.searchParams.set('return', returnPath)
        const span = trace.getSpan(context.active())
        if (span) {
          span.setAttribute('app.operation', 'payments.checkout.start')
          span.setAttribute('app.operation_detail', 'payments.checkout.mock_fallback')
          span.setAttribute('app.outcome', 'redirect')
        }
        return res.redirect(`${mock.pathname}${mock.search}`)
      }
      throw err
    }
  } catch (err: any) {
    const intent = String(req.params.intent || '').trim().toLowerCase()
    const returnPath = normalizeReturnPath(req.body?.return, '/')
    const query = new URLSearchParams()
    query.set('return', returnPath)
    query.set('error', String(err?.message || 'checkout_start_failed'))
    return res.redirect(`/checkout/${encodeURIComponent(intent)}?${query.toString()}`)
  }
})

feedMessagesRouter.get(paypalReturnPaths, async (req: any, res: any, next: any) => {
  try {
    const withSupportPoll = (target: string): string => {
      const t = String(target || '').trim()
      if (!t) return '/'
      if (!t.startsWith('/my/support')) return t
      const u = new URL(t, 'http://local.invalid')
      u.searchParams.set('poll', '12')
      return `${u.pathname}${u.search}${u.hash}`
    }

    const subscriptionId = String(req.query?.subscription_id || req.query?.ba_token || '').trim()
    if (subscriptionId) {
      const completed = await paymentsSvc.completePaypalSubscriptionReturn({
        providerSubscriptionId: subscriptionId,
      })
      const span = trace.getSpan(context.active())
      if (span) {
        span.setAttribute('app.operation', 'payments.checkout.return')
        span.setAttribute('app.operation_detail', 'payments.checkout.return.subscription_redirect')
        span.setAttribute('app.payment_provider', 'paypal')
        span.setAttribute('app.payment_checkout_id', completed.checkoutId)
        span.setAttribute('app.payment_provider_subscription_id', subscriptionId)
        span.setAttribute('app.payment_status', completed.status)
        span.setAttribute('app.outcome', 'redirect')
      }
      return res.redirect(withSupportPoll(completed.returnUrl || '/'))
    }
    const token = String(req.query?.token || '').trim()
    if (!token) return res.redirect('/')
    const completed = await paymentsSvc.completePaypalOrderFromReturn({
      providerOrderId: token,
      payerId: req.query?.PayerID ? String(req.query.PayerID).trim() : null,
    })
    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.operation', 'payments.checkout.return')
      span.setAttribute('app.operation_detail', 'payments.checkout.return.redirect')
      span.setAttribute('app.payment_provider', 'paypal')
      span.setAttribute('app.payment_checkout_id', completed.checkoutId)
      span.setAttribute('app.payment_status', completed.status)
      span.setAttribute('app.outcome', 'redirect')
    }
    return res.redirect(withSupportPoll(completed.returnUrl || '/'))
  } catch (err: any) {
    const fallback = normalizeReturnPath(req.query?.return, '/')
    if (String(err?.code || '') === 'payment_checkout_not_found') return res.redirect(fallback)
    return next(err)
  }
})

feedMessagesRouter.post(paypalWebhookPaths, async (req: any, res: any, next: any) => {
  try {
    const modeRaw = req.params?.mode != null ? String(req.params.mode).trim().toLowerCase() : String(req.query?.mode || '').trim().toLowerCase()
    const mode: 'sandbox' | 'live' = modeRaw === 'live' ? 'live' : 'sandbox'
    const rawBody = typeof req.body === 'string'
      ? req.body
      : (req.body && typeof req.body === 'object'
        ? JSON.stringify(req.body)
        : String(req.body || ''))

    const ingested = await paymentsSvc.ingestWebhook({
      provider: 'paypal',
      mode,
      verifyInput: {
        mode,
        credentials: {},
        webhookId: null,
        webhookSecret: null,
        headers: req.headers as Record<string, string | string[] | undefined>,
        rawBody,
      },
    })

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.operation', 'payments.webhook')
      span.setAttribute('app.operation_detail', 'payments.webhook.paypal')
      span.setAttribute('app.payment_provider', 'paypal')
      span.setAttribute('app.payment_mode', mode)
      span.setAttribute('app.payment_webhook_event_type', ingested.eventType)
      span.setAttribute('app.payment_webhook_deduped', ingested.deduped ? 1 : 0)
      span.setAttribute('app.outcome', 'success')
    }

    ;(req.log || feedMessagesLogger).info({
      app_operation: 'payments.webhook',
      app_operation_detail: 'payments.webhook.paypal',
      app_outcome: 'success',
      payment_provider: 'paypal',
      payment_mode: mode,
      payment_webhook_event_type: ingested.eventType,
      payment_webhook_deduped: ingested.deduped,
      payment_provider_event_id: ingested.providerEventId,
    }, 'payments.webhook')

    return res.status(200).json({ ok: true, deduped: ingested.deduped })
  } catch (err) {
    return next(err)
  }
})

feedMessagesRouter.post(subscriptionActionPaths, async (req: any, res: any, next: any) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ error: 'unauthorized' })
    const subscriptionId = parsePositiveInt(req.params?.id)
    const action = String(req.params?.action || '').trim().toLowerCase()
    if (!subscriptionId) return res.status(400).json({ error: 'invalid_subscription_id' })
    const targetPlanKey = req.body?.target_plan_key ? String(req.body.target_plan_key).trim().toLowerCase() : null
    const result = await paymentsSvc.requestSubscriptionAction({
      userId: Number(req.user.id),
      subscriptionId,
      action,
      targetPlanKey,
    })
    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.operation', 'payments.subscription.action')
      span.setAttribute('app.operation_detail', `payments.subscription.${action}`)
      span.setAttribute('app.outcome', 'accepted')
      span.setAttribute('app.payment_subscription_id', String(subscriptionId))
      span.setAttribute('app.payment_subscription_action', action)
      if (targetPlanKey) span.setAttribute('app.payment_target_plan_key', targetPlanKey)
    }
    ;(req.log || feedMessagesLogger).info({
      app_operation: 'payments.subscription.action',
      app_operation_detail: `payments.subscription.${action}`,
      app_outcome: 'accepted',
      payment_subscription_id: subscriptionId,
      payment_subscription_action: action,
      payment_target_plan_key: targetPlanKey,
      user_id: Number(req.user.id),
    }, 'payments.subscription.action')
    const returnPath = normalizeReturnPath(req.body?.return, '/my/support')
    const isHtml = String(req.headers?.accept || '').toLowerCase().includes('text/html')
    if (isHtml) return res.redirect(`${returnPath}${returnPath.includes('?') ? '&' : '?'}notice=${encodeURIComponent('Subscription action queued.')}&poll=12`)
    return res.json({ ok: true, ...result })
  } catch (err: any) {
    const returnPath = normalizeReturnPath(req.body?.return, '/my/support')
    const isHtml = String(req.headers?.accept || '').toLowerCase().includes('text/html')
    if (isHtml) {
      const msg = mapSubscriptionActionErrorToUserMessage(err)
      ;(req.log || feedMessagesLogger).warn({
        app_operation: 'payments.subscription.action',
        app_outcome: 'client_error',
        payment_subscription_error_code: String(err?.code || err?.cause?.code || ''),
        payment_subscription_error_message: String(err?.message || err?.cause?.message || ''),
      }, 'payments.subscription.action')
      return res.redirect(`${returnPath}${returnPath.includes('?') ? '&' : '?'}error=${encodeURIComponent(msg)}`)
    }
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
    const messageJourneyId = q.message_journey_id != null && q.message_journey_id !== '' ? Number(q.message_journey_id) : null
    const messageJourneyStepId = q.message_journey_step_id != null && q.message_journey_step_id !== '' ? Number(q.message_journey_step_id) : null
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
    let journeySignalResult: { stepsMatched: number; progressed: number; ignored: number } | null = null
    try {
      const ctaOutcome = await messageCtaOutcomesSvc.recordCtaOutcome({
        outcomeId: intentId ? `intent:${intentId}:${event}` : null,
        sourceEventType: 'feed.message.mock_complete',
        outcomeType: 'verified_complete',
        outcomeStatus: 'success',
        sessionId,
        userId: req.user?.id ? Number(req.user.id) : null,
        anonVisitorId: req.user?.id ? null : sessionId,
        messageId: Number(messageId || 0),
        messageCampaignKey,
        deliveryContext: messageJourneyId && messageJourneyStepId ? 'journey' : 'standalone',
        journeyId: Number.isFinite(Number(messageJourneyId)) && Number(messageJourneyId) > 0 ? Number(messageJourneyId) : null,
        journeyStepId: Number.isFinite(Number(messageJourneyStepId)) && Number(messageJourneyStepId) > 0 ? Number(messageJourneyStepId) : null,
        ctaSlot: messageCtaSlot,
        ctaDefinitionId: messageCtaDefinitionId,
        ctaIntentKey: messageCtaIntentKey,
        ctaExecutorType: messageCtaExecutorType,
        payload: {
          flow: rawFlow,
          message_sequence_key: messageSequenceKey || null,
          mock: true,
        },
      })
      if (ctaOutcome.journeySignal) journeySignalResult = ctaOutcome.journeySignal
    } catch {}
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
      span.setAttribute('app.event_type', event)
      span.setAttribute('app.message_id', String(Number(messageId || 0) || 0))
      span.setAttribute('app.outcome', event)
      if (ctaKind) span.setAttribute('app.cta_kind', ctaKind)
      if (intentId) span.setAttribute('app.message_intent_id', intentId)
      if (rawFlow) span.setAttribute('app.message_flow', rawFlow)
      if (messageCtaSlot != null && Number.isFinite(messageCtaSlot)) span.setAttribute('app.message_cta_slot', String(Math.round(messageCtaSlot)))
      if (messageCtaDefinitionId != null && Number.isFinite(messageCtaDefinitionId)) span.setAttribute('app.message_cta_definition_id', String(Math.round(messageCtaDefinitionId)))
      if (messageCtaIntentKey) span.setAttribute('app.message_cta_intent_key', messageCtaIntentKey)
      if (messageCtaExecutorType) span.setAttribute('app.message_cta_executor_type', messageCtaExecutorType)
      if (journeySignalResult) {
        span.setAttribute('app.journey_steps_matched', String(Math.round(Number(journeySignalResult.stepsMatched || 0))))
        span.setAttribute('app.journey_progressed', String(Math.round(Number(journeySignalResult.progressed || 0))))
        span.setAttribute('app.journey_ignored', String(Math.round(Number(journeySignalResult.ignored || 0))))
      }
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
      journey_steps_matched: journeySignalResult ? Number(journeySignalResult.stepsMatched || 0) : 0,
      journey_progressed: journeySignalResult ? Number(journeySignalResult.progressed || 0) : 0,
      journey_ignored: journeySignalResult ? Number(journeySignalResult.ignored || 0) : 0,
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
