import 'dotenv/config'
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getPool } from '../src/db'
import { s3 } from '../src/services/s3'

function arg(name: string): string | null {
  const idx = process.argv.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (idx === -1) return null
  const a = process.argv[idx]
  if (a.includes('=')) return a.split('=')[1] || null
  return process.argv[idx + 1] || null
}

async function deleteS3Objects(bucket: string, keys: string[], dryRun: boolean) {
  const unique = Array.from(new Set(keys.filter(Boolean).map((k) => String(k))))
  if (!unique.length) return { deleted: 0, errors: [] as string[] }
  if (dryRun) return { deleted: unique.length, errors: [] as string[] }
  const errors: string[] = []
  let deleted = 0
  for (let i = 0; i < unique.length; i += 1000) {
    const batch = unique.slice(i, i + 1000)
    try {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }))
      deleted += batch.length
    } catch (e: any) {
      errors.push(`delete:${bucket}:${String(e?.name || e?.Code || e)}:${String(e?.message || e)}`)
    }
  }
  return { deleted, errors }
}

async function deleteS3Prefix(bucket: string, prefix: string, dryRun: boolean) {
  let token: string | undefined
  let total = 0
  const errors: string[] = []
  do {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
    const contents = list.Contents ?? []
    if (contents.length) {
      total += contents.length
      if (!dryRun) {
        try {
          await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: contents.map((o: any) => ({ Key: o.Key })), Quiet: true } }))
        } catch (e: any) {
          errors.push(`delete:${bucket}:${prefix}:${String(e?.name || e?.Code || e)}:${String(e?.message || e)}`)
          break
        }
      }
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (token)
  return { deleted: total, errors }
}

async function main() {
  const dryRun = (arg('--dry-run') || '').toLowerCase() === '1' || process.argv.includes('--dry-run')
  const olderDays = Number(arg('--older-than-days') || 0)
  const jobId = Number(arg('--job-id') || 0)
  const limit = Math.max(1, Math.min(5000, Math.round(Number(arg('--limit') || 500))))

  if (!Number.isFinite(olderDays) && !Number.isFinite(jobId)) {
    console.log('Usage: ts-node scripts/media-jobs-purge.ts --older-than-days 30 [--dry-run] [--limit 500]')
    console.log('   or: ts-node scripts/media-jobs-purge.ts --job-id 123 [--dry-run]')
    process.exit(2)
  }

  const db = getPool()

  let jobIds: number[] = []
  if (Number.isFinite(jobId) && jobId > 0) {
    jobIds = [Math.round(jobId)]
  } else {
    const days = Math.max(0, Math.round(olderDays || 0))
    if (!days) return
    const [rows] = await db.query(
      `SELECT id
         FROM media_jobs
        WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        ORDER BY id ASC
        LIMIT ${limit}`,
      [days]
    )
    jobIds = (rows as any[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0)
  }

  let totalDeleted = 0
  const errors: string[] = []

  for (const id of jobIds) {
    const [rows] = await db.query(`SELECT * FROM media_job_attempts WHERE job_id = ?`, [id])
    const attempts = rows as any[]
    const byBucket = new Map<string, string[]>()
    for (const a of attempts) {
      if (a.stdout_s3_bucket && a.stdout_s3_key) {
        const b = String(a.stdout_s3_bucket)
        byBucket.set(b, [...(byBucket.get(b) || []), String(a.stdout_s3_key)])
      }
      if (a.stderr_s3_bucket && a.stderr_s3_key) {
        const b = String(a.stderr_s3_bucket)
        byBucket.set(b, [...(byBucket.get(b) || []), String(a.stderr_s3_key)])
      }
    }
    for (const [bucket, keys] of byBucket.entries()) {
      const del = await deleteS3Objects(bucket, keys, dryRun)
      totalDeleted += del.deleted
      errors.push(...del.errors)
    }
    for (const a of attempts) {
      if (a.artifacts_s3_bucket && a.artifacts_s3_prefix) {
        const del = await deleteS3Prefix(String(a.artifacts_s3_bucket), String(a.artifacts_s3_prefix), dryRun)
        totalDeleted += del.deleted
        errors.push(...del.errors)
      }
    }
    if (!dryRun) {
      await db.query(
        `UPDATE media_job_attempts
            SET stdout_s3_bucket = NULL, stdout_s3_key = NULL,
                stderr_s3_bucket = NULL, stderr_s3_key = NULL,
                artifacts_s3_bucket = NULL, artifacts_s3_prefix = NULL
          WHERE job_id = ?`,
        [id]
      )
    }
  }

  console.log(JSON.stringify({ dryRun, jobs: jobIds.length, deletedObjects: totalDeleted, errors: errors.slice(0, 50) }, null, 2))
  if (errors.length) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

