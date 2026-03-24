import 'dotenv/config'
import { getPool } from '../src/db'

type PlanRow = {
  id: number
  item_key: string
  label: string
  status: string
  provider: string
  provider_ref: string | null
  amount_cents: number | null
  currency: string
  updated_at: string
}

function isLikelyPaypalPlanId(value: string): boolean {
  return /^P-[A-Z0-9]+$/i.test(String(value || '').trim())
}

async function main() {
  const db = getPool()
  try {
    const [rows] = await db.query(
      `SELECT
          id,
          item_key,
          label,
          status,
          provider,
          provider_ref,
          amount_cents,
          currency,
          updated_at
        FROM payment_catalog_items
        WHERE kind = 'subscribe_plan'
        ORDER BY status ASC, id DESC`
    )
    const list = rows as PlanRow[]
    if (!list.length) {
      console.log('No subscribe_plan rows found.')
      return
    }

    const invalid: Array<{ row: PlanRow; reason: string }> = []
    const warnings: Array<{ row: PlanRow; warning: string }> = []

    for (const row of list) {
      const status = String(row.status || '').toLowerCase()
      const provider = String(row.provider || '').toLowerCase()
      const providerRef = String(row.provider_ref || '').trim()

      if (status === 'active' && !providerRef) {
        invalid.push({ row, reason: 'active_plan_missing_provider_ref' })
      }
      if (status === 'active' && provider !== 'paypal') {
        invalid.push({ row, reason: 'active_plan_provider_not_supported' })
      }
      if (providerRef && provider === 'paypal' && !isLikelyPaypalPlanId(providerRef)) {
        warnings.push({ row, warning: 'provider_ref_not_like_paypal_plan_id' })
      }
    }

    console.log('subscribe_plan_diagnostics')
    console.log(`total\t${list.length}`)
    console.log(`invalid\t${invalid.length}`)
    console.log(`warnings\t${warnings.length}`)
    console.log('')

    console.log('plans')
    console.log('id\tstatus\titem_key\tprovider\tprovider_ref\tamount\tupdated_at')
    for (const row of list) {
      const amount = row.amount_cents == null ? 'null' : `${row.amount_cents} ${String(row.currency || 'USD').toUpperCase()}`
      console.log(`${row.id}\t${row.status}\t${row.item_key}\t${row.provider}\t${row.provider_ref || ''}\t${amount}\t${row.updated_at}`)
    }

    console.log('')
    console.log('invalid_rows')
    if (!invalid.length) {
      console.log('(none)')
    } else {
      console.log('id\treason\titem_key\tstatus\tprovider\tprovider_ref')
      for (const it of invalid) {
        console.log(`${it.row.id}\t${it.reason}\t${it.row.item_key}\t${it.row.status}\t${it.row.provider}\t${it.row.provider_ref || ''}`)
      }
    }

    console.log('')
    console.log('warnings')
    if (!warnings.length) {
      console.log('(none)')
    } else {
      console.log('id\twarning\titem_key\tprovider_ref')
      for (const it of warnings) {
        console.log(`${it.row.id}\t${it.warning}\t${it.row.item_key}\t${it.row.provider_ref || ''}`)
      }
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('payments:diagnose:subscribe-plans failed', err)
  process.exit(1)
})

