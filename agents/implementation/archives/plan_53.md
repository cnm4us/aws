# Plan 53: Mobile Video Editor (Edit Proxy + Trim MVP)

## Goal
Add a **mobile-first** “Edit Video” flow that provides reliable ~0.1s scrubbing accuracy by using an **edit proxy MP4** (short GOP), while keeping the **original upload immutable**. Edits are applied **per production** (not per upload).

## Why an edit proxy?
iOS Safari seeks are often limited by keyframes in the source upload. A dedicated proxy encoded with frequent keyframes makes scrubbing/preview consistent, while the final render uses ffmpeg re-encode for correctness.

## Scope (MVP)
- Add “Edit Video” entry from `/produce?upload=:uploadId`.
- Provide a new editor page that supports:
  - Play/pause preview
  - Scrub (0.1s resolution control)
  - Set `Trim Start` and `Trim End`
  - Save edits back to `/produce` (persist in URL)
  - Clear edits
- Render pipeline:
  - Apply trim to the production master using ffmpeg (re-encode).

## Out of scope (future)
- Multiple cuts (“remove middle segment”) and multi-segment edit lists (EDL).
- Timeline overlays (text/images) authored on the editor timeline.
- Waveform rendering, thumbnails strip, snapping to detected silences.

## Data model
### 1) Upload edit proxy artifacts (derived; not “edits”)
Store the proxy in S3 at a deterministic key (no DB columns required):
- `proxies/uploads/:uploadId/edit_proxy.mp4`

### 2) Production edit recipe (per production)
Extend `productions.config` JSON (no new columns) with:
```json
{
  "edit": {
    "trimStartSeconds": 0.0,
    "trimEndSeconds": 123.4
  }
}
```
Notes:
- Times are relative to the **original upload**.
- `trimEndSeconds` is optional; when absent, “end of video”.

## Backend changes
### A) Generate edit proxy (Media Jobs)
1. Add a new media_jobs type: `upload_edit_proxy_v1`.
2. Enqueue after a user video upload is marked uploaded (similar to `upload_thumb_v1`):
   - Only for `uploads.kind='video'`
   - Skip if `uploads.source_deleted_at` is set
3. Worker implementation (ffmpeg):
   - Input: original upload MP4
   - Output: `proxies/uploads/:uploadId/edit_proxy.mp4`
   - Suggested encode:
     - H.264 + AAC
     - long-edge cap ~540p (keep aspect ratio)
     - 30fps
     - keyframes every 0.25s: `-g 8 -keyint_min 8 -sc_threshold 0`
     - `-movflags +faststart`
   - Respect existing ffmpeg resource caps (`FFMPEG_THREADS`, etc).

### B) Serve edit proxy to authenticated users
Add an authenticated stream route:
- `GET /api/uploads/:id/edit-proxy`
  - Permission: same as `/api/uploads/:id/file` (owner or admin); system audio rules don’t apply (this is video-only).
  - Source: `s3://UPLOAD_BUCKET/proxies/uploads/:id/edit_proxy.mp4`
  - Support Range requests for mobile playback.
  - If not found:
    - return `404` (UI shows “Generating proxy…”)

### C) Wire trim into production renders
1. When creating a production, include `edit` fields inside `productions.config`.
2. Ensure ffmpeg visual mastering applies trim **before** intro/overlays/audio:
   - Decode → apply trim (`trim`/`atrim`) → reset PTS → proceed with intro (first screen hold/title) → overlays (logo/lower-third/screen-title) → audio pipeline.
3. Update any duration-dependent logic:
   - Treat the trimmed duration as the “base duration” for:
     - intro timings
     - screen-title “first N seconds”
     - opener cutoff analysis (if enabled)

## Frontend changes (editor UI)
### A) Navigation / routing
1. Add an “Edit Video” link from `/produce?upload=:uploadId` to:
   - `/edit-video?upload=:uploadId&from=<encoded current /produce URL>`
2. Add `Back to Produce` that returns to `from=...`.

### B) Editor page UX (mobile-first)
1. Load proxy video:
   - `src="/api/uploads/:id/edit-proxy"`
   - If 404: show “Generating edit proxy…” with a retry button.
2. Timeline:
   - Fixed playhead (center)
   - Scrollable track under it (duration-based width)
   - A numeric time readout + stepper/slider for 0.1s adjustments
3. Trim controls:
   - Set Start (current time)
   - Set End (current time)
   - Clear Start/End
4. Save:
   - Persist as URL params back to `/produce`:
     - `editStart=12.3`
     - `editEnd=98.7`
   - `/produce` uses these params when creating the production (and shows “Trim: 12.3s → 98.7s” summary).

### C) /produce “quick preview” (simplest)
When `editStart` is present:
- Switch the preview video source to the **edit proxy** (`/api/uploads/:id/edit-proxy`) instead of the original upload stream.
- Seek preview to `editStart` on load (best-effort; retry on `loadedmetadata`).
- (Optional later) constrain looping to `editStart..editEnd`.

## Manual test checklist
1. Upload a new 3-minute video; wait for proxy to appear:
   - verify `/api/uploads/:id/edit-proxy` plays on iOS Safari.
2. Open `/edit-video?upload=:id`:
   - scrubbing feels responsive
   - trim start/end can be set to 0.1s values
3. Return to `/produce`:
   - edits persist in URL and UI summary
4. Produce a video with trim:
   - output reflects trim start/end correctly
   - overlay timings still behave correctly (first screen hold, screen title first N seconds).

## Open questions (confirm before implementation)
1. Trim semantics with “First Screen Hold”:
   - Recommendation: **trim first**, then apply first-screen hold/title on the trimmed clip.
2. If user sets End < Start:
   - Recommendation: block save with inline error.
3. Do we want a “quick preview” in `/produce` that seeks the upload preview to `editStart` when trim is set?
   - Decision: **Yes (simplest)** — use the edit proxy as the preview source and seek to `editStart`.
