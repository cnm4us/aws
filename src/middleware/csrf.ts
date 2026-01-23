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

  // If multiple csrf cookies exist (e.g., same name with different paths from old deploys),
  // the header/body token should be accepted if it matches *any* csrf cookie value.
  // This avoids fragile "last cookie wins" ordering differences between browsers.
  const allCsrfCookieValues: string[] = [];
  try {
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const name = part.slice(0, idx).trim();
      if (name !== CSRF_COOKIE) continue;
      const value = decodeURIComponent(part.slice(idx + 1).trim());
      if (value) allCsrfCookieValues.push(value);
    }
  } catch {
    // ignore
  }

  if (headerToken) {
    if (cookieToken && cookieToken === headerToken) return next();
    if (allCsrfCookieValues.length && allCsrfCookieValues.includes(headerToken)) return next();
  }
  if (bodyToken) {
    if (cookieToken && cookieToken === bodyToken) return next();
    if (allCsrfCookieValues.length && allCsrfCookieValues.includes(bodyToken)) return next();
  }

  return res.status(403).json({ error: 'csrf_invalid' });
}
