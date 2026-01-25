# Implementation Plan 68: Timeline-First Library (Uploads vs Exports vs Productions)

## 1. Overview
Goal: Pivot the creator workflow so the **timeline** is the primary unit, while cleanly separating:
- **Uploads** = raw user-uploaded video assets (inputs only)
- **Exports** = Create Video rendered MP4 masters (ffmpeg output)
- **Productions** = MediaConvert HLS outputs (existing meaning)
- **Publications** = production published into spaces (existing meaning via `space_publications`)

In scope:
- Add multi-timeline support (multiple Create Video projects) with client-side “current project” selection.
- Create `/exports` UI for Create Video rendered MP4s with “Open Timeline” + “Send to HLS”.
- Update `/uploads` to show **raw uploads only** and remove creator workflow actions (cogwheel overlay, publish/production summaries).
- Discriminator for raw vs export using **S3 prefix** + **DB link** (recommended B + C).

Out of scope (for this plan):
- Replacing `/produce` entirely (Create Video will gradually subsume it; keep `/produce` working).
- Major redesign of `/productions` beyond optionally adding “Open Timeline” links.
- Any retention/GC policy for intermediate artifacts.

## 2. Step-by-Step Plan

### 1) Schema + Discriminators
Status: Completed

Changes:
- Allow **multiple** Create Video timelines per user:
  - Add `create_video_projects.name VARCHAR(255) NULL`.
  - Drop the unique constraint `uniq_create_video_projects_active (user_id, active_key)` so multiple unarchived projects are allowed.
- Add a reliable export discriminator + project backlink:
  - Add `uploads.video_role ENUM('source','export') NULL` (used only when `uploads.kind='video'`).
  - Add `uploads.create_video_project_id BIGINT UNSIGNED NULL`.
  - Index `uploads (video_role, create_video_project_id, id)` for listing.

Notes:
- Legacy raw uploads may have `uploads.s3_key` formats not rooted under `videos/` (early development). Do not use `s3_key LIKE 'videos/%'` as the sole “source upload” discriminator.
- Source-vs-export filtering should prioritize `uploads.video_role`, with a safe fallback:
  - if `uploads.video_role IS NULL` and `uploads.s3_key` does **not** contain `renders/`, treat as `source`.

Testing:
- `npm run build` (ensures TS compiles after schema code changes).
- Manual smoke: start server and confirm no DB init errors.

Test log: `agents/implementation/tests/plan_68/step_01_schema.md`

Checkpoint: Wait for approval before proceeding.

### 2) Backend: Multi-Project Create Video API (keep old endpoints working)
Status: Completed

Changes:
- Add project-scoped endpoints (new):
  - `GET /api/create-video/projects` → list projects (active first; includes `id,name,updated_at,last_export_upload_id`).
  - `POST /api/create-video/projects` → create new project (empty timeline, status active).
  - `GET /api/create-video/projects/:id` → load one project.
  - `PATCH /api/create-video/projects/:id` → update metadata (name).
  - `PATCH /api/create-video/projects/:id/timeline` → update timeline JSON.
  - `POST /api/create-video/projects/:id/archive` → archive project.
  - `POST /api/create-video/projects/:id/export` → enqueue export job for that project.
  - `GET /api/create-video/projects/:id/export-status` → job status/result upload id.
- Keep compatibility endpoints (existing) but implement them as wrappers around “current project” semantics:
  - `POST /api/create-video/project` (current) → create/get “default current project” (used only until frontend switches).
  - `PATCH /api/create-video/project` (current) → update timeline of the current project.

Semantics update (required after dropping uniqueness):
- Replace “active project per user” lookups with **most recently updated** active project:
  - `getActiveProjectForUser` and any legacy “getActiveByUser” helpers should return the latest `updated_at` among `archived_at IS NULL`.

Navigation:
- Support `/create-video?project=<id>` as a shareable/debuggable selector (in addition to localStorage).

Testing (canonical; record results):
- `./scripts/auth_curl.sh --profile local login`
- `./scripts/auth_curl.sh --profile local get /api/create-video/projects` → `200 {items:[...]}`.
- `./scripts/auth_curl.sh --profile local post /api/create-video/projects -d '{}'` → `201 {project:{id}}`.
- `./scripts/auth_curl.sh --profile local patch /api/create-video/projects/<id> -d '{"name":"Test"}'` → `200`.

Test log: `agents/implementation/tests/plan_68/step_02_backend_api.md`

Checkpoint: Wait for approval before proceeding.

### 3) Export Job: Write to `renders/` + link export upload to project
Status: Pending

Changes:
- Change Create Video export MP4 S3 key root from `videos/` to `renders/` (new stable discriminator).
- When the export upload row is inserted:
  - Set `uploads.video_role='export'`.
  - Set `uploads.create_video_project_id=<projectId>`.
