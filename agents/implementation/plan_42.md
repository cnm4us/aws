# Implementation Plan 42: Optional Gentle High-Pass on Video Audio (FFmpeg)

## 1. Overview
Goal: Add an **optional** gentle **high-pass filter** to the **video’s original audio only** (not the added music/opener), to reduce low-frequency rumble (wind/handling/HVAC) with minimal risk of voice distortion.

Scope:
- Applies only when we are using FFmpeg audio mastering (audio mix/replace pipeline).
- Default: **off** (env flag).
- Keeps the added music/SFX untouched.

Non-goals:
- Full noise reduction / denoise (e.g., FFT denoise) by default.
- Auto de-hum detection.

## 2. Proposed Env Flags (off by default)
- `MEDIA_VIDEO_HIGHPASS_ENABLED=0|1` (default `0`)
- `MEDIA_VIDEO_HIGHPASS_HZ=80` (default `80`)

Notes:
- 80Hz is a conservative starting point for speech; we can raise it later if needed.

## 3. Open Questions
1) Confirm the default cutoff: **80Hz** (proposed). If you prefer: 70Hz / 90Hz / 100Hz.
2) Should this also be applied to **abrupt ducking analysis** (silence detection) to avoid wind rumble triggering the cutoff early? (recommended: yes)

## 4. Implementation Steps

### Step 1) Config: add env flags
- Add `MEDIA_VIDEO_HIGHPASS_ENABLED` and `MEDIA_VIDEO_HIGHPASS_HZ` to `src/config.ts`.
- Ensure defaults are `false` and `80`.

### Step 2) Persist settings into media job inputs (determinism)
- Extend `AudioMasterV1Input` in `src/features/media-jobs/types.ts`:
  - `videoHighpassEnabled: boolean`
  - `videoHighpassHz: number`
- When enqueuing `audio_master_v1` in `src/services/productionRunner.ts`, copy values from env into job `input_json`.
- For backward compatibility, the worker should default missing values to “off”.

### Step 3) Worker: pass through to FFmpeg pipeline
- Update `src/media/jobs/audioMasterV1.ts` to pass `videoHighpassEnabled/videoHighpassHz` into:
  - `createMuxedMp4WithLoopedMixedAudio()`
  - `createMuxedMp4WithLoopedReplacementAudio()` (no effect in replace-mode, but safe to plumb through)
- Log applied settings in the job logs (`appendLog`) for easy debugging.

### Step 4) FFmpeg filtergraph: apply only to the video’s audio
- Update `src/services/ffmpeg/audioPipeline.ts`:
  - Add optional args to the relevant functions:
    - `videoHighpassEnabled?: boolean`
    - `videoHighpassHz?: number`
  - In **mix mode**, apply to the **original audio chain** only:
    - Before: `[0:a]volume=...,apad[orig]`
    - After: `[0:a]highpass=f=<hz>,volume=...,apad[orig]` (or `volume,highpass`; we’ll pick one and keep it consistent)
  - Do **not** apply to `[1:a]` (music/opener).

Important nuance:
- Our rolling ducking uses `[1:a][0:a]sidechaincompress...` and we previously saw limitations with labeled streams on this build.
- First iteration: keep ducking sidechain on raw `[0:a]` if needed; apply highpass only to the mixed “orig” that goes into `amix`.
- If feasible on this FFmpeg build, we can attempt to feed a filtered sidechain stream; if it breaks, we revert.

### Step 5) Abrupt ducking “cutoff time” analysis (recommended)
- Update `detectInitialNonSilenceSeconds()` in `src/services/ffmpeg/audioPipeline.ts`:
  - If highpass is enabled, run:
    - `-af "highpass=f=<hz>,silencedetect=..."`
  - This prevents wind rumble from being interpreted as “speech started”.

### Step 6) Inline (non-worker) path parity
- Ensure any direct calls (when `MEDIA_JOBS_ENABLED=0`) also pass env-based highpass settings into the FFmpeg functions so behavior matches worker mode.

### Step 7) Manual QA checklist
1) Env off (`MEDIA_VIDEO_HIGHPASS_ENABLED=0`): confirm no behavior change.
2) Env on (`MEDIA_VIDEO_HIGHPASS_ENABLED=1`, `MEDIA_VIDEO_HIGHPASS_HZ=80`):
   - Windy outdoor video in **mix mode**: rumble reduced; voice not noticeably thinned.
   - Music track level unchanged vs before (only voice bed changes).
3) Abrupt “opener cutoff” mode:
   - With wind-only intro: cutoff should not trigger immediately just from rumble (if Step 5 enabled).

## 5. Notes for Future
- If we later add a “Noise Reduction” preset, keep it opt-in and conservative; highpass remains the safe default option.

