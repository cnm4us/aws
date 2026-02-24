# Plan 103: Preview-Only Layer Audio Controls (Mute/Solo)

## Goal
Keep the **single Video play button** (base + overlay together) while giving users **preview-only** control to focus on specific layers. Export behavior remains driven by per-object `audioEnabled` settings.

## Non-Goals
- No new global “Overlay Video” play button.
- No changes to export pipeline audio logic.

## Assumptions
- Per-object `audioEnabled` already affects export (confirmed).
- We will add **preview-only** mute/solo states that do not persist to timeline data.

---

## Phase A — Data Model + UI Placement
1. **Preview-only state (client-only):**
   - `previewAudioMuteByLane: Record<LaneId, boolean>`
   - `previewAudioSoloByLane: Record<LaneId, boolean>` (optional)
   - These live only in CreateVideo UI state (not saved in timeline JSON).

2. **UI Placement**
   - Add mute/solo affordance in the **layer name column** for:
     - Base Video
     - Video Overlay
     - Narration
     - Music/Audio
   - UI must clearly indicate “Preview” (e.g., eye/ear icon + tooltip “Preview only”).

3. **Behavior rules**
   - If any lane is soloed, only soloed lanes are audible during preview.
   - If no solo lanes, any lane with mute ON is silenced in preview.
   - Export ignores these preview-only flags.

---

## Phase B — Wire into Preview Playback
1. **Base video playback**
   - When previewing video (base), apply mute based on:
     - Solo logic and lane mute flags.
   - If base lane muted, force `videoRef.muted = true` in preview.

2. **Overlay video playback**
   - When previewing overlay video, apply mute based on:
     - Solo logic and overlay mute flags.
   - Overlay audio should never be audible if overlay lane is muted or not soloed while another solo is active.

3. **Narration/Music playback buttons**
   - If narration lane muted (preview), narration play should either:
     - be disabled, or
     - play silently (better: disable with tooltip).
   - Same for music/audio lane.

---

## Phase C — UX Polish + Messaging
1. **Tooltips / labels**
   - Every mute/solo toggle: “Preview only — does not affect export”.

2. **Visual state**
   - Muted lane icon (dimmed)
   - Solo lane icon (highlighted)
   - If any solo active, show subtle banner: “Preview Solo Mode”

3. **Reset controls**
   - Add “Reset Preview Audio” in the timeline controls row.

---

## Phase D — Testing Checklist
- Base + overlay play together by default.
- Muting overlay removes its audio but base stays.
- Solo overlay mutes base in preview.
- Narration/musics mute affects their playback buttons.
- Export unaffected (clips still obey per-object `audioEnabled`).

---

If this plan looks good, we can refine the UI interactions or add per-lane toggles for video-only focus.

## Added: Muted Indicator + Music Segment Audio Toggle

### Phase E — Visual Muted Indicator
- Add `audio-muted.svg` icon to any timeline pill with `audioEnabled === false`.
- Placement: **inside the pill**, left of the label, and **after** the left handle when handles are visible.
- Use `filter: brightness(0) invert(1)` to render white on dark pills.
- Apply to:
  - Base video clips
  - Video overlays
  - Narration segments
  - Music/audio segments (new toggle below)

### Phase F — Music Segment Audio Toggle
- Add per‑segment `audioEnabled` for music/audio segments (same concept as clips/overlays).
- Use existing properties UI where music segments are edited:
  - Default `audioEnabled: true`
  - Allow OFF per segment
- Ensure export uses this field (already supported in `createVideoExportV1.ts`).
- Ensure preview respects this field when the music play button is used.

---

Updated plan now includes Phase E/F for muted indicators and music segment toggle.

## Update: Audio ON/OFF Icons (Layer + Pills)
- Use `audio-on.svg` and `audio-off.svg` for both:
  - **Layer label row** (between label and color block)
  - **Object pills** (before label, after handle when visible)
- Style:
  - Icon fill rendered white (`filter: brightness(0) invert(1)`)
  - Add subtle colored outline or dot:
    - **ON** = green accent
    - **OFF** = red accent
- If you prefer fully green/red icons later, we can switch the filter to a CSS `fill` approach.

Updated plan reflects dual placement + ON/OFF icon usage.

## Update: Preview-Only Video Motion Toggle (Base + Overlay)

### Phase G — Motion Toggle (Preview Only)
- Add a **Motion** toggle per video layer (Base Video + Video Overlay) on the layer label row.
- Behavior:
  - **Motion ON** → normal video playback.
  - **Motion OFF** → render a **static first frame** (poster/thumb) for that layer; no continuous decode.
  - When Motion OFF, **preview audio auto‑mutes** for that layer (preview‑only).
- Implementation notes:
  - Use existing thumb or frozen frame URL: `/api/uploads/:id/thumb` (fallback to `edit-proxy#t=0.1` if needed).
  - Keep export unchanged; this is strictly preview‑only.

Plan updated to include Phase G.

## Update: Motion Icons
- Use `video-on.svg` / `video-off.svg` for Motion toggle on the Base + Overlay layer rows.
- Render icons white (invert filter), with subtle green accent for ON and red accent for OFF (match audio icon treatment).
- Place between the label and color block (alongside audio icon).
