import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as lowerThirdsSvc from '../features/lower-thirds/service'

export const lowerThirdsRouter = Router()

lowerThirdsRouter.get('/api/lower-third-templates', requireAuth, async (req, res, next) => {
  try {
    const includeArchived = req.query?.include_archived === '1' || req.query?.include_archived === 'true'
    const items = await lowerThirdsSvc.listTemplatesForUser(Number(req.user!.id), { includeArchived })
    res.json({ items })
  } catch (err: any) {
    next(err)
  }
})

lowerThirdsRouter.get('/api/lower-third-configs', requireAuth, async (req, res, next) => {
  try {
    const includeArchived = req.query?.include_archived === '1' || req.query?.include_archived === 'true'
    const limitRaw = req.query?.limit ? Number(req.query.limit) : undefined
    const limit = limitRaw != null && Number.isFinite(limitRaw) ? limitRaw : undefined
    const items = await lowerThirdsSvc.listConfigsForUser(Number(req.user!.id), { includeArchived, limit })
    res.json({ items })
  } catch (err: any) {
    next(err)
  }
})

lowerThirdsRouter.post('/api/lower-third-configs', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {}
    const config = await lowerThirdsSvc.createConfigForUser(
      {
        name: body.name,
        templateKey: body.templateKey,
        templateVersion: body.templateVersion,
        params: body.params,
        timingRule: body.timingRule,
        timingSeconds: body.timingSeconds,
      },
      Number(req.user!.id)
    )
    res.status(201).json({ config })
  } catch (err: any) {
    next(err)
  }
})

lowerThirdsRouter.get('/api/lower-third-configs/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const config = await lowerThirdsSvc.getConfigForUser(id, Number(req.user!.id))
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
    const config = await lowerThirdsSvc.updateConfigForUser(
      id,
      { name: body.name, params: body.params, timingRule: body.timingRule, timingSeconds: body.timingSeconds },
      Number(req.user!.id)
    )
    res.json({ config })
  } catch (err: any) {
    next(err)
  }
}

lowerThirdsRouter.patch('/api/lower-third-configs/:id', requireAuth, handleUpdate)
lowerThirdsRouter.put('/api/lower-third-configs/:id', requireAuth, handleUpdate)

lowerThirdsRouter.delete('/api/lower-third-configs/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const result = await lowerThirdsSvc.archiveConfigForUser(id, Number(req.user!.id))
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

lowerThirdsRouter.post('/api/lower-third-templates/resolve', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {}
    const result = await lowerThirdsSvc.resolveLowerThirdSvgForUser(
      { presetId: body.presetId, templateKey: body.templateKey, templateVersion: body.templateVersion, params: body.params },
      Number(req.user!.id)
    )
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})
