import 'dotenv/config'
import { getPool } from '../src/db'

type MissingTxRow = {
  id: number
  checkout_id: string
  status: string
  intent: string
  user_id: number | null
  created_at: string
  updated_at: string
}

type StalePendingSubRow = {
  id: number
  provider_subscription_id: string
  status: string
  pending_action: string | null
  pending_plan_key: string | null
  pending_requested_at: string | null
  updated_at: string
}

function asInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

async function main() {
  const db = getPool()
  const staleHours = asInt(process.env.PAYMENTS_RECON_STALE_HOURS, 24)
  try {
    const [missingTxRows] = await db.query(
      `SELECT
          s.id,
          s.checkout_id,
          s.status,
          s.intent,
          s.user_id,
          s.created_at,
          s.updated_at
        FROM payment_checkout_sessions s
        LEFT JOIN payment_transactions t ON t.checkout_session_id = s.id
        WHERE s.status IN ('completed','failed','canceled','expired')
          AND t.id IS NULL
        ORDER BY s.updated_at DESC, s.id DESC
        LIMIT 200`
    )

    const [stalePendingRows] = await db.query(
      `SELECT
          id,
          provider_subscription_id,
          status,
          pending_action,
          pending_plan_key,
          pending_requested_at,
          updated_at
        FROM payment_subscriptions
        WHERE pending_action IS NOT NULL
          AND pending_requested_at IS NOT NULL
          AND pending_requested_at < (UTC_TIMESTAMP() - INTERVAL ? HOUR)
        ORDER BY pending_requested_at ASC, id ASC
        LIMIT 200`,
      [staleHours]
    )

    const missing = missingTxRows as MissingTxRow[]
    const stale = stalePendingRows as StalePendingSubRow[]

    console.log('payments_reconcile_summary')
    console.log(`missing_transactions\t${missing.length}`)
    console.log(`stale_pending_subscriptions\t${stale.length}`)
    console.log(`stale_hours_threshold\t${staleHours}`)
    console.log('')

    console.log('missing_transactions')
    if (!missing.length) {
      console.log('(none)')
    } else {
      console.log('session_id\tcheckout_id\tstatus\tintent\tuser_id\tupdated_at')
      for (const row of missing) {
        console.log(`${row.id}\t${row.checkout_id}\t${row.status}\t${row.intent}\t${row.user_id ?? ''}\t${row.updated_at}`)
      }
    }
    console.log('')

    console.log('stale_pending_subscriptions')
    if (!stale.length) {
      console.log('(none)')
    } else {
      console.log('id\tprovider_subscription_id\tstatus\tpending_action\tpending_plan_key\tpending_requested_at\tupdated_at')
      for (const row of stale) {
        console.log(`${row.id}\t${row.provider_subscription_id}\t${row.status}\t${row.pending_action ?? ''}\t${row.pending_plan_key ?? ''}\t${row.pending_requested_at ?? ''}\t${row.updated_at}`)
      }
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('payments:reconcile failed', err)
  process.exit(1)
})

