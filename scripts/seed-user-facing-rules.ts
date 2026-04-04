import 'dotenv/config'
import { ensureSchema, getPool } from '../src/db'

type SeedReason = {
  label: string
  shortDescription: string
  groupKey: string
  groupLabel: string
  groupOrder: number
  displayOrder: number
}

const DEFAULT_REASONS: SeedReason[] = [
  {
    label: 'Spam or scam',
    shortDescription: 'Misleading promotions, fraud, or repetitive spam behavior.',
    groupKey: 'safety',
    groupLabel: 'Safety',
    groupOrder: 10,
    displayOrder: 10,
  },
  {
    label: 'Harassment or abuse',
    shortDescription: 'Targeted insults, threats, or hostile behavior toward people.',
    groupKey: 'safety',
    groupLabel: 'Safety',
    groupOrder: 10,
    displayOrder: 20,
  },
  {
    label: 'Hate or discrimination',
    shortDescription: 'Content attacking protected groups or promoting discriminatory abuse.',
    groupKey: 'safety',
    groupLabel: 'Safety',
    groupOrder: 10,
    displayOrder: 30,
  },
  {
    label: 'Sexual or explicit content',
    shortDescription: 'Explicit sexual content or sexualized material that violates rules.',
    groupKey: 'content',
    groupLabel: 'Content',
    groupOrder: 20,
    displayOrder: 10,
  },
  {
    label: 'Violence or self-harm',
    shortDescription: 'Graphic violence, encouragement of violence, or self-harm promotion.',
    groupKey: 'content',
    groupLabel: 'Content',
    groupOrder: 20,
    displayOrder: 20,
  },
  {
    label: 'Other rule violation',
    shortDescription: 'Report under a specific rule when no other reason fits.',
    groupKey: 'other',
    groupLabel: 'Other',
    groupOrder: 99,
    displayOrder: 10,
  },
]

function hasArg(flag: string): boolean {
  return process.argv.slice(2).includes(flag)
}

async function main() {
  const db = getPool()
  await ensureSchema(db as any)

  const overwrite = hasArg('--overwrite')
  if (overwrite) {
    await db.query(`DELETE FROM user_facing_rule_rule_map`)
    await db.query(`DELETE FROM user_facing_rules`)
  }

  let inserted = 0
  let skipped = 0
  for (const row of DEFAULT_REASONS) {
    const [existing] = await db.query(
      `SELECT id FROM user_facing_rules WHERE label = ? LIMIT 1`,
      [row.label]
    )
    if (Array.isArray(existing) && (existing as any[]).length > 0) {
      skipped += 1
      continue
    }
    await db.query(
      `INSERT INTO user_facing_rules
        (label, short_description, group_key, group_label, group_order, display_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        row.label,
        row.shortDescription,
        row.groupKey,
        row.groupLabel,
        row.groupOrder,
        row.displayOrder,
      ]
    )
    inserted += 1
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        overwrite,
        inserted,
        skipped,
        total: DEFAULT_REASONS.length,
      },
      null,
      2
    )
  )
  await db.end()
}

main().catch(async (err) => {
  console.error('seed:user-facing-rules failed', err)
  try { await getPool().end() } catch {}
  process.exit(1)
})

