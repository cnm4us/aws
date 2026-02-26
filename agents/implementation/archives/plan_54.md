# Plan 54: Edit Video – Multi-Cut Segment Editor (MVP)

## Goal
Extend `/edit-video` from simple trim into a **mobile-first segment editor** that supports:
- Split (cut) at playhead
- Select a segment (highlight)
- Delete selected segment (ripple timeline)
- Save edits back to `/produce` and render them in the production pipeline

This enables trimming the beginning/end and removing multiple small “bad takes” in the middle.

## Scope / Constraints (MVP)
- Max **20 cuts** (=> up to **21 segments**).
- Time resolution: **0.1s**
- Non-destructive: original upload remains unchanged; edits are **per production**.
- No thumbnails strip and no waveform in v1 (just a colored segment bar).

## Data model
Store edit recipe in `productions.config.edit`:
```json
{
  "edit": {
    "ranges": [
      { "start": 0.0, "end": 12.3 },
      { "start": 18.7, "end": 44.1 }
    ]
  }
}
```
Rules:
- Ranges are in **original upload time** (seconds).
- `start < end`
- Sorted by playback order (we keep the array ordered).
- Ranges are rounded to 0.1s.

Back-compat:
- Keep supporting `trimStartSeconds`/`trimEndSeconds` for existing URLs.
- If `ranges` exists, it wins.

## URL persistence (like current trim)
Persist ranges into the `/produce` URL via the `from=` mechanism:
- `editRanges=0-12.3,18.7-44.1`

Parsing:
- Split by `,` for segments
- Each segment is `start-end`
- Clamp and round to 0.1s

## Frontend changes
### 1) `/edit-video`
Replace “Start/End” UI with segment editor controls:
- **Segment bar** between video and scrub slider:
  - One row spanning full width
  - Segments drawn proportionally by duration
  - Selected segment uses highlight color
  - Split markers at boundaries
- Actions (big touch targets):
  - `Split` (at playhead) – disabled if max segments reached
  - `Delete` (selected segment) – disabled if only one segment left
  - `Undo` (single step) – included in MVP
  - `Clear` (reset to single full-length segment)
  - `Save`

Timeline semantics:
- The “playhead time” is in **edited timeline time** (concatenated).
- We maintain mapping functions:
  - `editedTime -> originalTime`
  - `originalTime -> editedTime` (for seeking if needed)

Split:
- Find segment containing playhead (in edited time)
- Convert to original cut time
- Split into two ranges
- Enforce minimum segment length (e.g. 0.2s) to avoid tiny junk segments

Delete:
- Remove selected segment
- Ripple: concatenate remaining segments (edited timeline shrinks)
- If the deleted segment contained the playhead, move playhead to start of nearest remaining segment.

Save:
- Writes `editRanges=` into the `from` URL and navigates back to `/produce`.
- Preserve existing `editStart`/`editEnd` removal when saving ranges (to avoid conflict).

### 2) `/produce` quick preview
When `editRanges` is present:
- Use the first range’s `start` as the “quick preview seek point”.
- Continue using `/api/uploads/:id/edit-proxy` as the preview source.
- Display a small summary line: “Edits: 3 segments” + link to Edit Video.

## Backend changes
### 1) Validation (production create)
In `src/features/productions/service.ts`, validate:
- `edit.ranges` is an array
- `1 <= ranges.length <= 21` (20 cuts max)
- Each `{start,end}` is finite; `0 <= start < end`
- Clamp to max video length when known (best-effort), otherwise cap to e.g. 3600s

### 2) Job inputs / orchestration
Pass `edit` through `productionRunner` into:
- `video_master_v1` input
- `audio_master_v1` input

### 3) ffmpeg implementation
Add splicing support to `src/services/ffmpeg/trimPipeline.ts`:
- If `edit.ranges` exists:
  - Use `trim`/`atrim` per range + `concat` filter to produce a single MP4 (re-encode)
- Else fallback to current single-range trim.

Pseudo filter (with audio):
```
[0:v]trim=start=a:end=b,setpts=PTS-STARTPTS[v0];
[0:a]atrim=start=a:end=b,asetpts=PTS-STARTPTS[a0];
...
[v0][a0][v1][a1]concat=n=N:v=1:a=1[v][a]
```

Apply edits **before** intro/overlays/audio (already true for trim; extend for ranges).

## Manual test checklist
1. Edit-video loads proxy and shows a single segment covering full duration.
2. Split at 10.0s → 2 segments; select and delete the second segment → ripple.
3. Make 3–5 segments; delete a middle segment; verify playhead mapping remains sane.
4. Save → returns to `/produce` with `editRanges=...`.
5. Produce:
   - output duration matches sum of ranges
   - overlays + first screen intro still apply after edits
6. Verify limit: attempt to create >21 segments (20 cuts) → UI blocks split and shows message.

## Open questions (confirm)
None (confirmed): max 20 cuts, Undo included.
