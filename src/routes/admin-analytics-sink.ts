import { Router } from 'express'
import { requireAuth, requireSiteAdmin } from '../middleware/auth'
import { getAnalyticsSinkHealth } from '../features/analytics-sink/service'

export const adminAnalyticsSinkRouter = Router()

adminAnalyticsSinkRouter.use('/api/admin/analytics-sink', requireAuth, requireSiteAdmin)

adminAnalyticsSinkRouter.get('/api/admin/analytics-sink/health', async (_req, res) => {
  const health = getAnalyticsSinkHealth()
  return res.json({ health })
})
