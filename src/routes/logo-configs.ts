import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as logoConfigsSvc from '../features/logo-configs/service'

export const logoConfigsRouter = Router()

logoConfigsRouter.get('/api/logo-configs', requireAuth, async (req, res, next) => {
  try {
    const includeArchived = req.query?.include_archived === '1' || req.query?.include_archived === 'true'
    const limitRaw = req.query?.limit ? Number(req.query.limit) : undefined
    const limit = limitRaw != null && Number.isFinite(limitRaw) ? limitRaw : undefined
    const rows = await logoConfigsSvc.listForUser(Number(req.user!.id), { includeArchived, limit })
    res.json(rows)
  } catch (err: any) {
    next(err)
  }
})

logoConfigsRouter.post('/api/logo-configs', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {}
    const config = await logoConfigsSvc.createForUser({
      name: body.name,
      position: body.position,
      sizePctWidth: body.sizePctWidth,
      opacityPct: body.opacityPct,
      timingRule: body.timingRule,
      timingSeconds: body.timingSeconds,
      fade: body.fade,
    }, Number(req.user!.id))
    res.status(201).json({ config })
  } catch (err: any) {
    next(err)
  }
})

logoConfigsRouter.get('/api/logo-configs/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const config = await logoConfigsSvc.getForUser(id, Number(req.user!.id))
    res.json({ config })
  } catch (err: any) {
    next(err)
  }
})

async function handleUpdate(req: any, res: any, next: any) {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const body = req.body || {}
    const config = await logoConfigsSvc.updateForUser(id, {
      name: body.name,
      position: body.position,
      sizePctWidth: body.sizePctWidth,
      opacityPct: body.opacityPct,
      timingRule: body.timingRule,
      timingSeconds: body.timingSeconds,
      fade: body.fade,
    }, Number(req.user!.id))
    res.json({ config })
  } catch (err: any) {
    next(err)
  }
}

logoConfigsRouter.patch('/api/logo-configs/:id', requireAuth, handleUpdate)
logoConfigsRouter.put('/api/logo-configs/:id', requireAuth, handleUpdate)

logoConfigsRouter.post('/api/logo-configs/:id/duplicate', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const config = await logoConfigsSvc.duplicateForUser(id, Number(req.user!.id))
    res.status(201).json({ config })
  } catch (err: any) {
    next(err)
  }
})

logoConfigsRouter.delete('/api/logo-configs/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const result = await logoConfigsSvc.archiveForUser(id, Number(req.user!.id))
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})
