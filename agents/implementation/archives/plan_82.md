## Plan 82: Blurred Background Fill for Landscape Videos (Per Video Object)

### Goal
Add a per‑video‑object option to render a blurred, dimmed background fill **only when the source is landscape and the output is portrait**, so the base video sits centered with blurred fill behind it.

### Decisions
- **Scope**: per video object (base video clips only).
- **Apply condition**: only when aspect ratio mismatch is landscape→portrait.
- **Dim presets**: Light (-0.05), Medium (-0.12, default), Strong (-0.20).
- **No gradients** for v1; fixed dimming + blur.

### Implementation Steps
1. **Types + validation**
   - Add fields to `CreateVideoClipV1`:
     - `bgFillStyle?: 'none' | 'blur'`
     - `bgFillDim?: 'light' | 'medium' | 'strong'`
   - Update `src/features/create-video/validate.ts`:
     - Accept/normalize `bgFillStyle` and `bgFillDim`.
     - Default: `bgFillStyle='none'`, `bgFillDim='medium'`.

2. **UI: Video Properties modal**
   - Add a “Background Fill” section (per `agents/styles/modal-properties.md`):
     - Toggle/Select: `None | Blur`
     - If `Blur`, show `Dim` select: `Light | Medium | Strong`.
   - Persist to `videoEditor` and saved `clips[]`.

3. **Preview behavior**
   - In preview, if `bgFillStyle==='blur'` and video is landscape, render a **blurred background layer** behind the base video:
     - Reuse the base video frame, scale to cover 1080×1920, apply CSS `filter: blur(...) brightness(...) saturate(...)`.
     - Use dim preset mapping to CSS `brightness`.
   - If portrait video or bgFillStyle='none', preview unchanged.

4. **Export (ffmpeg)**
   - In `src/media/jobs/createVideoExportV1.ts`, when composing the base video:
     - Detect landscape source vs portrait target.
     - If `bgFillStyle==='blur'`:
       - Split stream: `[fg][bg]`.
       - `[bg]` → scale to cover target, apply blur + dim + slight desat.
       - `[fg]` → scale to contain, center.
       - Overlay fg on bg.
     - If not enabled, keep existing pipeline.
   - Map dim presets:
     - light: brightness -0.05
     - medium: -0.12
     - strong: -0.20
   - Blur sigma: start with 20 (tunable).

5. **Back‑compat**
   - Old timelines without fields default to `none`.

### Open Questions (confirm before coding)
1. **Preview blur strength**: keep a fixed blur (e.g. 20px) or scale with output size?
2. **Dim presets**: confirm no “Very Light/Very Strong” for now.
3. **Applies to video overlays too?** (Currently base video only.)

### Testing
- Base landscape video → preview shows blurred fill when enabled.
- Base portrait video → no fill even if enabled.
- Export renders blur correctly; dim presets differ visually.
- No regression for existing timelines with `bgFillStyle` missing.
