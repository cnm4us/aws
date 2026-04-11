import 'dotenv/config'
import { ensureSchema, getPool } from '../src/db'
import { verifySignalClassificationCoverage } from '../src/features/moderation-signals'

async function main() {
  const db = getPool()
  try {
    await ensureSchema(db)
    const coverage = await verifySignalClassificationCoverage()
    const ok = coverage.missing_any === 0 && coverage.unresolved.length === 0
    console.log(JSON.stringify({ ok, coverage }, null, 2))
    if (!ok) process.exitCode = 1
  } finally {
    await db.end().catch(() => undefined)
  }
}

main().catch((err) => {
  console.error('moderation:signals:classification:verify failed', err)
  process.exit(1)
})
