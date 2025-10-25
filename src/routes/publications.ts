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
  recordSpacePublicationEvent,
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

function parseSettings(raw: any): any {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

async function effectiveRequiresApproval(db: any, space: SpaceRow | null): Promise<boolean> {
  if (!space) return false;
  // Site-level precedence
  try {
    const [rows] = await db.query(`SELECT require_group_review, require_channel_review FROM site_settings WHERE id = 1 LIMIT 1`);
    const site = (rows as any[])[0];
    if (site) {
      const siteRequires = space.type === 'group'
        ? Boolean(Number(site.require_group_review))
        : space.type === 'channel'
          ? Boolean(Number(site.require_channel_review))
          : false;
      if (siteRequires) return true;
    }
  } catch {
    // ignore
  }
  // Space-level setting
  const settings = parseSettings(space.settings);
  if (settings && typeof settings === 'object') {
    const publishing = settings.publishing;
    if (publishing && typeof publishing === 'object' && typeof publishing.requireApproval === 'boolean') {
      return publishing.requireApproval;
    }
  }
  // Fallback to profile defaults: group=false, channel=true
  if (space.type === 'channel') return true;
  return false;
}

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

async function loadPublicationContext(db: any, publicationId: number) {
  const [rows] = await db.query(
    `SELECT sp.*, u.user_id AS upload_owner_id, u.origin_space_id, u.space_id AS upload_space_id,
            s.type AS space_type, s.owner_user_id AS space_owner_id, s.settings AS space_settings
       FROM space_publications sp
       JOIN uploads u ON u.id = sp.upload_id
       JOIN spaces s ON s.id = sp.space_id
      WHERE sp.id = ?
      LIMIT 1`,
    [publicationId]
  );
  return (rows as any[])[0] || null;
}

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
    const uploadId = Number(req.params.uploadId);
    if (!Number.isFinite(uploadId) || uploadId <= 0) {
      return res.status(400).json({ error: 'bad_upload_id' });
    }
    const parsed = createPublicationSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() });
    }
    const { spaceId, visibility, distributionFlags } = parsed.data;
    const db = getPool();
    const upload = await loadUpload(db, uploadId);
    if (!upload) return res.status(404).json({ error: 'upload_not_found' });

    const space = await loadSpace(db, spaceId);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    // Prefer binding to the latest completed production for this upload
    let boundProductionId: number | null = null;
    try {
      const [pRows] = await db.query(
        `SELECT id FROM productions WHERE upload_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1`,
        [uploadId]
      );
      const prow = (pRows as any[])[0];
      if (prow) boundProductionId = Number(prow.id);
    } catch {}
    if (boundProductionId != null) {
      const [existsRows] = await db.query(
        `SELECT id, status FROM space_publications WHERE production_id = ? AND space_id = ? LIMIT 1`,
        [boundProductionId, spaceId]
      );
      const ex = (existsRows as any[])[0];
      if (ex) {
        // Attempt republish semantics for existing record to avoid frontend 409 handling
        const existingId = Number(ex.id);
        const curStatus = String(ex.status || '');
        if (curStatus === 'published' || curStatus === 'approved' || curStatus === 'pending') {
          const existingPub = await getSpacePublicationById(existingId, db);
          return res.json({ publication: existingPub });
        }
        const userId = Number(req.user!.id);
        const checker = await resolveChecker(userId);
        const isAdmin = await can(userId, 'video:delete_any', { checker });
        const canPublishSpace = await can(userId, 'video:publish_space', { spaceId, checker });
        if (curStatus === 'unpublished') {
          if (isAdmin || canPublishSpace) {
            const now = new Date();
            const updated = await updateSpacePublicationStatus(existingId, { status: 'published', approvedBy: userId, publishedAt: now, unpublishedAt: null }, db);
            await recordSpacePublicationEvent({ publicationId: existingId, actorUserId: userId, action: 'moderator_republish_published' }, db);
            return res.json({ publication: updated });
          }
          const ownerId = upload.user_id;
          const isOwner = ownerId != null && Number(ownerId) === userId && (await can(userId, 'video:publish_own', { ownerId, checker }));
          if (!isOwner) return res.status(403).json({ error: 'forbidden' });
          const ev = await listSpacePublicationEvents(existingId, db);
          const lastUnpub = [...ev].reverse().find((e) => e.action === 'unpublish_publication');
          if (!lastUnpub || lastUnpub.actor_user_id !== userId) return res.status(403).json({ error: 'forbidden' });
          const requiresApproval = await effectiveRequiresApproval(db, space);
          if (requiresApproval) {
            const updated = await updateSpacePublicationStatus(existingId, { status: 'pending', approvedBy: null, publishedAt: null, unpublishedAt: null }, db);
            await recordSpacePublicationEvent({ publicationId: existingId, actorUserId: userId, action: 'owner_republish_requested' }, db);
            return res.json({ publication: updated });
          } else {
            const now = new Date();
            const updated = await updateSpacePublicationStatus(existingId, { status: 'published', approvedBy: userId, publishedAt: now, unpublishedAt: null }, db);
            await recordSpacePublicationEvent({ publicationId: existingId, actorUserId: userId, action: 'owner_republish_published' }, db);
            return res.json({ publication: updated });
          }
        } else if (curStatus === 'rejected') {
          if (!(isAdmin || canPublishSpace)) return res.status(403).json({ error: 'forbidden' });
          const now = new Date();
          const updated = await updateSpacePublicationStatus(existingId, { status: 'published', approvedBy: userId, publishedAt: now, unpublishedAt: null }, db);
          await recordSpacePublicationEvent({ publicationId: existingId, actorUserId: userId, action: 'moderator_republish_published' }, db);
          return res.json({ publication: updated });
        }
      }
    }

    const userId = Number(req.user!.id);
    const ownerId = upload.user_id;
    const checker = await resolveChecker(userId);
    const isAdmin = await can(userId, 'video:delete_any', { checker });
    const canPublishOwn =
      ownerId != null &&
      ownerId === userId &&
      (await can(userId, 'video:publish_own', { ownerId, checker }));
    const canPublishSpacePerm = await can(userId, 'video:publish_space', { spaceId, checker });
    const canPostSpace = await can(userId, 'space:post', { spaceId, checker });
    if (!isAdmin && !canPublishOwn && !canPublishSpacePerm && !canPostSpace) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const requireApproval = await effectiveRequiresApproval(db, space);
    const now = new Date();
    let status: SpacePublicationStatus = requireApproval ? 'pending' : 'published';
    let approvedBy: number | null = null;
    let publishedAt: Date | null = null;
    if (!requireApproval) {
      approvedBy = userId;
      publishedAt = now;
    }

    // Visibility defaults by space type
    let visibleInSpace = true;
    let visibleInGlobal = false;
    if (space.type === 'personal') {
      visibleInGlobal = true;
    } else if (space.type === 'group') {
      visibleInGlobal = false;
    } else if (space.type === 'channel') {
      visibleInGlobal = false;
    }

    const publication = await createSpacePublication({
      uploadId,
      productionId: boundProductionId ?? undefined,
      spaceId,
      status,
      requestedBy: userId,
      approvedBy,
      isPrimary: Boolean(upload.origin_space_id && upload.origin_space_id === spaceId),
      visibility: visibility ?? 'inherit',
      distributionFlags: distributionFlags ?? null,
      ownerUserId: upload.user_id ?? null,
      visibleInSpace,
      visibleInGlobal,
      publishedAt,
    }, db);

    await recordSpacePublicationEvent(
      {
        publicationId: publication.id,
        actorUserId: userId,
        action: requireApproval ? 'create_pending' : 'auto_published',
        detail: {
          visibility: publication.visibility,
          distribution: distributionFlags ?? null,
        },
      },
      db
    );

    res.status(201).json({ publication });
  } catch (err: any) {
    console.error('create publication failed', err);
    res.status(500).json({ error: 'failed_to_create_publication', detail: String(err?.message || err) });
  }
});

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

