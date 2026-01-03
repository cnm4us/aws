import { getPool } from '../../db'
import * as repo from './repo'
import type { MediaJobAttemptRow, MediaJobRow, MediaJobType } from './types'

export async function enqueueJob(type: MediaJobType, inputJson: any, opts?: { priority?: number; maxAttempts?: number; runAfter?: Date | null }) {
  return repo.createJob(
    {
      type,
      inputJson,
      priority: opts?.priority,
      maxAttempts: opts?.maxAttempts,
      runAfter: opts?.runAfter ?? null,
    },
  )
}

export async function claimNextJobWithAttempt(params: { workerId: string; type?: string | null }): Promise<{
  job: MediaJobRow
  attempt: MediaJobAttemptRow
} | null> {
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const job = await repo.claimNext({ workerId: params.workerId, type: params.type || null }, conn)
    if (!job) {
      await conn.commit()
      return null
    }

    const bumped = await repo.bumpAttempts(Number(job.id), conn)
    const attemptNo = bumped.attempts
    if (attemptNo > bumped.maxAttempts) {
      await repo.failJob(Number(job.id), { status: 'dead', errorCode: 'max_attempts_exceeded', errorMessage: 'max_attempts_exceeded' }, conn)
      await conn.commit()
      return null
    }

    const attempt = await repo.createAttempt(Number(job.id), attemptNo, params.workerId, conn)
    await conn.commit()
    return { job: { ...job, attempts: attemptNo }, attempt }
  } catch (err) {
    try { await conn.rollback() } catch {}
    throw err
  } finally {
    try { conn.release() } catch {}
  }
}

function computeBackoffSeconds(attemptNo: number) {
  // 15s, 60s, 5m, 30m, 2h...
  const base = [15, 60, 300, 1800, 7200]
  const idx = Math.min(Math.max(0, attemptNo - 1), base.length - 1)
  return base[idx]
}

export async function markJobFailedAndMaybeRetry(jobId: number, attemptNo: number, error: { code?: string; message?: string }) {
  const row = await repo.getById(jobId)
  const maxAttempts = Number(row?.max_attempts || 3)
  const shouldRetry = attemptNo < maxAttempts
  if (!shouldRetry) {
    await repo.failJob(jobId, {
      status: 'dead',
      errorCode: error.code || 'failed',
      errorMessage: error.message || 'failed',
      runAfter: null,
    })
    return { status: 'dead' as const }
  }

  const backoffSeconds = computeBackoffSeconds(attemptNo)
  const runAfter = new Date(Date.now() + backoffSeconds * 1000)
  await repo.failJob(jobId, {
    status: 'pending',
    errorCode: error.code || 'failed',
    errorMessage: error.message || 'failed',
    runAfter,
  })
  return { status: 'pending' as const, runAfter }
}
