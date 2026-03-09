import { Router } from 'express'
import { requireAuth, requireSiteAdmin } from '../middleware/auth'
import * as promptRulesSvc from '../features/prompt-rules/service'

export const adminPromptRulesRouter = Router()

adminPromptRulesRouter.use(requireAuth)
adminPromptRulesRouter.use(requireSiteAdmin)

adminPromptRulesRouter.get('/api/admin/prompt-rules', async (req, res, next) => {
  try {
    const limitRaw = req.query?.limit ? Number(req.query.limit) : undefined
    const items = await promptRulesSvc.listForAdmin({
      limit: limitRaw,
      enabled: req.query?.enabled,
      appliesToSurface: req.query?.applies_to_surface,
      authState: req.query?.auth_state,
    })
    return res.json({ items })
  } catch (err) {
    return next(err)
  }
})

adminPromptRulesRouter.post('/api/admin/prompt-rules', async (req, res, next) => {
  try {
    const rule = await promptRulesSvc.createForAdmin(req.body || {}, Number(req.user?.id || 0))
    return res.status(201).json({ rule })
  } catch (err) {
    return next(err)
  }
})

adminPromptRulesRouter.get('/api/admin/prompt-rules/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const rule = await promptRulesSvc.getForAdmin(id)
    return res.json({ rule })
  } catch (err) {
    return next(err)
  }
})

adminPromptRulesRouter.patch('/api/admin/prompt-rules/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const rule = await promptRulesSvc.updateForAdmin(id, req.body || {}, Number(req.user?.id || 0))
    return res.json({ rule })
  } catch (err) {
    return next(err)
  }
})

adminPromptRulesRouter.post('/api/admin/prompt-rules/:id/toggle', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const rule = await promptRulesSvc.toggleEnabledForAdmin(id, req.body?.enabled, Number(req.user?.id || 0))
    return res.json({ rule })
  } catch (err) {
    return next(err)
  }
})
