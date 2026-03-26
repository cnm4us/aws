import 'dotenv/config'
import { getPool } from '../src/db'

async function main() {
  const db = getPool()
  const tables = [
    'feed_user_message_journey_progress',
    'feed_message_journey_steps',
    'feed_message_journeys',
  ] as const

  try {
    await db.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const table of tables) {
      await db.query(`TRUNCATE TABLE ${table}`)
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1')
    console.log('Cleared journey tables:', tables.join(', '))
  } catch (err) {
    try { await db.query('SET FOREIGN_KEY_CHECKS = 1') } catch {}
    throw err
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('db:clear:journey_steps failed', err)
  process.exit(1)
})

