# Plan 36: Media Processing API (FFmpeg-backed, queue-first, audio-first)

Ref: `agents/features/feature_08.MD`

## Goal
Introduce an internal **media mastering subsystem** that:
- accepts “intent” (preset/profile), not ffmpeg flags
- runs async via a queue
- uses object storage I/O (S3 in/out) with local scratch only
- captures logs/artifacts per job for debugging
- is structured so the “worker” can later move to a dedicated EC2 (or multiple)

Initial scope: **audio-only mastering** (extract, normalize, mix, duck, convert), but **video-ready** by design.

Non-goal: replacing MediaConvert ABR packaging/ladders. MediaConvert remains for HLS/CMAF outputs.

## Key Separation of Concerns
1) **CreateMedia (Orchestration / Intent Layer)**
- Decides *what* should be produced and *why* (based on production settings).
- Creates media jobs, tracks state, retries, and hands the finished master to MediaConvert.
- Does **not** build ffmpeg filtergraphs directly.

2) **FFmpeg Engine (Execution Layer)**
- Given a validated job spec + preset, compiles to ffmpeg args, runs it, and returns outputs + logs.
- Does **not** know about productions/spaces/publishing; it only processes media.

## Proposed Architecture (Phase 1)

### A) Data model (DB-backed queue “equivalent” to Redis)
Add tables:
- `media_jobs`
  - `id` (PK)
  - `type` (e.g. `audio_master_v1`)
  - `status` (`PENDING|PROCESSING|COMPLETED|FAILED|DEAD`)
  - `priority` (int, default 0)
  - `attempts` (int)
  - `max_attempts` (int, default 3)
  - `run_after` (datetime, for backoff)
  - `locked_at`, `locked_by` (worker id)
  - `input_json` (job request)
  - `result_json` (output locations + metadata)
  - `error_code`, `error_message`
  - `created_at`, `updated_at`, `completed_at`
- `media_job_attempts`
  - `id`, `job_id`, `attempt_no`
  - `started_at`, `finished_at`, `exit_code`
- `ffmpeg_stdout`, `ffmpeg_stderr` (or stored in S3, referenced here)
  - `scratch_manifest_json` (optional: temp paths, uploaded artifacts)

Queue semantics:
- Worker claim via `SELECT ... FOR UPDATE SKIP LOCKED` (concurrency-safe).
- One job at a time initially; later allow N workers / N concurrency.

Why DB queue first:
- “equivalent” to Redis, ships fast, no new infra.
- Keep the queue interface pluggable so Redis can be swapped later.

Retention (debug artifacts):
- Keep job attempt stdout/stderr and failure artifacts **indefinitely for now**.
- Provide an easy clearing mechanism:
  - `/admin/media-jobs/:id/purge` (removes stored logs/artifacts for that job)
  - `/admin/media-jobs/purge?older_than_days=N` (bulk cleanup)
  - optional CLI: `scripts/media-jobs-purge.ts`

Storage for logs/artifacts (chosen):
- Store stdout/stderr and any artifacts in **S3**.
- Store only **S3 pointers** in the DB (bucket + key(s) or key prefix) so MySQL does not grow without bound.

### B) Presets / Profiles (versioned, testable)
Add repo-backed preset definitions (JSON) under something like:
- `src/media/presets/audio/dialogue_mix_v1.json`
- `src/media/presets/audio/music_replace_v1.json`
- `src/media/presets/audio/music_mix_roll_duck_v1.json`

Preset schema (conceptual):
- `version`
- `mode`: `replace|mix`
- `music_gain_db`, `video_gain_db`
- `ducking`: `{ mode: none|rolling|abrupt, gate: sensitive|normal|strict, amount_db }`
- `timing`: `{ duration_seconds?: number|null, fade_enabled?: boolean }`
- `output`: `{ codec: aac, sample_rate: 48000, channels: 2 }`
- `normalization` (optional): `{ enabled, target_lufs }` (ffmpeg `loudnorm`)

