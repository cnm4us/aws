# Implementation Plan: Finish Site Admin Console (Users/Settings/Dev/Review) Without Bloated User SPA

## 1. Overview

Goal: Continue the Plan 15 direction by moving remaining **site_admin** features off the normal user SPA bundle into **server-rendered `/admin/*` pages**, while adding a first-cut **site_admin “Review”** surface under `/admin/review/*` (pre-publish approval overview). Keep “moderation” naming reserved for future post-publish reports/flags workflows.

In scope:
- Server-rendered site_admin pages:
  - `/admin/users` + `/admin/users/:id` (replace current SPA ownership)
  - `/admin/settings` (replace current SPA ownership)
  - `/admin/dev` (replace SPA shell placeholder)
  - `/admin/review/groups` + `/admin/review/channels` (site_admin pre-publish review overview)
- Update the existing site_admin drawer nav to include Users/Settings/Dev/Review.
- Remove site_admin React routes for these areas from the user SPA bundle.

Out of scope:
- Splitting the app into multiple Vite bundles (user vs admin vs space console). (Tracked in “Seed Notes for Plan 17”.)
- New post-publish moderation (flags/reports triage) UX under `/admin/moderation/*`.
- Large redesign of UI; focus on functional admin surfaces consistent with current server-rendered admin pages.

Assumptions:
- Server-side RBAC remains the source of truth (site_admin checks in backend routes).
- No legacy/back-compat constraints for old URLs (development mode).

---

## 2. Step-by-Step Plan

1. Inventory current site_admin SPA surfaces and APIs  
   Status: Completed (2025-12-28)  
   Work:
   - Enumerate existing SPA routes/components for:
     - `/admin/users*`, `/admin/settings*`, `/admin/dev`
     - `/admin/moderation/groups`, `/admin/moderation/channels` (current site_admin pre-publish overviews)
   - Enumerate backend APIs that power them (admin routes under `/api/admin/*`).
   - Decide the minimum parity required for server-rendered replacements in Steps 2–5.
   Testing:
   - Canonical (expected): `rg -n "/admin/users|/admin/settings|/admin/dev|/admin/moderation" frontend/src -S` → shows current owners.  
   - Record actual output: `agents/implementation/tests/plan_16/step_01_inventory.md`  
   Checkpoint: Wait for developer approval before proceeding.

2. Implement server-rendered `/admin/users` (list + basic filtering)  
   Status: Completed (2025-12-28)  
   Work:
   - Add `/admin/users` server-rendered page using the shared admin shell:
     - Table: id, display name, email, roles summary, created/last seen if available.
     - Basic filters: `?q=` (email/display name), and/or `?role=` if feasible.
     - Links to `/admin/users/:id`.
   - Ensure non-site_admin is blocked (redirect to `/forbidden` like other admin pages).
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/users` → `HTTP 200` and HTML contains “Users” + drawer.  
   - Canonical (expected): `./scripts/auth_curl.sh --profile space_admin get /admin/users` → redirect to `/forbidden` (or `403` depending on current pattern).  
   - Record actual output: `agents/implementation/tests/plan_16/step_02_admin_users_list.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Implement server-rendered `/admin/users/:id` (view/edit moderation/admin controls)  
   Status: Completed (2025-12-28)  
   Work:
   - Add `/admin/users/:id` server-rendered page with:
     - User identity summary (id, email, display name).
     - Current roles/flags relevant to site_admin moderation tools (matching existing API capabilities).
     - Save action (POST) with CSRF protection.
   - Preserve existing backend behavior; only move UI off SPA.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/users/<id>` → `HTTP 200`.  
   - Canonical (expected): `curl -sS -o /dev/null -w "%{http_code}" -b .tmp/auth_cookies.super.txt -X POST --data-urlencode "csrf=<token>" --data-urlencode "roles=site_member" http://localhost:3300/admin/users/<id>/site-roles` → `302`.  
   - Record actual output: `agents/implementation/tests/plan_16/step_03_admin_user_detail.md`  
   Checkpoint: Wait for developer approval before proceeding.

4. Implement server-rendered `/admin/settings` (site settings view/edit)  
   Status: Completed (2025-12-28)  
   Work:
   - Replace SPA ownership of `/admin/settings` with a server-rendered stub page:
     - Message: settings UI is deferred/unknown usage; tracked for follow-up.
     - Link to relevant docs or note the intended future direction (admin SPA bundle).
   - Do not introduce new settings behavior in Plan 16.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/settings` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_16/step_04_admin_settings.md`  
   Checkpoint: Wait for developer approval before proceeding.

5. Implement server-rendered `/admin/dev` (stats + danger action)  
   Status: Completed (2025-12-28)  
   Work:
   - Replace the SPA shell at `/admin/dev` with a server-rendered admin page:
     - Shows current dev stats (from existing API).
     - Provides a guarded “truncate content” (or equivalent) action if it exists today:
       - Requires explicit confirmation input and CSRF token.
       - Clear success/failure messaging.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/dev` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_16/step_05_admin_dev.md`  
   Checkpoint: Wait for developer approval before proceeding.

