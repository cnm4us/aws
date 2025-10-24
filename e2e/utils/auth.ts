import { BrowserContext, Page, request as pwRequest } from '@playwright/test'

export async function loginViaApi(context: BrowserContext, opts?: { email?: string, password?: string }) {
  const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3300'
  const email = opts?.email || process.env.E2E_USER_EMAIL
  const password = opts?.password || process.env.E2E_USER_PASSWORD
  if (!email || !password) throw new Error('E2E_USER_EMAIL and E2E_USER_PASSWORD are required')

  const req = await pwRequest.newContext({ baseURL })
  const res = await req.post('/api/login', {
    data: { email, password },
    headers: { 'content-type': 'application/json' },
  })
  if (!res.ok()) {
    const body = await res.text()
    throw new Error(`login failed: ${res.status()} ${body}`)
  }

  const url = new URL(baseURL)
  const secure = url.protocol === 'https:'
  const cookies: Array<{ name: string; value: string }> = []
  const headers = res.headersArray()
  for (const h of headers) {
    if (h.name.toLowerCase() === 'set-cookie') {
      const parts = h.value.split(';')
      const kv = parts[0]
      const idx = kv.indexOf('=')
      if (idx > 0) {
        const name = kv.slice(0, idx).trim()
        const value = kv.slice(idx + 1).trim()
        if (name === 'sid' || name === 'csrf') {
          cookies.push({ name, value })
        }
      }
    }
  }

  if (!cookies.length) throw new Error('login failed: no cookies returned')

  await context.addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: url.hostname,
      path: '/',
      httpOnly: c.name === 'sid',
      secure,
      sameSite: 'Lax' as const,
    }))
  )
}

export async function gotoAndAssert(page: Page, path: string, markerSelector: string) {
  await page.goto(path)
  await page.waitForSelector(markerSelector)
}

export async function loginViaUi(page: Page, opts?: { email?: string, password?: string }) {
  const email = opts?.email || process.env.E2E_USER_EMAIL
  const password = opts?.password || process.env.E2E_USER_PASSWORD
  if (!email || !password) throw new Error('E2E_USER_EMAIL and E2E_USER_PASSWORD are required')
  await page.goto('/login')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type="submit"]')
  // Wait for redirect after login (home shell or any app shell). Give a generous timeout.
  await page.waitForURL((url) => /\/($|uploads|productions|publish)/.test(url.pathname), { timeout: 15000 })
}
