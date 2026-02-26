# Plan 94 — Background System + Graphics Layer Reorder

## 1. Goal
Introduce a dedicated background system and make `Graphics` a foreground-only layer:

- Add timeline-level background (`color` or `image`) in Timeline Properties.
- Extend per-video object background from `none|blur` to `none|blur|color|image`.
- Move `Graphics` render/timeline layer to top-most (final phase).
- Keep phased delivery with test checkpoints after each phase.

Final target stack (top to bottom):
- Graphics
- Logo
- Lower Thirds
- Screen Titles
- Video Overlay
- Videos
- Timeline Background

## 2. Phased Plan

### Phase 1 — Timeline Background (Global)
Scope:
- Data model: add timeline-level background config.
- Timeline Properties UI: background type + controls.
- Preview pipeline: render background for all frames.
- Export pipeline: render same background in ffmpeg output.

Implementation notes:
- Add timeline fields (example):
  - `timelineBackgroundMode: 'none' | 'color' | 'image'`
  - `timelineBackgroundColor?: string`
  - `timelineBackgroundUploadId?: number | null`
- Use image fit behavior `cover` (fill 1080x1920; crop as needed).
- Backward compatibility: default existing timelines to `none`.

Checkpoint test:
1. Set timeline background color only, export, verify full-frame background.
2. Set timeline background image only, export, verify cover/crop behavior.
3. Preview/export parity for both modes.
4. Save/reload project; settings persist.

Stop for review before Phase 2.

### Phase 2 — Per-Video Background Expansion
Scope:
- Extend video object background controls from `none|blur` to `none|blur|color|image`.
- Add per-clip color/image controls in clip properties.
- Preview/export parity with timeline background precedence.

Precedence rule:
- If clip background is `color` or `image`, it is the effective background for that clip window.
- Else if clip background is `blur`, use current blur behavior.
- Else fall back to timeline background.

Implementation notes:
- Reuse image source picker used for timeline background.
- Preserve existing `blur` behavior and defaults.
- Avoid rendering duplicate covered layers in export graph when possible (effective-background selection).

Checkpoint test:
1. Timeline background image + clip background `none`: timeline bg visible.
2. Timeline background image + clip background `color`: color overrides during clip.
3. Timeline background image + clip background `image`: clip image overrides during clip.
4. Clip background mode switch persists across save/reload.
5. Preview/export match in all above cases.

Stop for review before Phase 3.

### Phase 3 — Move Graphics to Top Layer (Last)
Scope:
- Reorder render stack so `Graphics` is always top-most.
- Reorder timeline lane display to match render order.
- Validate interaction with logo/lower-third/screen-title overlays.

Implementation notes:
- Update preview composition order.
- Update ffmpeg filter layering order.
- Keep behavior deterministic (no auto-hide/warnings).

Checkpoint test:
1. Graphics over logo/lower-third/screen-title in preview and export.
2. Existing projects still load (no crashes, expected stacking changes only).
3. Timeline lane order matches visual/render expectation.

Stop for final acceptance.

## 3. Touchpoints (Expected)
- Frontend:
  - `frontend/src/app/CreateVideo.tsx`
  - `frontend/src/app/createVideo/timelineTypes.ts`
- Backend validation/types:
  - `src/features/create-video/types.ts`
  - `src/features/create-video/validate.ts`
- Export pipeline:
  - `src/media/jobs/createVideoExportV1.ts`

## 4. Confirmed Decisions
1. Timeline background image source
   - Use existing `kind=image` uploads (no separate image role).
2. Per-clip background image source
   - Use the same picker/source as timeline background.
3. Color defaults
   - Timeline color default: `#000000`.
   - Clip color default: `#000000`.
4. Clip background inheritance UX
   - When clip mode is `none`, label reads: `Use Timeline Background`.
5. Migration behavior
   - Existing clips with `blur` remain unchanged.
   - All other clips default to `none` and inherit timeline background.
6. Timeline lane UI order
   - Lane order will visually match final render stack top-to-bottom.
7. Performance guardrails
   - Ship correctness first in Phase 2.
   - Defer ffmpeg optimization/culling for overlapping background layers unless a simple low-risk optimization is obvious.

## 5. Suggested Execution Order
1. Implement Phase 1 and test together.
2. Implement Phase 2 and test together.
3. Implement Phase 3 last and test together.
