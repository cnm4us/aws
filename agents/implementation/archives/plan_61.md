# Plan 61: Persist “Build Production” State (Drafts + Resume)

## 1. Overview
Goal: Stop relying on long query strings to persist `/produce` + `/edit-video` state by introducing a DB-backed **Production Draft**. Users can start a new draft, leave midway, and later **resume** without losing selections.

In scope:
- Add a `production_drafts` table (per user, per upload) to store build selections + edit settings.
- Add a small CRUD API for drafts (create/get/update/archive).
- Update `/uploads`, `/produce`, and `/edit-video` to use drafts for persistence.
- Update “Create Production” UX to “New Production” / “Resume Production”.

Out of scope:
- Multi-draft versioning/history per upload (v1 assumes one active draft per upload per user).
- Collaboration, conflict resolution, or real-time multi-tab merge semantics.
- Migrating existing “URL-only” sessions into drafts (best-effort: when page loads with URL params, we can seed a draft once).

## 2. Step-by-Step Plan

1. Add DB table for production drafts
   Status: Completed
   Implementation:
   - Create `production_drafts` with:
     - `id` (PK), `user_id`, `upload_id`
     - `status` enum-ish (`active` | `archived`)
     - `config_json` (JSON): stores everything currently encoded in query params for `/produce` + `/edit-video` (build selections, edit ranges, overlay items, etc).
     - `created_at`, `updated_at`, `archived_at`
   - Enforce one active draft per `(user_id, upload_id)` (unique index on `(user_id, upload_id, status)` or `(user_id, upload_id)` + `archived_at IS NULL` pattern).
   Testing:
   - Canonical (expected): run migrations; `SELECT * FROM production_drafts LIMIT 1;` succeeds.
   - Record actual output: `agents/implementation/tests/plan_61/step_01_db.md`
   Checkpoint: Wait for developer approval before proceeding.

2. Add draft CRUD API (server)
   Status: Completed
   Implementation:
   - `GET /api/production-drafts?uploadId=:id` → returns active draft (or 404 if none).
   - `POST /api/production-drafts` with `{ uploadId }` → creates/returns active draft.
   - `PATCH /api/production-drafts/:id` with `{ config }` → replace/merge config (server validates shape).
   - `POST /api/production-drafts/:id/archive` → archives the draft.
   - Auth: only the owning user can read/write; site_admin can still view for debugging only if needed (optional).
   Testing:
   - Canonical (expected):
     - `./scripts/auth_curl.sh --profile user post /api/production-drafts -d '{"uploadId":73}'` → `HTTP 200` and JSON includes `draft.id`.
     - `./scripts/auth_curl.sh --profile user get /api/production-drafts?uploadId=73` → `HTTP 200` and JSON includes `draft.config`.
     - `./scripts/auth_curl.sh --profile user patch /api/production-drafts/<id> -d '{"config":{"foo":"bar"}}'` → `HTTP 200`.
     - `./scripts/auth_curl.sh --profile other_user get /api/production-drafts?uploadId=73` → `HTTP 404` (or `403` if you prefer).
   - Record actual output: `agents/implementation/tests/plan_61/step_02_api.md`
   Checkpoint: Wait for developer approval before proceeding.

3. Define and validate the draft `config` schema (server)
   Status: Completed
   Implementation:
   - Create a single TS type for “draft config” (mirrors `/produce` state) and reuse it in:
     - draft API validation
     - production creation input building
   - Validation rules (v1):
     - `editRanges` well-formed and within video duration (if duration known)
     - overlay items validate as in Plan 60 (max, non-overlap, upload ownership/role)
     - build selections (logo/audio/lower third/screen title/intro) are consistent (e.g. intro custom image requires uploadId).
   Testing:
   - Canonical (expected):
     - `./scripts/auth_curl.sh --profile user patch /api/production-drafts/<id> -d '{"config":{"intro":{"kind":"title_image"}}}'` → `HTTP 400` with validation error (missing `uploadId`).
   - Record actual output: `agents/implementation/tests/plan_61/step_03_validation.md`
   Checkpoint: Wait for developer approval before proceeding.

4. Update `/produce` to load + autosave draft config
   Status: Completed
   Implementation:
   - On `/produce?upload=:uploadId`:
     - Ensure an active draft exists (create if missing).
     - Hydrate UI state from draft config (instead of URL params).
     - When the user changes selections/text, **debounced autosave** to draft via `PATCH`.
   - Keep URL params only for navigation (e.g. `from=`), not for state.
   - If the page loads with legacy URL state (e.g. `logoUploadId`, `editRanges`), do a one-time “seed draft from URL” then strip those params (optional but helpful during transition).
   Testing:
   - Canonical (expected): manual:
     - Open `/produce?upload=73`, choose audio/logo/etc, reload page → selections persist.
     - Confirm URL stays short (no state explosion).
   - Record actual notes: `agents/implementation/tests/plan_61/step_04_produce_ui.md`
   Checkpoint: Wait for developer approval before proceeding.

5. Update `/edit-video` to read/write edits + overlay items from the same draft
   Status: Completed
   Implementation:
   - Replace `editRanges=` + `overlayItems=` persistence with draft config fields.
   - Keep `from=` for navigation only.
   - Ensure split/delete/undo/overlay-add update draft config (debounced autosave).
   Testing:
   - Canonical (expected): manual:
     - Make edits in `/edit-video?upload=73&from=...`, leave page, return → edits persist.
     - Add an Overlay A image, leave page, return → overlay clips persist.
   - Record actual notes: `agents/implementation/tests/plan_61/step_05_edit_video_ui.md`
   Checkpoint: Wait for developer approval before proceeding.

6. Update `/uploads` UX: “New Production” vs “Resume Production”
   Status: Completed
   Implementation:
   - Change button label to “New Production”.
   - If an active draft exists for that upload, show “Resume Production” (primary) + “Start Over” (archives draft + creates a new one).
   - (Optional) show “Discard Draft” inside the cog overlay.
   Testing:
   - Canonical (expected): manual:
     - With no draft: “New Production” shown.
     - After starting a draft: “Resume Production” appears and restores state.
   - Record actual notes: `agents/implementation/tests/plan_61/step_06_uploads_ui.md`
   Checkpoint: Wait for developer approval before proceeding.

7. Wire “Produce” to use the draft (and archive on success)
   Status: Completed
   Implementation:
   - On “Produce”, the client sends `draftId` (or the server infers by `(user_id, upload_id)`).
   - Server loads draft config, builds the production config snapshot, creates `productions` row, starts render pipeline as today.
   - On successful create, archive the draft (or mark it `archived` with `rendered_production_id`).
   Testing:
   - Canonical (expected):
     - Create draft → produce → production starts rendering → draft becomes archived.
     - Refresh `/produce?upload=...` after produce: draft should be new/empty (or offer “Resume” only if a new active draft exists).
   - Record actual notes: `agents/implementation/tests/plan_61/step_07_produce_flow.md`
   Checkpoint: Wait for developer approval before proceeding.

## 3. Open Questions (confirm before Step 1 if needed)
- Should “Resume Production” resume the **same draft** always, or should it resume the **latest unrendered draft** if we later add multiple drafts per upload?
- When a draft is archived after “Produce”, do we keep it indefinitely (for now: yes), and do we need an admin UI to inspect/clear old drafts?
