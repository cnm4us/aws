# Plan 91 — Create Clip Layout Refresh (Compact Controls + CC Overlay + Time Row)

## 1. Overview
Goal: Redesign `/library/create-clip/:id` to reduce vertical space and improve control ergonomics: thin progress bar under video, CC overlay on the video, waveform scrubber full-width, compact time/clip-length row, and a consolidated control row (`Set In`, `-10s`, `Play/Pause`, `+10s`, `Set Out`). Keep transcript search/results and clip fields below, with save aligned bottom-right.

In scope:
- Frontend layout changes for the create-clip page only.
- CC button as top-right video overlay; captions render as a single active cue overlay on the video when enabled.
- Progress bar styling/location change (thin gold/gray line under video).
- Waveform row without nudges; waveform remains fine scrubber with fixed playhead.
- Time row with left/right alignment: `current/total` (left) and `Clip: length (5s–180s)` (right), with responsive wrap.
- Controls row reordered and relocated as specified.

Out of scope:
- Backend changes.
- Search algorithm changes (stemming/lemmatization).
- New feature flags or routing changes.

## 2. Step-by-Step Plan

1. Add CC overlay + active-cue caption overlay
   Status: Completed
   Implementation:
   - Move CC toggle into a top-right overlay button on the video container.
   - Replace the captions panel with an overlay that renders only the active cue when enabled.
   - Ensure captions overlay does not block controls (pointer-events none).
   Testing:
   - Manual: toggle CC on/off; active cue appears over video; no panel below.
   - Record actual notes: `agents/implementation/tests/plan_91/step_01_cc_overlay.md` (pending).
   Checkpoint: Wait for developer approval before proceeding.

2. Progress bar position + styling
   Status: Completed
   Implementation:
   - Move the progress bar to a thin line directly under the video, full width.
   - Use gold for progress, gray for remaining; keep the same draggable handle.
   Testing:
   - Manual: progress bar scrubs correctly; visual style is thin and attached to the video.
   - Record actual notes: `agents/implementation/tests/plan_91/step_02_progress.md` (pending).
   Checkpoint: Wait for developer approval before proceeding.

3. Waveform row + time/clip-length row
   Status: Completed
   Implementation:
   - Keep waveform full width (no nudges in this row).
   - Add a single-row time line below waveform: left `current / total`, right `Clip: length (5s–180s)`; allow wrapping on narrow screens.
   - Ensure tabular numerals for stable alignment.
   Testing:
   - Manual: waveform scrubbing still works; time row aligns left/right; wraps on narrow screens without overflow.
   - Record actual notes: `agents/implementation/tests/plan_91/step_03_wave_time.md` (pending).
   Checkpoint: Wait for developer approval before proceeding.

4. Controls row re-layout (Set In / -10 / Play / +10 / Set Out)
   Status: Completed
   Implementation:
   - Move `-10s` and `+10s` buttons into the control row.
   - Keep long-press repeat behavior on nudges.
   - Place row below waveform/time row.
   Testing:
   - Manual: nudges work (press/hold), play/pause works, set in/out still updates clip length.
   - Record actual notes: `agents/implementation/tests/plan_91/step_04_controls.md` (pending).
   Checkpoint: Wait for developer approval before proceeding.

5. Layout compression + save alignment
   Status: Completed
   Implementation:
   - Keep transcript search/results and clip fields below controls.
   - Align Save button to bottom-right of the clip card (or right-aligned row) without overflow.
   - Verify overall vertical space reduced versus previous layout.
   Testing:
   - Manual: page is shorter; no overflow/cropping; save button alignment correct.
   - Record actual notes: `agents/implementation/tests/plan_91/step_05_polish.md` (pending).
   Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes
- Step 1 — Status: Completed — CC overlay + active cue overlay (tests pending).
- Step 2 — Status: Completed — Progress bar moved/styled (tests pending).
- Step 3 — Status: Completed — Waveform row + time/clip-length row (tests pending).
- Step 4 — Status: Completed — Controls row reordered with nudges + play (tests pending).
- Step 5 — Status: Completed — Layout compressed; save aligned right (tests pending).
