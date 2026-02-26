# Plan 76 — Ripple-Right (Commit) for Timeline Lanes

## Goal
Add an optional **Ripple** mode to Create Video that lets creators **insert / extend** objects without manually creating gaps. When enabled, operations that would overlap the next object on the same lane will **push later objects to the right** (cascade) until there are no overlaps, extending the timeline as needed (up to 20 minutes).

This is **ripple-right only** (no ripple-left). Left-collisions remain blocked.

## Scope (v1)
### Included operations (when Ripple=ON)
1) **Insert** into a lane at the playhead (or selected insertion point): if it overlaps the next object, push next objects right.
2) **Resize-right** (dragging the right handle/end edge): if it overlaps the next object, push next objects right.
3) **Move-right** (body drag): if it overlaps the next object, push next objects right.

### Not included (defer)
- Ripple-left.
- Live ripple animation. This is **commit ripple**: compute/apply on pointer-up / on insert confirmation.

## Lanes / Object Types
Ripple is **lane-local** and applies to each lane’s own objects:
- Logos
- Lower Thirds
- Screen Titles
- Graphics
- Video Overlays
- Videos (base clips + still freeze segments count as the base lane)
- Narration
- Audio/Music

No lane-cross effects (e.g., moving a graphic never pushes video lane).

## Constraints
- Maintain **no overlaps** within a lane after applying ripple.
- Preserve each object’s **internal trim** values (e.g., `sourceStartSeconds/sourceEndSeconds`) unless the operation itself changes them (e.g., resizing a video segment may still adjust `sourceEndSeconds` if that’s how we model it today).
- **Max project duration**: 20 minutes (1200s). If ripple would exceed this cap, block and show an inline error.
- Respect the existing **0.5s viewport pad** behavior (timeline auto-extends visually).

## UX / UI
### Ripple Toggle
- Add a small toggle/button near top controls:
  - `Ripple: OFF` / `Ripple: ON`
- Default `OFF`.
- Persist per-device (localStorage), not server.

### Visual Feedback (Commit Ripple)
While dragging resize-right:
- If ripple would happen, show a small indicator near the playhead:
  - `Ripple: +N.Ns`
- Do not animate objects live.
On pointer-up:
- Apply ripple in one atomic timeline update.

For Insert:
- If insert causes ripple, optionally show a short toast:
  - `Ripple pushed N item(s)`

## Algorithm
### Core helper (lane-local)
Create a reusable helper:
- Input:
  - `items[]` sorted by `startSeconds`
  - `startIndex` of the item being inserted/resized (the “source” item)
  - `minGap = 0` (no overlap; we can keep 0.0)
  - `maxEnd = 1200`
- Output:
  - `items[]` with later items shifted right so `items[i].start >= items[i-1].end`
  - `deltaTotal` amount of push applied
  - `pushedCount`

Pseudo:
1) Ensure items are sorted and have valid end.
2) Starting from `i = startIndex + 1`, compute overlap:
   - `neededStart = prev.end + minGap`
   - if `cur.start < neededStart`, shift `cur.start += (neededStart - cur.start)` and `cur.end += sameDelta`
3) Continue cascading.
4) If any `end > maxEnd`, fail.

### Lane end calculation
After ripple, recompute lane end and update `timeline.viewportEndSeconds` if needed (as we already do with drag past end).

## Implementation Steps
1) **Plan plumbing**
   - Add ripple toggle state + localStorage persistence in `frontend/src/app/CreateVideo.tsx`.

2) **Add shared helpers**
   - Implement `rippleRightLane(items, startIndex, maxEndSeconds)` returning `{ items, rippleDeltaSeconds, pushedCount }`.
   - Helpers to get/set lane arrays (graphics/logos/etc.) without duplicating logic.

3) **Resize-right integration (first lane: Graphics)**
   - On pointer-up for a graphics resize-right drag:
     - If Ripple OFF: keep existing behavior.
     - If Ripple ON:
       - Apply the resize, then run rippleRight starting at that item index.
       - Persist as one snapshot/undo entry.
   - Add indicator while dragging: compute prospective ripple delta without mutating.

4) **Expand to other lanes**
   - LowerThirds, Logos, ScreenTitles, Narration, Audio/Music, VideoOverlay, Clips, Stills.
   - For base lane (clips + stills), treat the lane as a single ordered list by startSeconds:
     - If resizing a clip end collides with a still, the still is pushed, and may in turn push later clips/stills.
     - Maintain still/clip type when shifting.

5) **Insert integration**
   - When the user selects an asset from `/assets/*?mode=pick`, the Create Video insert handler should:
     - Create the new segment at the playhead.
     - If it overlaps the next object in lane:
       - If Ripple OFF: clamp duration to fit (existing #2 behavior) OR block (depending on current behavior per lane).
       - If Ripple ON: insert at desired length and rippleRight to push later objects.

6) **Move-right integration**
   - For each lane that supports body-drag move:
     - While dragging: maintain current “blocked by collision” behavior (do not move other objects).
     - On pointer-up (commit):
       - If Ripple OFF: keep existing behavior.
       - If Ripple ON:
         - Apply the move result, then run rippleRight starting at that item index.
         - If the move result collided on the left (would overlap previous item), block as we do today (no ripple-left).
         - Persist as one snapshot/undo entry.
   - Visual cue: show `Ripple: +N.Ns` if commit ripple will push items.

7) **Edge cases**
   - If ripple would exceed 20 minutes: block and toast `Timeline max length reached`.
   - Ensure undo/redo treats the ripple as a single atomic change.

8) **Validation / Testing**
   - Manual:
     - Create A gap between A and B, insert longer object, verify B shifts.
     - Resize-right of A into B, verify B shifts, then C shifts, etc.
     - Verify timeline end extends and persists after refresh.
     - Verify max duration blocks.
   - Run:
     - `npm run build`
     - `npm run web:build`

## Notes / Follow-ups (defer)
- Live ripple animation (objects move while dragging).
- Ripple-left.
- UI affordance for “only ripple insert” vs “ripple resize too”.
