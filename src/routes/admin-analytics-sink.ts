import { Router } from 'express'
import { context, trace } from '@opentelemetry/api'
import { requireAuth, requireSiteAdmin } from '../middleware/auth'
import { getAnalyticsSinkHealth } from '../features/analytics-sink/service'

export const adminAnalyticsSinkRouter = Router()

adminAnalyticsSinkRouter.use('/api/admin/analytics-sink', requireAuth, requireSiteAdmin)

adminAnalyticsSinkRouter.get('/api/admin/analytics-sink/health', async (_req, res) => {
  const health = getAnalyticsSinkHealth()
  const span = trace.getSpan(context.active())
  if (span) {
    span.setAttribute('app.operation', 'analytics.query')
    span.setAttribute('app.operation_detail', 'analytics.sink.health')
    span.setAttribute('app.surface', 'admin')
    span.setAttribute('app.outcome', 'success')
  }
  return res.json({ health })
})
