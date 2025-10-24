import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3300'
const headed = String(process.env.HEADLESS || '').toLowerCase() === 'false'
const slowMo = Number(process.env.E2E_SLOWMO || (headed ? 250 : 0)) || 0

export default defineConfig({
  timeout: 60_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: !headed,
    launchOptions: { slowMo },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // Enable if you want cross-browser from the start
    // { name: 'firefox', use: { browserName: 'firefox' } },
    // { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
