import { Router } from 'express'
import { requireAuth, requireSiteAdmin } from '../middleware/auth'
import * as promptsSvc from '../features/prompts/service'

export const adminPromptsRouter = Router()

adminPromptsRouter.use('/api/admin/prompts', requireAuth, requireSiteAdmin)

adminPromptsRouter.get('/api/admin/prompts', async (req, res, next) => {
  try {
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const limitRaw = req.query?.limit ? Number(req.query.limit) : undefined
    const items = await promptsSvc.listForAdmin({
      includeArchived,
      limit: limitRaw,
      status: req.query?.status,
      promptType: req.query?.prompt_type,
      appliesToSurface: req.query?.applies_to_surface,
      audienceSegment: req.query?.audience_segment,
      category: req.query?.category,
    })
    return res.json({ items })
  } catch (err) {
    return next(err)
  }
})

adminPromptsRouter.post('/api/admin/prompts', async (req, res, next) => {
  try {
    const prompt = await promptsSvc.createForAdmin(req.body || {}, Number(req.user?.id || 0))
    return res.status(201).json({ prompt })
  } catch (err) {
    return next(err)
  }
})

adminPromptsRouter.get('/api/admin/prompts/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const prompt = await promptsSvc.getForAdmin(id)
    return res.json({ prompt })
  } catch (err) {
    return next(err)
  }
})

adminPromptsRouter.patch('/api/admin/prompts/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const prompt = await promptsSvc.updateForAdmin(id, req.body || {}, Number(req.user?.id || 0))
    return res.json({ prompt })
  } catch (err) {
    return next(err)
  }
})

adminPromptsRouter.post('/api/admin/prompts/:id/clone', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const prompt = await promptsSvc.cloneForAdmin(id, Number(req.user?.id || 0))
    return res.status(201).json({ prompt })
  } catch (err) {
    return next(err)
  }
})

adminPromptsRouter.post('/api/admin/prompts/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const prompt = await promptsSvc.updateStatusForAdmin(id, req.body?.status, Number(req.user?.id || 0))
    return res.json({ prompt })
  } catch (err) {
    return next(err)
  }
})
