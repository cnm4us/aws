import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as messageCtasSvc from '../features/message-cta-definitions/service'

export const adminMessageCtasRouter = Router()

const collectionPaths = ['/api/admin/message-ctas']
const detailPaths = ['/api/admin/message-ctas/:id']
const clonePaths = ['/api/admin/message-ctas/:id/clone']
const archivePaths = ['/api/admin/message-ctas/:id/archive']

adminMessageCtasRouter.use(collectionPaths, requireAuth)
adminMessageCtasRouter.use(detailPaths, requireAuth)
adminMessageCtasRouter.use(clonePaths, requireAuth)
adminMessageCtasRouter.use(archivePaths, requireAuth)

adminMessageCtasRouter.get(collectionPaths, async (req, res, next) => {
  try {
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const limitRaw = req.query?.limit ? Number(req.query.limit) : undefined
    const scopeSpaceIdRaw = req.query?.scope_space_id != null && String(req.query.scope_space_id).trim() !== ''
      ? Number(req.query.scope_space_id)
      : null

    const items = await messageCtasSvc.listMessageCtaDefinitionsForAdmin({
      actorUserId: Number(req.user?.id || 0),
      includeArchived,
      limit: limitRaw,
      status: req.query?.status as any,
      scopeType: req.query?.scope_type as any,
      scopeSpaceId: Number.isFinite(scopeSpaceIdRaw as number) ? scopeSpaceIdRaw : null,
      intentKey: req.query?.intent_key as any,
      executorType: req.query?.executor_type as any,
    })

    return res.json({ items })
  } catch (err) {
    return next(err)
  }
})

adminMessageCtasRouter.post(collectionPaths, async (req, res, next) => {
  try {
    const item = await messageCtasSvc.createMessageCtaDefinitionForAdmin(req.body || {}, Number(req.user?.id || 0))
    return res.status(201).json({ item })
  } catch (err) {
    return next(err)
  }
})

adminMessageCtasRouter.get(detailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const item = await messageCtasSvc.getMessageCtaDefinitionForAdmin(id, Number(req.user?.id || 0))
    return res.json({ item })
  } catch (err) {
    return next(err)
  }
})

adminMessageCtasRouter.patch(detailPaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const item = await messageCtasSvc.updateMessageCtaDefinitionForAdmin(id, req.body || {}, Number(req.user?.id || 0))
    return res.json({ item })
  } catch (err) {
    return next(err)
  }
})

adminMessageCtasRouter.post(clonePaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const item = await messageCtasSvc.cloneMessageCtaDefinitionForAdmin(id, Number(req.user?.id || 0))
    return res.status(201).json({ item })
  } catch (err) {
    return next(err)
  }
})

adminMessageCtasRouter.post(archivePaths, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const item = await messageCtasSvc.archiveMessageCtaDefinitionForAdmin(id, Number(req.user?.id || 0))
    return res.json({ item })
  } catch (err) {
    return next(err)
  }
})
