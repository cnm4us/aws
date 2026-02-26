# Implementation Plan 71: Create Video — Video Overlay Lane (PiP) v1

## 1. Overview
Goal: add a new **Video Overlay** lane to the Create Video timeline so creators can do picture-in-picture (PiP) and “talking head over slides” compositions.

New layer order (top → bottom):
1) Logo
2) Lower Third
3) Screen Titles
4) **Video Overlay** (PiP videos)
5) Graphics (full-frame images)
6) Video (base clips)
7) Background (solid color)

Key constraints (v1):
- No overlaps within a lane (video overlays cannot overlap each other; videos cannot overlap each other; etc).
- No opacity blending/transitions between overlay videos.
- Overlay shape: square corners only.
- Overlay fit: `contain` inside the overlay box.
- Export resolution: always `1080×1920`.
- Base video fit: `contain` into `1080×1920` (reuse existing behavior).

Preview approach (v1):
- The web preview is still “approximate”.
- Add a **Preview Mode** switch:
  - `Base Video` (current): plays the base video preview; shows a placeholder box for overlay position/size when overlays are present at the current playhead.
  - `Overlay Video`: plays the overlay video preview for the overlay segment active at the playhead (if any).

## 2. Background Color
Add a configurable background color used when neither Video nor Graphics are present at a time range.

- Env/config:
  - `CREATE_VIDEO_BG_COLOR` (default `#000000`)
  - (optional later) `CREATE_VIDEO_BG_ALPHA` (not needed in v1; keep solid)

Behavior:
- If Graphics has a gap → show background color.
- If Video has a gap → show background color.
- If only Video Overlay exists → render it over background color.

## 3. Data Model

### 3.1 Timeline schema additions
Add `videoOverlays` array to `create_video_v1` timeline:

```ts
type CreateVideoVideoOverlayV1 = {
  id: string
  uploadId: number
  // Absolute placement on the timeline:
  startSeconds: number
  endSeconds: number
  // Source trim offsets (same model as base clips):
  sourceStartSeconds: number
  sourceEndSeconds: number

  // Visual placement:
  sizePctWidth: number        // presets (see 3.2)
  position: 'top_left'|'top_center'|'top_right'|'middle_left'|'middle_center'|'middle_right'|'bottom_left'|'bottom_center'|'bottom_right'

  // Audio:
  audioEnabled: boolean       // default false
}
```

Update both:
- backend timeline types/validation (`src/features/create-video/types.ts` + `validateAndNormalizeCreateVideoTimeline`)
- frontend timeline types (`frontend/src/app/createVideo/timelineTypes.ts`)

### 3.2 Presets (v1)
Size presets (pct of frame width):
- `25, 33, 40, 50, 70, 90`

Position presets:
- TL/TC/TR
- ML/MC/MR
- BL/BC/BR

Safe inset:
- Apply a consistent inset (e.g. `4%` of frame) from edges so the overlay doesn’t touch the border.

## 4. UI / UX Changes

### 4.1 Timeline
- Add a labeled lane: `VIDEO OVERLAY` between `GRAPHICS` and `VIDEOS`.
- Allow overlay segments to use:
  - select + handles
  - move/resize
  - split
  - duplicate/delete
  - guideline actions (expand/contract/snap to guideline/playhead)
  - no-overlap collision blocking (same as Graphics)

### 4.2 Add Asset flow
Add a new asset type card in `/assets`:
- `Video Overlay`

Pick mode:
- list **source** videos (same as `/assets/videos`), but on select:
  - insert into `timeline.videoOverlays[]` rather than `timeline.clips[]`

Manage mode:
- no special management page needed in v1 (it reuses Videos as the underlying assets).

### 4.3 Overlay properties modal
Modal for `Video Overlay` segment:
- Start/End micro adjust (same pattern as narration/audio/video)
- Source trim controls (same as base video clip: start/end within source)
- `Audio` toggle (default OFF)
- `Size` preset dropdown
- `Position` preset dropdown

### 4.4 Base video audio vs overlay audio policy
We want a creator-controlled toggle on both layers:
- Base Video segment: `audioEnabled` (default ON if the source has audio, otherwise no-op)
- Video Overlay segment: `audioEnabled` (default OFF)

v1 rule:
- If a base clip and an overlay segment overlap in time and both have audio enabled:
  - **Do not auto-disable**; mix both (simple + consistent).
  - UI should show a small warning in the modal (optional) so creators understand they may get doubled audio.

## 5. Export / Rendering (ffmpeg)

### 5.1 Base visuals
Current pipeline (high level):
- build base `1080×1920` video from clips + background/graphics
- burn PNG overlays (screen titles, lower thirds, logos, graphics/stills) via `burnPngOverlaysIntoMp4`

Changes:
1) Ensure “background color” exists as the true base when there is no video/graphics at a time range.
2) Add a new pass/function: `burnVideoOverlaysIntoMp4`
   - Inputs: base mp4 + overlay segments (download overlay mp4 inputs)
   - Output: mp4 with overlay videos composited
   - Overlay filter uses:
     - `scale` based on `sizePctWidth`
     - `overlay` with `enable='between(t,start,end)'`
     - `force_original_aspect_ratio=decrease` + pad inside overlay region to honor `contain`

Recommended order:
1) base mp4 (background + base clips)
2) graphics (full-frame PNG overlays) — already supported
3) **video overlays** (new)
4) lower thirds
5) logos
6) screen titles (or keep existing ordering; just ensure final stacking matches the chosen z-order)

### 5.2 Export audio
Current pipeline already builds audio mixes for music/narration.
Add overlay-audio support:
- Extract overlay segment audio only when `audioEnabled=true` for that overlay segment.
- Align audio to timeline time range.
- If overlay source is longer than the overlay segment: trim.
- If overlay source is shorter: no looping in v1; pad silence for the remainder of the segment.

Mix strategy (v1):
- base clip audio (if enabled) + narration + music + overlay audio (if enabled)
- apply existing normalization policy (as currently used in Create Video export).

## 6. Preview Behavior (Web)

### 6.1 Preview modes
Add a preview mode toggle:
- `Base` (default):
  - uses the base video source (existing preview)
  - draws a placeholder rectangle for overlay if an overlay is active at the playhead (size/position only)
- `Overlay`:
  - if an overlay segment is active at the playhead:
    - load that overlay upload as the preview source
    - map preview time to `sourceStartSeconds + (playhead - overlay.startSeconds)`
  - if no overlay active: show “No overlay at this time”

### 6.2 Known limitation
We do not attempt to play base + overlay simultaneously in the web preview to avoid iOS autoplay/gesture constraints and sync issues.

## 7. Acceptance Criteria
- User can insert a Video Overlay segment from `/assets` into the timeline.
- Overlay segments: movable/resizable/splittable/duplicable/deletable; no overlap is enforced.
- Overlay audio toggle persists; export includes overlay audio only when enabled.
- Export includes overlay video composited above graphics and base video.
- When base video + graphics are absent, overlay renders over the configured background color.
- Preview supports “Base” vs “Overlay” modes and shows placeholder overlay box in Base mode.

## 8. Open Questions (defer unless blocking)
Resolved for v1:
1) **Contain padding color** (letterbox/pillarbox inside the overlay box): default to black. Keep configurable later if needed.
   - Note: this is different from a **border/frame** around the overlay box. A border (color + thickness) is a good UX feature for distinguishing the overlay from the background, but it is deferred to a later plan.
2) **Looping**: no looping. Overlay video/audio plays through according to the timeline and cannot loop past its segment bounds.
3) **Rounded corners / drop shadow**: none in v1.
