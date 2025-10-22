import type { Request, Response, NextFunction } from 'express';
import { ADMIN_TOKEN } from '../config';
import { can } from '../security/permissions';

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
    const allowed = await can(req.user.id, 'video:delete_any');
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
    const allowed = await can(req.user.id, 'video:delete_any');
    if (!allowed) return res.redirect(`/forbidden?from=${from}`);
    return next();
  } catch (_err) {
    // On error, fail closed to forbidden page for safety
    const from = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/forbidden?from=${from}`);
  }
}
