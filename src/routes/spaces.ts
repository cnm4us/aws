import { Router } from 'express';
import { getPool, SpacePublicationStatus, SpacePublicationVisibility } from '../db';
import { requireAuth } from '../middleware/auth';
import { can } from '../security/permissions';
import { enhanceUploadRow } from '../utils/enhance';
import * as feedsSvc from '../features/feeds/service'
import * as spacesSvc from '../features/spaces/service'
import { DomainError } from '../core/errors'
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

// slugify/defaultSettings moved to features/spaces/util; routes no longer use them directly

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

spacesRouter.get('/api/me/spaces', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user!.id)
    const data = await spacesSvc.getMySpaces(userId)
    res.json(data)
  } catch (err: any) { next(err) }
})

// List subscribers for a space (active and recent)
spacesRouter.get('/api/spaces/:id/subscribers', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const userId = Number(req.user!.id)
    const data = await spacesSvc.listSubscribers(spaceId, userId)
    res.json(data)
  } catch (err: any) { next(err) }
})

// List suspensions for a space (optionally only active)
spacesRouter.get('/api/spaces/:id/suspensions', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const userId = Number(req.user!.id)
    const activeOnly = String(req.query.active || '') === '1' || String(req.query.active || '').toLowerCase() === 'true'
    const data = await spacesSvc.listSuspensions(spaceId, userId, activeOnly)
    res.json(data)
  } catch (err: any) { next(err) }
})

// Create a suspension (posting or ban) scoped to a space
spacesRouter.post('/api/spaces/:id/suspensions', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const { userId, kind, degree, reason, days } = (req.body || {}) as any
    const targetUserId = Number(userId)
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    if (String(kind || '').toLowerCase() !== 'posting' && String(kind || '').toLowerCase() !== 'ban') return res.status(400).json({ error: 'bad_kind' })
    const actorId = Number(req.user!.id)
    const result = await spacesSvc.createSuspension(spaceId, actorId, { userId: targetUserId, kind: String(kind).toLowerCase() as any, degree: degree != null ? Number(degree) : undefined, reason, days: days != null ? Number(days) : undefined })
    res.status(201).json(result)
  } catch (err: any) { next(err) }
})

// Revoke a suspension by id (space scoped)
spacesRouter.delete('/api/spaces/:id/suspensions/:sid', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    const sid = Number(req.params.sid)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(sid) || sid <= 0) return res.status(400).json({ error: 'bad_suspension_id' })
    const actorId = Number(req.user!.id)
    const result = await spacesSvc.revokeSuspension(spaceId, sid, actorId)
    res.json(result)
  } catch (err: any) { next(err) }
})
// Moderation queue for a space (pending publications)
spacesRouter.get('/api/spaces/:id/moderation/queue', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const userId = Number(req.user!.id)
    const data = await spacesSvc.moderationQueue(spaceId, userId)
    res.json(data)
  } catch (err: any) { next(err) }
})
// Create new group/channel space
spacesRouter.post('/api/spaces', requireAuth, async (req, res, next) => {
  try {
    const { type, name } = (req.body || {}) as any
    const normalizedType = typeof type === 'string' ? type.trim().toLowerCase() : ''
    if (normalizedType !== 'group' && normalizedType !== 'channel') return res.status(400).json({ error: 'invalid_space_type' })
    const title = typeof name === 'string' && name.trim().length ? name.trim().slice(0, 120) : null
    if (!title) return res.status(400).json({ error: 'invalid_name' })
    const data = await spacesSvc.createSpace({ type: normalizedType, name: title }, Number(req.user!.id))
    res.status(201).json(data)
  } catch (err: any) { next(err) }
})

// List members of a space
spacesRouter.get('/api/spaces/:id/members', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const currentUserId = Number(req.user!.id)
    const data = await spacesSvc.listMembers(spaceId, currentUserId)
    res.json(data)
  } catch (err: any) { next(err) }
})

// Read space settings (space-admin scope)
spacesRouter.get('/api/spaces/:id/settings', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const currentUserId = Number(req.user!.id)
    const data = await spacesSvc.getSettings(spaceId, currentUserId)
    res.json(data)
  } catch (err: any) { next(err) }
})

