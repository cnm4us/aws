import { Router } from 'express'
import { moderationMeasureRequestSchema } from '../features/moderation-v2'
import * as moderationV2Svc from '../features/moderation-v2/service'

export const moderationV2Router = Router()

const measurePaths = ['/api/moderation/measure']

moderationV2Router.post(measurePaths, async (req, res, next) => {
  try {
    const parsed = moderationMeasureRequestSchema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_measure_request',
        detail: parsed.error.flatten(),
      })
    }
    const data = await moderationV2Svc.measureModeration(parsed.data)
    return res.json(data)
  } catch (err) {
    return next(err)
  }
})

