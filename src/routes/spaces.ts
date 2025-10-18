import { Router } from 'express';
import { getPool } from '../db';
import { requireAuth } from '../middleware/auth';
import { can } from '../security/permissions';

const spacesRouter = Router();

type SpaceType = 'personal' | 'group' | 'channel';
type SpaceRow = { id: number; type: SpaceType; owner_user_id: number | null };

type SiteSettings = {
  allowGroupCreation: boolean;
  allowChannelCreation: boolean;
};

const MEMBER_ROLES: Record<SpaceType, string[]> = {
  personal: ['publisher', 'member'],
  group: ['group_member'],
  channel: ['channel_member'],
};

const ADMIN_ROLES: Record<SpaceType, string[]> = {
  personal: ['publisher', 'member'],
  group: ['group_admin', 'group_member'],
  channel: ['channel_admin', 'channel_member'],
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

async function loadSpace(db: any, spaceId: number): Promise<SpaceRow | null> {
  const [rows] = await db.query(`SELECT id, type, owner_user_id FROM spaces WHERE id = ? LIMIT 1`, [spaceId]);
  const row = (rows as any[])[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    type: String(row.type) as SpaceType,
    owner_user_id: row.owner_user_id != null ? Number(row.owner_user_id) : null,
  };
}

async function isMember(db: any, spaceId: number, userId: number): Promise<boolean> {
  const [rows] = await db.query(`SELECT 1 FROM user_space_roles WHERE space_id = ? AND user_id = ? LIMIT 1`, [spaceId, userId]);
  return (rows as any[]).length > 0;
}

async function assignRoles(db: any, space: SpaceRow, userId: number, roles: string[]): Promise<void> {
  if (!roles.length) return;
  await db.query(
    `INSERT IGNORE INTO user_space_roles (user_id, space_id, role_id)
       SELECT ?, ?, r.id FROM roles r WHERE r.name IN (${roles.map(() => '?').join(',')})`,
    [userId, space.id, ...roles]
  );
}

async function assignDefaultMemberRoles(db: any, space: SpaceRow, userId: number): Promise<void> {
  const roles = MEMBER_ROLES[space.type] || [];
  await assignRoles(db, space, userId, roles);
}

async function assignDefaultAdminRoles(db: any, space: SpaceRow, userId: number): Promise<void> {
  const roles = ADMIN_ROLES[space.type] || [];
  await assignRoles(db, space, userId, roles);
}

async function fetchInvitations(db: any, spaceId: number) {
  const [rows] = await db.query(
    `SELECT invitee_user_id, status, created_at
       FROM space_invitations
      WHERE space_id = ?
      ORDER BY created_at DESC`
    , [spaceId]
  );
  return (rows as any[]).map((row) => ({
    userId: Number(row.invitee_user_id),
    status: String(row.status),
    createdAt: String(row.created_at),
  }));
}

async function removeAllRoles(db: any, spaceId: number, userId: number): Promise<void> {
  await db.query(`DELETE FROM user_space_roles WHERE space_id = ? AND user_id = ?`, [spaceId, userId]);
}

async function ensurePermission(userId: number, spaceId: number, permission: string): Promise<boolean> {
  return can(userId, permission as any, { spaceId });
}

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
    const space = await loadSpace(db, spaceId);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const currentUserId = req.user!.id;
    const siteAdmin = await can(currentUserId, 'video:delete_any');
    const member = await isMember(db, spaceId, currentUserId);
    const viewAllowed = siteAdmin || member || (await ensurePermission(currentUserId, spaceId, 'space:view_private'));
    if (!viewAllowed) return res.status(403).json({ error: 'forbidden' });

    const [rows] = await db.query(
      `SELECT u.id, u.email, u.display_name, GROUP_CONCAT(r.name ORDER BY r.name) AS roles
         FROM user_space_roles usr
         JOIN users u ON u.id = usr.user_id
         JOIN roles r ON r.id = usr.role_id
        WHERE usr.space_id = ?
        GROUP BY u.id, u.email, u.display_name
        ORDER BY u.display_name IS NULL, u.display_name`,
      [spaceId]
    );

    const members = (rows as any[]).map((row) => ({
      userId: Number(row.id),
      email: row.email,
      displayName: row.display_name,
      roles: typeof row.roles === 'string' ? row.roles.split(',') : [],
    }));

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
    const space = await loadSpace(db, spaceId);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const currentUserId = req.user!.id;
    const siteAdmin = await can(currentUserId, 'video:delete_any');
    const member = await isMember(db, spaceId, currentUserId);
    const viewAllowed = siteAdmin || member || (await ensurePermission(currentUserId, spaceId, 'space:view_private'));
    if (!viewAllowed) return res.status(403).json({ error: 'forbidden' });

    const invitations = await fetchInvitations(db, spaceId);
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
    const space = await loadSpace(db, spaceId);
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
    const space = await loadSpace(db, spaceId);
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
    const space = await loadSpace(db, spaceId);
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
    const space = await loadSpace(db, spaceId);
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
    const space = await loadSpace(db, spaceId);
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

export default spacesRouter;
