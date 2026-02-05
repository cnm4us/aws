# Plan 83: Backdrop Brightness (Lighten/Darken) Slider for Blur Fill

## Goal
Replace the current dim selector (Light/Medium/Strong) with a 7‑stop “Backdrop Brightness” control that supports both lightening and darkening of the blurred background when `bgFillStyle=blur`. This helps creators place dark or light text over the blurred bars.

## UX
- Label: **Backdrop Brightness**
- Control: 7‑stop discrete selector (radio buttons or compact segmented control)
- Stops:
  - Lighten 3
  - Lighten 2
  - Lighten 1
  - Neutral
  - Dim 1
  - Dim 2
  - Dim 3
- Default: **Neutral** (0)
- Only shown when **Background Fill = Blur**.

## Data model
- Replace `bgFillDim` with `bgFillBrightness` (string enum):
  - `light3`, `light2`, `light1`, `neutral`, `dim1`, `dim2`, `dim3`
- Backward compatibility:
  - If legacy `bgFillDim` exists, map:
    - `light` → `light1`
    - `medium` → `dim2` (current mapping)
    - `strong` → `dim3`
  - If neither is present, default `neutral`.

## Mapping to ffmpeg + preview
- Use brightness values in `eq=brightness=...` and CSS `brightness(...)`.
- Suggested numeric values:
  - `light3` → +0.12
  - `light2` → +0.08
  - `light1` → +0.04
  - `neutral` → 0
  - `dim1` → −0.06
  - `dim2` → −0.12
  - `dim3` → −0.18

## Implementation steps
1) **Types**
   - Update `src/features/create-video/types.ts`: replace `bgFillDim` with `bgFillBrightness`.

2) **Validation / normalization**
   - Update `src/features/create-video/validate.ts`:
     - Parse `bgFillBrightness` string; fallback to mapped legacy `bgFillDim`.
     - Emit normalized `bgFillBrightness` in timeline.

3) **Frontend editor**
   - Update `frontend/src/app/CreateVideo.tsx`:
     - Clip editor state includes `bgFillBrightness`.
     - Replace dim dropdown with 7‑stop selector.
     - Save `bgFillBrightness` onto clip.
     - For preview, compute brightness value from `bgFillBrightness`.

4) **Export (ffmpeg)**
   - Update `src/media/jobs/createVideoExportV1.ts`:
     - Accept `bgFillBrightness` and map to brightness values.
     - Continue to support legacy `bgFillDim` (map before use).

5) **Backwards compatibility**
   - Ensure old projects with `bgFillDim` still render (mapping step).

## Notes
- Keep blur strength selector unchanged.
- Keep preview brightness factor aligned with export values (no extra scaling).

