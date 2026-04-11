import 'dotenv/config'
import { ensureSchema, getPool } from '../src/db'
import { backfillSignalClassificationCoverage } from '../src/features/moderation-signals'

async function main() {
  const db = getPool()
  try {
    await ensureSchema(db)
    const result = await backfillSignalClassificationCoverage()
    const ok = result.coverage.missing_any === 0 && result.coverage.unresolved.length === 0
    console.log(JSON.stringify({ ok, ...result }, null, 2))
    if (!ok) process.exitCode = 1
  } finally {
    await db.end().catch(() => undefined)
  }
}

main().catch((err) => {
  console.error('moderation:signals:classification:backfill failed', err)
  process.exit(1)
})
