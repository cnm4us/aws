import 'dotenv/config'
import { getPool } from '../src/db'
import { ulidMonotonic, ulid } from '../src/utils/ulid'

async function main() {
  const db = getPool()
  // Ensure column exists before backfill
  await db.query(`ALTER TABLE spaces ADD COLUMN IF NOT EXISTS ulid CHAR(26) NULL`)

  const BATCH = Number(process.env.BACKFILL_BATCH || 1000)
  let total = 0
  for (;;) {
    const [rows] = await db.query(
      `SELECT id, created_at FROM spaces WHERE ulid IS NULL ORDER BY created_at ASC, id ASC LIMIT ?`,
      [BATCH]
    )
    const list = rows as Array<{ id: number; created_at: string }>
    if (!list.length) break

    for (const r of list) {
      let ts = Date.now()
      try { ts = r.created_at ? new Date(r.created_at as any).getTime() : Date.now() } catch {}
      const id = ulidMonotonic(ts)
      await db.query(`UPDATE spaces SET ulid = ? WHERE id = ? AND ulid IS NULL`, [id, r.id])
      total += 1
      if (total % 2000 === 0) console.log(`Backfilled ${total} spaces…`)
    }
  }

  // Create unique index (best-effort); safe with NULLs
  try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_spaces_ulid ON spaces (ulid)`) } catch {}

  console.log(`Done. Backfilled ${total} spaces.`)
  await db.end()
}

main().catch(async (err) => { console.error(err); try { await getPool().end() } catch {}; process.exit(1) })

