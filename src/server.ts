import 'dotenv/config';
import express from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { ensureSchema, getPool } from './db';
import { GetJobCommand } from '@aws-sdk/client-mediaconvert';
import { getMediaConvertClient } from './aws/mediaconvert';
import { PORT, STATUS_POLL_MS } from './config';
import { uploadsRouter } from './routes/uploads';
import { signingRouter } from './routes/signing';
import { publishRouter } from './routes/publish';
import { profilesRouter } from './routes/profiles';
import { BUILD_TAG, getVersionInfo } from './utils/version';
import crypto from 'crypto';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const db = getPool();

// Ensure schema on startup
ensureSchema(db).catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Failed ensuring DB schema', e);
});
// Seed RBAC roles/permissions at startup (idempotent)
import { seedRbac } from './db';
seedRbac(db).catch((e) => {
  console.warn('RBAC seed skipped/failed', e);
});

app.get('/health', (_req: ExpressRequest, res: ExpressResponse) => {
  res.json({ ok: true });
});

// Version endpoint
app.get('/version', (_req: ExpressRequest, res: ExpressResponse) => {
  res.json(getVersionInfo());
});
// Mount routes
app.use(signingRouter);
app.use(uploadsRouter);
app.use(profilesRouter);
app.use(publishRouter);

// Serve static with no-store for HTML and X-Build header
const publicDir = path.join(process.cwd(), 'public');
const staticOpts = {
  setHeaders: (res: any, filePath: string) => {
    res.setHeader('X-Build', BUILD_TAG);
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  },
};
app.use(express.static(publicDir, staticOpts as any));
// Experimental scoped route: /exp/:tag/* maps to public/*
app.use('/exp/:tag', express.static(publicDir, staticOpts as any));
// Home -> Vite React app (if present)
app.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  const reactIndex = path.join(publicDir, 'app', 'index.html');
  res.sendFile(reactIndex);
});

// Upload page moved to /uploads
app.get('/uploads', (_req: ExpressRequest, res: ExpressResponse) => {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'upload.html'));
});

// Registration page
app.get('/register', (_req: ExpressRequest, res: ExpressResponse) => {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'register.html'));
});

// Minimal register API (no email verification yet)
app.post('/api/register', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { email, password, displayName, phone } = (req.body || {}) as any;
    const e = String(email || '').trim().toLowerCase();
    const pw = String(password || '');
    const dn = (displayName ? String(displayName) : '').trim().slice(0, 120);
    const ph = (phone ? String(phone) : '').trim().slice(0, 32);
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.status(400).json({ error: 'invalid_email' });
    if (!pw || pw.length < 8) return res.status(400).json({ error: 'weak_password', detail: 'min_length_8' });
    const salt = crypto.randomBytes(16).toString('hex');
    const N = 16384; // scrypt cost
    const hash = crypto.scryptSync(pw, salt, 64, { N }).toString('hex');
    const stored = `s2$${N}$${salt}$${hash}`;
    const db = getPool();
    const [ins] = await db.query(
      `INSERT INTO users (email, password_hash, display_name, phone_number) VALUES (?,?,?,?)`,
      [e, stored, dn || null, ph || null]
    );
    const userId = (ins as any).insertId as number;
    // Create a personal space for the user
    const baseSlug = (dn || e.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
    let slug = `u-${baseSlug}`;
    // ensure unique slug
    let n = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const [exists] = await db.query(`SELECT id FROM spaces WHERE slug = ? LIMIT 1`, [slug]);
      if ((exists as any[]).length === 0) break;
      n += 1; slug = `u-${baseSlug}-${n}`;
    }
    const settings = { visibility: 'public', membership: 'none', publishing: 'owner_only', moderation: 'none', follow_enabled: true };
    const [insSpace] = await db.query(
      `INSERT INTO spaces (type, owner_user_id, name, slug, settings) VALUES ('personal', ?, ?, ?, ?)`,
      [userId, dn || e, slug, JSON.stringify(settings)]
    );
    const spaceId = (insSpace as any).insertId as number;
    // Assign baseline roles: global uploader, space publisher
    await db.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name IN ('uploader')`, [userId]);
    await db.query(`INSERT IGNORE INTO user_space_roles (user_id, space_id, role_id) SELECT ?, ?, id FROM roles WHERE name IN ('publisher','member')`, [userId, spaceId]);
    // For demo UX, set a light indicator so the menu shows LOGOUT (replace with real session later)
    res.cookie('reg', '1', { httpOnly: false, sameSite: 'lax' });
    res.json({ ok: true, userId, space: { id: spaceId, slug } });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('ER_DUP_ENTRY')) return res.status(409).json({ error: 'email_taken' });
    console.error('register error', err);
    res.status(500).json({ error: 'register_failed' });
  }
});

// Login page
app.get('/login', (_req: ExpressRequest, res: ExpressResponse) => {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'login.html'));
});

// Basic login (scrypt verification)
app.post('/api/login', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { email, password } = (req.body || {}) as any;
    const e = String(email || '').trim().toLowerCase();
    const pw = String(password || '');
    if (!e || !pw) return res.status(400).json({ error: 'missing_fields' });
    const db = getPool();
    const [rows] = await db.query(`SELECT id, password_hash FROM users WHERE email = ? LIMIT 1`, [e]);
    const row = (rows as any[])[0];
    if (!row || !row.password_hash) return res.status(401).json({ error: 'invalid_credentials' });
    const stored: string = String(row.password_hash);
    // Expect format: s2$N$salt$hash
    const parts = stored.split('$');
    if (parts.length < 4 || parts[0] !== 's2') return res.status(500).json({ error: 'bad_hash_format' });
    const N = Number(parts[1]);
    const salt = parts[2];
    const hashHex = parts[3];
    const calc = crypto.scryptSync(pw, salt, 64, { N }).toString('hex');
    if (calc !== hashHex) return res.status(401).json({ error: 'invalid_credentials' });
    // Lightweight cookie marker (non-auth) for UX; real session to be added later
    res.cookie('reg', '1', { httpOnly: false, sameSite: 'lax' });
    res.json({ ok: true, userId: row.id });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'login_failed' });
  }
});

// Logout page: clear simple cookie; client will clear localStorage
app.get('/logout', (_req: ExpressRequest, res: ExpressResponse) => {
  res.clearCookie('reg');
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Logged out</title>
  <body style="background:#000;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;display:grid;place-items:center;height:100vh;">
  <div>Logging you out…</div>
  <script>try{localStorage.removeItem('auth');localStorage.removeItem('userId');}catch(e){} setTimeout(function(){location.href='/'},400);</script>
  </body>`);
});

