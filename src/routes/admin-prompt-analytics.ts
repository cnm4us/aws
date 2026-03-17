import { Router } from 'express'
import { context, trace } from '@opentelemetry/api'
import { requireAuth, requireSiteAdmin } from '../middleware/auth'
import * as promptAnalyticsSvc from '../features/prompt-analytics/service'

export const adminPromptAnalyticsRouter = Router()

adminPromptAnalyticsRouter.use('/api/admin/prompt-analytics', requireAuth, requireSiteAdmin)

adminPromptAnalyticsRouter.get('/api/admin/prompt-analytics', async (req, res, next) => {
  try {
    const report = await promptAnalyticsSvc.getPromptAnalyticsReportForAdmin({
      fromDate: req.query?.from,
      toDate: req.query?.to,
      surface: req.query?.surface,
      promptId: req.query?.prompt_id,
      promptCampaignKey: req.query?.prompt_campaign_key ?? req.query?.prompt_category,
      viewerState: req.query?.viewer_state,
    })
    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.operation', 'analytics.query')
      span.setAttribute('app.operation_detail', 'prompt.analytics.query')
      span.setAttribute('app.surface', 'admin')
      span.setAttribute('app.outcome', 'success')
    }
    return res.json({ report })
  } catch (err) {
    return next(err)
  }
})

adminPromptAnalyticsRouter.get('/api/admin/prompt-analytics.csv', async (req, res, next) => {
  try {
    const report = await promptAnalyticsSvc.getPromptAnalyticsReportForAdmin({
      fromDate: req.query?.from,
      toDate: req.query?.to,
      surface: req.query?.surface,
      promptId: req.query?.prompt_id,
      promptCampaignKey: req.query?.prompt_campaign_key ?? req.query?.prompt_category,
      viewerState: req.query?.viewer_state,
    })
    const csv = promptAnalyticsSvc.buildPromptAnalyticsCsv(report)
    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute('app.operation', 'analytics.query')
      span.setAttribute('app.operation_detail', 'prompt.analytics.query.csv')
      span.setAttribute('app.surface', 'admin')
      span.setAttribute('app.outcome', 'success')
    }
    const filename = `prompt-analytics-${report.range.fromDate}_to_${report.range.toDate}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(csv)
  } catch (err) {
    return next(err)
  }
})
