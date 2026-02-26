# Plan 100: Timeline Zoom (Create Video)

## Goals
- Add a zoom control to the create-video timeline so users can zoom out to see more time at once and zoom in for precision edits.
- Preserve playhead context when zoom changes (no jarring jump).
- Keep existing edit interactions intact (drag, resize, snap, ripple).

## Non-goals
- No changes to lane visibility or lane creation rules.
- No changes to timeline data model beyond UI state.

## Assumptions
- Timeline rendering is driven by `pxPerSecond` and `visualTotalSeconds` (already true in `CreateVideo.tsx`).
- We can safely scale `pxPerSecond` for zoom without breaking backend data.

## Phase A — Zoom State + UI Control
1. Add a `timelineZoom` state (range: `0.25`–`2.0`) with a default of `1.0`.
2. Add a compact control near the timeline header: `-` and `+` buttons with a small label (e.g., `Zoom 100%`).
3. Clamp zoom to a sensible range:
   - `0.25` (zoomed out) to `2.0` (zoomed in).
   - Buttons adjust by `0.1`.

## Phase B — Bind Zoom to Timeline Scale
1. Introduce a derived `pxPerSecondZoomed = pxPerSecond * timelineZoom`.
2. Use `pxPerSecondZoomed` anywhere we compute timeline width and convert time→pixels.
3. Keep `pxPerSecond` unchanged for data logic; only the rendering uses the zoomed value.

## Phase C — Anchoring & Interaction Safety
1. On zoom change, preserve the playhead’s visual position:
   - Compute current playhead pixel position before zoom.
   - After zoom, adjust scrollLeft so playhead stays centered (or stays at same screen x if centered isn’t possible).
2. Ensure minimum width for objects (for clickability), e.g., `min-width: 6px`.
3. Validate that drag/resize/snap still works at extreme zoom levels.

## Phase D — Polish
1. Add quick reset to `100%` (double-click label or a reset button).
2. Reset zoom on refresh (no persistence).
3. Keep styling consistent with existing timeline controls.

## Test Checklist
- Zoom in/out does not jump playhead away from current view.
- Drag/resize works at min and max zoom.
- Scrub/playhead alignment remains accurate.
- Timeline width and scroll behave correctly with zoom.
- No changes to saved timeline data.

## Open Questions
- Confirmed: allow `0.25x` zoom (shows ~4x more time than default).
