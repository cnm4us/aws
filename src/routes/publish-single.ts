import { Router } from 'express'
import { z } from 'zod'
import { getPool } from '../db'
import { requireAuth } from '../middleware/auth'
import { can } from '../security/permissions'
import { PERM } from '../security/perm'
import * as pubsSvc from '../features/publications/service'
import { getLogger, logError } from '../lib/logger'

const publishSingleRouter = Router()
const publishSingleLogger = getLogger({ component: 'routes.publish_single' })

const publishSchema = z.object({
  spaces: z.array(z.number().int().positive()).nonempty(),
})

publishSingleRouter.post('/api/uploads/:id/publish', requireAuth, async (req, res) => {
  try {
    const uploadId = Number(req.params.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return res.status(400).json({ error: 'bad_id' })

    const { spaces } = publishSchema.parse(req.body || {})
    if (!spaces.length) return res.status(400).json({ error: 'no_spaces' })
    const currentUserId = Number(req.user!.id)
    const result = await pubsSvc.publishUploadToSpaces(uploadId, spaces, { userId: currentUserId })
    res.json(result)
  } catch (err: any) {
    logError(req.log || publishSingleLogger, err, 'publish_upload_to_spaces_failed', { path: req.path })
    res.status(500).json({ error: 'failed_to_publish_spaces', detail: String(err?.message || err) })
  }
})

const unpublishSchema = z.object({
  spaces: z.array(z.number().int().positive()).nonempty(),
})

publishSingleRouter.post('/api/uploads/:id/unpublish', requireAuth, async (req, res) => {
  try {
    const uploadId = Number(req.params.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return res.status(400).json({ error: 'bad_id' })

    const { spaces } = unpublishSchema.parse(req.body || {})
    if (!spaces.length) return res.status(400).json({ error: 'no_spaces' })
    const currentUserId = Number(req.user!.id)
    const result = await pubsSvc.unpublishUploadFromSpaces(uploadId, spaces, { userId: currentUserId })
    res.json(result)
  } catch (err: any) {
    logError(req.log || publishSingleLogger, err, 'unpublish_upload_from_spaces_failed', { path: req.path })
    res.status(500).json({ error: 'failed_to_unpublish_spaces', detail: String(err?.message || err) })
  }
})

export default publishSingleRouter
