import 'dotenv/config'
import { getPool } from '../src/db'

type Args = {
  fix: boolean
}

function parseArgs(argv: string[]): Args {
  let fix = false
  for (const tokenRaw of argv) {
    const token = String(tokenRaw || '').trim()
    if (token === '--fix') {
      fix = true
      continue
    }
    if (token === '--help' || token === '-h') {
      console.log('Usage:')
      console.log('  npm run db:verify:surface-targeting')
      console.log('  npm run db:verify:surface-targeting -- --fix')
      process.exit(0)
    }
  }
  return { fix }
}

async function scalarCount(db: ReturnType<typeof getPool>, sql: string): Promise<number> {
  const [rows] = await db.query(sql)
  return Number((rows as any[])[0]?.count || 0)
}

async function printMissingExamples(
  db: ReturnType<typeof getPool>,
  kind: 'message' | 'journey'
): Promise<void> {
  if (kind === 'message') {
    const [rows] = await db.query(
      `SELECT m.id, m.name, m.applies_to_surface
         FROM feed_messages m
    LEFT JOIN feed_message_surfaces s
           ON s.message_id = m.id
        WHERE s.message_id IS NULL
     ORDER BY m.id DESC
        LIMIT 10`
    )
    const items = rows as any[]
    if (!items.length) return
    console.log('missing message surface rows (sample):')
    for (const row of items) {
      console.log(`  message_id=${Number(row.id)} name=${String(row.name || '')} legacy_surface=${String(row.applies_to_surface || 'global_feed')}`)
    }
    return
  }

  const [rows] = await db.query(
    `SELECT j.id, j.name, j.applies_to_surface
       FROM feed_message_journeys j
  LEFT JOIN feed_message_journey_surfaces s
         ON s.journey_id = j.id
      WHERE s.journey_id IS NULL
   ORDER BY j.id DESC
      LIMIT 10`
  )
  const items = rows as any[]
  if (!items.length) return
  console.log('missing journey surface rows (sample):')
  for (const row of items) {
    console.log(`  journey_id=${Number(row.id)} name=${String(row.name || '')} legacy_surface=${String(row.applies_to_surface || 'global_feed')}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const db = getPool()
  try {
    if (args.fix) {
      await db.query(`
        DELETE s
          FROM feed_message_targets s
     LEFT JOIN feed_messages m
            ON m.id = s.message_id
         WHERE m.id IS NULL
      `)
      await db.query(`
        DELETE s
          FROM feed_message_surfaces s
     LEFT JOIN feed_messages m
            ON m.id = s.message_id
         WHERE m.id IS NULL
      `)
      await db.query(`
        INSERT IGNORE INTO feed_message_surfaces (message_id, surface, targeting_mode)
        SELECT id, applies_to_surface, 'all'
        FROM feed_messages
      `)
      await db.query(`
        DELETE s
          FROM feed_message_journey_targets s
     LEFT JOIN feed_message_journeys j
            ON j.id = s.journey_id
         WHERE j.id IS NULL
      `)
      await db.query(`
        DELETE s
          FROM feed_message_journey_surfaces s
     LEFT JOIN feed_message_journeys j
            ON j.id = s.journey_id
         WHERE j.id IS NULL
      `)
      await db.query(`
        INSERT IGNORE INTO feed_message_journey_surfaces (journey_id, surface, targeting_mode)
        SELECT id, applies_to_surface, 'all'
        FROM feed_message_journeys
      `)
    }

    const messagesTotal = await scalarCount(db, `SELECT COUNT(*) AS count FROM feed_messages`)
    const messageSurfaceLinked = await scalarCount(
      db,
      `SELECT COUNT(DISTINCT message_id) AS count FROM feed_message_surfaces`
    )
    const messagesMissing = await scalarCount(
      db,
      `SELECT COUNT(*) AS count
         FROM feed_messages m
    LEFT JOIN feed_message_surfaces s
           ON s.message_id = m.id
        WHERE s.message_id IS NULL`
    )
    const messageSurfaceOrphans = await scalarCount(
      db,
      `SELECT COUNT(*) AS count
         FROM feed_message_surfaces s
    LEFT JOIN feed_messages m
           ON m.id = s.message_id
        WHERE m.id IS NULL`
    )

    const journeysTotal = await scalarCount(db, `SELECT COUNT(*) AS count FROM feed_message_journeys`)
    const journeySurfaceLinked = await scalarCount(
      db,
      `SELECT COUNT(DISTINCT journey_id) AS count FROM feed_message_journey_surfaces`
    )
    const journeysMissing = await scalarCount(
      db,
      `SELECT COUNT(*) AS count
         FROM feed_message_journeys j
    LEFT JOIN feed_message_journey_surfaces s
           ON s.journey_id = j.id
        WHERE s.journey_id IS NULL`
    )
    const journeySurfaceOrphans = await scalarCount(
      db,
      `SELECT COUNT(*) AS count
         FROM feed_message_journey_surfaces s
    LEFT JOIN feed_message_journeys j
           ON j.id = s.journey_id
        WHERE j.id IS NULL`
    )

    console.log(`messages_total           ${messagesTotal}`)
    console.log(`messages_with_surfaces   ${messageSurfaceLinked}`)
    console.log(`messages_missing         ${messagesMissing}`)
    console.log(`message_surface_orphans  ${messageSurfaceOrphans}`)
    console.log(`journeys_total           ${journeysTotal}`)
    console.log(`journeys_with_surfaces   ${journeySurfaceLinked}`)
    console.log(`journeys_missing         ${journeysMissing}`)
    console.log(`journey_surface_orphans  ${journeySurfaceOrphans}`)

    if (messagesMissing > 0) await printMissingExamples(db, 'message')
    if (journeysMissing > 0) await printMissingExamples(db, 'journey')
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('db:verify:surface-targeting failed', err)
  process.exit(1)
})
