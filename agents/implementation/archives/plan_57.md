# Plan 57: Filmstrip-First Editing (Continuous Scroll + Replace Blue Bar)

## Goal
Make the thumbnail filmstrip the primary timeline representation in `/edit-video` by:
1) making filmstrip movement **continuous** (moves on every 0.1s nudge / scrub, not only per-second)
2) moving segment visualization + selection to the filmstrip
3) removing the blue “segment bar” row entirely

This keeps the existing controls (Split/Delete/Undo/Save + scrubber + 0.1s nudges) but uses the filmstrip as the user’s mental model of the timeline.

## Constraints / Decisions
- Thumbnails stay at **1 second** interval (no regen / no higher FPS thumbs).
- Playhead stays fixed in the center.
- Edits remain stored as `ranges` (original-time ranges).
- Ripple delete semantics stay unchanged.
- Mobile-first touch targets.

## Phase A — Continuous filmstrip scrolling (no UI removal yet)
### 1) Continuous mapping from time → scrollLeft
Update the filmstrip scroll mapping in `frontend/src/app/EditVideo.tsx`:
- Current: `idx = floor(playheadEdited / intervalSeconds)` then `scrollLeft = idx * tileW`
- New: `scrollLeft = (playheadEdited / intervalSeconds) * tileW`

Notes:
- Keep the existing “snap to end” behavior: if `playheadEdited` is at end, set `scrollLeft = maxScrollLeft`.
- Clamp to `[0, maxScrollLeft]`.

Expected behavior:
- Each 0.1s nudge shifts the filmstrip by ~`tileW/10` pixels.
- The displayed image updates only when the time crosses a new second, but the playhead alignment feels precise.

### 2) Keep thumbnail click seeking
Clicking a thumb still seeks to its second boundary:
- `seekEdited(i * intervalSeconds)`

## Phase B — Filmstrip becomes the segment bar
### 3) Segment boundaries + selection rendered on filmstrip
Replace the blue bar’s role by rendering overlays on the filmstrip:
- Compute segment boundaries in edited time:
  - For each segment `ranges[i]`, compute `editedStart` and `editedEnd` (using `segmentEditedStarts` + segment length).
- Convert edited boundaries to “thumb indices”:
  - `thumbIndex = floor(editedSecond / intervalSeconds)`
- Render:
  - Vertical divider line at each boundary between thumbs.
  - Selected segment: apply a subtle highlight overlay on thumbnails that fall within that segment’s index range.

Implementation approach:
- Wrap each thumb in a container div that can draw:
  - left boundary (if this thumb begins a segment)
  - selected overlay
- Keep it lightweight: no canvas required.

### 4) Filmstrip click selects segment
When a user clicks a thumb:
- Seek to that time as today.
- Also set `selectedIndex` based on where that time lands in edited time.
  - Determine edited time `tEdited = i * intervalSeconds`.
  - Find segment containing that edited time (use the existing `editedToOriginalTime` which returns `segIndex`).

### 5) Remove the blue segment bar row
After filmstrip shows boundaries + selection, remove the old “segments drawn proportionally” bar completely.

## Phase C — Polish (MVP)
### 6) Keep scrubber + nudge controls in sync
- Scrubber moves playhead (already true) and filmstrip scroll updates continuously.
- Nudge arrows update playhead (already true) and filmstrip moves smoothly.

### 7) Safety valve for long videos
If thumbs are not yet available (manifest 404):
- Show “Generating thumbnails…” and keep the old scrubber + split/delete functional.
- Segment selection stays usable via controls even without filmstrip.

## Manual test checklist
1) Open `/edit-video?upload=<id>` with thumbs available.
2) Nudge ±0.1s: filmstrip should move slightly each press (not 1s jumps).
3) Scrub to end: last frame aligns under playhead with blank pad on right.
4) Split: boundary markers appear on filmstrip.
5) Click a thumb inside a segment: segment selection updates (highlight).
6) Delete: filmstrip reflects ripple delete; boundaries update.
7) Undo: filmstrip returns to prior state.
8) Blue bar is removed; filmstrip is the only segment visualization.

