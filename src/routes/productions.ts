import { Router } from 'express'
import { z } from 'zod'
import { getPool, type ProductionRow, type ProductionStatus } from '../db'
import { OUTPUT_BUCKET } from '../config'
import { startProductionRender } from '../services/productionRunner'
import { requireAuth } from '../middleware/auth'
import { can } from '../security/permissions'

const productionsRouter = Router()

const createProductionSchema = z.object({
  uploadId: z.number().int().positive(),
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
    const db = getPool()
    const currentUserId = req.user!.id
    const qUser = req.query.user_id ? Number(req.query.user_id) : currentUserId
    const isAdmin = await can(currentUserId, 'video:delete_any')
    if (!isAdmin && qUser !== currentUserId) {
      return res.status(403).json({ error: 'forbidden' })
    }
    const [rows] = await db.query(
      `SELECT p.*, u.original_filename, u.modified_filename, u.description AS upload_description,
              u.status AS upload_status, u.size_bytes, u.width, u.height, u.created_at AS upload_created_at
         FROM productions p
         JOIN uploads u ON u.id = p.upload_id
        WHERE p.user_id = ?
        ORDER BY p.created_at DESC
        LIMIT 200`,
      [qUser]
    )
    const list = (rows as any[]).map(mapProduction)
    res.json({ productions: list })
  } catch (err: any) {
    console.error('list productions failed', err)
    res.status(500).json({ error: 'failed_to_list_productions', detail: String(err?.message || err) })
  }
})

productionsRouter.get('/api/productions/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const db = getPool()
    const [rows] = await db.query(
      `SELECT p.*, u.original_filename, u.modified_filename, u.description AS upload_description,
              u.status AS upload_status, u.size_bytes, u.width, u.height, u.created_at AS upload_created_at
         FROM productions p
         JOIN uploads u ON u.id = p.upload_id
        WHERE p.id = ?
        LIMIT 1`,
      [id]
    )
    const row = (rows as any[])[0]
    if (!row) return res.status(404).json({ error: 'not_found' })
    const currentUserId = req.user!.id
    if (Number(row.user_id) !== currentUserId && !(await can(currentUserId, 'video:delete_any'))) {
      return res.status(403).json({ error: 'forbidden' })
    }
    res.json({ production: mapProduction(row) })
  } catch (err: any) {
    console.error('get production failed', err)
    res.status(500).json({ error: 'failed_to_get_production', detail: String(err?.message || err) })
  }
})

productionsRouter.post('/api/productions', requireAuth, async (req, res) => {
  try {
    const { uploadId, config, profile, quality, sound } = createProductionSchema.parse(req.body || {})
    const db = getPool()
    const [rows] = await db.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [uploadId])
    const upload = (rows as any[])[0]
    if (!upload) return res.status(404).json({ error: 'upload_not_found' })
    // Allow producing from fresh uploads and from previously completed uploads
    const upStatus = String(upload.status || '').toLowerCase()
    if (upStatus !== 'uploaded' && upStatus !== 'completed') {
      return res.status(400).json({ error: 'invalid_state', detail: 'upload not ready for production' })
    }

    const currentUserId = req.user!.id
    const ownerId = upload.user_id != null ? Number(upload.user_id) : null
    const isOwner = ownerId === currentUserId
    const canProduceAny = await can(currentUserId, 'video:delete_any')
    if (!isOwner && !canProduceAny) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const { jobId, outPrefix, productionId } = await startProductionRender({
      upload,
      userId: currentUserId,
      profile: profile ?? null,
      quality: quality ?? null,
      sound: sound ?? null,
      config,
    })

    const [detailRows] = await db.query(
      `SELECT p.*, u.original_filename, u.modified_filename, u.description AS upload_description,
              u.status AS upload_status, u.size_bytes, u.width, u.height, u.created_at AS upload_created_at
         FROM productions p
         JOIN uploads u ON u.id = p.upload_id
        WHERE p.id = ?
        LIMIT 1`,
      [productionId]
    )
    const detail = (detailRows as any[])[0]
    res.status(201).json({ production: mapProduction(detail), jobId, output: { bucket: OUTPUT_BUCKET, prefix: outPrefix } })
  } catch (err: any) {
    console.error('create production failed', err)
    res.status(500).json({ error: 'failed_to_create_production', detail: String(err?.message || err) })
  }
})

export default productionsRouter
