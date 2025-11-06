Handoff 12

Priority Backlog (Refactor Objectives)
- Objective:
  - Organize code to facilitate adding new features and extending existing ones quickly.
  - Organize code so it’s optimized for agent work: consistent patterns, thin routes, typed services, standard validation and errors.
- Instructions:
  - Maintain this Priority Backlog at the top of each Handoff_N.md.
  - Copy this section forward to Handoff_{N+1}.md at the start of a new thread and update statuses as items complete or are added.
  - Use P1 for highest-impact foundation items; P2 for high-value follow‑ups; P3 for structural polish.

- P1 (foundation, highest impact)
  - [x] Modularize Admin (roles, users, spaces, site settings, capabilities, members/invitations, dev utils) — completed
  - [x] Add centralized DomainError middleware and register globally — completed
  - [x] Add Zod validation to admin routes — completed
  - [x] Add Zod + middleware cleanup to publications, productions, spaces routes — completed (feeds endpoints left as‑is)
  - [ ] Replace remaining permission helpers/strings with PERM and service checks (e.g., remove ensurePermission usage in routes/spaces.ts)
    - [x] Remove legacy ensurePermission in routes/spaces.ts; rely on service checks
    - [ ] Convert spaces feed endpoints to next(err) and/or move remaining DB logic behind services while preserving shapes

- P2 (high‑value follow‑ups)
  - [ ] DTO typing + mapping: introduce DTO types per feature and centralize mapping in services or small mappers; standardize pagination shapes
  - [ ] Pagination helpers adoption across lists (clampLimit, parse*Cursor) where missing
  - [ ] Deprecate legacy /api/publish in favor of POST /api/productions; document deprecation window; keep compatibility
  - [ ] Document and (optionally) relocate enhanceUploadRow with explicit types (core or uploads util)
  - [ ] Docs refresh (docs/API.md, docs/Architecture.md) for features/{repo,service}, Zod use, error middleware, admin structure

- P3 (structural polish)
  - [ ] Feature surface cleanup: add index.ts per feature to simplify imports and exports
  - [ ] Error code catalog per feature to reduce ad‑hoc error strings
  - [ ] Remove dead code (e.g., empty src/models/), stale helpers/imports

Summary
- New thread created from agents README. Goal: implement universal menus and lazy loading in discrete, testable steps that keep the site fully functional at each checkpoint.

Decisions (carried + new)
- Adopt feature‑module service/repo pattern for endpoints; preserve response shapes and map errors at route layer.
- Use PERM constants (`src/security/perm.ts`) across modules; remove string literal permission checks.
- Keep Global and Space feeds; legacy uploads‑based feed remains removed.
- Poster URLs derived via upload enhancement (`enhanceUploadRow`) with future relocation TBD.
- Client SPA currently selects a page by pathname in `frontend/src/main.tsx` (no React Router). We will introduce lazy loading and a lightweight shell with minimal risk, preserving URLs.

Changes Since Last
- Affects: frontend/src/app/Feed.tsx; frontend/src/ui/SharedNav.tsx; frontend/src/ui/Layout.tsx; frontend/src/main.tsx
  ; public/js/universal-nav.js; public/admin-*.html; public/space-*.html
  ; frontend/src/ui/Skeletons.tsx
  ; frontend/src/app/AdminUsers.tsx; frontend/src/app/AdminUser.tsx; src/routes/pages.ts
  ; frontend/src/app/AdminSiteSettings.tsx
- Routes: none
- DB: none
- Flags: none

Refactor Plan — Universal Menus + Lazy Loading
- Pre‑flight (validated in Handoff_11):
  - SPA shell loads for `/, /uploads, /productions, /publish` (direct reload OK).
  - Feed cleans up media and observers on route change; iOS uses native HLS; Chrome unlock respected.

- Phase 1 — App Shell (menu extraction) [Step 1]
  - Extract the drawer/nav UI from `Feed.tsx` into a reusable `SharedNav` component (no behavior change).
  - Keep the existing page selection logic in `frontend/src/main.tsx` (no router yet).
  - Render `SharedNav` inside Feed to prove parity; do not add it to other pages yet.

- Phase 2 — Universal Menu Wrapper [Step 2]
  - Introduce a lightweight `Layout` wrapper in `main.tsx` that renders `SharedNav` plus the selected page component.
  - Ensure `/`, `/uploads`, `/productions`, `/publish` all show the same menu; preserve current URLs and behavior.

- Phase 3 — Lazy Loading [Step 3]
  - Convert page components to `React.lazy()` with `<Suspense>` skeletons; keep `main.tsx`’s pathname switch to avoid router churn.
  - Verify chunks are split: feed (hls.js) isolated; other pages load on demand.

- Phase 4 — Preload polish [Step 4]
  - Add small hover/idle preloading helpers for likely next pages.
  - Ensure leaving the feed stops all media/network activity; returning restores position.

