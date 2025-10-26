import { Router } from 'express';
import { getPool, SpacePublicationStatus, SpacePublicationVisibility } from '../db';
import { requireAuth } from '../middleware/auth';
import { can } from '../security/permissions';
import { enhanceUploadRow } from '../utils/enhance';
import * as feedsSvc from '../features/feeds/service'
import * as spacesSvc from '../features/spaces/service'
import {
  assignDefaultAdminRoles,
  assignDefaultMemberRoles,
  isMember,
  listSpaceInvitations,
  listSpaceMembers,
  loadSpace,
  removeAllRoles,
  type SpaceRow,
  type SpaceType,
} from '../services/spaceMembership';

const spacesRouter = Router();

type SpaceRelationship = 'owner' | 'admin' | 'member' | 'subscriber';

type SpaceSummary = {
  id: number;
  name: string;
  slug: string;
  type: SpaceType;
  relationship: SpaceRelationship;
  subscribed: boolean;
};

type SiteSettings = {
  allowGroupCreation: boolean;
  allowChannelCreation: boolean;
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'space';
}

function defaultSettings(type: 'group' | 'channel'): any {
  if (type === 'group') {
    return {
      visibility: 'private',
      membership: 'invite',
      publishing: { requireApproval: false, targets: ['space'] },
      limits: {},
    };
  }
  return {
    visibility: 'members_only',
    membership: 'invite',
    publishing: { requireApproval: true, targets: ['channel'] },
    limits: {},
  };
}

async function fetchSiteSettings(db: any): Promise<SiteSettings> {
  const [rows] = await db.query(`SELECT allow_group_creation, allow_channel_creation FROM site_settings WHERE id = 1 LIMIT 1`);
  const row = (rows as any[])[0];
  if (!row) throw new Error('missing_site_settings');
  return {
    allowGroupCreation: Boolean(Number(row.allow_group_creation)),
    allowChannelCreation: Boolean(Number(row.allow_channel_creation)),
  };
}

async function fetchSiteReviewFlags(db: any): Promise<{ requireGroupReview: boolean; requireChannelReview: boolean }>{
  const [rows] = await db.query(`SELECT require_group_review, require_channel_review FROM site_settings WHERE id = 1 LIMIT 1`);
  const row = (rows as any[])[0];
  if (!row) throw new Error('missing_site_settings');
  return {
    requireGroupReview: Boolean(Number(row.require_group_review)),
    requireChannelReview: Boolean(Number(row.require_channel_review)),
  };
}

async function ensurePermission(userId: number, spaceId: number, permission: string): Promise<boolean> {
  return can(userId, permission as any, { spaceId });
}

// settings helpers moved to spaces service; legacy copies removed

async function hasActiveSubscription(db: any, spaceId: number, userId: number): Promise<boolean> {
  const [rows] = await db.query(
    `SELECT 1 FROM space_subscriptions
      WHERE user_id = ? AND space_id = ? AND status = 'active' AND (ended_at IS NULL OR ended_at > NOW())
      LIMIT 1`,
    [userId, spaceId]
  );
  return (rows as any[]).length > 0;
}

// canViewSpaceFeed moved to spaces service

function mapSpaceSummary(row: any, relationship: SpaceRelationship, subscribed: boolean): SpaceSummary {
  return {
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    type: String(row.type) as SpaceType,
    relationship,
    subscribed,
  };
}

function mergeChannelEntries(
  memberships: SpaceSummary[],
  subscriptions: SpaceSummary[]
): SpaceSummary[] {
  const map = new Map<number, SpaceSummary>();
  memberships.forEach((entry) => {
    map.set(entry.id, { ...entry });
  });
  subscriptions.forEach((entry) => {
    const existing = map.get(entry.id);
    if (existing) {
      existing.subscribed = existing.subscribed || entry.subscribed;
      if (existing.relationship === 'member' && entry.relationship === 'subscriber') {
        // Keep current relationship
        return;
      }
      if (existing.relationship !== 'owner' && entry.relationship === 'subscriber') {
        // Keep stronger relationship if existing is admin
        return;
      }
    } else {
      map.set(entry.id, { ...entry });
    }
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

spacesRouter.get('/api/me/spaces', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user!.id)
    const data = await spacesSvc.getMySpaces(userId)
    res.json(data)
  } catch (err: any) {
    console.error('list my spaces failed', err)
    res.status(500).json({ error: 'failed_to_list_spaces', detail: String(err?.message || err) })
  }
})

