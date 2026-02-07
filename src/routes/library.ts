import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as librarySvc from '../features/library/service'
import { librarySourceOptions } from '../config/librarySources'

export const libraryRouter = Router()

libraryRouter.get('/api/library/source-orgs', requireAuth, async (_req, res) => {
  try {
    return res.json({ items: librarySourceOptions })
  } catch (err: any) {
    const status = err?.status || 500
    return res.status(status).json({ error: err?.code || 'failed_to_list', detail: String(err?.message || err) })
  }
})

libraryRouter.get('/api/library/videos', requireAuth, async (req, res) => {
  try {
    const { q, source_org, sourceOrg, limit } = req.query as any
    const data = await librarySvc.listSystemLibraryVideos(
      {
        q: q != null ? String(q) : undefined,
        sourceOrg: (sourceOrg != null ? String(sourceOrg) : source_org != null ? String(source_org) : undefined),
        limit: limit != null ? Number(limit) : undefined,
      },
      { userId: Number(req.user!.id) }
    )
    return res.json(data)
  } catch (err: any) {
    console.error('list library videos error', err)
    const status = err?.status || 500
    return res.status(status).json({ error: err?.code || 'failed_to_list', detail: String(err?.message || err) })
  }
})

libraryRouter.get('/api/library/videos/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const data = await librarySvc.getSystemLibraryVideo(id, { userId: Number(req.user!.id) })
    return res.json({ upload: data })
  } catch (err: any) {
    const status = err?.status || 500
    return res.status(status).json({ error: err?.code || 'failed_to_get', detail: String(err?.message || err) })
  }
})

libraryRouter.get('/api/library/videos/:id/captions', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const data = await librarySvc.getLibraryCaptions(id, { userId: Number(req.user!.id) })
    return res.json(data)
  } catch (err: any) {
    const status = err?.status || 500
    return res.status(status).json({ error: err?.code || 'failed_to_get', detail: String(err?.message || err) })
  }
})

libraryRouter.get('/api/library/videos/:id/search', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const q = String((req.query as any)?.q || '').trim()
    const limit = (req.query as any)?.limit
    const data = await librarySvc.searchLibraryTranscript(
      { uploadId: id, q, limit: limit != null ? Number(limit) : undefined },
      { userId: Number(req.user!.id) }
    )
    return res.json(data)
  } catch (err: any) {
    const status = err?.status || 500
    return res.status(status).json({ error: err?.code || 'failed_to_search', detail: String(err?.message || err) })
  }
})

libraryRouter.get('/api/library/clips', requireAuth, async (req, res) => {
  try {
    const { scope, upload_id, uploadId, q, limit } = req.query as any
    const data = await librarySvc.listLibraryClips(
      {
        scope: scope != null ? String(scope) as any : undefined,
        uploadId: uploadId != null ? Number(uploadId) : upload_id != null ? Number(upload_id) : undefined,
        q: q != null ? String(q) : undefined,
        limit: limit != null ? Number(limit) : undefined,
      },
      { userId: Number(req.user!.id) }
    )
    return res.json(data)
  } catch (err: any) {
    const status = err?.status || 500
    return res.status(status).json({ error: err?.code || 'failed_to_list', detail: String(err?.message || err) })
  }
})

libraryRouter.get('/api/library/clips/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const data = await librarySvc.getLibraryClip(id, { userId: Number(req.user!.id) })
    return res.json({ clip: data })
  } catch (err: any) {
    const status = err?.status || 500
    return res.status(status).json({ error: err?.code || 'failed_to_get', detail: String(err?.message || err) })
  }
})

libraryRouter.post('/api/library/clips', requireAuth, async (req, res) => {
  try {
    const body = (req.body || {}) as any
    const data = await librarySvc.createLibraryClip(
      {
        uploadId: Number(body.uploadId),
        title: body.title != null ? String(body.title) : undefined,
        description: body.description != null ? String(body.description) : undefined,
        startSeconds: Number(body.startSeconds),
        endSeconds: Number(body.endSeconds),
        isShared: body.isShared != null ? Boolean(body.isShared) : undefined,
        isSystem: body.isSystem != null ? Boolean(body.isSystem) : undefined,
      },
      { userId: Number(req.user!.id) }
    )
    return res.json(data)
  } catch (err: any) {
    const status = err?.status || 500
    return res.status(status).json({ error: err?.code || 'failed_to_create', detail: String(err?.message || err) })
  }
})
