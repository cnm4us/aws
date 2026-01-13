# Plan 58: Audio Envelope for Edit Timeline (Waveform/Loudness Graph)

## Goal
Generate a lightweight “audio volume over time” dataset for each upload’s **edit proxy** and render it in the blank middle area of the `/edit-video` timeline to help users find speech/silence and cut points.

## Why This Helps
- Makes it easier to cut dead air, pauses, and find “when narration starts”.
- Complements the 0.1s playhead controls without requiring constant “play/pause/scrub to listen”.
- Works even if thumbnails are unavailable (it’s derived from audio).

## Decisions / Constraints (MVP)
- Source: **edit proxy** (`/api/uploads/:id/edit-proxy`) so we don’t hit the original upload repeatedly.
- Resolution: sample at **0.1s** (10 Hz) for a max 3-minute video → ~1800 points.
- Output shape: JSON array of `{ t: number, v: number }` where:
  - `t` = seconds from start of proxy
  - `v` = normalized loudness in `[0..1]`
- Storage: S3 object in `UPLOAD_BUCKET` (no DB table yet). Use versioned key `audio_envelope_v2.json`.
- If there’s no audio track: return an array of zeros (or an empty array with `hasAudio=false`).

## Phase A — Backend: generate + store envelope
### 1) Add S3 key helper
Add helper for a stable location:
- `buildUploadAudioEnvelopeKey(uploadId)` → `proxies/uploads/<uploadId>/audio/audio_envelope_v2.json`

### 2) New media job type
Add a new job type:
- `upload_audio_envelope_v1`

Update:
- `src/features/media-jobs/types.ts`
  - extend the `MediaJobType` union
  - add input/output DTO types

### 3) Implement job runner
Add `src/media/jobs/uploadAudioEnvelopeV1.ts`:
- Input:
  - `uploadId`, `userId`
  - `proxy.bucket`, `proxy.key`
  - `intervalSeconds` (default `0.1`)
  - `outputBucket`, `outputKey`
- Job steps:
  1) Download proxy MP4 from S3 to tmp (or stream into ffmpeg).
  2) Run ffmpeg to produce a time-series loudness envelope.
     - Implementation approach (choose one):
       - **Option A (simple)**: use `astats` with `reset=<interval>` and parse RMS/peak metadata.
       - **Option B (loudness)**: use `ebur128` logging and sample momentary loudness.
     - Convert dB-ish values into `[0..1]`:
       - clamp and normalize, e.g. map `[-60dB..0dB] → [0..1]`.
  3) Write JSON `{ version, intervalSeconds, points: [{t,v}...] }` to tmp file.
  4) Upload JSON to `outputBucket/outputKey`.
- Output:
  - `output: { bucket, key }`
  - `intervalSeconds`
  - `pointCount`

### 4) Enqueue after edit proxy creation
In `src/services/mediaJobs/worker.ts`, after `upload_edit_proxy_v1` completes (where timeline sprites are enqueued today):
- Best-effort enqueue `upload_audio_envelope_v1` if not already pending/processing for that upload.
- Use:
  - `proxy: { bucket: UPLOAD_BUCKET, key: buildUploadEditProxyKey(uploadId) }`
  - `outputKey: buildUploadAudioEnvelopeKey(uploadId)`

### 5) Add API endpoint to fetch envelope
Add route:
- `GET /api/uploads/:id/audio-envelope` (requireAuth)

Behavior:
- If envelope exists in S3: return JSON.
- If missing:
  - enqueue job (if MEDIA_JOBS enabled + proxy exists)
  - return `404 not_found` (or `202 {status:'pending'}` — pick one; recommended `202` for better UX)

## Phase B — Frontend: render envelope on timeline
### 6) Fetch envelope on Edit Video page
In `frontend/src/app/EditVideo.tsx`:
- After `uploadId` is known (and ideally after duration is known), fetch `/api/uploads/:id/audio-envelope`.
- If `202 pending`: show “Generating audio graph…” placeholder.
- Retry with backoff (e.g. 1s, 2s, 3s… up to 10s) or a “Retry” button.

### 7) Render in the middle timeline area
Render the graph behind the timeline track area:
- Use a `<canvas>` sized to the track width and height.
- Map time to X using the same `pxPerSecond` mapping.
- Draw a simple polyline or filled waveform:
  - x = `t * pxPerSecond`
  - y = scaled `v` to track height

### 8) Honor edits (ripple deletes)
When `ranges` exists:
- Render envelope in **edited-time** space:
  - For each kept segment, draw its portion of the envelope consecutively.
  - This keeps the envelope aligned to “what the viewer hears at edited-time t”.

## Manual test checklist
1) Upload a video with clear silence → speech transitions.
2) Open `/edit-video?upload=<id>`:
   - Graph should appear (or show “Generating…” then appear).
3) Scrub playhead:
   - Peaks should align with audible speech.
4) Split/delete segments:
   - Graph should “ripple” with edits (edited-time rendering).
5) Video with no audio:
   - Graph should be flat/empty but page still works.

## Notes
- Envelope generation uses `aresample + asetnsamples` to compute per-interval RMS (avoids cumulative RMS flattening).
