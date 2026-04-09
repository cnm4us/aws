import 'dotenv/config'
import { ensureSchema, getPool } from '../src/db'
import {
  listModerationPolicyProfiles,
  seedDefaultModerationPolicyProfiles,
} from '../src/features/moderation-v2/policy-profiles'

async function main() {
  const db = getPool()
  try {
    await ensureSchema(db)
    const seeded = await seedDefaultModerationPolicyProfiles(db)
    const rows = await listModerationPolicyProfiles(db)
    console.log(
      JSON.stringify(
        {
          ok: true,
          inserted_or_updated: seeded.insertedOrUpdated,
          profiles: rows,
        },
        null,
        2
      )
    )
  } finally {
    await db.end().catch(() => undefined)
  }
}

main().catch((err) => {
  console.error('moderation:v2:policy-profiles:seed failed', err)
  process.exit(1)
})