6. Add site_admin pre-publish approval overview under `/admin/review/*`  
   Status: Completed (2025-12-28)  
   Work:
   - Implement server-rendered landing page: `/admin/review`
     - Entry points/tiles: Global Feed, Personal Spaces, Groups, Channels.
   - Implement server-rendered queue page for Global Feed:
     - `/admin/review/global` shows all videos pending review for the Global Feed space.
   - Approve/reject behavior:
     - Use existing review actions (no endpoint renames).
     - If `/api/publications/:id/approve|reject` does not accept form POSTs, add server-side POST handlers under `/admin/review/*` that call the same underlying services.
   - Naming/aliasing:
     - Canonical: `/admin/review/*`.
     - Keep `/admin/moderation/*` temporarily (either unchanged for now, or redirect to `/admin/review/*`) until post-publish moderation is implemented.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/review` → `HTTP 200`.  
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/review/global` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_16/step_06_admin_review_global.md`  
   Checkpoint: Wait for developer approval before proceeding.

7. Implement Personal Spaces review lists + per-space queue pages  
   Status: Completed (2025-12-28)  
   Work:
   - `/admin/review/personal`:
     - Lists personal spaces and the count of pending items for each.
     - Allows clicking a personal space to open its queue.
   - `/admin/review/personal/:spaceId`:
     - Shows the queue for that personal space (pending items).
   - Default list behavior:
     - Show all personal spaces (including `0` pending), but support `?q=` search and pagination if needed.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/review/personal` → `HTTP 200`.  
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/review/personal/<spaceId>` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_16/step_07_admin_review_personal.md`  
   Checkpoint: Wait for developer approval before proceeding.

8. Implement Groups/Channels review lists + per-space queue pages  
   Status: Completed (2025-12-28)  
   Work:
   - `/admin/review/groups` and `/admin/review/channels`:
     - Lists all groups/channels and pending counts (with `?q=` search).
   - `/admin/review/groups/:spaceId` and `/admin/review/channels/:spaceId`:
     - Shows queue for the selected group/channel.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/review/groups` → `HTTP 200`.  
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/review/channels` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_16/step_08_admin_review_spaces.md`  
   Checkpoint: Wait for developer approval before proceeding.

9. Remove site_admin SPA ownership for moved routes and rebuild user bundle  
   Status: Completed (2025-12-28)  
   Work:
   - Remove (or hard-disable) SPA routing/entry logic for:
     - `/admin/users*`, `/admin/settings*`, `/admin/dev`, and any `/admin/*` paths that are now server-rendered for review.
   - Ensure `src/routes/pages.ts` serves server-rendered HTML for these routes (no longer SPA shell).
   - Run `npm run web:build` and confirm the user bundle doesn’t include the removed admin components.
   Testing:
   - Canonical (expected): `npm run web:build` → success.  
   - Canonical (expected): `rg -n "AdminUsers|AdminSiteSettings" public/app/assets -S` → no matches.  
   - Record actual output: `agents/implementation/tests/plan_16/step_09_web_build.md`  
   Checkpoint: Wait for developer approval before proceeding.

10. Update admin drawer navigation + finalize docs  
   Status: Completed (2025-12-28)  
   Work:
   - Add nav links to the admin drawer (Users, Settings, Dev, Review).
   - Ensure active highlighting works for new sections.
   - Update `/README.md` “Useful Pages” section if needed (only what changed).
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /admin/users` → HTML drawer includes Users/Settings/Dev/Review.  
   - Record actual output: `agents/implementation/tests/plan_16/step_10_nav.md`  
   Checkpoint: Wait for developer approval before proceeding.

---

## 3. Risks / Edge Cases

- `/admin/users` parity: the SPA may include advanced controls not yet mapped in server-rendered UI; Step 1 inventory should define the “minimum required” set.
- Dangerous dev actions: `/admin/dev` destructive endpoints must have strong guardrails (confirm text + CSRF) even in development.
- Naming collision: keeping `/admin/moderation/*` for pre-publish review conflicts with the future meaning of “moderation” (flags). Step 6 should make `/admin/review/*` canonical early.

---

## 4. Open Questions (max 3)

Resolved for Plan 16:
1. `/admin/users/:id` must support: site_admin toggle, ban/suspend, role edits, and space role edits.
2. `/admin/settings` is stubbed with a “deferred” message; revisit later.
3. `/admin/review/*` must support review/approval for: Global Feed, Personal Spaces, Groups, Channels, with list + per-space queue pages.

---

## 5. Seed Notes for Plan 17 (Bundle Splits: user vs admin vs space console)

If you decide to proceed with separate SPA bundles:
- Build outputs:
  - User app → `public/app/*` (current)
  - Site admin app → `public/admin-app/*` served for `/admin/*`
  - Space console app → `public/spaces-app/*` served for `/spaces/*` and `/space/*`
- Server serves different `index.html` per prefix and disables “SPA fallback” crossover.
- User app should avoid prefetching `/admin/*` and `/spaces/*` bundles (no hover-prefetch; full-page navigation).
