# Implementation Plan 44: AssemblyAI → VTT (minimal test via production)

## Goal (minimal)
When a **production** finishes, send a **pre-signed S3 GET URL** to AssemblyAI, wait for the transcript, fetch **WebVTT**, and write it to a local log file for inspection.

Non-goals (for this plan)
- No captions UI in the feed/video player yet.
- No persistence model for transcripts yet (DB/S3 storage can be Plan 45).
- No speaker diarization, summarization, chaptering, etc.

## Key choices (recommended)
1) **What media URL do we send?**
   - Prefer the exact MP4 we feed to MediaConvert:
     - If a production has an ffmpeg “audio master” stage, use that mp4 (e.g. `music-mix/.../video.mp4`).
     - Else use the original upload mp4 (`uploads.s3_bucket` + `uploads.s3_key`) since that’s MediaConvert input for “MC-only” renders.
2) **When do we run it?**
   - Trigger on `production.status` transition to `completed`, **behind a feature flag** so we don’t spam paid API calls by default.

## Env
- Required: `ASSEMBLYAI_API_KEY` (already set).
- Add:
  - `ASSEMBLYAI_ENABLED=0|1` (default `0`)
  - `ASSEMBLYAI_AUTOTRANSCRIBE=0|1` (default `0`) — if `1`, enqueue transcripts automatically after production completion
  - `ASSEMBLYAI_PRESIGN_TTL_SECONDS=21600` (default 6h)
  - `ASSEMBLYAI_POLL_INTERVAL_MS=3000` (default 3s)
  - `ASSEMBLYAI_POLL_TIMEOUT_SECONDS=1800` (default 30m)

## Step 0 (cleanup / optional)
- Commit the currently uncommitted fix in `frontend/src/app/Publish.tsx` (story list visibility) before starting this plan, to keep history clean.

## Step 1) AssemblyAI client (server-side only)
- Add `src/services/assemblyai.ts` (or `src/integrations/assemblyai.ts`) with:
  - `createTranscript(audioUrl: string): Promise<{ id: string }>`
  - `waitForTranscript(id: string, opts): Promise<{ status: 'completed'|'error'; error?: any }>`
  - `fetchVtt(id: string): Promise<string>`
- Use `fetch` with `Authorization: <key>` and JSON error handling.
- Poll with timeout and a small backoff (keep defaults simple).

## Step 2) Determine the “transcription input” object for a production
Add a helper that returns `{ bucket, key }` for the production’s transcription source:
- If there’s an ffmpeg audio master job result for the production (ex: `media_jobs` result contains output mp4), use that.
- Else use production’s upload’s `s3_bucket` + `s3_key`.

## Step 3) Job runner (reuse existing `media_jobs`)
Add a new `media_jobs.type`:
- `assemblyai_transcript_v1`
- `input_json` fields:
  - `productionId`, `bucket`, `key`, `presignTtlSeconds`
- Worker logic:
  1) generate S3 presigned GET URL for `{bucket,key}`
  2) `createTranscript(audioUrl)`
  3) poll until completed/error
  4) fetch VTT and write it to `logs/assemblyai/production_<id>.vtt`
  5) store `{ transcriptId, vttBytes, vttPath }` in `result_json`

## Step 4) Trigger on production completion (behind flags)
In the production completion path (where we set `productions.status='completed'`):
- If `ASSEMBLYAI_ENABLED=1 && ASSEMBLYAI_AUTOTRANSCRIBE=1`, enqueue a `media_jobs` row of type `assemblyai_transcript_v1`.
- Make enqueue idempotent (one transcript job per production) via:
  - best-effort `SELECT` check in code, or
  - unique key (if we already have a suitable uniqueness mechanism).

## Step 5) Manual test checklist
1) Set:
   - `ASSEMBLYAI_ENABLED=1`
   - `ASSEMBLYAI_AUTOTRANSCRIBE=1`
2) Create a short production (10–30s).
3) Verify:
   - a `media_jobs` row appears for the transcript type
   - job finishes `completed`
   - a new file exists under `logs/assemblyai/production_<id>.vtt`
4) Open the `.vtt` file and confirm basic structure and timestamps.

## Questions to confirm before implementation
1) Should this transcript be keyed to **production** only (recommended for now), or eventually per **publication** (if you anticipate per-space audio edits later)?
2) Language handling: do we assume English for now, or should we add an optional `ASSEMBLYAI_LANGUAGE_CODE` env?
