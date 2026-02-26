# plan_75 — Exports: Prep for Publish + Publish flow

## Goal
Update `/exports` so each export has a clear two-step lifecycle:

1) **Prep for Publish (HLS)** — create/trigger the HLS (MediaConvert) pipeline for the export.
2) **Publish** — once HLS is ready, send the user to `/publish?production=<id>` to choose spaces.

Add a status line + retry path so users always understand what state the export is in.

## Non-goals (v1)
- No automatic publishing.
- No change to the existing `/publish` UX or publication checkboxes.
- No new “staging” space logic here (can be added later).
- No historical log viewer; just surface status + retry.

## UX spec

### Cog modal buttons (top → bottom)
- **Open Timeline**
- **Prep for Publish (HLS)** (primary)
  - Disabled + dark gray when `ready` or `in_progress`
  - If `failed`, label changes to **Retry Prep (HLS)** and becomes enabled
- **Publish** (primary when `ready`)
  - Disabled + dark gray until `ready`
  - When enabled: navigates to `/publish?production=<productionId>`
- **Delete** (burgundy)

### Status line
Show a single line in the cog modal (above buttons) like:
- `HLS: Not started`
- `HLS: In progress…`
- `HLS: Ready`
- `HLS: Failed (Retry available)`

Optional: if we have a short error string, show it in small text under the status line.

## Data model / mapping (critical)
We need a stable mapping: **export upload → production**.

### Recommended schema
Add a nullable column on `uploads`:
- `create_video_production_id BIGINT UNSIGNED NULL`

Rules:
- Only used/filled for exports (`uploads.video_role='export'`).
- When the user first runs “Prep for Publish (HLS)” for an export, we create the production and store the production id here.
- If a prep attempt fails, v1 may create a new production row and update this pointer (so the export always points at “the current” production).

### Alternative (if production already references uploadId)
If the `productions` table already stores `upload_id` pointing to the export upload, we can query by that.
Still prefer the explicit pointer because it is fast and avoids ambiguous cases.

## Backend changes

### 1) DB migration
- `src/db.ts`: add `uploads.create_video_production_id` with index:
  - `(create_video_production_id)`
  - optionally `(video_role, create_video_production_id)`

### 2) Production lookup helpers
Add production service helpers:
- `findByExportUploadId(uploadId)` (returns `{ production, hlsStatus }` or null)
- `loadProductionStatus(productionId)` (returns `not_ready | in_progress | ready | failed` + optional `lastError`)

### 3) New API endpoints
Add small endpoints for `/exports` UI:

1. `GET /api/exports/:uploadId/hls-status`
   - Auth required.
   - Validates the upload is an export and owned by the user.
   - Returns:
     ```json
     {
       "state": "not_ready|in_progress|ready|failed",
       "productionId": 123|null,
       "detail": "optional short error"
     }
     ```

2. `POST /api/exports/:uploadId/prep-hls`
   - Auth required + CSRF.
   - If `create_video_production_id` exists:
     - enqueue/retry MediaConvert if not already ready.
   - Else:
     - create production row with `uploadId`
     - set `uploads.create_video_production_id`
     - enqueue MediaConvert
   - Returns:
     ```json
     { "productionId": 123, "state": "in_progress|ready" }
     ```

### 4) Define “ready” / “in_progress” / “failed”
Implementation should reuse existing production/MediaConvert status tracking:
- If production has a completed HLS output (whatever current system uses to mark success), state = `ready`
- If production exists and MC is queued/running, state = `in_progress`
- If last attempt failed, state = `failed` + `detail`
- If no production, state = `not_ready`

If status tracking is currently only visible via media_jobs:
- Provide a minimal status derivation from existing production fields + latest media_jobs row for that production.

## Frontend changes (Exports page)

### 1) Fetch status on open
When the user clicks the cog:
- Call `GET /api/exports/:uploadId/hls-status`
- Store in modal state.
- Show status line.

### 2) Wire buttons
- **Open Timeline**: uses `create_video_project_id` as today.
- **Prep for Publish (HLS)**:
  - Calls `POST /api/exports/:uploadId/prep-hls`
  - Sets modal status to `in_progress` and polls `hls-status` every ~2s until `ready|failed`
- **Publish**:
  - Enabled only when status `ready` and productionId exists.
  - Navigates to `/publish?production=<id>`
- **Delete**:
  - Same as today, but also:
    - If an associated production exists, optionally prompt:
      - “Delete export only” (recommended default) vs “Delete export + production” (defer)
    - v1: delete export upload only; productions remain but will become orphaned (OK for now, can clean later).

### 3) Button styling rules
- Prep button:
  - Blue when actionable (`not_ready` or `failed`)
  - Dark gray + disabled when `in_progress` or `ready`
- Publish button:
  - Dark gray + disabled until ready
  - Blue when ready
- Delete stays burgundy

## Testing checklist
- Create export → appears on `/exports`.
- Open cog → status shows `Not started`.
- Click “Prep for Publish (HLS)” → status becomes `In progress…`.
- After MC completes → status becomes `Ready`, Prep disabled, Publish enabled.
- Click Publish → lands on `/publish?production=<id>`.
- Force a failure (bad input) → status `Failed`, Prep label becomes “Retry Prep (HLS)”.
- Retry → transitions back to `In progress…`.

## Rollout / compatibility
- Existing exports without `create_video_production_id`:
  - show `Not started` until user clicks Prep
  - no backfill required
