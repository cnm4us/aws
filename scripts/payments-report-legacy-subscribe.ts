import 'dotenv/config'
import { getPool } from '../src/db'

type Row = {
  id: number
  checkout_id: string
  status: string
  provider: string
  mode: string
  provider_session_id: string | null
  provider_order_id: string | null
  amount_cents: number | null
  currency: string
  user_id: number | null
  created_at: string
  updated_at: string
}

function amountString(cents: number | null, currency: string): string {
  const code = String(currency || 'USD').toUpperCase()
  if (cents == null || !Number.isFinite(Number(cents))) return `unknown ${code}`
  return `${(Number(cents) / 100).toFixed(2)} ${code}`
}

async function main() {
  const db = getPool()
  try {
    const [rows] = await db.query(
      `SELECT
          s.id,
          s.checkout_id,
          s.status,
          s.provider,
          s.mode,
          s.provider_session_id,
          s.provider_order_id,
          s.amount_cents,
          s.currency,
          s.user_id,
          s.created_at,
          s.updated_at
        FROM payment_checkout_sessions s
        WHERE s.intent = 'subscribe'
        ORDER BY s.updated_at DESC, s.id DESC`
    )

    const list = (rows as any[]) as Row[]
    const native = list.filter((r) => String(r.provider_session_id || '').trim().toUpperCase().startsWith('I-'))
    const legacyCapture = list.filter((r) => !String(r.provider_session_id || '').trim().toUpperCase().startsWith('I-'))

    console.log('subscribe_checkout_classification')
    console.log(`total\t${list.length}`)
    console.log(`native_subscription\t${native.length}`)
    console.log(`legacy_capture_based\t${legacyCapture.length}`)
    console.log('')

    console.log('legacy_capture_based_rows')
    if (!legacyCapture.length) {
      console.log('(none)')
    } else {
      console.log('id\tcheckout_id\tstatus\tprovider_session_id\tprovider_order_id\tamount\tupdated_at')
      for (const row of legacyCapture) {
        console.log(
          `${row.id}\t${row.checkout_id}\t${row.status}\t${row.provider_session_id || ''}\t${row.provider_order_id || ''}\t${amountString(row.amount_cents, row.currency)}\t${row.updated_at}`
        )
      }
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('payments:report:legacy-subscribe failed', err)
  process.exit(1)
})

