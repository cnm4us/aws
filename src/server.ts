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
    const [uploadRows] = await db.query(
      `SELECT id, mediaconvert_job_id, status
         FROM uploads
        WHERE mediaconvert_job_id IS NOT NULL
          AND status IN ('queued','processing')
        ORDER BY id DESC
        LIMIT 200`
    );
    const [productionRows] = await db.query(
      `SELECT id, mediaconvert_job_id, status, started_at, completed_at
         FROM productions
        WHERE mediaconvert_job_id IS NOT NULL
          AND status IN ('pending','queued','processing')
        ORDER BY id DESC
        LIMIT 200`
    );

    if ((!Array.isArray(uploadRows) || uploadRows.length === 0) && (!Array.isArray(productionRows) || productionRows.length === 0)) {
      return;
    }

    type JobBucket = { uploads: any[]; productions: any[] };
    const jobs = new Map<string, JobBucket>();

    for (const row of uploadRows as any[]) {
      const jobId = row.mediaconvert_job_id as string | null;
      if (!jobId) continue;
      if (!jobs.has(jobId)) jobs.set(jobId, { uploads: [], productions: [] });
      jobs.get(jobId)!.uploads.push(row);
    }

    for (const row of productionRows as any[]) {
      const jobId = row.mediaconvert_job_id as string | null;
      if (!jobId) continue;
      if (!jobs.has(jobId)) jobs.set(jobId, { uploads: [], productions: [] });
      jobs.get(jobId)!.productions.push(row);
    }

    if (!jobs.size) return;

    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-1';
    const mc = await getMediaConvertClient(region);

    for (const [jobId, bucket] of jobs.entries()) {
      let status: string | undefined;
      let errorMessage: string | undefined;
      let timing: {
        StartTime?: Date;
        FinishTime?: Date;
      } | undefined;

      try {
        const resp = await mc.send(new GetJobCommand({ Id: jobId }));
        status = resp.Job?.Status;
        errorMessage = resp.Job?.ErrorMessage || undefined;
        const timingRaw: any = resp.Job?.Timing;
        if (timingRaw) {
          timing = {
            StartTime: timingRaw.StartTime ? new Date(timingRaw.StartTime) : undefined,
            FinishTime: timingRaw.FinishTime ? new Date(timingRaw.FinishTime) : undefined,
          };
        }
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.includes('Pool is closed')) {
          continue;
        }
        if (msg.includes('NotFound')) {
          status = 'ERROR';
          errorMessage = 'mediaconvert_job_not_found';
        } else {
          console.warn('poll job failed', jobId, msg);
          continue;
        }
      }

      if (!status) continue;

      // Update uploads table based on job status
      for (const row of bucket.uploads) {
        const uploadId = row.id;
        if (status === 'PROGRESSING' && row.status !== 'processing') {
          await db.query(`UPDATE uploads SET status = 'processing' WHERE id = ?`, [uploadId]);
        } else if (status === 'COMPLETE' && row.status !== 'completed') {
          await db.query(`UPDATE uploads SET status = 'completed' WHERE id = ?`, [uploadId]);
        } else if ((status === 'CANCELED' || status === 'ERROR') && row.status !== 'failed') {
          await db.query(`UPDATE uploads SET status = 'failed' WHERE id = ?`, [uploadId]);
        }
      }

      // Update productions table based on job status
      for (const row of bucket.productions) {
        const productionId = row.id;
        const startTime = timing?.StartTime ?? undefined;
        const finishTime = timing?.FinishTime ?? undefined;

        if (status === 'SUBMITTED') {
          if (row.status !== 'queued' && row.status !== 'pending') {
            await db.query(
              `UPDATE productions SET status = 'queued', error_message = NULL WHERE id = ?`,
              [productionId]
            );
          }
        } else if (status === 'PROGRESSING') {
          if (row.status !== 'processing') {
            const effectiveStart = startTime ?? new Date();
            await db.query(
              `UPDATE productions
                  SET status = 'processing',
                      started_at = IFNULL(started_at, ?),
                      completed_at = NULL,
                      error_message = NULL
                WHERE id = ?`,
              [effectiveStart, productionId]
            );
          }
        } else if (status === 'COMPLETE') {
          if (row.status !== 'completed') {
            const effectiveStart = startTime ?? new Date();
            const effectiveFinish = finishTime ?? new Date();
            await db.query(
              `UPDATE productions
                  SET status = 'completed',
                      started_at = IFNULL(started_at, ?),
                      completed_at = IFNULL(completed_at, ?),
                      error_message = NULL
                WHERE id = ?`,
              [effectiveStart, effectiveFinish, productionId]
            );
          }
        } else if (status === 'CANCELED' || status === 'ERROR') {
          if (row.status !== 'failed') {
            const effectiveFinish = finishTime ?? new Date();
            const detail = (errorMessage || status || 'failed').slice(0, 500);
            await db.query(
              `UPDATE productions
                  SET status = 'failed',
                      completed_at = IFNULL(completed_at, ?),
                      error_message = ?
                WHERE id = ?`,
              [effectiveFinish, detail, productionId]
            );
          }
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
