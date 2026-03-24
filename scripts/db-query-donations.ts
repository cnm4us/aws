import 'dotenv/config'
import { getPool } from '../src/db'

type DonationRow = {
  id: number
  user_id: number | null
  email: string | null
  display_name: string | null
  amount_cents: number | null
  currency: string
  completed_at: string | null
  created_at: string
}

function formatAmount(amountCents: number | null, currency: string): string {
  const code = String(currency || 'USD').toUpperCase()
  if (amountCents == null || !Number.isFinite(Number(amountCents))) return `unknown ${code}`
  return `${(Number(amountCents) / 100).toFixed(2)} ${code}`
}

function formatUser(row: DonationRow): string {
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
          s.amount_cents,
          s.currency,
          s.completed_at,
          s.created_at
        FROM payment_checkout_sessions s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.intent = 'donate'
          AND s.status = 'completed'
        ORDER BY COALESCE(s.completed_at, s.updated_at, s.created_at) DESC, s.id DESC`
    )

    const list = rows as DonationRow[]
    if (!list.length) {
      console.log('No completed donations found.')
      return
    }

    console.log('User\tDate\tAmount')
    for (const row of list) {
      const when = String(row.completed_at || row.created_at || '')
      const user = formatUser(row)
      const amount = formatAmount(row.amount_cents, row.currency)
      console.log(`${user}\t${when}\t${amount}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('db:query:donations failed', err)
  process.exit(1)
})
