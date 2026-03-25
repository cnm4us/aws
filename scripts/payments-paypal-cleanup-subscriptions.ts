import 'dotenv/config'
import { getPool } from '../src/db'

type Mode = 'sandbox' | 'live'

function parseArgs(argv: string[]): { mode: Mode } {
  let mode: Mode = 'sandbox'
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || '').trim()
    if (a === '--mode') {
      const v = String(argv[i + 1] || '').trim().toLowerCase()
      if (v === 'sandbox' || v === 'live') mode = v
      i += 1
    }
  }
  return { mode }
}

function paypalBase(mode: Mode): string {
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
}

async function getToken(mode: Mode, clientId: string, clientSecret: string): Promise<string> {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(`${paypalBase(mode)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  })
  const data: any = await res.json().catch(() => ({}))
  const token = String(data?.access_token || '').trim()
  if (!res.ok || !token) {
    throw new Error(`paypal_oauth_failed status=${res.status} detail=${String(data?.error || data?.name || 'unknown')}`)
  }
  return token
}

async function cancelSubscription(mode: Mode, token: string, subscriptionId: string): Promise<{ ok: boolean; status: number; detail: string }> {
  const res = await fetch(`${paypalBase(mode)}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ reason: 'Canceled by test cleanup' }),
  })
  const bodyText = await res.text()
  if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, detail: 'ok' }
  return { ok: false, status: res.status, detail: bodyText.slice(0, 300) }
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

    const [rows] = await db.query(
      `SELECT DISTINCT provider_subscription_id, status
       FROM payment_subscriptions
       WHERE provider='paypal'
         AND mode=?
         AND provider_subscription_id IS NOT NULL
         AND provider_subscription_id <> ''
         AND status IN ('pending','active','suspended')
       ORDER BY id DESC`,
      [args.mode]
    )
    const targets = (rows as any[]).map((r) => ({
      id: String(r.provider_subscription_id || '').trim(),
      status: String(r.status || '').trim().toLowerCase(),
    })).filter((r) => r.id)

    if (!targets.length) {
      console.log(`No local PayPal ${args.mode} subscriptions to cancel (pending/active/suspended).`)
      return
    }

    const token = await getToken(args.mode, clientId, clientSecret)
    console.log(`mode\t${args.mode}`)
    console.log(`targets\t${targets.length}`)
    console.log('')
    console.log('subscription_id\tlocal_status\tresult\thttp_status\tdetail')
    for (const target of targets) {
      const res = await cancelSubscription(args.mode, token, target.id)
      console.log(`${target.id}\t${target.status}\t${res.ok ? 'ok' : 'error'}\t${res.status}\t${res.detail}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('payments:paypal:cleanup-subscriptions failed', err)
  process.exit(1)
})

