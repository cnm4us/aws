import { Router } from 'express';
import { z } from 'zod';
// db types no longer needed here; routes delegate to service
import { requireAuth } from '../middleware/auth';
// permission checks handled in publications service
import * as pubsSvc from '../features/publications/service'
// Legacy models removed from route usage; publications now delegate to service/repo

// legacy type aliases removed

// Note: legacy effectiveRequiresApproval removed; routes now rely on service logic

// legacy helpers removed; publications data comes from service DTOs

export const publicationsRouter = Router();

const visibilityEnum = z.enum(['inherit', 'members', 'public']);

const createPublicationSchema = z.object({
  spaceId: z.number().int().positive(),
  visibility: visibilityEnum.optional(),
  distributionFlags: z.any().optional(),
});

publicationsRouter.post('/api/uploads/:uploadId/publications', requireAuth, async (req, res) => {
  try {
    const uploadId = Number(req.params.uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) {
      return res.status(400).json({ error: 'bad_upload_id' })
    }
    const parsed = createPublicationSchema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    }
    const { spaceId, visibility, distributionFlags } = parsed.data
    const userId = Number(req.user!.id)
    const publication = await pubsSvc.createFromUpload({ uploadId, spaceId, visibility, distributionFlags }, { userId })
    res.status(201).json({ publication })
  } catch (err: any) {
    console.error('create publication failed', err)
    const code = err?.code || 'failed_to_create_publication'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})

// New: create publication from a Production (preferred path)
const createProdPublicationSchema = z.object({
  spaceId: z.number().int().positive(),
  visibility: visibilityEnum.optional(),
  distributionFlags: z.any().optional(),
});

publicationsRouter.post('/api/productions/:productionId/publications', requireAuth, async (req, res) => {
  try {
    const productionId = Number(req.params.productionId)
    if (!Number.isFinite(productionId) || productionId <= 0) {
      return res.status(400).json({ error: 'bad_production_id' })
    }
    const parsed = createProdPublicationSchema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    }
    const { spaceId, visibility, distributionFlags } = parsed.data
    const userId = Number(req.user!.id)
    const publication = await pubsSvc.createFromProduction({ productionId, spaceId, visibility, distributionFlags }, { userId })
    res.status(201).json({ publication })
  } catch (err: any) {
    console.error('create production publication failed', err)
    const code = err?.code || 'failed_to_create_publication'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})

publicationsRouter.get('/api/uploads/:uploadId/publications', requireAuth, async (req, res) => {
  try {
    const uploadId = Number(req.params.uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) {
      return res.status(400).json({ error: 'bad_upload_id' })
    }
    const userId = Number(req.user!.id)
    const publications = await pubsSvc.listByUploadDto(uploadId, { userId })
    res.json({ publications })
  } catch (err: any) {
    console.error('list publications failed', err)
    const code = err?.code || 'failed_to_list_publications'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})

// List publications for a specific production (for production-centric publish page)
publicationsRouter.get('/api/productions/:productionId/publications', requireAuth, async (req, res) => {
  try {
    const productionId = Number(req.params.productionId)
    if (!Number.isFinite(productionId) || productionId <= 0) {
      return res.status(400).json({ error: 'bad_production_id' })
    }
    const userId = Number(req.user!.id)
    const publications = await pubsSvc.listByProductionDto(productionId, { userId })
    res.json({ publications })
  } catch (err: any) {
    // Preserve existing error logging/shape
    console.error('list production publications failed', err)
    const code = err?.code || 'failed_to_list_publications'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})

publicationsRouter.get('/api/publications/:id', requireAuth, async (req, res) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const userId = Number(req.user!.id)
    const { publication, events, canRepublishOwner } = await pubsSvc.get(publicationId, { userId })
    res.json({ publication, events, canRepublishOwner })
  } catch (err: any) {
    console.error('get publication failed', err)
    const code = err?.code || 'failed_to_get_publication'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
});

const noteSchema = z.object({
  note: z.string().max(2000).optional(),
});

// legacy requirePublicationPermission removed; routes now delegate to service for permission checks

publicationsRouter.post('/api/publications/:id/approve', requireAuth, async (req, res) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const userId = Number(req.user!.id)
    const updated = await pubsSvc.approve(publicationId, { userId })
    // Preserve note recording behavior for compatibility (optional note in body)
    const note = noteSchema.safeParse(req.body || {})
    if (note.success && note.data.note && note.data.note.length) {
      try { await pubsSvc.recordNoteEvent(publicationId, userId, 'approve_publication', note.data.note) } catch {}
    }
    res.json({ publication: updated })
  } catch (err: any) {
    console.error('approve publication failed', err)
    const code = err?.code || 'failed_to_approve_publication'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})

publicationsRouter.post('/api/publications/:id/unpublish', requireAuth, async (req, res) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const userId = Number(req.user!.id)
    const updated = await pubsSvc.unpublish(publicationId, { userId })
    // Preserve optional note behavior
    const note = noteSchema.safeParse(req.body || {})
    if (note.success && note.data.note && note.data.note.length) {
      try { await pubsSvc.recordNoteEvent(publicationId, userId, 'unpublish_publication', note.data.note) } catch {}
    }
    res.json({ publication: updated })
  } catch (err: any) {
    console.error('unpublish publication failed', err)
    const code = err?.code || 'failed_to_unpublish_publication'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})

publicationsRouter.post('/api/publications/:id/reject', requireAuth, async (req, res) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const userId = Number(req.user!.id)
    const updated = await pubsSvc.reject(publicationId, { userId })
    const note = noteSchema.safeParse(req.body || {})
    if (note.success && note.data.note && note.data.note.length) {
      try { await pubsSvc.recordNoteEvent(publicationId, userId, 'reject_publication', note.data.note) } catch {}
    }
    res.json({ publication: updated })
  } catch (err: any) {
    console.error('reject publication failed', err)
    const code = err?.code || 'failed_to_reject_publication'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})

// Republish endpoint
// Rules:
// - Owner may republish only if status is 'unpublished' AND the last unpublish was performed by the owner (last-actor rule).
//   - If space requires review, set to 'pending' (requested_by=owner), otherwise publish immediately.
// - Moderators/admins with video:publish_space (or site admin) may republish immediately regardless of review requirement.
// - When status is 'rejected', owner may NOT republish; moderators may republish.
publicationsRouter.post('/api/publications/:id/republish', requireAuth, async (req, res) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const userId = Number(req.user!.id)
    const updated = await pubsSvc.republish(publicationId, { userId })
    res.json({ publication: updated })
  } catch (err: any) {
    console.error('republish publication failed', err)
    const code = err?.code || 'failed_to_republish_publication'
    const status = err?.status || 500
    res.status(status).json({ error: code, detail: String(err?.message || err) })
  }
})
