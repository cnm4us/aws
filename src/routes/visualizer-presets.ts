import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as svc from '../features/visualizer-presets/service'

export const visualizerPresetsRouter = Router()

visualizerPresetsRouter.get('/api/visualizer-presets', requireAuth, async (req, res, next) => {
  try {
    const includeArchived = req.query?.include_archived === '1' || req.query?.include_archived === 'true'
    const limitRaw = req.query?.limit ? Number(req.query.limit) : undefined
    const limit = limitRaw != null && Number.isFinite(limitRaw) ? limitRaw : undefined
    const items = await svc.listForUser(Number(req.user!.id), { includeArchived, limit })
    res.json({ items })
  } catch (err: any) { next(err) }
})

visualizerPresetsRouter.post('/api/visualizer-presets', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {}
    const preset = await svc.createForUser({
      name: body.name,
      description: body.description,
      style: body.style,
      fgColor: body.fgColor,
      bgColor: body.bgColor,
      opacity: body.opacity,
      scale: body.scale,
      gradientEnabled: body.gradientEnabled,
      gradientStart: body.gradientStart,
      gradientEnd: body.gradientEnd,
      gradientMode: body.gradientMode,
      clipMode: body.clipMode,
      clipInsetPct: body.clipInsetPct,
      clipHeightPct: body.clipHeightPct,
    }, Number(req.user!.id))
    res.status(201).json({ preset })
  } catch (err: any) { next(err) }
})

visualizerPresetsRouter.get('/api/visualizer-presets/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const preset = await svc.getForUser(id, Number(req.user!.id))
    res.json({ preset })
  } catch (err: any) { next(err) }
})

async function handleUpdate(req: any, res: any, next: any) {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const body = req.body || {}
    const preset = await svc.updateForUser(id, {
      name: body.name,
      description: body.description,
      style: body.style,
      fgColor: body.fgColor,
      bgColor: body.bgColor,
      opacity: body.opacity,
      scale: body.scale,
      gradientEnabled: body.gradientEnabled,
      gradientStart: body.gradientStart,
      gradientEnd: body.gradientEnd,
      gradientMode: body.gradientMode,
      clipMode: body.clipMode,
      clipInsetPct: body.clipInsetPct,
      clipHeightPct: body.clipHeightPct,
    }, Number(req.user!.id))
    res.json({ preset })
  } catch (err: any) { next(err) }
}

visualizerPresetsRouter.patch('/api/visualizer-presets/:id', requireAuth, handleUpdate)
visualizerPresetsRouter.put('/api/visualizer-presets/:id', requireAuth, handleUpdate)

visualizerPresetsRouter.delete('/api/visualizer-presets/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const result = await svc.archiveForUser(id, Number(req.user!.id))
    res.json(result)
  } catch (err: any) { next(err) }
})
