# Plan 48 — Pivot: ffmpeg does all rendering; MediaConvert does only packaging

## Summary
Pivot the media pipeline so **ffmpeg is the single source of truth for all audio/video compositing**, and **AWS MediaConvert is used only for CMAF/HLS packaging + frame-capture posters**.

This removes the current “split responsibility” where some overlays are done in MediaConvert (logo/lower third/screen title) while other edits happen in ffmpeg, which has proven difficult to reason about and debug.

## Goals
- **Deterministic rendering**: all visual layers (lower third, logo, screen title) are composited in ffmpeg in a known Z-order.
- **Single audio pipeline**: mix/replace/ducking/opener-cutoff/normalization/high-pass remains in ffmpeg.
- **MediaConvert minimized**: packaging only (CMAF/HLS ladders + posters), no ImageInserter overlays, no audio normalization.
- Preserve existing UX and config model (the UI still selects logo/logo-config/lower-third/audio-config/screen-title as today).

## Non-goals
- No new user-facing features (this is a pipeline refactor).
- No new infra (keep DB queue for media jobs).
- No subtitle/caption changes.
- No optimization work beyond what’s necessary (multi-pass is OK initially; we can merge passes later).

## Design decisions
- **ffmpeg becomes the compositor**:
  - Applies visual overlays: lower-third image → logo → screen title (screen title always on top).
  - Applies title-page/freeze-first-frame intros (already ffmpeg).
- **MediaConvert becomes the packager**:
  - Transcodes/segments for CMAF/HLS, generates poster via FRAME_CAPTURE.
  - No audio normalization (already moved to ffmpeg), no overlays.
- Keep a **feature flag** to switch between the old and new behavior while we validate:
  - `MEDIA_FFMPEG_COMPOSITE_ENABLED=1` (default on once stable).

## Implementation steps

### 1) Add a dedicated ffmpeg visual compositor module
Create `src/services/ffmpeg/visualPipeline.ts` with helpers that:
- Read the input MP4 dimensions (ffprobe) and compute pixel-accurate geometry.
- Composite images via `overlay` (PNG with alpha).
- Reuse the existing screen-title `drawtext` implementation, but apply it as the **final** video filter stage.

Functions (suggested):
- `applyLowerThirdImageOverlayMp4({ inPath, outPath, lowerThirdPngPath, cfg, videoW, videoH })`
- `applyLogoOverlayMp4({ inPath, outPath, logoPngPath, cfg, videoW, videoH })`
- `applyScreenTitleMp4({ inPath, outPath, screenTitle, durationSeconds })` (reuse/relocate existing drawtext logic)
- `applyVisualOverlaysMp4({ inPath, outPath, overlays, order })` where order is fixed: lower-third → logo → screen title

Notes:
- For **logo/lower-third geometry**, port the existing MediaConvert rect math to a shared helper (same presets/insets).
- For lower-third “match image width”, continue computing a percent from baseline and clamp to avoid upscaling.

### 2) Extend media-jobs to output a fully rendered master MP4
Update job runners so the job output is the **final master MP4** that MediaConvert should package.

#### `video_master_v1`
Current: intro (optional) + (screen title overlay PNG generation).
New:
- intro (freeze/title image) → (optional) lower third image → (optional) logo → (optional) screen title
- output key prefix remains stable (e.g. `video-master/.../<originalLeaf>`).

#### `audio_master_v1`
Current: intro (optional) + audio replace/mix/ducking/normalize + (screen title overlay PNG generation).
New:
- intro (optional) → audio replace/mix/ducking/normalize → visual overlays (lower third, logo, screen title)
- Do the visual overlays as a second pass initially (re-encode video, `-c:a copy`).
  - Later optimization: merge into one ffmpeg filtergraph pass.

### 3) Remove all overlay logic from MediaConvert job settings (behind flag)
In `src/services/productionRunner.ts`:
- When `MEDIA_FFMPEG_COMPOSITE_ENABLED=1`:
  - **Do not call**:
    - `applyLowerThirdImageIfConfigured`
    - `applyLowerThirdIfConfigured`
    - `applyLogoWatermarkIfConfigured`
    - `applyScreenTitleOverlayIfConfigured`
  - Ensure `applyMusicReplacementIfConfigured` is not used in MC path (audio already mastered when music/audio-config selected).

This makes the MediaConvert job purely “encode/segment/poster”.

### 4) Simplify/remove screen-title overlay PNG plumbing
Once ffmpeg burn-in is back as the authoritative render:
- Remove `screenTitleOverlays` generation + config injection:
  - `src/services/mediaJobs/worker.ts` no longer needs to copy `result.screenTitleOverlays` into `configPayload`.
  - `src/services/productionRunner.ts` no longer needs `applyScreenTitleOverlayIfConfigured`.
  - Keep the DB config fields (`screenTitleText`, `screenTitlePresetSnapshot`) as-is for traceability.

### 5) Validation checklist (manual)
Create productions to confirm behavior:
- Screen title only (poster + video show it).
- Logo only (poster + video show it).
- Lower-third only (poster + video show it).
- Screen title + logo overlapping (screen title must be above logo).
- Lower-third + logo + screen title together (layer order correct).
- Audio replace + overlays.
- Audio mix + overlays.
- Freeze/title-image intro + overlays.

Also validate:
- Production status transitions (`pending_media` → `queued` → `completed`).
- Worker CPU stays within limits (FFMPEG thread envs still respected).

### 6) Cleanup (after stable)
- Default `MEDIA_FFMPEG_COMPOSITE_ENABLED=1`.
- Remove dead MediaConvert overlay code paths and related env flags (or keep for emergency rollback if desired).
- Ensure documentation reflects: “ffmpeg renders; MediaConvert packages.”

## Open questions (confirm before implementing)
1) For productions with **no enhancements at all**, do we want:
   - A) skip ffmpeg entirely (fast path: upload → MediaConvert), or
   - B) still run through `video_master_v1` for uniformity?
   - Recommendation: A (skip ffmpeg) to save CPU.
2) Should we keep MediaConvert watermarking as a fallback (flag) in case ffmpeg overlay fails for an edge video?
   - Recommendation: yes, behind a rollback flag, but not used by default.

