import type { Pool, PoolConnection } from 'mysql2/promise'
import { getPool } from '../../db'
import type { MediaJobAttemptRow, MediaJobRow, MediaJobStatus } from './types'

type Conn = PoolConnection | Pool

function poolOr(conn?: Conn) {
  return conn || getPool()
}

export async function createJob(
  input: {
    type: string
    priority?: number
    maxAttempts?: number
    runAfter?: Date | null
    inputJson: any
  },
  conn?: Conn
): Promise<MediaJobRow> {
  const db = poolOr(conn)
  const priority = Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0
  const maxAttempts = Number.isFinite(Number(input.maxAttempts)) ? Math.max(1, Math.round(Number(input.maxAttempts))) : 3
  const runAfter = input.runAfter ? input.runAfter.toISOString().slice(0, 19).replace('T', ' ') : null
  const [res] = await db.query(
    `INSERT INTO media_jobs (type, status, priority, attempts, max_attempts, run_after, input_json)
     VALUES (?, 'pending', ?, 0, ?, ?, ?)`,
    [input.type, priority, maxAttempts, runAfter, JSON.stringify(input.inputJson ?? {})]
  )
  const id = Number((res as any).insertId)
  const row = await getById(id, conn)
  return row!
}

export async function getById(id: number, conn?: Conn): Promise<MediaJobRow | null> {
  const db = poolOr(conn)
  const [rows] = await db.query(`SELECT * FROM media_jobs WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  if (!row) return null
  try {
    if (typeof row.input_json === 'string') row.input_json = JSON.parse(row.input_json)
  } catch {}
  try {
    if (typeof row.result_json === 'string') row.result_json = JSON.parse(row.result_json)
  } catch {}
  return row as any
}

export async function listLatest(limit: number, conn?: Conn): Promise<MediaJobRow[]> {
  const db = poolOr(conn)
  const lim = Math.max(1, Math.min(500, Math.round(Number(limit) || 50)))
  const [rows] = await db.query(`SELECT * FROM media_jobs ORDER BY id DESC LIMIT ${lim}`)
  return (rows as any[]).map((r) => {
    try { if (typeof r.input_json === 'string') r.input_json = JSON.parse(r.input_json) } catch {}
    try { if (typeof r.result_json === 'string') r.result_json = JSON.parse(r.result_json) } catch {}
    return r
  }) as any
}

export async function claimNext(
  params: { workerId: string; type?: string | null; now?: Date },
  conn: PoolConnection
): Promise<MediaJobRow | null> {
  const now = params.now ? params.now.toISOString().slice(0, 19).replace('T', ' ') : null
  const type = params.type ? String(params.type) : null
  const whereType = type ? `AND type = ?` : ``
  const args: any[] = []
  if (type) args.push(type)
  args.push(now, now)

  const [rows] = await conn.query(
    `SELECT *
       FROM media_jobs
      WHERE status = 'pending'
        ${whereType}
        AND (run_after IS NULL OR run_after <= COALESCE(?, NOW()))
        AND (locked_at IS NULL OR locked_at < DATE_SUB(COALESCE(?, NOW()), INTERVAL 30 MINUTE))
      ORDER BY priority DESC, id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
    args
  )
  const row = (rows as any[])[0]
  if (!row) return null

  await conn.query(
    `UPDATE media_jobs
        SET status = 'processing',
            locked_at = NOW(),
            locked_by = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [params.workerId, row.id]
  )

  try { if (typeof row.input_json === 'string') row.input_json = JSON.parse(row.input_json) } catch {}
  try { if (typeof row.result_json === 'string') row.result_json = JSON.parse(row.result_json) } catch {}
  row.status = 'processing'
  row.locked_at = new Date().toISOString().slice(0, 19).replace('T', ' ')
  row.locked_by = params.workerId
  return row as any
}

export async function createAttempt(jobId: number, attemptNo: number, workerId: string, conn?: Conn): Promise<MediaJobAttemptRow> {
  const db = poolOr(conn)
  const [res] = await db.query(
    `INSERT INTO media_job_attempts (job_id, attempt_no, worker_id)
     VALUES (?, ?, ?)`,
    [jobId, attemptNo, workerId]
  )
  const id = Number((res as any).insertId)
  const row = await getAttemptById(id, conn)
  return row!
}

export async function getAttemptById(id: number, conn?: Conn): Promise<MediaJobAttemptRow | null> {
  const db = poolOr(conn)
  const [rows] = await db.query(`SELECT * FROM media_job_attempts WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  if (!row) return null
  try { if (typeof row.scratch_manifest_json === 'string') row.scratch_manifest_json = JSON.parse(row.scratch_manifest_json) } catch {}
  return row as any
}

export async function listAttempts(jobId: number, conn?: Conn): Promise<MediaJobAttemptRow[]> {
  const db = poolOr(conn)
  const [rows] = await db.query(
    `SELECT *
       FROM media_job_attempts
      WHERE job_id = ?
      ORDER BY attempt_no ASC, id ASC`,
    [jobId]
  )
  return (rows as any[]).map((r) => {
    try { if (typeof r.scratch_manifest_json === 'string') r.scratch_manifest_json = JSON.parse(r.scratch_manifest_json) } catch {}
    return r
  }) as any
}

export async function finishAttempt(
  attemptId: number,
  patch: {
    exitCode?: number | null
    stdout?: { bucket: string; key: string } | null
    stderr?: { bucket: string; key: string } | null
    artifacts?: { bucket: string; prefix: string } | null
    scratchManifestJson?: any
  },
  conn?: Conn
): Promise<void> {
  const db = poolOr(conn)
  const stdoutBucket = patch.stdout?.bucket ?? null
  const stdoutKey = patch.stdout?.key ?? null
  const stderrBucket = patch.stderr?.bucket ?? null
  const stderrKey = patch.stderr?.key ?? null
  const artifactsBucket = patch.artifacts?.bucket ?? null
  const artifactsPrefix = patch.artifacts?.prefix ?? null
  const scratchManifestJson = patch.scratchManifestJson !== undefined ? JSON.stringify(patch.scratchManifestJson) : null
  const exitCode = patch.exitCode !== undefined ? patch.exitCode : null

  await db.query(
    `UPDATE media_job_attempts
        SET finished_at = NOW(),
            exit_code = COALESCE(?, exit_code),
            stdout_s3_bucket = COALESCE(?, stdout_s3_bucket),
            stdout_s3_key = COALESCE(?, stdout_s3_key),
            stderr_s3_bucket = COALESCE(?, stderr_s3_bucket),
            stderr_s3_key = COALESCE(?, stderr_s3_key),
            artifacts_s3_bucket = COALESCE(?, artifacts_s3_bucket),
            artifacts_s3_prefix = COALESCE(?, artifacts_s3_prefix),
            scratch_manifest_json = COALESCE(?, scratch_manifest_json)
      WHERE id = ?`,
    [exitCode, stdoutBucket, stdoutKey, stderrBucket, stderrKey, artifactsBucket, artifactsPrefix, scratchManifestJson, attemptId]
  )
}

export async function updateJobProcessingHeartbeat(jobId: number, workerId: string, conn?: Conn): Promise<void> {
  const db = poolOr(conn)
  await db.query(
    `UPDATE media_jobs
        SET locked_at = NOW(), locked_by = ?, updated_at = NOW()
      WHERE id = ? AND status = 'processing'`,
    [workerId, jobId]
  )
}

export async function completeJob(jobId: number, resultJson: any, conn?: Conn): Promise<void> {
  const db = poolOr(conn)
  await db.query(
    `UPDATE media_jobs
        SET status = 'completed',
            result_json = ?,
            error_code = NULL,
            error_message = NULL,
            locked_at = NULL,
            locked_by = NULL,
            completed_at = NOW(),
            updated_at = NOW()
      WHERE id = ?`,
    [JSON.stringify(resultJson ?? {}), jobId]
  )
}

export async function failJob(
  jobId: number,
  patch: { errorCode?: string | null; errorMessage?: string | null; status?: MediaJobStatus; runAfter?: Date | null },
  conn?: Conn
): Promise<void> {
  const db = poolOr(conn)
  const status: MediaJobStatus = patch.status || 'failed'
  const runAfter = patch.runAfter ? patch.runAfter.toISOString().slice(0, 19).replace('T', ' ') : null
  await db.query(
    `UPDATE media_jobs
        SET status = ?,
            error_code = ?,
            error_message = ?,
            run_after = ?,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
      WHERE id = ?`,
    [status, patch.errorCode ?? null, patch.errorMessage ?? null, runAfter, jobId]
  )
}

export async function bumpAttempts(jobId: number, conn?: Conn): Promise<{ attempts: number; maxAttempts: number }> {
  const db = poolOr(conn)
  await db.query(`UPDATE media_jobs SET attempts = attempts + 1, updated_at = NOW() WHERE id = ?`, [jobId])
  const row = await getById(jobId, conn)
  return { attempts: Number(row?.attempts || 0), maxAttempts: Number(row?.max_attempts || 3) }
}
