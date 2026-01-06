import { Router } from 'express';
import { z } from 'zod';
// db types no longer needed here; routes delegate to service
import { requireAuth } from '../middleware/auth';
// permission checks handled in publications service
import * as pubsSvc from '../features/publications/service'
import * as likesSvc from '../features/likes/service'
import * as commentsSvc from '../features/comments/service'
import * as reportsSvc from '../features/reports/service'
// Legacy models removed from route usage; publications now delegate to service/repo

// legacy type aliases removed

// Note: legacy effectiveRequiresApproval removed; routes now rely on service logic

// legacy helpers removed; publications data comes from service DTOs

export const publicationsRouter = Router();

const visibilityEnum = z.enum(['inherit', 'members', 'public']);
const reportSchema = z.object({ ruleId: z.number().int().positive() })

const createPublicationSchema = z.object({
  spaceId: z.number().int().positive(),
  visibility: visibilityEnum.optional(),
  distributionFlags: z.any().optional(),
});

publicationsRouter.post('/api/uploads/:uploadId/publications', requireAuth, async (req, res, next) => {
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
  } catch (err: any) { next(err) }
})

// New: create publication from a Production (preferred path)
const createProdPublicationSchema = z.object({
  spaceId: z.number().int().positive(),
  visibility: visibilityEnum.optional(),
  distributionFlags: z.any().optional(),
});

publicationsRouter.post('/api/productions/:productionId/publications', requireAuth, async (req, res, next) => {
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
  } catch (err: any) { next(err) }
})

publicationsRouter.get('/api/uploads/:uploadId/publications', requireAuth, async (req, res, next) => {
  try {
    const uploadId = Number(req.params.uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) {
      return res.status(400).json({ error: 'bad_upload_id' })
    }
    const userId = Number(req.user!.id)
    const publications = await pubsSvc.listByUploadDto(uploadId, { userId })
    res.json({ publications })
  } catch (err: any) { next(err) }
})

// List publications for a specific production (for production-centric publish page)
publicationsRouter.get('/api/productions/:productionId/publications', requireAuth, async (req, res, next) => {
  try {
    const productionId = Number(req.params.productionId)
    if (!Number.isFinite(productionId) || productionId <= 0) {
      return res.status(400).json({ error: 'bad_production_id' })
    }
    const userId = Number(req.user!.id)
    const publications = await pubsSvc.listByProductionDto(productionId, { userId })
    res.json({ publications })
  } catch (err: any) { next(err) }
})

publicationsRouter.get('/api/publications/:id', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const userId = Number(req.user!.id)
    const { publication, events, canRepublishOwner } = await pubsSvc.get(publicationId, { userId })
    res.json({ publication, events, canRepublishOwner })
  } catch (err: any) { next(err) }
});

publicationsRouter.get('/api/publications/:id/jump-spaces', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const userId = Number(req.user!.id)
    const data = await pubsSvc.listJumpSpacesDto(publicationId, { userId })
    res.json(data)
  } catch (err: any) { next(err) }
})

const storySchema = z.object({
  storyText: z.string().max(2000).nullable().optional(),
})

publicationsRouter.get('/api/publications/:id/story', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const userId = Number(req.user!.id)
    const data = await pubsSvc.getStory(publicationId, { userId })
    res.json(data)
  } catch (err: any) { next(err) }
})

publicationsRouter.patch('/api/publications/:id/story', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const parsed = storySchema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    }
    const userId = Number(req.user!.id)
    const storyText = parsed.data.storyText ?? null
    const data = await pubsSvc.setStory(publicationId, storyText, { userId })
    res.json(data)
  } catch (err: any) { next(err) }
})

// Reporting options for end users (derived from the publication's space cultures)
publicationsRouter.get('/api/publications/:id/reporting/options', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const userId = Number(req.user!.id)
    const data = await reportsSvc.getReportingOptionsForPublication(publicationId, userId)
    res.json(data)
  } catch (err: any) { next(err) }
})

publicationsRouter.post('/api/publications/:id/report', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const parsed = reportSchema.safeParse(req.body || {})
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    }
    const userId = Number(req.user!.id)
    const data = await reportsSvc.submitPublicationReport(publicationId, userId, parsed.data)
    res.json(data)
  } catch (err: any) { next(err) }
})

const noteSchema = z.object({
  note: z.string().max(2000).optional(),
});

// legacy requirePublicationPermission removed; routes now delegate to service for permission checks

