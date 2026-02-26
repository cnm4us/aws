# Plan 60: Timeline Overlay Tracks (Images) + Build Overlays Lane in Edit Video

## Goal
Extend `/edit-video` to support **stacked timeline lanes** so users can:
- Keep using the **base video** lane for trimming, splitting, ripple-delete.
- Add **image overlay clips** on separate lanes (future: video clips, text, etc).
- See “Build Production” overlays (logo/lower third/screen title/first screen) reflected in the editor as a **locked** lane for clarity.

Mobile-first: big touch targets, simple mental model, minimal controls.

## Non-goals (for this plan)
- Video-clip overlays (quoted clips), picture-in-picture, transforms/rotation.
- Multi-layer overlap within a single lane (keep simple initially).
- A full “production draft” persistence system (we keep using URL persistence like `editRanges`).

## UX Model (consistent with rendering)
Stacked lanes where **higher lanes render on top**:
1) Build Overlays (locked, read-only)
2) Overlay A (editable)
3) Overlay B (editable) *(Phase 2)*
4) Base Video (editable; trims/cuts/ripple)

## Data model
Store in `productions.config.timeline`:
```json
{
  "timeline": {
    "overlays": [
      {
        "id": "ov_01",
        "track": "A",
        "kind": "image",
        "uploadId": 123,
        "startSeconds": 2.0,
        "endSeconds": 7.5,
        "fit": "cover",
        "opacityPct": 100
      }
    ]
  }
}
```

Notes:
- `startSeconds`/`endSeconds` are in **edited-time** (post-splits/ripple), matching the editor playhead timeline.
- The render pipeline already splices edits first (concat), so edited-time is the actual master timeline time.
- Cap overlays to a modest count initially (e.g. max 20) to keep URL size bounded.

## URL persistence (like `editRanges`)
Add a compact `overlayItems=` param in the `from` URL returned to `/produce`:
- Example:
  - `overlayItems=img:123:A:2-7.5:cover:100,img:124:A:12-15:cover:100`

Rules:
- Round times to 0.1s.
- Clamp to `[0..totalEditedDuration]`.
- Disallow overlaps inside the same track for v1 (UI shows an error).

## Phase 1 — Core overlays + locked Build Overlays lane

### 1) Images: introduce an `image_role=overlay` filter
- Reuse existing `uploads.kind='image'` and add a new `image_role='overlay'` (like `title_page` and `lower_third`).
- Update the upload UI navigation (if needed) to allow users to upload/select “Overlay Images”.

### 2) Picker flow (route-based, no SPA bloat)
- From `/edit-video?upload=:id` add an “Add Image” action for Overlay A.
- Navigate to a picker route (same pattern as other pickers) to select an overlay image:
  - `/edit-video?upload=:id&pick=overlayImage`
- The picker lists `uploads.kind=image&image_role=overlay` (uploaded/completed only).
- Selecting an image returns to `/edit-video` with:
  - `overlayImageUploadId=<id>` in the URL (transient) and inserts it as a clip at playhead.

### 3) Overlay clip creation defaults
When adding an image overlay:
- Default track: Overlay A
- Default time span:
  - If a base segment is selected: span the whole selected base segment boundaries.
  - Otherwise: span a default window (e.g. 2.0s) starting at playhead.
- Default fit: `cover`
- **Full-frame only** (no positions/transforms in v1).
- **Opaque only** (no opacity controls in v1).

### 4) Editor UI: render lanes + selection
In `/edit-video`:
- Keep the existing **base** lane behavior for split/delete/undo/clear.
- Add lanes above it:
  - Build Overlays (locked): draw “ghost clips” representing:
    - Lower third timing (first N seconds vs entire)
    - Screen title timing (first N seconds vs entire)
    - Logo timing (entire)
    - First screen hold (if present) as a labeled region at `t=0..holdSeconds`
  - Overlay A: draw editable overlay clips.

Selection rules:
- Tapping an overlay clip selects it.
- Base split/delete actions continue to act on the base video selection.
- Add a small overlay action row when an overlay clip is selected:
  - Delete overlay clip
  - (Optional) Move to Overlay B (Phase 2)

### 5) Render pipeline: burn image overlays in ffmpeg master
In `video_master_v1`:
- After splicing edits and applying intro, burn user overlays, then burn Build Production overlays, then screen title (consistent with “top wins”).
- Implement “explicit time windows” for overlays:
  - Extend `burnPngOverlaysIntoMp4` to accept per-overlay `startSeconds` + `endSeconds` (instead of only rule-based timing).
  - Internally, generate `trim`/`setpts` for the overlay PNG based on that window.
- Ensure logo/lower-third configs keep working as-is.
- Treat image overlays as **full-frame cover** layers in v1 (scale/crop to output frame).

### 6) Validation
Server-side validate `timeline.overlays`:
- `<= 20` overlays
- start/end finite, `0 <= start < end`
- `track === 'A'` (Phase 1 only)
- `kind === 'image'`
- referenced upload exists, belongs to user, kind=image, role=overlay, status uploaded/completed

### 7) Manual test checklist
- Add overlay image spanning a segment; play preview; Save edits; Produce; confirm overlay appears only for that time range.
- Confirm Build overlays still render on top.
- Confirm removing edits (ripple delete) adjusts overlay times correctly (since overlay times are in edited-time).
- Confirm no URL bloat with ~10 overlays.

## Phase 2 — Lane controls + Overlay B + snapping

### 8) Add lane controls
Per lane row:
- Eye (show/hide lane visuals only; doesn’t affect render)
- Collapse (reduce height)
- Build Overlays always locked.

### 9) Overlay B
- Allow moving a selected overlay clip between A and B.
- Enforce no-overlap within each lane (still).

### 10) Snapping improvements
- When dragging/resizing overlay clips:
  - snap to 0.1s ticks
  - snap to base cut boundaries

## Confirmed decisions for Phase 1
- Overlay A only (no Overlay B yet)
- Opaque-only overlays (no opacity control yet)
- Full-frame-only overlays (no positioning/transforms yet)
