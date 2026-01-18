import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { getPool } from '../src/db'
import { downloadS3ObjectToFile } from '../src/services/ffmpeg/audioPipeline'

function parseArg(name: string): string | null {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return null
  const v = process.argv[idx + 1]
  if (!v) return ''
  return String(v)
}

async function probeDurationSeconds(filePath: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const p = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.stderr.on('data', (d) => { err += String(d) })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe_failed:${code}:${err.slice(0, 400)}`))
      const v = Number(String(out || '').trim())
      if (!Number.isFinite(v) || v <= 0) return reject(new Error('ffprobe_missing_duration'))
      resolve(v)
    })
  })
}

async function main() {
  const limit = Number(parseArg('--limit') || '25')
  const cursor = Number(parseArg('--cursor') || '0')
  const dryRun = String(parseArg('--dry') || '').trim() === '1'

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
        SELECT id, s3_bucket, s3_key
          FROM uploads
         WHERE id > ?
           AND kind = 'audio'
           AND source_deleted_at IS NULL
           AND duration_seconds IS NULL
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
      const bucket = String(u.s3_bucket || '')
      const key = String(u.s3_key || '')
      if (!uploadId || !bucket || !key) continue

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-audio-dur-'))
      const filePath = path.join(tmpDir, 'audio.bin')
      try {
        await downloadS3ObjectToFile(bucket, key, filePath)
        const dur = await probeDurationSeconds(filePath)
        const rounded = Math.round(dur)
        if (!dryRun) {
          await db.query(`UPDATE uploads SET duration_seconds = ? WHERE id = ?`, [rounded, uploadId])
        }
        results.push({ uploadId, action: dryRun ? 'would_update' : 'updated', duration_seconds: rounded })
      } catch (e: any) {
        results.push({ uploadId, action: 'error', error: String(e?.message || e) })
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
      }
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

