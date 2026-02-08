Plan 93 - Animated Graphics (Slide In/Out)

Goal
- Add an “Animated” graphic mode that slides graphics left→right with configurable duration (ms), while keeping full-frame and positioned modes intact.

Decisions / Assumptions
- Animation is horizontal only: enters from left and exits to the right.
- Animated graphics still use `sizePctWidth` and a vertical placement (top/middle/bottom).
- Duration is in milliseconds via numeric input.
- Animation types: `none`, `slide_in`, `slide_out`, `slide_in_out`.

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
     - Duration input (ms).
     - Vertical placement (top/middle/bottom).
     - Size (% width).
   - Hide grid positions/insets while in Animated mode.

4) Preview Rendering (Create Video)
   - Apply `xOffset` during playback:
     - `slide_in`: offscreen left → 0 over first `durationMs`.
     - `slide_out`: 0 → offscreen right over last `durationMs`.
     - `slide_in_out`: both.
   - Use easeOut for entry, easeIn for exit.

5) Export/Render Parity
   - Update `createVideoExportV1` graphics pipeline to apply the same motion math.

QA / Acceptance
- Animated graphics move left→right with correct vertical placement.
- Duration clamps correctly for short segments.
- Exports match editor preview.

Known Touchpoints
- Frontend: `frontend/src/app/CreateVideo.tsx`, `frontend/src/app/createVideo/timelineTypes.ts`
- Backend: `src/features/create-video/types.ts`, `src/features/create-video/validate.ts`
- Export: `src/media/jobs/createVideoExportV1.ts`
