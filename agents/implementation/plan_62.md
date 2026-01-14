# Plan 62: Create Video (Phase 1 — Base Track Composer)

## 1) Goal
Introduce a new timeline-first composer (`/create-video`) that lets creators:
- Add video clips to a base timeline
- Split/trim/delete (ripple) with 0.1s resolution
- Export the composed timeline as a new “video upload” (so the existing `/produce` flow can be used for overlays/audio/etc)

This is intentionally separate from `/edit-video?upload=...` (single-upload trimming) and `/produce` (build production options).

## 2) Scope

### In scope (Phase 1)
- New route: `/create-video`
- One base video track (no overlay tracks yet)
- Clip operations:
  - Add video clip (from user uploads)
  - Split at playhead
  - Delete clip (ripple close)
  - Trim clip in/out (handles + modal)
  - Undo (single-step or history stack, mobile-friendly)
- Preview:
  - Timeline playback that switches the preview source clip-by-clip
  - Scrub/playhead sync at 0.1s
- Persistence:
  - One active “Create Video project” per user
  - Autosave timeline state (DB-backed; no long query strings)
- Export:
  - Render a master MP4 via ffmpeg (media_jobs)
  - Create a new `uploads` row (kind=video) for the exported master
  - Redirect to `/produce?upload=<newUploadId>&from=/create-video` after export completes

### Out of scope (future phases)
- Overlay tracks (images/video-in-video), audio track(s), logo/lower-third/screen-title as tracks
- Staging space implementation (but we keep it in mind for publish UX)
- Per-project multiple drafts/versions (v1 uses one active project per user)
- Collaborative editing or multi-tab conflict resolution

## 3) UX Overview

### Start
- User navigates to `/create-video`
- If an active project exists: resume it
- Else: create a new empty project

### Add clips
- “Add Video” opens a modal picker listing the user’s video uploads (search + recent sort)
- Selecting a video inserts a clip at the current playhead (or end if timeline is empty)

### Edit clips
- Tap a clip to select it
- Split: creates two clips at playhead (source range split)
- Delete: removes selected clip and ripples
- Trim: drag handles or open modal to set clip in/out precisely

### Export
- “Export” starts a background `media_job` (ffmpeg concat) and shows progress
- On completion: user lands on `/produce?upload=<newUploadId>` to apply overlays/audio configs as today

## 4) Data Model

### New DB table (recommended)
`create_video_projects`
- `id` PK
- `user_id`
- `status` (`active`|`archived`)
- `timeline_json` (JSON)
- `created_at`, `updated_at`, `archived_at`
- Optional linkage fields (for later): `last_export_upload_id`, `last_export_job_id`

Uniqueness:
- Enforce one active project per user (similar pattern to `production_drafts`)

### Timeline JSON (v1)
```json
{
  "version": "create_video_v1",
  "playheadSeconds": 0,
  "clips": [
    {
      "id": "clip_x",
      "uploadId": 73,
      "sourceStartSeconds": 0.0,
      "sourceEndSeconds": 12.3
    }
  ]
}
```

Notes:
- `clips` are sequential (implicit ripple, no gaps in v1).
- Clip duration is `sourceEndSeconds - sourceStartSeconds`.

## 5) API

### Project CRUD
- `POST /api/create-video/project` → create or return active project (per user)
- `GET /api/create-video/project` → get active project
- `PATCH /api/create-video/project` → replace `timeline_json` (server validates)
- `POST /api/create-video/project/archive` → archive current project

### Clip source metadata
- Reuse existing uploads endpoints for listing video uploads.
- Add a small “upload summary by ids” if needed for UI labels (or reuse existing list output).

### Export
- `POST /api/create-video/project/export`:
  - validates project timeline
  - enqueues a `media_job` (e.g. `create_video_export_v1`)
  - returns `{ jobId }`
- `GET /api/create-video/project/export-status`:
  - returns job status + result upload id when complete

## 6) Server-side validation (v1)
- All referenced `uploadId`s must:
  - exist, be `kind='video'`, and be owned by the user (or user_id NULL system video if you ever add that)
  - be `uploaded|completed`
- Clip source range rules:
  - `0 <= sourceStart < sourceEnd`
  - clamp/round to 0.1s
  - `sourceEnd` must be <= upload duration (when known)
- Clip count limits (performance guardrails):
  - max clips: e.g. 50
- Total duration limits:
  - MVP: cap at 20 minutes (matches your recent direction)

## 7) ffmpeg export job (media_jobs)
- Input:
  - ordered clip list with S3 locations + source in/out times
- Steps:
  1) For each clip: trim (accurate enough for 0.1s) and normalize format
  2) Concat video+audio into a single MP4 master
  3) Upload master MP4 to uploads bucket under a `videos/YYYY-MM/DD/<uuid>/video.mp4` key
  4) Create `uploads` DB row for the new master (kind=video, user_id=user)
  5) Mark job complete with `resultUploadId`

Notes:
- We can reuse existing ffmpeg throttling env vars to protect the instance.

## 8) Frontend Implementation
- Add a new SPA page: `CreateVideo.tsx`
- Reuse timeline primitives from `EditVideo.tsx` where possible:
  - playhead, scrubber, waveform area (optional in v1), selection highlight, undo stack
- Add “Add Video” picker modal:
  - list user video uploads
  - show thumb + name + duration
- Add clip UI on timeline:
  - pill label with upload name
  - trim handles + modal editor for in/out
- Autosave:
  - debounce PATCH to the active project

## 9) Testing (manual)
- Create project → add 2 clips → play through boundary → verify source switching works.
- Split clip → verify two clips created with correct source ranges.
- Trim clip handles → verify duration changes and ripple timing stays consistent.
- Delete clip → verify ripple closes gap and total duration updates.
- Export → verify a new upload is created and `/produce?upload=<new>` loads.

Record results in:
- `agents/implementation/tests/plan_62/*`

## 10) Open Questions (for Phase 2+)
- Multi-track model: how many overlay/audio tracks, and how to represent z-order cleanly?
- Preview quality for PiP and multi-track audio (lightweight preview vs exact preview).
- Staging space: add as a publish choice once spaces support a private owner-only “staging” type.

