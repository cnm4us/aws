import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as uploadsSvc from '../features/uploads/service'
import { clampLimit, parseNumberCursor } from '../core/pagination'
import * as audioTagsSvc from '../features/audio-tags/service'

export const uploadsRouter = Router();

uploadsRouter.get('/api/uploads', async (req, res) => {
  try {
    const { status, kind, image_role, limit, cursor, user_id, space_id, include_publications, include_productions } = req.query as any
    const includePubs = include_publications === '1' || include_publications === 'true'
    const includeProds = include_productions === '1' || include_productions === 'true'
    const lim = clampLimit(limit, 50, 1, 500)
    const curId = parseNumberCursor(cursor) ?? undefined
    const result = await uploadsSvc.list({
      status: status ? String(status) : undefined,
      kind: kind ? (String(kind).toLowerCase() as any) : undefined,
      imageRole: image_role ? String(image_role).trim().toLowerCase() : undefined,
      userId: user_id ? Number(user_id) : undefined,
      spaceId: space_id ? Number(space_id) : undefined,
      cursorId: curId,
      limit: lim,
      includePublications: includePubs,
      includeProductions: includeProds,
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
    const includeProductions = req.query?.include_productions === '1' || req.query?.include_productions === 'true'
    const data = await uploadsSvc.get(id, { includePublications, includeProductions }, { userId: (req as any).user?.id ? Number((req as any).user.id) : undefined })
    return res.json(data)
  } catch (err: any) {
    console.error('get upload error', err)
    const status = err?.status || 500
    res.status(status).json({ error: 'failed_to_get', detail: String(err?.message || err) })
  }
})

uploadsRouter.get('/api/system-audio', requireAuth, async (req, res) => {
  try {
    const { limit, cursor } = req.query as any
    const lim = clampLimit(limit, 50, 1, 200)
    const curId = parseNumberCursor(cursor) ?? undefined
    const data = await uploadsSvc.listSystemAudio(
      { cursorId: curId, limit: lim },
      { userId: Number(req.user!.id) }
    )
    return res.json(data)
  } catch (err: any) {
    console.error('list system audio error', err)
    const status = err?.status || 500
    res.status(status).json({ error: 'failed_to_list', detail: String(err?.message || err) })
  }
})

uploadsRouter.get('/api/audio-tags', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user!.id)
    const data = await audioTagsSvc.listActiveTagsDto({ userId })
    return res.json(data)
  } catch (err: any) {
    console.error('list audio tags error', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_list', detail: String(err?.message || err) })
  }
})

// Authenticated file access for private upload objects (used for logo thumbnails, etc.)
uploadsRouter.get('/api/uploads/:id/file', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('bad_id')
    const range = typeof req.headers.range === 'string' ? String(req.headers.range) : undefined
    const { contentType, body, contentLength, contentRange } = await uploadsSvc.getUploadFileStream(
      id,
      { range },
      { userId: Number(req.user!.id) }
    )
    res.set('Cache-Control', 'no-store')
    res.set('Accept-Ranges', 'bytes')
    if (contentType) res.set('Content-Type', contentType)
    if (contentRange) {
      res.status(206)
      res.set('Content-Range', contentRange)
      if (contentLength != null && Number.isFinite(contentLength)) res.set('Content-Length', String(contentLength))
    } else {
      if (contentLength != null && Number.isFinite(contentLength)) res.set('Content-Length', String(contentLength))
    }
    // Body is a readable stream (Node) in AWS SDK v3
    return (body as any).pipe(res)
  } catch (err: any) {
    const status = err?.status || 500
    if (status === 403) return res.status(403).send('forbidden')
    if (status === 404) return res.status(404).send('not_found')
    console.error('upload file fetch failed', err)
    return res.status(status).send('failed')
  }
})

uploadsRouter.get('/api/uploads/:id/thumb', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('bad_id')
    const { contentType, body, contentLength } = await uploadsSvc.getUploadThumbStream(
      id,
      { userId: Number(req.user!.id) }
    )
    res.set('Cache-Control', 'no-store')
    if (contentType) res.set('Content-Type', contentType)
    if (contentLength != null && Number.isFinite(contentLength)) res.set('Content-Length', String(contentLength))
    return (body as any).pipe(res)
  } catch (err: any) {
    const status = err?.status || 500
    if (status === 403) return res.status(403).send('forbidden')
    if (status === 404) return res.status(404).send('not_found')
    console.error('upload thumb fetch failed', err)
    return res.status(status).send('failed')
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

uploadsRouter.patch('/api/uploads/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const currentUserId = Number(req.user!.id)
    const body = (req.body || {}) as any
    const result = await uploadsSvc.updateMetadata(
      id,
      {
        modifiedFilename: body.modified_filename ?? body.modifiedFilename ?? undefined,
        description: body.description ?? undefined,
      },
      { userId: currentUserId }
    )
    return res.json(result)
  } catch (err: any) {
    console.error('update upload error', err)
    const status = err?.status || 500
    const code = err?.code || 'failed_to_update'
    res.status(status).json({ error: code, detail: err?.detail ?? String(err?.message || err) })
  }
})

uploadsRouter.post('/api/uploads/:id/delete-source', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const currentUserId = Number(req.user!.id)
    const result = await uploadsSvc.deleteSourceVideo(id, currentUserId)
    res.json(result)
  } catch (err: any) {
    console.error('delete source upload error', err)
    const status = err?.status || 500
    const code = err?.code || 'failed_to_delete_source'
    res.status(status).json({ error: code, detail: err?.detail ?? String(err?.message || err) })
  }
})
