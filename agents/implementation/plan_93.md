Plan 93 - Animated Graphics (Slide In/Out)

Goal
- Add an “Animated” graphic mode that slides graphics left→right with configurable duration (ms), while keeping full-frame and positioned modes intact.
- Add a second animated preset, “Document Reveal,” for full-screen documents (zoom + fade) with minimal configuration.

Decisions / Assumptions
- Animation is horizontal only: enters from left and exits to the right.
- Animated graphics still use `sizePctWidth` and a vertical placement (top/middle/bottom).
- Duration is in milliseconds via numeric input.
- Animation types: `none`, `slide_in`, `slide_out`, `slide_in_out`.
- Document Reveal is a distinct preset with fixed assumptions:
  - Designed for 1080x1920 documents.
  - No size/position controls; starts at 20% scale with low opacity.
  - Fades + zooms to full-screen, then reverses on exit.

Plan
1) Data Model + Validation
   - Extend graphic schema with `animate` and `animateDurationMs`.
   - Clamp duration to `100–2000ms` and `<= segmentLengthMs * 0.45`.
   - Persist defaults: `animate = none`, `animateDurationMs = 400`.

2) Frontend Types + Timeline Serialization
   - Update `Graphic` type + `cloneTimeline` to carry `animate` + `animateDurationMs`.
   - For animated graphics, use `position` limited to `top_center|middle_center|bottom_center` and keep `sizePctWidth`.

3) Editor UX (Graphic Mode)
   - Add a mode switch in the graphic editor: `Full Frame | Positioned | Animated`.
   - Animated mode shows:
     - Animation type dropdown (incl. `slide_in_out`).
     - New preset option: `Document Reveal`.
     - Duration input (ms).
     - Vertical placement (top/middle/bottom).
     - Size (% width).
   - Hide grid positions/insets while in Animated mode.
   - When `Document Reveal` is selected:
     - Hide size/position.
     - Show a hint: “Designed for portrait documents (1080×1920).”

4) Preview Rendering (Create Video)
   - Apply `xOffset` during playback:
     - `slide_in`: offscreen left → 0 over first `durationMs`.
     - `slide_out`: 0 → offscreen right over last `durationMs`.
     - `slide_in_out`: both.
   - Use easeOut for entry, easeIn for exit.
   - Add `Document Reveal` preview:
     - Scale from 0.2 → 1.0 and opacity 0 → 1.0 on entry.
     - Reverse on exit.
     - Optional slight left→center translation for polish.

5) Export/Render Parity
   - Update `createVideoExportV1` graphics pipeline to apply the same motion math.
   - Document Reveal uses ffmpeg scale/overlay expressions + fade to match preview.

QA / Acceptance
- Animated graphics move left→right with correct vertical placement.
- Duration clamps correctly for short segments.
- Exports match editor preview.
- Document Reveal behaves as described and ignores size/position inputs.

Known Touchpoints
- Frontend: `frontend/src/app/CreateVideo.tsx`, `frontend/src/app/createVideo/timelineTypes.ts`
- Backend: `src/features/create-video/types.ts`, `src/features/create-video/validate.ts`
- Export: `src/media/jobs/createVideoExportV1.ts`
