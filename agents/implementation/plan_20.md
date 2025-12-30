# Implementation Plan: Channel Description + Show in Jump Modal

## 1. Overview

Goal:
- Add a **Description** field to the site_admin Channel configuration page (`/admin/channels/:spaceId`).
- In the Global Feed “Jump to Space” modal, show the **channel description** instead of “Channel ULID”.

In scope:
- Persist channel description on the `spaces` row (recommended: `spaces.settings.profile.description`).
- Render + edit description on `/admin/channels/:id` (server-rendered).
- Extend `GET /api/publications/:id/jump-spaces` to return `spaceDescription` for each target.
- Update Jump modal UI to display `spaceDescription` for channels (with sensible fallback when missing).

Out of scope:
- Group descriptions (unless we decide to generalize).
- Rich text / markdown / HTML; treat as plain text.
- Membership gating / join flows / age verification.

---

## 2. Step-by-Step Plan

1. Decide storage + constraints for channel description  
   Status: Pending  
   Work:
   - Store at `spaces.settings.profile.description` (string or null).
   - Define validation: max length (suggest 280 or 500), trim whitespace, allow newlines or single paragraph (pick one).
   Testing:
   - None (decision-only).  
   Checkpoint: Wait for developer approval before proceeding.

2. Add description field to `/admin/channels/:id` server-rendered form  
   Status: Pending  
   Work:
   - Update `renderAdminSpaceDetailPage` in `src/routes/pages.ts` to render a `<textarea name="description">` for kind=`channel`.
   - Plumb the value from `space.settings.profile.description` into the form.
   - On validation errors, preserve the submitted description in the draft view.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super --include get /admin/channels/<ID>` → `HTTP 200` and HTML contains `name="description"`.  
   - Record actual output: `agents/implementation/tests/plan_20/step_02_admin_form.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Persist description on save (admin service)  
   Status: Pending  
   Work:
   - Update `pagesRouter.post('/admin/channels/:id')` to read `body.description`.
   - Extend `adminSvc.updateSpace()` (and its input type) to accept `description?: string` and write it to `settings.profile.description` (set to null when empty).
   - Apply validation from Step 1 and return friendly errors.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super post /admin/channels/<ID> ...` → redirects to `/admin/channels/<ID>?notice=Saved.` and subsequent GET shows the description populated.
   - Record actual output: `agents/implementation/tests/plan_20/step_03_admin_save.md`  
   Checkpoint: Wait for developer approval before proceeding.

4. Include `spaceDescription` in `GET /api/publications/:id/jump-spaces`  
   Status: Pending  
   Work:
   - Extend the query/result mapping so each returned item includes `spaceDescription` (string|null) derived from the target space settings.
   - Keep current filters (group/channel only; published only; exclude global feed; etc.).
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /api/publications/<ID>/jump-spaces` → `HTTP 200` and items include `spaceDescription`.  
   - Record actual output: `agents/implementation/tests/plan_20/step_04_jump_spaces_api.md`  
   Checkpoint: Wait for developer approval before proceeding.

5. Update Jump modal to show description for channels  
   Status: Pending  
   Work:
   - Update `frontend/src/app/JumpToSpaceModal.tsx` to display:
     - For channels: `spaceDescription` (if present) instead of ULID.
     - Fallback when missing: show `Channel` (and optionally ULID or nothing; pick explicitly).
   - Ensure long descriptions don’t break layout (truncate with CSS or limit length server-side).
   Testing:
   - Manual: open Global Feed → Jump → confirm channel cards show description line.  
   - Record notes: `agents/implementation/tests/plan_20/step_05_modal_ui.md`  
   Checkpoint: Wait for developer approval before proceeding.

6. Build verification  
   Status: Pending  
   Work:
   - Run full build for deployable assets.
   Testing:
   - Canonical (expected): `npm run web:build` → success.  
   - Record actual output: `agents/implementation/tests/plan_20/step_06_build.md`  
   Checkpoint: Wait for developer approval before proceeding.

---

## 3. Open Questions

1. Description constraints:
   - Max length: 280 vs 500 vs 2000?
   - Allow newlines, or force single paragraph?

2. Jump modal fallback when a channel has no description:
   - Show nothing (just “Channel”), or show ULID as a fallback?

3. Scope:
   - Channels only (as requested), or also add to Groups now for symmetry?

