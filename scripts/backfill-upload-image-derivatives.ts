import { getPool } from '../src/db'
import { IMAGE_VARIANT_PROFILES, UPLOAD_BUCKET } from '../src/config'
import { enqueueJob } from '../src/features/media-jobs/service'

function parseArg(name: string): string | null {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return null
  const v = process.argv[idx + 1]
  if (!v) return ''
  return String(v)
}

function expectedProfileKeys(kind: 'image' | 'logo', imageRole: string | null): string[] {
  if (kind === 'logo') {
    return IMAGE_VARIANT_PROFILES.filter((p) => p.usage === 'logo').map((p) => p.key)
  }
  if (String(imageRole || '').trim().toLowerCase() === 'lower_third') {
    return IMAGE_VARIANT_PROFILES.filter((p) => p.usage === 'lower_third').map((p) => p.key)
  }
  return IMAGE_VARIANT_PROFILES.filter((p) => p.usage === 'prompt_bg' || p.usage === 'graphic_overlay').map((p) => p.key)
}

async function hasPendingDerivativeJob(db: any, uploadId: number): Promise<boolean> {
  const [rows] = await db.query(
    `SELECT id
       FROM media_jobs
      WHERE type = 'upload_image_derivatives_v1'
        AND status IN ('pending','processing')
        AND JSON_UNQUOTE(JSON_EXTRACT(input_json, '$.uploadId')) = ?
      ORDER BY id DESC
      LIMIT 1`,
    [String(uploadId)]
  )
  return (rows as any[]).length > 0
}

async function readyProfileKeySet(db: any, uploadId: number): Promise<Set<string>> {
  const [rows] = await db.query(
    `SELECT profile_key
       FROM upload_image_variants
      WHERE upload_id = ?
        AND status = 'ready'`,
    [uploadId]
  )
  const out = new Set<string>()
  for (const row of rows as any[]) {
    const key = String((row as any)?.profile_key || '').trim()
    if (key) out.add(key)
  }
  return out
}

async function main() {
  const wantsHelp = process.argv.includes('--help') || process.argv.includes('-h')
  if (wantsHelp) {
    console.log('Usage:')
    console.log('  ts-node scripts/backfill-upload-image-derivatives.ts --dry 1 --limit 100 [--cursor <uploadId>]')
    console.log('  ts-node scripts/backfill-upload-image-derivatives.ts --limit 100 [--cursor <uploadId>] [--force 1]')
    console.log('')
    console.log('Notes:')
    console.log('- Scans uploads kind=image|logo and enqueues upload_image_derivatives_v1 jobs where variants are missing.')
    console.log('- By default skips system assets; pass --include-system 1 to include them.')
    console.log('- --force 1 enqueues even if ready variants already exist.')
    return
  }

  const limit = Number(parseArg('--limit') || '100')
  const cursor = Number(parseArg('--cursor') || '0')
  const dryRun = String(parseArg('--dry') || '').trim() === '1'
  const force = String(parseArg('--force') || '').trim() === '1'
  const includeSystem = String(parseArg('--include-system') || '').trim() === '1'

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
        SELECT id, user_id, kind, image_role, is_system, s3_bucket, s3_key, source_deleted_at, status
          FROM uploads
         WHERE id > ?
           AND kind IN ('image','logo')
           AND source_deleted_at IS NULL
           AND status IN ('uploaded','completed')
           ${includeSystem ? '' : 'AND (is_system = 0 OR is_system IS NULL)'}
         ORDER BY id ASC
         LIMIT ?
      `,
      [cursor, limit]
    )

    const items = rows as any[]
    const results: any[] = []
    let enqueued = 0
    let skippedReady = 0
    let skippedPending = 0
    let skippedInvalid = 0

    for (const row of items) {
      const uploadId = Number(row.id)
      const kind = String(row.kind || '').trim().toLowerCase()
      const imageRole = row.image_role == null ? null : String(row.image_role)
      const bucket = String(row.s3_bucket || UPLOAD_BUCKET || '').trim()
      const key = String(row.s3_key || '').trim()
      const ownerUserId = row.user_id == null ? null : Number(row.user_id)
      const expected = expectedProfileKeys(kind === 'logo' ? 'logo' : 'image', imageRole)

      if (!uploadId || !bucket || !key || !expected.length) {
        skippedInvalid += 1
        results.push({ uploadId, action: 'skip_invalid', kind, imageRole, bucket: bucket || null, key: key || null })
        continue
      }

      const pending = await hasPendingDerivativeJob(db, uploadId)
      if (pending) {
        skippedPending += 1
        results.push({ uploadId, action: 'skip_pending', expectedProfiles: expected })
        continue
      }

      let missingProfiles: string[] = []
      if (!force) {
        const ready = await readyProfileKeySet(db, uploadId)
        missingProfiles = expected.filter((k) => !ready.has(k))
        if (!missingProfiles.length) {
          skippedReady += 1
          results.push({ uploadId, action: 'skip_ready', expectedProfiles: expected })
          continue
        }
      } else {
        missingProfiles = expected.slice()
      }

      const input = {
        uploadId,
        userId: Number.isFinite(ownerUserId) && Number(ownerUserId) > 0 ? Number(ownerUserId) : null,
        image: { bucket, key },
        kind: kind === 'logo' ? 'logo' : 'image',
        imageRole,
        outputBucket: String(UPLOAD_BUCKET || '').trim(),
        force,
      } as any

      if (dryRun) {
        results.push({ uploadId, action: 'would_enqueue', expectedProfiles: expected, missingProfiles, input })
        continue
      }

      const job = await enqueueJob('upload_image_derivatives_v1', input)
      enqueued += 1
      results.push({
        uploadId,
        action: 'enqueued',
        jobId: Number((job as any).id),
        expectedProfiles: expected,
        missingProfiles,
      })
    }

    const lastId = items.length ? Number(items[items.length - 1].id) : cursor
    console.log(
      JSON.stringify(
        {
          cursor,
          limit,
          count: items.length,
          nextCursor: lastId,
          dryRun,
          force,
          includeSystem,
          summary: {
            enqueued,
            skippedReady,
            skippedPending,
            skippedInvalid,
          },
          results,
        },
        null,
        2
      )
    )
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

