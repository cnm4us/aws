import { Router } from 'express';
import { getPool, SpacePublicationStatus, SpacePublicationVisibility } from '../db';
import { requireAuth } from '../middleware/auth';
import { can } from '../security/permissions';
import { enhanceUploadRow } from '../utils/enhance';
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
    publishing: { requireApproval: false, targets: ['channel'] },
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

async function ensurePermission(userId: number, spaceId: number, permission: string): Promise<boolean> {
  return can(userId, permission as any, { spaceId });
}

function parseSpaceSettings(space: SpaceRow | null): any {
  if (!space || space.settings == null) return {};
  if (typeof space.settings === 'object') return space.settings;
  try {
    return JSON.parse(String(space.settings));
  } catch {
    return {};
  }
}

function settingsAllowPublicView(settings: any): boolean {
  if (!settings || typeof settings !== 'object') return false;
  const visibility = typeof settings.visibility === 'string' ? settings.visibility.toLowerCase() : '';
  if (visibility === 'public' || visibility === 'global') return true;
  if (settings.allowAnonymousAccess === true) return true;
  if (settings.publicFeed === true) return true;
  return false;
}

async function hasActiveSubscription(db: any, spaceId: number, userId: number): Promise<boolean> {
  const [rows] = await db.query(
    `SELECT 1 FROM space_subscriptions
      WHERE user_id = ? AND space_id = ? AND status = 'active' AND (ended_at IS NULL OR ended_at > NOW())
      LIMIT 1`,
    [userId, spaceId]
  );
  return (rows as any[]).length > 0;
}

async function canViewSpaceFeed(db: any, space: SpaceRow, userId: number): Promise<boolean> {
  const siteAdmin = await can(userId, 'video:delete_any');
  if (siteAdmin) return true;
  if (space.owner_user_id != null && space.owner_user_id === userId) return true;
  if (await isMember(db, space.id, userId)) return true;
  if (space.type === 'channel' && (await hasActiveSubscription(db, space.id, userId))) return true;
  const settings = parseSpaceSettings(space);
  return settingsAllowPublicView(settings);
}

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
    const db = getPool();
    const userId = Number(req.user!.id);

    // Personal space (owner)
    const [personalRows] = await db.query(
      `SELECT id, name, slug, type FROM spaces WHERE type = 'personal' AND owner_user_id = ? LIMIT 1`,
      [userId]
    );
    const personalRow = (personalRows as any[])[0] || null;
    const personal = personalRow
      ? mapSpaceSummary({ ...personalRow }, 'owner', false)
      : null;

    // Group memberships
    const [groupRows] = await db.query(
      `SELECT s.id, s.name, s.slug, s.type,
              MAX(CASE WHEN r.name = 'group_admin' THEN 1 ELSE 0 END) AS is_admin
         FROM user_space_roles usr
         JOIN spaces s ON s.id = usr.space_id
         JOIN roles r ON r.id = usr.role_id
        WHERE usr.user_id = ? AND s.type = 'group'
        GROUP BY s.id, s.name, s.slug, s.type
        ORDER BY s.name`,
      [userId]
    );
    const groups: SpaceSummary[] = (groupRows as any[]).map((row) =>
      mapSpaceSummary(row, Number(row.is_admin) ? 'admin' : 'member', false)
    );

    // Channel memberships
    const [channelRows] = await db.query(
      `SELECT s.id, s.name, s.slug, s.type,
              MAX(CASE WHEN r.name = 'channel_admin' THEN 1 ELSE 0 END) AS is_admin
         FROM user_space_roles usr
         JOIN spaces s ON s.id = usr.space_id
         JOIN roles r ON r.id = usr.role_id
        WHERE usr.user_id = ? AND s.type = 'channel'
        GROUP BY s.id, s.name, s.slug, s.type
        ORDER BY s.name`,
      [userId]
    );
    const channelMemberships: SpaceSummary[] = (channelRows as any[]).map((row) =>
      mapSpaceSummary(row, Number(row.is_admin) ? 'admin' : 'member', false)
    );

    // Channel subscriptions (active)
    const [subscriptionRows] = await db.query(
      `SELECT s.id, s.name, s.slug, s.type
         FROM space_subscriptions sub
         JOIN spaces s ON s.id = sub.space_id
        WHERE sub.user_id = ? AND sub.status = 'active'`,
      [userId]
    );
    const channelSubscriptions: SpaceSummary[] = (subscriptionRows as any[])
      .filter((row) => String(row.type) === 'channel')
      .map((row) => mapSpaceSummary(row, 'subscriber', true));

    const channels = mergeChannelEntries(channelMemberships, channelSubscriptions);

    // Attempt to find a designated global space
    let global: SpaceSummary | null = null;
    const [globalSlugRows] = await db.query(
      `SELECT id, name, slug, type, settings
         FROM spaces
        WHERE slug IN ('global', 'global-feed')
        ORDER BY slug = 'global' DESC
        LIMIT 1`
    );
    const globalCandidate = (globalSlugRows as any[])[0] || null;
    if (globalCandidate) {
      global = mapSpaceSummary(globalCandidate, 'member', false);
    } else {
      const [channelCandidates] = await db.query(
        `SELECT id, name, slug, type, settings FROM spaces WHERE type = 'channel' LIMIT 50`
      );
      for (const row of channelCandidates as any[]) {
        const settings = parseSpaceSettings(row);
        if (settings && (settings.global === true || settings.isGlobal === true || settings.feed === 'global')) {
          global = mapSpaceSummary(row, 'member', false);
          break;
        }
      }
    }

    res.json({
      personal,
      global,
      groups,
      channels,
    });
  } catch (err: any) {
    console.error('list my spaces failed', err);
    res.status(500).json({ error: 'failed_to_list_spaces', detail: String(err?.message || err) });
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
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const currentUserId = req.user!.id;
    const siteAdmin = await can(currentUserId, 'video:delete_any');
    const member = await isMember(db, spaceId, currentUserId);
    const viewAllowed = siteAdmin || member || (await ensurePermission(currentUserId, spaceId, 'space:view_private'));
    if (!viewAllowed) return res.status(403).json({ error: 'forbidden' });

    const members = await listSpaceMembers(db, spaceId);

    res.json({ members });
  } catch (err: any) {
    console.error('list members failed', err);
    res.status(500).json({ error: 'failed_to_list_members', detail: String(err?.message || err) });
  }
});

