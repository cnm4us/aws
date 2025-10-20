import { Router } from 'express';
import { getPool } from '../db';
import { requireAuth, requireSiteAdmin } from '../middleware/auth';
import crypto from 'crypto';
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

// ---------- Roles ----------
adminRouter.get('/roles', async (_req, res) => {
  try {
    const db = getPool();
    const [rows] = await db.query(`SELECT id, name FROM roles ORDER BY name`);
    res.json({ roles: (rows as any[]).map((r) => ({ id: Number(r.id), name: String(r.name) })) });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_list_roles', detail: String(err?.message || err) });
  }
});

// ---------- Users ----------
function scryptHash(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const N = 16384; // Align with register implementation
  const hash = crypto.scryptSync(password, salt, 64, { N }).toString('hex');
  return `s2$${N}$${salt}$${hash}`;
}

adminRouter.get('/users', async (req, res) => {
  try {
    const db = getPool();
    const search = (req.query.search ? String(req.query.search) : '').trim();
    const includeDeleted = String(req.query.include_deleted || '') === '1';
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const where: string[] = [];
    const params: any[] = [];
    if (!includeDeleted) where.push('deleted_at IS NULL');
    if (search) {
      where.push('(email LIKE ? OR display_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await db.query(
      `SELECT id, email, display_name, created_at, updated_at, deleted_at
         FROM users
         ${whereSql}
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const users = (rows as any[]).map((r) => ({
      id: Number(r.id),
      email: r.email,
      displayName: r.display_name,
      createdAt: String(r.created_at),
      updatedAt: r.updated_at ? String(r.updated_at) : null,
      deletedAt: r.deleted_at ? String(r.deleted_at) : null,
    }));
    res.json({ users, limit, offset });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_list_users', detail: String(err?.message || err) });
  }
});

adminRouter.post('/users', async (req, res) => {
  try {
    const { email, displayName, password } = (req.body || {}) as any;
    const e = String(email || '').trim().toLowerCase();
    const dn = (displayName ? String(displayName) : '').trim().slice(0, 255);
    const pw = String(password || '');
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.status(400).json({ error: 'invalid_email' });
    if (!pw || pw.length < 8) return res.status(400).json({ error: 'weak_password', detail: 'min_length_8' });
    const passwordHash = scryptHash(pw);
    const db = getPool();
    const [ins] = await db.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES (?, ?, ?)`,
      [e, passwordHash, dn || e]
    );
    const userId = Number((ins as any).insertId);
    // Create personal space for the user to align with register route
    const slug = e.split('@')[0].replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || `user-${userId}`;
    const settings = { visibility: 'public', membership: 'none', publishing: 'owner_only', moderation: 'none', follow_enabled: true };
    try {
      await db.query(
        `INSERT INTO spaces (type, owner_user_id, name, slug, settings) VALUES ('personal', ?, ?, ?, ?)`,
        [userId, dn || e, slug, JSON.stringify(settings)]
      );
    } catch {}
    res.status(201).json({ id: userId, email: e, displayName: dn || e });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_create_user', detail: String(err?.message || err) });
  }
});

adminRouter.get('/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const db = getPool();
    const [rows] = await db.query(
      `SELECT id, email, display_name, org_id, email_verified_at, phone_number, phone_verified_at,
              verification_level, kyc_status, can_create_group, can_create_channel, created_at, updated_at, deleted_at
         FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    const u = (rows as any[])[0];
    if (!u) return res.status(404).json({ error: 'not_found' });
    res.json({
      id: Number(u.id),
      email: u.email,
      displayName: u.display_name,
      orgId: u.org_id != null ? Number(u.org_id) : null,
      emailVerifiedAt: u.email_verified_at ? String(u.email_verified_at) : null,
      phoneNumber: u.phone_number || null,
      phoneVerifiedAt: u.phone_verified_at ? String(u.phone_verified_at) : null,
      verificationLevel: u.verification_level != null ? Number(u.verification_level) : 0,
      kycStatus: u.kyc_status,
      canCreateGroup: u.can_create_group == null ? null : Boolean(Number(u.can_create_group)),
      canCreateChannel: u.can_create_channel == null ? null : Boolean(Number(u.can_create_channel)),
      createdAt: String(u.created_at),
      updatedAt: u.updated_at ? String(u.updated_at) : null,
      deletedAt: u.deleted_at ? String(u.deleted_at) : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_get_user', detail: String(err?.message || err) });
  }
});

adminRouter.put('/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const {
      email,
      displayName,
      password,
      orgId,
      phoneNumber,
      verificationLevel,
      kycStatus,
      canCreateGroup,
      canCreateChannel,
    } = (req.body || {}) as any;

    const sets: string[] = [];
    const params: any[] = [];
    if (email !== undefined) {
      const e = String(email || '').trim().toLowerCase();
      if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.status(400).json({ error: 'invalid_email' });
      sets.push('email = ?'); params.push(e);
    }
    if (displayName !== undefined) { sets.push('display_name = ?'); params.push(String(displayName || '').slice(0, 255)); }
    if (password !== undefined) {
      const pw = String(password || '');
      if (!pw || pw.length < 8) return res.status(400).json({ error: 'weak_password', detail: 'min_length_8' });
      sets.push('password_hash = ?'); params.push(scryptHash(pw));
    }
    if (orgId !== undefined) { sets.push('org_id = ?'); params.push(orgId == null ? null : Number(orgId)); }
    if (phoneNumber !== undefined) { sets.push('phone_number = ?'); params.push(phoneNumber == null ? null : String(phoneNumber)); }
    if (verificationLevel !== undefined) { sets.push('verification_level = ?'); params.push(verificationLevel == null ? null : Number(verificationLevel)); }
    if (kycStatus !== undefined) { sets.push('kyc_status = ?'); params.push(kycStatus == null ? null : String(kycStatus)); }
    if (canCreateGroup !== undefined) { sets.push('can_create_group = ?'); params.push(canCreateGroup == null ? null : (canCreateGroup ? 1 : 0)); }
    if (canCreateChannel !== undefined) { sets.push('can_create_channel = ?'); params.push(canCreateChannel == null ? null : (canCreateChannel ? 1 : 0)); }

    if (!sets.length) return res.status(400).json({ error: 'no_fields_to_update' });
    const db = getPool();
    const [result] = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, userId]);
    if ((result as any).affectedRows === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_update_user', detail: String(err?.message || err) });
  }
});

adminRouter.delete('/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const db = getPool();
    await db.query(`UPDATE users SET deleted_at = NOW() WHERE id = ?`, [userId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_delete_user', detail: String(err?.message || err) });
  }
});

adminRouter.get('/users/:id/spaces', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const db = getPool();
    const [rows] = await db.query(
      `SELECT s.id AS space_id, s.type, s.name, s.slug, r.name AS role_name
         FROM user_space_roles usr
         JOIN roles r ON r.id = usr.role_id
         JOIN spaces s ON s.id = usr.space_id
        WHERE usr.user_id = ?
        ORDER BY s.type, s.name, r.name`,
      [userId]
    );
    const map: Record<number, { id: number; type: string; name: string; slug: string; roles: string[] }> = {};
    for (const row of rows as any[]) {
      const sid = Number(row.space_id);
      if (!map[sid]) map[sid] = { id: sid, type: String(row.type), name: row.name, slug: row.slug, roles: [] };
      map[sid].roles.push(String(row.role_name));
    }
    res.json({ spaces: Object.values(map) });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_list_user_spaces', detail: String(err?.message || err) });
  }
});

// ---------- Spaces ----------
adminRouter.get('/spaces/:id', async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    const db = getPool();
    const [rows] = await db.query(`SELECT id, type, owner_user_id, name, slug, settings FROM spaces WHERE id = ? LIMIT 1`, [spaceId]);
    const s = (rows as any[])[0];
    if (!s) return res.status(404).json({ error: 'space_not_found' });
    res.json({
      id: Number(s.id),
      type: String(s.type),
      ownerUserId: s.owner_user_id != null ? Number(s.owner_user_id) : null,
      name: s.name,
      slug: s.slug,
      settings: typeof s.settings === 'string' ? JSON.parse(s.settings) : s.settings,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_get_space', detail: String(err?.message || err) });
  }
});

adminRouter.put('/spaces/:id', async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    const { name } = (req.body || {}) as any;
    const title = (name ? String(name) : '').trim();
    if (!title) return res.status(400).json({ error: 'invalid_name' });
    const db = getPool();
    const [result] = await db.query(`UPDATE spaces SET name = ? WHERE id = ?`, [title, spaceId]);
    if ((result as any).affectedRows === 0) return res.status(404).json({ error: 'space_not_found' });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_update_space', detail: String(err?.message || err) });
  }
});

adminRouter.get('/spaces/:id/users/:userId/roles', async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    const userId = Number(req.params.userId);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const db = getPool();
    const [rows] = await db.query(
      `SELECT r.name
         FROM user_space_roles usr
         JOIN roles r ON r.id = usr.role_id
        WHERE usr.space_id = ? AND usr.user_id = ?
        ORDER BY r.name`,
      [spaceId, userId]
    );
    res.json({ roles: (rows as any[]).map((r) => String(r.name)) });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_get_user_roles', detail: String(err?.message || err) });
  }
});

adminRouter.put('/spaces/:id/users/:userId/roles', async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    const userId = Number(req.params.userId);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const roles = Array.isArray((req.body || {}).roles) ? (req.body as any).roles : [];
    const normalized = roles
      .map((r: any) => (typeof r === 'string' ? r.trim() : String(r || '')).toLowerCase())
      .filter((r: string) => r.length > 0);
    const db = getPool();
    // Replace-all strategy
    await db.query(`DELETE FROM user_space_roles WHERE space_id = ? AND user_id = ?`, [spaceId, userId]);
    if (normalized.length) {
      // Map role names to ids
      const placeholders = normalized.map(() => '?').join(',');
      const [roleRows] = await db.query(`SELECT id, name FROM roles WHERE name IN (${placeholders})`, normalized);
      const ids = (roleRows as any[]).map((r) => Number(r.id));
      for (const rid of ids) {
        await db.query(`INSERT IGNORE INTO user_space_roles (user_id, space_id, role_id) VALUES (?, ?, ?)`, [userId, spaceId, rid]);
      }
    }
    res.json({ ok: true, roles: normalized });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_set_user_roles', detail: String(err?.message || err) });
  }
});

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
