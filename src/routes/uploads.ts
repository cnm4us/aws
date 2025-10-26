import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as uploadsSvc from '../features/uploads/service'
import { clampLimit, parseNumberCursor } from '../core/pagination'

export const uploadsRouter = Router();

uploadsRouter.get('/api/uploads', async (req, res) => {
  try {
    const { status, limit, cursor, user_id, space_id, include_publications } = req.query as any
    const includePubs = include_publications === '1' || include_publications === 'true'
    const lim = clampLimit(limit, 50, 1, 500)
    const curId = parseNumberCursor(cursor) ?? undefined
    const result = await uploadsSvc.list({
      status: status ? String(status) : undefined,
      userId: user_id ? Number(user_id) : undefined,
      spaceId: space_id ? Number(space_id) : undefined,
      cursorId: curId,
      limit: lim,
      includePublications: includePubs,
    }, { userId: (req as any).user?.id ? Number((req as any).user.id) : undefined })
    return res.json(result)
  } catch (err: any) {
    console.error('list uploads error', err)
    const status = err?.status || 500
    res.status(status).json({ error: 'failed_to_list', detail: String(err?.message || err) })
  }
})

uploadsRouter.get('/api/uploads/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const includePublications = req.query?.include_publications === '1' || req.query?.include_publications === 'true'
    const data = await uploadsSvc.get(id, { includePublications }, { userId: (req as any).user?.id ? Number((req as any).user.id) : undefined })
    return res.json(data)
  } catch (err: any) {
    console.error('get upload error', err)
    const status = err?.status || 500
    res.status(status).json({ error: 'failed_to_get', detail: String(err?.message || err) })
  }
})

uploadsRouter.get('/api/uploads/:id/publish-options', requireAuth, async (req, res) => {
  try {
    const uploadId = Number(req.params.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return res.status(400).json({ error: 'bad_id' })
    const data = await uploadsSvc.getPublishOptions(uploadId, { userId: Number(req.user!.id) })
    res.json(data)
  } catch (err: any) {
    console.error('publish options failed', err)
    const status = err?.status || 500
    res.status(status).json({ error: 'failed_to_fetch_options', detail: String(err?.message || err) })
  }
})

uploadsRouter.delete('/api/uploads/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!id) return res.status(400).json({ error: 'bad_request' })
    const currentUserId = Number(req.user!.id)
    const result = await uploadsSvc.remove(id, currentUserId)
    res.json(result)
  } catch (err: any) {
    console.error('delete upload error', err)
    const status = err?.status || 500
    const code = err?.code || 'failed_to_delete'
    res.status(status).json({ error: code, detail: err?.detail ?? String(err?.message || err) })
  }
});