async function requirePublicationPermission(
  req: any,
  res: any,
  publicationId: number,
  intent: 'approve' | 'unpublish' | 'reject'
): Promise<{ db: any; context: any } | null> {
  const db = getPool();
  const row = await loadPublicationContext(db, publicationId);
  if (!row) {
    res.status(404).json({ error: 'publication_not_found' });
    return null;
  }
  const userId = Number(req.user!.id);
  const ownerId = row.upload_owner_id == null ? null : Number(row.upload_owner_id);
  const spaceId = Number(row.space_id);
  const checker = await resolveChecker(userId);
  const isAdmin = await can(userId, 'video:delete_any', { checker });
  let allowed = false;
  if (isAdmin) {
    allowed = true;
  } else if (intent === 'approve') {
    allowed = await can(userId, 'video:approve_space', { spaceId, checker }) || await can(userId, 'video:approve', { checker });
  } else if (intent === 'unpublish') {
    const isOwner =
      ownerId != null &&
      ownerId === userId &&
      (await can(userId, 'video:unpublish_own', { ownerId, checker }));
    const spacePerm = await can(userId, 'video:unpublish_space', { spaceId, checker });
    allowed = isOwner || spacePerm;
  } else if (intent === 'reject') {
    allowed = await can(userId, 'video:approve_space', { spaceId, checker }) || await can(userId, 'video:approve', { checker });
  }
  if (!allowed) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return { db, context: row };
}

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
      try {
        await recordSpacePublicationEvent({ publicationId, actorUserId: userId, action: 'approve_publication', detail: { note: note.data.note } })
      } catch {}
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
      try {
        await recordSpacePublicationEvent({ publicationId, actorUserId: userId, action: 'unpublish_publication', detail: { note: note.data.note } })
      } catch {}
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
      try {
        await recordSpacePublicationEvent({ publicationId, actorUserId: userId, action: 'reject_publication', detail: { note: note.data.note } })
      } catch {}
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
