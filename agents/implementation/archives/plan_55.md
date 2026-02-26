# Plan 55: Edit Video Timeline Thumbnails (Sprite Sheets)

## Goal
Add a horizontally scrollable timeline thumbnail strip to `/edit-video` that:
- keeps the **red playhead fixed**
- scrolls thumbnails underneath
- reflects the **edited timeline** (cuts/deletes ripple) without regenerating images

We will generate **sprite sheets** server-side (via ffmpeg) from the existing **edit proxy** and serve them efficiently to the editor UI.

## Scope (MVP)
- 1-second thumbnail interval (t = 0, 1, 2, …)
- Sprite sheets + JSON manifest stored in S3 under the uploads bucket
- Editor uses manifest + CSS background-position to render thumbs
- Thumbs reflect edits by **mapping via current `ranges`** (no regen after edits)

Out of scope:
- Waveform
- Drag-and-drop overlay tracks (but we’ll structure the layout to support it)
- Zoom levels / variable intervals

## Data / Storage
Artifacts (per uploadId):
- `proxies/uploads/:uploadId/timeline/manifest.json`
- `proxies/uploads/:uploadId/timeline/sprite_0.jpg`
- `proxies/uploads/:uploadId/timeline/sprite_60.jpg`
- `proxies/uploads/:uploadId/timeline/sprite_120.jpg`
  - one sprite per 60 seconds (configurable)

Manifest shape:
```json
{
  "uploadId": 73,
  "intervalSeconds": 1,
  "tile": { "w": 96, "h": 54 },
  "sprite": { "cols": 10, "rows": 6, "perSprite": 60 },
  "durationSeconds": 159.1,
  "sprites": [
    { "startSecond": 0, "key": "proxies/uploads/73/timeline/sprite_0.jpg" },
    { "startSecond": 60, "key": "proxies/uploads/73/timeline/sprite_60.jpg" }
  ]
}
```

Notes:
- `tile` is chosen for mobile readability and performance.
- `perSprite=60` keeps sprite images moderate sized.

## Backend changes
### 1) New media job: `upload_timeline_sprites_v1`
Add new media_jobs type + runner:
- input: `uploadId`, `userId`, `proxyBucket/key`, `outputBucket`, `manifestKey`, `spritePrefix`
- output: pointers to manifest + sprites (for admin debugging)

Job enqueue behavior:
- Primary: enqueue when `upload_edit_proxy_v1` completes (recommended for freshness)
- Fallback: on-demand enqueue when editor requests the manifest and it’s missing (like edit proxy)

### 2) ffmpeg sprite generation
Implement `createTimelineSpritesJpeg()` in `src/services/ffmpeg/proxyPipeline.ts` or new `timelinePipeline.ts`:
- Download proxy mp4 to tmp
- Determine duration via ffprobe
- For each sprite page:
  - Extract frames at 1fps for that page window (e.g. 0..59s)
  - Scale to tile size (e.g. 96x54, preserve aspect via crop/letterbox)
  - Tile into grid using `tile` filter (10x6 = 60)
  - Write `sprite_${start}.jpg`
- Upload sprite JPG(s) + manifest JSON to S3

Recommended ffmpeg pattern (per page):
```
-ss ${pageStart}
-t ${pageDuration}
-i proxy.mp4
-vf "fps=1,scale=96:54:force_original_aspect_ratio=increase,crop=96:54,tile=10x6"
-frames:v 1 sprite.jpg
```

### 3) Authenticated routes
Add:
- `GET /api/uploads/:id/timeline/manifest`
- `GET /api/uploads/:id/timeline/sprite?start=0`
Permissions: same as edit proxy (owner/admin).

Responses:
- If manifest missing: return 404 and best-effort enqueue `upload_timeline_sprites_v1`.

## Frontend changes
### 1) Fetch manifest in `/edit-video`
- When page loads and proxy is available, fetch manifest.
- If 404: show “Generating thumbnails…” and a Retry button (cache-busted).

### 2) Render thumbnail strip
Layout under the video and above segment bar/slider:
- A scroll container with fixed height (tile.h)
- Thumbs rendered as divs with background-image set to sprite url + background-position

Edited timeline mapping:
- Build a list of “edited seconds” -> “original second” based on current `ranges`.
  - Example: for each kept range `{start,end}`, include integer seconds `ceil(start)`..`floor(end-ε)`
  - Concatenate in order
- For a given thumbnail at edited second `k`, map to original second `tOrig`
- Find sprite page for `tOrig` by `startSecond = floor(tOrig/60)*60`
- Compute index within sprite: `idx = tOrig - startSecond`
- Convert to `(col,row)` and background position offsets.

Playhead sync:
- When playheadEdited changes, auto-scroll the strip so the thumb under the playhead is visible (optional for MVP).

## Manual test checklist
1. Upload video → proxy generated → thumbnails job runs → manifest + sprites present in S3.
2. Open `/edit-video`:
   - thumbnails render
   - scrubbing updates playhead; thumbs correspond roughly to video
3. Make cuts/deletes:
   - thumbnail strip reflects ripple (deleted ranges vanish)
4. Save → produce → output unaffected by thumbnails (thumbs are editor-only)

## Open questions
1. Tile size: OK with 96×54 (16:9) even for portrait sources (cropped), or do you prefer 96×96 squares?
2. Should we generate from the **edit proxy** (recommended) or original upload?

