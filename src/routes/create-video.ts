import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as createVideoSvc from '../features/create-video/service'

export const createVideoRouter = Router()

createVideoRouter.post('/api/create-video/project', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const result = await createVideoSvc.createOrGetActiveProjectForUser(currentUserId)
    res.status(result.created ? 201 : 200).json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.get('/api/create-video/project', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const project = await createVideoSvc.getActiveProjectForUser(currentUserId)
    res.json({ project })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.patch('/api/create-video/project', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const timeline = (req.body || {}).timeline
    const project = await createVideoSvc.updateActiveProjectTimelineForUser(currentUserId, timeline)
    res.json({ project })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.post('/api/create-video/project/archive', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const result = await createVideoSvc.archiveActiveProjectForUser(currentUserId)
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.post('/api/create-video/project/export', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const result = await createVideoSvc.exportActiveProjectForUser(currentUserId)
    res.status(202).json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.get('/api/create-video/project/export-status', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const result = await createVideoSvc.getExportStatusForUser(currentUserId)
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

