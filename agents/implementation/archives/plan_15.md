# Implementation Plan: Split Site Admin UI from User SPA + Review Route Rename + Categories Admin

## 1. Overview

Goal: Keep **site_admin** tooling out of the normal user SPA bundle (and ideally not served to non-admins at all), while keeping **space_admin** duties in the standard SPA with clearer naming:
- Site admin console (site_admin only): `/admin/*` (Groups, Channels, Rules, Categories, Cultures, Pages) with a shared slide drawer.
- Space review (pre-publish approval; space_admin): `/space/review/groups`, `/space/review/channels`, and per-space queue at `/spaces/:spaceId/review`.
- Reserve “moderation” for post-publish report/flag triage (future work).

In scope:
- Add `/admin/categories` CRUD (create/update/delete with safe-delete rules).
- Implement a shared admin “drawer” UI for site admin pages.
- Remove site_admin React pages/routes from the user SPA so they don’t contribute to the user bundle.
- Rename the existing “moderation queue” UI/API that is actually review/approval to “review”.

Out of scope (for this plan):
- New post-publish moderation workflows for reports/flags (queues, actions, notifications).
- Major redesign of user navigation / menu system beyond the review route rename.

Assumptions:
- `/admin/*` is guarded by server-side site admin checks (RBAC), independent of front-end routing.
- “Don’t ship site_admin code to normal users” means: not bundled into the user SPA and not accessible as static assets without site_admin.

---

## 2. Step-by-Step Plan

1. Confirm URL + ownership conventions (no code)  
   Status: Completed (2025-12-28)  
   Decisions confirmed:
   - Space review list routes (standard SPA): `/space/review/groups` and `/space/review/channels`.
   - Space review queue route (standard SPA): `/spaces/:spaceId/review` (renamed from “moderation”; UI-only rename).
   - Keep review actions endpoints unchanged (UI rename only):
     - `POST /api/publications/:id/approve`
     - `POST /api/publications/:id/reject`
   - Reserve `/admin/*` for site_admin only; do not use `/admin/*` for space_admin flows.
   - Site_admin global review overview is explicitly deferred to a separate plan.
   Testing:
   - None (decision-only).  
   Checkpoint: Wait for developer approval before proceeding.

2. Add site_admin “drawer” shell for `/admin/*` pages (server-rendered)  
   Status: Completed (2025-12-28)  
   Implement a shared layout wrapper for admin server-rendered pages (currently in `src/routes/pages.ts`) that:
   - Adds a consistent left nav / slide drawer with links: Groups, Channels, Rules, Categories, Cultures, Pages.
   - Works on mobile (drawer toggle) and desktop (sidebar).
   - Highlights active section based on path prefix.
   - Uses a static CSS file under `public/` (reuse `public/admin-nav.css` if appropriate).
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/pages` → `HTTP 200` and HTML includes nav links (e.g., “Categories”).  
   - Record actual output: `agents/implementation/tests/plan_15/step_02_admin_shell.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Implement `/admin/categories` CRUD (server-rendered) with safe delete  
   Status: Completed (2025-12-28)  
   Add site-admin pages in `src/routes/pages.ts` similar to existing `/admin/cultures`:
   - `GET /admin/categories` list categories (name, description, usage counts).
   - `GET /admin/categories/new` + `POST /admin/categories` create.
   - `GET /admin/categories/:id` edit + `POST /admin/categories/:id` update.
   - `POST /admin/categories/:id/delete` delete *only if*:
     - not referenced by `culture_categories.category_id`, and
     - not referenced by `rules.category_id`.
   UX:
   - Show a clear error message when delete is blocked (“Category is used by cultures and/or rules”).
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/categories` → `HTTP 200`.  
   - Canonical (expected): `./scripts/auth_curl.sh --profile space_admin get /admin/categories` → redirect to `/forbidden`.  
   - Record actual output: `agents/implementation/tests/plan_15/step_03_categories_admin.md`  
   Checkpoint: Wait for developer approval before proceeding.

4. Move site_admin Groups/Channels admin UI off the user SPA (server-rendered)  
   Status: Completed (2025-12-28)  
   Replace the current SPA-shell mappings for:
   - `/admin/groups`, `/admin/groups/new`, `/admin/groups/:id`
   - `/admin/channels`, `/admin/channels/new`, `/admin/channels/:id`
   with server-rendered admin pages (in `src/routes/pages.ts`) that cover the minimum site_admin workflows:
   - List groups/channels (name, slug, require-review flag, cultures count).
   - Create group/channel (name + slug; type fixed by section).
   - Edit group/channel basic fields and settings already supported via admin services (name, slug, requireReview, commentsPolicy, cultureIds).
   Notes:
   - Prefer calling the existing site-admin JSON endpoints in `src/routes/admin.ts` (or shared service/repo functions) rather than duplicating SQL, unless the codebase pattern for admin pages is direct DB access.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/groups` → `HTTP 200`.  
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/channels` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_15/step_04_admin_spaces.md`  
   Checkpoint: Wait for developer approval before proceeding.

5. Remove site_admin React routes/components from the user SPA bundle  
   Status: Completed (2025-12-28)  
   Update the user SPA entry routing (currently `frontend/src/main.tsx`, plus any menu/router preload code) to:
   - Remove SPA ownership of `/admin/groups*` and `/admin/channels*` (routes + lazy imports/components), since these are now server-rendered site_admin pages.
   - Keep existing SPA ownership for `/admin/users`, `/admin/settings`, `/admin/dev`, and `/admin/moderation/*` for now (explicitly deferred to the next plan).
   - Keep the standard user SPA focused on user + space-scoped workflows; avoid adding new site_admin features to the user SPA in the meantime.
   Testing:
   - Canonical (expected): `npm run web:build` succeeds.  
   - Canonical (expected): `node -e "console.log('ok')"` (sanity in CI-like env).  
   - Record build output: `agents/implementation/tests/plan_15/step_05_web_build.md`  
   Checkpoint: Wait for developer approval before proceeding.

