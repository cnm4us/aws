import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as svc from '../features/user-facing-rules/service'

export const adminUserFacingRulesRouter = Router()

const collectionPaths = ['/api/admin/user-facing-rules']
const detailPaths = ['/api/admin/user-facing-rules/:id']
const mappingCollectionPaths = ['/api/admin/user-facing-rules/:id/mappings']
const mappingDetailPaths = ['/api/admin/user-facing-rules/:id/mappings/:mappingId']

adminUserFacingRulesRouter.use(collectionPaths, requireAuth)
adminUserFacingRulesRouter.use(detailPaths, requireAuth)
adminUserFacingRulesRouter.use(mappingCollectionPaths, requireAuth)
adminUserFacingRulesRouter.use(mappingDetailPaths, requireAuth)

adminUserFacingRulesRouter.get(collectionPaths, async (req, res, next) => {
  try {
    const includeInactive = String(req.query?.include_inactive || '0') === '1'
    const limitRaw = req.query?.limit != null ? Number(req.query.limit) : undefined
    const items = await svc.listUserFacingRulesForAdmin({ includeInactive, limit: limitRaw })
    return res.json({ items })
  } catch (err) {
    return next(err)
  }
})

adminUserFacingRulesRouter.post(collectionPaths, async (req, res, next) => {
  try {
    const item = await svc.createUserFacingRuleForAdmin(req.body || {}, Number(req.user?.id || 0))
    return res.status(201).json({ item })
  } catch (err) {
    return next(err)
  }
})

adminUserFacingRulesRouter.get(detailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const item = await svc.getUserFacingRuleForAdmin(id)
    return res.json({ item })
  } catch (err) {
    return next(err)
  }
})

adminUserFacingRulesRouter.patch(detailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const item = await svc.updateUserFacingRuleForAdmin(id, req.body || {}, Number(req.user?.id || 0))
    return res.json({ item })
  } catch (err) {
    return next(err)
  }
})

adminUserFacingRulesRouter.delete(detailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    await svc.deleteUserFacingRuleForAdmin(id, Number(req.user?.id || 0))
    return res.status(204).send()
  } catch (err) {
    return next(err)
  }
})

adminUserFacingRulesRouter.post(mappingCollectionPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const actorUserId = Number(req.user?.id || 0)
    if (Array.isArray((req.body as any)?.mappings)) {
      const items = await svc.replaceMappingsForAdmin(id, (req.body as any).mappings, actorUserId)
      return res.json({ items })
    }
    const item = await svc.upsertMappingForAdmin(id, req.body || {}, actorUserId)
    return res.status(201).json({ item })
  } catch (err) {
    return next(err)
  }
})

adminUserFacingRulesRouter.delete(mappingDetailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const mappingId = Number(req.params.mappingId)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    if (!Number.isFinite(mappingId) || mappingId <= 0) return res.status(400).json({ error: 'bad_mapping_id' })
    await svc.deleteMappingForAdmin(id, mappingId, Number(req.user?.id || 0))
    return res.status(204).send()
  } catch (err) {
    return next(err)
  }
})

