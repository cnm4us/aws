# Implementation Plan: Space Feed “Pin This Video First” (via `production_ulid`)

## 1. Overview

Goal: When navigating from the Global Feed billboard to a specific Group/Channel, make the *same video* appear first in the destination space feed by “pinning” it at the top of the initial page load (it can still appear again later in the feed).

In scope:
- Add a lightweight “pin” mechanism driven by `production_ulid` (no cursor math / locating position).
- Update the Global Feed “Jump” modal links to include the pin parameter.
- Update the space feed API to optionally inject a pinned item at the top of the first page.

Out of scope:
- True “land at the exact position in feed” behavior.
- Redis-backed feeds, feed ranking, or cursor/offset locate endpoints.
- Any fallback identity (no `upload_id` fallback; pin only when `production_ulid` exists).

Proposed parameter:
- `?pin=<production_ulid>` on the destination space URL (e.g. `/groups/test-group?pin=01KD...`).

---

## 2. Step-by-Step Plan

1. Inventory current navigation + data availability for pinning  
   Status: Completed (2025-12-29)  
   Work:
   - Confirm Global Feed items already carry `publication.production_ulid`.
   - Confirm where Jump modal builds target links and how to pass `production_ulid` into it.
   - Confirm where space feed fetch URL is built (`/api/spaces/:id/feed`) so we can attach `pin` only on the initial request (cursor absent).
   Testing:
   - Canonical (expected): `rg -n "production_ulid|JumpToSpaceModal|/api/spaces/\\$\\{spaceId\\}/feed" frontend/src/app/Feed.tsx frontend/src/app/JumpToSpaceModal.tsx -S` → shows link + fetch locations.  
   - Record actual output: `agents/implementation/tests/plan_19/step_01_inventory.md`  
   Checkpoint: Wait for developer approval before proceeding.

2. Add “pin row” query in feeds repo/service  
   Status: Completed (2025-12-29)  
   Work:
   - Add a feeds repo helper (e.g. `getSpaceFeedPinnedRowByProductionUlid(spaceId, productionUlid, userId)`), using the same join/projection columns as `listSpaceFeedRows`, filtered to:
     - `sp.space_id = ?`
     - `sp.status = 'published'`
     - `sp.published_at IS NOT NULL`
     - `u.status = 'completed'`
     - `p.ulid = ?`
   - Add a feeds service helper that maps the pinned row into the normal feed item DTO shape.
   Testing:
   - Canonical (expected): `npm run build` → succeeds.  
   - Record actual output: `agents/implementation/tests/plan_19/step_02_repo.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Extend `/api/spaces/:id/feed` to support `pin` on the first page  
   Status: Completed (2025-12-29)  
   Work:
   - In `src/routes/spaces.ts`:
     - Parse `pin` from query string as a string (optional).
     - Only apply pinning when `cursor` is absent (first page) to avoid repeating the pin on “load more”.
   - In feeds service:
     - If a pinned item exists:
       - Return it first.
       - Fill the remainder of the page with the normal feed rows (using `limit-1` so total items stays at `limit`).
       - De-dupe by `publication.id` if the pinned item is also present in the normal page.
     - If no pinned item exists: return the normal page unchanged.
   Testing:
   - Canonical (expected):
     - `./scripts/auth_curl.sh --profile super get "/api/feed/global?limit=1"` → capture a `production_ulid` and a destination `spaceId`.  
     - `./scripts/auth_curl.sh --profile super get "/api/spaces/<SPACE_ID>/feed?limit=5&pin=<PRODUCTION_ULID>"` → `HTTP 200` and `items[0].publication.production_ulid == <PRODUCTION_ULID>`.  
   - Record actual output: `agents/implementation/tests/plan_19/step_03_api.md`  
   Checkpoint: Wait for developer approval before proceeding.

4. Update Jump modal links to include `?pin=<production_ulid>`  
   Status: Completed (2025-12-29)  
   Work:
   - Pass `production_ulid` into `JumpToSpaceModal` (from the current Global Feed item).
   - Append `?pin=<production_ulid>` to each destination link only when `production_ulid` is present.
   Testing:
   - Manual: on Global Feed, open Jump modal and confirm links include `?pin=...` (when production ULID exists).  
   - Record notes: `agents/implementation/tests/plan_19/step_04_links.md`  
   Checkpoint: Wait for developer approval before proceeding.

5. Wire the feed fetch to forward `pin` only on initial space feed load  
   Status: Completed (2025-12-29)  
   Work:
   - In `frontend/src/app/Feed.tsx`, when fetching a space feed page:
      - If `cursor` is null and the current URL has `pin=<production_ulid>`, include it in the `/api/spaces/:id/feed` request.
      - Do not include `pin` on “load more” requests (cursor present).
   Testing:
   - Manual: clicking a Jump link into `/groups/:slug?pin=...` should show the pinned video as the first slide in that space.  
   - Record notes: `agents/implementation/tests/plan_19/step_05_ui.md`  
   Checkpoint: Wait for developer approval before proceeding.

6. Build verification  
   Status: Completed (2025-12-29)  
   Work:
   - Ensure `npm run web:build` succeeds.
   Testing:
   - Canonical (expected): `npm run web:build` → success.  
   - Record actual output: `agents/implementation/tests/plan_19/step_06_build.md`  
   Checkpoint: Wait for developer approval before proceeding.
