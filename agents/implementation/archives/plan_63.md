# Plan 63 — Create Video: Audio Track v1 (single system background track)

## Goal
Add a single, system-provided background audio track to the `/create-video` workflow:
- One track max in v1
- Default behavior: **mix + loop**
- Track spans **[0, timelineEnd]** by default and is editable
- Uses existing **Audio Configs** (admin-created presets)
- No fade controls in the Create Video UI (handled by Audio Configs)

## Scope
- Create Video timeline supports an `audioTrack` object
- Create Video UI can add/remove the track, trim start/end, and choose an Audio Config
- Export pipeline applies the audio via ffmpeg before MediaConvert HLS

Non-goals (explicitly out of scope for this plan):
- Multiple audio tracks, overlays, or SFX sequencing
- Per-clip audio editing (mute/lower clip audio)
- User-uploaded audio enablement (we’ll leave a gate hook only)

---

## Step 1 — Data model + validation

### Timeline JSON
Extend `create_video_v1` to include an optional `audioTrack`:
- `uploadId: number` (system audio upload id)
- `audioConfigId: number` (selected preset id)
- `startSeconds: number` (default `0`)
- `endSeconds: number` (default `timelineEnd`)

### Validation rules
- Audio upload must be allowable:
  - `uploads.kind = 'audio'`
  - system-managed/allowable (current constraint)
- `audioConfigId` must exist and be selectable by the current user (admin-created presets)
- Clamp `startSeconds/endSeconds` to `[0, timelineEnd]`, enforce `end > start`
- Enforce single-track constraint (no arrays)

### Migration
No DB migration required (timeline JSON is stored on the project row).

---

## Step 2 — Create Video UI

### Timeline rendering
Add an **Audio lane** beneath the Video lane:
- Pill spans `[startSeconds, endSeconds]`
- Label includes audio name + selected audio config name (ellipsized)
- Trim handles at both ends (drag to change `startSeconds/endSeconds`)

### Controls
- Add `Add Audio` button:
  - Opens picker listing system audio uploads
  - Select sets/overwrites `audioTrack`
- Audio pill selection + modal:
  - Select Audio Config (dropdown)
  - Start/End numeric fields + +/- buttons
  - Remove audio track

### UX rules
- Tapping empty timeline area deselects currently selected pill
- Only one audio track exists; “Add Audio” replaces the current track after confirmation (or requires remove first—choose one behavior consistently)

---

## Step 3 — Export pipeline (ffmpeg)

### CreateVideo export job
Update `create_video_export_v1`:
- If `audioTrack` is present:
  - Build an audio bed for `[startSeconds, endSeconds]`:
    - Loop source audio to cover duration
    - Trim to exact span
  - Apply chosen Audio Config behavior:
    - Support **mix** and **replace**
    - Ducking behavior as defined by the chosen config
  - Mix/replace into the composed video output for the final duration
- If graphics-only:
  - Generate a silent base video (already done for graphics-only)
  - Mix/replace the audio bed into that base output

### Output
Upload the final MP4 and proceed to MediaConvert for HLS as usual.

---

## Step 4 — Gating hook (future)
Add a single validation hook/flag so later we can allow user-uploaded audio per user (admin-controlled), without implementing the UI in this plan.

---

## Step 5 — Manual test checklist
- Video-only export: no changes in audio behavior
- Video + system audio (mix config): both clip audio and music audible; music loops across timeline
- Video + system audio (replace config): only music audible
- Graphics-only + audio: exports black base + graphics overlays + music
- Trim handles for audio track: start/end changes reflected in export