spacesRouter.get('/api/spaces/:id/invitations', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const currentUserId = req.user!.id;
    const siteAdmin = await can(currentUserId, 'video:delete_any');
    const member = await isMember(db, spaceId, currentUserId);
    const viewAllowed = siteAdmin || member || (await ensurePermission(currentUserId, spaceId, 'space:view_private'));
    if (!viewAllowed) return res.status(403).json({ error: 'forbidden' });

    const invitations = await listSpaceInvitations(db, spaceId);
    res.json({ invitations });
  } catch (err: any) {
    console.error('list invitations failed', err);
    res.status(500).json({ error: 'failed_to_list_invitations', detail: String(err?.message || err) });
  }
});

// Invite a member
spacesRouter.post('/api/spaces/:id/invitations', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    const { userId } = req.body || {};
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });

    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const currentUserId = req.user!.id;
    const allowed = (await ensurePermission(currentUserId, spaceId, 'space:invite_members')) || (await ensurePermission(currentUserId, spaceId, 'space:manage_members')) || (await can(currentUserId, 'video:delete_any'));
    if (!allowed) return res.status(403).json({ error: 'forbidden' });

    if (space.owner_user_id === userId) return res.status(400).json({ error: 'cannot_invite_owner' });
    if (await isMember(db, spaceId, userId)) return res.status(409).json({ error: 'already_member' });

    const [userRows] = await db.query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [userId]);
    if (!(userRows as any[]).length) return res.status(404).json({ error: 'user_not_found' });

    const [inviteRows] = await db.query(`SELECT id, status FROM space_invitations WHERE space_id = ? AND invitee_user_id = ? LIMIT 1`, [spaceId, userId]);
    const existingInvite = (inviteRows as any[])[0];
    if (existingInvite) {
      const inv = existingInvite as any;
      if (inv.status === 'pending') return res.status(409).json({ error: 'invitation_pending' });
      await db.query(`UPDATE space_invitations SET status = 'pending', inviter_user_id = ?, responded_at = NULL WHERE id = ?`, [currentUserId, inv.id]);
    } else {
      await db.query(
        `INSERT INTO space_invitations (space_id, inviter_user_id, invitee_user_id, status)
         VALUES (?, ?, ?, 'pending')`,
        [spaceId, currentUserId, userId]
      );
    }

    res.status(201).json({ ok: true });
  } catch (err: any) {
    console.error('create invitation failed', err);
    res.status(500).json({ error: 'failed_to_invite_member', detail: String(err?.message || err) });
  }
});