Acceptance Criteria — Step 1 (App Shell extraction)
- No visual or behavioral change on `/` (Feed) other than code organization.
- `SharedNav` renders identically to prior in‑page nav; drawer open/close, space switcher, and links behave the same.
- Build passes and site functions as before on `/` and other pages.

Prepared Commit Message — Step 1 (completed)
Subject: refactor(frontend): extract SharedNav from Feed for universal menu foundation

Context:
- Prepare for universal menus across pages by extracting the existing drawer/nav from `Feed.tsx` into a reusable component without changing behavior.

Approach:
- Moved nav markup/logic to `frontend/src/ui/SharedNav.tsx` and wired it back into `Feed`.
- No changes to routing or other pages; `main.tsx` remains path‑switch based.

Impact:
- No user‑visible changes; sets the foundation for a universal menu wrapper in the next step.

Tests:
- Manual smoke: open `/` and exercise the menu (open/close, space switcher, links). Ensure feed video unlock still works.

Meta:
- Affects: frontend/src/app/Feed.tsx; frontend/src/ui/SharedNav.tsx; frontend/src/main.tsx
- Routes: none
- DB: none
- Flags: none

- Thread Plan (subset of Backlog)
- [x] Step 1 — Extract SharedNav from Feed (Phase 1)
- [x] Step 2 — Add Layout wrapper to show SharedNav on all SPA pages (Phase 2)
- [x] Step 3 — Lazy‑load page components with Suspense (Phase 3)
- [x] Step 4 — Preload helpers and cleanup verification (Phase 4)
- [x] Bridge — Add universal nav to static admin/space pages
- [x] Admin Users (SPA beta) — add /adminx/users list (read-only)
- [x] Admin User Detail (SPA beta) — add /adminx/users/:id (read-only)
- [x] Admin User (SPA beta) — edit site roles and capabilities
- [x] Admin User (SPA beta) — edit profile fields (email, displayName, phone, orgId, verificationLevel, kycStatus, password)
 - [x] Admin Site Settings (SPA beta) — read/edit toggles at /adminx/settings

Prepared Commit Message — Nav Bridge (ready to paste)
Subject: feat(ui): add universal nav bridge to static admin and space pages

Description:
- Adds lightweight `public/js/universal-nav.js` that injects top buttons, center label, backdrop, and drawer with login/logout and links.
- Wires the script into `public/admin-*.html` and `public/space-*.html`. Space switcher directs to `/` (Feed) for switching.
- Mirrors SPA menu pattern without altering backend; ensures consistent navigation experience on static pages.

Keywords:
layout, routing, performance

Prepared Commit Message — Route Skeletons (ready to paste)
Subject: style(ui): add route-specific Suspense skeletons for non-feed pages

Description:
- Introduces lightweight skeletons for Uploads, UploadNew, Productions, and Publish in `frontend/src/ui/Skeletons.tsx`.
- Replaces generic Suspense fallbacks in `frontend/src/main.tsx` to show per-page placeholders during lazy load.
- Keeps Layout-driven universal menu visible while content loads; no behavioral changes.

Keywords:
layout, performance, loading-state

Prepared Commit Message — Admin Users (SPA beta) (ready to paste)
Subject: feat(ui): add SPA Admin Users list at /adminx/users (beta)

Description:
- Adds `frontend/src/app/AdminUsers.tsx` to list users via `/api/admin/users` with search and a link to legacy details.
- Wires new SPA routes guarded for site admins: `/adminx/users` (and placeholder `/adminx/users/:id`) to `public/app/index.html`.
- Keeps legacy static admin pages intact; this is a parallel beta route.

Keywords:
ui, admin, routing, layout

Prepared Commit Message — Admin User Detail (SPA beta) (ready to paste)
Subject: feat(ui): add SPA Admin User detail at /adminx/users/:id (read-only)

Description:
- Adds `frontend/src/app/AdminUser.tsx` showing basic profile, verification, capabilities, site roles, and space roles.
- Extends path switch to render the detail page when the path matches `/adminx/users/:id`.
- Keeps links to legacy edit pages for now; no backend changes.

Keywords:
ui, admin, routing, layout

Prepared Commit Message — Admin User (SPA beta) roles/capabilities (ready to paste)
Subject: feat(ui): editable site roles and capabilities in SPA Admin User

Description:
- Enhances `frontend/src/app/AdminUser.tsx` to edit site roles (via `/api/admin/users/:id/roles`) and user capabilities (via `/api/admin/users/:id/capabilities`).
- Fetches role catalog from `/api/admin/roles` and filters site-scoped roles; adds checkbox UI with Save.
- Adds tri-state selects for capabilities (default/allow/deny) with Save; includes CSRF header.
- Updates list page to link to SPA detail.

