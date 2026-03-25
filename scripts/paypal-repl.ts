import 'dotenv/config'
import repl from 'node:repl'
import util from 'node:util'
import { getPool } from '../src/db'

type Mode = 'sandbox' | 'live'

function parseArgs(_argv: string[]): { mode: Mode } {
  // This REPL is intentionally sandbox-only.
  return { mode: 'sandbox' }
}

function paypalBase(mode: Mode): string {
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
}

function normalizeDateArg(raw: string, kind: 'start' | 'end'): string {
  const value = String(raw || '').trim()
  if (!value) return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return kind === 'start' ? `${value}T00:00:00Z` : `${value}T23:59:59Z`
  }
  return value
}

async function loadCredentials(mode: Mode): Promise<{ clientId: string; clientSecret: string }> {
  const db = getPool()
  try {
    const [rows] = await db.query(
      `SELECT credentials_json
       FROM payment_provider_configs
       WHERE provider='paypal' AND mode=? AND status='enabled'
       ORDER BY id DESC LIMIT 1`,
      [mode]
    )
    const row = (rows as any[])[0] || null
    if (!row) throw new Error(`paypal_provider_config_not_found mode=${mode}`)
    const creds = (() => {
      try { return JSON.parse(String(row.credentials_json || '{}')) } catch { return {} }
    })()
    const clientId = String(creds.clientId || creds.client_id || '').trim()
    const clientSecret = String(creds.clientSecret || creds.client_secret || '').trim()
    if (!clientId || !clientSecret) throw new Error('paypal_provider_credentials_missing_client_id_or_secret')
    return { clientId, clientSecret }
  } finally {
    await db.end()
  }
}

function toQueryString(params: Record<string, any> | undefined): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue
    sp.set(k, String(v))
  }
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

