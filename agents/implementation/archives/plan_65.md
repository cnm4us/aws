# Plan 65 — Create Video: Logo Layer v1 (Timeline Segments)

## Goal
Add a dedicated **Logo** layer to `/create-video`:
- Always rendered **on top of** everything else (video, stills, graphics, audio, etc.)
- Uses existing **Logo uploads** + **Logo Configs**
- **Movable, splittable, resizable** logo segments on the timeline
- Honors **logo_config timingRule + fade**

This plan intentionally sets the pattern for the next two layers:
- Lower Thirds (beneath logo)
- Screen Titles (beneath lower thirds + logo)

## Scope
### In scope
- Timeline/project data model: store **logo segments**.
- Create Video UI:
  - Add → Logo (picker + config selector)
  - Timeline lane for logo segments (topmost layer)
  - Drag/move/resize handles + split + delete for logo segments
  - Preview overlay for logo (approximate layout) so users can sanity-check placement
- Export:
  - Burn logo segments into the exported MP4 using ffmpeg (`burnPngOverlaysIntoMp4`) in the correct layer order.

### Out of scope (future)
- Per-logo keyframes (opacity ramps, moving).
- Logo-only projects (no base video/graphics).
- Lower Thirds + Screen Titles (next plans).

## Key Decisions
- **Logo is always the topmost render layer**.
- **No overlap within the logo layer** (recommended): you can change logos over time, but not stack two logos at once.
- Each logo segment stores a **Logo Config snapshot** so exports remain stable if presets change later.
- We honor config `timingRule/timingSeconds` **within** the logo segment’s own [start,end] window (segment-relative timing).

## Data Model Changes
### Frontend timeline JSON (Create Video v1)
Add an optional logo segments list:
```ts
timeline.logos?: Array<{
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  configId: number
  configSnapshot: LogoConfigSnapshot
}>
```

### Backend validation
- Validate `timeline.logos[]` if present:
  - `id` is a string
  - `uploadId` > 0
  - `startSeconds/endSeconds` finite, `endSeconds > startSeconds`, snap to 0.1s
  - `configId` > 0 and `configSnapshot` is an object
  - enforce **no overlap** inside `timeline.logos`

### Export job input
Keep it embedded on `timeline` (preferred) so autosave/draft persistence stays uniform:
- `create_video_export_v1` reads `timeline.logos`.

## UI / UX
### 1) Add Modal
Add a new Asset Type:
- Add → Logo → list user logos (`uploads?kind=logo&status=uploaded,completed&user_id=me`)

After selecting a logo:
- Prompt for Logo Config (reuse `/api/logo-configs` list).

On save, insert a new logo segment:
- Default segment range:
  - `startSeconds = playhead`
  - `endSeconds = totalSeconds` if `totalSeconds > startSeconds + 0.2`, else `startSeconds + 5.0`
- If the segment overlaps another logo segment, slide it forward to the next available slot (or block with an error; recommendation: slide).

### 2) Timeline lane
Add a dedicated lane above existing tracks:
- Each segment draws a pill at `[startSeconds,endSeconds]`
- Label: `{logo_name} • {logo_config_name}`
- Drag handles for resizing
- Body drag for moving (block on collision with other logo segments)
- Split duplicates the segment (same logo + config) into two adjacent segments
- Tap again opens a modal editor:
  - start/end edits
  - change selected logo
  - change logo config

### 3) Preview overlay
Show the logo in the preview only when the playhead falls within an active logo segment’s effective window:
- Use approximate CSS overlay based on the Logo Config snapshot:
  - position (top/middle/bottom + left/center/right)
  - sizePctWidth
  - opacityPct
  - inset presets (small/medium/large)
- Apply timingRule segment-relative so preview roughly matches export.

## Export / ffmpeg
### Where to apply the logo
In `createVideoExportV1`:
1. Compose base (clips + stills + black gaps) → `baseOut`
2. Apply full-frame graphics overlays → `out_with_graphics`
3. **Apply logo overlays** (segment-timed) → `out_with_logo`
4. Apply audio track (mix/replace) → `finalOut` (video copied; no additional re-encode)

### Implementation details
- For each logo segment:
  - Fetch logo upload row:
    - kind must be `logo`
    - status must be `uploaded` or `completed`
    - must be owned by user (or admin)
  - Use `configSnapshot` from the timeline segment (do not re-fetch, except maybe to validate permissions).
- Download logo PNG to tmp dir.
- Determine image dimensions:
  - Prefer `uploads.width`/`uploads.height` if present
  - Otherwise probe PNG dims (fallback)
- Build `burnPngOverlaysIntoMp4` overlays with:
  - `startSeconds/endSeconds`: derived from the segment + config timingRule (segment-relative)
  - `cfg`: Logo Config snapshot (for fade/position/size/opacity)

## Layer Ordering Rule
- Within the export pipeline, logo overlays are applied after graphics and before audio (audio step copies video).
- Within `burnPngOverlaysIntoMp4`, logo overlays are applied in the order they appear in `timeline.logos` (sorted by startSeconds). Overlap is disallowed, so ordering conflicts should not occur.

## Validation / Manual Test Checklist
- In `/create-video`:
  - Add a video clip.
  - Add a logo segment + config.
  - Verify preview shows the logo only during the segment.
  - Move/resize the segment; split; delete.
  - Export, then `/produce?upload=<new>` works.
  - Produce/publish and verify:
    - Logo appears in HLS output.
    - Logo appears on poster frames (since poster is derived from the mastered video).
