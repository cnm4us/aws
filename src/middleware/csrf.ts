import type { Request, Response, NextFunction } from 'express';
import { parseCookies } from '../utils/cookies';

const CSRF_COOKIE = 'csrf';
const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtect(req: Request, res: Response, next: NextFunction) {
  if (!req.session || !req.user) return next();
  if (SAFE_METHODS.has(req.method.toUpperCase())) return next();

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[CSRF_COOKIE];
  const headerToken = (req.headers[CSRF_HEADER] as string) || '';
  const bodyToken = (req.body && (req.body as any).csrf) ? String((req.body as any).csrf) : '';

  if (cookieToken && headerToken && cookieToken === headerToken) return next();
  if (cookieToken && bodyToken && cookieToken === bodyToken) return next();

  return res.status(403).json({ error: 'csrf_invalid' });
}
