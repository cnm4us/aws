import { Router } from 'express';
import { z } from 'zod'
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

// ---------- Schemas ----------
const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().max(255).optional(),
  password: z.string().min(8),
  phoneNumber: z.string().max(64).optional().nullable(),
  verificationLevel: z.number().int().optional().nullable(),
  kycStatus: z.enum(['none','pending','verified','rejected']).optional(),
  canCreateGroup: z.union([z.boolean(), z.null()]).optional(),
  canCreateChannel: z.union([z.boolean(), z.null()]).optional(),
})

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().max(255).optional(),
  password: z.string().min(8).optional(),
  orgId: z.number().int().optional().nullable(),
  phoneNumber: z.string().max(64).optional().nullable(),
  verificationLevel: z.number().int().optional().nullable(),
  kycStatus: z.enum(['none','pending','verified','rejected']).optional().nullable(),
  canCreateGroup: z.union([z.boolean(), z.null()]).optional(),
  canCreateChannel: z.union([z.boolean(), z.null()]).optional(),
})

const siteSettingsSchema = z.object({
  allowGroupCreation: z.boolean(),
  allowChannelCreation: z.boolean(),
  requireGroupReview: z.boolean(),
  requireChannelReview: z.boolean(),
})

const capabilitiesSchema = z.object({
  canCreateGroup: z.union([z.boolean(), z.null()]).optional(),
  canCreateChannel: z.union([z.boolean(), z.null()]).optional(),
})

const createSpaceSchema = z.object({
  type: z.enum(['group','channel']),
  name: z.string().min(1),
  slug: z.string().min(1),
})

const updateSpaceSchema = z.object({
  name: z.string().min(1).optional(),
  commentsPolicy: z.enum(['on','off','inherit']).optional(),
  requireReview: z.boolean().optional(),
})

const rolesSchema = z.object({ roles: z.array(z.string()).optional() })

const addMemberSchema = z.object({ userId: z.number().int().positive(), roles: z.array(z.string()).optional() })

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
    const result = await adminSvc.getDevStats()
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_fetch_stats', detail: String(err?.message || err) });
  }
});

adminRouter.post('/dev/truncate-content', async (_req, res) => {
  try {
    const result = await adminSvc.truncateContent()
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_truncate', detail: String(err?.message || err) });
  }
});
// Site role assignments for a user (user_roles)
adminRouter.get('/users/:id/roles', async (req, res, next) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const result = await adminSvc.getUserSiteRoles(userId)
    res.json(result)
  } catch (err) { next(err) }
});

adminRouter.put('/users/:id/roles', async (req, res, next) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const parsed = rolesSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const result = await adminSvc.setUserSiteRoles(userId, parsed.data.roles || [])
    res.json(result)
  } catch (err) { next(err) }
});

// Create Group / Channel (admin)
adminRouter.post('/spaces', async (req, res, next) => {
  try {
    const parsed = createSpaceSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const { type, name, slug } = parsed.data
    const kind = String(type || '').trim().toLowerCase()
    if (kind !== 'group' && kind !== 'channel') return res.status(400).json({ error: 'invalid_space_type' })
    const title = String(name || '').trim(); if (!title) return res.status(400).json({ error: 'invalid_name' })
    const rawSlug = String(slug || '').trim(); if (!rawSlug) return res.status(400).json({ error: 'invalid_slug' })
    const normalizedSlug = rawSlug
    const space = await adminSvc.createSpace({ type: kind, name: title, slug: normalizedSlug }, Number(req.user!.id))
    res.status(201).json(space)
  } catch (err) { next(err) }
});

// ---------- Users ----------
function scryptHash(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const N = 16384; // Align with register implementation
  const hash = crypto.scryptSync(password, salt, 64, { N }).toString('hex');
  return `s2$${N}$${salt}$${hash}`;
}

adminRouter.get('/users', async (req, res, next) => {
  try {
    const search = (req.query.search ? String(req.query.search) : '').trim()
    const includeDeleted = String(req.query.include_deleted || '') === '1'
    const limit = clampLimit(req.query.limit, 50, 1, 200)
    const offset = Math.max(Number(req.query.offset || 0), 0)
    const result = await adminSvc.listUsers({ search, includeDeleted, limit, offset })
    res.json(result)
  } catch (err) { next(err) }
});

adminRouter.post('/users', async (req, res) => {
  try {
    const parsed = createUserSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const result = await adminSvc.createUser(parsed.data)
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
    const parsed = updateUserSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const result = await adminSvc.updateUser(userId, parsed.data as any)
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
    const parsed = updateSpaceSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const result = await adminSvc.updateSpace(spaceId, parsed.data)
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
    const parsed = rolesSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const result = await adminSvc.setUserSpaceRoles(spaceId, userId, parsed.data.roles || [])
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_set_user_roles', detail: String(err?.message || err) });
  }
});

adminRouter.get('/site-settings', async (_req, res, next) => {
  try {
    const result = await adminSvc.getSiteSettings()
    res.json(result)
  } catch (err: any) { next(err) }
});

adminRouter.put('/site-settings', async (req, res, next) => {
  try {
    const parsed = siteSettingsSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', detail: parsed.error.flatten() })
    const result = await adminSvc.setSiteSettings(parsed.data)
    res.json(result)
  } catch (err: any) { next(err) }
});

adminRouter.get('/users/:id/capabilities', async (req, res, next) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const result = await adminSvc.getUserCapabilities(userId)
    res.json(result)
  } catch (err: any) { next(err) }
});

adminRouter.put('/users/:id/capabilities', async (req, res, next) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const parsed = capabilitiesSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const result = await adminSvc.setUserCapabilities(userId, parsed.data)
    res.json(result)
  } catch (err: any) { next(err) }
});

adminRouter.get('/spaces', async (req, res, next) => {
  try {
    const { type } = req.query as { type?: string }
    const t = type && ['group','channel'].includes(String(type).toLowerCase()) ? (String(type).toLowerCase() as any) : undefined
    const result = await adminSvc.listSpaces(t)
    res.json(result)
  } catch (err) { next(err) }
});

adminRouter.get('/spaces/:id/members', async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const result = await adminSvc.listSpaceMembers(spaceId)
    res.json(result)
  } catch (err) { next(err) }
});

adminRouter.delete('/spaces/:id/members/:userId', async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    const userId = Number(req.params.userId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const result = await adminSvc.removeSpaceMember(spaceId, userId)
    res.json(result)
  } catch (err) { next(err) }
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
    const parsed = addMemberSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const parsedUserId = Number(parsed.data.userId)
    if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const result = await adminSvc.addSpaceMember(spaceId, parsedUserId, parsed.data.roles)
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
