import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as audioConfigsSvc from '../features/audio-configs/service'

export const audioConfigsRouter = Router()

audioConfigsRouter.get('/api/audio-configs', requireAuth, async (req, res, next) => {
  try {
    const limitRaw = req.query?.limit ? Number(req.query.limit) : undefined
    const limit = limitRaw != null && Number.isFinite(limitRaw) ? limitRaw : undefined
    const items = await audioConfigsSvc.listAvailableForUser(Number(req.user!.id), { limit })
    res.json({ items })
  } catch (err: any) {
    next(err)
  }
})

