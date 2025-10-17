import type { Request, Response, NextFunction } from 'express';
import { ADMIN_TOKEN } from '../config';

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
