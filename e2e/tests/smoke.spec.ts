import { test, expect } from '@playwright/test'
import { loginViaApi } from '../utils/auth'

test('login and fetch /api/me', async ({ context, page }) => {
  await loginViaApi(context)
  // Use the page-bound request so it carries the browser context cookies we just set
  const res = await page.request.get('/api/me')
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  expect(json).toHaveProperty('userId')
  expect(json.userId).not.toBeNull()
})

test('open publish page shell', async ({ context, page }) => {
  await loginViaApi(context)
  // This route serves the SPA shell; no strict selector guarantee yet, so just assert it loads
  await page.goto('/publish')
  await expect(page).toHaveURL(/\/publish/)
})
