# plan_49: Pango+Cairo screen title renderer (PNG) with ffmpeg burn-in (keep drawtext fallback)

## Goal
Replace the current ffmpeg `drawtext`-based screen-title burn-in with a **Pango+Cairo** renderer that produces a transparent **PNG overlay**, then burn that overlay into the master MP4 with ffmpeg (same as logo/lower-third image overlays). This is primarily to gain:
- Better typographic control (wrapping + **letter-spacing/tracking**, consistent margins).
- More faithful **preview == render** option via the same PNG.
- Future-ready drawing (pill, rounded corners, gradients) with a real 2D renderer.

Keep the current `drawtext` path fully intact as a fallback.

## Non-goals (for this plan)
- Changing existing presets schema (we’ll reuse `screenTitlePresetSnapshot` fields).
- Adding new UI controls beyond what already exists (unless needed for parity, e.g. letterSpacing).
- Replacing other overlays (logos/lower-third images) with Pango output.

## Current state (baseline)
- Preview on `/produce` renders a DOM overlay (CSS).
- Render pipeline burns screen titles into the master MP4 using ffmpeg `drawtext` (`src/services/ffmpeg/audioPipeline.ts`).
- ffmpeg then hands the composited MP4 to MediaConvert for packaging-only.

## Proposed architecture
### Renderer selection + safety
- Add a new feature flag / config:
  - `SCREEN_TITLE_RENDERER=pango|drawtext` (default `drawtext` until proven stable).
  - Optionally `SCREEN_TITLE_RENDER_PREVIEW_PNG=1` to switch `/produce` preview from DOM overlay → server PNG overlay.
- Runtime behavior:
  - If `SCREEN_TITLE_RENDERER=pango`, generate a PNG overlay (Pango+Cairo), then overlay with ffmpeg.
  - If pango render fails for any reason, fallback to `drawtext` for that production (and log failure).

### Pango+Cairo helper program (recommended implementation)
Use a small **Python** helper via **PyGObject** (GI bindings) to avoid brittle Node native builds:
- `scripts/pango/render_screen_title_png.py` (invoked by Node via `spawn`).
- Input: JSON (stdin) describing:
  - frame size: `{ width, height }` (portrait 1080×1920; landscape 1920×1080)
  - text + max lines (3)
  - font: family/file key, weight, size (px or derived from `% of frame height`)
  - letter spacing (optional; default 0)
  - alignment (center)
  - background style:
    - pill: color + opacity, padding, radius (optional in v1; can start with solid rounded rect)
    - outline: stroke width + color + opacity
    - shadow: offset + blur-ish approximation + alpha (Cairo supports soft shadow via blur-like techniques; we can start with simple offset shadow for MVP)
  - insets and position (top/middle/bottom)
  - maxWidthPct
  - output path (png)
- Output: exit 0 + file written.

### Dependencies (ops)
Install packages (host or container):
- `python3`, `python3-gi`
- `gir1.2-pango-1.0`, `gir1.2-pangocairo-1.0`
- `gir1.2-cairo-1.0`
- fonts package(s) for the curated font(s) (we already rely on DejaVu):
  - `fonts-dejavu-core` (or ensure `DejaVuSans-Bold.ttf` exists)

If we prefer containerization later: bake these into the runtime image.

### Caching strategy (to keep costs down)
Render output should be cached by a content hash of:
- `text`, `preset snapshot`, `frame dims`, and any pango-specific fields (e.g. letter spacing).
Store as S3 object:
- `screen-titles-png/v1/<ymd>/<hash>/portrait.png`
- `screen-titles-png/v1/<ymd>/<hash>/landscape.png`

Then:
- Rendering step checks S3 first; if present, reuse.
- Otherwise generate, upload, and return pointers.

### Integration points
1) **Production render path**
   - Replace/augment `burnScreenTitleIntoMp4()`:
     - If renderer=pango:
       - render overlay PNG(s) for the active orientation (or both if we want future reuse),
       - call the existing ffmpeg PNG overlay pipeline to burn it in.
     - If renderer=drawtext: current behavior.

2) **Preview parity**
   - Add endpoint `POST /api/screen-titles/preview`:
     - Input: `{ uploadId, presetId, text }` (or direct `preset snapshot`).
     - Resolve upload orientation + aspect and decide a standard preview frame size (match the “preview box” in UI).
     - Return a PNG (or a short-lived signed URL).
   - Update `/produce` preview:
     - Option A (recommended): keep the DOM preview by default; add a “Generate preview” button for the PNG mode (no per-keystroke server calls).
     - Option B: debounce calls (e.g. 500–800ms after typing stops) and cache by hash.

## Implementation steps
1) Add new plan file and flags
   - Add `SCREEN_TITLE_RENDERER` to `src/config.ts` + `.env.example`.
   - Default to `drawtext`.

2) Add Pango+Cairo renderer helper
   - Create `scripts/pango/render_screen_title_png.py`.
   - Support:
     - 3 lines max, center alignment, wrapping to `maxWidthPct`
     - pill background (solid fill), outline, shadow (simple offset)
     - letter spacing (if provided)
   - Provide a CLI contract:
     - `python3 scripts/pango/render_screen_title_png.py --input-json <path> --out <pngPath>`
     - or stdin JSON + `--out`.

3) Add Node wrapper
   - `src/services/pango/screenTitlePng.ts`:
     - `renderScreenTitlePng({ frame, text, preset, outPath }): Promise<void>`
     - handles serialization, spawn, stderr capture.

4) Add S3 cache layer
   - Hash input -> object key.
   - Check `HEAD` first; if exists return pointer.
   - If not exists: render to tmp, upload, return pointer.

5) Wire into production render pipeline
   - In the ffmpeg compositing path:
     - If `SCREEN_TITLE_RENDERER=pango`, obtain PNG pointer and call `burnPngOverlaysIntoMp4` (or a small wrapper for “screen title overlay”).
     - Keep `drawtext` as fallback on error (log and continue).

6) Preview endpoint (optional in v1)
   - Add `POST /api/screen-titles/preview` returning a PNG.
   - Gate behind `SCREEN_TITLE_RENDER_PREVIEW_PNG=1` (off by default).

7) Manual test matrix
   - Text lengths: short, medium, long (wrap to 3 lines), with punctuation.
   - Styles: pill / outline / strip.
   - Positions: top / middle / bottom.
   - Verify:
     - letter spacing (if enabled) changes visually.
     - margins match the PNG exactly when used for preview.
     - fallback to drawtext works if pango renderer missing.

## Open questions / choices (need your confirmation before implementing)
1) Do you want to add a new preset field now for **letterSpacing** (e.g. `letterSpacingPx` or `trackingPct`), or keep it hardcoded until we validate the renderer?
2) For the PNG preview in `/produce`:
   - “Generate” button (no server calls while typing) vs
   - debounced auto-preview (more seamless but more server load).
3) Do we want the Pango renderer to support **rounded pill corners + gradient strip** in v1, or start with solid shapes and add gradients later?

