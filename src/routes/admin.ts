import { Router } from 'express';
import { getPool } from '../db';
import { clampLimit } from '../core/pagination'
import { requireAuth, requireSiteAdmin } from '../middleware/auth';
import crypto from 'crypto';
import * as adminSvc from '../features/admin/service'
import { slugify, defaultSettings } from '../features/spaces/util'
import {
  assignDefaultAdminRoles,
  assignDefaultMemberRoles,
  assignRoles,
  getDefaultMemberRoles,
  listSpaceInvitations,
  listSpaceMembers,
  loadSpace,
  removeAllRoles,
  type SpaceRow,
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
    const result = await adminSvc.listRoles()
    return res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_list_roles', detail: String(err?.message || err) });
  }
});

// ---- Moderation: per-user global hold + suspensions ----
adminRouter.get('/users/:id/moderation', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const db = getPool();
    const [uRows] = await db.query(`SELECT require_review_global, credibility_score FROM users WHERE id = ? LIMIT 1`, [userId]);
    const u = (uRows as any[])[0];
    if (!u) return res.status(404).json({ error: 'user_not_found' });
    const [sRows] = await db.query(
      `SELECT id, target_type, target_id, kind, degree, starts_at, ends_at, reason, created_by, created_at
         FROM suspensions
        WHERE user_id = ? AND (ends_at IS NULL OR ends_at >= NOW())
        ORDER BY created_at DESC`,
      [userId]
    );
    res.json({
      userId,
      requireReviewGlobal: Boolean(Number(u.require_review_global)),
      credibilityScore: u.credibility_score != null ? Number(u.credibility_score) : 0,
      activeSuspensions: (sRows as any[]).map((r) => ({
        id: Number(r.id),
        targetType: r.target_type,
        targetId: r.target_id != null ? Number(r.target_id) : null,
        kind: r.kind,
        degree: Number(r.degree),
        startsAt: r.starts_at ? String(r.starts_at) : null,
        endsAt: r.ends_at ? String(r.ends_at) : null,
        reason: r.reason || null,
        createdBy: r.created_by != null ? Number(r.created_by) : null,
        createdAt: String(r.created_at),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_get_moderation', detail: String(err?.message || err) });
  }
});

adminRouter.put('/users/:id/moderation', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const { requireReviewGlobal } = (req.body || {}) as any;
    const db = getPool();
    if (requireReviewGlobal !== undefined) {
      const flag = requireReviewGlobal ? 1 : 0;
      await db.query(`UPDATE users SET require_review_global = ? WHERE id = ?`, [flag, userId]);
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_update_moderation', detail: String(err?.message || err) });
  }
});

adminRouter.post('/users/:id/suspensions', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const { scope, spaceId, degree, reason } = (req.body || {}) as any;
    const deg = Number(degree || 1);
    if (!['site','space'].includes(String(scope))) return res.status(400).json({ error: 'bad_scope' });
    if (String(scope) === 'space') {
      const sid = Number(spaceId);
      if (!Number.isFinite(sid) || sid <= 0) return res.status(400).json({ error: 'bad_space_id' });
    }
    if (![1,2,3].includes(deg)) return res.status(400).json({ error: 'bad_degree' });
    // Compute end time based on degrees: 1d, 7d, 30d
    const days = deg === 1 ? 1 : deg === 2 ? 7 : 30;
    const db = getPool();
    const ends = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await db.query(
      `INSERT INTO suspensions (user_id, target_type, target_id, kind, degree, starts_at, ends_at, reason, created_by)
       VALUES (?, ?, ?, 'posting', ?, NOW(), ?, ?, ?)`,
      [userId, String(scope), String(scope) === 'space' ? Number(spaceId) : null, deg, ends, reason ? String(reason).slice(0,255) : null, req.user ? Number(req.user.id) : null]
    );
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_create_suspension', detail: String(err?.message || err) });
  }
});

adminRouter.delete('/users/:id/suspensions/:sid', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const sid = Number(req.params.sid);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    if (!Number.isFinite(sid) || sid <= 0) return res.status(400).json({ error: 'bad_suspension_id' });
    const db = getPool();
    await db.query(`UPDATE suspensions SET ends_at = NOW() WHERE id = ? AND user_id = ?`, [sid, userId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_revoke_suspension', detail: String(err?.message || err) });
  }
});

