import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { getPool } from '../db';

const scrypt = promisify(crypto.scrypt);
// Bounded asynchronous password work, shared by browser and native sign-in.
let active = 0;
const dummy = `s2$16384$${'0'.repeat(32)}$${'0'.repeat(128)}`;
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (active >= 4) throw Object.assign(new Error('auth_busy'), { status: 503 });
  const parts = String(stored || dummy).split('$');
  const valid = parts.length === 4 && parts[0] === 's2' && parts[1] === '16384'
    && /^[a-f0-9]{32}$/i.test(parts[2]) && /^[a-f0-9]{128}$/i.test(parts[3]);
  const source = valid ? parts : dummy.split('$');
  active++;
  try {
    const actual = await scrypt(password, source[2], 64) as Buffer;
    const equal = crypto.timingSafeEqual(actual, Buffer.from(source[3], 'hex'));
    return !!stored && valid && equal;
  } finally { active--; }
}

export async function verifyCredentials(email: string, password: string) {
  if (!email || email.length > 254 || !password || password.length > 1024) return null;
  const [rows] = await getPool().query('SELECT id,display_name,password_hash,deleted_at FROM users WHERE email=? LIMIT 1', [email.trim().toLowerCase()]);
  const row = (rows as any[])[0];
  const valid = await verifyPassword(password, row?.password_hash || null);
  if (!row || row.deleted_at || !valid) return null;
  return { id: Number(row.id), displayName: row.display_name ? String(row.display_name) : null,
    credentialHash: crypto.createHash('sha256').update(String(row.password_hash)).digest() };
}
