import 'dotenv/config'
import { getPool } from '../src/db'

type Args = {
  mode: 'sandbox' | 'live'
  productId: string | null
  productName: string
  productDescription: string
  overwrite: boolean
}

type CatalogRow = {
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
  const out: Args = {
    mode: 'sandbox',
    productId: null,
    productName: process.env.PAYPAL_PRODUCT_NAME || 'BAWebTech Support',
    productDescription: process.env.PAYPAL_PRODUCT_DESCRIPTION || 'Support tiers',
    overwrite: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || '').trim()
    if (!a) continue
    if (a === '--overwrite') {
      out.overwrite = true
      continue
    }
    if (a === '--mode') {
      const v = String(argv[i + 1] || '').trim().toLowerCase()
      if (v === 'sandbox' || v === 'live') out.mode = v
      i += 1
      continue
    }
    if (a === '--product-id') {
      const v = String(argv[i + 1] || '').trim()
      out.productId = v || null
      i += 1
      continue
    }
    if (a === '--product-name') {
      out.productName = String(argv[i + 1] || '').trim() || out.productName
      i += 1
      continue
    }
    if (a === '--product-description') {
      out.productDescription = String(argv[i + 1] || '').trim() || out.productDescription
      i += 1
      continue
    }
  }
  return out
}

function paypalBase(mode: 'sandbox' | 'live'): string {
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
}

async function getToken(input: { mode: 'sandbox' | 'live'; clientId: string; clientSecret: string }): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'client_credentials' })
  const auth = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')
  const res = await fetch(`${paypalBase(input.mode)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  })
  const data = await res.json().catch(() => ({}))
  const token = String((data as any)?.access_token || '').trim()
  if (!res.ok || !token) {
    throw new Error(`paypal_oauth_failed: ${res.status} ${(data as any)?.error || (data as any)?.name || 'unknown_error'}`)
  }
  return token
}

async function createProduct(input: {
  mode: 'sandbox' | 'live'
  token: string
  name: string
  description: string
}): Promise<string> {
  const res = await fetch(`${paypalBase(input.mode)}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  })
  const data = await res.json().catch(() => ({}))
  const productId = String((data as any)?.id || '').trim()
  if (!res.ok || !productId) {
    throw new Error(`paypal_product_create_failed: ${res.status} ${(data as any)?.message || (data as any)?.name || 'unknown_error'}`)
  }
  return productId
}

async function createPlan(input: {
  mode: 'sandbox' | 'live'
  token: string
  productId: string
  name: string
  description: string
  amountValue: string
  currency: string
}): Promise<string> {
  const res = await fetch(`${paypalBase(input.mode)}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      product_id: input.productId,
      name: input.name,
      description: input.description,
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: {
              value: input.amountValue,
              currency_code: input.currency,
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3,
      },
    }),
  })
  const data = await res.json().catch(() => ({}))
  const planId = String((data as any)?.id || '').trim()
  if (!res.ok || !planId) {
    throw new Error(`paypal_plan_create_failed: ${res.status} ${(data as any)?.message || (data as any)?.name || 'unknown_error'}`)
  }
  return planId
}

function amountFromCents(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2)
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
    if (!cfg) throw new Error(`paypal_provider_config_not_found_for_mode_${args.mode}`)
    const creds = (() => {
      try { return JSON.parse(String(cfg.credentials_json || '{}')) } catch { return {} }
    })()
    const clientId = String(creds.clientId || creds.client_id || '').trim()
    const clientSecret = String(creds.clientSecret || creds.client_secret || '').trim()
    if (!clientId || !clientSecret) throw new Error('paypal_provider_credentials_missing_client_id_or_secret')

    const [planRows] = await db.query(
      `SELECT id,item_key,label,status,provider,provider_ref,amount_cents,currency
       FROM payment_catalog_items
       WHERE kind='subscribe_plan' AND status='active' AND provider='paypal'
       ORDER BY id ASC`
    )
    const plans = (planRows as any[]) as CatalogRow[]
    if (!plans.length) {
      console.log('No active PayPal subscribe_plan rows found.')
      return
    }
    const targetRows = plans.filter((r) => args.overwrite || !String(r.provider_ref || '').trim())
    if (!targetRows.length) {
      console.log('No rows need provider_ref (all active plans already mapped).')
      return
    }

    const token = await getToken({ mode: args.mode, clientId, clientSecret })
    const productId = args.productId || await createProduct({
      mode: args.mode,
      token,
      name: args.productName,
      description: args.productDescription,
    })

    console.log(`mode\t${args.mode}`)
    console.log(`product_id\t${productId}`)
    console.log(`plans_total\t${plans.length}`)
    console.log(`plans_targeted\t${targetRows.length}`)
    console.log('')
    console.log('id\titem_key\tamount\tnew_provider_ref')

    for (const row of targetRows) {
      const cents = Number(row.amount_cents || 0)
      if (!Number.isFinite(cents) || cents <= 0) {
        console.log(`${row.id}\t${row.item_key}\tinvalid\tSKIPPED_invalid_amount`)
        continue
      }
      const amount = amountFromCents(cents)
      const planId = await createPlan({
        mode: args.mode,
        token,
        productId,
        name: row.label || row.item_key,
        description: `${row.label || row.item_key} (${amount} ${String(row.currency || 'USD').toUpperCase()}/month)`,
        amountValue: amount,
        currency: String(row.currency || 'USD').toUpperCase(),
      })
      await db.query(
        `UPDATE payment_catalog_items
         SET provider_ref = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [planId, row.id]
      )
      console.log(`${row.id}\t${row.item_key}\t${amount} ${String(row.currency || 'USD').toUpperCase()}\t${planId}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('payments:paypal:create-plans failed', err)
  process.exit(1)
})

