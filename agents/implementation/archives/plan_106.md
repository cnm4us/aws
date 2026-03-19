# Plan 106: Visualizer Placement + Scaling Controls

## Goal
Add **positioning and sizing controls** to visualizer segments (not presets), modeled after the Graphics “Positioned” controls. Visualizer presets remain purely stylistic. Ensure resizing **scales** the visualizer (no cropping) via a `Contain` fit mode.

## Decisions
- Presets keep **style/appearance** only.
- Segment properties define **placement** (grid + inset) and **size** (width/height %).
- New `fitMode` on visualizer segments: `contain` (default) and optional `cover`.
- No mode selector in UI; visualizer placement is always “positioned.”

## Data Model
Add to `visualizer_segment` (timeline item):
- `sizePctWidth` (number, default 100)
- `sizePctHeight` (number, default 100)
- `insetXPx` (number, default 0)
- `insetYPx` (number, default 0)
- `position` (`top_left`, `top_center`, `top_right`, `middle_left`, `middle_center`, `middle_right`, `bottom_left`, `bottom_center`, `bottom_right`)
- `fitMode` (`contain` | `cover`) default `contain`

## Phase A — Types + Validation
1. Extend client types:
   - `frontend/src/app/createVideo/timelineTypes.ts`
   - `src/features/create-video/types.ts`
2. Server validation:
   - `src/features/create-video/validate.ts`
   - Clamp bounds:
     - `sizePctWidth/Height`: 10–100
     - `insetXPx/insetYPx`: 0–200 (initial)
     - `position`: 3×3 grid values
     - `fitMode`: `contain` | `cover`
3. Normalize defaults on load:
   - If missing, set defaults in `timelineTypes.ts` normalization.

## Phase B — Editor UI (Visualizer Properties)
1. Add placement controls to **Visualizer Properties** modal:
   - `Size (% width)` slider/input
   - `Size (% height)` slider/input
   - `Inset X (px)` + `Inset Y (px)`
   - 3×3 grid picker
   - Fit Mode (Contain/Cover)
2. Reuse styles/layout from Graphics Positioned controls for familiarity.

## Phase C — Rendering (Preview)
1. Update visualizer preview render box to respect:
   - `sizePctWidth/Height` and `position`
   - `insetXPx/Y`
   - `fitMode`
2. Ensure **Contain** scales the visualizer to fit the bounding box (no cropping).

## Phase D — Timeline Interactions
1. When trimming/moving visualizer segments, preserve placement values.
2. “Rebind” keeps placement intact.

## Phase E — Export (FFmpeg)
1. Map placement controls to overlay filters:
   - Convert `position + inset` into `x,y` values
   - Scale visualizer layer to `sizePctWidth/Height` before overlay
2. `fitMode=contain`: scale with `force_original_aspect_ratio=decrease`.

## QA Checklist
- Visualizer placement persists across refresh.
- Visualizer scales down without clipping (contain).
- Insets push visualizer inside frame correctly.
- 3×3 grid aligns as expected.
- Export matches preview placement.

