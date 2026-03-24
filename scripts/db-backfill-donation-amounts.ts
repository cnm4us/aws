import 'dotenv/config'
import { getPool } from '../src/db'

async function main() {
  const db = getPool()
  try {
    const [res] = await db.query(
      `UPDATE payment_checkout_sessions
          SET amount_cents = 100,
              currency = CASE WHEN currency IS NULL OR currency = '' THEN 'USD' ELSE currency END,
              updated_at = CURRENT_TIMESTAMP
        WHERE intent = 'donate'
          AND amount_cents IS NULL`
    )
    const updated = Number((res as any)?.affectedRows || 0)
    console.log(`Backfilled donation amounts: ${updated} row(s) updated.`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('db:backfill:donation-amounts failed', err)
  process.exit(1)
})
