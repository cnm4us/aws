import { Router } from 'express'
import {
  moderationJudgeRequestSchema,
  moderationMeasureRequestSchema,
  moderationReviewRequestSchema,
} from '../features/moderation-v2'
import { requireAuth } from '../middleware/auth'
import * as moderationV2Svc from '../features/moderation-v2/service'

export const moderationV2Router = Router()

const measurePaths = ['/api/moderation/measure']
const judgePaths = ['/api/moderation/judge']
const reviewPaths = ['/api/moderation/review']

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

moderationV2Router.post(judgePaths, async (req, res, next) => {
  try {
    const parsed = moderationJudgeRequestSchema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_judge_request',
        detail: parsed.error.flatten(),
      })
    }
    const data = await moderationV2Svc.judgeModeration(parsed.data)
    return res.json(data)
  } catch (err) {
    return next(err)
  }
})

moderationV2Router.post(reviewPaths, requireAuth, async (req, res, next) => {
  try {
    const parsed = moderationReviewRequestSchema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_review_request',
        detail: parsed.error.flatten(),
      })
    }
    const reviewerUserId = Number(req.user!.id)
    const data = await moderationV2Svc.reviewModeration(parsed.data, reviewerUserId)
    return res.json(data)
  } catch (err) {
    return next(err)
  }
})
