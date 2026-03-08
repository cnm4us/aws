# Plan 113: Create Video Export Progress (FFmpeg-Derived) + Consistent UX

## Goal
Make Export behavior on `/create-video` consistent and informative:
- stay on `/create-video` after tapping `Export`,
- show real progress (not just `processing`) using FFmpeg progress output,
- keep `/exports` compatible (pending/completed states still visible there).

## Product Decisions (for this plan)
- Default behavior: **do not auto-redirect** to `/exports` on completion.
- On `/create-video`, show:
  - queue/processing/completed/failed status,
  - progress percent when available,
  - CTA link/button: `View in Exports`.
- Keep manual navigation to `/exports` unchanged.

## Current State
- Frontend starts export and polls `/api/create-video/projects/:id/export-status` every 2s.
- On `completed`, frontend currently redirects to `/exports`.
- Backend returns status + upload id, but no progress percent.
- FFmpeg runs are tracked in logs/manifests, but not surfaced as live progress.

## Scope
- `create_video_export_v1` only (this plan does not add progress for all media job types yet).
- Backend + frontend changes.
- Minimal `/exports` page adjustments only if needed for pending row display.

Out of scope:
- Full websocket/SSE streaming.
- Perfect cross-job ETA prediction.
- Non-export media job progress UI.

---

## Phase A — Progress Data Contract + Storage
1. Define job progress contract in backend:
   - `status`: `queued | processing | completed | failed | dead`
   - `progressPct`: `0..100 | null`
   - `progressStage`: short stage id (e.g. `fetch_inputs`, `render`, `upload_outputs`, `persist_results`)
   - `progressMessage`: optional human-readable message
   - `updatedAt`
2. Persist progress in DB (recommended: `media_jobs` columns or compact JSON column).
3. Add repository methods:
   - `updateJobProgress(jobId, patch)`
   - `getJobProgress(jobId)` (or include in existing `getById` path).
4. Ensure writes are throttled (for example every 500ms–1000ms or meaningful delta).

Deliverable:
- Durable progress state survives refresh/restart and can support future remote workers.

---

## Phase B — FFmpeg Progress Parser (Reusable)
1. Extend FFmpeg runner with progress mode:
   - run command with `-progress pipe:1 -nostats` when enabled.
2. Parse key-value lines (`out_time_ms`, `speed`, `fps`, `progress`).
3. Emit normalized callback updates:
   - `rawRatio` (from `out_time_ms / expectedDurationMs` if expected duration known),
   - `rawOutTimeMs`,
   - `speed`,
   - `terminal` (`continue|end`).
4. Keep existing stderr capture + failure behavior intact.

Deliverable:
- `runFfmpeg(..., { onProgress })` support without breaking existing callers.

---

## Phase C — Export Job Aggregation (Weighted Progress)
1. In `create_video_export_v1`, aggregate progress across stages:
   - Stage weights baseline:
     - queue/prepare: 5%
     - ffmpeg render work: 85%
     - upload/finalize: 10%
2. For multi-command render flows:
   - precompute/render-step count or estimated durations,
   - map each step into a sub-range of the 85% render band.
3. Update job progress via repository with throttling.
4. On success/failure, finalize progress:
   - success => `100%`, stage `completed`
   - failed/dead => preserve last pct + error state.

Deliverable:
- Export jobs report live, monotonic, user-facing percent progression.

---

## Phase D — Export Status API Extension
1. Extend existing endpoint response:
   - `/api/create-video/projects/:id/export-status`
2. Return progress fields in response:
   - `progressPct`, `progressStage`, `progressMessage`, `updatedAt`.
3. Keep backward compatibility with current fields:
   - `status`, `jobId`, `resultUploadId`, `error`.

Deliverable:
- Frontend can poll one endpoint for both status and progress.

---

## Phase E — `/create-video` UX Update (Consistent Behavior)
1. Keep user on page after `Export`.
2. Replace current `Export in progress...` string with richer status UI:
   - progress bar,
   - numeric percent,
   - stage label.
3. Remove auto-redirect on completion.
4. On completion:
   - show success toast/banner and `View in Exports` action.
5. On failure:
   - keep current error behavior with clearer stage-aware message.

Deliverable:
- Consistent export UX with explicit user control over navigation.

---

## Phase F — `/exports` Pending Visibility (Optional Hardening)
1. Ensure queued/processing export appears promptly in `/exports` list.
2. If currently delayed, add pending row from job record before upload row exists.
3. Optional polling refresh cadence on `/exports` for in-progress jobs.

Deliverable:
- If user navigates early, they still see an in-progress artifact.

---

## Observability Additions
- Continue existing span tags.
- Add progress-centric tags/events where low-cardinality:
  - `create_video.export.progress_update` (event/log, not high-cardinality metric label explosion)
  - stage transitions as span events.
- Do not emit per-frame noisy metrics.

## Risk / Mitigation
- Risk: high DB write rate from progress updates.
  - Mitigation: throttle writes and update only on meaningful delta (e.g. >=1% or stage change).
- Risk: percent jumps for multi-step pipelines.
  - Mitigation: weighted stage model and step-level interpolation.
- Risk: ETA inaccuracies.
  - Mitigation: no ETA in v1; expose percent + stage only.

## Acceptance Criteria
1. Export flow from `/create-video` never auto-redirects by default.
2. While rendering, user sees progress percent that updates over time.
3. Refreshing `/create-video` during export preserves current status/progress.
4. On completion, UI offers explicit navigation to `/exports`.
5. Failed jobs show stage-aware error and stop progress updates.
6. No noticeable performance regressions from progress persistence.

## Rollback Plan
- Feature flag for progress emission/UI (`CREATE_VIDEO_EXPORT_PROGRESS_ENABLED=0|1`).
- If disabled, fallback to prior status-only polling path.
