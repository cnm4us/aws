import crypto from 'crypto';
import { getPool } from '../db';

export type SessionRecord = {
  id: number;
  token: string;
  user_id: number;
  ip: string | null;
  ua: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export type CreateSessionInput = {
  userId: number;
  ip?: string | null;
  ua?: string | null;
  expiresAt: Date | string;
  token?: string;
};

function normalizeDate(input: Date | string): string {
  if (input instanceof Date) return input.toISOString().slice(0, 19).replace('T', ' ');
  return input;
}

export async function createSession(input: CreateSessionInput): Promise<SessionRecord> {
  const db = getPool();
  const token = input.token ?? crypto.randomBytes(32).toString('hex');
  const expiresAt = normalizeDate(input.expiresAt);
  await db.query(
    `INSERT INTO sessions (token, user_id, ip, ua, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [token, input.userId, input.ip ?? null, input.ua ?? null, expiresAt]
  );
  const record = await getSessionByToken(token, { includeRevoked: true });
  if (!record) throw new Error('failed_to_create_session');
  return record;
}

export async function getSessionByToken(token: string, opts?: { includeRevoked?: boolean }): Promise<SessionRecord | null> {
  const db = getPool();
  const clauses = ['token = ?'];
  const params: any[] = [token];
  if (!opts?.includeRevoked) {
    clauses.push('revoked_at IS NULL');
    clauses.push('expires_at > NOW()');
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await db.query(`SELECT id, token, user_id, ip, ua, created_at, expires_at, revoked_at FROM sessions ${where} LIMIT 1`, params);
  const row = (rows as any[])[0];
  return row
    ? {
        id: Number(row.id),
        token: String(row.token),
        user_id: Number(row.user_id),
        ip: row.ip ?? null,
        ua: row.ua ?? null,
        created_at: String(row.created_at),
        expires_at: String(row.expires_at),
        revoked_at: row.revoked_at ? String(row.revoked_at) : null,
      }
    : null;
}

export async function revokeSession(token: string): Promise<boolean> {
  const db = getPool();
  const [result] = await db.query(`UPDATE sessions SET revoked_at = NOW() WHERE token = ? AND revoked_at IS NULL`, [token]);
  const info = result as any;
  return Number(info?.affectedRows || 0) > 0;
}

export function parseSidCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    if (name === 'sid') {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}