Keywords:
ui, admin, routing, layout, state, props

Prepared Commit Message — Admin User (SPA beta) profile edits (ready to paste)
Subject: feat(ui): editable profile fields in SPA Admin User

Description:
- Adds profile form to `frontend/src/app/AdminUser.tsx` for email, display name, phone, orgId, verification level, KYC status, and optional password.
- Saves changes to `/api/admin/users/:id` via PUT with CSRF header; only changed fields are sent; updates local baseline on success.
- Keeps roles/capabilities editing from prior step; read-only sections remain for meta and space roles.

Keywords:
ui, admin, routing, layout, state, props, forms

Prepared Commit Message — Admin Site Settings (SPA beta) (ready to paste)
Subject: feat(ui): add SPA Admin Site Settings with editable toggles

Description:
- Adds `frontend/src/app/AdminSiteSettings.tsx` to view and update global flags via `/api/admin/site-settings` (GET/PUT).
- Wires `/adminx/settings` to SPA shell under site-admin guard and adds lazy-loaded route in `frontend/src/main.tsx`.
- Provides Save with CSRF header and simple “Saved/Failed” feedback; keeps legacy page available at /admin/settings.

Keywords:
ui, admin, routing, layout, state, props, forms

Prepared Commit Message — Step 4 (completed)
Subject: perf(frontend): add hover/idle prefetch for lazy routes; wire SharedNav prefetch

Context:
- Improve perceived navigation speed for common flows by preloading small route chunks on hover and during idle time.

Approach:
- Introduced `frontend/src/ui/routes.ts` with shared dynamic import loaders and a `prefetchForHref` helper.
- Updated `SharedNav` to accept optional `onPrefetch(href)` and trigger on hover/focus of nav links.
- Passed `onPrefetch` from `Feed` and `Layout` using `prefetchForHref`.
- Added idle prefetch in `frontend/src/main.tsx` to warm Uploads/Productions/Publish depending on the current page.

Impact:
- Faster first paint when navigating from Feed to Uploads (and related pages). No behavior change.

Tests:
- Built with `npm run web:build:scoped`; manual hover checks show background fetch of small chunks.

Meta:
- Affects: frontend/src/ui/routes.ts; frontend/src/ui/SharedNav.tsx; frontend/src/app/Feed.tsx; frontend/src/ui/Layout.tsx; frontend/src/main.tsx
  ; public/js/universal-nav.js; public/admin-*.html; public/space-*.html
- Routes: none
- DB: none
- Flags: none

Prepared Commit Message — Step 3 (completed)
Subject: perf(frontend): lazy‑load SPA pages with Suspense; isolate Feed chunk

Context:
- Reduce initial JS and defer heavy code (hls.js) until the Feed is visited while keeping current, path-based routing.

Approach:
- Switched `frontend/src/main.tsx` to `React.lazy()` for Feed, Uploads, UploadNew, Productions, and Publish.
- Wrapped lazy pages in `<Suspense>` with lightweight skeleton fallbacks; Feed uses a fullscreen fallback.
- Kept `Layout` wrapper for non-Feed routes so the universal menu shows while content loads.

Impact:
- Code-split output verified under `public/app/assets`: Feed builds as a large, separate chunk; other pages are small, on-demand chunks. No behavioral change.

Tests:
- Built via `npm run web:build:scoped`. Manual smoke for `/`, `/uploads`, `/uploads/new`, `/productions`, `/publish`.

Meta:
- Affects: frontend/src/main.tsx
- Routes: none
- DB: none
- Flags: none

Prepared Commit Message — Step 2 (ready to paste)
Subject: feat(frontend): add Layout wrapper to render SharedNav on non-feed pages

Context:
- Provide a universal menu across SPA pages while preserving existing URLs and the Feed’s behavior.

Approach:
- Added `frontend/src/ui/Layout.tsx` using `SharedNav` and wrapped non-feed pages via `frontend/src/main.tsx`.
- Feed continues to render its own SharedNav to avoid duplication and preserve space switching behavior.
- Layout performs a lightweight `/api/me` fetch for LOGIN/LOGOUT state and hides the Feed-only toggle.

Impact:
- `/uploads`, `/uploads/new`, `/productions`, and `/publish` now show the universal menu. Feed remains unchanged.

Tests:
- Build passes; manual smoke on non-feed routes verifies drawer open/close, login link, and no regression on Feed.

Meta:
- Affects: frontend/src/ui/Layout.tsx; frontend/src/ui/SharedNav.tsx; frontend/src/main.tsx
- Routes: none
- DB: none
- Flags: none

Work Log
- 2025-11-06T00:00Z — Initialized Handoff_12 with discrete plan for universal menus + lazy loading; acceptance for Step 1 defined.

Artifacts
<!-- none -->
