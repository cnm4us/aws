import { Router } from 'express'
import { z } from 'zod'
import { getPool, type ProductionRow, type ProductionStatus } from '../db'
import { OUTPUT_BUCKET } from '../config'
import * as prodSvc from '../features/productions/service'
import { requireAuth } from '../middleware/auth'
import { can } from '../security/permissions'

const productionsRouter = Router()

const createProductionSchema = z.object({
  uploadId: z.number().int().positive(),
  name: z.string().min(1).max(255).optional(),
  config: z.any().optional(),
  profile: z.string().optional(),
  quality: z.string().optional(),
  sound: z.string().optional(),
})

type ProductionRecord = ProductionRow & {
  upload?: {
    id: number
    original_filename: string
    modified_filename: string
    description: string | null
    status: string
    size_bytes: number | null
    width: number | null
    height: number | null
    created_at: string
  }
}

function mapProduction(row: any): ProductionRecord {
  return {
    id: Number(row.id),
    upload_id: Number(row.upload_id),
    user_id: Number(row.user_id),
    name: row.name ? String(row.name) : null,
    status: row.status as ProductionStatus,
    config: row.config ? safeJson(row.config) : null,
    output_prefix: row.output_prefix ? String(row.output_prefix) : null,
    mediaconvert_job_id: row.mediaconvert_job_id ? String(row.mediaconvert_job_id) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    created_at: String(row.created_at),
    started_at: row.started_at ? String(row.started_at) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    upload: row.upload_id
      ? {
          id: Number(row.upload_id),
          original_filename: row.original_filename ? String(row.original_filename) : '',
          modified_filename: row.modified_filename
            ? String(row.modified_filename)
            : row.original_filename
              ? String(row.original_filename)
              : '',
          description: row.upload_description != null ? String(row.upload_description) : null,
          status: row.upload_status ? String(row.upload_status) : '',
          size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
          width: row.width != null ? Number(row.width) : null,
          height: row.height != null ? Number(row.height) : null,
          created_at: row.upload_created_at ? String(row.upload_created_at) : '',
        }
      : undefined,
  }
}

function safeJson(input: any) {
  if (!input) return null
  if (typeof input === 'object') return input
  try {
    return JSON.parse(String(input))
  } catch {
    return null
  }
}

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
