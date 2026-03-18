import { Router } from 'express'
import { requireAuth, requireSiteAdmin } from '../middleware/auth'
import * as messagesSvc from '../features/messages/service'

export const adminMessagesRouter = Router()

adminMessagesRouter.use('/api/admin/prompts', requireAuth, requireSiteAdmin)

adminMessagesRouter.get('/api/admin/prompts', async (req, res, next) => {
  try {
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const limitRaw = req.query?.limit ? Number(req.query.limit) : undefined
    const items = await messagesSvc.listMessagesForAdmin({
      includeArchived,
      limit: limitRaw,
      status: req.query?.status,
      promptType: req.query?.prompt_type,
      appliesToSurface: req.query?.applies_to_surface,
      audienceSegment: req.query?.audience_segment,
      campaignKey: req.query?.campaign_key,
    })
    return res.json({ items })
  } catch (err) {
    return next(err)
  }
})

adminMessagesRouter.post('/api/admin/prompts', async (req, res, next) => {
  try {
    const prompt = await messagesSvc.createMessageForAdmin(req.body || {}, Number(req.user?.id || 0))
    return res.status(201).json({ prompt })
  } catch (err) {
    return next(err)
  }
})

adminMessagesRouter.get('/api/admin/prompts/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const prompt = await messagesSvc.getMessageForAdmin(id)
    return res.json({ prompt })
  } catch (err) {
    return next(err)
  }
})

adminMessagesRouter.patch('/api/admin/prompts/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const prompt = await messagesSvc.updateMessageForAdmin(id, req.body || {}, Number(req.user?.id || 0))
    return res.json({ prompt })
  } catch (err) {
    return next(err)
  }
})

adminMessagesRouter.post('/api/admin/prompts/:id/clone', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const prompt = await messagesSvc.cloneMessageForAdmin(id, Number(req.user?.id || 0))
    return res.status(201).json({ prompt })
  } catch (err) {
    return next(err)
  }
})

adminMessagesRouter.post('/api/admin/prompts/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const prompt = await messagesSvc.updateMessageStatusForAdmin(id, req.body?.status, Number(req.user?.id || 0))
    return res.json({ prompt })
  } catch (err) {
    return next(err)
  }
})
