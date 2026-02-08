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

uploadsRouter.get('/api/uploads/summary', requireAuth, async (req, res) => {
  try {
    const raw = String((req.query as any)?.ids || '').trim()
    if (!raw) return res.json({ items: [] })
    const ids = raw
      .split(',')
      .map((s) => Number(String(s).trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (!ids.length) return res.json({ items: [] })
    const uniq = Array.from(new Set(ids)).slice(0, 50)
    const data = await uploadsSvc.listSummariesByIds(
      { ids: uniq },
      { userId: Number(req.user!.id) }
    )
    return res.json(data)
  } catch (err: any) {
    console.error('list upload summaries error', err)
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

function parseIdList(raw: any): number[] {
  const s = raw == null ? '' : String(raw)
  if (!s.trim()) return []
  const parts = s
    .split(',')
    .map((p) => Number(String(p).trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return Array.from(new Set(parts)).slice(0, 50)
}

uploadsRouter.get('/api/system-audio/search', requireAuth, async (req, res) => {
  try {
    const { limit, cursor, genreTagIds, moodTagIds, themeTagIds, instrumentTagIds, favorite_only } = req.query as any
    const lim = clampLimit(limit, 50, 1, 200)
    const curId = parseNumberCursor(cursor) ?? undefined
    const data = await uploadsSvc.searchSystemAudioByTags(
      {
        limit: lim,
        cursorId: curId,
        genreTagIds: parseIdList(genreTagIds),
        moodTagIds: parseIdList(moodTagIds),
        themeTagIds: parseIdList(themeTagIds),
        instrumentTagIds: parseIdList(instrumentTagIds),
        favoriteOnly: favorite_only === '1' || favorite_only === 'true',
      },
      { userId: Number(req.user!.id) }
    )
    return res.json({ items: data })
  } catch (err: any) {
    console.error('search system audio error', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_search', detail: String(err?.message || err) })
  }
})

uploadsRouter.post('/api/system-audio/:id/favorite', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user!.id)
    const uploadId = Number(req.params.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return res.status(400).json({ error: 'bad_id' })
    const favorite = Boolean((req.body || {})?.favorite)
    const result = await uploadsSvc.setSystemAudioFavorite({ uploadId, favorite }, { userId })
    return res.json(result)
  } catch (err: any) {
    console.error('toggle system audio favorite error', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_favorite', detail: String(err?.message || err) })
  }
})

// Plan 78: video library (source videos only) with per-user favorites + recents
uploadsRouter.get('/api/assets/videos', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user!.id)
    const { q, sort, favorites_only, include_recent, limit } = req.query as any
    const data = await uploadsSvc.listUserVideoAssets(
      {
        q: q != null ? String(q) : undefined,
        sort: sort != null ? String(sort) : undefined,
        favoritesOnly: favorites_only === '1' || favorites_only === 'true',
        includeRecent: include_recent === '1' || include_recent === 'true',
        limit: limit != null ? Number(limit) : undefined,
      },
      { userId }
    )
    return res.json(data)
  } catch (err: any) {
    console.error('list video assets error', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_list', detail: String(err?.message || err) })
  }
})

uploadsRouter.post('/api/assets/videos/:id/favorite', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user!.id)
    const uploadId = Number(req.params.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return res.status(400).json({ error: 'bad_id' })
    const favorite = Boolean((req.body || {})?.favorite)
    const data = await uploadsSvc.setVideoAssetFavorite({ uploadId, favorite }, { userId })
    return res.json(data)
  } catch (err: any) {
    console.error('favorite video asset error', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_favorite', detail: String(err?.message || err) })
  }
})

uploadsRouter.post('/api/assets/videos/:id/used', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user!.id)
    const uploadId = Number(req.params.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return res.status(400).json({ error: 'bad_id' })
    const data = await uploadsSvc.markVideoAssetUsed({ uploadId }, { userId })
    return res.json(data)
  } catch (err: any) {
    console.error('mark video used error', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_mark_used', detail: String(err?.message || err) })
  }
})

// Plan 78: graphics library (overlay images) with per-user favorites + recents
uploadsRouter.get('/api/assets/graphics', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user!.id)
    const { q, sort, favorites_only, include_recent, limit } = req.query as any
    const data = await uploadsSvc.listUserGraphicAssets(
      {
        q: q != null ? String(q) : undefined,
        sort: sort != null ? String(sort) : undefined,
        favoritesOnly: favorites_only === '1' || favorites_only === 'true',
        includeRecent: include_recent === '1' || include_recent === 'true',
        limit: limit != null ? Number(limit) : undefined,
      },
      { userId }
    )
    return res.json(data)
  } catch (err: any) {
    console.error('list graphic assets error', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_list', detail: String(err?.message || err) })
  }
})

uploadsRouter.post('/api/assets/graphics/:id/favorite', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user!.id)
    const uploadId = Number(req.params.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return res.status(400).json({ error: 'bad_id' })
    const favorite = Boolean((req.body || {})?.favorite)
    const data = await uploadsSvc.setGraphicAssetFavorite({ uploadId, favorite }, { userId })
    return res.json(data)
  } catch (err: any) {
    console.error('favorite graphic asset error', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_favorite', detail: String(err?.message || err) })
  }
})

