import crypto from 'node:crypto';
import type { Request } from 'express';
import type {} from '../../middleware/sessionParse';
import { isIP } from 'node:net';
import { getPool } from '../../db';
import { verifyCredentials } from '../../security/credentials';

export class ViewerApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter?: number) { super(code); }
}
export const nativeEnabled = () => process.env.NATIVE_SESSIONS_ENABLED === '1';
export type Viewer = { id: number; displayName: string | null };
export type Principal = { viewer: Viewer; source: 'native' | 'cookie'; expiresAt?: string };
const digest = (v: string) => crypto.createHash('sha256').update(v).digest();
const validToken = (v: string) => /^nv1_[a-f0-9]{64}$/.test(v);
const hasSid = (req: Request) => /(?:^|;)\s*sid=/.test(req.headers.cookie || '');
const loopback = (ip: string) => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip);
export function requestTransport(req: Request) {
  const peer = req.socket.remoteAddress || '';
  const trusted = process.env.NATIVE_TRUST_LOOPBACK_PROXY === '1' && loopback(peer);
  const forwarded = trusted ? String(req.headers['x-forwarded-for'] || '').split(',').pop()?.trim() : null;
  return { secure: req.secure || (trusted && req.headers['x-forwarded-proto'] === 'https'),
    ip: forwarded && isIP(forwarded) ? forwarded : peer,
    local: loopback(peer) && !req.headers['x-forwarded-for'] };
}
export function requireNativeTransport(req: Request) {
  const t = requestTransport(req);
  if (!t.secure && !(t.local && process.env.NATIVE_ALLOW_INSECURE_LOOPBACK === '1')) throw new ViewerApiError(426,'https_required');
}
export function readBearer(req: Request, required = true): string | null {
  if (req.headers.authorization && hasSid(req)) throw new ViewerApiError(400,'ambiguous_auth');
  const header = req.headers.authorization;
  if (!header && !required) return null;
  const token = /^Bearer (\S+)$/i.exec(header || '')?.[1];
  if (!token || !validToken(token)) throw new ViewerApiError(401,'unauthorized');
  return token;
}

export async function consumeLoginLimit(email: string, ip: string) {
  const db = getPool();
  // Each request inserts at most two keys and expires up to 100, bounding retained expired rows.
  await db.query('DELETE FROM native_login_limits WHERE resets_at < NOW() ORDER BY resets_at LIMIT 100');
  // Stop blocked IPs before creating additional account keys.
  for (const [key,max] of [[`ip:${ip}`,30],[`account:${email}`,10]] as const) {
    const hash = digest(key);
    await db.query(`INSERT INTO native_login_limits (key_hash,attempts,resets_at) VALUES (?,1,DATE_ADD(NOW(),INTERVAL 15 MINUTE))
      ON DUPLICATE KEY UPDATE attempts=IF(resets_at<=NOW(),1,attempts+1),resets_at=IF(resets_at<=NOW(),DATE_ADD(NOW(),INTERVAL 15 MINUTE),resets_at)`, [hash]);
    const [rows] = await db.query('SELECT attempts,GREATEST(1,TIMESTAMPDIFF(SECOND,NOW(),resets_at)) wait_seconds FROM native_login_limits WHERE key_hash=?', [hash]);
    const row = (rows as any[])[0];
    if (Number(row.attempts)>max) throw new ViewerApiError(429,'rate_limited',Number(row.wait_seconds));
  }
}

export async function createNativeSession(email: string, password: string) {
  const user = await verifyCredentials(email,password);
  if (!user) throw new ViewerApiError(401,'invalid_credentials');
  const token = `nv1_${crypto.randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now()+30*24*60*60*1000);
  await getPool().query('INSERT INTO native_sessions (user_id,token_hash,credential_hash,expires_at) VALUES (?,?,?,?)',
    [user.id,digest(token),user.credentialHash,expiresAt.toISOString().slice(0,19).replace('T',' ')]);
  return { token,expiresAt: expiresAt.toISOString(),viewer: { id:user.id,displayName:user.displayName } };
}
export async function resolveNativeSession(token: string): Promise<Principal> {
  if (!nativeEnabled()) throw new ViewerApiError(503,'native_unavailable');
  const [rows] = await getPool().query(`SELECT u.id,u.display_name,n.expires_at FROM native_sessions n JOIN users u ON u.id=n.user_id
    WHERE n.token_hash=? AND n.revoked_at IS NULL AND n.expires_at>NOW() AND u.deleted_at IS NULL
      AND n.credential_hash=UNHEX(SHA2(u.password_hash,256)) LIMIT 1`, [digest(token)]);
  const row = (rows as any[])[0];
  if (!row) throw new ViewerApiError(401,'unauthorized');
  return { source:'native',viewer:{id:Number(row.id),displayName:row.display_name ? String(row.display_name) : null},
    expiresAt:new Date(String(row.expires_at).replace(' ','T')+'Z').toISOString() };
}
export async function revokeNativeSession(token: string) {
  await getPool().query('UPDATE native_sessions SET revoked_at=NOW() WHERE token_hash=? AND revoked_at IS NULL',[digest(token)]);
}
export async function resolveViewer(req: Request, required: boolean): Promise<Principal | null> {
  const token=readBearer(req,false);
  if (token) { requireNativeTransport(req); return resolveNativeSession(token); }
  if (hasSid(req)) {
    if(req.sessionParseFailed) throw new ViewerApiError(503,'service_unavailable');
    if (!req.user || !req.session) throw new ViewerApiError(401,'unauthorized');
    const [rows] = await getPool().query('SELECT id,display_name FROM users WHERE id=? AND deleted_at IS NULL',[req.user.id]);
    const row=(rows as any[])[0];
    if (!row) throw new ViewerApiError(401,'unauthorized');
    return {source:'cookie',viewer:{id:Number(row.id),displayName:row.display_name ? String(row.display_name):null}};
  }
  if (required) throw new ViewerApiError(401,'unauthorized');
  return null;
}
