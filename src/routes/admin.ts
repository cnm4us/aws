import { Router } from 'express';
import { getPool } from '../db';
import { requireAuth, requireSiteAdmin } from '../middleware/auth';
import {
  assignDefaultMemberRoles,
  assignRoles,
  getDefaultMemberRoles,
  listSpaceInvitations,
  listSpaceMembers,
  loadSpace,
  removeAllRoles,
} from '../services/spaceMembership';

type NullableBool = boolean | null;

function dbBool(value: any): boolean {
  return Boolean(Number(value));
}

function toNullableBool(value: any): NullableBool {
  if (value === null) return null;
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    if (v === 'null' || v === '') return null;
  }
  throw new Error('invalid_boolean');
}

function toDbValue(value: NullableBool): number | null {
  if (value === null) return null;
  return value ? 1 : 0;
}

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.use(requireSiteAdmin);

adminRouter.get('/site-settings', async (_req, res) => {
  try {
    const db = getPool();
    const [rows] = await db.query(`SELECT allow_group_creation, allow_channel_creation FROM site_settings WHERE id = 1 LIMIT 1`);
    const row = (rows as any[])[0];
    if (!row) return res.status(500).json({ error: 'missing_site_settings' });
    res.json({
      allowGroupCreation: dbBool(row.allow_group_creation),
      allowChannelCreation: dbBool(row.allow_channel_creation),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_fetch_site_settings', detail: String(err?.message || err) });
  }
});

adminRouter.put('/site-settings', async (req, res) => {
  try {
    const { allowGroupCreation, allowChannelCreation } = req.body || {};
    if (typeof allowGroupCreation !== 'boolean' || typeof allowChannelCreation !== 'boolean') {
      return res.status(400).json({ error: 'invalid_payload' });
    }
    const db = getPool();
    await db.query(
      `UPDATE site_settings SET allow_group_creation = ?, allow_channel_creation = ? WHERE id = 1`,
      [allowGroupCreation ? 1 : 0, allowChannelCreation ? 1 : 0]
    );
    res.json({ ok: true, allowGroupCreation, allowChannelCreation });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_update_site_settings', detail: String(err?.message || err) });
  }
});

adminRouter.get('/users/:id/capabilities', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const db = getPool();
    const [userRows] = await db.query(
      `SELECT id, can_create_group, can_create_channel FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    const user = (userRows as any[])[0];
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const [siteRows] = await db.query(`SELECT allow_group_creation, allow_channel_creation FROM site_settings WHERE id = 1 LIMIT 1`);
    const site = (siteRows as any[])[0];
    if (!site) return res.status(500).json({ error: 'missing_site_settings' });

    const siteGroup = dbBool(site.allow_group_creation);
    const siteChannel = dbBool(site.allow_channel_creation);
    const overrideGroup = user.can_create_group == null ? null : dbBool(user.can_create_group);
    const overrideChannel = user.can_create_channel == null ? null : dbBool(user.can_create_channel);

    res.json({
      userId,
      overrides: {
        canCreateGroup: overrideGroup,
        canCreateChannel: overrideChannel,
      },
      effective: {
        canCreateGroup: overrideGroup === null ? siteGroup : overrideGroup,
        canCreateChannel: overrideChannel === null ? siteChannel : overrideChannel,
      },
      siteDefaults: {
        allowGroupCreation: siteGroup,
        allowChannelCreation: siteChannel,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_fetch_user_capabilities', detail: String(err?.message || err) });
  }
});

adminRouter.put('/users/:id/capabilities', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const { canCreateGroup, canCreateChannel } = req.body || {};

    const updates: string[] = [];
    const params: Array<number | null> = [];

    if (canCreateGroup !== undefined) {
      let value: NullableBool;
      if (canCreateGroup === null) value = null;
      else if (typeof canCreateGroup === 'boolean') value = canCreateGroup;
      else value = toNullableBool(canCreateGroup);
      updates.push('can_create_group = ?');
      params.push(toDbValue(value));
    }

    if (canCreateChannel !== undefined) {
      let value: NullableBool;
      if (canCreateChannel === null) value = null;
      else if (typeof canCreateChannel === 'boolean') value = canCreateChannel;
      else value = toNullableBool(canCreateChannel);
      updates.push('can_create_channel = ?');
      params.push(toDbValue(value));
    }

    if (!updates.length) return res.status(400).json({ error: 'no_fields_to_update' });

    const db = getPool();
    const [result] = await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...params, userId]);
    const info = result as any;
    if ((info.affectedRows || 0) === 0) return res.status(404).json({ error: 'user_not_found' });

    // return the refreshed capabilities
    const [userRows] = await db.query(`SELECT can_create_group, can_create_channel FROM users WHERE id = ?`, [userId]);
    const user = (userRows as any[])[0];
    const [siteRows] = await db.query(`SELECT allow_group_creation, allow_channel_creation FROM site_settings WHERE id = 1 LIMIT 1`);
    const site = (siteRows as any[])[0];

    const siteGroup = dbBool(site.allow_group_creation);
    const siteChannel = dbBool(site.allow_channel_creation);
    const overrideGroup = user.can_create_group == null ? null : dbBool(user.can_create_group);
    const overrideChannel = user.can_create_channel == null ? null : dbBool(user.can_create_channel);

    res.json({
      userId,
      overrides: {
        canCreateGroup: overrideGroup,
        canCreateChannel: overrideChannel,
      },
      effective: {
        canCreateGroup: overrideGroup === null ? siteGroup : overrideGroup,
        canCreateChannel: overrideChannel === null ? siteChannel : overrideChannel,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_update_user_capabilities', detail: String(err?.message || err) });
  }
});

adminRouter.get('/spaces', async (req, res) => {
  try {
    const { type } = req.query as { type?: string };
    const db = getPool();
    const types = ['group', 'channel'];
    let sql = `SELECT id, type, name, slug, owner_user_id FROM spaces WHERE type IN ('group','channel')`;
    const params: any[] = [];
    if (type && types.includes(type.toLowerCase())) {
      sql += ` AND type = ?`;
      params.push(type.toLowerCase());
    }
    sql += ` ORDER BY type, name`;
    const [rows] = await db.query(sql, params);
    const spaces = (rows as any[]).map((row) => ({
      id: Number(row.id),
      type: String(row.type),
      name: row.name,
      slug: row.slug,
      ownerUserId: row.owner_user_id ? Number(row.owner_user_id) : null,
    }));
    res.json({ spaces });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_list_spaces', detail: String(err?.message || err) });
  }
});

adminRouter.get('/spaces/:id/members', async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      return res.status(400).json({ error: 'bad_space_id' });
    }
    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });
    const members = await listSpaceMembers(db, spaceId);
    res.json({ spaceId, members });
  } catch (err: any) {
    console.error('admin list space members failed', err);
    res.status(500).json({ error: 'failed_to_list_members', detail: String(err?.message || err) });
  }
});

adminRouter.delete('/spaces/:id/members/:userId', async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    const userId = Number(req.params.userId);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });

    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    await removeAllRoles(db, spaceId, userId);
    await db.query(
      `UPDATE space_invitations SET status = 'revoked', responded_at = NOW()
        WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending'`,
      [spaceId, userId]
    );

    res.json({ ok: true });
  } catch (err: any) {
    console.error('admin remove member failed', err);
    res.status(500).json({ error: 'failed_to_remove_member', detail: String(err?.message || err) });
  }
});

