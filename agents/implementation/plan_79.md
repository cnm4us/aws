# Plan 79 — Freeze Frames for Video Overlays

## Goal
Enable the **same freeze-frame workflow** that exists for base `Video` clips on the **Video Overlay (PiP)** lane, so creators can:
- pause the overlay clip for commentary,
- resume it,
- and interleave base-video + overlay-video freezes for “dialog” style narration.

This plan keeps the existing architectural principle:
> A “freeze” is an **explicit still segment** on the timeline (not hidden marker state).

---

## Current State (Baseline)
- Base video freezes are implemented as **stills** inserted into `timeline.stills` with `sourceClipId`.
- The still image is generated server-side from the upload (via ffmpeg) and stored as an `upload` with `image_role=freeze_frame`.
- The still segment is inserted adjacent to the clip and the timeline is shifted using `rippleInsert(...)` so downstream timing stays aligned.
- Export renders stills as part of the base composite and preview shows them as the topmost still overlay while the playhead is in the still window.

---

## Proposed Model for Overlay Freezes
### Timeline schema
Add a new list for overlay freezes:
- `timeline.videoOverlayStills: VideoOverlayStill[]`

Where:
```ts
type VideoOverlayStill = {
  id: string
  uploadId: number           // freeze-frame image upload (image_role=freeze_frame)
  startSeconds: number       // timeline time
  endSeconds: number         // timeline time
  sourceVideoOverlayId?: string // id of the overlay clip this was derived from (optional but useful)
}
```

**Why a separate array?**
- Base stills render full-frame (base lane semantics).
- Overlay stills must render **inside the overlay box** (PiP semantics) and must participate in **overlay-lane collision rules**.

### Lane / overlap rules
- Overlay lane “no overlaps” should treat **video overlays + overlay stills as one unified occupancy**.
  - i.e., `videoOverlays` and `videoOverlayStills` cannot overlap each other.
- Overlay stills should be draggable/resizable/splittable/deleteable using the same timeline UX patterns as base stills.

---

## UX / UI
### Insert actions (Video Overlay → Properties)
Add two buttons to `Video Overlay → Properties`:
- `First Frame Freeze` (inserts a still **before** the overlay segment, shifting overlay segment right by N seconds)
- `Last Frame Freeze` (inserts a still **after** the overlay segment)

Defaults:
- Duration is fixed at `2.0s` (same as current base clip freeze insertion behavior).

### Preview behavior
- When playhead is inside a `videoOverlayStill`:
  - overlay video element should be paused (or not advanced),
  - show the still image inside the overlay box at the overlay’s current size/position settings.
- The base preview (video/graphics/etc) should continue to render normally underneath.

### Playback boundary rules (web preview)
- Treat overlay stills as “non-video” (no user-gesture boundary required).
- The playhead should only stop at boundaries that require starting a video element (base clip start or overlay clip start) per existing gesture policy.

---

## Export / ffmpeg
### Rendering order (unchanged)
1) Base video lane (clips + base stills)
2) Graphics
3) Video Overlays (clips + overlay stills)
4) Screen Titles
5) Lower Thirds
6) Logos

### Overlay still rendering
- For each overlay still segment:
  - treat it like a “PiP input” (image) with `enable='between(t,start,end)'`,
  - scale/position exactly like overlay video clips (contain within box).

---

## Implementation Steps
### Step 1 — Types + migration
1) Update `frontend/src/app/createVideo/timelineTypes.ts`:
   - add `VideoOverlayStill` type
   - extend `Timeline` to include `videoOverlayStills?: VideoOverlayStill[]` (default empty).
2) Update CreateVideo project load/init:
   - ensure `timeline.videoOverlayStills` is always an array.
3) Ensure server-side timeline schema acceptance allows the new field (validation / persistence).

### Step 2 — Timeline editing primitives
1) Extend collision checks for overlay lane to include `videoOverlayStills`.
2) Add selection + context menu support for overlay still pills (same features as other timeline objects).
3) Add resize/drag/split/duplicate/delete for overlay stills.
4) Ensure `rippleInsert(...)` shifts `videoOverlayStills` just like other lanes.

### Step 3 — Freeze insertion for overlay clips
1) Add `insertVideoOverlayFreezeStill(which: 'first'|'last')` mirroring `insertFreezeStill(...)` but:
   - target overlay clip (`videoOverlays[idx]`)
   - use overlay clip’s `sourceStartSeconds/sourceEndSeconds` to pick frame:
     - first: `sourceStartSeconds`
     - last: `sourceEndSeconds - 0.05`
   - generate freeze-frame upload via the existing “waitForFreezeFrameUpload(uploadId, atSeconds)” helper.
2) Insert a `VideoOverlayStill` into `timeline.videoOverlayStills`.
3) Apply `rippleInsert(...)` at the insertion point for global alignment.

### Step 4 — Preview rendering
1) Compute `activeOverlayStillAtPlayhead` and prefer it over overlay-video playback when present.
2) Render overlay still image within overlay box using the same box sizing/position logic.

### Step 5 — Export support
1) Extend create-video export pipeline input model to include `videoOverlayStills`.
2) Add ffmpeg overlay filters for overlay still segments.
3) Ensure still inputs use `image2` (or pre-generated PNG/JPG files) consistent with existing still rendering.

### Step 6 — QA / verification checklist
- Insert first/last freeze for overlay:
  - overlay still appears on overlay lane,
  - overlay clip shifts appropriately,
  - downstream objects maintain relative timing (ripple).
- Preview:
  - overlay still shows inside overlay box,
  - base content continues underneath,
  - playhead boundaries behave (no extra stops on still boundaries).
- Export:
  - overlay freezes render correctly, and subsequent overlay clips still appear after split.

---

## Open Issues / Decisions
1) **Should overlay freezes reuse the exact same fixed duration (2.0s) as base?**
   - Proposed: yes for v1 (matches existing UX), later we can add duration selector.

2) **Do we want overlay freeze stills to inherit any per-overlay visual framing?**
   - Defer: keep identical to overlay’s box rendering (no extra border/shadow).

3) **Back-compat timelines**
   - Old projects won’t have `videoOverlayStills`. Default to `[]`.

