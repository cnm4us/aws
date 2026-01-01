# Implementation Plan 32: Env-Gated Audio Loudness Normalization (MEDIA_CONVERT_NORMALIZE_AUDIO)

## Goal

Normalize **overall loudness across produced videos** (integrated loudness) when running MediaConvert, controlled by a single environment flag:

- `MEDIA_CONVERT_NORMALIZE_AUDIO=1` → enable loudness normalization (Target LKFS).
- `MEDIA_CONVERT_NORMALIZE_AUDIO=0` → disable normalization entirely.

Out of scope:
- “Within-video” leveling (dynamic range compression / scene-by-scene loudness riding).
- Cube LUTs, animated lower thirds, title slates (but we’ll restructure so these can be added cleanly next).

## Current State (why change)

- We already have `applyAudioNormalization()` in `src/jobs.ts` (MediaConvert `AudioNormalizationSettings`).
- Today it’s applied inconsistently:
  - Code path in `src/services/productionRunner.ts` only enables it when `sound` starts with `"norm"`.
  - Some `jobs/profiles/*.json` include `mixins/audio/normalize-lufs-16`, but this mixin is not reliably merged (it doesn’t target specific OutputGroups/Outputs), and we later drop malformed OutputGroups.

Result: normalization is not a stable “system-level” policy.

## Design Choice

Make audio normalization a **code-level transform** (policy), applied after profile load and before job submission, and controlled only by `MEDIA_CONVERT_NORMALIZE_AUDIO`.

Rationale:
- It applies uniformly across all renditions and profiles (HLS/CMAF, portrait/landscape, etc.).
- It avoids fragile array patching in JSON mixins.
- It creates the same kind of “feature injection point” we’ll need for LUTs and motion graphics.

## Proposed Restructure (enables LUTs + lower thirds later)

Create a dedicated “MediaConvert transforms” module that is responsible for optional, feature-driven modifications to the loaded profile settings.

Example module shape (names final in implementation):
- `src/services/mediaconvert/transforms.ts`
  - `applyAudioNormalizationIfEnabled(settings)`
  - `applyLogoWatermarkIfConfigured(settings, opts)` (move existing function here later, optional)
  - `applyMusicReplacementIfConfigured(settings, opts)` (move existing function here later, optional)
  - **stubs** (no behavior yet, but establish the seam):
    - `applyCubeLutIfConfigured(settings, opts)` (no-op for now)
    - `applyLowerThirdsIfConfigured(settings, opts)` (no-op for now)

This keeps `productionRunner.ts` small and makes future features additive.

## Steps

### 1) Add env config flag

- Add `MEDIA_CONVERT_NORMALIZE_AUDIO` parsing to `src/config.ts`:
  - Treat `'1'|'true'|'yes'` as enabled; `'0'|'false'|'no'` as disabled.
  - Decide default (recommend default **enabled** in dev; for safety you can default to **disabled** if unset and require explicit opt-in).
- Document in:
  - `.env.example`
  - `docs/Configuration.md`

Acceptance:
- App starts with/without the variable.
- Flag value is visible in logs or accessible by importing config.

### 2) Centralize normalization policy in code

- Ensure normalization is applied based on env flag, not the `sound` string:
  - In `src/services/productionRunner.ts`, replace:
    - `if (typeof sound === 'string' && sound.toLowerCase().startsWith('norm')) applyAudioNormalization(...)`
    - with:
      - `if (MEDIA_CONVERT_NORMALIZE_AUDIO) applyAudioNormalization(...)`
- Define one canonical target:
  - Keep current target: `TargetLkfs = -16`, AAC bitrate floor `128k` (or 160k if we want higher consistency).

Acceptance:
- With env=1: new jobs include `AudioNormalizationSettings` in outputs.
- With env=0: new jobs do not include `AudioNormalizationSettings`.

### 3) Clean up profile normalization mixin usage (non-breaking)

To avoid confusion and double sources of truth:
- Option A (preferred): remove `mixins/audio/normalize-lufs-16` from all `jobs/profiles/*.json` and rely on code policy only.
- Option B: keep mixin files but treat them as legacy; ensure code still controls the real behavior.

Acceptance:
- The job settings are correct regardless of profile selection.

### 4) Add “future feature seams” (no functional changes)

Add a small “transforms pipeline” abstraction in code:
- A single function called from `productionRunner` after profile load:
  - `applyConfiguredTransforms(settings, { configPayload, upload, production, ... })`
- Inside, call:
  - `applyAudioNormalizationIfEnabled(settings)`
  - No-op placeholders for:
    - cube LUT injection (MediaConvert `JobSettings.ColorConversion3DLUTSettings`)
    - motion overlay (MediaConvert `JobSettings.MotionImageInserter`) for animated lower thirds

Acceptance:
- No behavior change besides audio normalization gating.
- The “hooks” exist so future plans can add LUT/lower-third logic without touching core render flow.

### 5) Verification

Manual checks:
- Create a production with `MEDIA_CONVERT_NORMALIZE_AUDIO=1`:
  - verify request log includes `AudioNormalizationSettings` for audio outputs (and target LKFS).
- Repeat with `MEDIA_CONVERT_NORMALIZE_AUDIO=0`:
  - verify `AudioNormalizationSettings` is absent.

Optional: add a small debug endpoint/script that returns the resolved job settings for a dry-run (no submit) (only if we already have similar patterns).

### 6) Commit

- `npm run build`
- `npm run web:build:scoped` (if any frontend changes)
- Commit message: `MediaConvert: env-gated audio normalization`

## Open Questions

1) Default behavior when env var is unset:
   - Recommend: default to **enabled** (`1`) in dev to ensure consistent playback.
   - If you expect to toggle for cost/quality experiments, we can default to disabled and require explicit `1`.
2) Target loudness:
   - Keep `-16 LKFS` for now (common for streaming/mobile). If we later need broadcast, we can add an env override.

