import { Router } from 'express'
import { z } from 'zod'
import * as prodSvc from '../features/productions/service'
import { requireAuth } from '../middleware/auth'

const productionsRouter = Router()

const createProductionSchema = z.object({
  uploadId: z.number().int().positive(),
  name: z.string().min(1).max(255).optional(),
  config: z.any().optional(),
  profile: z.string().optional(),
  quality: z.string().optional(),
  sound: z.string().optional(),
})

// legacy mapping helpers removed; routes delegate to productions service

productionsRouter.get('/api/productions', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.user!.id
    const qUser = req.query.user_id ? Number(req.query.user_id) : currentUserId
    const productions = await prodSvc.list(currentUserId, qUser)
    res.json({ productions })
  } catch (err: any) {
    console.error('list productions failed', err)
    const code = err?.code || 'failed_to_list_productions'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})

productionsRouter.get('/api/productions/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const currentUserId = req.user!.id
    const production = await prodSvc.get(id, currentUserId)
    res.json({ production })
  } catch (err: any) {
    console.error('get production failed', err)
    const code = err?.code || 'failed_to_get_production'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})

productionsRouter.post('/api/productions', requireAuth, async (req, res) => {
  try {
    const { uploadId, name, config, profile, quality, sound } = createProductionSchema.parse(req.body || {})
    const currentUserId = req.user!.id
    const result = await prodSvc.create({ uploadId, name, config, profile, quality, sound }, currentUserId)
    res.status(201).json(result)
  } catch (err: any) {
    console.error('create production failed', err)
    const code = err?.code || 'failed_to_create_production'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})

export default productionsRouter
