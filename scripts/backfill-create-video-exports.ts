import { getPool } from '../src/db'

function parseArg(name: string): string | null {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return null
  const v = process.argv[idx + 1]
  if (!v) return ''
  return String(v)
}

function safeJson(v: any): any {
  try {
    if (v == null) return null
    if (typeof v === 'string') return JSON.parse(v)
    return v
  } catch {
    return null
  }
}

async function main() {
  const wantsHelp = process.argv.includes('--help') || process.argv.includes('-h')
  if (wantsHelp) {
    console.log('Usage:')
    console.log('  ts-node scripts/backfill-create-video-exports.ts --dry 1 --limit 100 [--cursor <mediaJobId>]')
    console.log('  ts-node scripts/backfill-create-video-exports.ts --limit 100 [--cursor <mediaJobId>]')
    console.log('')
    console.log('What it does:')
    console.log('- Scans media_jobs.type=create_video_export_v1 and stamps the resulting uploads row with:')
    console.log('  - uploads.video_role = export')
    console.log('  - uploads.create_video_project_id = <projectId from input_json>')
    return
  }

  const limit = Number(parseArg('--limit') || '100')
  const cursor = Number(parseArg('--cursor') || '0')
  const dryRun = String(parseArg('--dry') || '').trim() === '1'

  if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) {
    console.error('Bad --limit (1..1000)')
    process.exit(2)
  }
  if (!Number.isFinite(cursor) || cursor < 0) {
    console.error('Bad --cursor (>=0)')
    process.exit(2)
  }

  const db = getPool()
  try {
    const [rows] = await db.query(
      `
        SELECT id, input_json, result_json
          FROM media_jobs
         WHERE id > ?
           AND type = 'create_video_export_v1'
           AND status = 'completed'
         ORDER BY id ASC
         LIMIT ?
      `,
      [cursor, limit]
    )

    const items = rows as any[]
    const results: any[] = []

    for (const row of items) {
      const mediaJobId = Number(row.id)
      const input = safeJson(row.input_json) || {}
      const result = safeJson(row.result_json) || {}
      const projectId = Number(input?.projectId)
      const uploadId = Number(result?.resultUploadId || result?.uploadId || result?.outputUploadId)
      if (!Number.isFinite(projectId) || projectId <= 0 || !Number.isFinite(uploadId) || uploadId <= 0) {
        results.push({ mediaJobId, action: 'skip', projectId: Number.isFinite(projectId) ? projectId : null, uploadId: Number.isFinite(uploadId) ? uploadId : null })
        continue
      }

      if (!dryRun) {
        await db.query(
          `
            UPDATE uploads
               SET video_role = 'export',
                   create_video_project_id = ?
             WHERE id = ?
               AND kind = 'video'
          `,
          [projectId, uploadId]
        )
      }

      results.push({ mediaJobId, action: dryRun ? 'would_update' : 'updated', uploadId, projectId })
    }

    const lastId = items.length ? Number(items[items.length - 1].id) : cursor
    console.log(JSON.stringify({ cursor, limit, count: items.length, nextCursor: lastId, dryRun, results }, null, 2))
  } finally {
    try {
      await (db as any).end()
    } catch {}
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

