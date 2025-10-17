import express from 'express';
import cors, { type CorsOptions } from 'cors';
import path from 'path';
import crypto from 'crypto';
import { uploadsRouter } from './routes/uploads';
import { signingRouter } from './routes/signing';
import { publishRouter } from './routes/publish';
import { profilesRouter } from './routes/profiles';
import { pagesRouter } from './routes/pages';
import { BUILD_TAG, getVersionInfo } from './utils/version';
import { sessionParse } from './middleware/sessionParse';
import { csrfProtect } from './middleware/csrf';
import { requireAuth } from './middleware/auth';
import { getPool } from './db';
import { createSession, revokeSession, parseSidCookie } from './security/sessionStore';

export function buildServer(): express.Application {
  const app = express();
  const allowedOrigins = new Set<string>([
    'https://aws.bawebtech.com',
    'https://videos.bawebtech.com',
  ]);
  const corsOptions: CorsOptions = {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  };
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '2mb' }));
  app.use(sessionParse);
  app.use(csrfProtect);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/version', (_req, res) => {
    res.json(getVersionInfo());
  });

  app.use(signingRouter);
  app.use(uploadsRouter);
  app.use(profilesRouter);
  app.use(publishRouter);

  app.get('/api/me', async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.json({
          userId: null,
          email: null,
          displayName: null,
          roles: [],
          spaceRoles: {},
          personalSpace: null,
        });
      }

      const db = getPool();
      const [roleRows] = await db.query(
        `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
        [user.id]
      );
      const roles = (roleRows as any[]).map((r) => String(r.name));

      const [spaceRoleRows] = await db.query(
        `SELECT usr.space_id, r.name
           FROM user_space_roles usr
           JOIN roles r ON r.id = usr.role_id
          WHERE usr.user_id = ?`,
        [user.id]
      );
      const spaceRoles: Record<string, string[]> = {};
      for (const row of spaceRoleRows as any[]) {
        const sid = String(row.space_id);
        if (!spaceRoles[sid]) spaceRoles[sid] = [];
        spaceRoles[sid].push(String(row.name));
      }

      const [personal] = await db.query(
        `SELECT id, slug FROM spaces WHERE type = 'personal' AND owner_user_id = ? LIMIT 1`,
        [user.id]
      );
      const personalSpaceRow = (personal as any[])[0];
      const personalSpace = personalSpaceRow
        ? { id: Number(personalSpaceRow.id), slug: String(personalSpaceRow.slug) }
        : null;

      res.json({
        userId: user.id,
        email: user.email,
        displayName: user.display_name,
        roles,
        spaceRoles,
        personalSpace,
      });
    } catch (err: any) {
      console.error('me endpoint error', err);
      res.status(500).json({ error: 'me_failed', detail: String(err?.message || err) });
    }
  });

  const publicDir = path.join(process.cwd(), 'public');
  const staticOpts = {
    setHeaders: (res: any, filePath: string) => {
      res.setHeader('X-Build', BUILD_TAG);
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  };
  app.use('/exp/:tag', express.static(publicDir, staticOpts as any));
  app.use(pagesRouter);
  app.use(express.static(publicDir, staticOpts as any));

  app.post('/api/register', async (req, res) => {
    try {
      const { email, password, displayName, phone } = (req.body || {}) as any;
      const e = String(email || '').trim().toLowerCase();
      const pw = String(password || '');
      const dn = (displayName ? String(displayName) : '').trim().slice(0, 120);
      const ph = (phone ? String(phone) : '').trim().slice(0, 32);
      if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.status(400).json({ error: 'invalid_email' });
      if (!pw || pw.length < 8) return res.status(400).json({ error: 'weak_password', detail: 'min_length_8' });
      const salt = crypto.randomBytes(16).toString('hex');
      const N = 16384;
      const hash = crypto.scryptSync(pw, salt, 64, { N }).toString('hex');
      const stored = `s2$${N}$${salt}$${hash}`;
      const db = getPool();
      const [ins] = await db.query(
        `INSERT INTO users (email, password_hash, display_name, phone_number) VALUES (?,?,?,?)`,
        [e, stored, dn || null, ph || null]
      );
      const userId = (ins as any).insertId as number;
      const baseSlug = (dn || e.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
      let slug = `u-${baseSlug}`;
      let n = 1;
      while (true) {
        const [exists] = await db.query(`SELECT id FROM spaces WHERE slug = ? LIMIT 1`, [slug]);
        if ((exists as any[]).length === 0) break;
        n += 1;
        slug = `u-${baseSlug}-${n}`;
      }
      const settings = { visibility: 'public', membership: 'none', publishing: 'owner_only', moderation: 'none', follow_enabled: true };
      const [insSpace] = await db.query(
        `INSERT INTO spaces (type, owner_user_id, name, slug, settings) VALUES ('personal', ?, ?, ?, ?)`,
        [userId, dn || e, slug, JSON.stringify(settings)]
      );
      const spaceId = (insSpace as any).insertId as number;
      await db.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name IN ('uploader')`, [userId]);
      await db.query(`INSERT IGNORE INTO user_space_roles (user_id, space_id, role_id) SELECT ?, ?, id FROM roles WHERE name IN ('publisher','member')`, [userId, spaceId]);
      res.json({ ok: true, userId, space: { id: spaceId, slug } });
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY')) return res.status(409).json({ error: 'email_taken' });
      console.error('register error', err);
      res.status(500).json({ error: 'register_failed' });
    }
  });

  app.post('/api/login', async (req, res) => {
    try {
      const { email, password } = (req.body || {}) as any;
      const e = String(email || '').trim().toLowerCase();
      const pw = String(password || '');
      if (!e || !pw) return res.status(400).json({ error: 'missing_fields' });
      const db = getPool();
      const [rows] = await db.query(`SELECT id, password_hash FROM users WHERE email = ? LIMIT 1`, [e]);
      const row = (rows as any[])[0];
      if (!row || !row.password_hash) return res.status(401).json({ error: 'invalid_credentials' });
      const parts = String(row.password_hash).split('$');
      if (parts.length < 4 || parts[0] !== 's2') return res.status(500).json({ error: 'bad_hash_format' });
      const N = Number(parts[1]);
      const salt = parts[2];
      const hashHex = parts[3];
      const calc = crypto.scryptSync(pw, salt, 64, { N }).toString('hex');
      if (calc !== hashHex) return res.status(401).json({ error: 'invalid_credentials' });
      const expiresMs = 30 * 24 * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + expiresMs);
      const forwarded = req.headers['x-forwarded-for'];
      const ip = Array.isArray(forwarded)
        ? forwarded[0]
        : (forwarded ? forwarded.split(',')[0] : '') || req.ip;
      const ua = String(req.headers['user-agent'] || '');
      const session = await createSession({
        userId: Number(row.id),
        ip: ip ? String(ip) : null,
        ua: ua || null,
        expiresAt,
      });
      const protoHeader = String(req.headers['x-forwarded-proto'] || '');
      const secure = protoHeader.toLowerCase() === 'https' || req.secure;
      const maxAge = expiresMs;
      res.cookie('sid', session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge,
        path: '/',
      });
      const csrfToken = crypto.randomBytes(16).toString('hex');
      res.cookie('csrf', csrfToken, {
        httpOnly: false,
        sameSite: 'lax',
        secure,
        maxAge,
        path: '/',
      });
      res.json({ ok: true, userId: row.id });
    } catch (err) {
      console.error('login error', err);
      res.status(500).json({ error: 'login_failed' });
    }
  });

  app.get('/logout', async (req, res) => {
    const token = req.session?.token || parseSidCookie(req.headers.cookie);
    if (token) {
      try {
        await revokeSession(token);
      } catch (err) {
        console.warn('logout revoke failed', err);
      }
    }
    res.clearCookie('sid');
    res.clearCookie('csrf');
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Logged out</title>
  <body style="background:#000;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;display:grid;place-items:center;height:100vh;">
  <div>Logging you out…</div>
  <script>setTimeout(function(){location.href='/'},400);</script>
  </body>`);
  });

  type ClientLogEntry = {
    ts: number;
    level: string;
    args: any[];
    url?: string;
    sessionId?: string;
  };

  const CLIENT_LOG_MAX = 1000;
  const clientLogRing: ClientLogEntry[] = [];
  const pushClientLogs = (entries: ClientLogEntry[], ua?: string) => {
    for (const e of entries) {
      const rec = { ...e } as any;
      if (ua) rec.ua = ua;
      clientLogRing.push(rec);
      if (clientLogRing.length > CLIENT_LOG_MAX) clientLogRing.shift();
    }
  };

  app.post('/api/client-log', requireAuth, express.json({ limit: '128kb' }), (req, res) => {
    try {
      const body = req.body as any;
      const ua = String(req.headers['user-agent'] || '');
      if (Array.isArray(body?.entries)) pushClientLogs(body.entries, ua);
      else if (Array.isArray(body)) pushClientLogs(body, ua);
      else if (body && typeof body === 'object') pushClientLogs([body], ua);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: 'bad_payload', detail: String(e?.message || e) });
    }
  });

  app.get('/api/client-log', requireAuth, (req, res) => {
    const { session, limit } = req.query as any;
    const lim = Math.min(Number(limit || 200), 1000);
    const items = clientLogRing
      .filter((e) => (session ? e.sessionId === String(session) : true))
      .slice(-lim);
    res.json({ entries: items });
  });

  app.get('/api/action-log', async (req, res) => {
    try {
      const db = getPool();
      const { user_id, action, resource_type, resource_id, limit } = req.query as any;
      const lim = Math.min(Number(limit || 200), 1000);
      const where: string[] = [];
      const params: any[] = [];
      if (user_id) { where.push('user_id = ?'); params.push(Number(user_id)); }
      if (action) { where.push('action = ?'); params.push(String(action)); }
      if (resource_type) { where.push('resource_type = ?'); params.push(String(resource_type)); }
      if (resource_id) { where.push('resource_id = ?'); params.push(Number(resource_id)); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [rows] = await db.query(
        `SELECT id, user_id, action, resource_type, resource_id, detail, created_at FROM action_log ${whereSql} ORDER BY id DESC LIMIT ?`,
        [...params, lim]
      );
      res.json({ entries: rows });
    } catch (e: any) {
      res.status(500).json({ error: 'failed_to_fetch_action_log', detail: String(e?.message || e) });
    }
  });

  return app;
}
