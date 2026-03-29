import 'dotenv/config'
import { getPool } from '../src/db'

type Args = {
  userEmail: string | null
  anonKey: string | null
}

function parseArgs(argv: string[]): Args {
  let userEmail: string | null = null
  let anonKey: string | null = null
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim()
    if (token === '--user') {
      const value = String(argv[i + 1] || '').trim()
      if (value) userEmail = value
      i += 1
      continue
    }
    if (token.startsWith('--user=')) {
      const value = token.slice('--user='.length).trim()
      if (value) userEmail = value
      continue
    }
    if (token === '--anon-key') {
      const value = String(argv[i + 1] || '').trim()
      if (value) anonKey = value
      i += 1
      continue
    }
    if (token.startsWith('--anon-key=')) {
      const value = token.slice('--anon-key='.length).trim()
      if (value) anonKey = value
      continue
    }
    if (token === '--help' || token === '-h') {
      console.log('Usage:')
      console.log('  npm run db:clear:journey-progress')
      console.log('  npm run db:clear:journey-progress -- --user <email>')
      console.log('  npm run db:clear:journey-progress -- --anon-key <anon_session_id>')
      process.exit(0)
    }
  }
  return { userEmail, anonKey }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const db = getPool()

  try {
    if (args.userEmail && args.anonKey) {
      console.log('Use only one of --user or --anon-key')
      process.exitCode = 1
      return
    }
    if (args.userEmail) {
      const [users] = await db.query(
        `SELECT id, email
           FROM users
          WHERE LOWER(email) = LOWER(?)
          LIMIT 1`,
        [args.userEmail]
      )
      const user = (users as any[])[0]
      if (!user) {
        console.log(`No user found for email: ${args.userEmail}`)
        return
      }
      const userId = Number(user.id)
      const [result] = await db.query(
        `DELETE FROM feed_user_message_journey_progress
          WHERE user_id = ?`,
        [userId]
      )
      const affected = Number((result as any)?.affectedRows || 0)
      console.log(`Cleared journey progress rows for ${String(user.email)} (user_id=${userId}): ${affected}`)
      return
    }
    if (args.anonKey) {
      const [result] = await db.query(
        `DELETE FROM feed_anon_message_journey_progress
          WHERE anon_visitor_id = ?`,
        [args.anonKey]
      )
      const affected = Number((result as any)?.affectedRows || 0)
      console.log(`Cleared anonymous journey progress rows for anon_key=${args.anonKey}: ${affected}`)
      return
    }

    const [result] = await db.query(`DELETE FROM feed_user_message_journey_progress`)
    const [anonResult] = await db.query(`DELETE FROM feed_anon_message_journey_progress`)
    const affected = Number((result as any)?.affectedRows || 0)
    const anonAffected = Number((anonResult as any)?.affectedRows || 0)
    console.log(`Cleared all journey progress rows: users=${affected}, anonymous=${anonAffected}`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('db:clear:journey-progress failed', err)
  process.exit(1)
})
