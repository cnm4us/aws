import { Router } from 'express'
import { requireAuth, requireSiteAdmin } from '../middleware/auth'
import * as feedActivitySvc from '../features/feed-activity/service'

export const adminFeedAnalyticsRouter = Router()

adminFeedAnalyticsRouter.use('/api/admin/feed-analytics', requireAuth, requireSiteAdmin)

adminFeedAnalyticsRouter.get('/api/admin/feed-analytics', async (req, res, next) => {
  try {
    const report = await feedActivitySvc.getFeedActivityReportForAdmin({
      fromDate: req.query?.from,
      toDate: req.query?.to,
      surface: req.query?.surface,
      spaceId: req.query?.space_id,
      viewerState: req.query?.viewer_state,
    })
    return res.json({ report })
  } catch (err) {
    return next(err)
  }
})
