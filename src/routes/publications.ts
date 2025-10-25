import { Router } from 'express';
import { z } from 'zod';
import { getPool, SpacePublicationRow, SpacePublicationStatus, SpacePublicationVisibility } from '../db';
import { requireAuth } from '../middleware/auth';
import { can, resolveChecker } from '../security/permissions';
import * as pubsSvc from '../features/publications/service'
import {
  createSpacePublication,
  getSpacePublicationById,
  listSpacePublicationEvents,
  listSpacePublicationsForUpload,
  updateSpacePublicationStatus,
} from '../models/spacePublications';

type SpaceRow = {
  id: number;
  type: 'personal' | 'group' | 'channel';
  owner_user_id: number | null;
  settings: any;
};

type UploadWithOwner = {
  id: number;
  user_id: number | null;
  space_id: number | null;
  origin_space_id: number | null;
  status: string;
};

type ProductionRow = {
  id: number;
  upload_id: number;
  user_id: number;
};

// Note: legacy effectiveRequiresApproval removed; routes now rely on service logic

async function loadUpload(db: any, uploadId: number): Promise<UploadWithOwner | null> {
  const [rows] = await db.query(
    `SELECT id, user_id, space_id, origin_space_id, status FROM uploads WHERE id = ? LIMIT 1`,
    [uploadId]
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    user_id: row.user_id == null ? null : Number(row.user_id),
    space_id: row.space_id == null ? null : Number(row.space_id),
    origin_space_id: row.origin_space_id == null ? null : Number(row.origin_space_id),
    status: String(row.status),
  };
}

async function loadSpace(db: any, spaceId: number): Promise<SpaceRow | null> {
  const [rows] = await db.query(
    `SELECT id, type, owner_user_id, settings FROM spaces WHERE id = ? LIMIT 1`,
    [spaceId]
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    type: String(row.type) as any,
    owner_user_id: row.owner_user_id == null ? null : Number(row.owner_user_id),
    settings: row.settings,
  };
}

async function loadProduction(db: any, productionId: number): Promise<ProductionRow | null> {
  const [rows] = await db.query(
    `SELECT id, upload_id, user_id FROM productions WHERE id = ? LIMIT 1`,
    [productionId]
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    upload_id: Number(row.upload_id),
    user_id: Number(row.user_id),
  };
}

// legacy loadPublicationContext removed; replaced by service/repo

function mapPublicationRow(row: any): SpacePublicationRow {
  return {
    id: Number(row.id),
    upload_id: Number(row.upload_id),
    space_id: Number(row.space_id),
    status: row.status as SpacePublicationStatus,
    requested_by: row.requested_by == null ? null : Number(row.requested_by),
    approved_by: row.approved_by == null ? null : Number(row.approved_by),
    is_primary: Boolean(Number(row.is_primary)),
    visibility: (row.visibility || 'inherit') as SpacePublicationVisibility,
    distribution_flags: row.distribution_flags ? (() => { try { return JSON.parse(row.distribution_flags); } catch { return null; } })() : null,
    published_at: row.published_at ? String(row.published_at) : null,
    unpublished_at: row.unpublished_at ? String(row.unpublished_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

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
    const publications = await pubsSvc.listByUploadForDto(uploadId, { userId })
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
    const publications = await pubsSvc.listByProductionForDto(productionId, { userId })
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
    const { publication, events, canRepublishOwner } = await pubsSvc.getForDto(publicationId, { userId })
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
