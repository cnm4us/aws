# Implementation Plan: Space Console Split (`/space/*`, `/spaces/*`) Without Shipping To Normal Users

## 1. Overview

Goal: Keep **space console** functionality out of the normal user feed SPA bundle by serving it separately under `/space/*` and `/spaces/*`, while keeping `/admin/*` reserved for site_admin.

In scope:
- Feed SPA changes:
  - Remove space console routes/components from the normal user bundle (so they’re not shipped to normal users).
  - Replace the current space-console selectors with jump links to `/space/admin` and `/space/moderation`, shown only when the user has space roles.
- Space console pages (served separately):
  - `/space/admin` landing (links to group/channel admin, review, moderation)
  - `/space/moderation` landing (stubs for now)
  - Future-friendly subroutes under `/space/admin/*`, `/space/review/*`, `/space/moderation/*` (implementation sequence below)

Out of scope:
- Implementing the full post-publish moderation (flags/reports) workflow (beyond stub pages).
- Major redesign of space admin UX; focus on moving code out of the normal user bundle first.

Key constraint:
- Jump links alone are not enough: if space-console React modules are still imported from `frontend/src/main.tsx`, they still ship in `public/app/assets/*`. This plan removes those imports and serves space console pages separately.

---

## 2. Route Taxonomy (Recommended)

- Site admin: `/admin/*` (site_admin only; server-rendered / separate bundle later)
- Space console:
  - Configuration/management: `/space/admin/*` (space_admin only)
  - Pre-publish approval: `/space/review/*` (space_admin + space_moderator)
  - Post-publish flags/reports: `/space/moderation/*` (space_moderator + optionally space_admin)

Notes:
- Prefer **functional prefixes** (`review`, `moderation`) rather than role prefixes (`moderator`) to avoid duplicating UX.
- Treat any prior/accidental `/space/moderator/*` as a redirect alias to `/space/moderation/*`.

---

## 3. Step-by-Step Plan

1. Inventory current space console SPA ownership + bundle contents  
   Status: Completed (2025-12-29)  
   Work:
   - Confirm all routes/components currently owned by the normal feed SPA that we want to move out:
     - `/space/review/*`
     - `/spaces/:id/admin/*`
     - `/spaces/:id/review`
   - Identify which of those can remain React (but moved to a space-console bundle) vs which should be server-rendered first.
   Testing:
   - Canonical (expected): `rg -n "/space/review|/spaces/:id/admin|/spaces/:id/review" frontend/src -S` → shows current owners.  
   - Record actual output: `agents/implementation/tests/plan_17/step_01_inventory.md`  
   Checkpoint: Wait for developer approval before proceeding.