// Simple video player page: /videos?id=123
app.get('/videos', (_req: ExpressRequest, res: ExpressResponse) => {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'videos.html'));
});

// Mobile edge-to-edge player: /mobile?id=123
app.get('/mobile', (_req: ExpressRequest, res: ExpressResponse) => {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'mobile.html'));
});

// PWA swipe prototype
app.get('/pwa-swipe', (_req: ExpressRequest, res: ExpressResponse) => {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'pwa-swipe.html'));
});

// --- Client log collection (dev utility) ---
type ClientLogEntry = {
  ts: number;
  level: string;
  args: any[];
  url?: string;
  sessionId?: string;
};

const CLIENT_LOG_MAX = 1000;
const clientLogRing: ClientLogEntry[] = [];
function pushClientLogs(entries: ClientLogEntry[], ua?: string) {
  for (const e of entries) {
    const rec = { ...e } as any;
    if (ua) rec.ua = ua;
    clientLogRing.push(rec);
    if (clientLogRing.length > CLIENT_LOG_MAX) clientLogRing.shift();
  }
}

app.post('/api/client-log', express.json({ limit: '128kb' }), (req: ExpressRequest, res: ExpressResponse) => {
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

app.get('/api/client-log', (req: ExpressRequest, res: ExpressResponse) => {
  const { session, limit } = req.query as any;
  const lim = Math.min(Number(limit || 200), 1000);
  const items = clientLogRing
    .filter((e) => (session ? e.sessionId === String(session) : true))
    .slice(-lim);
  res.json({ entries: items });
});

// Action log: simple list for debugging (admin UI later)
app.get('/api/action-log', async (req: ExpressRequest, res: ExpressResponse) => {
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
    const [rows] = await db.query(`SELECT id, user_id, action, resource_type, resource_id, detail, created_at FROM action_log ${whereSql} ORDER BY id DESC LIMIT ?`, [...params, lim]);
    res.json({ entries: rows });
  } catch (e: any) {
    res.status(500).json({ error: 'failed_to_fetch_action_log', detail: String(e?.message || e) });
  }
});

import http from 'http';
let pollTimer: ReturnType<typeof setInterval> | undefined;
const server: http.Server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Uploader server listening on http://localhost:${PORT}`);
  if (!pollTimer) pollTimer = setInterval(pollStatuses, STATUS_POLL_MS);
  backfill();
  backfillOrientation();
});