// List subscribers for a space (active and recent)
spacesRouter.get('/api/spaces/:id/subscribers', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    const db = getPool();
    const userId = Number(req.user!.id);
    const isSiteAdmin = await can(userId, 'video:delete_any');
    const canView = isSiteAdmin || (await can(userId, 'subscription:view_subscribers', { spaceId }));
    if (!canView) return res.status(403).json({ error: 'forbidden' });

    const [rows] = await db.query(
      `SELECT sub.user_id, sub.tier, sub.status, sub.started_at, sub.ended_at, u.email, u.display_name
         FROM space_subscriptions sub
         JOIN users u ON u.id = sub.user_id
        WHERE sub.space_id = ?
        ORDER BY sub.status = 'active' DESC, sub.started_at DESC`,
      [spaceId]
    );
    const subscribers = (rows as any[]).map((r) => ({
      userId: Number(r.user_id),
      email: r.email || null,
      displayName: r.display_name || null,
      tier: r.tier || null,
      status: String(r.status),
      startedAt: r.started_at ? String(r.started_at) : null,
      endedAt: r.ended_at ? String(r.ended_at) : null,
    }));
    res.json({ subscribers });
  } catch (err: any) {
    console.error('list subscribers failed', err);
    res.status(500).json({ error: 'failed_to_list_subscribers', detail: String(err?.message || err) });
  }
});

// List suspensions for a space (optionally only active)
spacesRouter.get('/api/spaces/:id/suspensions', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    const db = getPool();
    const userId = Number(req.user!.id);
    const isSiteAdmin = await can(userId, 'video:delete_any');
    const canView = isSiteAdmin || (await can(userId, 'moderation:suspend_posting', { spaceId })) || (await can(userId, 'moderation:ban', { spaceId }));
    if (!canView) return res.status(403).json({ error: 'forbidden' });

    const activeOnly = String(req.query.active || '') === '1' || String(req.query.active || '').toLowerCase() === 'true';
    const where: string[] = [
      `target_type = 'space'`,
      `target_id = ?`,
    ];
    const params: any[] = [spaceId];
    if (activeOnly) {
      where.push(`(starts_at IS NULL OR starts_at <= NOW())`);
      where.push(`(ends_at IS NULL OR ends_at >= NOW())`);
    }
    const sql = `
      SELECT id, user_id, kind, degree, starts_at, ends_at, reason, created_by, created_at
        FROM suspensions
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT 1000`;
    const [rows] = await db.query(sql, params);
    const items = (rows as any[]).map((r) => ({
      id: Number(r.id),
      userId: Number(r.user_id),
      kind: String(r.kind),
      degree: r.degree != null ? Number(r.degree) : null,
      startsAt: r.starts_at ? String(r.starts_at) : null,
      endsAt: r.ends_at ? String(r.ends_at) : null,
      reason: r.reason || null,
      createdBy: r.created_by != null ? Number(r.created_by) : null,
      createdAt: String(r.created_at),
    }));
    res.json({ suspensions: items });
  } catch (err: any) {
    console.error('list space suspensions failed', err);
    res.status(500).json({ error: 'failed_to_list_suspensions', detail: String(err?.message || err) });
  }
});