uploadsRouter.post('/api/assets/graphics/:id/used', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user!.id)
    const uploadId = Number(req.params.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return res.status(400).json({ error: 'bad_id' })
    const data = await uploadsSvc.markGraphicAssetUsed({ uploadId }, { userId })
    return res.json(data)
  } catch (err: any) {
    console.error('mark graphic used error', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_mark_used', detail: String(err?.message || err) })
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
    // Prefer redirect to signed CloudFront URL when configured (keeps Node out of the data path).
    try {
      const signed = await uploadsSvc.getUploadSignedCdnUrl(
        id,
        { kind: 'file' },
        { userId: Number(req.user!.id) }
      )
      res.set('Cache-Control', 'no-store')
      res.status(302).set('Location', signed.url)
      return res.end()
    } catch (e: any) {
      const code = String(e?.code || e?.message || '')
      if (code !== 'cdn_not_configured') throw e
    }
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

uploadsRouter.get('/api/uploads/:id/edit-proxy', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('bad_id')
    // Prefer redirect to signed CloudFront URL when configured (keeps Node out of the data path).
    try {
      const signed = await uploadsSvc.getUploadSignedCdnUrl(
        id,
        { kind: 'edit_proxy' },
        { userId: Number(req.user!.id) }
      )
      res.set('Cache-Control', 'no-store')
      res.status(302).set('Location', signed.url)
      return res.end()
    } catch (e: any) {
      const code = String(e?.code || e?.message || '')
      if (code !== 'cdn_not_configured') throw e
    }
    const range = typeof req.headers.range === 'string' ? String(req.headers.range) : undefined
    const { contentType, body, contentLength, contentRange } = await uploadsSvc.getUploadEditProxyStream(
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
    return (body as any).pipe(res)
  } catch (err: any) {
    const status = err?.status || 500
    if (status === 403) return res.status(403).send('forbidden')
    if (status === 404) return res.status(404).send('not_found')
    console.error('upload edit proxy fetch failed', err)
    return res.status(status).send('failed')
  }
})

uploadsRouter.get('/api/uploads/:id/audio-envelope', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const result = await uploadsSvc.getUploadAudioEnvelope(id, { userId: Number(req.user!.id) })
    if (result.status === 'pending') return res.status(202).json({ status: 'pending' })
    return res.json(result.envelope)
  } catch (err: any) {
    const status = err?.status || 500
    if (status === 403) return res.status(403).json({ error: 'forbidden' })
    console.error('get upload audio envelope error', err)
    return res.status(status).json({ error: err?.code || 'failed', detail: String(err?.message || err) })
  }
})

