import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as messageJourneysSvc from '../features/message-journeys/service'

export const adminMessageJourneysRouter = Router()

const collectionPaths = ['/api/admin/message-journeys']
const detailPaths = ['/api/admin/message-journeys/:id']
const stepsCollectionPaths = ['/api/admin/message-journeys/:id/steps']
const stepDetailPaths = ['/api/admin/message-journeys/:id/steps/:stepId']

adminMessageJourneysRouter.use(collectionPaths, requireAuth)
adminMessageJourneysRouter.use(detailPaths, requireAuth)
adminMessageJourneysRouter.use(stepsCollectionPaths, requireAuth)
adminMessageJourneysRouter.use(stepDetailPaths, requireAuth)

adminMessageJourneysRouter.get(collectionPaths, async (req, res, next) => {
  try {
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const limitRaw = req.query?.limit ? Number(req.query.limit) : undefined
    const items = await messageJourneysSvc.listJourneysForAdmin({
      includeArchived,
      limit: limitRaw,
      status: req.query?.status as any,
    })
    return res.json({ items })
  } catch (err) {
    return next(err)
  }
})

adminMessageJourneysRouter.post(collectionPaths, async (req, res, next) => {
  try {
    const item = await messageJourneysSvc.createJourneyForAdmin(req.body || {}, Number(req.user?.id || 0))
    return res.status(201).json({ item })
  } catch (err) {
    return next(err)
  }
})

adminMessageJourneysRouter.get(detailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const item = await messageJourneysSvc.getJourneyForAdmin(id)
    const steps = await messageJourneysSvc.listJourneyStepsForAdmin(id, { includeArchived: true })
    return res.json({ item, steps })
  } catch (err) {
    return next(err)
  }
})

adminMessageJourneysRouter.patch(detailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const item = await messageJourneysSvc.updateJourneyForAdmin(id, req.body || {}, Number(req.user?.id || 0))
    return res.json({ item })
  } catch (err) {
    return next(err)
  }
})

adminMessageJourneysRouter.delete(detailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    await messageJourneysSvc.deleteJourneyForAdmin(id, Number(req.user?.id || 0))
    return res.status(204).send()
  } catch (err) {
    return next(err)
  }
})

adminMessageJourneysRouter.get(stepsCollectionPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const status = req.query?.status ? String(req.query.status) : ''
    const items = await messageJourneysSvc.listJourneyStepsForAdmin(id, {
      includeArchived,
      status,
    })
    return res.json({ items })
  } catch (err) {
    return next(err)
  }
})

adminMessageJourneysRouter.post(stepsCollectionPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const item = await messageJourneysSvc.createJourneyStepForAdmin(id, req.body || {}, Number(req.user?.id || 0))
    return res.status(201).json({ item })
  } catch (err) {
    return next(err)
  }
})

adminMessageJourneysRouter.patch(stepDetailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const stepId = Number(req.params.stepId)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    if (!Number.isFinite(stepId) || stepId <= 0) return res.status(400).json({ error: 'bad_step_id' })
    const item = await messageJourneysSvc.updateJourneyStepForAdmin(id, stepId, req.body || {}, Number(req.user?.id || 0))
    return res.json({ item })
  } catch (err) {
    return next(err)
  }
})

adminMessageJourneysRouter.delete(stepDetailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const stepId = Number(req.params.stepId)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    if (!Number.isFinite(stepId) || stepId <= 0) return res.status(400).json({ error: 'bad_step_id' })
    await messageJourneysSvc.deleteJourneyStepForAdmin(id, stepId, Number(req.user?.id || 0))
    return res.status(204).send()
  } catch (err) {
    return next(err)
  }
})