- Update `create_video_projects.last_export_upload_id` on completion (already stored; ensure correct per project).
- Use a dedicated naming helper for export keys (do not change `buildUploadKey(kind='video')`):
  - Add `buildExportKey(...)` in `src/utils/naming.ts` (or a small adjacent module) used only by Create Video export.

Backfill:
- Add a one-time script to backfill historical exports:
  - Scan `media_jobs.type='create_video_export_v1'`.
  - Parse `input_json.projectId` + `result_json.resultUploadId`.
  - Update the `uploads` row for `resultUploadId` with `video_role='export'` and `create_video_project_id`.
- The backfill script must be runnable as TypeScript (e.g. via `ts-node`/`ts-node-dev`), not `node`, to avoid ESM/CJS import issues.

Testing:
- Export a timeline and verify:
  - `uploads.s3_key` starts with `renders/`.
  - `uploads.video_role='export'` and `uploads.create_video_project_id` is set.
- Thumbnails for export uploads should be **lazy-generated**:
  - If `/api/uploads/:id/thumb` is requested and the thumb does not exist yet, generate it on-demand (or enqueue generation) and the UI should fall back to poster/blank until the thumb becomes available.

Checkpoint: Wait for approval before proceeding.

### 4) Frontend: Multi-Timeline “Current Project” (localStorage)
Status: Pending

Changes:
- Store `create_video_current_project_id` in `localStorage`.
- On `/create-video` load:
  - If localStorage has a project id → load it.
  - If missing or not found/archived → create a new project and store it.
- Add a minimal “Timelines” picker UI in Create Video:
  - List: `name || 'Untitled'`, updated date, select.
  - Actions: New, Rename, Archive.

Testing:
- Manual:
  - Create 2 projects; switch between them; refresh and confirm it restores the current one.

Checkpoint: Wait for approval before proceeding.

### 5) Frontend: Export UX (name prompt + redirect to /exports)
Status: Pending

Changes:
- On “Export” click:
  - If project has no name (or empty) → prompt for name and save before exporting.
  - Enqueue export and show “Exporting…” state (poll status).
  - On completion → redirect to `/exports`.

Testing:
- Manual:
  - Export unnamed project → prompt appears → exported → redirects to `/exports`.

Checkpoint: Wait for approval before proceeding.

### 6) New `/exports` Page (Create Video rendered MP4s)
Status: Pending

Changes:
- Add a new SPA route/page `/exports` listing **export uploads**:
  - Shows Name/Description/Date/Size/Duration.
  - “Open Timeline” → navigates to `/create-video?project=<id>` (and sets localStorage).
  - “Send to HLS” → calls `POST /api/productions { uploadId: <exportUploadId>, name?: ... }` and then navigates to `/productions?id=<productionId>`.
- `/exports` thumbnails should use the same “thumb then fallback” behavior used elsewhere (so missing thumbs don’t block the page).
- Backend endpoint for exports list:
  - `GET /api/exports?user_id=...` (or under `/api/create-video/exports`) returning export uploads joined with `create_video_project_id` and project name.

Testing:
- `./scripts/auth_curl.sh --profile local get /api/exports` → `200 {items:[...]}`.
- Manual:
  - From `/exports`, click “Open Timeline” and confirm it loads that project.
  - Click “Send to HLS” and confirm new production appears in `/productions`.

Checkpoint: Wait for approval before proceeding.

### 7) Update `/uploads` to “raw video assets only”
Status: Pending

Changes:
- Filter `/uploads` (video kind) to show `video_role='source'`, with fallback:
  - if `video_role IS NULL`, treat as source unless `s3_key` contains `renders/`.
- Remove cogwheel overlay and production/publication summary from `/uploads` cards.
- Keep only asset editing (name/description), preview, and delete-source semantics as needed.

Testing:
- Manual:
  - `/uploads` shows raw uploaded videos only (no exports).
  - Exports are visible only in `/exports`.

Checkpoint: Wait for approval before proceeding.

### 8) Ensure “Add Video” in Create Video uses raw uploads only
Status: Pending

Changes:
- Update Create Video’s “Add → Video” picker to list only source uploads (exclude exports).
  - Prefer `video_role='source'`.
  - Else if `video_role IS NULL`, treat as source unless `s3_key` contains `renders/`.

Testing:
- Manual:
  - Add Video picker excludes exported videos.

Checkpoint: Wait for approval before proceeding.

### 9) Optional: Add “Open Timeline” link on `/productions`
Status: Pending

Changes:
- When listing a production whose upload is an export and has `uploads.create_video_project_id`, show “Open Timeline”.

Testing:
- Manual:
  - Production created from an export has an “Open Timeline” link back to Create Video project.

Checkpoint: Wait for approval before proceeding.
