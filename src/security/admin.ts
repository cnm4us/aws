import type { Request, Response, NextFunction } from 'express';
import { ADMIN_TOKEN } from '../config';

// Support local import without circular dep
const tokenFromEnv: string | undefined = ADMIN_TOKEN;

export function adminGuard(req: Request, res: Response, next: NextFunction) {
  const token = tokenFromEnv;
  if (!token) return next(); // disabled
  const hdr = (req.headers['x-admin-token'] as string) || '';
  const auth = (req.headers['authorization'] as string) || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (hdr === token || bearer === token) return next();
  return res.status(401).json({ error: 'unauthorized' });
}
