import 'dotenv/config'
import { getPool } from '../src/db'

type Row = {
  id: number
  user_id: number | null
  email: string | null
  display_name: string | null
  provider: string
  mode: string
  provider_subscription_id: string
  status: string
  catalog_item_id: number | null
  item_key: string | null
  label: string | null
  amount_cents: number | null
  currency: string
  pending_action: string | null
  updated_at: string
}

function formatAmount(amountCents: number | null, currency: string): string {
  const code = String(currency || 'USD').toUpperCase()
  if (amountCents == null || !Number.isFinite(Number(amountCents))) return `unknown ${code}`
  return `${(Number(amountCents) / 100).toFixed(2)} ${code}`
}

function formatUser(row: Row): string {
  if (row.display_name && row.email) return `${row.display_name} <${row.email}>`
  if (row.email) return row.email
  if (row.user_id != null) return `user:${row.user_id}`
  return 'anonymous'
}

async function main() {
  const db = getPool()
  try {
    const [rows] = await db.query(
      `SELECT
          s.id,
          s.user_id,
          u.email,
          u.display_name,
          s.provider,
          s.mode,
          s.provider_subscription_id,
          s.status,
          s.catalog_item_id,
          c.item_key,
          c.label,
          s.amount_cents,
          s.currency,
          s.pending_action,
          s.updated_at
        FROM payment_subscriptions s
        LEFT JOIN users u ON u.id = s.user_id
        LEFT JOIN payment_catalog_items c ON c.id = s.catalog_item_id
        ORDER BY s.updated_at DESC, s.id DESC`
    )
    const list = rows as Row[]
    if (!list.length) {
      console.log('No subscriptions found.')
      return
    }
    console.log('User\tStatus\tPlan\tAmount\tProvider\tSub ID\tPending\tUpdated')
    for (const row of list) {
      const user = formatUser(row)
      const plan = row.item_key || row.label || (row.catalog_item_id != null ? `catalog:${row.catalog_item_id}` : 'unknown')
      const amount = formatAmount(row.amount_cents, row.currency)
      const provider = `${row.provider}(${row.mode})`
      console.log(`${user}\t${row.status}\t${plan}\t${amount}\t${provider}\t${row.provider_subscription_id}\t${row.pending_action ?? ''}\t${row.updated_at}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('db:query:subscriptions failed', err)
  process.exit(1)
})