// Background poller to sync MediaConvert job status into DB
let polling = false;
let shuttingDown = false;
async function pollStatuses() {
  if (shuttingDown) return;
  if (polling) return; // avoid overlap
  polling = true;
  try {
    const [rows] = await db.query(
      `SELECT id, mediaconvert_job_id FROM uploads WHERE mediaconvert_job_id IS NOT NULL AND status IN ('queued','processing') ORDER BY id DESC LIMIT 25`
    );
    if (!Array.isArray(rows) || rows.length === 0) return;

    const mc = await getMediaConvertClient(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-1');
    for (const r of rows as any[]) {
      const jobId = r.mediaconvert_job_id as string;
      if (!jobId) continue;
      try {
        const resp = await mc.send(new GetJobCommand({ Id: jobId }));
        const s = resp.Job?.Status;
        if (!s) continue;
        if (s === 'SUBMITTED') {
          // keep as queued
        } else if (s === 'PROGRESSING') {
          await db.query(`UPDATE uploads SET status = 'processing' WHERE id = ?`, [r.id]);
        } else if (s === 'COMPLETE') {
          await db.query(`UPDATE uploads SET status = 'completed' WHERE id = ?`, [r.id]);
        } else if (s === 'CANCELED' || s === 'ERROR') {
          await db.query(`UPDATE uploads SET status = 'failed' WHERE id = ?`, [r.id]);
        }
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.includes('Pool is closed')) {
          // Ignore during shutdown
        } else {
          // eslint-disable-next-line no-console
          console.warn('poll job failed', jobId, msg);
        }
      }
    }
  } finally {
    polling = false;
  }
}
function gracefulStop() {
  try {
    shuttingDown = true;
    if (pollTimer) clearInterval(pollTimer);
    server.close(() => {
      // eslint-disable-next-line no-console
      console.log('Server closed. Bye!')
      process.exit(0)
    })
  } catch {}
}
process.once('SIGINT', gracefulStop);
process.once('SIGTERM', gracefulStop);

// Backfill asset_uuid and date_ymd from s3_key for legacy rows
async function backfill() {
  try {
    const [rows] = await db.query(`SELECT id, s3_key, asset_uuid, date_ymd FROM uploads WHERE (asset_uuid IS NULL OR date_ymd IS NULL) ORDER BY id ASC LIMIT 500`);
    for (const r of rows as any[]) {
      const parsed = parseFromKey(r.s3_key);
      if (parsed) {
        await db.query(`UPDATE uploads SET asset_uuid = COALESCE(asset_uuid, ?), date_ymd = COALESCE(date_ymd, ?) WHERE id = ?`, [parsed.uuid, parsed.date, r.id]);
      }
    }
  } catch (e) {
    console.warn('backfill skipped/failed', e);
  }
}

// Backfill missing orientation based on dimensions or profile
async function backfillOrientation() {
  try {
    const [rows] = await db.query(
      `SELECT id, width, height, profile, orientation FROM uploads WHERE orientation IS NULL ORDER BY id ASC LIMIT 1000`
    );
    for (const r of rows as any[]) {
      const w = Number(r.width || 0);
      const h = Number(r.height || 0);
      let ori: 'portrait' | 'landscape' | null = null;
      if (w > 0 && h > 0) {
        ori = h > w ? 'portrait' : 'landscape';
      } else if (typeof r.profile === 'string') {
        const p = r.profile.toLowerCase();
        if (p.includes('portrait')) ori = 'portrait';
        else if (p.includes('landscape')) ori = 'landscape';
      }
      if (ori) {
        await db.query(`UPDATE uploads SET orientation = ? WHERE id = ?`, [ori, r.id]);
      }
    }
  } catch (e) {
    console.warn('orientation backfill skipped/failed', e);
  }
}

function parseFromKey(key: string): { date: string; uuid: string } | null {
  try {
    const parts = (key || '').split('/');
    for (let i = 0; i < parts.length - 2; i++) {
      const a = parts[i];
      const b = parts[i + 1];
      const c = parts[i + 2];
      // Old pattern: YYYY-MM-DD/UUID/...
      if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^[0-9a-fA-F-]{36}$/.test(b)) {
        return { date: a, uuid: b };
      }
      // New pattern: YYYY-MM/DD/UUID/...
      if (/^\d{4}-\d{2}$/.test(a) && /^\d{2}$/.test(b) && /^[0-9a-fA-F-]{36}$/.test(c)) {
        return { date: `${a}-${b}`, uuid: c };
      }
    }
    const last = parts[parts.length - 1] || '';
    const m = last.match(/^([0-9a-fA-F-]{36})-/);
    if (m) {
      // No explicit date; use created_at date at publish time normally, but fallback to today
      const today = new Date().toISOString().slice(0, 10);
      return { date: today, uuid: m[1] };
    }
  } catch {}
  return null;
}

// (request log helpers moved to utils)

// (HLS aliasing code removed per request)
// Debug logs viewer
app.get('/debug/logs', (_req: ExpressRequest, res: ExpressResponse) => {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'debug-logs.html'));
});