// ---- Dev utilities: content stats + truncate (admin only) ----
adminRouter.get('/dev/stats', async (_req, res) => {
  try {
    const db = getPool();
    const [u] = await db.query(`SELECT COUNT(*) AS c FROM uploads`);
    const [p] = await db.query(`SELECT COUNT(*) AS c FROM productions`);
    const [sp] = await db.query(`SELECT COUNT(*) AS c FROM space_publications`);
    const [spe] = await db.query(`SELECT COUNT(*) AS c FROM space_publication_events`);
    res.json({
      uploads: Number((u as any[])[0]?.c || 0),
      productions: Number((p as any[])[0]?.c || 0),
      spacePublications: Number((sp as any[])[0]?.c || 0),
      spacePublicationEvents: Number((spe as any[])[0]?.c || 0),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_fetch_stats', detail: String(err?.message || err) });
  }
});

adminRouter.post('/dev/truncate-content', async (_req, res) => {
  try {
    const db = getPool();
    const tables = ['space_publication_events', 'space_publications', 'productions', 'uploads', 'action_log'];
    for (const t of tables) {
      try { await db.query(`DELETE FROM ${t}`); } catch {}
    }
    const [u] = await db.query(`SELECT COUNT(*) AS c FROM uploads`);
    const [p] = await db.query(`SELECT COUNT(*) AS c FROM productions`);
    const [sp] = await db.query(`SELECT COUNT(*) AS c FROM space_publications`);
    const [spe] = await db.query(`SELECT COUNT(*) AS c FROM space_publication_events`);
    res.json({ ok: true, remaining: {
      uploads: Number((u as any[])[0]?.c || 0),
      productions: Number((p as any[])[0]?.c || 0),
      spacePublications: Number((sp as any[])[0]?.c || 0),
      spacePublicationEvents: Number((spe as any[])[0]?.c || 0),
    }});
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_truncate', detail: String(err?.message || err) });
  }
});
// Site role assignments for a user (user_roles)
adminRouter.get('/users/:id/roles', async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const result = await adminSvc.getUserSiteRoles(userId)
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_get_user_roles', detail: String(err?.message || err) });
  }
});

adminRouter.put('/users/:id/roles', async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const rolesIn = Array.isArray((req.body || {}).roles) ? (req.body.roles as any[]) : []
    const result = await adminSvc.setUserSiteRoles(userId, rolesIn)
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_set_user_roles', detail: String(err?.message || err) });
  }
});

// Create Group / Channel (admin)
adminRouter.post('/spaces', async (req, res) => {
  try {
    const { type, name, slug } = (req.body || {}) as any
    const kind = String(type || '').trim().toLowerCase()
    if (kind !== 'group' && kind !== 'channel') return res.status(400).json({ error: 'invalid_space_type' })
    const title = String(name || '').trim(); if (!title) return res.status(400).json({ error: 'invalid_name' })
    const rawSlug = String(slug || '').trim(); if (!rawSlug) return res.status(400).json({ error: 'invalid_slug' })
    const normalizedSlug = rawSlug
    const space = await adminSvc.createSpace({ type: kind, name: title, slug: normalizedSlug }, Number(req.user!.id))
    res.status(201).json(space)
  } catch (err: any) {
    const status = err?.status || 500
    const code = err?.code || 'failed_to_create_space'
    res.status(status).json({ error: code, detail: String(err?.message || err) })
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
    const search = (req.query.search ? String(req.query.search) : '').trim()
    const includeDeleted = String(req.query.include_deleted || '') === '1'
    const limit = clampLimit(req.query.limit, 50, 1, 200)
    const offset = Math.max(Number(req.query.offset || 0), 0)
    const result = await adminSvc.listUsers({ search, includeDeleted, limit, offset })
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_list_users', detail: String(err?.message || err) });
  }
});

adminRouter.post('/users', async (req, res) => {
  try {
    const { email, displayName, password, phoneNumber, verificationLevel, kycStatus, canCreateGroup, canCreateChannel } = (req.body || {}) as any
    const result = await adminSvc.createUser({ email, displayName, password, phoneNumber, verificationLevel, kycStatus, canCreateGroup, canCreateChannel })
    res.status(201).json(result)
  } catch (err: any) {
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_create_user', detail: err?.detail || String(err?.message || err) })
  }
});

adminRouter.get('/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const result = await adminSvc.getUserDetail(userId)
    res.json(result)
  } catch (err: any) {
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_get_user', detail: String(err?.message || err) })
  }
});

adminRouter.put('/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const { email, displayName, password, orgId, phoneNumber, verificationLevel, kycStatus, canCreateGroup, canCreateChannel } = (req.body || {}) as any
    const result = await adminSvc.updateUser(userId, { email, displayName, password, orgId, phoneNumber, verificationLevel, kycStatus, canCreateGroup, canCreateChannel })
    res.json(result)
  } catch (err: any) {
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_update_user', detail: err?.detail || String(err?.message || err) })
  }
});

