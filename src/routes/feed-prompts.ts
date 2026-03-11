import { Router } from 'express'
import { context, trace } from '@opentelemetry/api'
import { parseCookies } from '../utils/cookies'
import { can } from '../security/permissions'
import { PERM } from '../security/perm'
import { buildDecisionInput, ANON_SESSION_COOKIE, ANON_SESSION_TTL_MS, decidePrompt } from '../features/prompt-decision/service'
import * as promptsSvc from '../features/prompts/service'
import * as uploadsSvc from '../features/uploads/service'
import * as promptAnalyticsSvc from '../features/prompt-analytics/service'
import { getLogger } from '../lib/logger'

export const feedPromptsRouter = Router()
const feedPromptsLogger = getLogger({ component: 'routes.feed_prompts' })

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
          last_prompt_dismissed_at: req.query?.last_prompt_dismissed_at,
          last_prompt_id: req.query?.last_prompt_id,
        }
      : (req.body || {})

    const cookies = parseCookies(req.headers.cookie)
    const cookieSessionId = cookies[ANON_SESSION_COOKIE] ? String(cookies[ANON_SESSION_COOKIE]).trim() : null
    const viewerState = req.user?.id ? 'authenticated' : 'anonymous'

    const { input, createdSessionId } = buildDecisionInput({
      body,
      cookieSessionId,
      viewerState,
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

    let includeDebug = false
    if (String(process.env.PROMPT_DEBUG || '0') === '1' && req.user?.id) {
      try {
        includeDebug = await can(Number(req.user.id), PERM.VIDEO_DELETE_ANY)
      } catch {
        includeDebug = false
      }
    }

    const decision = await decidePrompt(input, { includeDebug })

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.surface', 'global_feed')
      span.setAttribute('app.operation', 'feed.prompt.decide')
      span.setAttribute('app.rule_reason', decision.reasonCode)
      span.setAttribute('app.outcome', decision.shouldInsert ? 'shown' : 'blocked')
      if (decision.promptId != null) span.setAttribute('app.prompt_id', String(decision.promptId))
      if (decision.ruleId != null) span.setAttribute('app.rule_id', String(decision.ruleId))
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

feedPromptsRouter.post('/api/feed/prompt-decision', handleDecision)
feedPromptsRouter.get('/api/feed/prompt-decision', handleDecision)

feedPromptsRouter.get('/api/feed/prompts/:id', async (req: any, res: any, next: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })

    const prompt = await promptsSvc.getActiveForFeedById(id)

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
        if (backgroundMode === 'image' || backgroundMode === 'video') {
          try {
            const signed = await uploadsSvc.getUploadPublicPromptBackgroundCdnUrl(Number(upload.id), {
              mode: backgroundMode as 'image' | 'video',
            })
            publicBackgroundUrl = signed.url
          } catch {
            publicBackgroundUrl = null
          }
        }
        media = {
          upload_id: Number(upload.id),
          master: publicBackgroundUrl || upload.cdn_master || upload.s3_master || null,
          poster_portrait:
            publicBackgroundUrl ||
            upload.poster_portrait_cdn ||
            upload.poster_portrait_s3 ||
            upload.poster_cdn ||
            upload.poster_s3 ||
            null,
          poster_landscape: publicBackgroundUrl || upload.poster_landscape_cdn || upload.poster_landscape_s3 || null,
        }
      } catch {
        media = null
      }
    }

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.surface', 'global_feed')
      span.setAttribute('app.operation', 'feed.prompt.fetch')
      span.setAttribute('app.prompt_id', String(prompt.id))
      span.setAttribute('app.outcome', 'shown')
    }

    return res.json({
      prompt: {
        id: prompt.id,
        category: prompt.category,
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

feedPromptsRouter.post('/api/feed/prompt-events', async (req: any, res: any, next: any) => {
  try {
    const body = (req.body || {}) as any
    const promptCategory = body.prompt_category ? String(body.prompt_category) : null
    const ctaKind = body.cta_kind ? String(body.cta_kind) : null
    const sessionId = body.session_id ? String(body.session_id).trim() : null

    const tracked = await promptAnalyticsSvc.recordPromptEvent({
      event: body.event,
      promptId: body.prompt_id,
      promptCategory,
      ctaKind,
      surface: body.surface || 'global_feed',
      sessionId,
      viewerState: req.user?.id ? 'authenticated' : 'anonymous',
      userId: req.user?.id ? Number(req.user.id) : null,
    })

    const opByEvent: Record<string, string> = {
      impression: 'feed.prompt.render',
      click: 'feed.prompt.click',
      dismiss: 'feed.prompt.dismiss',
      auth_start: 'feed.prompt.auth_start',
      auth_complete: 'feed.prompt.auth_complete',
    }
    const outcomeByEvent: Record<string, string> = {
      impression: 'shown',
      click: 'clicked',
      dismiss: 'dismissed',
      auth_start: 'auth_start',
      auth_complete: 'auth_complete',
    }

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.surface', tracked.surface)
      span.setAttribute('app.operation', 'analytics.ingest')
      span.setAttribute('app.operation_detail', opByEvent[tracked.inputEvent] || 'feed.prompt.event')
      span.setAttribute('app.prompt_id', String(tracked.promptId))
      span.setAttribute('app.outcome', outcomeByEvent[tracked.inputEvent] || 'shown')
      if (sessionId) span.setAttribute('app.prompt_session_id', sessionId)
    }

    ;(req.log || feedPromptsLogger).info(
      {
        app_surface: tracked.surface,
        app_operation: 'analytics.ingest',
        app_operation_detail: opByEvent[tracked.inputEvent] || 'feed.prompt.event',
        app_outcome: outcomeByEvent[tracked.inputEvent] || 'shown',
        prompt_id: tracked.promptId,
        prompt_category: promptCategory,
        cta_kind: ctaKind,
        prompt_session_id: sessionId,
        prompt_event_type: tracked.eventType,
        prompt_event_deduped: !tracked.inserted,
        prompt_event_attributed: tracked.attributed,
        viewer_user_id: req.user?.id ? Number(req.user.id) : null,
      },
      'feed.prompt.event'
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
