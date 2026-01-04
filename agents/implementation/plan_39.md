# Implementation Plan 39: Upload Thumbnails From Source + Source Preview Modal

## 1. Overview
Goal: On `/uploads` and `/productions?upload=:id`, show a thumbnail generated from the **first frame (t=0)** of the **original uploaded video** (not from the first production render), and allow previewing the original uploaded video in a modal overlay from the productions list.

In scope:
- Generate and store a per-upload thumbnail image using ffmpeg (aspect ratio preserved).
- Serve thumbnails via an authenticated API endpoint.
- Update the relevant SPA views to prefer the upload thumbnail (with fallback).
- Add a modal preview player for the original uploaded video on `/productions?upload=:id`.

Out of scope:
- Any changes to production rendering, MediaConvert outputs, or feed/video player behavior.
- Public (unauthenticated) access to upload thumbnails/videos.
- Adding additional poster/title-page logic (this is “source upload thumbnail” only).

Key requirements:
- Thumbnail extracted at `t=0` for now.
- Thumbnail keeps aspect ratio; UI can use `object-fit: cover` in its card layout.

## 2. Step-by-step Plan

1. Add upload thumbnail storage conventions + API endpoint (read-only)
   Status: Completed
   - Define a deterministic S3 location for video upload thumbnails (no DB migration):
     - `thumbs/uploads/<uploadId>/thumb.jpg` in `UPLOAD_BUCKET`
   - Add `GET /api/uploads/:id/thumb` (auth required) that:
     - Performs the same permission checks as `/api/uploads/:id/file` (owner or admin; system-audio special case not relevant).
     - Streams the thumbnail object if it exists; returns `404` if missing.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile user get /api/uploads/<id>/thumb -I` → `404` initially for existing uploads.
   - Record actual output: `agents/implementation/tests/plan_39/step_01_api_thumb.md`
   Checkpoint: Wait for developer approval before proceeding.

2. Implement ffmpeg thumbnail generator (single frame at t=0)
   Status: Completed
   - Add a small ffmpeg pipeline (new module, e.g. `src/services/ffmpeg/thumbPipeline.ts`) that:
     - Downloads the upload video input (or streams via S3 → local temp file, consistent with existing ffmpeg pipelines).
     - Extracts one frame at `t=0` and writes a JPEG thumbnail (e.g. constrain long edge to ~640px; preserve aspect ratio).
     - Uploads to `UPLOAD_BUCKET` at `thumbs/uploads/<uploadId>/thumb.jpg`.
     - Reuses the existing `runFfmpeg()` wrapper so `FFMPEG_THREADS/*` caps apply.
   Testing:
   - Canonical (expected): run a local “one-off” function/test script to generate a thumb for a known upload; then:
     - `./scripts/auth_curl.sh --profile user get /api/uploads/<id>/thumb -I` → `200` + `Content-Type: image/jpeg`
   - Record actual output: `agents/implementation/tests/plan_39/step_02_generate_thumb.md`
   Checkpoint: Wait for developer approval before proceeding.

3. Generate thumbnails asynchronously via `media_jobs` (upload_thumb_v1)
   Status: Completed
   - Extend the media job system to support thumbnail generation:
     - Add `upload_thumb_v1` to `src/features/media-jobs/types.ts`.
     - Add `src/media/jobs/uploadThumbV1.ts` that calls the thumbnail generator.
     - Update `src/services/mediaJobs/worker.ts` dispatch to run it.
   - Enqueue `upload_thumb_v1` when a video upload is marked uploaded (in `src/features/uploads/service.ts:markComplete()`), but only for `kind='video'`.
   - Keep the system runnable even if media jobs are disabled:
     - If `MEDIA_JOBS_WORKER_ENABLED=0`, thumbnail simply won’t appear (UI will fall back), but the API endpoint remains safe.
   Testing:
   - Canonical (expected): upload a new video, complete upload, then:
     - `GET /api/uploads/:id/thumb` → eventually `200` after job runs.
     - Admin: `/admin/media-jobs` shows an `upload_thumb_v1` entry completing successfully.
   - Record actual output: `agents/implementation/tests/plan_39/step_03_worker.md`
   Checkpoint: Wait for developer approval before proceeding.

4. Update SPA to use the upload thumbnail (with fallback)
   Status: Completed
   - Update `/uploads` and `/productions?upload=:id` UI:
     - Prefer thumbnail URL `/api/uploads/:id/thumb` for video uploads.
     - If thumbnail fails to load (404), fall back to the existing production poster behavior (current behavior).
   Testing:
   - Manual (expected): open `/uploads`, confirm each video card uses the source thumbnail when present; fallback still renders for old uploads without thumbs.
   - Record notes: `agents/implementation/tests/plan_39/step_04_ui_thumbs.md`
   Checkpoint: Wait for developer approval before proceeding.

5. Add “preview original upload” modal on `/productions?upload=:id`
   Status: Completed
   - In the productions list view for an upload:
     - Clicking the upload thumbnail opens a modal overlay.
     - Modal plays the original uploaded video using existing `GET /api/uploads/:id/file` (Range supported).
     - Provide a clear close (X) control; ensure iOS `playsInline` behavior remains acceptable.
   Testing:
   - Manual (expected): on `/productions?upload=<id>`, click thumbnail → modal opens → video plays → close returns to page.
   - Record notes: `agents/implementation/tests/plan_39/step_05_modal.md`
   Checkpoint: Wait for developer approval before proceeding.

6. Backfill thumbnails for existing uploads (scripted)
   Status: Completed
   - Add a script (admin/operator) to enqueue thumbnail jobs for existing video uploads missing a thumbnail object.
   - Include a batch limit + cursor to avoid enqueuing everything at once.
   Testing:
   - Canonical (expected): run backfill for a small batch (e.g. 10) and confirm thumbs appear in `/uploads`.
   - Record actual output: `agents/implementation/tests/plan_39/step_06_backfill.md`
   Checkpoint: Wait for developer approval before proceeding.