uploadsRouter.get('/api/uploads/:id/thumb', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('bad_id')

    // Prefer redirect to signed CloudFront URL when configured (keeps Node out of the data path).
    try {
      const signed = await uploadsSvc.getUploadSignedCdnUrl(
        id,
        { kind: 'thumb' },
        { userId: Number(req.user!.id) }
      )
      res.set('Cache-Control', 'no-store')
      res.status(302).set('Location', signed.url)
      return res.end()
    } catch (e: any) {
      const code = String(e?.code || e?.message || '')
      if (code !== 'cdn_not_configured') throw e
    }

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
	    if (status === 404) {
	      try {
	        const fallbackUrl = await uploadsSvc.getUploadThumbFallbackUrl(
	          Number(req.params.id),
	          { userId: Number(req.user!.id) }
	        )
	        if (fallbackUrl) {
	          res.set('Cache-Control', 'no-store')
	          res.status(302).set('Location', fallbackUrl)
	          return res.end()
	        }
	      } catch (e: any) {
	        const st = e?.status || 500
	        if (st === 403) return res.status(403).send('forbidden')
	      }
	      // As a last resort, return a tiny transparent placeholder instead of 404 to avoid console noise.
	      res.set('Cache-Control', 'no-store')
	      res.set('Content-Type', 'image/svg+xml; charset=utf-8')
	      return res
	        .status(200)
	        .send(
	          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" fill="#111"/>
  <path d="M0 16 L16 0 H24 L0 24 Z" fill="#1b1b1b"/>
  <path d="M40 64 L64 40 V48 L48 64 Z" fill="#1b1b1b"/>
  <path d="M0 44 L44 0 H48 L0 48 Z" fill="#181818"/>
  <path d="M20 64 L64 20 V24 L24 64 Z" fill="#181818"/>
</svg>`
	        )
	    }
	    console.error('upload thumb fetch failed', err)
	    return res.status(status).send('failed')
	  }
	})

uploadsRouter.get('/api/uploads/:id/cdn-url', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const kindRaw = String((req.query as any)?.kind || '').trim().toLowerCase()
    const kind =
      kindRaw === 'edit-proxy' || kindRaw === 'edit_proxy'
        ? 'edit_proxy'
        : kindRaw === 'thumb'
          ? 'thumb'
          : kindRaw === 'file'
            ? 'file'
            : null
    if (!kind) return res.status(400).json({ error: 'bad_kind' })
    const signed = await uploadsSvc.getUploadSignedCdnUrl(
      id,
      { kind: kind as any },
      { userId: Number(req.user!.id) }
    )
    res.set('Cache-Control', 'no-store')
    return res.json({ url: signed.url, expiresAt: signed.expiresAt })
  } catch (err: any) {
    const status = err?.status || 500
    const code = err?.code || 'failed'
    return res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})

uploadsRouter.post('/api/uploads/:id/thumb', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const timeSecondsRaw = (req.body as any)?.timeSeconds ?? (req.body as any)?.time_seconds
    const timeSeconds = Number(timeSecondsRaw)
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) return res.status(400).json({ error: 'bad_time' })
    const result = await uploadsSvc.requestUploadThumbRefresh(
      id,
      { timeSeconds },
      { userId: Number(req.user!.id) }
    )
    return res.json(result)
  } catch (err: any) {
    const status = err?.status || 500
    if (status === 403) return res.status(403).json({ error: 'forbidden' })
    if (status === 404) return res.status(404).json({ error: 'not_found' })
    return res.status(status).json({ error: err?.code || 'failed', detail: String(err?.message || err) })
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

uploadsRouter.post('/api/uploads/:id/freeze-frame', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const body = (req.body || {}) as any
    const atSeconds = body?.atSeconds != null ? Number(body.atSeconds) : 0
    const longEdgePx = body?.longEdgePx != null ? Number(body.longEdgePx) : undefined
    const result = await uploadsSvc.requestFreezeFrameUpload(
      id,
      { atSeconds, longEdgePx },
      { userId: Number(req.user!.id) }
    )
    if (result.status === 'pending') return res.status(202).json(result)
    return res.json(result)
  } catch (err: any) {
    console.error('request freeze frame error', err)
    const status = err?.status || 500
    const code = err?.code || err?.message || 'failed'
    return res.status(status).json({ error: String(code), detail: err?.detail ?? String(err?.message || err) })
  }
})
