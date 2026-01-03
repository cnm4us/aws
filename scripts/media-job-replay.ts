import 'dotenv/config'
import { getPool } from '../src/db'

function arg(name: string): string | null {
  const idx = process.argv.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (idx === -1) return null
  const a = process.argv[idx]
  if (a.includes('=')) return a.split('=')[1] || null
  return process.argv[idx + 1] || null
}

async function main() {
  const jobId = Number(arg('--job-id') || 0)
  const resetInPlace = process.argv.includes('--reset')
  const priority = Number(arg('--priority') || 50)

  if (!Number.isFinite(jobId) || jobId <= 0) {
    console.log('Usage: ts-node scripts/media-job-replay.ts --job-id 123 [--reset] [--priority 50]')
    process.exit(2)
  }

  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM media_jobs WHERE id = ? LIMIT 1`, [jobId])
  const job = (rows as any[])[0]
  if (!job) {
    console.error('media_job_not_found')
    process.exit(1)
  }

  const inputJson = typeof job.input_json === 'string' ? JSON.parse(job.input_json) : (job.input_json || {})
  const type = String(job.type || '')
  if (!type) {
    console.error('missing_job_type')
    process.exit(1)
  }

  if (resetInPlace) {
    await db.query(
      `UPDATE media_jobs
          SET status = 'pending',
              priority = ?,
              attempts = 0,
              run_after = NULL,
              locked_at = NULL,
              locked_by = NULL,
              error_code = NULL,
              error_message = NULL,
              updated_at = NOW()
        WHERE id = ?`,
      [priority, jobId]
    )
    console.log(JSON.stringify({ ok: true, action: 'reset', jobId }, null, 2))
    return
  }

  const [res] = await db.query(
    `INSERT INTO media_jobs (type, status, priority, attempts, max_attempts, run_after, input_json)
     VALUES (?, 'pending', ?, 0, ?, NULL, ?)`,
    [type, priority, Number(job.max_attempts || 3), JSON.stringify(inputJson)]
  )
  const newId = Number((res as any).insertId)
  console.log(JSON.stringify({ ok: true, action: 'clone', jobId, newJobId: newId }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

