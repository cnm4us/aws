import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as messageRulesetsSvc from '../features/message-eligibility-rulesets/service'

export const adminMessageRulesetsRouter = Router()

const collectionPaths = ['/api/admin/message-rulesets']
const detailPaths = ['/api/admin/message-rulesets/:id']

adminMessageRulesetsRouter.use(collectionPaths, requireAuth)
adminMessageRulesetsRouter.use(detailPaths, requireAuth)

adminMessageRulesetsRouter.get(collectionPaths, async (req, res, next) => {
  try {
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const limitRaw = req.query?.limit ? Number(req.query.limit) : undefined
    const items = await messageRulesetsSvc.listRulesetsForAdmin({
      includeArchived,
      limit: limitRaw,
      status: req.query?.status as any,
    })
    return res.json({ items })
  } catch (err) {
    return next(err)
  }
})

adminMessageRulesetsRouter.post(collectionPaths, async (req, res, next) => {
  try {
    const item = await messageRulesetsSvc.createRulesetForAdmin(req.body || {}, Number(req.user?.id || 0))
    return res.status(201).json({ item })
  } catch (err) {
    return next(err)
  }
})

adminMessageRulesetsRouter.get(detailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const item = await messageRulesetsSvc.getRulesetForAdmin(id)
    return res.json({ item })
  } catch (err) {
    return next(err)
  }
})

adminMessageRulesetsRouter.patch(detailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const item = await messageRulesetsSvc.updateRulesetForAdmin(id, req.body || {}, Number(req.user?.id || 0))
    return res.json({ item })
  } catch (err) {
    return next(err)
  }
})

adminMessageRulesetsRouter.delete(detailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    await messageRulesetsSvc.deleteRulesetForAdmin(id, Number(req.user?.id || 0))
    return res.status(204).send()
  } catch (err) {
    return next(err)
  }
})
