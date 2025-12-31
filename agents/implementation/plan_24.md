# Implementation Plan 24: MediaConvert Support for Logo Watermarks + Music Audio

## 1. Overview

Goal: Extend the existing **MediaConvert production pipeline** to optionally:
- Apply a **logo watermark** (from a logo upload + logo config snapshot) across outputs.
- Apply a **music/audio track** (from an audio upload) as the production’s output audio (**replace-mode**).

This plan builds on current state:
- `/produce` already lets users select `logoUploadId`, `logoConfigId` (+ snapshot), and `musicUploadId`, and these are persisted into `productions.config`.
- MediaConvert jobs are created in `src/services/productionRunner.ts` by loading a profile from `jobs/` + mixins via `src/jobs.ts`, then applying a small set of transforms.

In scope:
- A translation layer from `productions.config.logoConfigSnapshot` → MediaConvert overlay settings.
- Production runner modifications to inject:
  - watermark image overlay into the outputs’ `VideoDescription`
  - optional music track input + audio source remapping (replace-mode)
- Minimal metadata collection needed to make this robust (logo dimensions; audio duration if required).
- Manual verification by actually producing a sample and confirming watermark + audio in the output.

Out of scope:
- A full “studio” UX (advanced timelines, per-space defaults, reusable music configs).
- Any Redis feed work.
- Audio mix/blend mode (explicitly deferred).

---

## 2. Current Pipeline Findings (What We’re Building On)

### 2.1 MediaConvert job assembly
- `src/services/productionRunner.ts`:
  - chooses a profile (e.g. `portrait-hls`, `landscape-both-hls`, `*-cmaf`)
  - loads JSON via `loadProfileJson(profile)` which resolves `$extends` and merges mixins
  - applies transforms: `transformSettings()`, `enforceQvbr()`, optional HQ tuning, optional audio normalization, poster output groups
  - sends `CreateJobCommand` and logs payload via `writeRequestLog()`

### 2.2 Mixins system constraints
- `src/jobs.ts` merges arrays by key for:
  - `OutputGroups` (key: `Name`)
  - `Outputs` (key: `NameModifier`)
  - `AudioDescriptions` (key: `AudioSourceName`)
- `Inputs` arrays are **not merged by key** today (a mixin that touches `Inputs` will replace the entire array).

Implication:
- For music audio we should either:
  - (A) inject a second input in code (recommended first), or
  - (B) extend the mixin merge logic to merge `Inputs` by `FileInput` and introduce placeholders (future option).

---

## 3. Data / Validation Requirements

### 3.1 Logo uploads: image dimension metadata

For robust watermark sizing (preserve aspect ratio), we should store `uploads.width/height` for `kind=logo`.
- Add client-side probing in `frontend/src/app/UploadNew.tsx` for `kind=logo`:
  - load image via `Image()` and send `width/height` with the sign request
- Server already accepts `width/height` on sign and stores them.

If dimensions are missing:
- Fallback behavior: assume square logo (1:1) to avoid failing jobs (acceptable for now).

### 3.2 Logo file type constraints for MediaConvert

Disallow SVG at upload time for logos.
- Update client + server logo validation to allow only: PNG/JPG/JPEG.

### 3.3 Audio uploads: duration metadata (optional)

For v1 (replace-mode):
- If music is **longer** than video: truncate (OK).
- If music is **shorter** than video: **loop** the music to cover full video duration.

If we need deterministic behavior, capture `duration_seconds` on `kind=audio` via client-side `<audio>` metadata and store it.

Practical note:
- MediaConvert does not obviously provide an “audio loop” toggle; plan expects implementing looping by generating a temporary looped audio file (server-side) before submitting the MediaConvert job.

---

## 4. MediaConvert Mapping Strategy

### 4.1 Watermark overlay (logo)

Implement a translation function:
- Input: `logoConfigSnapshot`, output video width/height, logo asset width/height
- Output: a neutral overlay instruction (our own internal DTO) that is then rendered into MediaConvert job JSON