// Revoke invitation
spacesRouter.delete('/api/spaces/:id/invitations/:userId', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    const inviteeUserId = Number(req.params.userId);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    if (!Number.isFinite(inviteeUserId) || inviteeUserId <= 0) return res.status(400).json({ error: 'bad_user_id' });

    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const currentUserId = req.user!.id;
    const allowed = (await ensurePermission(currentUserId, spaceId, 'space:invite_members')) || (await ensurePermission(currentUserId, spaceId, 'space:manage_members')) || (await can(currentUserId, 'video:delete_any'));
    if (!allowed) return res.status(403).json({ error: 'forbidden' });

    const [inviteRows] = await db.query(`SELECT id FROM space_invitations WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending' LIMIT 1`, [spaceId, inviteeUserId]);
    const invitation = (inviteRows as any[])[0];
    if (!invitation) return res.status(404).json({ error: 'invitation_not_found' });
    await db.query(`UPDATE space_invitations SET status = 'revoked', responded_at = NOW() WHERE id = ?`, [invitation.id]);

    res.json({ ok: true });
  } catch (err: any) {
    console.error('revoke invitation failed', err);
    res.status(500).json({ error: 'failed_to_revoke_invitation', detail: String(err?.message || err) });
  }
});

// Accept invitation
spacesRouter.post('/api/spaces/:id/invitations/:userId/accept', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    const inviteeUserId = Number(req.params.userId);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    if (!Number.isFinite(inviteeUserId) || inviteeUserId <= 0) return res.status(400).json({ error: 'bad_user_id' });

    if (req.user!.id !== inviteeUserId && !(await can(req.user!.id, 'video:delete_any'))) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const [inviteRows] = await db.query(`SELECT id FROM space_invitations WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending' LIMIT 1`, [spaceId, inviteeUserId]);
    const invitation = (inviteRows as any[])[0];
    if (!invitation) return res.status(404).json({ error: 'invitation_not_found' });
    await db.query(`UPDATE space_invitations SET status = 'accepted', responded_at = NOW() WHERE id = ?`, [invitation.id]);

    await assignDefaultMemberRoles(db, space, inviteeUserId);

    res.json({ ok: true });
  } catch (err: any) {
    console.error('accept invitation failed', err);
    res.status(500).json({ error: 'failed_to_accept_invitation', detail: String(err?.message || err) });
  }
});

// Decline invitation
spacesRouter.post('/api/spaces/:id/invitations/:userId/decline', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    const inviteeUserId = Number(req.params.userId);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    if (!Number.isFinite(inviteeUserId) || inviteeUserId <= 0) return res.status(400).json({ error: 'bad_user_id' });

    if (req.user!.id !== inviteeUserId && !(await can(req.user!.id, 'video:delete_any'))) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const db = getPool();
    const [inviteRows] = await db.query(`SELECT id FROM space_invitations WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending' LIMIT 1`, [spaceId, inviteeUserId]);
    const invitation = (inviteRows as any[])[0];
    if (!invitation) return res.status(404).json({ error: 'invitation_not_found' });
    await db.query(`UPDATE space_invitations SET status = 'declined', responded_at = NOW() WHERE id = ?`, [invitation.id]);

    res.json({ ok: true });
  } catch (err: any) {
    console.error('decline invitation failed', err);
    res.status(500).json({ error: 'failed_to_decline_invitation', detail: String(err?.message || err) });
  }
});

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
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });

    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const currentUserId = req.user!.id;
    let allowed = false;
    if (space.owner_user_id && space.owner_user_id === currentUserId) allowed = true;
    if (!allowed && (await can(currentUserId, 'video:delete_any'))) allowed = true;
    if (!allowed && (await ensurePermission(currentUserId, spaceId, 'space:manage'))) allowed = true;
    if (!allowed && (await ensurePermission(currentUserId, spaceId, 'space:manage_members'))) allowed = true;
    if (!allowed) return res.status(403).json({ error: 'forbidden' });

    if (space.type === 'personal' && !(await can(currentUserId, 'video:delete_any'))) {
      return res.status(400).json({ error: 'cannot_delete_personal_space' });
    }

    await db.query(`DELETE FROM user_space_roles WHERE space_id = ?`, [spaceId]);
    await db.query(`DELETE FROM space_follows WHERE space_id = ?`, [spaceId]);
    await db.query(`DELETE FROM space_invitations WHERE space_id = ?`, [spaceId]);
    await db.query(`DELETE FROM spaces WHERE id = ?`, [spaceId]);

    res.json({ ok: true });
  } catch (err: any) {
    console.error('delete space failed', err);
    res.status(500).json({ error: 'failed_to_delete_space', detail: String(err?.message || err) });
  }
});

