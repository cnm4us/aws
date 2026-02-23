# Implementation Plan 104: Timeline Action Menu Arrows + Blocking Error Modal

## Goal
Replace the current terminal‑end action menu with a compact **Move** and **Expand/Contract** control that uses arrow icons and a single snap‑target toggle (T/G/O). Add a reusable blocking error modal for timeline errors, while keeping non‑blocking feedback inline.

## Decisions (Confirmed)
- Two labeled groups: `Move` and `Expand/Contract`.
- Each group has left/right arrows.
- Snap target is a single toggle cycling `T` (Timeline), `G` (Guideline), `O` (Object boundary, same lane), `O*` (Object boundary, any lane).
- `O` targets **same lane only**.
- `O*` targets **any lane**.
- If no target exists in the chosen direction, fall back to the timeline edge.
- Only **blocking** errors get modal treatment; non‑blocking feedback remains inline.
- Use existing icon `frontend/src/app/icons/arrow.svg` (black → white, flipped as needed).

## Phase A — UI Restructure (Context Menu)
1. **Update `TimelineContextMenu` layout**
   - Replace the current `Guidelines / Playhead / Timeline` sections with:
     - `Move` label + left/right arrow buttons.
     - `Expand/Contract` label + left/right arrow buttons.
   - Add a compact snap‑target toggle (T/G/O/O*) visible once for the menu.
2. **Arrow icon**
   - Use `arrow.svg` for all arrows, white via CSS filter, flip for left direction.
3. **Target toggle UI**
   - Simple button that cycles `T → G → O → O*`.
   - Visible state should be clear (highlight active target).
4. **Keep current menu boundaries and sizing**
   - Ensure menu stays inside viewport (already clamped).

## Phase B — Snap Target Behavior
1. **Add snap target state**
   - Store per‑menu open state (local state inside `TimelineContextMenu`).
2. **Define target resolution per direction**
   - `T`: next boundary is timeline start/end (0 or total seconds).
   - `G`: next guideline in direction; if none, fall back to timeline edge.
   - `O`: next object boundary in direction **on the same lane only**; if none, fall back to timeline edge.
   - `O*`: next object boundary in direction **on any lane**; if none, fall back to timeline edge.
3. **Implement Move**
   - Shift entire object to next target boundary (duration constant).
4. **Implement Expand/Contract**
   - Move selected edge toward next target boundary (duration changes).
5. **Use existing helpers where possible**
   - Reuse guideline logic for `G`.
   - For `O`, compute nearest segment boundary on same lane (start/end arrays).

## Phase C — Blocking Timeline Error Modal
1. **Add error modal component**
   - Controlled by new state (e.g., `timelineErrorModal`).
   - Dismiss‑required (close button).
   - Use modal styling from `agents/styles/modal-properties.md`.
2. **Split messaging**
   - Keep current inline `timelineMessage` for non‑blocking info.
   - Replace blocking cases with `setTimelineErrorModal`.
3. **Criteria for blocking**
   - “No room”, “overlap”, “invalid range”, “missing source”, max‑length violations, etc.

## Phase D — QA & Edge Cases
1. **Move / Expand behavior**
   - Verify for each lane type (clip, overlay, still, graphic, logo, lower third, screen title, narration, audio).
2. **Direction fallback**
   - Confirm fallback to timeline edges when no target exists.
3. **Lane scoping**
   - Ensure `O` never snaps to other lanes.
   - Ensure `O*` can snap across lanes.
4. **Modal behavior**
   - Blocking errors show modal; dismiss resets.
   - Non‑blocking messages still appear inline.

## Notes / Files
- `frontend/src/app/CreateVideo.tsx`
- `frontend/src/app/createVideo/modals/TimelineContextMenu.tsx`
- `frontend/src/app/icons/arrow.svg`
- Modal styling reference: `agents/styles/modal-properties.md`