// Create a suspension (posting or ban) scoped to a space
spacesRouter.post('/api/spaces/:id/suspensions', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    const { userId, kind, degree, reason, days } = (req.body || {}) as any;
    const targetUserId = Number(userId);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const k = String(kind || '').toLowerCase();
    if (k !== 'posting' && k !== 'ban') return res.status(400).json({ error: 'bad_kind' });
    const actorId = Number(req.user!.id);
    const isSiteAdmin = await can(actorId, 'video:delete_any');
    if (!isSiteAdmin) {
      if (k === 'posting') {
        const ok = await can(actorId, 'moderation:suspend_posting', { spaceId });
        if (!ok) return res.status(403).json({ error: 'forbidden' });
      } else {
        const ok = await can(actorId, 'moderation:ban', { spaceId });
        if (!ok) return res.status(403).json({ error: 'forbidden' });
      }
    }
    let endsAt: Date | null = null;
    if (k === 'posting') {
      const d = Number(degree || 1);
      const daysMap = d === 1 ? 1 : d === 2 ? 7 : 30;
      endsAt = new Date(Date.now() + daysMap * 24 * 60 * 60 * 1000);
    } else if (k === 'ban') {
      // Optional limited ban in days
      const d = days != null ? Number(days) : NaN;
      if (Number.isFinite(d) && d > 0) {
        endsAt = new Date(Date.now() + d * 24 * 60 * 60 * 1000);
      }
    }
    const db = getPool();
    await db.query(
      `INSERT INTO suspensions (user_id, target_type, target_id, kind, degree, starts_at, ends_at, reason, created_by)
       VALUES (?, 'space', ?, ?, ?, NOW(), ?, ?, ?)`,
      [targetUserId, spaceId, k, Number(degree || (k === 'posting' ? 1 : 1)), endsAt, reason ? String(reason).slice(0, 255) : null, actorId]
    );
    res.status(201).json({ ok: true });
  } catch (err: any) {
    console.error('create space suspension failed', err);
    res.status(500).json({ error: 'failed_to_create_suspension', detail: String(err?.message || err) });
  }
});

