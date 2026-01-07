import { Router } from 'express'
import { z } from 'zod'
import * as prodSvc from '../features/productions/service'
import { requireAuth } from '../middleware/auth'

const productionsRouter = Router()

const createProductionSchema = z.object({
  uploadId: z.number().int().positive(),
  name: z.string().min(1).max(255).optional(),
  config: z.any().optional(),
  // Optional future enhancements (stored in production config; not yet used by renderer)
  musicUploadId: z.union([z.number().int().positive(), z.null()]).optional(),
  logoUploadId: z.union([z.number().int().positive(), z.null()]).optional(),
  logoConfigId: z.union([z.number().int().positive(), z.null()]).optional(),
  audioConfigId: z.union([z.number().int().positive(), z.null()]).optional(),
  lowerThirdUploadId: z.union([z.number().int().positive(), z.null()]).optional(),
  lowerThirdConfigId: z.union([z.number().int().positive(), z.null()]).optional(),
  profile: z.string().optional(),
  quality: z.string().optional(),
  sound: z.string().optional(),
})

// legacy mapping helpers removed; routes delegate to productions service

productionsRouter.get('/api/productions', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = req.user!.id
    const qUser = req.query.user_id ? Number(req.query.user_id) : currentUserId
    const productions = await prodSvc.list(currentUserId, qUser)
    res.json({ productions })
  } catch (err: any) { next(err) }
})

productionsRouter.get('/api/productions/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const currentUserId = req.user!.id
    const production = await prodSvc.get(id, currentUserId)
    res.json({ production })
  } catch (err: any) { next(err) }
})

productionsRouter.post('/api/productions', requireAuth, async (req, res, next) => {
  try {
    const parsed = createProductionSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const { uploadId, name, config, musicUploadId, logoUploadId, logoConfigId, audioConfigId, lowerThirdUploadId, lowerThirdConfigId, profile, quality, sound } = parsed.data
    const currentUserId = req.user!.id
    const result = await prodSvc.create(
      { uploadId, name, config, musicUploadId, logoUploadId, logoConfigId, audioConfigId, lowerThirdUploadId, lowerThirdConfigId, profile, quality, sound },
      currentUserId
    )
    res.status(201).json(result)
  } catch (err: any) { next(err) }
})

productionsRouter.delete('/api/productions/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const currentUserId = req.user!.id
    const result = await prodSvc.remove(id, currentUserId)
    res.json(result)
  } catch (err: any) { next(err) }
})

export default productionsRouter
