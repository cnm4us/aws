# Implementation Plan: Assign Cultures to Spaces (Groups/Channels)

## 1. Overview

Goal: Let site admins assign 0..N Cultures to each Space (group/channel) and manage those assignments from the existing SPA admin pages:
- `/admin/groups/:id`
- `/admin/channels/:id`

In scope:
- DB schema to represent Space ↔ Culture assignments (0..N).
- Admin JSON APIs (site-admin only) to:
  - list cultures (for checkbox options)
  - read/update a space’s culture assignments
- SPA updates to `frontend/src/app/AdminSpaceDetail.tsx` to display and save culture checkboxes for both groups and channels.

Out of scope (for this plan):
- End-user flag/report flow and “pick a rule” UI.
- Channel/group admin moderation tools (non-site-admin).
- Evaluating/moderating content based on cultures.

References:
- `src/db.ts` — schema evolution patterns (idempotent, additive).
- `src/routes/admin.ts` — site-admin JSON APIs (`/api/admin/*`).
- `src/features/admin/repo.ts` and `src/features/admin/service.ts` — current `/api/admin/spaces/:id` behavior.
- `frontend/src/app/AdminSpaceDetail.tsx` — SPA admin page for both `/admin/groups/:id` and `/admin/channels/:id`.
- `scripts/auth_curl.sh` — authenticated API testing; log outputs under `agents/implementation/tests/plan_13/`.

---

## 2. Step-by-Step Plan

1. Confirm storage model for Space ↔ Culture (join table vs JSON column)  
   Status: Completed (decision: join table)  
   Decision:
   - Use join table `space_cultures(space_id, culture_id)` for 0..N assignments.
   Testing: none (decision-only).

2. Add schema for Space ↔ Culture assignments  
   Status: Completed (2025-12-27)  
   Implementation (assuming join table):
   - In `src/db.ts`, add:
     - `space_cultures` table:
       - `space_id` (FK → spaces.id)
       - `culture_id` (FK → cultures.id)
       - `created_at`
       - `PRIMARY KEY (space_id, culture_id)`
       - Index on `(culture_id, space_id)` for future reverse lookups (culture → spaces)
     - Best-effort FKs in `try/catch`.
   Testing:
   - Canonical (expected): `BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /admin/cultures` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_13/step_02_schema.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Add admin APIs: list cultures + read/update space cultureIds  
   Status: Completed (2025-12-27)  
   Implementation:
   - In `src/routes/admin.ts` (site-admin only):
     - `GET /api/admin/cultures`:
       - returns `{ cultures: Array<{ id, name, description, categoryCount }> }`
     - Extend `GET /api/admin/spaces/:id` response to include `cultureIds: number[]` (from `space_cultures`).
     - Extend `PUT /api/admin/spaces/:id` to accept optional `cultureIds: number[]`:
       - If omitted: no change.
       - If present (including empty array): replace assignments transactionally.
       - Validate all provided IDs exist in `cultures` before writing.
   - Implement DB read/write helpers in `src/features/admin/repo.ts` + call them from `src/features/admin/service.ts` (keeps patterns consistent with existing admin space logic).
   Testing:
   - Canonical (expected):
     - `./scripts/auth_curl.sh --profile super get /api/admin/cultures` → `HTTP 200` and JSON contains `cultures[]`.
     - `./scripts/auth_curl.sh --profile super get /api/admin/spaces/<spaceId>` → `HTTP 200` and JSON contains `cultureIds`.
     - `./scripts/auth_curl.sh --profile super put /api/admin/spaces/<spaceId> --data '{"cultureIds":[...]}‘` → `HTTP 200`.
   - Record actual output: `agents/implementation/tests/plan_13/step_03_api.md`  
   Checkpoint: Wait for developer approval before proceeding.

4. Add cultures checkboxes to `/admin/groups/:id` and `/admin/channels/:id` (SPA)  
   Status: Completed (2025-12-27)  
   Implementation:
   - In `frontend/src/app/AdminSpaceDetail.tsx`:
     - Fetch `GET /api/admin/cultures` alongside existing loads.
     - Add a “Cultures” section listing all cultures with checkboxes.
     - Initialize selected set from `detail.cultureIds` (from updated space detail API).
     - On “Save Settings”, include `cultureIds` in the PUT body when changed.
     - Keep behavior identical for groups and channels (page parses route to infer kind).
   - Run `npm run web:build` when shipping UI changes.
   Testing:
   - Canonical (expected):
     - API-level (repeatable): update `cultureIds` via PUT and confirm via GET.
     - Manual browser check (admin): load `/admin/groups/:id` and `/admin/channels/:id`, toggle cultures, save, refresh persists.
   - Record actual output/notes: `agents/implementation/tests/plan_13/step_04_spa_ui.md`  
   Checkpoint: Wait for developer approval before proceeding.

---

## 3. Risks / Edge Cases

- “Culture column” ambiguity: ensure we pick one durable representation before writing APIs/UI.
- Empty list semantics: sending `cultureIds: []` must clear assignments (valid state).
- Performance: cultures list is small now; keep API simple; add pagination later only if needed.

## 4. Open Questions (max 3)

Open: none
