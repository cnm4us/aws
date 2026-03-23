import 'dotenv/config'
import { getPool } from '../src/db'

async function main() {
  const db = getPool()
  try {
    const tables = [
      'feed_message_user_suppressions',
      'message_decision_sessions',
    ] as const

    for (const table of tables) {
      await db.query(`DELETE FROM ${table}`)
    }

    console.log('Cleared message suppression state:', tables.join(', '))
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('db:clear:suppression failed', err)
  process.exit(1)
})
