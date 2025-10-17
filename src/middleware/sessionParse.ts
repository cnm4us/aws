import type { Request, Response, NextFunction } from 'express';
import { getPool } from '../db';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        display_name: string | null;
      };
      session?: {
        id: number;
        token: string;
        user_id: number;
        ip: string | null;
        ua: string | null;
        created_at: string;
        expires_at: string;
        revoked_at: string | null;
      };
    }
  }
}

const SID_COOKIE = 'sid';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    const value = decodeURIComponent(part.slice(index + 1).trim());
    cookies[name] = value;
  }
  return cookies;
}

export async function sessionParse(req: Request, _res: Response, next: NextFunction) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SID_COOKIE];
    if (!token) return next();

    const db = getPool();
    const [rows] = await db.query(
      `SELECT s.id AS session_id, s.token, s.user_id, s.ip, s.ua, s.created_at, s.expires_at, s.revoked_at,
              u.email, u.display_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
        LIMIT 1`,
      [token]
    );

    const row = (rows as any[])[0];
    if (!row) return next();

    req.session = {
      id: Number(row.session_id),
      token: String(row.token),
      user_id: Number(row.user_id),
      ip: row.ip ? String(row.ip) : null,
      ua: row.ua ? String(row.ua) : null,
      created_at: String(row.created_at),
      expires_at: String(row.expires_at),
      revoked_at: row.revoked_at ? String(row.revoked_at) : null,
    };

    req.user = {
      id: Number(row.user_id),
      email: String(row.email),
      display_name: row.display_name ? String(row.display_name) : null,
    };
    return next();
  } catch (err) {
    console.warn('session parse skipped', err);
    return next();
  }
}
