import 'dotenv/config';
import http from 'http';
import { GetJobCommand } from '@aws-sdk/client-mediaconvert';
import { buildServer } from './app';
import { ensureSchema, getPool, seedRbac } from './db';
import { getMediaConvertClient } from './aws/mediaconvert';
import { ASSEMBLYAI_AUTOTRANSCRIBE, ASSEMBLYAI_ENABLED, MEDIA_JOBS_ENABLED, PORT, STATUS_POLL_MS } from './config';
import { startMediaJobsWorker, stopMediaJobsWorkerAndWait } from './services/mediaJobs/worker';
import * as mediaJobs from './features/media-jobs/service'
import { getLogger, logError, observabilityConfig } from './lib/logger';
import { shutdownObservability } from './lib/observability';

const db = getPool();
const serverLogger = getLogger({ component: 'server' })

let server: http.Server | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let polling = false;
let shuttingDown = false;
let backgroundStarted = false;

async function start() {
  try {
    await ensureSchema(db);
  } catch (e) {
    logError(serverLogger, e, 'failed_ensuring_db_schema')
    process.exit(1);
  }

  try {
    await seedRbac(db);
  } catch (e) {
    serverLogger.warn({ err: e }, 'rbac_seed_skipped_or_failed')
  }

  serverLogger.info(
    {
      port: PORT,
      ...observabilityConfig(),
    },
    'server.starting'
  )

  const app = buildServer();
  server = app.listen(PORT, () => {
    serverLogger.info({ port: PORT }, 'server.listening')
  });

  server.on('error', (err) => {
    logError(serverLogger, err, 'server_error')
  });

  startBackgroundJobs().catch((err) => {
    logError(serverLogger, err, 'background_jobs_failed_to_start')
  });
}

start().catch((err) => {
  logError(serverLogger, err, 'failed_to_start_server')
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
          serverLogger.warn({ job_id: jobId, message: msg }, 'poll_job_failed')
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

            // Optional: enqueue AssemblyAI transcript job (Plan 44).
            // Guarded behind env flags because it incurs third-party API costs.
            try {
              const hasKey = String(process.env.ASSEMBLYAI_API_KEY || '').trim().length > 0
              if (hasKey && MEDIA_JOBS_ENABLED && ASSEMBLYAI_ENABLED && ASSEMBLYAI_AUTOTRANSCRIBE) {
                const [existing] = await db.query(
                  `SELECT id
                     FROM media_jobs
                    WHERE type = 'assemblyai_transcript_v1'
                      AND status IN ('pending','processing','completed')
                      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.productionId')) AS UNSIGNED) = ?
                    ORDER BY id DESC
                    LIMIT 1`,
                  [productionId]
                )
                if (!Array.isArray(existing) || (existing as any[]).length === 0) {
                  await mediaJobs.enqueueJob('assemblyai_transcript_v1', { productionId })
                }
              }
            } catch {}
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

  try { await stopMediaJobsWorkerAndWait({ timeoutMs: 1500 }); } catch {}

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
    serverLogger.info('http_server_closed')
  } catch (err) {
    serverLogger.warn({ err }, 'error_closing_server')
  }

  try {
    await db.end();
  } catch (err) {
    const msg = String((err as any)?.message || err || '')
    // During dev shutdown, in-flight queries (worker/request) can race the pool close.
    // It's safe to ignore these on process exit.
    if (!(msg.includes('closed state') || msg.includes('Pool is closed'))) {
      serverLogger.warn({ err }, 'error_closing_db_pool')
    }
  }

  try {
    await shutdownObservability()
  } catch {}

  serverLogger.info({ signal }, 'shutdown_complete')
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
    serverLogger.warn({ err: e }, 'backfill_skipped_or_failed')
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
    serverLogger.warn({ err: e }, 'orientation_backfill_skipped_or_failed')
  }
}

async function startBackgroundJobs() {
  if (backgroundStarted) return;
  await backfill();
  await backfillOrientation();
  if (!shuttingDown && !pollTimer) {
    pollTimer = setInterval(pollStatuses, STATUS_POLL_MS);
  }
  try { startMediaJobsWorker(); } catch (e) { serverLogger.warn({ err: e }, 'media_jobs_worker_start_failed') }
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
