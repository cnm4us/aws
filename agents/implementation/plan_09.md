# Implementation Plan: SPA-Embedded Pages & Rules (Phase 2)

## 1. Overview

Goal: Move the latest versions of CMS pages and rules into the existing SPA shell so all app surfaces (feed, pages, rules) share a unified menu and layout, while reusing the server-side Markdown pipeline and keeping editor UIs server-rendered.

In scope (Phase 2):
- SPA ownership of the *latest* versions of:
  - Home (`/`) as a CMS-backed page.
  - `/pages/:slug` pages (latest content).
  - `/rules/:slug` rules (latest version) and navigation affordances to historical versions.
- Backend JSON APIs for pages and rules that return pre-rendered HTML + metadata (no client-side Markdown parsing).
- SPA route entries and viewer components that:
  - Fetch content via the new APIs.
  - Render HTML inside the existing SPA layout (with SharedNav/menu).
  - Provide simple “version navigation” affordances for rules.
- Static menu integration:
  - Add a small number of curated entries (e.g., Home, key pages, key rules) into the SPA menu.
- A simple pattern for using a page as a TOC over its own subtree (e.g., `/pages/docs` acting as an index for `/pages/docs/getting-started`, `/pages/docs/faq`, etc.).

Out of scope (Phase 2):
- Client-side Markdown rendering or rich WYSIWYG editors.
- Converting `/admin/pages` and `/admin/rules` to SPA editors (they remain server-rendered forms).
- SEO-focused SSR or Open Graph metadata for pages/rules.
- Dynamic, CMS-driven menus (no `show_in_nav` metadata yet; menu additions are static in code).

References:
- `agents/features/features_03.md` — High-level Pages & Rules feature description.
- `agents/implementation/plan_08.md` — Current server-rendered Pages & Rules implementation.
- `agents/requirements/markdown.md` — Markdown feature contract.
- `frontend/src/main.tsx` — SPA route switching.
- `frontend/src/ui` / `frontend/src/menu` — Existing layout and navigation patterns (to be discovered).
- `src/routes/pages.ts` — Existing HTML routes for `/`, `/pages/:slug`, `/rules/:slug`, `/rules/:slug/v:version`.
- `scripts/auth_curl.sh` — Tiny wrapper for authenticated `curl` tests using `/api/login` + `sid`/`csrf` cookies.

Test harness:
- Use `scripts/auth_curl.sh` for all step-by-step API checks so tests are repeatable and documented.
- Convention:
  - Log in once per environment:
    - `AUTH_EMAIL="you@example.com" AUTH_PASSWORD="secret" ./scripts/auth_curl.sh login`
  - Then use:
    - `./scripts/auth_curl.sh get <path>` for authenticated GETs.
    - `./scripts/auth_curl.sh post|put|delete <path> ...` for state-changing calls (CSRF header auto-attached from cookie jar).
  - Store full “command + output” snapshots under `agents/implementation/tests/plan_09/` as we complete each step (keeps the plan readable while preserving real outputs for later threads).

---

## 2. Step-by-Step Plan

