import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { getPool } from '../src/db'
import { UPLOAD_BUCKET } from '../src/config'
import { s3 } from '../src/services/s3'
import { enqueueJob } from '../src/features/media-jobs/service'
import { buildUploadThumbKey } from '../src/utils/uploadThumb'

function parseArg(name: string): string | null {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return null
  const v = process.argv[idx + 1]
  if (!v) return ''
  return String(v)
}

async function headExists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (e: any) {
    const status = Number(e?.$metadata?.httpStatusCode || 0)
    const name = String(e?.name || e?.Code || '')
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return false
    throw e
  }
}

async function main() {
  const limit = Number(parseArg('--limit') || '25')
  const cursor = Number(parseArg('--cursor') || '0')
  const skipHead = String(parseArg('--skip-head') || '').trim() === '1'

  if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
    console.error('Bad --limit (1..500)')
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
        SELECT id, user_id, s3_bucket, s3_key
          FROM uploads
         WHERE id > ?
           AND kind = 'video'
           AND (is_system = 0 OR is_system IS NULL)
           AND source_deleted_at IS NULL
           AND status IN ('uploaded','completed')
         ORDER BY id ASC
         LIMIT ?
      `,
      [cursor, limit]
    )

    const items = rows as any[]
    const results: any[] = []
    for (const u of items) {
      const uploadId = Number(u.id)
      const ownerUserId = u.user_id != null ? Number(u.user_id) : null
      if (!uploadId || !ownerUserId) continue
      const inBucket = String(u.s3_bucket || UPLOAD_BUCKET)
      const inKey = String(u.s3_key || '')
      if (!inKey) continue

      const outKey = buildUploadThumbKey(uploadId)
      const exists = skipHead ? false : await headExists(String(UPLOAD_BUCKET), outKey)
      if (exists) {
        results.push({ uploadId, action: 'skip_exists', outKey })
        continue
      }

      const job = await enqueueJob('upload_thumb_v1', {
        uploadId,
        userId: ownerUserId,
        video: { bucket: inBucket, key: inKey },
        outputBucket: String(UPLOAD_BUCKET),
        outputKey: outKey,
        longEdgePx: 640,
      })
      results.push({ uploadId, action: 'enqueued', jobId: Number((job as any).id), outKey })
    }

    const lastId = items.length ? Number(items[items.length - 1].id) : cursor
    console.log(JSON.stringify({ cursor, limit, count: items.length, nextCursor: lastId, results }, null, 2))
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

