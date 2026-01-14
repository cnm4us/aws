import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as draftsSvc from '../features/production-drafts/service'

export const productionDraftsRouter = Router()

productionDraftsRouter.get('/api/production-drafts/active', requireAuth, async (req, res, next) => {
  try {
    const items = await draftsSvc.listActiveForUser(Number(req.user!.id))
    res.json({ items })
  } catch (err: any) {
    next(err)
  }
})

productionDraftsRouter.get('/api/production-drafts', requireAuth, async (req, res, next) => {
  try {
    const uploadId = req.query?.uploadId
    const draft = await draftsSvc.getActiveForUser(uploadId, Number(req.user!.id))
    res.json({ draft })
  } catch (err: any) {
    next(err)
  }
})

productionDraftsRouter.post('/api/production-drafts', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {}
    const result = await draftsSvc.createOrGetActiveForUser(body.uploadId, Number(req.user!.id))
    res.status(result.created ? 201 : 200).json(result)
  } catch (err: any) {
    next(err)
  }
})

productionDraftsRouter.patch('/api/production-drafts/:id', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {}
    const draft = await draftsSvc.updateConfigForUser(req.params.id, body.config, Number(req.user!.id))
    res.json({ draft })
  } catch (err: any) {
    next(err)
  }
})

productionDraftsRouter.post('/api/production-drafts/:id/archive', requireAuth, async (req, res, next) => {
  try {
    const result = await draftsSvc.archiveForUser(req.params.id, Number(req.user!.id))
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})
