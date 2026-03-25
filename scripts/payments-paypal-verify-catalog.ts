import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { getPool } from '../src/db'

type Mode = 'sandbox' | 'live'

type Args = {
  mode: Mode
  out: string | null
}

type LocalPlan = {
  id: number
  item_key: string
  label: string
  status: string
  provider: string
  provider_ref: string | null
  amount_cents: number | null
  currency: string
}

function parseArgs(argv: string[]): Args {
  const out: Args = { mode: 'sandbox', out: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || '').trim()
    if (!a) continue
    if (a === '--mode') {
      const v = String(argv[i + 1] || '').trim().toLowerCase()
      if (v === 'sandbox' || v === 'live') out.mode = v
      i += 1
      continue
    }
    if (a === '--out') {
      const v = String(argv[i + 1] || '').trim()
      out.out = v || null
      i += 1
      continue
    }
  }
  return out
}

function paypalBase(mode: Mode): string {
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
}

async function getAccessToken(input: { mode: Mode; clientId: string; clientSecret: string }): Promise<string> {
  const auth = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')
  const res = await fetch(`${paypalBase(input.mode)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  })
  const data = await res.json().catch(() => ({} as any))
  const token = String((data as any)?.access_token || '').trim()
  if (!res.ok || !token) {
    throw new Error(`paypal_oauth_failed status=${res.status} detail=${String((data as any)?.error || (data as any)?.name || 'unknown')}`)
  }
  return token
}

async function fetchProducts(mode: Mode, token: string): Promise<any[]> {
  const res = await fetch(`${paypalBase(mode)}/v1/catalogs/products?page_size=50&total_required=true`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  })
  const data = await res.json().catch(() => ({} as any))
  if (!res.ok) {
    throw new Error(`paypal_products_list_failed status=${res.status} detail=${String((data as any)?.message || (data as any)?.name || 'unknown')}`)
  }
  return Array.isArray((data as any)?.products) ? (data as any).products : []
}

async function fetchPlansForProduct(mode: Mode, token: string, productId: string): Promise<any[]> {
  const res = await fetch(`${paypalBase(mode)}/v1/billing/plans?product_id=${encodeURIComponent(productId)}&page_size=20&total_required=true`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  })
  const data = await res.json().catch(() => ({} as any))
  if (!res.ok) {
    throw new Error(`paypal_plans_list_failed product_id=${productId} status=${res.status} detail=${String((data as any)?.message || (data as any)?.name || 'unknown')}`)
  }
  return Array.isArray((data as any)?.plans) ? (data as any).plans : []
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const db = getPool()
  try {
    const [cfgRows] = await db.query(
      `SELECT credentials_json
       FROM payment_provider_configs
       WHERE provider='paypal' AND mode=? AND status='enabled'
       ORDER BY id DESC LIMIT 1`,
      [args.mode]
    )
    const cfg = (cfgRows as any[])[0] || null
    if (!cfg) throw new Error(`paypal_provider_config_not_found mode=${args.mode}`)
    const creds = (() => {
      try { return JSON.parse(String(cfg.credentials_json || '{}')) } catch { return {} }
    })()
    const clientId = String(creds.clientId || creds.client_id || '').trim()
    const clientSecret = String(creds.clientSecret || creds.client_secret || '').trim()
    if (!clientId || !clientSecret) throw new Error('paypal_provider_credentials_missing_client_id_or_secret')

    const token = await getAccessToken({ mode: args.mode, clientId, clientSecret })
    const products = await fetchProducts(args.mode, token)
    const plans: any[] = []
    for (const product of products) {
      const productId = String(product?.id || '').trim()
      if (!productId) continue
      const rows = await fetchPlansForProduct(args.mode, token, productId)
      for (const row of rows) {
        plans.push({ ...row, __product_id: productId, __product_name: String(product?.name || '') })
      }
    }
    const planById = new Map<string, any>()
    for (const p of plans) {
      const id = String(p?.id || '').trim()
      if (id) planById.set(id, p)
    }

    const [localRows] = await db.query(
      `SELECT id, item_key, label, status, provider, provider_ref, amount_cents, currency
       FROM payment_catalog_items
       WHERE kind='subscribe_plan' AND provider='paypal'
       ORDER BY status ASC, id ASC`
    )
    const localPlans = (localRows as any[]) as LocalPlan[]

    const reportRows = localPlans.map((row) => {
      const ref = String(row.provider_ref || '').trim()
      const remote = ref ? planById.get(ref) : null
      let result = 'ok'
      if (String(row.status || '').toLowerCase() === 'active' && !ref) result = 'missing_provider_ref'
      else if (ref && !remote) result = 'provider_ref_not_found_in_paypal'
      else if (remote && String(remote.status || '').toUpperCase() !== 'ACTIVE') result = 'paypal_plan_not_active'
      return {
        id: row.id,
        item_key: row.item_key,
        status: row.status,
        provider_ref: ref || '',
        amount_cents: row.amount_cents,
        currency: row.currency,
        result,
        paypal_plan_status: remote ? String(remote.status || '') : '',
        paypal_plan_name: remote ? String(remote.name || '') : '',
        paypal_product_id: remote ? String(remote.__product_id || '') : '',
        paypal_product_name: remote ? String(remote.__product_name || '') : '',
      }
    })

    const usedPlanIds = new Set(reportRows.map((r) => r.provider_ref).filter(Boolean))
    const unreferencedPaypalPlans = plans
      .filter((p) => {
        const id = String(p?.id || '').trim()
        return id && !usedPlanIds.has(id)
      })
      .map((p) => ({
        plan_id: String(p?.id || ''),
        plan_name: String(p?.name || ''),
        plan_status: String(p?.status || ''),
        product_id: String(p?.__product_id || ''),
        product_name: String(p?.__product_name || ''),
      }))

    const summary = {
      mode: args.mode,
      local_subscribe_plan_rows: localPlans.length,
      paypal_products: products.length,
      paypal_plans: plans.length,
      local_rows_ok: reportRows.filter((r) => r.result === 'ok').length,
      local_rows_issues: reportRows.filter((r) => r.result !== 'ok').length,
      unreferenced_paypal_plans: unreferencedPaypalPlans.length,
    }

    console.log('summary')
    for (const [k, v] of Object.entries(summary)) console.log(`${k}\t${v}`)
    console.log('')
    console.log('local_vs_paypal')
    console.log('id\titem_key\tstatus\tprovider_ref\tresult\tpaypal_plan_status\tpaypal_product_id')
    for (const row of reportRows) {
      console.log(`${row.id}\t${row.item_key}\t${row.status}\t${row.provider_ref}\t${row.result}\t${row.paypal_plan_status}\t${row.paypal_product_id}`)
    }
    console.log('')
    console.log('paypal_unreferenced_plans')
    if (!unreferencedPaypalPlans.length) {
      console.log('(none)')
    } else {
      console.log('plan_id\tplan_name\tplan_status\tproduct_id')
      for (const row of unreferencedPaypalPlans) {
        console.log(`${row.plan_id}\t${row.plan_name}\t${row.plan_status}\t${row.product_id}`)
      }
    }

    if (args.out) {
      const outPath = path.resolve(args.out)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      const payload = {
        generated_at: new Date().toISOString(),
        summary,
        local_vs_paypal: reportRows,
        paypal_unreferenced_plans: unreferencedPaypalPlans,
      }
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
      console.log('')
      console.log(`wrote\t${outPath}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('payments:paypal:verify-catalog failed', err)
  process.exit(1)
})