// Revoke a suspension by id (space scoped)
spacesRouter.delete('/api/spaces/:id/suspensions/:sid', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    const sid = Number(req.params.sid);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    if (!Number.isFinite(sid) || sid <= 0) return res.status(400).json({ error: 'bad_suspension_id' });
    const db = getPool();
    const [rows] = await db.query(`SELECT id, user_id, kind FROM suspensions WHERE id = ? AND target_type = 'space' AND target_id = ? LIMIT 1`, [sid, spaceId]);
    const row = (rows as any[])[0];
    if (!row) return res.status(404).json({ error: 'suspension_not_found' });
    const actorId = Number(req.user!.id);
    const isSiteAdmin = await can(actorId, 'video:delete_any');
    if (!isSiteAdmin) {
      if (String(row.kind) === 'posting') {
        const ok = await can(actorId, 'moderation:suspend_posting', { spaceId });
        if (!ok) return res.status(403).json({ error: 'forbidden' });
      } else {
        const ok = await can(actorId, 'moderation:ban', { spaceId });
        if (!ok) return res.status(403).json({ error: 'forbidden' });
      }
    }
    await db.query(`UPDATE suspensions SET ends_at = NOW() WHERE id = ?`, [sid]);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('revoke space suspension failed', err);
    res.status(500).json({ error: 'failed_to_revoke_suspension', detail: String(err?.message || err) });
  }
});
// Moderation queue for a space (pending publications)
spacesRouter.get('/api/spaces/:id/moderation/queue', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    const db = getPool();
    // Permission: space moderator/publisher or site admin
    const userId = Number(req.user!.id);
    const isSiteAdmin = await can(userId, 'video:delete_any');
    const canModerate = isSiteAdmin || (await can(userId, 'video:approve_space', { spaceId })) || (await can(userId, 'video:publish_space', { spaceId }));
    if (!canModerate) return res.status(403).json({ error: 'forbidden' });

    const params: any[] = [spaceId];
    const where: string[] = [
      'sp.space_id = ?',
      "sp.status = 'pending'",
    ];

    const sql = `
      SELECT
        sp.id AS publication_id,
        sp.upload_id,
        sp.production_id,
        sp.space_id,
        sp.status AS publication_status,
        sp.requested_by,
        sp.approved_by,
        sp.visibility AS publication_visibility,
        sp.distribution_flags,
        sp.published_at,
        sp.unpublished_at,
        sp.created_at AS publication_created_at,
        sp.updated_at AS publication_updated_at,
        u.id AS upload_id,
        u.s3_bucket,
        u.s3_key,
        u.original_filename,
        u.modified_filename,
        u.description AS upload_description,
        u.content_type,
        u.size_bytes,
        u.width,
        u.height,
        u.duration_seconds,
        u.status AS upload_status,
        u.etag,
        u.mediaconvert_job_id,
        COALESCE(p.output_prefix, u.output_prefix) AS output_prefix,
        u.asset_uuid,
        u.date_ymd,
        u.profile,
        u.orientation,
        u.created_at AS upload_created_at,
        u.uploaded_at,
        u.user_id AS upload_user_id,
        req.display_name AS requester_display_name,
        req.email AS requester_email
      FROM space_publications sp
      JOIN uploads u ON u.id = sp.upload_id
      LEFT JOIN productions p ON p.id = sp.production_id
      LEFT JOIN users req ON req.id = sp.requested_by
      WHERE ${where.join(' AND ')}
      ORDER BY sp.created_at DESC, sp.id DESC
      LIMIT 200
    `;
    const [rows] = await db.query(sql, params);
    const items = (rows as any[]).map((row) => {
      let distribution: any = null;
      if (row.distribution_flags) {
        try { distribution = JSON.parse(row.distribution_flags); } catch { distribution = null; }
      }
      const publication = {
        id: Number(row.publication_id),
        upload_id: Number(row.upload_id),
        production_id: row.production_id == null ? null : Number(row.production_id),
        space_id: Number(row.space_id),
        status: String(row.publication_status) as SpacePublicationStatus,
        requested_by: row.requested_by == null ? null : Number(row.requested_by),
        approved_by: row.approved_by == null ? null : Number(row.approved_by),
        visibility: (row.publication_visibility || 'inherit') as SpacePublicationVisibility,
        distribution_flags: distribution,
        published_at: row.published_at ? String(row.published_at) : null,
        unpublished_at: row.unpublished_at ? String(row.unpublished_at) : null,
        created_at: String(row.publication_created_at),
        updated_at: String(row.publication_updated_at),
      };
      const uploadRaw: any = {
        id: Number(row.upload_id),
        s3_bucket: row.s3_bucket,
        s3_key: row.s3_key,
        original_filename: row.original_filename,
        modified_filename: row.modified_filename ? String(row.modified_filename) : row.original_filename,
        description: row.upload_description != null ? String(row.upload_description) : null,
        content_type: row.content_type,
        size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
        width: row.width != null ? Number(row.width) : null,
        height: row.height != null ? Number(row.height) : null,
        duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
        status: row.upload_status,
        etag: row.etag,
        mediaconvert_job_id: row.mediaconvert_job_id,
        output_prefix: row.output_prefix,
        asset_uuid: row.asset_uuid,
        date_ymd: row.date_ymd,
        profile: row.profile,
        orientation: row.orientation,
        created_at: String(row.upload_created_at),
        uploaded_at: row.uploaded_at ? String(row.uploaded_at) : null,
        user_id: row.upload_user_id != null ? Number(row.upload_user_id) : null,
        space_id: spaceId,
        origin_space_id: null,
      };
      const upload = enhanceUploadRow(uploadRaw);
      const requester = row.requester_email || row.requester_display_name
        ? { displayName: row.requester_display_name || null, email: row.requester_email || null }
        : null;
      return { publication, upload, requester };
    });
    res.json({ items });
  } catch (err: any) {
    console.error('space moderation queue failed', err);
    res.status(500).json({ error: 'failed_to_load_queue', detail: String(err?.message || err) });
  }
});
// Create new group/channel space
spacesRouter.post('/api/spaces', requireAuth, async (req, res) => {
  try {
    const { type, name } = req.body || {};
    const normalizedType = typeof type === 'string' ? type.trim().toLowerCase() : '';
    if (normalizedType !== 'group' && normalizedType !== 'channel') {
      return res.status(400).json({ error: 'invalid_space_type' });
    }
    const title = typeof name === 'string' && name.trim().length ? name.trim().slice(0, 120) : null;
    if (!title) return res.status(400).json({ error: 'invalid_name' });

    const db = getPool();
    const site = await fetchSiteSettings(db);

    const [userRows] = await db.query(`SELECT can_create_group, can_create_channel FROM users WHERE id = ? LIMIT 1`, [req.user!.id]);
    const user = (userRows as any[])[0];
    if (!user) return res.status(401).json({ error: 'user_not_found' });

    const overrideGroup = user.can_create_group == null ? null : Boolean(Number(user.can_create_group));
    const overrideChannel = user.can_create_channel == null ? null : Boolean(Number(user.can_create_channel));

    let allowed = false;
    if (normalizedType === 'group') {
      const baseline = overrideGroup === null ? site.allowGroupCreation : overrideGroup;
      allowed = baseline && (await can(req.user!.id, 'space:create_group'));
    } else {
      const baseline = overrideChannel === null ? site.allowChannelCreation : overrideChannel;
      allowed = baseline && (await can(req.user!.id, 'space:create_channel'));
    }
    if (!allowed) return res.status(403).json({ error: 'forbidden' });

    const baseSlug = slugify(title);
    let slug = baseSlug;
    let attempt = 1;
    while (true) {
      const [exists] = await db.query(`SELECT id FROM spaces WHERE type = ? AND slug = ? LIMIT 1`, [normalizedType, slug]);
      if (!(exists as any[]).length) break;
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
    }

    const settings = JSON.stringify(defaultSettings(normalizedType));
    const [ins] = await db.query(
      `INSERT INTO spaces (type, owner_user_id, name, slug, settings) VALUES (?, ?, ?, ?, ?)` ,
      [normalizedType, req.user!.id, title, slug, settings]
    );
    const space: SpaceRow = { id: (ins as any).insertId as number, type: normalizedType, owner_user_id: req.user!.id };

    await assignDefaultAdminRoles(db, space, req.user!.id);

    res.status(201).json({
      space: {
        id: space.id,
        type: normalizedType,
        name: title,
        slug,
        settings: JSON.parse(settings),
      },
    });
  } catch (err: any) {
    console.error('create space failed', err);
    res.status(500).json({ error: 'failed_to_create_space', detail: String(err?.message || err) });
  }
});