Policy:
- Size: `sizePctWidth` → pixel width `w = round(outputWidth * pct/100)`
- Height: maintain aspect ratio using logo dimensions
- Margin: percent-based margin (e.g. `max(8px, round(outputWidth * 0.02))`)
- Position: 5 positions (top/bottom corners + center)
- Timing rules:
  - `entire`: start at 0, duration = “rest of program”
  - `start_after`: start at X, duration = “rest of program”
  - `first_only`: start at 0, duration = X
  - `last_only`: start at `videoDuration - X`, duration = X (requires video duration; otherwise fallback)
- Fade:
  - For now, encode only fade “type”; implement if MediaConvert accepts it, otherwise treat as none.

Injection points:
- Apply to every video output in `OutputGroups` of type `HLS_GROUP_SETTINGS` or `CMAF_GROUP_SETTINGS`.
- Do NOT watermark poster frame-capture outputs (`FILE_GROUP_SETTINGS` / `_poster.jpg`).

### 4.2 Music audio (audio)

Replace-mode (ship this first):
- Replace the output’s audio with the selected audio upload:
  - Add a second `Inputs[]` entry pointing to the audio upload `s3://bucket/key`
  - Ensure audio selectors are defined for that input
  - Update each output’s `AudioDescriptions[*].AudioSourceName` to reference the music selector (or otherwise select that input)

Looping policy:
- If music is shorter than video, generate a temporary “looped” music file up to the video duration and feed that into MediaConvert.

---

## 5. Step-by-Step Plan

1. Capture logo dimensions on upload (logo kind only) + disallow SVG for logos  
   Status: Completed  
   Changes:
   - `frontend/src/app/UploadNew.tsx`: when `kind=logo`, load selected file into an `Image()` and send `width/height` to `/api/sign-upload`.
   - Update client-side accept/validation to remove SVG for logos.
   - Update server-side validation in `uploadsSvc.createSignedUpload()` to remove `.svg` / `image/svg+xml` for logos.
   Testing:
   - Manual: upload a logo and confirm `GET /api/uploads/:id` shows `width/height` populated.  
   Checkpoint: Wait for developer approval before proceeding.

2. Add production-runner helpers to load referenced assets (logo/audio) safely  
   Status: Completed  
   Changes:
   - Add helper(s) to load uploads by id from DB and validate:
      - status is `uploaded|completed`
      - kind matches (`logo` or `audio`)
      - owned by current user (or admin override)
   Testing:
   - Create production with invalid ids → returns a clear 4xx error.  
   Checkpoint: Wait for developer approval before proceeding.

3. Implement watermark injection (logo upload + logoConfigSnapshot)  
   Status: Completed  
   Changes:
   - Add `applyLogoWatermark(settings, { logoS3Url, logoDims, outputDims, configSnapshot, videoDuration })`
   - Inject watermark into each eligible output.
   Testing:
   - Run a production and inspect `logs/request/*` payload includes overlay settings.
   - Manual: play output and visually confirm watermark placement/opacity/timing.  
   Checkpoint: Wait for developer approval before proceeding.

4. Implement music audio replacement (musicUploadId)  
   Status: Completed  
   Changes:
   - Add a second MediaConvert input for the music track (code-injected).
   - If music shorter than video: generate a temporary looped audio file (server-side) and use that as the music input.
   - Route output audio to the music selector (replace-mode).
   Testing:
   - Run a production and confirm output audio is the music track.  
   Checkpoint: Wait for developer approval before proceeding.

5. Harden and document  
   Status: Pending  
   Changes:
   - Better error messages for unsupported logo formats (SVG), missing durations, etc.
   - Update `README.md` / docs if needed with new config knobs and troubleshooting tips (MediaConvert permissions).  
   Testing:
   - `npm run web:build` succeeds.
   - Produce one portrait and one landscape-both production with watermark + music.  
   Checkpoint: Wait for developer approval before proceeding.

---

## 6. Open Questions / Decisions Needed Before Execution

1. Default behavior when user selects a logo config but no logo (or vice versa):
   - Ignore watermark unless both are selected (recommended)?

2. Looping implementation details:
   - Approved: generate a temporary looped audio file server-side using `ffmpeg` before submitting the MediaConvert job.
