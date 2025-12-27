# Implementation Plan: Cultures Admin + Category Assignment (Phase 1)

## 1. Overview

Goal: Add an admin UI at `/admin/cultures` that lets site admins create “Cultures” (name + description) and assign 0..N existing rule categories to each culture.

In scope:
- DB schema for `cultures` and `culture_categories` (many-to-many with `rule_categories`).
- Server-rendered admin pages (NOT part of the user SPA bundle):
  - List cultures + create culture
  - Culture detail/edit page with category assignment checkboxes
  - Delete culture action (admin-only; blocked if in use)
- Server-side guards consistent with existing `/admin/*` (site admin only).

Out of scope (for this plan):
- Any changes to the user-facing SPA bundle (`frontend/*`, `public/app/*`).
- Associating cultures to channels/groups/spaces.
- User flag/report UI and end-user rule picking UX.
- Channel/group admin moderation UIs.

References:
- `src/db.ts` — schema creation/upgrade pattern (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- `src/routes/pages.ts` — existing admin UIs for pages/rules (server-rendered forms + CSRF + RBAC; not in SPA).
- `scripts/auth_curl.sh` — authenticated curl tests; log outputs under `agents/implementation/tests/plan_12/`.
- `agents/db_access.md` — destructive DB ops require explicit approval.

---

## 2. Step-by-Step Plan

1. Add schema: `cultures` + `culture_categories` join table  
   Status: Completed (2025-12-27)  
   Implementation:
   - In `src/db.ts` add:
     - `cultures` table:
       - `id` (PK)
       - `name` (unique, required)
       - `description` (TEXT NULL)
       - `created_at`, `updated_at`
     - `culture_categories` join table:
       - `culture_id` (FK → cultures.id)
       - `category_id` (FK → rule_categories.id)
       - `created_at`
       - `PRIMARY KEY (culture_id, category_id)` (prevents duplicates)
       - Index on `(category_id, culture_id)` for reverse lookups (future channel/group queries)
   - No destructive changes; additive only.
   Testing:
   - Canonical (expected): `BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /admin/rules` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_12/step_01_schema.md`  
   Checkpoint: Wait for developer approval before proceeding.

2. Add `/admin/cultures` list + create culture form  
   Status: Completed (2025-12-27)  
   Implementation:
   - In `src/routes/pages.ts` add:
     - `GET /admin/cultures`:
       - list cultures (name, updated_at)
       - link to detail page `/admin/cultures/:id`
       - “New culture” link
     - `GET /admin/cultures/new`:
       - form fields: name, description
     - `POST /admin/cultures`:
       - create culture
       - handle duplicate name with a user-friendly error
   - Use the same CSRF and server-rendered style patterns as `/admin/rules`.
   Testing:
   - Canonical (expected):
     - `./scripts/auth_curl.sh --profile super get /admin/cultures` → `HTTP 200`
     - `./scripts/auth_curl.sh --profile super get /admin/cultures/new` → `HTTP 200`
   - Record actual output: `agents/implementation/tests/plan_12/step_02_admin_list_create.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Add culture detail page with category assignments  
   Status: Completed (2025-12-27)  
   Implementation:
   - In `src/routes/pages.ts` add:
     - `GET /admin/cultures/:id`:
       - show culture name + description (editable)
       - list all `rule_categories` with checkboxes
       - pre-check categories currently assigned via `culture_categories`
     - `POST /admin/cultures/:id`:
       - update name/description
       - replace category assignments based on submitted checkbox set:
         - insert missing pairs
         - delete removed pairs
       - use a transaction
   - UI behavior:
     - “Save” button; redirect back with `?notice=...`.
     - If no categories selected, store zero rows (valid state).
   Testing:
   - Canonical (expected):
     - Create a culture, then:
       - `./scripts/auth_curl.sh --profile super get /admin/cultures/:id` → `HTTP 200`
       - `./scripts/auth_curl.sh --profile super post /admin/cultures/:id -d "name=...&categoryIds=..."` → `HTTP 302`
   - Record actual output: `agents/implementation/tests/plan_12/step_03_assign_categories.md`  
   Checkpoint: Wait for developer approval before proceeding.

4. Add delete culture (admin-only; blocked if in use)  
   Status: Completed (2025-12-27)  
   Implementation:
   - In `src/routes/pages.ts` add:
     - `POST /admin/cultures/:id/delete`:
       - Refuse deletion if any associations exist:
         - For now: any rows in `culture_categories` for that culture.
         - (Future: also check “space ↔ cultures” join once implemented.)
       - If blocked: redirect back to `/admin/cultures/:id?error=...`.
       - If allowed: delete the culture and redirect to `/admin/cultures?notice=...`.
       - Use a transaction.
   - In the culture detail page, add a “Delete culture” button:
     - Only show if there are zero assigned categories (nice UX), but still enforce on server.
     - Confirm dialog text: “Delete culture ‘<name>’? This cannot be undone.”
   Testing:
   - Canonical (expected):
     - With at least 1 assigned category: `./scripts/auth_curl.sh --profile super post /admin/cultures/:id/delete` → `HTTP 302` and culture still exists.
     - With 0 assigned categories: same → `HTTP 302` and culture no longer appears in `/admin/cultures`.
   - Record actual output: `agents/implementation/tests/plan_12/step_04_delete.md`  
   Checkpoint: Wait for developer approval before proceeding.

5. Optional polish: admin discoverability + guardrails  
   Status: Pending  
   Implementation:
   - Add a link to `/admin/cultures` from an existing admin index surface (if one exists), or at minimum ensure `/admin/cultures` is reachable and consistent in layout.
   - Add minimal validation:
     - trim name; disallow empty
     - cap name length (e.g., 255) and description length (e.g., 2k) to avoid accidental huge posts
   Testing:
   - Canonical (expected): manual smoke: create/edit/assign still works.  
   - Record actual output/notes: `agents/implementation/tests/plan_12/step_05_polish.md`  
   Checkpoint: Wait for developer approval before proceeding.

---

## 3. Risks / Edge Cases

- Large category lists: checkbox UI may get long; keep it simple for now, add grouping/search later if needed.
- Concurrent edits: category assignment writes should use a transaction to avoid partially-applied sets.
- Future evolution: avoid encoding channel/group assumptions now; keep schema generic for later “space ↔ cultures” linking.

## 4. Open Questions (max 3)

Decisions (confirmed):
- `cultures.name` is globally unique.

Decisions (confirmed):
- Admin-only: all cultures routes are guarded like other `/admin/*`.
- Delete behavior:
  - Cultures can only be deleted when they are no longer associated with any categories.
  - Future: also require no space/channel/group associations once implemented.

Open: none
