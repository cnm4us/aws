# Moderation Admin Routes Smoke

This checklist verifies the moderation admin IA migration after the canonical move to `/admin/moderation/*`.

## Goal

Confirm that:

- `/admin/moderation` is the canonical moderation entry
- rules, categories, and cultures load on canonical moderation-prefixed routes
- legacy `/admin/rules*`, `/admin/categories*`, and `/admin/cultures*` URLs still work through redirects
- the shared moderation subnav consistently points at canonical moderation pages

## Preconditions

- local server is running
- you have a site-admin or super-admin session
- at least one rule, one category, and one culture exist in dev

## Canonical Page Smoke

Use an authenticated browser session or `scripts/auth_curl.sh`.

Canonical pages to open:

- `/admin/moderation`
- `/admin/moderation/rules`
- `/admin/moderation/rules/new`
- `/admin/moderation/categories`
- `/admin/moderation/categories/new`
- `/admin/moderation/cultures`
- `/admin/moderation/cultures/new`

Expected:

- each page returns `200`
- the main admin nav shows `Moderation`
- the moderation subnav shows `Moderation`, `Rules`, `Categories`, and `Cultures`
- subnav links for all three sections point at `/admin/moderation/*`

## Legacy Redirect Smoke

Open the legacy pages:

- `/admin/rules`
- `/admin/categories`
- `/admin/cultures`

Expected:

- each legacy URL redirects to its canonical counterpart
- query strings are preserved during redirect
- after redirect, the browser location is the canonical `/admin/moderation/*` path

Recommended query-string check:

- `/admin/rules?sort=title&dir=asc`
- `/admin/categories?notice=test`
- `/admin/cultures?error=test`

Expected:

- redirected URL still contains the original query string

## Detail-Flow Smoke

Pick one existing rule, category, and culture ID and open both the canonical and legacy detail URLs.

Examples:

- canonical rule detail: `/admin/moderation/rules/<id>`
- legacy rule detail: `/admin/rules/<id>`
- canonical category detail: `/admin/moderation/categories/<id>`
- legacy category detail: `/admin/categories/<id>`
- canonical culture detail: `/admin/moderation/cultures/<id>`
- legacy culture detail: `/admin/cultures/<id>`

Expected:

- canonical detail pages return `200`
- legacy detail pages redirect to canonical detail pages
- toolbar back-links go to canonical moderation list pages
- related-object links inside the pages use canonical moderation URLs

## Rule Authoring Smoke

Check the full rule route family:

- `/admin/moderation/rules/<id>/edit`
- `/admin/moderation/rules/<id>/versions/new`
- legacy `/admin/rules/<id>/edit`
- legacy `/admin/rules/<id>/versions/new`

Expected:

- canonical edit/version pages return `200`
- legacy edit/version pages redirect to canonical pages
- rule list sort links stay under `/admin/moderation/rules?...`
- create/save/publish/delete actions land back on canonical moderation URLs

## Manual UI Checks

From `/admin/moderation`:

1. Open the `Rules` tile and confirm it lands on `/admin/moderation/rules`.
2. Open the `Categories` tile and confirm it lands on `/admin/moderation/categories`.
3. Open the `Cultures` tile and confirm it lands on `/admin/moderation/cultures`.

From each moderation page:

1. Use the moderation subnav to move between `Rules`, `Categories`, and `Cultures`.
2. Confirm the current section is highlighted.
3. Confirm no navigation jump sends you back to legacy `/admin/rules`, `/admin/categories`, or `/admin/cultures`.

## Failure Triage

- page loads on a legacy path without redirect:
  - check the corresponding legacy `pagesRouter.get(...)` route in `src/routes/pages.ts`
- redirect drops query params:
  - check `buildPreservedQuerySuffix(...)` and `redirectToAdminPath(...)`
- subnav points at legacy URLs:
  - check `renderModerationAdminSubnav(...)` and the `canonicalSections` flags passed by the page renderer
- rule sort links point at legacy URLs:
  - check `renderRuleListPage(...)`
