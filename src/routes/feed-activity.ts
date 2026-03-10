import { Router } from 'express'
import { context, trace } from '@opentelemetry/api'
import * as feedActivitySvc from '../features/feed-activity/service'
import { getLogger } from '../lib/logger'

export const feedActivityRouter = Router()
const feedActivityLogger = getLogger({ component: 'routes.feed_activity' })

feedActivityRouter.post('/api/feed/activity-events', async (req: any, res: any, next: any) => {
  try {
    const body = (req.body || {}) as any
    const tracked = await feedActivitySvc.recordFeedActivityEvent({
      event: body.event,
      surface: body.surface || 'global_feed',
      spaceId: body.space_id,
      spaceType: body.space_type,
      spaceSlug: body.space_slug,
      spaceName: body.space_name,
      sessionId: body.session_id,
      contentId: body.content_id,
      watchSeconds: body.watch_seconds,
      viewerState: req.user?.id ? 'authenticated' : 'anonymous',
      userId: req.user?.id ? Number(req.user.id) : null,
    })

    const opByEvent: Record<string, string> = {
      session_start: 'feed.activity.session_start',
      slide_impression: 'feed.activity.slide_impression',
      slide_complete: 'feed.activity.slide_complete',
      session_end: 'feed.activity.session_end',
    }
    const outcomeByEvent: Record<string, string> = {
      session_start: 'started',
      slide_impression: 'shown',
      slide_complete: 'completed',
      session_end: 'completed',
    }

    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.surface', tracked.surface)
      if (body.space_id != null) span.setAttribute('app.space_id', String(body.space_id))
      if (body.space_type) span.setAttribute('app.space_type', String(body.space_type))
      if (body.space_slug) span.setAttribute('app.space_slug', String(body.space_slug))
      span.setAttribute('app.operation', opByEvent[tracked.inputEvent] || 'feed.activity.event')
      if (tracked.contentId != null) span.setAttribute('app.content_id', String(tracked.contentId))
      span.setAttribute('app.outcome', outcomeByEvent[tracked.inputEvent] || 'success')
    }

    ;(req.log || feedActivityLogger).info(
      {
        app_surface: tracked.surface,
        app_operation: opByEvent[tracked.inputEvent] || 'feed.activity.event',
        app_outcome: outcomeByEvent[tracked.inputEvent] || 'success',
        app_space_id: body.space_id == null ? null : Number(body.space_id),
        app_space_type: body.space_type == null ? null : String(body.space_type),
        app_space_slug: body.space_slug == null ? null : String(body.space_slug),
        app_space_name: body.space_name == null ? null : String(body.space_name),
        content_id: tracked.contentId,
        feed_activity_event_type: tracked.eventType,
        feed_activity_deduped: !tracked.inserted,
        viewer_user_id: req.user?.id ? Number(req.user.id) : null,
      },
      'feed.activity.event'
    )

    return res.json({
      ok: true,
      deduped: !tracked.inserted,
      counted: tracked.countedInRollup,
    })
  } catch (err) {
    return next(err)
  }
})
