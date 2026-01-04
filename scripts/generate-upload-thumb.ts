import { getPool } from '../src/db'
import { UPLOAD_BUCKET } from '../src/config'
import { buildUploadThumbKey } from '../src/utils/uploadThumb'
import { createUploadThumbJpeg } from '../src/services/ffmpeg/thumbPipeline'

async function main() {
  const uploadId = Number(process.argv[2] || '')
  if (!Number.isFinite(uploadId) || uploadId <= 0) {
    console.error('Usage: ts-node scripts/generate-upload-thumb.ts <uploadId>')
    process.exit(2)
  }

  const db = getPool()
  try {
    const [rows] = await db.query(`SELECT id, kind, s3_bucket, s3_key FROM uploads WHERE id = ? LIMIT 1`, [uploadId])
    const u = (rows as any[])[0]
    if (!u) throw new Error('upload_not_found')
    const kind = String(u.kind || 'video').toLowerCase()
    if (kind !== 'video') throw new Error(`not_a_video_upload:${kind}`)
    const bucket = String(u.s3_bucket || UPLOAD_BUCKET || '')
    const key = String(u.s3_key || '')
    if (!bucket || !key) throw new Error('missing_upload_s3')

    const outKey = buildUploadThumbKey(uploadId)
    const result = await createUploadThumbJpeg({
      uploadBucket: String(UPLOAD_BUCKET || bucket),
      uploadId,
      video: { bucket, key },
      outKey,
      longEdgePx: 640,
    })
    console.log(JSON.stringify(result, null, 2))
  } finally {
    try { await (db as any).end() } catch {}
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