adminRouter.get('/spaces/:id/invitations', async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      return res.status(400).json({ error: 'bad_space_id' });
    }
    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });
    const invitations = await listSpaceInvitations(db, spaceId);
    res.json({ spaceId, invitations });
  } catch (err: any) {
    console.error('admin list invitations failed', err);
    res.status(500).json({ error: 'failed_to_list_invitations', detail: String(err?.message || err) });
  }
});

adminRouter.delete('/spaces/:id/invitations/:userId', async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    const userId = Number(req.params.userId);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });

    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    await db.query(
      `UPDATE space_invitations SET status = 'revoked', responded_at = NOW()
        WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending'`,
      [spaceId, userId]
    );

    res.json({ ok: true });
  } catch (err: any) {
    console.error('admin revoke invitation failed', err);
    res.status(500).json({ error: 'failed_to_revoke_invitation', detail: String(err?.message || err) });
  }
});

adminRouter.post('/spaces/:id/members', async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    const { userId, roles } = req.body || {};
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      return res.status(400).json({ error: 'bad_space_id' });
    }
    const parsedUserId = Number(userId);
    if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) {
      return res.status(400).json({ error: 'bad_user_id' });
    }

    const db = getPool();
    const space = await loadSpace(spaceId, db);
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    if (space.type !== 'group' && space.type !== 'channel') {
      return res.status(400).json({ error: 'unsupported_space_type' });
    }

    const [userRows] = await db.query(
      `SELECT id, email, display_name FROM users WHERE id = ? LIMIT 1`,
      [parsedUserId]
    );
    const user = (userRows as any[])[0];
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    let roleNames: string[] | null = null;
    if (Array.isArray(roles)) {
      roleNames = roles
        .map((r: any) => (typeof r === 'string' ? r.trim() : String(r || '')).toLowerCase())
        .filter((r: string) => r.length > 0);
      if (!roleNames.length) roleNames = null;
    }

    if (roleNames && roleNames.length) {
      await assignRoles(db, space, parsedUserId, roleNames);
    } else {
      roleNames = getDefaultMemberRoles(space.type);
      if (!roleNames.length) {
        return res.status(400).json({ error: 'no_default_roles' });
      }
      await assignDefaultMemberRoles(db, space, parsedUserId);
    }

    await db.query(
      `UPDATE space_invitations
          SET status = 'accepted', responded_at = NOW()
        WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending'`,
      [spaceId, parsedUserId]
    );

    const [roleRows] = await db.query(
      `SELECT r.name
         FROM user_space_roles usr
         JOIN roles r ON r.id = usr.role_id
        WHERE usr.space_id = ? AND usr.user_id = ?
        ORDER BY r.name`,
      [spaceId, parsedUserId]
    );
    const assignedRoles = (roleRows as any[]).map((row) => String(row.name));

    if (!assignedRoles.length) {
      return res.status(400).json({ error: 'roles_not_assigned' });
    }

    res.json({
      ok: true,
      spaceId,
      user: {
        id: Number(user.id),
        email: user.email,
        displayName: user.display_name,
      },
      roles: assignedRoles,
    });
  } catch (err: any) {
    console.error('admin add member failed', err);
    res.status(500).json({ error: 'failed_to_add_member', detail: String(err?.message || err) });
  }
});

export default adminRouter;
