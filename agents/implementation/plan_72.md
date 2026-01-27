# Plan 72 — True PiP Preview (Two Video Elements) + Unified Play + Per-Clip Audio Toggles

## Goal
Add a faithful Create Video preview mode that can play **base video** and **video overlay (PiP)** concurrently using **two `<video>` elements**, driven by a **single Play/Pause button**, while honoring per-segment audio toggles.

This is a preview feature to better match what ffmpeg will render.

## Non-goals (v1)
- Perfect frame-accurate sync between base + overlay in-browser.
- Seamless autoplay across clip boundaries on iOS (we still expect a user tap at boundaries that require `src` changes).
- Multiple overlay videos at once (no overlaps remains enforced).
- Rounded corners / drop shadows / blending.

## UX / Behavior
- One Play/Pause button controls both tracks.
- Base `<video>` renders full-frame.
- Overlay `<video>` renders inside its PiP box (position + size from overlay properties).
- Audio is controlled by toggles:
  - Base clip: `audioEnabled` (new; default `true`)
  - Overlay clip: `audioEnabled` (already exists)
- If both audio toggles are enabled at the same time, both audio streams play (intentional feedback).
- Playback stops at boundaries that require a new `src` load (expected on iOS); user taps Play again to continue.

## Data Model Changes
1) Extend base clip model:
- Add `audioEnabled?: boolean` to `Clip` (default `true` when missing).
- Ensure persistence in Create Video projects.

2) Timeline migration/hydration:
- When hydrating a timeline, if a clip is missing `audioEnabled`, set it to `true`.
- No DB schema change required if timeline is stored as JSON; this is a timeline JSON evolution.

## UI Changes
1) Base clip properties modal
- Add an “Audio” toggle (On/Off) for the selected base clip.
- Default `On`.

2) Replace the two video play buttons
- Replace blue + tan video play buttons with a single Play/Pause that drives both tracks.
  - Alternatively, keep the two buttons temporarily behind a feature flag during development, but ship as a single button.

3) Preview display
- Add a second `<video>` element to the preview container:
  - `baseVideoRef`: full-frame
  - `overlayVideoRef`: PiP box, positioned by overlay props
- Keep existing still/graphics/screen title/lower third/logo overlays rendered above base and below overlay, consistent with the chosen layer ordering.

## Playback Architecture (Preview)
### A) Two independent video elements
- Base video element plays base clips.
- Overlay video element plays overlay clips.
- Each element can be `muted` based on segment toggle.

### B) One timeline clock source
Pick a “clock” for playhead updates:
1) If a base clip is active at the playhead: base video is the clock.
2) Else if an overlay clip is active: overlay video is the clock.
3) Else: fall back to synthetic clock (RAF) to traverse gaps (if we decide to support it in this mode).

### C) Drift correction (best-effort)
On each playhead update, compute expected `currentTime` for the *non-clock* video element:
- If it’s within the active segment, keep it playing and re-seek if drift exceeds a threshold (e.g. 0.20s).
- If it’s outside an active segment, pause it and hide it.

### D) Boundary handling
When the clock element reaches the end of its active segment:
- Pause both video elements.
- Set Play button back to Play state.
- Update playhead to the segment end (or next boundary as appropriate).
- User taps Play again to continue.

## Export / ffmpeg Integration (Structure now, implement soon)
We need to preserve the audio toggles so they can drive ffmpeg:
- Add `audioEnabled` to the export JSON for base clips and overlays.
- In ffmpeg:
  - If a base clip has `audioEnabled=false`, its audio contribution becomes silence for that segment.
  - If an overlay segment has `audioEnabled=true`, mix it into the final audio during that time range.

Implementation detail (later step): represent segment audio as either `atrim` (enabled) or `anullsrc` (disabled), then `concat` per track, then `amix` tracks (base + overlay + narration + music) before final normalization.

## Implementation Steps
1) **Types + timeline ops**
   - Add `audioEnabled` to `Clip` type and default it in migrations/hydration.
   - Ensure `insertClipAtPlayhead` initializes `audioEnabled: true`.
2) **Clip modal**
   - Add the base clip audio toggle to clip properties.
   - Persist to timeline JSON.
3) **Preview DOM**
   - Introduce `baseVideoRef` and `overlayVideoRef`.
   - Render overlay `<video>` in PiP box based on overlay position/size properties.
4) **Unified play controller**
   - Replace video preview play buttons with one.
   - On play:
     - Identify active base clip and overlay segment at playhead.
     - Load/seek each video ref to the correct source time.
     - Apply `.muted` from `audioEnabled`.
     - Start both videos (same user gesture).
   - On pause: pause both.
5) **Timeline sync + drift correction**
   - Choose clock source and update playhead from that element.
   - Keep the other element aligned via periodic correction.
6) **Boundary stop behavior**
   - Stop at segment ends that require source change; require user tap to continue.
7) **Manual verification**
   - Base only: plays normally.
   - Overlay only (no base): overlay plays in PiP over solid/graphics background.
   - Both present:
     - Base audio on, overlay audio off → hear base only.
     - Base off, overlay on → hear overlay only.
     - Both on → hear both.
   - Confirm that editing + refresh preserves clip audioEnabled state.

## Open Questions (defer unless needed)
- Background color for gaps: **fixed black** (no per-project control in v1).
- Per-overlay “frame color/thickness” around PiP: **defer**.
- **Play across splits when possible**: if the next segment is contiguous (no gap) and uses the same `uploadId` (same `src`), auto-advance playback without pausing for both base + overlay tracks.
  - This mirrors the current behavior you see on the base track today.
  - For gaps or `src` changes, we still stop and require another user tap (especially on iOS).
- “Play across gaps” via synthetic clock (preview-only): defer unless we find it’s low-cost; current behavior remains stop-at-gap.
