# Plan 56: Fixed-Playhead Timeline Padding (t=0 / t=end Alignment)

## Goal
Improve `/edit-video` timeline UX so the thumbnail film strip aligns to a **fixed center playhead** while still allowing:
- playhead at **t=0** (blank space to the left)
- playhead at **t=end** (blank space to the right)

We keep the existing **scrubber** + **0.1s nudges** as the primary controls (film strip remains non-draggable for now).

## Current issue
The timeline currently “centers” the playhead by auto-scrolling the strip, which:
- prevents a true “start at playhead” layout
- makes t=0 and t=end feel cramped (no blank space)

## Scope (MVP)
- Add left/right “spacer” padding to the film strip equal to **half the visible strip width**
- Change the scroll positioning logic so:
  - `scrollLeft=0` corresponds to **t=0 under the playhead**
  - the end allows **t=end under the playhead**
- Keep existing editor behavior: split/select/delete/undo/save

Out of scope:
- Finger-drag scrub via film strip (we can add later)
- Removing the blue segment bar / replacing it with thumb-based selection (separate plan)

## Frontend changes (EditVideo)
### 1) Timeline container + spacers
In `frontend/src/app/EditVideo.tsx`:
- Add a `timelineViewportRef` to measure `clientWidth`
- Introduce `timelinePadPx = Math.floor(viewportWidth / 2)`
- Apply padding via either:
  - `paddingLeft/paddingRight` on the inner flex row, or
  - explicit left/right spacer divs of `width: timelinePadPx`

### 2) Scroll mapping update
Replace “center selected tile” scrolling with a deterministic mapping:
- For an edited-time `tEdited` (seconds), choose a representative thumb index `i`:
  - `i = clamp(floor(tEdited / intervalSeconds), 0, thumbs.length - 1)`
- Set `scrollLeft = i * tileW`

This ensures:
- at `t=0`, `i=0`, `scrollLeft=0` ⇒ pad shows blank left area
- at `t=end`, scroll reaches max ⇒ pad shows blank right area

### 3) Keep controls in sync
- When the user scrubs the range input: update `playheadEdited`, seek the proxy video, then set `scrollLeft` using the mapping above.
- When video plays/timeupdates: update `playheadEdited` and keep the strip scrolled so the current second stays under the playhead.
  - Use a small hysteresis guard to avoid excessive `scrollTo` calls (optional).

### 4) Click-to-seek on a thumbnail
Update the thumbnail click handler to seek to the clicked thumb’s **time under playhead**:
- If thumb `i` is clicked, seek to `tEdited = i * intervalSeconds` (clamped).

### 5) Remove the “inner red line” from the strip
Keep a single fixed playhead line for the film strip (center overlay), and remove any redundant playhead indicators inside the strip itself (if present).

## Manual test checklist
1) Open `/edit-video?upload=<id>`
2) Confirm at load:
   - first thumbnail starts under the playhead
   - left side is blank space
3) Scrub to end:
   - last thumbnail can align under playhead
   - right side is blank space
4) Split/delete/undo still works and does not break strip alignment
5) Save returns to `/produce` as before