async function main() {
  const { mode } = parseArgs(process.argv.slice(2))
  const creds = await loadCredentials(mode)
  const base = paypalBase(mode)

  let token: string | null = null
  let tokenExpiryMs = 0

  async function auth(force = false): Promise<string> {
    if (!force && token && Date.now() < tokenExpiryMs - 10_000) return token
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok || !String(data?.access_token || '').trim()) {
      throw new Error(`paypal_oauth_failed status=${res.status} detail=${String(data?.error || data?.name || 'unknown')}`)
    }
    token = String(data.access_token)
    const expiresIn = Number(data?.expires_in || 300)
    tokenExpiryMs = Date.now() + Math.max(30, Math.min(3600, expiresIn)) * 1000
    return token
  }

  async function request(method: string, path: string, body?: any, query?: Record<string, any>) {
    const tk = await auth()
    const url = `${base}${path}${toQueryString(query)}`
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${tk}`,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = String((data as any)?.message || (data as any)?.name || 'unknown_error')
      throw new Error(`paypal_api_failed ${method} ${path} status=${res.status} detail=${detail}`)
    }
    return data
  }

  const api = {
    mode,
    base,
    async auth(force = false) {
      const t = await auth(force)
      return { access_token: t, expires_at: new Date(tokenExpiryMs).toISOString() }
    },
    async listProducts(params?: { page_size?: number; page?: number; total_required?: boolean }) {
      return request('GET', '/v1/catalogs/products', undefined, {
        page_size: params?.page_size ?? 20,
        page: params?.page ?? 1,
        total_required: params?.total_required ?? true,
      })
    },
    async listPlans(productId?: string, params?: { page_size?: number; page?: number; total_required?: boolean }) {
      const q: Record<string, any> = {
        page_size: params?.page_size ?? 20,
        page: params?.page ?? 1,
        total_required: params?.total_required ?? true,
      }
      if (productId) q.product_id = productId
      return request('GET', '/v1/billing/plans', undefined, q)
    },
    async listTransactions(input: { start_date: string; end_date: string; page_size?: number; page?: number; fields?: 'all' | 'transaction_info' }) {
      const start = String(input.start_date || '').trim()
      const end = String(input.end_date || '').trim()
      if (!start || !end) throw new Error('start_date and end_date are required')
      return request('GET', '/v1/reporting/transactions', undefined, {
        start_date: start,
        end_date: end,
        page_size: input.page_size ?? 20,
        page: input.page ?? 1,
        fields: input.fields ?? 'all',
      })
    },
    async getOrder(id: string) {
      return request('GET', `/v2/checkout/orders/${encodeURIComponent(String(id || '').trim())}`)
    },
    async getSubscription(id: string) {
      return request('GET', `/v1/billing/subscriptions/${encodeURIComponent(String(id || '').trim())}`)
    },
    async createProduct(input: { name: string; description?: string; type?: string; category?: string; image_url?: string; home_url?: string }) {
      return request('POST', '/v1/catalogs/products', {
        name: input.name,
        description: input.description || '',
        type: input.type || 'SERVICE',
        category: input.category || 'SOFTWARE',
        ...(input.image_url ? { image_url: input.image_url } : {}),
        ...(input.home_url ? { home_url: input.home_url } : {}),
      })
    },
    async patchProduct(id: string, patches: Array<{ op: 'replace' | 'add' | 'remove'; path: string; value?: any }>) {
      return request('PATCH', `/v1/catalogs/products/${encodeURIComponent(String(id || '').trim())}`, patches)
    },
    async createPlan(input: {
      product_id: string
      name: string
      description?: string
      value: string
      currency_code?: string
      interval_unit?: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'
      interval_count?: number
    }) {
      return request('POST', '/v1/billing/plans', {
        product_id: input.product_id,
        name: input.name,
        description: input.description || '',
        status: 'ACTIVE',
        billing_cycles: [
          {
            frequency: {
              interval_unit: input.interval_unit || 'MONTH',
              interval_count: input.interval_count || 1,
            },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: {
              fixed_price: {
                value: input.value,
                currency_code: input.currency_code || 'USD',
              },
            },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: 'CONTINUE',
          payment_failure_threshold: 3,
        },
      })
    },
    async raw(method: string, path: string, body?: any, query?: Record<string, any>) {
      return request(String(method || 'GET').toUpperCase(), path, body, query)
    },
    async help() {
      return {
        note: 'PayPal REPL helpers',
        examples: [
          'await paypal.auth()',
          'await paypal.listProducts()',
          'await paypal.listPlans()',
          "await paypal.listPlans('PROD-XXXXXXXXXXXX')",
          "await paypal.getOrder('9U483296W6267824T')",
          "await paypal.getSubscription('I-TSCRH1J97LG4')",
          "await paypal.createProduct({ name: 'My Product', description: 'Demo' })",
          "await paypal.patchProduct('PROD-XXX', [{ op:'replace', path:'/description', value:'New desc' }])",
          "await paypal.createPlan({ product_id:'PROD-XXX', name:'Gold', value:'20.00' })",
          "await paypal.listTransactions({ start_date:'2026-03-01T00:00:00Z', end_date:'2026-03-31T23:59:59Z' })",
          "await paypal.raw('GET','/v1/notifications/webhooks-events')",
        ],
      }
    },
  }

  function tokenize(line: string): string[] {
    const out: string[] = []
    const re = /"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      out.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '')
    }
    return out
  }

  async function runCommand(rawLine: string): Promise<any> {
    const line = String(rawLine || '').trim()
    if (!line) return null
    const tokens = tokenize(line)
    if (!tokens.length) return null
    const cmd = String(tokens[0] || '').trim().toLowerCase()
    const args = tokens.slice(1)

    switch (cmd) {
      case 'help':
        return {
          commands: [
            'help',
            'clear',
            'auth [force]',
            'list_products [page_size] [page]',
            'list_plans [product_id] [page_size] [page]',
            'get_order <ORDER_ID>',
            'get_subscription <SUBSCRIPTION_ID>',
            'create_product <name> [description]',
            'patch_product_desc <PROD_ID> <description...>',
            'create_plan <PROD_ID> <name> <value> [currency] [interval_unit] [interval_count]',
            'list_transactions <start_iso> <end_iso> [page_size] [page]',
            'raw_get <path>',
            'raw_post <path> <json_body>',
          ],
          note: 'Use quoted strings for args with spaces, e.g. create_product "My Product" "Desc here". Dates accept YYYY-MM-DD or full ISO.',
        }
      case 'clear':
        process.stdout.write('\x1Bc')
        return null
      case 'auth': {
        const force = String(args[0] || '').toLowerCase() === 'force'
        return api.auth(force)
      }
      case 'list_products': {
        const pageSize = Number(args[0] || 20)
        const page = Number(args[1] || 1)
        return api.listProducts({
          page_size: Number.isFinite(pageSize) ? Math.max(1, Math.min(50, Math.trunc(pageSize))) : 20,
          page: Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1,
          total_required: true,
        })
      }
      case 'list_plans': {
        const productId = args[0] && !/^\d+$/.test(String(args[0])) ? String(args[0]) : undefined
        const pageSizeArg = productId ? args[1] : args[0]
        const pageArg = productId ? args[2] : args[1]
        const pageSize = Number(pageSizeArg || 20)
        const page = Number(pageArg || 1)
        return api.listPlans(productId, {
          page_size: Number.isFinite(pageSize) ? Math.max(1, Math.min(50, Math.trunc(pageSize))) : 20,
          page: Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1,
          total_required: true,
        })
      }
      case 'get_order': {
        const id = String(args[0] || '').trim()
        if (!id) throw new Error('usage: get_order <ORDER_ID>')
        return api.getOrder(id)
      }
      case 'get_subscription': {
        const id = String(args[0] || '').trim()
        if (!id) throw new Error('usage: get_subscription <SUBSCRIPTION_ID>')
        return api.getSubscription(id)
      }
      case 'create_product': {
        const name = String(args[0] || '').trim()
        if (!name) throw new Error('usage: create_product <name> [description]')
        const description = args[1] != null ? String(args.slice(1).join(' ')).trim() : ''
        return api.createProduct({ name, description })
      }
      case 'patch_product_desc': {
        const productId = String(args[0] || '').trim()
        const description = String(args.slice(1).join(' ') || '').trim()
        if (!productId || !description) throw new Error('usage: patch_product_desc <PROD_ID> <description...>')
        return api.patchProduct(productId, [{ op: 'replace', path: '/description', value: description }])
      }
      case 'create_plan': {
        const productId = String(args[0] || '').trim()
        const name = String(args[1] || '').trim()
        const value = String(args[2] || '').trim()
        const currency = String(args[3] || 'USD').trim().toUpperCase()
        const intervalUnit = String(args[4] || 'MONTH').trim().toUpperCase() as 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'
        const intervalCount = Number(args[5] || 1)
        if (!productId || !name || !value) throw new Error('usage: create_plan <PROD_ID> <name> <value> [currency] [interval_unit] [interval_count]')
        return api.createPlan({
          product_id: productId,
          name,
          value,
          currency_code: currency,
          interval_unit: ['DAY', 'WEEK', 'MONTH', 'YEAR'].includes(intervalUnit) ? intervalUnit : 'MONTH',
          interval_count: Number.isFinite(intervalCount) ? Math.max(1, Math.trunc(intervalCount)) : 1,
        })
      }
      case 'list_transactions': {
        const startIso = normalizeDateArg(String(args[0] || '').trim(), 'start')
        const endIso = normalizeDateArg(String(args[1] || '').trim(), 'end')
        if (!startIso || !endIso) {
          return {
            usage: 'list_transactions <start_iso|YYYY-MM-DD> <end_iso|YYYY-MM-DD> [page_size] [page]',
            examples: [
              'list_transactions 2026-03-01 2026-03-31',
              'list_transactions 2026-03-01T00:00:00Z 2026-03-31T23:59:59Z 50 1',
            ],
          }
        }
        const pageSize = Number(args[2] || 20)
        const page = Number(args[3] || 1)
        return api.listTransactions({
          start_date: startIso,
          end_date: endIso,
          page_size: Number.isFinite(pageSize) ? Math.max(1, Math.min(100, Math.trunc(pageSize))) : 20,
          page: Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1,
          fields: 'all',
        })
      }
      case 'raw_get': {
        const p = String(args[0] || '').trim()
        if (!p) throw new Error('usage: raw_get <path>')
        return api.raw('GET', p)
      }
      case 'raw_post': {
        const p = String(args[0] || '').trim()
        if (!p) throw new Error('usage: raw_post <path> <json_body>')
        const rawBody = String(args.slice(1).join(' ') || '').trim()
        const parsed = rawBody ? JSON.parse(rawBody) : {}
        return api.raw('POST', p, parsed)
      }
      default:
        throw new Error(`unknown command: ${cmd} (type "help")`)
    }
  }

  const banner = [
    'PayPal REPL ready.',
    `mode: ${mode}`,
    `base: ${base}`,
    `client_id: ${creds.clientId.slice(0, 8)}...`,
    'command mode: type help, then commands like list_products, get_order <id>, list_plans <product_id>',
    'advanced JS helpers still available under "paypal".',
  ].join('\n')

  console.log(banner)
  const r = repl.start({
    prompt: 'paypal> ',
    useGlobal: true,
    writer: (output: any) => util.inspect(output, {
      depth: null,
      maxArrayLength: null,
      breakLength: 120,
      compact: false,
      colors: true,
    }),
    eval: (cmd, _ctx, _file, cb) => {
      const input = String(cmd || '').trim()
      if (!input) return cb(null, null)
      runCommand(input).then((v) => cb(null, v)).catch((e) => cb(e as any, null))
    },
  })
  ;(r.context as any).paypal = api
  ;(r.context as any).mode = mode
  ;(r.context as any).base = base
  ;(r.context as any).help = () => api.help()
}

main().catch((err) => {
  console.error('paypal:sandbox failed', err)
  process.exit(1)
})
