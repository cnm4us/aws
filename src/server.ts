import 'dotenv/config';
import http from 'http';
import { GetJobCommand } from '@aws-sdk/client-mediaconvert';
import { buildServer } from './app';
import { ensureSchema, getPool, seedRbac } from './db';
import { getMediaConvertClient } from './aws/mediaconvert';
import { PORT, STATUS_POLL_MS } from './config';

const db = getPool();

let server: http.Server | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let polling = false;
let shuttingDown = false;
let backgroundStarted = false;

async function start() {
  try {
    await ensureSchema(db);
  } catch (e) {
    console.error('Failed ensuring DB schema', e);
    process.exit(1);
  }

  try {
    await seedRbac(db);
  } catch (e) {
    console.warn('RBAC seed skipped/failed', e);
  }

  const app = buildServer();
  server = app.listen(PORT, () => {
    console.log(`Uploader server listening on http://localhost:${PORT}`);
  });

  server.on('error', (err) => {
    console.error('Server error', err);
  });

  startBackgroundJobs().catch((err) => {
    console.error('Background jobs failed to start', err);
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});

process.once('SIGINT', () => gracefulStop('SIGINT'));
process.once('SIGTERM', () => gracefulStop('SIGTERM'));
process.once('SIGUSR2', () => gracefulStop('SIGUSR2'));

async function pollStatuses() {
  if (shuttingDown) return;
  if (!backgroundStarted) return;
  if (polling) return;
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
          console.warn('poll job failed', jobId, msg);
        }
      }
    }
  } finally {
    polling = false;
  }
}

async function gracefulStop(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }

  const waitForPolling = (async () => {
    const deadline = Date.now() + 5000;
    while (polling && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();

  try {
    await waitForPolling;
  } catch {}

  const closeServer = server
    ? new Promise<void>((resolve) => {
        server!.close(() => resolve());
      })
    : Promise.resolve();

  try {
    await closeServer;
    console.log('HTTP server closed.');
  } catch (err) {
    console.warn('Error closing server', err);
  }

  try {
    await db.end();
  } catch (err) {
    console.warn('Error closing DB pool', err);
  }

  console.log(`Shutdown complete (${signal}).`);
  process.exit(0);
}

async function backfill() {
  try {
    const [rows] = await db.query(
      `SELECT id, s3_key, asset_uuid, date_ymd FROM uploads WHERE (asset_uuid IS NULL OR date_ymd IS NULL) ORDER BY id ASC LIMIT 500`
    );
    for (const r of rows as any[]) {
      const parsed = parseFromKey(r.s3_key);
      if (parsed) {
        await db.query(
          `UPDATE uploads SET asset_uuid = COALESCE(asset_uuid, ?), date_ymd = COALESCE(date_ymd, ?) WHERE id = ?`,
          [parsed.uuid, parsed.date, r.id]
        );
      }
    }
  } catch (e) {
    console.warn('backfill skipped/failed', e);
  }
}

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

async function startBackgroundJobs() {
  if (backgroundStarted) return;
  await backfill();
  await backfillOrientation();
  if (!shuttingDown && !pollTimer) {
    pollTimer = setInterval(pollStatuses, STATUS_POLL_MS);
  }
  backgroundStarted = true;
}

function parseFromKey(key: string): { date: string; uuid: string } | null {
  try {
    const parts = (key || '').split('/');
    for (let i = 0; i < parts.length - 2; i++) {
      const a = parts[i];
      const b = parts[i + 1];
      const c = parts[i + 2];
      if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^[0-9a-fA-F-]{36}$/.test(b)) {
        return { date: a, uuid: b };
      }
      if (/^\d{4}-\d{2}$/.test(a) && /^\d{2}$/.test(b) && /^[0-9a-fA-F-]{36}$/.test(c)) {
        return { date: `${a}-${b}`, uuid: c };
      }
    }
    const last = parts[parts.length - 1] || '';
    const m = last.match(/^([0-9a-fA-F-]{36})-/);
    if (m) {
      const today = new Date().toISOString().slice(0, 10);
      return { date: today, uuid: m[1] };
    }
  } catch {}
  return null;
}