1. Discover current SPA navigation and layout integration points  
   Status: Completed  
   Testing:  
   - Code-only step (no API calls required).  
   - Quick sanity check (optional): confirm current SPA boot works on the target env:  
     - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh get /version` → `HTTP 200`
   Discovery notes (implementation touch points):
   - SPA route switching is a manual `if/else` on `window.location.pathname` in `frontend/src/main.tsx` (not react-router).
   - Feed is special-cased: `/` renders `Feed` directly (Feed includes its own `SharedNav`); most other routes render inside `frontend/src/ui/Layout.tsx`.
   - Shared navigation/drawer is `frontend/src/ui/SharedNav.tsx` using context menus under `frontend/src/menu/contexts/*` with a selector in `frontend/src/menu/ContextPicker.tsx`.
   - Static menu entries live in the per-context `items = [...]` arrays, e.g. `frontend/src/menu/contexts/HelpMenu.tsx`, `frontend/src/menu/contexts/ProfileMenu.tsx`.
   - Only `HelpMenu` currently does SPA-style navigation (`pushState` + `popstate`); other menu links do full navigations (acceptable once `/pages/*` and `/rules/*` serve SPA shell).

2. Design backend JSON APIs for pages and rules (latest + historical)  
   Status: Completed  
   Testing:  
   - Design-only step (no new endpoints implemented yet).  
   - API contract (latest content only; pre-rendered HTML; no raw Markdown in responses):
     - `GET /api/pages/:slugPath`
       - `:slugPath` is path-like (supports `/`) with max 4 segments; normalization matches the HTML routes (lowercase; trim; strip leading/trailing `/`; each segment `^[a-z][a-z0-9-]*$`).
       - Allowed special case: `home` (used by SPA for `/`).
       - `200` JSON:
         - `{ slug, title, html, visibility, layout, updatedAt, children? }`
         - `children` is optional; when present it is an array of *direct* children: `Array<{ slug, title, url }>` for pages under the requested prefix (one segment deeper).
       - Errors:
         - `400 { "error": "bad_slug" }`
         - `404 { "error": "page_not_found" }`
         - `401 { "error": "unauthorized" }` (visibility requires auth; not logged in)
         - `403 { "error": "forbidden" }` (logged in but lacks role)
    - `GET /api/rules/:slug`
      - `:slug` is path-like (supports `/`) with max 4 segments; normalization matches the HTML routes (lowercase; trim; strip leading/trailing `/`; each segment `^[a-z][a-z0-9-]*$`).
      - `200` JSON:
        - `{ slug, title, html, visibility, currentVersion, versions }`
        - `currentVersion`: `{ version, url, createdAt, changeSummary? }` where `url` is the canonical HTML permalink `/rules/:slug/v:version`.
         - `versions`: `Array<{ version, url, createdAt, changeSummary? }>` ordered newest→oldest (may be truncated later if needed).
       - Errors:
         - `400 { "error": "bad_slug" }`
         - `404 { "error": "rule_not_found" }`
         - `401 { "error": "unauthorized" }`
         - `403 { "error": "forbidden" }`
     - No JSON endpoint for historical rule versions in Phase 2:
       - Keep using server-rendered `/rules/:slug/v:version` permalinks for deep links.
   - Contract test expectations (to be executed in Step 3):
     - `200` responses include required keys (above).
     - Error responses include `{ "error": "<code>" }` with the exact codes above.

3. Implement backend APIs for pages and rules (JSON, pre-rendered HTML)  
   Status: Completed  
   Testing:  
     - Extend `src/routes/pages.ts` or add a small `src/routes/content.ts` router to implement:  
       - `GET /api/pages/:slug` resolving slugs in the same way as HTML pages, enforcing visibility, and returning JSON `{ slug, title, html, visibility, children… }`.  
       - `GET /api/rules/:slug` resolving the latest version from `rules` + `rule_versions`, enforcing visibility, and returning JSON `{ slug, title, html, visibility, currentVersion, changeSummary, versions? }`.  
   - Canonical API tests (run on target env; append outputs to `agents/implementation/tests/plan_09/step_03_api.md`):  
     - Unauth baseline:
       - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh get /api/pages/home` → `HTTP 200` if page exists and `visibility=public`, else `401/403` (or `404 page_not_found` if not created yet)
       - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh get /api/pages/does-not-exist` → `HTTP 404` with `{ "error": "page_not_found" }`
     - Site admin (“super”) happy paths:
       - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super login`
       - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super get /api/pages/home` → `HTTP 200` and JSON includes `slug,title,html,visibility`
       - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super get /api/pages/docs` → `HTTP 200` (if the page exists) and JSON includes `children[]` for `docs/*` pages (if any exist)
       - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super get /api/rules/community-guidelines` → `HTTP 200` and JSON includes `currentVersion` and `html`
     - Space admin (“space_admin”) RBAC spot checks (expected to match the endpoint’s visibility rules):
       - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile space_admin login`
       - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile space_admin get /api/pages/home` → `HTTP 200` if public/authenticated; `403` if `space_admin`-only and user lacks that condition (or `401` if unauth)

4. Add SPA viewer routes for Home, Pages, and Rules (latest only)  
   Status: Completed  
   Testing:  
   - In `frontend/src/main.tsx`, add branches that:  
     - For `/`, render a new `HomePage` component inside `Layout` that:  
       - Fetches `/api/pages/home` on mount, shows a loading state, then injects `html` via `dangerouslySetInnerHTML` into a `<div>` scoped with a CSS class.  
     - For `/pages/:slug`, render a `PageView` component that:  
       - Parses the path to a slug, calls `/api/pages/:slug`, and renders the returned HTML similarly.  
     - For `/rules/:slug`, render a `RuleView` component that:  
       - Calls `/api/rules/:slug` to show the current version’s HTML, plus a small “Version vN — see versions” header with static links to `/rules/:slug/v:version`.  
   - Ensure these components:  
     - Handle 404s and permission errors by showing a simple in-app error message (e.g., “Page not found” / “You do not have access to this content”) rather than redirecting.  
     - Do not introduce any client-side Markdown parsing; they only display pre-rendered HTML from the API.  
   - Manually verify:  
     - Navigating to `/` and `/pages/...` routes from within the SPA shows content inside the shared menu/layout.  
     - Clicking existing SPA links (e.g., to `/uploads`, `/profile`) still works as before.
   - Canonical checks:
     - `BASE_URL="https://aws.bawebtech.com" curl -sS https://aws.bawebtech.com/ | rg -n \"id=\\\"root\\\"\"` → should match once Step 5 changes land
     - Browser (manual): open `/pages/docs` and confirm:
       - SharedNav/menu is present
       - Page HTML content renders (no markdown parsing client-side)
   - Build check (actual): `npm run web:build:scoped` (see `agents/implementation/tests/plan_09/step_04_spa_viewers.md`).

5. Align server HTML routes with SPA ownership for latest versions  
   Status: Completed  
   Testing:  
   - Update `src/routes/pages.ts` HTML routes so that:  
     - `/` serves the SPA shell (`public/app/index.html`) instead of the server-rendered home page, or conditionally does so behind a feature flag.  
     - `/pages/:slug` and `/rules/:slug` similarly serve the SPA shell for latest views, while keeping `/rules/:slug/v:version` as a purely server-rendered historical permalink (for now).  
   - Ensure deep links to `/rules/:slug/v:version` still work as plain HTML pages.  
   - Manually verify that:  
     - Navigating directly to `/`, `/pages/...`, `/rules/...` loads the SPA and then shows content via the new viewer components.  
     - Navigating to `/rules/:slug/v:version` still shows the HTML-only view independent of SPA.
   - Canonical routing tests (run on target env; append outputs to `agents/implementation/tests/plan_09/step_05_routing.md`):  
     - SPA shell served for latest:
       - `curl -sS https://aws.bawebtech.com/pages/docs | rg -n \"id=\\\"root\\\"\"` → match
       - `curl -sS https://aws.bawebtech.com/rules/community-guidelines | rg -n \"id=\\\"root\\\"\"` → match
     - Historical permalink remains server-rendered:
       - `curl -sS https://aws.bawebtech.com/rules/community-guidelines/v:1 | rg -n \"id=\\\"root\\\"\"` → no match

6. Add static menu entries for key Pages and Rules  
   Status: Completed  
   Testing:  
   - Locate the SPA menu configuration (under `frontend/src/ui` or `frontend/src/menu`) and add a small number of static entries for:  
     - Home (if not already present), pointing to `/`.  
     - A “Docs” or “Pages” entry pointing to a curated CMS page such as `/pages/docs`.  
     - A “Rules” entry pointing to a rules index page at `/rules`.  
   - Manually verify that:  
     - These entries appear in the shared navigation.  
     - Clicking them from anywhere in the SPA retains the existing layout and shows the embedded page/rule content.
   - Canonical manual checks:
     - “Docs” menu item → `/pages/docs` (renders)
     - “Rules” menu item → `/rules` (renders, lists rules)
   - Build check (actual): `npm run web:build:scoped`.
   Implementation notes:
   - Added an `Info` menu context in `frontend/src/menu/contexts/InfoMenu.tsx` with static links: Home, Docs, Rules.
   - Exposed it via `frontend/src/menu/ContextPicker.tsx` (context id: `info`) and wired it into `frontend/src/ui/SharedNav.tsx`.

6b. Add a Rules index (TOC) route  
   Status: Completed  
   Testing (append outputs to `agents/implementation/tests/plan_09/step_06b_rules_index.md`):  
   - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh get /api/rules` → `HTTP 200` and includes `items[]` with `{slug,title,url}`.
   - `curl -sS https://aws.bawebtech.com/rules | rg -n "id=\\\"root\\\""` → match (SPA shell)
   - Manual: `Info (Pages & Rules) → Rules` opens `/rules` and shows a list including newly created rules.

7. Implement TOC-style behavior for selected pages (e.g., `/pages/docs`)  
   Status: Completed  
   Testing:  
   - Extend the `/api/pages/:slug` implementation so that, for configured “index” pages (e.g., `docs`, `help`), it also returns a list of children based on slug prefix (e.g., all pages where `slug` starts with `docs/`).  
   - Update `PageView` to detect when the current slug is an index/TOC page (by a flag in the API response or by convention) and render a simple list of links to its children beneath the main HTML content.  
   - Manually verify:  
     - `/pages/docs` shows both the doc page content and a TOC listing of `/pages/docs/...` children.  
     - Child pages continue to render normally when visited directly.
   - Canonical API check (after Step 7 lands; append outputs to `agents/implementation/tests/plan_09/step_07_toc.md`):  
     - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super get /api/pages/docs` → JSON includes `children[]` with slugs prefixed by `docs/`

8. Add a JSON moderation view for rule-linked actions (optional polish)  
   Status: Pending  
   Testing:  
   - Extend `GET /api/admin/moderation/actions` (or add a new endpoint) to:  
     - Include canonical rule URLs for any action with a `rule_version_id` (`/rules/:slug/v:version`).  
     - Optionally filter actions by `rule_slug` or `rule_version_id`.  
   - (Optional SPA integration) Decide whether a future iteration should show a minimal moderation activity list linked from a Rules view; for this phase, confirm only that the JSON response exposes the necessary rule linkage.  
   - Manually verify via curl/Postman that moderation actions referencing rules expose correct rule URLs and versions for later use.
   - Canonical RBAC tests (append outputs to `agents/implementation/tests/plan_09/step_08_moderation.md`):  
     - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super get /api/admin/moderation/actions` → `HTTP 200`
     - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile space_admin get /api/admin/moderation/actions` → `HTTP 403`

---

## 3. Progress Tracking Notes

- Step 1 — Status: Completed (2025-12-23) — Discovered route + menu integration points; see Step 1 “Discovery notes”.  
- Step 2 — Status: Completed (2025-12-23) — Locked API contracts for `/api/pages/:slugPath` and `/api/rules/:slug` (error codes + response shape).  
- Step 3 — Status: Completed (2025-12-23) — Implemented `/api/pages/:slugPath` and `/api/rules/:slug` in `src/routes/pages.ts` and captured real outputs in `agents/implementation/tests/plan_09/step_03_api.md`.  
- Step 4 — Status: Completed (2025-12-23) — Added `HomePage`, `PageView`, and `RuleView` SPA components + `frontend/src/main.tsx` route branches; build verified via `npm run web:build:scoped`.  
- Step 5 — Status: Completed (2025-12-23) — Updated `src/routes/pages.ts` to serve SPA shell for `/`, `/pages/*`, and `/rules/:slug`, preserving server-rendered `/rules/:slug/v:version`; verified via curl in `agents/implementation/tests/plan_09/step_05_routing.md`.  
- Step 6 — Status: Completed (2025-12-23) — Added `Info` menu context with static links to Home/Docs/Rules; build verified (see `agents/implementation/tests/plan_09/step_06_menu.md`).  
- Step 6b — Status: Completed (2025-12-23) — Added `/rules` index (TOC) view + `/api/rules` listing; captured real outputs in `agents/implementation/tests/plan_09/step_06b_rules_index.md`.  
- Step 7 — Status: Completed (2025-12-23) — Enabled TOC children for `/api/pages/docs` and created `docs` + `docs/faq` pages for verification; captured output in `agents/implementation/tests/plan_09/step_07_toc.md`.  
- Step 8 — Status: Pending.  

---

## 4. Test Log (auth_curl.sh snapshots)

This section is a lightweight record of the canonical `auth_curl` tests for each step and their latest observed results.  
Use it as you work through the plan; update the “Last result” column when you run the commands locally or in staging.

Step | Scenario | Command (canonical) | Last result / Notes
---- | -------- | ------------------- | -------------------
0 | Smoke: server reachable | `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh get /version` | 2025-12-23: `HTTP/2 200`, JSON includes `buildTag=6728d35-2025-12-22T210016+0000`, `commit=6728d35`
0 | Auth: unauth identity | `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh get /api/me` | 2025-12-23: `HTTP/2 200`, `userId=null` (not logged in)
0 | RBAC: admin guard (unauth) | `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh get /api/admin/moderation/actions` | 2025-12-23: `HTTP/2 401`, `{"error":"unauthorized"}`
0 | Auth: super identity | `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super login && ./scripts/auth_curl.sh --profile super me` | 2025-12-23: `HTTP 200`, `userId=1`, `isSiteAdmin=true`
0 | RBAC: admin guard (super) | `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super get /api/admin/moderation/actions` | 2025-12-23: `HTTP 200`, `{"actions":[]}`
0 | Auth: space_admin identity | `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile space_admin login && ./scripts/auth_curl.sh --profile space_admin me` | 2025-12-23: `HTTP 200`, `userId=6`, `isSiteAdmin=false`
0 | RBAC: admin guard (space_admin) | `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile space_admin get /api/admin/moderation/actions` | 2025-12-23: `HTTP 403`, `{"error":"forbidden"}`
1 | SPA discovery (no API calls) | _N/A — code-only inspection_ | Completed 2025-12-23: routing in `frontend/src/main.tsx`, layout in `frontend/src/ui/Layout.tsx`, menu items in `frontend/src/menu/contexts/*`
2 | API shapes agreed | _N/A — design-only_ | Completed 2025-12-23: `/api/pages/:slugPath` + `/api/rules/:slug` response/error contract
3 | `/api/pages/:slug` happy path | `./scripts/auth_curl.sh get /api/pages/home` | 2025-12-23 (local): `HTTP 200`, returns `{slug,title,html,visibility,layout,updatedAt}`
3 | `/api/pages/:slug` TOC behavior | `./scripts/auth_curl.sh get /api/pages/docs` | 2025-12-23 (local): `HTTP 404`, `{"error":"page_not_found"}` (no `docs` page yet)
3 | `/api/rules/:slug` current + versions | `./scripts/auth_curl.sh get /api/rules/community-guidelines` | 2025-12-23 (local): `HTTP 200`, returns `currentVersion` + `versions[]`
4 | SPA Home fetch | _Navigate to `/` in browser; SPA calls `/api/pages/home`_ | 2025-12-23: SPA components added; full navigation test depends on Step 5 serving SPA shell
4 | SPA page view | _Navigate to `/pages/docs` in browser; SPA calls `/api/pages/docs`_ | 2025-12-23: SPA components added; full navigation test depends on Step 5 serving SPA shell
4 | SPA rule view | _Navigate to `/rules/community-guidelines` in browser; SPA calls `/api/rules/community-guidelines`_ | 2025-12-23: SPA components added; full navigation test depends on Step 5 serving SPA shell
5 | SPA shell for `/pages/:slug` | `curl -sS "$BASE_URL/pages/docs" | rg -n 'id=\"root\"'` | 2025-12-23 (local): match (`agents/implementation/tests/plan_09/step_05_routing.md`)
5 | Historical rule permalink | `curl -sS "$BASE_URL/rules/community-guidelines/v:1" | rg -n 'id=\"root\"'` | 2025-12-23 (local): no match (`agents/implementation/tests/plan_09/step_05_routing.md`)
6 | Menu entry for Docs | _Menu selector → “Info (Pages & Rules)” → “Docs”_ | 2025-12-23: implemented; validate manually in browser
6 | Menu entry for Rules | _Menu selector → “Info (Pages & Rules)” → “Rules”_ | 2025-12-23: implemented; validate manually in browser
6b | Rules index (TOC) | `./scripts/auth_curl.sh get /api/rules` | 2025-12-23 (local): `HTTP 200`, returns `items[]` (`agents/implementation/tests/plan_09/step_06b_rules_index.md`)
7 | TOC children list | `./scripts/auth_curl.sh --profile super get /api/pages/docs` (verify `children[]`) | 2025-12-23 (local): `HTTP 200`, includes `children=[{slug:\"docs/faq\"...}]` (`agents/implementation/tests/plan_09/step_07_toc.md`)
8 | Moderation actions rule URLs | `./scripts/auth_curl.sh get /api/admin/moderation/actions` | Pending