### C) Worker runtime
Add a worker loop that:
- pulls one job
- creates a per-job scratch dir
- downloads inputs from S3
- runs ffmpeg via a compiled preset
- uploads outputs to S3 (uploads bucket, “masters/…” prefix)
- writes result + logs
- deletes scratch

Deployment:
- Initially, run worker in-process with the API server (like the current poller).
- Add a dedicated entrypoint later (e.g. `npm run media:worker`) for separate EC2.

### D) Observability (day one)
For each job attempt:
- capture ffmpeg args used (not just “preset name”)
- capture stdout/stderr
- store “failed artifacts” for a limited time (configurable retention)
- add a deterministic “replay” path: re-run the job using stored `input_json`

## Integration with Current Production Flow

### Phase 1 integration (minimal behavior change)
Only introduce the new API for jobs that currently require ffmpeg:
- if `musicUploadId` is set (mix/replace/duck/fade), enqueue a **media master** job instead of doing inline ffmpeg.
- if `musicUploadId` is null, keep sending upload directly to MediaConvert (as today).

Production status semantics (chosen):
- Add a new `productions.status` value: `pending_media`
  - `pending_media`: waiting for ffmpeg worker to produce a mastered MP4 (media job)
  - then transition to existing MediaConvert lifecycle:
    - `queued` (job created)
    - `processing`
    - `completed`
    - `failed`
- This keeps status meaning unambiguous in the UI and admin tooling (no extra “stage” field required).

Proposed orchestration:
1) `POST /api/productions` creates production row in `pending_media` when a media job is required.
2) If audio processing is needed:
   - enqueue `media_jobs(type=audio_master_v1, input_json={video_s3, music_s3, preset_ref, output_key, production_ulid})`
   - production remains `pending_media` until the media job completes
3) When media job completes:
   - start MediaConvert using the **mastered MP4** as `FileInput`
   - transition production to `queued`
4) On failure:
   - mark production as `failed` with error + link to media job id

Feature flag:
- `MEDIA_JOBS_ENABLED=1` to switch between:
  - legacy inline ffmpeg (fallback)
  - queued media jobs (new path)

## Interaction with MediaConvert Normalization
Given recent findings:
- When mix/duck is used for “loud opener until speech”, MediaConvert loudness normalization can reduce the intro due to integrated loudness.

Plan decision (chosen):
- Move loudness normalization into ffmpeg (per preset/profile), where we have more control.
- When a production uses a media job (ffmpeg mastering), disable MediaConvert normalization for that MediaConvert job:
  - do not apply `AudioNormalizationSettings` in the MediaConvert Settings for that job, OR
  - set an explicit per-job flag in the job request context to skip MC normalization.

## Milestones / Steps
1) Add DB tables + repo/service for `media_jobs` and `media_job_attempts`
2) Implement worker loop (single concurrency) + scratch workspace abstraction
3) Create audio preset schema + compiler interface (start by wrapping existing `src/services/ffmpeg/audioPipeline.ts`)
4) Add internal enqueue API (service function first; HTTP routes optional)
5) Integrate with production creation flow behind `MEDIA_JOBS_ENABLED`
6) Add admin debug pages:
   - `/admin/media-jobs` (list, status, retry)
   - `/admin/media-jobs/:id` (logs, stderr, inputs, outputs)
7) Add deterministic replay tooling (CLI script) for failed jobs

## Implementation Status (2026-01-03)
- Steps 1–7 implemented (DB tables, worker, enqueue + `pending_media`, admin pages, purge, replay tooling).
- New admin pages: `/admin/media-jobs` and `/admin/media-jobs/:id` (with stdout/stderr streaming).
- New scripts: `scripts/media-jobs-purge.ts` and `scripts/media-job-replay.ts`.

## Open Questions (to confirm before implementation)
1) Queue backend now: DB (recommended first) vs Redis (needs new infra)
2) Retention policy: keep indefinitely for now; add easy purge mechanism (above).
3) Loudness normalization: do it in ffmpeg per preset; skip MC normalization for mastered inputs.
4) Production status semantics: add `pending_media` (above).
