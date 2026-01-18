# Plan 66 — Create Video: Narration (Voice) Layer v1

## Goal
Add a dedicated **Narration (Voice)** layer to `/create-video` so creators can record or add speech that sits **above** the background music track and **above** clip audio at export time.

Key outcomes:
- A new **Narration lane** just above the existing Music lane.
- Narration is represented as **timeline segments** (movable, resizable, splittable, deletable).
- Export mixes narration segments into the final mastered MP4 (ffmpeg), then proceeds with the existing MediaConvert/HLS flow.

## Scope
### In scope (v1)
- Timeline/project model: store narration segments.
- Create Video UI:
  - Add → Narration → **Record in browser** (primary) and/or **Import file** (optional sub-step; see Phasing).
  - Timeline lane for narration segments (no overlaps).
  - Drag/move/resize handles + split + delete for narration segments.
  - Segment properties modal:
    - start/end edits
    - gain (simple slider, default 0 dB; range -12…+12)
    - play/pause preview of the underlying narration audio asset
- Export:
  - Mix narration segments into the exported MP4 audio track using ffmpeg (video stream copied).

### Out of scope (future)
- Punch‑in recording (replace a selected region inside an existing segment).
- Sample‑accurate trimming (sub‑0.1s).
- Automatic ducking of background music based on narration (sidechain to narration).
- Captioning / speech-to-text from narration.
- Multi-track narration (multiple voices).

## Key Decisions
- Narration is **segment-based** (append + edit via split/delete/resize), not “replace region”.
- **No overlap within the narration lane**.
- Narration segments are **always mixed** (never “replace”).
- Export audio normalization follows existing global behavior (env controlled); narration gain is applied prior to the final limiter/normalization.

## Data Model Changes
### Frontend timeline JSON (Create Video v1)
Add an optional narration segment list:
```ts
timeline.narration?: Array<{
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  gainDb?: number // default 0
}>
```

### Backend validation
- Validate `timeline.narration[]` if present:
  - `id` string
  - `uploadId` > 0
  - `startSeconds/endSeconds` finite, `endSeconds > startSeconds`, snap 0.1s
  - `gainDb` finite within [-12, +12] (default 0)
  - enforce **no overlap** within `timeline.narration`
  - enforce timeline max seconds (current cap: 20 minutes)

## Uploading Narration Audio
### Storage
- Store in `UPLOAD_BUCKET` under a distinct prefix for clarity:
  - `audio/narration/YYYY-MM/DD/<uuid>/narration.(m4a|webm|wav)`
- Create an `uploads` row:
  - `kind='audio'`
  - `is_system=0`
  - `status='completed'`
  - `duration_seconds` populated (ffprobe)
  - filename set to `Narration <date>` or user-supplied label

### Recording in browser (recommended v1)
- Use `MediaRecorder` when supported.
- MIME preference order:
  1) `audio/mp4` (AAC, ideal for iOS if available)
  2) `audio/webm;codecs=opus` (Chromium)
  3) `audio/wav` (fallback if necessary)
- Require recording start via **user gesture** (tap “Record”).

### Import file (optional v1 or v2)
- Allow adding a file to narration via file picker.
- Accept `.m4a`, `.wav`, `.mp3` (voice memos are usually `.m4a`).
- Validate content type server-side and transcode if needed.

## UI / UX
### 1) Add modal changes
Add Asset Type:
- Add → Narration
  - Option A (v1): “Record”
  - Option B (optional): “Import file”

On completion:
- Create a new narration segment at the playhead:
  - `startSeconds = playhead`
  - `endSeconds = startSeconds + duration_seconds` (rounded to 0.1)
  - If overlap with an existing narration segment:
    - v1 behavior: **block** with “Narration overlaps; move playhead or trim/delete existing narration first.”

### 2) Timeline lane
- Lane order (top → bottom):
  - Logo
  - Lower Third
  - Screen Titles
  - Graphics
  - Video/Base track
  - **Narration (new)**
  - Music (existing audioTrack)
- Narration pill label:
  - `{name} • gain {+/-}dB`
- Supports:
  - Move (body drag) with collision blocking
  - Resize handles (start/end) with collision blocking
  - Split at playhead (duplicates the segment into two adjacent segments; both refer to the same underlying upload but represent different timeline windows)
  - Delete selected segment

### 3) Narration properties modal
Shown on second-tap of a selected narration pill:
- Start / End (seconds)
- Gain slider + numeric readout
- Play/Pause preview button (plays the narration audio file from the beginning; v1 doesn’t attempt to sync playback to the timeline)

## Export / ffmpeg
### Where narration is applied
In `createVideoExportV1`:
1. Build base track (clips + freeze stills + black gaps)
2. Apply full-frame graphics
3. Apply screen titles
4. Apply lower thirds
5. Apply logos
6. Apply music track (existing) → produces MP4 with audio
7. **Apply narration segments** (new step) → final MP4 with narration mixed in

### Narration mixing implementation
- Download each narration upload into tmp.
- Build a single filter_complex that:
  - Takes input `[0:a]` (current audio, or generates silence if missing)
  - For each narration segment i:
    - `atrim=0:segLen` (segLen = end-start)
    - `adelay=startMs:all=1`
    - `volume=gainDb`
    - `apad`
  - `amix=inputs=N:duration=longest:dropout_transition=0:normalize=0`
  - `alimiter=limit=0.98`
  - Apply normalization if enabled (existing env behavior)
- Map `0:v` with `-c:v copy`
- Re-encode audio to AAC 48k stereo

## Manual Test Checklist
- Create Video with:
  - screenshots only + narration → export plays with narration over black/screenshots
  - video clip + narration → export includes narration
  - video clip + music + narration → export mixes all three (clip audio + music + narration)
- Segment editing:
  - add narration, split, delete middle, move earlier/later (no overlap)
  - resize start/end and verify collision blocking
- iOS Safari:
  - recording starts on tap and results in a narration segment on the lane

## Phasing Recommendation
- **Phase 1 (fastest):** narration lane + “Import file” (lets you test without iOS mic edge cases).
- **Phase 2:** in-browser recording on iOS/Android/desktop (MediaRecorder + fallback).