spacesRouter.get('/api/spaces/:id/feed', requireAuth, async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });

    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const userId = Number(req.user!.id);
    const allowed = await canViewSpaceFeed(db, space, userId);
    if (!allowed) return res.status(403).json({ error: 'forbidden' });

    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
    let cursorPublishedAt: string | null = null;
    let cursorId: number | null = null;
    if (cursor) {
      const [tsPart, idPart] = cursor.split('|');
      if (tsPart && idPart) {
        cursorPublishedAt = tsPart;
        const parsedId = Number(idPart);
        if (Number.isFinite(parsedId) && parsedId > 0) {
          cursorId = parsedId;
        }
      }
    }

    const params: any[] = [spaceId];
    const where: string[] = [
      'sp.space_id = ?',
      "sp.status = 'published'",
      'sp.published_at IS NOT NULL',
      "u.status = 'completed'",
    ];
    if (cursorPublishedAt && cursorId != null) {
      where.push('(sp.published_at < ? OR (sp.published_at = ? AND sp.id < ?))');
      params.push(cursorPublishedAt, cursorPublishedAt, cursorId);
    }

    const sql = `
      SELECT
        sp.id AS publication_id,
        sp.upload_id,
        sp.space_id,
        sp.status AS publication_status,
        sp.requested_by,
        sp.approved_by,
        sp.is_primary,
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
        u.content_type,
        u.size_bytes,
        u.width,
        u.height,
        u.duration_seconds,
        u.status AS upload_status,
        u.etag,
        u.mediaconvert_job_id,
        u.output_prefix,
        u.asset_uuid,
        u.date_ymd,
        u.profile,
        u.orientation,
        u.created_at AS upload_created_at,
        u.uploaded_at,
        u.user_id AS upload_user_id,
        u.space_id AS upload_space_id,
        u.origin_space_id,
        owner.id AS owner_id,
        owner.display_name AS owner_display_name,
        owner.email AS owner_email
      FROM space_publications sp
      JOIN uploads u ON u.id = sp.upload_id
      LEFT JOIN users owner ON owner.id = u.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY sp.published_at DESC, sp.id DESC
      LIMIT ?
    `;
    params.push(limit);

    const [rows] = await db.query(sql, params);
    const items = (rows as any[]).map((row) => {
      let distribution: any = null;
      if (row.distribution_flags) {
        try { distribution = JSON.parse(row.distribution_flags); } catch { distribution = null; }
      }
      const publication = {
        id: Number(row.publication_id),
        upload_id: Number(row.upload_id),
        space_id: Number(row.space_id),
        status: String(row.publication_status) as SpacePublicationStatus,
        requested_by: row.requested_by == null ? null : Number(row.requested_by),
        approved_by: row.approved_by == null ? null : Number(row.approved_by),
        is_primary: Boolean(Number(row.is_primary)),
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
        space_id: row.upload_space_id != null ? Number(row.upload_space_id) : null,
        origin_space_id: row.origin_space_id != null ? Number(row.origin_space_id) : null,
      };
      const upload = enhanceUploadRow(uploadRaw);
      const owner = row.owner_id
        ? {
            id: Number(row.owner_id),
            displayName: row.owner_display_name,
            email: row.owner_email,
          }
        : null;
      return { publication, upload, owner };
    });

    let nextCursor: string | null = null;
    if ((rows as any[]).length === limit && items.length) {
      const last = items[items.length - 1].publication;
      if (last.published_at) {
        nextCursor = `${last.published_at}|${last.id}`;
      }
    }

    res.json({ items, nextCursor });
  } catch (err: any) {
    console.error('space feed failed', err);
    res.status(500).json({ error: 'failed_to_load_feed', detail: String(err?.message || err) });
  }
});

export default spacesRouter;
