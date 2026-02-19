# Plan 101: Show Only Non‑Empty Timeline Lanes

## Goals
- Collapse/hidden lanes that have no objects to reduce vertical space.
- Keep lane order fixed for any visible lanes.
- Preserve existing add flow: the **+ Add** panel still shows all asset types.
- Provide a user toggle to show empty lanes when desired.
- Always show Ruler, Waveform, Playhead number, and redline even with zero assets.
- Display a friendly empty-state message when no lanes are visible.

## Phase A — Lane Visibility Rules + Toggle
1. Add a `showEmptyLanes` boolean UI state (default: `false`).
2. Compute lane visibility per type based on whether there is at least one object in that lane.
3. If `showEmptyLanes === true`, show all lanes as today.
4. If `showEmptyLanes === false`, render only lanes with assets.
5. Add a small toggle button near the timeline controls:
   - Label: `Show Empty Lanes` (on/off state).
   - Match existing button style (outline + on/off background).

## Phase B — Render Order + Layout Stability
1. Preserve current fixed lane order when lanes are visible:
   - Logo
   - Lower Thirds
   - Screen Titles
   - Video Overlay
   - Graphics
   - Videos
   - Narration
   - Audio/Music
2. Recompute Y positions and `TIMELINE_H` based only on visible lanes (plus ruler + waveform).
3. Ensure object hit‑tests, drag boundaries, and row detection use the new per‑lane Y offsets.
4. Keep the playhead redline spanning the full visible timeline height.

## Phase C — Empty State UX
1. When no lanes are visible (and `showEmptyLanes` is off), render a centered message:
   - “No layers yet — add an asset”
2. Keep ruler + waveform + playhead number + redline visible.

## Phase D — Action Menus + Edge Cases
1. Lane‑specific actions (Expand/Contract/Snap) apply only to existing objects.
2. Since lanes are hidden only when empty, no new guardrails are needed.
3. Ensure the `+ Add` panel still shows all asset types.

## Test Checklist
- Add an asset → lane appears in correct order.
- Remove the last asset → lane disappears immediately.
- Toggle “Show Empty Lanes” reveals all lanes; toggling off collapses empty lanes again.
- Drag/resize still works with new lane positions.
- Empty timeline shows ruler/waveform/playhead and empty‑state message.

## Open Questions (Resolved)
- Empty lanes completely hidden: **Yes**
- Collapse immediately when last item removed: **Yes**
- Add panel shows all asset types: **Yes**
- Preserve fixed lane order: **Yes**
- Toggle for empty lanes: **Yes**
- Empty state message: **Yes** (“No layers yet — add an asset”)
