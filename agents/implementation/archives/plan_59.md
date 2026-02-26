# Plan 59: Viewport-Sized Audio Waveform (Scales to 20+ Minutes)

## Goal
Replace the current “full-width canvas” waveform rendering in `/edit-video` with a **viewport-sized canvas** that redraws only the visible window. This avoids browser canvas/texture limits (e.g. ~16k/32k px) and keeps performance predictable for long videos (e.g. 20 minutes).

## Current Problem
- Timeline uses a fixed zoom (`pxPerSecond=96`).
- A 15–20 minute timeline implies ~86k–115k px content width.
- A canvas sized to the full strip width will exceed browser/GPU limits and can render blank/white (or show broken artifacts), even if the envelope JSON is correct.

## Desired Behavior
- Waveform is always visible for long videos.
- Waveform remains aligned to the timeline (red playhead stays correct).
- Waveform “ripples” with edits (rendered in **edited-time space**, using the kept ranges).
- No change to envelope generation pipeline or API.

## Approach (Viewport Canvas Overlay)
Instead of putting `<canvas>` inside the scrolling strip (and making it as wide as the strip), we:
1) Render a fixed overlay container above the track row, sized to the **visible viewport**.
2) Draw waveform samples for only the time window currently visible.

Key mapping (matches how the timeline is padded to keep playhead fixed at center):
- Let `padPx = timelinePadPx` (≈ half of scroller viewport width)
- Let `scrollLeft = timelineScrollRef.current.scrollLeft`
- For any edited-time `tEdited`, the on-screen X (in pixels) is:
  - `x = padPx + tEdited * pxPerSecond - scrollLeft`
- Visible edited-time window:
  - `tStart = (0 + scrollLeft - padPx) / pxPerSecond`
  - `tEnd   = (viewportWidth + scrollLeft - padPx) / pxPerSecond`

## Phase A — Refactor waveform rendering to “viewport mode”
1) **Move waveform canvas out of the strip content**
   - Create a new overlay `div` positioned over the middle track row area:
     - `position:absolute; left:0; right:0; top:<trackTopPx>; height:trackH; pointer-events:none; overflow:hidden;`
   - Place a canvas inside sized to the overlay’s **clientWidth** (viewport width), not the strip width.

2) **Precompute envelope values array once**
   - When envelope JSON loads:
     - Build a dense `vals[]` array indexed by `idx = round(t / intervalSeconds)` containing `v in [0..1]`.
   - Keep this in `useMemo` to avoid rebuilding on every redraw.

3) **Compute “edited window” and draw only the window**
   - On redraw, compute `tStart/tEnd` from `scrollLeft/padPx/pxPerSecond`.
   - For each kept segment `seg = {start,end}` (original-time):
     - Determine overlap of the edited-time window with this segment’s edited-time span.
     - For overlapping portion, sample at envelope interval:
       - Map edited-time to original-time: `tOrig = seg.start + (tEdited - segEditedStart)`
       - Lookup `vals[idx]` for `tOrig`.
       - Convert `tEdited` to viewport X via `x = padPx + tEdited*pps - scrollLeft`.
   - Draw a single polyline (line-only, as requested).

4) **Redraw triggers**
   - Redraw when:
     - `playheadEdited` changes (timeupdate)
     - `ranges` change (split/delete/undo)
     - `timelinePadPx` changes (resize/orientation)
     - `audioEnvelope` loads/changes
   - Add a small `requestAnimationFrame` throttle so multiple triggers in one frame only draw once.

## Phase B — Long-video performance hardening (still “viewport mode”)
5) **Decimation safety valve**
   - If the visible window spans many seconds (e.g. on large screens), cap samples drawn to ~1500 points:
     - compute `step = ceil(samplesInWindow / 1500)` and skip indices accordingly.

6) **Retain current zoom (pxPerSecond=96)**
   - This plan keeps the existing timeline scale.
   - (Optional later) You can add a zoom control or auto-zoom, but viewport drawing already solves the “20 minute blank waveform” issue.

## Manual test checklist
1) Short (30s) video: waveform looks the same as before.
2) 17–20 minute video:
   - waveform renders (no blank/white canvas artifacts).
   - scrubbing/play keeps waveform aligned with playhead.
3) Split + ripple delete:
   - waveform “ripples” (edited-time continuity).
4) iOS Safari:
   - still renders without needing a huge canvas.

## Notes / Future Hooks
- Once this is in, we can add “silence highlight bands” and “tap waveform to seek” without changing the data model.