// List members of a space
spacesRouter.get('/api/spaces/:id/members', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const currentUserId = Number(req.user!.id)
    const data = await spacesSvc.listMembers(spaceId, currentUserId)
    res.json(data)
  } catch (err: any) {
    console.error('list members failed', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_list_members', detail: String(err?.message || err) })
  }
})

// Read space settings (space-admin scope)
spacesRouter.get('/api/spaces/:id/settings', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const currentUserId = Number(req.user!.id)
    const data = await spacesSvc.getSettings(spaceId, currentUserId)
    res.json(data)
  } catch (err: any) {
    console.error('get space settings failed', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_get_space_settings', detail: String(err?.message || err) })
  }
})

// Update space settings (space-admin scope)
spacesRouter.put('/api/spaces/:id/settings', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const currentUserId = Number(req.user!.id)
    const body = (req.body || {}) as any
    const wantComments = body.commentsPolicy
    const wantRequire = body.requireReview
    const data = await spacesSvc.updateSettings(spaceId, currentUserId, { commentsPolicy: wantComments, requireReview: wantRequire })
    res.json(data)
  } catch (err: any) {
    console.error('update space settings failed', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_update_space_settings', detail: String(err?.message || err) })
  }
})

spacesRouter.get('/api/spaces/:id/invitations', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const currentUserId = Number(req.user!.id)
    const data = await spacesSvc.listInvitations(spaceId, currentUserId)
    res.json(data)
  } catch (err: any) {
    console.error('list invitations failed', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_list_invitations', detail: String(err?.message || err) })
  }
})

// Invite a member
spacesRouter.post('/api/spaces/:id/invitations', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    const { userId } = (req.body || {}) as any
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const currentUserId = Number(req.user!.id)
    const result = await spacesSvc.inviteMember(spaceId, Number(userId), currentUserId)
    res.status(201).json(result)
  } catch (err: any) {
    console.error('create invitation failed', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_invite_member', detail: String(err?.message || err) })
  }
})