6. Rename pre-publish “moderation” (review) APIs: add new `/review/*` endpoints and update SPA review page  
   Status: Completed (2025-12-28)  
   Backend:
   - Rename/alias space queue endpoint:
     - New: `GET /api/spaces/:id/review/queue` (space_admin or space_moderator as appropriate).
     - Keep old `GET /api/spaces/:id/moderation/queue` temporarily as an alias during the step (then remove in a later step).
   - Keep approve/reject endpoints unchanged:
     - `POST /api/publications/:id/approve`
     - `POST /api/publications/:id/reject`
     (UI naming and routing changes only.)
   Frontend (standard SPA bundle):
   - Rename the page/component to “Review Queue” and move routing:
     - From `/spaces/:spaceId/moderation` → `/spaces/:spaceId/review`
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile space_admin get /api/spaces/<spaceId>/review/queue` → `HTTP 200` and JSON includes `items[]`.  
   - Record actual output: `agents/implementation/tests/plan_15/step_06_review_queue.md`  
   Checkpoint: Wait for developer approval before proceeding.

7. Replace `/admin/moderation/(groups|channels)` with `/space/review/(groups|channels)` (space_admin)  
   Status: Completed (2025-12-28)  
   Backend:
   - Add space_admin-scoped endpoints to list reviewable spaces with pending counts:
     - `GET /api/space/review/groups`
     - `GET /api/space/review/channels`
   - Each endpoint returns only spaces where the current user can review (space_admin or space_moderator) + pending count of `space_publications.status = 'pending'`.
   Frontend:
   - Replace the existing list pages and menu links:
     - `/admin/moderation/groups` → `/space/review/groups`
     - `/admin/moderation/channels` → `/space/review/channels`
   - Keep these pages in the standard SPA bundle (mobile-friendly).
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile space_admin get /api/space/review/groups` → `HTTP 200` and JSON includes `items[]`.  
   - Canonical (expected): `curl -sS http://localhost:3300/api/space/review/groups` → `HTTP 401` (requires auth).  
   - Record actual output: `agents/implementation/tests/plan_15/step_07_review_overviews.md`  
   Checkpoint: Wait for developer approval before proceeding.

8. Remove old “moderation” route aliases once review routes are live  
   Status: Completed (2025-12-28)  
   Clean up:
   - Removed legacy space_admin review alias: `/api/spaces/:id/moderation/queue` (canonical is `/api/spaces/:id/review/queue`).
   - Removed legacy space_admin page aliases/redirects: `/spaces/:id/moderation`, `/groups/:slug/moderation`, `/channels/:slug/moderation` (canonical is `/spaces/:id/review`).
   - Kept site_admin moderation pages (`/admin/moderation/*`) intact for now (tracked for Plan 16 as `/admin/review/*` vs “moderation” naming cleanup).
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile space_admin get /api/space/review/groups` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_15/step_08_cleanup.md`  
   Checkpoint: Wait for developer approval before proceeding.

---

## 3. Risks / Edge Cases

- Admin page routing ownership: `/admin/*` currently contains server-rendered features (rules/cultures/pages); converting groups/channels/categories to server-rendered avoids mixing SPA ownership and keeps site_admin code out of the user bundle.
- CSRF + forms: server-rendered POSTs must include CSRF token consistently (match existing `/admin/cultures` patterns).
- Category delete correctness: ensure “unused” checks cover both `culture_categories` and `rules` references; provide clear error messaging.
- Permissions: review endpoints must be space-scoped (only spaces the user can review), while site_admin endpoints remain global.

## 4. Open Questions (max 3)

Open: none (resolved in discussion)

---

## 5. Seed Notes for Next Plan (Plan 16)

Do not expand the scope of plan_15 to include these; they are tracked here so we can immediately pick them up next.

- Migrate site_admin Users UI from SPA to `/admin/users*` server-rendered (or a dedicated site_admin React bundle served under `/admin/*`).
  - Inventory current SPA routes/components: `/admin/users`, `/admin/users/new`, `/admin/users/:id`, `/adminx/users*`.
  - Decide canonical site_admin URL set (likely keep `/admin/users*` and drop `/adminx/*`).
  - Ensure drawer shell is used and RBAC remains enforced server-side.

- Migrate site_admin Settings UI from SPA to `/admin/settings` server-rendered (or dedicated site_admin React bundle).
  - Inventory current SPA routes/components: `/admin/settings`, `/adminx/settings`.
  - Wire to existing APIs: `GET/PUT /api/admin/site-settings`.

- Replace `/admin/dev` SPA placeholder with a real site_admin page in `/admin/dev`.
  - Current backend APIs exist: `GET /api/admin/dev/stats`; `POST /api/admin/dev/truncate-content`.
  - Determine intended UX (stats view + “truncate content” danger action) and any guardrails.

- Implement site_admin review UX under `/admin/review/*` (pre-publish approval overview).
  - Current APIs exist: `GET /api/admin/moderation/groups`; `GET /api/admin/moderation/channels` (pending counts).
  - Decide whether to keep `/admin/moderation/*` as alias or reserve it for post-publish “flags moderation”.

- Reconcile naming: reserve “moderation” for post-publish reports/flags triage, and keep “review” for pre-publish approval.
