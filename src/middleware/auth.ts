import type { Request, Response, NextFunction } from 'express';
import { ADMIN_TOKEN } from '../config';
import { can } from '../security/permissions';
import { PERM } from '../security/perm'

function hasAdminToken(req: Request): boolean {
  const token = ADMIN_TOKEN;
  if (!token) return false;
  const header = (req.headers['x-admin-token'] as string) || '';
  const auth = (req.headers['authorization'] as string) || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return header === token || bearer === token;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.user && req.session) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

export function requireAuthOrAdminToken(req: Request, res: Response, next: NextFunction) {
  if ((req.user && req.session) || hasAdminToken(req)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

export async function requireSiteAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user || !req.session) return res.status(401).json({ error: 'unauthorized' });
  const allowed = await can(req.user.id, PERM.VIDEO_DELETE_ANY);
    if (!allowed) return res.status(403).json({ error: 'forbidden' });
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'auth_check_failed', detail: String((err as any)?.message || err) });
  }
}

// Page-level guard: redirect to /forbidden when not a site admin
export async function requireSiteAdminPage(req: Request, res: Response, next: NextFunction) {
  try {
    const from = encodeURIComponent(req.originalUrl || '/');
    if (!req.user || !req.session) return res.redirect(`/forbidden?from=${from}`);
  const allowed = await can(req.user.id, PERM.VIDEO_DELETE_ANY);
    if (!allowed) return res.redirect(`/forbidden?from=${from}`);
    return next();
  } catch (_err) {
    // On error, fail closed to forbidden page for safety
    const from = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/forbidden?from=${from}`);
  }
}

// Page-level guard for space admin pages
export async function requireSpaceAdminPage(req: Request, res: Response, next: NextFunction) {
  try {
    const from = encodeURIComponent(req.originalUrl || '/');
    const sid = Number((req.params as any).id);
    if (!req.user || !req.session) return res.redirect(`/forbidden?from=${from}`);
    if (!Number.isFinite(sid) || sid <= 0) return res.redirect(`/forbidden?from=${from}`);
    // Site admin always allowed
  if (await can(req.user.id, PERM.VIDEO_DELETE_ANY)) return next();
    // Allow space admins/managers and membership managers
  const ok = (await can(req.user.id, PERM.SPACE_MANAGE, { spaceId: sid }))
      || (await can(req.user.id, PERM.SPACE_MANAGE_MEMBERS, { spaceId: sid }))
      || (await can(req.user.id, PERM.SPACE_ASSIGN_ROLES, { spaceId: sid }));
    if (!ok) return res.redirect(`/forbidden?from=${from}`);
    return next();
  } catch {
    const from = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/forbidden?from=${from}`);
  }
}

// Page-level guard for space moderation pages
export async function requireSpaceModeratorPage(req: Request, res: Response, next: NextFunction) {
  try {
    const from = encodeURIComponent(req.originalUrl || '/');
    const sid = Number((req.params as any).id);
    if (!req.user || !req.session) return res.redirect(`/forbidden?from=${from}`);
    if (!Number.isFinite(sid) || sid <= 0) return res.redirect(`/forbidden?from=${from}`);
    // Site admin or site moderator-like powers: allow via video:delete_any shortcut
  if (await can(req.user.id, PERM.VIDEO_DELETE_ANY)) return next();
    // Moderation/publish permissions in the space
  const ok = (await can(req.user.id, PERM.VIDEO_APPROVE_SPACE, { spaceId: sid }))
      || (await can(req.user.id, PERM.VIDEO_PUBLISH_SPACE, { spaceId: sid }));
    if (!ok) return res.redirect(`/forbidden?from=${from}`);
    return next();
  } catch {
    const from = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/forbidden?from=${from}`);
  }
}
