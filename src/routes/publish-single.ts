import { Router } from 'express'
import { z } from 'zod'
import { getPool } from '../db'
import { requireAuth } from '../middleware/auth'
import { can } from '../security/permissions'
import { PERM } from '../security/perm'

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
    const allowedOwner = ownerId != null && (await can(currentUserId, PERM.VIDEO_PUBLISH_OWN, { ownerId }))
    const allowedAnySpace = await can(currentUserId, PERM.VIDEO_PUBLISH_SPACE)

    if (!allowedOwner && !allowedAnySpace) {
      let allowed = false
      for (const spaceId of spaces) {
        const ok = await can(currentUserId, PERM.VIDEO_PUBLISH_SPACE, { spaceId })
        if (ok) {
          allowed = true
          break
        }
      }
      if (!allowed) return res.status(403).json({ error: 'forbidden' })
    }

    const created: number[] = []
    const activated: number[] = []

    // Fetch site review requirements once for efficiency
    let siteRequireGroup = false
    let siteRequireChannel = false
    try {
      const [siteRows] = await db.query(`SELECT require_group_review, require_channel_review FROM site_settings WHERE id = 1 LIMIT 1`)
      const site = (siteRows as any[])[0]
      if (site) {
        siteRequireGroup = Boolean(Number(site.require_group_review))
        siteRequireChannel = Boolean(Number(site.require_channel_review))
      }
    } catch {}

    for (const spaceId of spaces) {
        const [spaceRows] = await db.query(`SELECT id, type, settings FROM spaces WHERE id = ? LIMIT 1`, [spaceId])
        const space = (spaceRows as any[])[0]
        if (!space) continue
        const settings = typeof space.settings === 'string' ? JSON.parse(space.settings) : space.settings
        // Effective require = site(type) OR space.publishing.requireApproval (fallback: group=false, channel=true)
        const spaceReq = settings?.publishing && typeof settings.publishing === 'object' && typeof settings.publishing.requireApproval === 'boolean'
          ? Boolean(settings.publishing.requireApproval)
          : (String(space.type) === 'channel')
        const requireApproval = (String(space.type) === 'group' ? siteRequireGroup : String(space.type) === 'channel' ? siteRequireChannel : false) || spaceReq
        const status = requireApproval ? 'pending' : 'published'
        const publishedAt = requireApproval ? null : new Date()
        // Visibility flags
        const isPersonal = String(space.type) === 'personal'
        const visibleInSpace = 1
        const visibleInGlobal = isPersonal ? 1 : 0
        // Best-effort: pick latest completed production for this upload (optional)
        let productionId: number | null = null
        try {
          const [pRows] = await db.query(
            `SELECT id FROM productions WHERE upload_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1`,
            [uploadId]
          )
          const prow = (pRows as any[])[0]
          if (prow) productionId = Number(prow.id)
        } catch {}
        // Determine comments_enabled default based on space policy
        let commentsEnabled: number | null = null
        try {
          const cp = (settings && settings.comments) ? String(settings.comments).toLowerCase() : 'on'
          if (cp === 'off') commentsEnabled = 0
          else {
            const [uRows] = await db.query(`SELECT default_comments_enabled FROM users WHERE id = ? LIMIT 1`, [currentUserId])
            const u = (uRows as any[])[0]
            commentsEnabled = u && u.default_comments_enabled != null ? Number(u.default_comments_enabled) : 1
          }
        } catch { commentsEnabled = 1 }
        // If the same production is already present in this space, apply republish rules; otherwise insert new
        let existsForProduction: any = null
        if (productionId != null) {
          const [eRows] = await db.query(`SELECT id, status FROM space_publications WHERE production_id = ? AND space_id = ? LIMIT 1`, [productionId, spaceId])
          existsForProduction = (eRows as any[])[0] || null
        }
        if (!existsForProduction) {
          await db.query(
            `INSERT INTO space_publications (upload_id, production_id, space_id, status, requested_by, approved_by, published_at, comments_enabled, owner_user_id, visible_in_space, visible_in_global)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
            [uploadId, productionId, spaceId, status, currentUserId, requireApproval ? null : currentUserId, publishedAt, commentsEnabled, ownerId, visibleInSpace, visibleInGlobal]
          )
          created.push(spaceId)
        } else {
          const pubId = Number(existsForProduction.id)
          const curStatus = String(existsForProduction.status || '')
          if (curStatus === 'published' || curStatus === 'approved' || curStatus === 'pending') {
            // Already active or in review — treat as activated
            activated.push(spaceId)
          } else if (curStatus === 'unpublished') {
            // Republish path
            const allowedAny = await can(currentUserId, PERM.VIDEO_DELETE_ANY)
            const allowedSpace = await can(currentUserId, PERM.VIDEO_PUBLISH_SPACE, { spaceId })
            if (allowedAny || allowedSpace) {
              await db.query(
                `UPDATE space_publications
                    SET status = 'published', approved_by = ?, published_at = NOW(), unpublished_at = NULL
                  WHERE id = ?`,
                [currentUserId, pubId]
              )
              // Log event
              try { await db.query(`INSERT INTO space_publication_events (publication_id, actor_user_id, action) VALUES (?, ?, 'moderator_republish_published')`, [pubId, currentUserId]) } catch {}
              activated.push(spaceId)
            } else if (ownerId != null && ownerId === currentUserId && (await can(currentUserId, PERM.VIDEO_PUBLISH_OWN, { ownerId }))) {
              // Owner path requires last-actor owner unpublish
              let lastOwner = false
              try {
                const [ev] = await db.query(`SELECT actor_user_id FROM space_publication_events WHERE publication_id = ? AND action = 'unpublish_publication' ORDER BY id DESC LIMIT 1`, [pubId])
                const row = (ev as any[])[0]
                lastOwner = row && row.actor_user_id != null && Number(row.actor_user_id) === currentUserId
              } catch {}
              if (!lastOwner) {
                return res.status(403).json({ error: 'forbidden' })
              }
              if (requireApproval) {
                await db.query(
                  `UPDATE space_publications
                      SET status = 'pending', approved_by = NULL, published_at = NULL, unpublished_at = NULL
                    WHERE id = ?`,
                  [pubId]
                )
                try { await db.query(`INSERT INTO space_publication_events (publication_id, actor_user_id, action) VALUES (?, ?, 'owner_republish_requested')`, [pubId, currentUserId]) } catch {}
              } else {
                await db.query(
                  `UPDATE space_publications
                      SET status = 'published', approved_by = ?, published_at = NOW(), unpublished_at = NULL
                    WHERE id = ?`,
                  [currentUserId, pubId]
                )
                try { await db.query(`INSERT INTO space_publication_events (publication_id, actor_user_id, action) VALUES (?, ?, 'owner_republish_published')`, [pubId, currentUserId]) } catch {}
              }
              activated.push(spaceId)
            } else {
              return res.status(403).json({ error: 'forbidden' })
            }
          } else if (curStatus === 'rejected') {
            // Owner cannot republish rejected; moderators/admins can
            const allowedAny = await can(currentUserId, PERM.VIDEO_DELETE_ANY)
            const allowedSpace = await can(currentUserId, PERM.VIDEO_PUBLISH_SPACE, { spaceId })
            if (!allowedAny && !allowedSpace) {
              return res.status(403).json({ error: 'forbidden' })
            }
            await db.query(
              `UPDATE space_publications
                  SET status = 'published', approved_by = ?, published_at = NOW(), unpublished_at = NULL
                WHERE id = ?`,
              [currentUserId, pubId]
            )
            try { await db.query(`INSERT INTO space_publication_events (publication_id, actor_user_id, action) VALUES (?, ?, 'moderator_republish_published')`, [pubId, currentUserId]) } catch {}
            activated.push(spaceId)
          } else {
            // Unknown state: do nothing
            activated.push(spaceId)
          }
        }
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
      const allowedOwner = ownerId != null && (await can(currentUserId, PERM.VIDEO_UNPUBLISH_OWN, { ownerId }))
      const allowedSpace = await can(currentUserId, PERM.VIDEO_UNPUBLISH_SPACE, { spaceId })
      const allowedAny = await can(currentUserId, PERM.VIDEO_DELETE_ANY)
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
