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

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const db = getPool();

// Ensure schema on startup
ensureSchema(db).catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Failed ensuring DB schema', e);
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
app.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'upload.html'));
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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Uploader server listening on http://localhost:${PORT}`);
});

// Background poller to sync MediaConvert job status into DB
let polling = false;
async function pollStatuses() {
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
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('poll job failed', jobId, e);
      }
    }
  } finally {
    polling = false;
  }
}
setInterval(pollStatuses, STATUS_POLL_MS);

// Backfill asset_uuid and date_ymd from s3_key for legacy rows
(async function backfill() {
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
})();

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
