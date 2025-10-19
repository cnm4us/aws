import { Router } from 'express'
import { z } from 'zod'
import { getPool } from '../db'
import { requireAuth } from '../middleware/auth'
import { can } from '../security/permissions'

const publishSingleRouter = Router()

const publishSchema = z.object({
  spaces: z.array(z.number().int().positive()).nonempty(),
})

publishSingleRouter.post('/api/uploads/:id/publish', requireAuth, async (req, res) => {
  try {
    const uploadId = Number(req.params.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return res.status(400).json({ error: 'bad_id' })

    const { spaces } = publishSchema.parse(req.body || {})
    if (!spaces.length) return res.status(400).json({ error: 'no_spaces' })

    const db = getPool()
    const [rows] = await db.query(`SELECT id, user_id FROM uploads WHERE id = ? LIMIT 1`, [uploadId])
    const upload = (rows as any[])[0]
    if (!upload) return res.status(404).json({ error: 'not_found' })

    const currentUserId = req.user!.id
    const ownerId = upload.user_id != null ? Number(upload.user_id) : null
    const allowedOwner = ownerId != null && (await can(currentUserId, 'video:publish_own', { ownerId }))
    const allowedAnySpace = await can(currentUserId, 'video:publish_space')

    if (!allowedOwner && !allowedAnySpace) {
      let allowed = false
      for (const spaceId of spaces) {
        const ok = await can(currentUserId, 'video:publish_space', { spaceId })
        if (ok) {
          allowed = true
          break
        }
      }
      if (!allowed) return res.status(403).json({ error: 'forbidden' })
    }

    const placeholders = spaces.map(() => '?').join(',')
    const [existingRows] = await db.query(
      `SELECT space_id, status FROM space_publications WHERE upload_id = ? AND space_id IN (${placeholders})`,
      [uploadId, ...spaces]
    )
    const existingMap = new Map<number, any>()
    for (const row of existingRows as any[]) {
      existingMap.set(Number(row.space_id), row)
    }

    const created: number[] = []
    const activated: number[] = []

    for (const spaceId of spaces) {
      const existing = existingMap.get(spaceId)
      if (!existing) {
        const [spaceRows] = await db.query(`SELECT id, type, settings FROM spaces WHERE id = ? LIMIT 1`, [spaceId])
        const space = (spaceRows as any[])[0]
        if (!space) continue
        const settings = typeof space.settings === 'string' ? JSON.parse(space.settings) : space.settings
        const requireApproval = Boolean(settings?.publishing?.requireApproval)
        const status = requireApproval ? 'pending' : 'published'
        const publishedAt = requireApproval ? null : new Date()
        await db.query(
          `INSERT INTO space_publications (upload_id, space_id, status, requested_by, approved_by, published_at)
           VALUES (?, ?, ?, ?, ?, ?)` ,
          [uploadId, spaceId, status, currentUserId, requireApproval ? null : currentUserId, publishedAt]
        )
        created.push(spaceId)
        continue
      }

      const currentStatus = String(existing.status || '')
      if (currentStatus === 'published') {
        activated.push(spaceId)
        continue
      }
      await db.query(
        `UPDATE space_publications
            SET status = 'published', approved_by = ?, published_at = NOW(), unpublished_at = NULL
          WHERE upload_id = ? AND space_id = ?`,
        [currentUserId, uploadId, spaceId]
      )
      activated.push(spaceId)
    }

    res.json({ ok: true, uploadId, created, activated })
  } catch (err: any) {
    console.error('publish upload to spaces failed', err)
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

    const db = getPool()
    const [rows] = await db.query(`SELECT id, user_id FROM uploads WHERE id = ? LIMIT 1`, [uploadId])
    const upload = (rows as any[])[0]
    if (!upload) return res.status(404).json({ error: 'not_found' })

    const currentUserId = req.user!.id
    const ownerId = upload.user_id != null ? Number(upload.user_id) : null

    for (const spaceId of spaces) {
      const allowedOwner = ownerId != null && (await can(currentUserId, 'video:unpublish_own', { ownerId }))
      const allowedSpace = await can(currentUserId, 'video:unpublish_space', { spaceId })
      const allowedAny = await can(currentUserId, 'video:delete_any')
      if (!allowedOwner && !allowedSpace && !allowedAny) {
        return res.status(403).json({ error: 'forbidden' })
      }
    }

    const placeholders = spaces.map(() => '?').join(',')
    await db.query(
      `UPDATE space_publications
          SET status = 'unpublished', unpublished_at = NOW()
        WHERE upload_id = ? AND space_id IN (${placeholders})`,
      [uploadId, ...spaces]
    )

    res.json({ ok: true, uploadId, spaces })
  } catch (err: any) {
    console.error('unpublish upload from spaces failed', err)
    res.status(500).json({ error: 'failed_to_unpublish_spaces', detail: String(err?.message || err) })
  }
})

export default publishSingleRouter
