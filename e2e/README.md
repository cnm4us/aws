Playwright E2E Tests

Prereqs
- Node.js LTS installed.
- Install Playwright browsers once:
  - npm run e2e:install

Environment
- Set these env vars (e.g., in your shell or VS Code launch config):
  - E2E_BASE_URL (default: http://localhost:3300)
  - E2E_USER_EMAIL
  - E2E_USER_PASSWORD

Run tests
- Headless (CI-like): npm run e2e
- Headed (watch browser on Windows/macOS): npm run e2e:headed
- UI mode (filter, re-run): npm run e2e:ui

Notes
- Tests use API login to obtain session cookies and attach them to the browser context.
- Add data-e2e attributes in the app when selectors get brittle.