2. Create a separate Space Console frontend build (space bundle)  
   Status: Completed (2025-12-29)  
   Work:
   - Add a new Vite entrypoint (or build target) for the space console:
     - Output directory (suggested): `public/space-app/*`
     - Includes space-admin + review + moderation pages (React is fine here; it’s not shipped to normal users).
   - Keep the existing feed app output unchanged under `public/app/*`.
   Testing:
   - Canonical (expected): `npm run web:build` (or a new `npm run space:web:build`) → success and emits `public/space-app/*`.  
   - Record actual output: `agents/implementation/tests/plan_17/step_02_space_build.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Serve the space bundle for `/space/*` and `/spaces/*` routes  
   Status: Completed (2025-12-29)  
   Work:
   - Update backend routing so requests under `/space/*` and `/spaces/*` serve `space-app/index.html` instead of the normal feed app `public/app/index.html`.
   - Keep RBAC enforced server-side using existing middleware (`requireSpaceAdminPage`, `requireSpaceModeratorPage`), applied to the relevant routes.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile space_admin get /spaces/16/admin` → `HTTP 200` and serves `space-app` HTML.  
   - Canonical (expected): `./scripts/auth_curl.sh --profile normal_user get /spaces/16/admin` → forbidden/redirect.  
   - Record actual output: `agents/implementation/tests/plan_17/step_03_space_routing.md`  
   Checkpoint: Wait for developer approval before proceeding.

4. Implement `/space/admin` and `/space/moderation` landings (space bundle)  
   Status: Completed (2025-12-29)  
   Work:
   - Add `/space/admin`:
     - Links to `/space/admin/groups` and `/space/admin/channels`
     - Links to `/space/review/groups` and `/space/review/channels`
     - Links to `/space/moderation/groups` and `/space/moderation/channels`
   - Add `/space/moderation` landing (stubs; copy can explain “coming soon: flags/reports, analytics”).
   - Ensure the space bundle renders the existing space pages that are now served under `/spaces/:id/admin/*`, `/spaces/:id/review`, and `/space/review/*`.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile space_admin get /space/admin` → `HTTP 200`.  
   - Canonical (expected): `./scripts/auth_curl.sh --profile space_moderator get /space/moderation` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_17/step_04_space_landings.md`  
   Checkpoint: Wait for developer approval before proceeding.

5. Move existing space-admin/review React routes from feed app → space app  
   Status: Completed (2025-12-29)  
   Work:
   - Remove from the normal feed SPA entrypoint:
     - `/space/review/groups`, `/space/review/channels`
     - `/spaces/:id/admin/*`
     - `/spaces/:id/review`
   - Re-home those route handlers/components in the space bundle.
   - Ensure the normal feed bundle no longer includes these modules.
   Testing:
   - Canonical (expected): `npm run web:build` → success.  
   - Canonical (expected): `rg -n \"SpaceMembers|SpaceReview\" public/app/assets -S` → no matches.  
   - Record actual output: `agents/implementation/tests/plan_17/step_05_bundle_verify.md`  
   Checkpoint: Wait for developer approval before proceeding.

6. Add space-role capability flags to `/api/me` for menu gating  
   Status: Completed (2025-12-29)  
   Work:
   - Extend `/api/me` response to include booleans (or counts) derived from memberships/roles:
     - `hasAnySpaceAdmin`
     - `hasAnySpaceModerator` (should be true for space_moderator or space_admin, per requirements)
   - Keep authorization logic server-side; these flags are purely for UI gating.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile space_admin get /api/me` → `HTTP 200` and JSON contains `hasAnySpaceAdmin: true`.  
   - Canonical (expected): `./scripts/auth_curl.sh --profile space_moderator get /api/me` → `HTTP 200` and JSON contains `hasAnySpaceModerator: true`.  
   - Record actual output: `agents/implementation/tests/plan_17/step_06_api_me_flags.md`  
   Checkpoint: Wait for developer approval before proceeding.

7. Update the normal feed SPA menu to link out to the space console (no prefetch)  
   Status: Completed (2025-12-29)  
   Work:
   - Use `/api/me` flags to conditionally render plain links:
     - If `hasAnySpaceAdmin`: show “Space Admin” → `/space/admin`
     - If `hasAnySpaceModerator`: show “Space Moderation” → `/space/moderation`
   - Ensure these links do not trigger SPA prefetching of `/space/*` or `/spaces/*`.
   Testing:
   - Canonical (expected): `npm run web:build` → success.  
   - Manual (expected): menu items appear only for accounts with space roles and navigate via full page load.  
   - Record notes: `agents/implementation/tests/plan_17/step_07_menu.md`  
   Checkpoint: Wait for developer approval before proceeding.

8. Add redirect aliases (optional)  
   Status: Pending  
   Work:
   - Redirect convenience paths:
     - `/space/moderator/*` → `/space/moderation/*`
     - `/space/admin/review/*` → `/space/review/*` (if we ever link it)
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile space_admin --include get /space/moderator/groups` → `HTTP 302` + `Location: /space/moderation/groups`.  
   - Record actual output: `agents/implementation/tests/plan_17/step_08_redirects.md`  
   Checkpoint: Wait for developer approval before proceeding.

9. Documentation pass  
   Status: Completed (2025-12-29)  
   Work:
   - Update `/README.md` Useful Pages:
     - `/space/admin` and `/space/moderation`
     - Any other finalized space-console routes (as implemented)
   Testing:
   - None (doc-only).  
   Checkpoint: Wait for developer approval before proceeding.
