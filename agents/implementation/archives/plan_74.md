# Plan 74 — Graphics Placement + Size (Contain/Transparent) in Create Video

Status: **planning → ready to implement**

This plan adds **position + size controls for Graphics timeline objects** (Create Video only).

User requirements:
- **Graphics only** (do not change Logos / Lower Thirds / Freeze stills / Screen Titles)
- Default: **Contain (transparent padding)**, **70% width**
- Placement via a **3×3 selectable grid**
- Insets in **px**, interpreted on a **1080×1920 baseline** so `25px` feels similar in X/Y
- **Disallow overlaps** (existing rule stays)
- Must affect **preview** and **ffmpeg export**

---

## 0) Scope / Non-goals

### In scope
- Add per-graphic placement fields to the Create Video project JSON.
- Add a **Graphics → Properties** modal section:
  - Size (% frame width) selector (default 70%)
  - 3×3 position grid (TL/TC/TR/ML/MC/MR/BL/BC/BR)
  - Insets: horizontal px + vertical px
- Preview renders graphics at the selected position/size.
- Export renders graphics at the selected position/size in ffmpeg.

### Out of scope (defer)
- Freeform drag/scale of graphics in preview
- Cropping modes (cover) / opaque padding colors
- Per-graphic rotation
- Per-graphic opacity
- Animations/keyframes

---

## 1) Data Model (Create Video timeline JSON)

Extend each `graphics[]` item with the following fields:

- `fitMode: 'contain_transparent'` (default)
- `sizePctWidth: number` (default **70**; allowed 10–100)
- `position: 'top_left' | 'top_center' | 'top_right' | 'middle_left' | 'middle_center' | 'middle_right' | 'bottom_left' | 'bottom_center' | 'bottom_right'` (default **middle_center**)
- `insetXPx: number` (default **24**; allowed 0–300)
- `insetYPx: number` (default **24**; allowed 0–300)

Notes:
- For v1, `fitMode` only supports `contain_transparent`, but we keep it as an enum to allow future modes.
- `sizePctWidth` means **rendered image width** = `sizePctWidth%` of the 1080 baseline width in export, and scaled to preview container width in preview.
- Rendered image height is derived from **image aspect ratio** (no cropping; no letterboxing fill).

---

## 2) Backend: Validation / Normalization

Update Create Video timeline validation (`src/features/create-video/validate.ts` or equivalent) to:
- Fill defaults when missing for the new fields.
- Clamp:
  - `sizePctWidth` to `[10, 100]`
  - `insetXPx`, `insetYPx` to `[0, 300]`
- Validate `position` and `fitMode` enums; fallback to defaults on unknown values.

No DB migration required (stored inside the Create Video project JSON).

---

## 3) Preview (Create Video)

### 3.1 Sizing + positioning math
We render the active graphic at playhead using:
- Preview frame baseline: **1080×1920**
- Preview container: actual `previewWrapRef` dimensions (already used elsewhere)
- Convert px insets into preview pixels:
  - `insetXPreviewPx = insetXPx * (previewWidth / 1080)`
  - `insetYPreviewPx = insetYPx * (previewHeight / 1920)`
- Compute desired rendered graphic width in preview pixels:
  - `w = (sizePctWidth / 100) * previewWidth`
- Compute height based on image aspect ratio:
  - Need the image’s intrinsic `(imgW, imgH)`; use existing upload metadata if available (recommended), else load via `Image()` once and cache by uploadId.
  - `h = w * (imgH / imgW)`
- Compute `(x,y)` from `position` + insets:
  - left/center/right for x; top/middle/bottom for y
  - For center alignment, insets apply as additional offsets from the centered position (or ignored; pick one and keep consistent).

### 3.2 Rendering
Replace the current full-frame graphic `<img style={{ inset: 0, width: 100%, height: 100% }}>` with a positioned one:
- `position: absolute`
- `left/top` computed
- `width/height` computed
- `objectFit: 'contain'`
- `background: 'transparent'`
- Ensure z-index order stays:
  - VideoOverlay above graphics
  - Screen titles above both
  - Lower thirds and logos above all

---

## 4) Export (ffmpeg)

Update the `create_video_export_v1` render pipeline to apply the same placement logic for graphics.

### 4.1 Render assumptions
- Output resolution baseline is **1080×1920** (already the Create Video export target).
- Insets are applied directly in px on the 1080×1920 canvas.
- Image scaling:
  - `w = round(1080 * sizePctWidth/100)`
  - `h = round(w * imgH/imgW)` (use upload metadata dimensions)

### 4.2 Filter strategy
For each graphic segment:
- Scale the image to `(w,h)` using `scale=w:h:force_original_aspect_ratio=decrease`
  - Since `h` is derived from aspect, `decrease` should be stable.
- Overlay at `(x,y)` using `overlay=x:y:enable='between(t,start,end)'`
- No padding fill (transparent outside the scaled image)

If metadata dimensions are missing:
- Fallback to ffprobe or image identify step (prefer a lightweight approach; we already compute image sizes for other features).

---

## 5) Create Video UI: Graphics Properties Modal

In Graphics context menu → `Properties`:

### 5.1 Size
- `Size (% width)` select with common options:
  - `25, 33, 40, 50, 60, 70, 80, 90, 100`
- Default `70`

### 5.2 Position grid (3×3)
- Render a 3×3 clickable grid:
  - Selected cell highlighted (gold outline or fill)
  - Clicking updates `position`

### 5.3 Insets
- Two numeric fields:
  - `Horizontal inset (px)`
  - `Vertical inset (px)`

No “Fit mode” control exposed in UI yet (fixed to contain_transparent).

---

## 6) Testing checklist

### Preview
- Add a graphic, open Properties:
  - Default shows `70%` and `middle_center`
  - Changing position moves the graphic correctly.
  - Insets move the graphic consistently in X/Y for the same px values.
- Verify that graphics do **not** obscure video except where the image itself covers.

### Export
- Export a timeline with:
  - One base video
  - One graphic segment at `70%`, bottom-right, inset 24/24
- Confirm exported MP4 shows the graphic at correct size/position.

### Overlap rules
- Confirm graphics overlap prevention still blocks overlaps regardless of placement settings.

---

## 7) Rollout notes

- This changes visual output for any existing graphics segments (they currently render full-frame). For existing projects, we should default:
  - `sizePctWidth=100` and `position=middle_center` for best backward compatibility **OR**
  - Accept behavior change and default to 70% going forward.

**Decision**: default for *new* graphics is 70%, but for *existing* graphics missing the new fields, default to 100% so older projects don’t “shrink” unexpectedly.

