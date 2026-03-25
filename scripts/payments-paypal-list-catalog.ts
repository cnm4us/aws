import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { getPool } from '../src/db'

type Mode = 'sandbox' | 'live'

type Args = {
  mode: Mode
  pageSize: number
  full: boolean
  out: string | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    mode: 'sandbox',
    pageSize: 20,
    full: false,
    out: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || '').trim()
    if (!a) continue
    if (a === '--full') {
      out.full = true
      continue
    }
    if (a === '--mode') {
      const v = String(argv[i + 1] || '').trim().toLowerCase()
      if (v === 'sandbox' || v === 'live') out.mode = v
      i += 1
      continue
    }
    if (a === '--page-size') {
      const n = Number(argv[i + 1] || '')
      if (Number.isFinite(n) && n > 0) out.pageSize = Math.max(1, Math.min(50, Math.trunc(n)))
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

async function fetchProducts(input: { mode: Mode; token: string; pageSize: number }): Promise<any[]> {
  const out: any[] = []
  let page = 1
  let total = Number.MAX_SAFE_INTEGER
  while ((page - 1) * input.pageSize < total) {
    const url = `${paypalBase(input.mode)}/v1/catalogs/products?page_size=${input.pageSize}&page=${page}&total_required=true`
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${input.token}`, accept: 'application/json' },
    })
    const data = await res.json().catch(() => ({} as any))
    if (!res.ok) {
      throw new Error(`paypal_products_list_failed status=${res.status} detail=${String((data as any)?.message || (data as any)?.name || 'unknown')}`)
    }
    const items = Array.isArray((data as any)?.products) ? (data as any).products : []
    out.push(...items)
    const totalItems = Number((data as any)?.total_items)
    if (Number.isFinite(totalItems) && totalItems >= 0) total = Math.trunc(totalItems)
    if (!items.length) break
    page += 1
  }
  return out
}

async function fetchPlansForProduct(input: { mode: Mode; token: string; productId: string; pageSize: number }): Promise<any[]> {
  const out: any[] = []
  let page = 1
  let total = Number.MAX_SAFE_INTEGER
  while ((page - 1) * input.pageSize < total) {
    const url = `${paypalBase(input.mode)}/v1/billing/plans?product_id=${encodeURIComponent(input.productId)}&page_size=${input.pageSize}&page=${page}&total_required=true`
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${input.token}`, accept: 'application/json' },
    })
    const data = await res.json().catch(() => ({} as any))
    if (!res.ok) {
      throw new Error(`paypal_plans_list_failed product_id=${input.productId} status=${res.status} detail=${String((data as any)?.message || (data as any)?.name || 'unknown')}`)
    }
    const items = Array.isArray((data as any)?.plans) ? (data as any).plans : []
    out.push(...items)
    const totalItems = Number((data as any)?.total_items)
    if (Number.isFinite(totalItems) && totalItems >= 0) total = Math.trunc(totalItems)
    if (!items.length) break
    page += 1
  }
  return out
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
    const products = await fetchProducts({ mode: args.mode, token, pageSize: args.pageSize })
    const plansByProduct: Record<string, any[]> = {}
    for (const product of products) {
      const pid = String(product?.id || '').trim()
      if (!pid) continue
      plansByProduct[pid] = await fetchPlansForProduct({
        mode: args.mode,
        token,
        productId: pid,
        pageSize: args.pageSize,
      })
    }

    const payload = {
      generated_at: new Date().toISOString(),
      mode: args.mode,
      product_count: products.length,
      plan_count: Object.values(plansByProduct).reduce((acc, arr) => acc + arr.length, 0),
      products,
      plans_by_product: plansByProduct,
    }

    if (args.out) {
      const outPath = path.resolve(args.out)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
      console.log(`wrote\t${outPath}`)
    }

    if (args.full) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    console.log(`mode\t${args.mode}`)
    console.log(`products\t${products.length}`)
    console.log(`plans\t${payload.plan_count}`)
    console.log('')
    console.log('product_id\tname\tstatus\tplans')
    for (const p of products) {
      const id = String(p?.id || '')
      const plans = plansByProduct[id] || []
      console.log(`${id}\t${String(p?.name || '')}\t${String(p?.status || '')}\t${plans.length}`)
      for (const plan of plans) {
        const cycle = Array.isArray(plan?.billing_cycles) ? plan.billing_cycles[0] : null
        const price = cycle?.pricing_scheme?.fixed_price
        const amount = price ? `${String(price.value || '')} ${String(price.currency_code || '')}` : ''
        console.log(`  plan\t${String(plan?.id || '')}\t${String(plan?.name || '')}\t${String(plan?.status || '')}\t${amount}`)
      }
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('payments:paypal:list-catalog failed', err)
  process.exit(1)
})