publicationsRouter.post('/api/publications/:id/approve', requireAuth, async (req, res, next) => {
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
  } catch (err: any) { next(err) }
})

publicationsRouter.post('/api/publications/:id/unpublish', requireAuth, async (req, res, next) => {
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
  } catch (err: any) { next(err) }
})

publicationsRouter.post('/api/publications/:id/reject', requireAuth, async (req, res, next) => {
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
  } catch (err: any) { next(err) }
})

// Republish endpoint
// Rules:
// - Owner may republish only if status is 'unpublished' AND the last unpublish was performed by the owner (last-actor rule).
//   - If space requires review, set to 'pending' (requested_by=owner), otherwise publish immediately.
// - Moderators/admins with video:publish_space (or site admin) may republish immediately regardless of review requirement.
// - When status is 'rejected', owner may NOT republish; moderators may republish.
publicationsRouter.post('/api/publications/:id/republish', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' })
    }
    const userId = Number(req.user!.id)
    const updated = await pubsSvc.republish(publicationId, { userId })
    res.json({ publication: updated })
  } catch (err: any) { next(err) }
})

// --- Likes ---
// Summary: count + whether current user liked
publicationsRouter.get('/api/publications/:id/likes', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) return res.status(400).json({ error: 'bad_publication_id' })
    const userId = Number(req.user!.id)
    const data = await likesSvc.getPublicationLikesSummary(publicationId, userId)
    res.json(data)
  } catch (err: any) { next(err) }
})

// Like (idempotent)
publicationsRouter.post('/api/publications/:id/likes', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) return res.status(400).json({ error: 'bad_publication_id' })
    const userId = Number(req.user!.id)
    const data = await likesSvc.likePublication(publicationId, userId)
    res.json(data)
  } catch (err: any) { next(err) }
})

// Unlike (idempotent)
publicationsRouter.delete('/api/publications/:id/likes', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) return res.status(400).json({ error: 'bad_publication_id' })
    const userId = Number(req.user!.id)
    const data = await likesSvc.unlikePublication(publicationId, userId)
    res.json(data)
  } catch (err: any) { next(err) }
})

// Who liked list (paginated)
publicationsRouter.get('/api/publications/:id/likes/users', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) return res.status(400).json({ error: 'bad_publication_id' })
    const userId = Number(req.user!.id)
    const limitRaw = Number(req.query.limit ?? 50)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
    const data = await likesSvc.listPublicationLikers(publicationId, userId, { limit, cursor })
    res.json(data)
  } catch (err: any) { next(err) }
})

// --- Comments ---
// List top-level comments
publicationsRouter.get('/api/publications/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) return res.status(400).json({ error: 'bad_publication_id' })
    const userId = Number(req.user!.id)
    const limitRaw = Number(req.query.limit ?? 50)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
    // Sorting: default oldest first; later we’ll read space setting
    const orderParam = String(req.query.order || 'oldest').toLowerCase() === 'newest' ? 'newest' : 'oldest'
    const data = await commentsSvc.listTop(publicationId, userId, { limit, cursor, order: orderParam as any })
    res.json(data)
  } catch (err: any) { next(err) }
})

// List replies for a comment
publicationsRouter.get('/api/publications/:id/comments/:commentId/replies', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    const commentId = Number(req.params.commentId)
    if (!Number.isFinite(publicationId) || publicationId <= 0) return res.status(400).json({ error: 'bad_publication_id' })
    if (!Number.isFinite(commentId) || commentId <= 0) return res.status(400).json({ error: 'bad_comment_id' })
    const userId = Number(req.user!.id)
    const limitRaw = Number(req.query.limit ?? 50)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
    const orderParam = String(req.query.order || 'oldest').toLowerCase() === 'newest' ? 'newest' : 'oldest'
    const data = await commentsSvc.listReplies(publicationId, userId, commentId, { limit, cursor, order: orderParam as any })
    res.json(data)
  } catch (err: any) { next(err) }
})

// Create comment or reply
publicationsRouter.post('/api/publications/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const publicationId = Number(req.params.id)
    if (!Number.isFinite(publicationId) || publicationId <= 0) return res.status(400).json({ error: 'bad_publication_id' })
    const userId = Number(req.user!.id)
    const { body, parentId } = (req.body || {}) as any
    const created = await commentsSvc.create(publicationId, userId, String(body || ''), parentId != null ? Number(parentId) : null)
    res.status(201).json(created)
  } catch (err: any) { next(err) }
})
