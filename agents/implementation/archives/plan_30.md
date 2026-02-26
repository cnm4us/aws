# Implementation Plan 30: Logo Config “Safe Inset” Controls (3×3 Position + Insets)

## 1. Overview

Goal: Prevent watermark logos from being clipped by device/player “cover crop” by adding **safe inset controls** to Logo Config presets:
- Position becomes a **3×3 grid** (top/center/bottom × left/center/right).
- Based on the chosen position, show only the **two relevant inset controls** (e.g. Top+Right for top-right).
- Each inset control is a preset: **Small | Medium | Large**, stored as a **percent-of-frame** (not pixels).
- Only persist inset values that are relevant to the chosen position (axes that are “center” must save `NULL`).

In scope:
- DB + API + UI updates for logo configurations.
- Update MediaConvert overlay positioning math to use stored insets (not hard-coded margin).
- Backward compatibility for existing configs (including current `center` position value).

Out of scope:
- Per-video or per-space overrides (this remains preset-driven).
- Fully custom numeric inset percentages (presets only).

## 2. Step-by-Step Plan

1. Add DB columns for inset presets  
   Status: Completed  
   Implementation:
   - Add nullable columns to `logo_configurations`:
     - `inset_x_preset VARCHAR(16) NULL` (values: `small|medium|large`)
     - `inset_y_preset VARCHAR(16) NULL`
   - Add an index only if we need it later (likely not needed now).
   Testing:
   - `npm run build` (ensures schema code compiles)
   - Start server; verify columns exist (e.g. `SHOW COLUMNS FROM logo_configurations LIKE 'inset_%';`)  
   Checkpoint: Wait for developer approval before proceeding.

2. Expand position enum to full 3×3 in backend types + validation  
   Status: Completed  
   Implementation:
   - Update `src/features/logo-configs/types.ts` to include:
     - `top_center`, `middle_left`, `middle_center`, `middle_right`, `bottom_center`
   - Keep backward compatibility:
     - accept legacy `center` and treat it as `middle_center` internally (or perform a DB backfill in Step 3).
   - Update `src/features/logo-configs/service.ts` `POSITIONS` validation list accordingly.
   Testing:
   - Contract: `POST /api/logo-configs` with `position: "top_center"` returns `201` with that position.  
   Checkpoint: Wait for developer approval before proceeding.

3. Add inset preset fields to Logo Config API (create/update/list/get/duplicate)  
   Status: Completed  
   Implementation:
   - Extend `LogoConfigRow`/`LogoConfigDto` to include `insetXPreset` / `insetYPreset`.
   - Update `src/features/logo-configs/repo.ts`:
     - include new columns in `create`/`update`
   - Update `src/features/logo-configs/service.ts`:
     - validate inset presets: `small|medium|large|null`
     - enforce “only save relevant values” based on position:
       - if column is center → force `insetXPreset = null`
       - if row is middle → force `insetYPreset = null`
     - choose defaults when a non-center axis is active but no preset is provided (recommended default: `medium`).
   Testing:
   - `POST /api/logo-configs` with `position: "top_right", insetXPreset:"large", insetYPreset:"medium"` → `201`.
   - `PATCH /api/logo-configs/:id` set `position:"middle_center"` while sending inset presets → response has `insetXPreset:null` and `insetYPreset:null`.  
   Checkpoint: Wait for developer approval before proceeding.

4. Update production config snapshot to carry inset presets into renders  
   Status: Completed  
   Implementation:
   - Update `src/features/productions/service.ts` where `logoConfigSnapshot` is built to include `insetXPreset`/`insetYPreset`.
   - Update `src/services/productionRunner.ts` types (`LogoConfigSnapshot`) to include these fields.
   Testing:
   - Create a production; confirm the “production settings” JSON includes inset presets in `logoConfigSnapshot`.  
   Checkpoint: Wait for developer approval before proceeding.

5. Update MediaConvert overlay placement math to use inset presets  
   Status: Completed  
   Implementation:
   - Replace current `margin = max(8, round(outputW * 0.02))` with:
     - `marginX = round(outputW * pctFor(insetXPreset))` (or default medium)
     - `marginY = round(outputH * pctFor(insetYPreset))` (or default medium)
   - Implement full 3×3 positioning:
     - X: left/center/right; Y: top/middle/bottom
   - Clamp `x` and `y` to `[0, outputW - renderW]` and `[0, outputH - renderH]`.
   - Define preset→percent mapping in one place (tunable):
     - Proposal: `small=0.06`, `medium=0.10`, `large=0.14` (we can tune after seeing real crops).
   Testing:
   - Produce a video with a logo config at `top_right` and `large/large` insets; verify watermark is visibly further from edges than before.  
   Checkpoint: Wait for developer approval before proceeding.

6. Update `/logo-configs` UI to 3×3 position selector + inset controls  
   Status: In Progress  
   Implementation:
   - Update `frontend/src/app/LogoConfigs.tsx`:
     - Replace position dropdown with a 3×3 grid selector.
     - Add inset controls that appear based on position:
       - For top/bottom row: show `Top inset` or `Bottom inset` (bind to `insetYPreset`)
       - For left/right column: show `Left inset` or `Right inset` (bind to `insetXPreset`)
       - Center row/col: hide and set axis preset to `null` in the draft state.
     - Add `Small | Medium | Large` selectors.
     - Ensure “safeguard” behavior:
       - when position changes to a center axis, immediately clear the corresponding preset in state (so it won’t be saved).
   Testing:
   - Manual: select `top_left` → see `Top inset` + `Left inset`. Switch to `middle_center` → inset controls disappear and will save as null.  
   Checkpoint: Wait for developer approval before proceeding.

7. Update `/produce` summaries to display new positions cleanly  
   Status: Pending  
   Implementation:
   - Ensure `frontend/src/app/Produce.tsx` summary strings handle the new position values (`top_center`, `middle_left`, etc.) without ugly formatting.
   Testing:
   - Manual: pick a logo config with `top_center` and confirm the summary is readable.  
   Checkpoint: Wait for developer approval before proceeding.

8. Backfill/migrate existing logo config data (optional but recommended)  
   Status: Pending  
   Implementation:
   - Migrate legacy `position='center'` → `position='middle_center'` (if we choose DB normalization).
   - Set defaults for existing configs:
     - if position is not center column and `inset_x_preset` is NULL → set to `medium`
     - if position is not middle row and `inset_y_preset` is NULL → set to `medium`
   Testing:
   - Verify existing “Standard watermark” config now has inset presets populated and renders with increased inset.  
   Checkpoint: Wait for developer approval before proceeding.

9. Build + commit  
   Status: Pending  
   Testing:
   - `npm run build`
   - `npm run web:build:scoped`
   Checkpoint: Wait for developer approval before proceeding.

## 3. Open Questions / Final Tunables

Decisions:
- Preset mapping values: `small=6%`, `medium=10%`, `large=14%` of frame.
- One-time DB normalization: migrate `center` → `middle_center`.
