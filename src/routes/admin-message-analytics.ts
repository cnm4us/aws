import { Router } from 'express'
import { context, trace } from '@opentelemetry/api'
import { requireAuth, requireSiteAdmin } from '../middleware/auth'
import * as messageAnalyticsSvc from '../features/message-analytics/service'

export const adminMessageAnalyticsRouter = Router()
const adminMessageAnalyticsPaths = ['/api/admin/message-analytics']
const adminMessageAnalyticsCsvPaths = ['/api/admin/message-analytics.csv']

adminMessageAnalyticsRouter.use(adminMessageAnalyticsPaths, requireAuth, requireSiteAdmin)
adminMessageAnalyticsRouter.use(adminMessageAnalyticsCsvPaths, requireAuth, requireSiteAdmin)

adminMessageAnalyticsRouter.get(adminMessageAnalyticsPaths, async (req, res, next) => {
  try {
    const report = await messageAnalyticsSvc.getMessageAnalyticsReportForAdmin({
      fromDate: req.query?.from,
      toDate: req.query?.to,
      surface: req.query?.surface,
      promptId: req.query?.message_id ?? req.query?.prompt_id,
      promptType: req.query?.message_type ?? req.query?.prompt_type,
      promptCampaignKey: req.query?.message_campaign_key ?? req.query?.prompt_campaign_key ?? req.query?.prompt_category,
      viewerState: req.query?.viewer_state,
    })
    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.operation', 'analytics.query')
      span.setAttribute('app.operation_detail', 'message.analytics.query')
      span.setAttribute('app.surface', 'admin')
      span.setAttribute('app.outcome', 'success')
    }
    return res.json({ report })
  } catch (err) {
    return next(err)
  }
})

adminMessageAnalyticsRouter.get(adminMessageAnalyticsCsvPaths, async (req, res, next) => {
  try {
    const report = await messageAnalyticsSvc.getMessageAnalyticsReportForAdmin({
      fromDate: req.query?.from,
      toDate: req.query?.to,
      surface: req.query?.surface,
      promptId: req.query?.message_id ?? req.query?.prompt_id,
      promptType: req.query?.message_type ?? req.query?.prompt_type,
      promptCampaignKey: req.query?.message_campaign_key ?? req.query?.prompt_campaign_key ?? req.query?.prompt_category,
      viewerState: req.query?.viewer_state,
    })
    const csv = messageAnalyticsSvc.buildMessageAnalyticsCsv(report)
    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.operation', 'analytics.query')
      span.setAttribute('app.operation_detail', 'message.analytics.query.csv')
      span.setAttribute('app.surface', 'admin')
      span.setAttribute('app.outcome', 'success')
    }
    const filename = `message-analytics-${report.range.fromDate}_to_${report.range.toDate}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(csv)
  } catch (err) {
    return next(err)
  }
})
