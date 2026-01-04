import { getPool } from '../src/db'
import { UPLOAD_BUCKET } from '../src/config'
import { enqueueJob } from '../src/features/media-jobs/service'
import { buildUploadThumbKey } from '../src/utils/uploadThumb'

async function main() {
  const uploadId = Number(process.argv[2] || '')
  if (!Number.isFinite(uploadId) || uploadId <= 0) {
    console.error('Usage: ts-node scripts/enqueue-upload-thumb-job.ts <uploadId>')
    process.exit(2)
  }

  const db = getPool()
  try {
    const [rows] = await db.query(`SELECT id, user_id, kind, s3_bucket, s3_key, source_deleted_at, is_system FROM uploads WHERE id = ? LIMIT 1`, [uploadId])
    const u = (rows as any[])[0]
    if (!u) throw new Error('upload_not_found')
    if (Number(u.is_system || 0) === 1) throw new Error('system_upload_not_supported')
    if (u.source_deleted_at) throw new Error('source_deleted')
    const kind = String(u.kind || 'video').toLowerCase()
    if (kind !== 'video') throw new Error(`not_video:${kind}`)
    const ownerUserId = u.user_id != null ? Number(u.user_id) : null
    if (!ownerUserId) throw new Error('missing_user_id')

    const job = await enqueueJob('upload_thumb_v1', {
      uploadId: Number(u.id),
      userId: ownerUserId,
      video: { bucket: String(u.s3_bucket || UPLOAD_BUCKET), key: String(u.s3_key) },
      outputBucket: String(UPLOAD_BUCKET),
      outputKey: buildUploadThumbKey(Number(u.id)),
      longEdgePx: 640,
    })

    console.log(JSON.stringify({ jobId: Number((job as any).id), uploadId: Number(u.id) }))
  } finally {
    try { await (db as any).end() } catch {}
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