// Update space settings (space-admin scope)
spacesRouter.put('/api/spaces/:id/settings', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const currentUserId = Number(req.user!.id)
    const body = (req.body || {}) as any
    const wantComments = body.commentsPolicy
    const wantRequire = body.requireReview
    const data = await spacesSvc.updateSettings(spaceId, currentUserId, { commentsPolicy: wantComments, requireReview: wantRequire })
    res.json(data)
  } catch (err: any) { next(err) }
})

spacesRouter.get('/api/spaces/:id/invitations', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const currentUserId = Number(req.user!.id)
    const data = await spacesSvc.listInvitations(spaceId, currentUserId)
    res.json(data)
  } catch (err: any) { next(err) }
})

// Invite a member
spacesRouter.post('/api/spaces/:id/invitations', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    const { userId } = (req.body || {}) as any
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const currentUserId = Number(req.user!.id)
    const result = await spacesSvc.inviteMember(spaceId, Number(userId), currentUserId)
    res.status(201).json(result)
  } catch (err: any) { next(err) }
})

// Revoke invitation
spacesRouter.delete('/api/spaces/:id/invitations/:userId', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    const inviteeUserId = Number(req.params.userId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(inviteeUserId) || inviteeUserId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const currentUserId = Number(req.user!.id)
    const result = await spacesSvc.revokeInvitation(spaceId, inviteeUserId, currentUserId)
    res.json(result)
  } catch (err: any) { next(err) }
})

// Accept invitation
spacesRouter.post('/api/spaces/:id/invitations/:userId/accept', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    const inviteeUserId = Number(req.params.userId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(inviteeUserId) || inviteeUserId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const currentUserId = Number(req.user!.id)
    const result = await spacesSvc.acceptInvitation(spaceId, inviteeUserId, currentUserId)
    res.json(result)
  } catch (err: any) { next(err) }
})

// Decline invitation
spacesRouter.post('/api/spaces/:id/invitations/:userId/decline', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    const inviteeUserId = Number(req.params.userId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    if (!Number.isFinite(inviteeUserId) || inviteeUserId <= 0) return res.status(400).json({ error: 'bad_user_id' })
    const currentUserId = Number(req.user!.id)
    const result = await spacesSvc.declineInvitation(spaceId, inviteeUserId, currentUserId)
    res.json(result)
  } catch (err: any) { next(err) }
})

// Remove a member
spacesRouter.delete('/api/spaces/:id/members/:userId', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' });
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) return res.status(400).json({ error: 'bad_user_id' });
    const currentUserId = Number(req.user!.id)
    const result = await spacesSvc.removeMember(spaceId, targetUserId, currentUserId)
    res.json(result)
  } catch (err: any) { next(err) }
});

// Delete a space
spacesRouter.delete('/api/spaces/:id', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const currentUserId = Number(req.user!.id)
    const data = await spacesSvc.deleteSpace(spaceId, currentUserId)
    res.json(data)
  } catch (err: any) { next(err) }
})

spacesRouter.get('/api/spaces/:id/feed', requireAuth, async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
    const userId = Number(req.user!.id)
    await spacesSvc.assertCanViewSpaceFeed(spaceId, userId)
    const limitRaw = Number(req.query.limit ?? 20)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
    const data = await feedsSvc.getSpaceFeed(spaceId, { limit, cursor })
    res.json(data)
  } catch (err: any) {
    // Preserve legacy error code shape while using centralized error middleware
    if (err instanceof DomainError) return next(err)
    return next(new DomainError(String(err?.message || err), 'failed_to_load_feed', 500))
  }
})

// Global feed aggregator: includes items explicitly marked visible_in_global and published
spacesRouter.get('/api/feed/global', requireAuth, async (req, res, next) => {
  try {
    const limitRaw = Number(req.query.limit ?? 20)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
    const data = await feedsSvc.getGlobalFeed({ limit, cursor })
    res.json(data)
  } catch (err: any) {
    return next(new DomainError(String(err?.message || err), 'failed_to_load_global_feed', 500))
  }
})

export default spacesRouter;