// Revoke invitation
spacesRouter.delete('/api/spaces/:id/invitations/:userId', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    const inviteeUserId = Number(req.params.userId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(inviteeUserId) || inviteeUserId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const currentUserId = Number(req.user!.id)
    const result = await spacesSvc.revokeInvitation(spaceId, inviteeUserId, currentUserId)
    res.json(result)
  } catch (err: any) {
    console.error('revoke invitation failed', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_revoke_invitation', detail: String(err?.message || err) })
  }
})

// Accept invitation
spacesRouter.post('/api/spaces/:id/invitations/:userId/accept', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    const inviteeUserId = Number(req.params.userId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(inviteeUserId) || inviteeUserId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const currentUserId = Number(req.user!.id)
    const result = await spacesSvc.acceptInvitation(spaceId, inviteeUserId, currentUserId)
    res.json(result)
  } catch (err: any) {
    console.error('accept invitation failed', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_accept_invitation', detail: String(err?.message || err) })
  }
})

// Decline invitation
spacesRouter.post('/api/spaces/:id/invitations/:userId/decline', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    const inviteeUserId = Number(req.params.userId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(inviteeUserId) || inviteeUserId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const currentUserId = Number(req.user!.id)
    const result = await spacesSvc.declineInvitation(spaceId, inviteeUserId, currentUserId)
    res.json(result)
  } catch (err: any) {
    console.error('decline invitation failed', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_decline_invitation', detail: String(err?.message || err) })
  }
})

// Remove a member
spacesRouter.delete('/api/spaces/:id/members/:userId', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) return res.status(400).json({ error: 'bad_user_id' });

    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const currentUserId = req.user!.id;
    if (currentUserId !== targetUserId) {
      const allowed = (await ensurePermission(currentUserId, spaceId, 'space:manage_members')) || (await can(currentUserId, 'video:delete_any'));
      if (!allowed) return res.status(403).json({ error: 'forbidden' });
    }

    if (space.owner_user_id === targetUserId && !(await can(currentUserId, 'video:delete_any'))) {
      return res.status(400).json({ error: 'cannot_remove_owner' });
    }

    await removeAllRoles(db, spaceId, targetUserId);
    await db.query(`UPDATE space_invitations SET status = 'revoked', responded_at = NOW() WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending'`, [spaceId, targetUserId]);

    res.json({ ok: true });
  } catch (err: any) {
    console.error('remove member failed', err);
    res.status(500).json({ error: 'failed_to_remove_member', detail: String(err?.message || err) });
  }
});

// Delete a space
spacesRouter.delete('/api/spaces/:id', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const currentUserId = Number(req.user!.id)
    const data = await spacesSvc.deleteSpace(spaceId, currentUserId)
    res.json(data)
  } catch (err: any) {
    console.error('delete space failed', err)
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_delete_space', detail: String(err?.message || err) })
  }
})

spacesRouter.get('/api/spaces/:id/feed', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });

    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const userId = Number(req.user!.id);
    const allowed = await spacesSvc.canViewSpaceFeed(space, userId);
    if (!allowed) return res.status(403).json({ error: 'forbidden' });
    const limitRaw = Number(req.query.limit ?? 20)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
    const data = await feedsSvc.getSpaceFeed(spaceId, { limit, cursor })
    res.json(data)
  } catch (err: any) {
    console.error('space feed failed', err);
    res.status(500).json({ error: 'failed_to_load_feed', detail: String(err?.message || err) });
  }
});

// Global feed aggregator: includes items explicitly marked visible_in_global and published
spacesRouter.get('/api/feed/global', requireAuth, async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit ?? 20)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
    const data = await feedsSvc.getGlobalFeed({ limit, cursor })
    res.json(data)
  } catch (err: any) {
    console.error('global feed failed', err);
    res.status(500).json({ error: 'failed_to_load_global_feed', detail: String(err?.message || err) });
  }
});

export default spacesRouter;
