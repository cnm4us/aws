import { Router } from 'express';
import { z } from 'zod';
import { getPool, SpacePublicationRow, SpacePublicationStatus, SpacePublicationVisibility } from '../db';
import { requireAuth } from '../middleware/auth';
import { can, resolveChecker } from '../security/permissions';
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

    const [existingRows] = await db.query(
      `SELECT id, status FROM space_publications WHERE upload_id = ? AND space_id = ? LIMIT 1`,
      [uploadId, spaceId]
    );
    const existing = (existingRows as any[])[0];
    if (existing) {
      return res.status(409).json({
        error: 'publication_exists',
        publicationId: Number(existing.id),
        status: String(existing.status),
      });
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
    if (!isAdmin && !canPublishOwn && !canPublishSpacePerm) {
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

    const publication = await createSpacePublication({
      uploadId,
      spaceId,
      status,
      requestedBy: userId,
      approvedBy,
      isPrimary: Boolean(upload.origin_space_id && upload.origin_space_id === spaceId),
      visibility: visibility ?? 'inherit',
      distributionFlags: distributionFlags ?? null,
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

publicationsRouter.get('/api/uploads/:uploadId/publications', requireAuth, async (req, res) => {
  try {
    const uploadId = Number(req.params.uploadId);
    if (!Number.isFinite(uploadId) || uploadId <= 0) {
      return res.status(400).json({ error: 'bad_upload_id' });
    }
    const db = getPool();
    const upload = await loadUpload(db, uploadId);
    if (!upload) return res.status(404).json({ error: 'upload_not_found' });

    const userId = Number(req.user!.id);
    const ownerId = upload.user_id;
    const checker = await resolveChecker(userId);
    const isAdmin = await can(userId, 'video:delete_any', { checker });
    const isOwner =
      ownerId != null &&
      ownerId === userId &&
      (await can(userId, 'video:publish_own', { ownerId, checker }));

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const publications = await listSpacePublicationsForUpload(uploadId, db);
    res.json({ publications });
  } catch (err: any) {
    console.error('list publications failed', err);
    res.status(500).json({ error: 'failed_to_list_publications', detail: String(err?.message || err) });
  }
});

publicationsRouter.get('/api/publications/:id', requireAuth, async (req, res) => {
  try {
    const publicationId = Number(req.params.id);
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' });
    }
    const db = getPool();
    const pub = await getSpacePublicationById(publicationId, db);
    if (!pub) return res.status(404).json({ error: 'publication_not_found' });

    const upload = await loadUpload(db, pub.upload_id);
    if (!upload) return res.status(404).json({ error: 'upload_not_found' });

    const userId = Number(req.user!.id);
    const checker = await resolveChecker(userId);
    const isAdmin = await can(userId, 'video:delete_any', { checker });
    const ownerId = upload.user_id;
    const isOwner =
      ownerId != null &&
      ownerId === userId &&
      (await can(userId, 'video:publish_own', { ownerId, checker }));
    const canModerateSpace =
      (await can(userId, 'video:publish_space', { spaceId: pub.space_id, checker })) ||
      (await can(userId, 'video:approve_space', { spaceId: pub.space_id, checker })) ||
      (await can(userId, 'video:unpublish_space', { spaceId: pub.space_id, checker }));

    if (!isAdmin && !isOwner && !canModerateSpace) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const events = await listSpacePublicationEvents(publicationId, db);
    res.json({ publication: pub, events });
  } catch (err: any) {
    console.error('get publication failed', err);
    res.status(500).json({ error: 'failed_to_get_publication', detail: String(err?.message || err) });
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
    const publicationId = Number(req.params.id);
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' });
    }
    const permission = await requirePublicationPermission(req, res, publicationId, 'approve');
    if (!permission) return;
    const { db, context } = permission;
    const userId = Number(req.user!.id);
    const now = new Date();
    const updated = await updateSpacePublicationStatus(
      publicationId,
      {
        status: 'published',
        approvedBy: userId,
        publishedAt: now,
        unpublishedAt: null,
      },
      db
    );
    if (!updated) {
      return res.status(404).json({ error: 'publication_not_found' });
    }
    const note = noteSchema.safeParse(req.body || {});
    await recordSpacePublicationEvent(
      {
        publicationId,
        actorUserId: userId,
        action: 'approve_publication',
        detail: {
          note: note.success ? note.data.note ?? null : null,
        },
      },
      db
    );
    res.json({ publication: updated });
  } catch (err: any) {
    console.error('approve publication failed', err);
    res.status(500).json({ error: 'failed_to_approve_publication', detail: String(err?.message || err) });
  }
});

publicationsRouter.post('/api/publications/:id/unpublish', requireAuth, async (req, res) => {
  try {
    const publicationId = Number(req.params.id);
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' });
    }
    const permission = await requirePublicationPermission(req, res, publicationId, 'unpublish');
    if (!permission) return;
    const { db } = permission;
    const userId = Number(req.user!.id);
    const note = noteSchema.safeParse(req.body || {});
    const now = new Date();
    const updated = await updateSpacePublicationStatus(
      publicationId,
      {
        status: 'unpublished',
        unpublishedAt: now,
      },
      db
    );
    if (!updated) return res.status(404).json({ error: 'publication_not_found' });
    await recordSpacePublicationEvent(
      {
        publicationId,
        actorUserId: userId,
        action: 'unpublish_publication',
        detail: {
          note: note.success ? note.data.note ?? null : null,
        },
      },
      db
    );
    res.json({ publication: updated });
  } catch (err: any) {
    console.error('unpublish publication failed', err);
    res.status(500).json({ error: 'failed_to_unpublish_publication', detail: String(err?.message || err) });
  }
});

publicationsRouter.post('/api/publications/:id/reject', requireAuth, async (req, res) => {
  try {
    const publicationId = Number(req.params.id);
    if (!Number.isFinite(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'bad_publication_id' });
    }
    const permission = await requirePublicationPermission(req, res, publicationId, 'reject');
    if (!permission) return;
    const { db } = permission;
    const userId = Number(req.user!.id);
    const note = noteSchema.safeParse(req.body || {});
    const updated = await updateSpacePublicationStatus(
      publicationId,
      {
        status: 'rejected',
        unpublishedAt: new Date(),
      },
      db
    );
    if (!updated) return res.status(404).json({ error: 'publication_not_found' });
    await recordSpacePublicationEvent(
      {
        publicationId,
        actorUserId: userId,
        action: 'reject_publication',
        detail: {
          note: note.success ? note.data.note ?? null : null,
        },
      },
      db
    );
    res.json({ publication: updated });
  } catch (err: any) {
    console.error('reject publication failed', err);
    res.status(500).json({ error: 'failed_to_reject_publication', detail: String(err?.message || err) });
  }
});
