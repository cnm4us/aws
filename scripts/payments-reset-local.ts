import 'dotenv/config'
import { getPool } from '../src/db'

async function main() {
  const db = getPool()
  try {
    const tables = [
      'payment_transactions',
      'payment_subscriptions',
      'payment_webhook_events',
      'payment_checkout_sessions',
    ] as const

    for (const table of tables) {
      await db.query(`DELETE FROM ${table}`)
    }

    console.log('Cleared local payment state:')
    for (const table of tables) {
      console.log(`- ${table}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('payments:reset:local failed', err)
  process.exit(1)
})

