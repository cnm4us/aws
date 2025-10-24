import { test, expect } from '@playwright/test'
import { loginViaUi } from '../utils/auth'

test('login via UI shows home shell', async ({ page }) => {
  await loginViaUi(page)
  await expect(page).toHaveURL(/\/(uploads|productions|publish|)$/)
})