adminRouter.delete('/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const result = await adminSvc.deleteUser(userId)
    res.json(result)
  } catch (err: any) {
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_delete_user', detail: String(err?.message || err) })
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
    const normalizeRole = (n: string): string | null => {
      const name = String(n || '').toLowerCase();
      if (name === 'group_admin' || name === 'channel_admin' || name === 'space_admin') return 'space_admin';
      if (name === 'group_member' || name === 'channel_member' || name === 'member' || name === 'viewer' || name === 'subscriber' || name === 'uploader' || name === 'space_member') return 'space_member';
      if (name === 'publisher' || name === 'contributor' || name === 'space_poster') return 'space_poster';
      if (name === 'space_moderator' || name === 'moderator') return 'space_moderator';
      if (name === 'space_subscriber') return 'space_subscriber';
      return null; // drop anything else
    };
    for (const row of rows as any[]) {
      const sid = Number(row.space_id);
      if (!map[sid]) map[sid] = { id: sid, type: String(row.type), name: row.name, slug: row.slug, roles: [] };
      const norm = normalizeRole(String(row.role_name));
      if (norm) map[sid].roles.push(norm);
    }
    // De-duplicate and order roles sensibly
    for (const sid of Object.keys(map)) {
      const set = new Set<string>(map[Number(sid)].roles);
      const order = ['space_admin','space_moderator','space_member','space_poster','space_subscriber'];
      map[Number(sid)].roles = order.filter((r) => set.has(r));
    }
    res.json({ spaces: Object.values(map) });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_list_user_spaces', detail: String(err?.message || err) });
  }
});

// ---------- Spaces ----------
adminRouter.get('/spaces/:id', async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const result = await adminSvc.getSpace(spaceId)
    res.json(result)
  } catch (err: any) {
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_get_space', detail: String(err?.message || err) })
  }
});

adminRouter.put('/spaces/:id', async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const { name, commentsPolicy, requireReview } = (req.body || {}) as any
    const result = await adminSvc.updateSpace(spaceId, { name, commentsPolicy, requireReview })
    res.json(result)
  } catch (err: any) {
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_update_space', detail: String(err?.message || err) })
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
    const result = await adminSvc.getSiteSettings()
    res.json(result)
  } catch (err: any) {
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_fetch_site_settings', detail: String(err?.message || err) })
  }
});

adminRouter.put('/site-settings', async (req, res) => {
  try {
    const result = await adminSvc.setSiteSettings(req.body || {})
    res.json(result)
  } catch (err: any) {
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_update_site_settings', detail: String(err?.message || err) })
  }
});

adminRouter.get('/users/:id/capabilities', async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const result = await adminSvc.getUserCapabilities(userId)
    res.json(result)
  } catch (err: any) {
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_fetch_user_capabilities', detail: String(err?.message || err) })
  }
});

adminRouter.put('/users/:id/capabilities', async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const { canCreateGroup, canCreateChannel } = (req.body || {}) as any
    const result = await adminSvc.setUserCapabilities(userId, { canCreateGroup, canCreateChannel })
    res.json(result)
  } catch (err: any) {
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_update_user_capabilities', detail: String(err?.message || err) })
  }
});

adminRouter.get('/spaces', async (req, res) => {
  try {
    const { type } = req.query as { type?: string }
    const t = type && ['group','channel'].includes(String(type).toLowerCase()) ? (String(type).toLowerCase() as any) : undefined
    const result = await adminSvc.listSpaces(t)
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_list_spaces', detail: String(err?.message || err) });
  }
});

adminRouter.get('/spaces/:id/members', async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const result = await adminSvc.listSpaceMembers(spaceId)
    res.json(result)
  } catch (err: any) {
    console.error('admin list space members failed', err);
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_list_members', detail: String(err?.message || err) })
  }
});

adminRouter.delete('/spaces/:id/members/:userId', async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    const userId = Number(req.params.userId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const result = await adminSvc.removeSpaceMember(spaceId, userId)
    res.json(result)
  } catch (err: any) {
    console.error('admin remove member failed', err);
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_remove_member', detail: String(err?.message || err) })
  }
});

adminRouter.get('/spaces/:id/invitations', async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const result = await adminSvc.listSpaceInvitations(spaceId)
    res.json(result)
  } catch (err: any) {
    console.error('admin list invitations failed', err);
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_list_invitations', detail: String(err?.message || err) })
  }
});

adminRouter.delete('/spaces/:id/invitations/:userId', async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    const userId = Number(req.params.userId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const result = await adminSvc.revokeSpaceInvitation(spaceId, userId)
    res.json(result)
  } catch (err: any) {
    console.error('admin revoke invitation failed', err);
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_revoke_invitation', detail: String(err?.message || err) })
  }
});

adminRouter.post('/spaces/:id/members', async (req, res) => {
  try {
    const spaceId = Number(req.params.id)
    const { userId, roles } = (req.body || {}) as any
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const parsedUserId = Number(userId)
    if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const result = await adminSvc.addSpaceMember(spaceId, parsedUserId, roles)
    // Validate assigned roles non-empty to match legacy behavior
    if (!result.roles || !result.roles.length) return res.status(400).json({ error: 'roles_not_assigned' })
    res.json(result)
  } catch (err: any) {
    console.error('admin add member failed', err);
    const status = err?.status || 500
    res.status(status).json({ error: err?.code || 'failed_to_add_member', detail: String(err?.message || err) })
  }
});

export default adminRouter;
