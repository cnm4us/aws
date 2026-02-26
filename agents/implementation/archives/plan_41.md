# Implementation Plan 41: Render Lower Third Overlays in MediaConvert (First N Seconds / Always)

## 1. Overview
Goal: Render user-selected Lower Third presets into the final packaged video (HLS/CMAF outputs) so that a lower third can appear for the **first N seconds** by default, with an option for **always-on**. The lower third must apply consistently across the entire production timeline (title page intro / freeze frames / main video), and preview behavior must remain deterministic (“preview == render”).

In scope:
- Add timing controls to Lower Third presets: `first_n_seconds` vs `always`.
- Generate a resolved SVG (already implemented) and **rasterize it once** into a transparent PNG for rendering.
- Apply the PNG overlay in **MediaConvert** using Image Inserter across HLS/CMAF outputs (and optionally posters).
- Persist timing settings in `productions.config` snapshot so existing productions remain stable even if presets change later.

Out of scope:
- FFmpeg overlay rendering of lower thirds (we’ll use MediaConvert ImageInserter).
- Lower third animation (slide-in/out), per-production overrides, or advanced layout controls (safe “phase 2”).
- Support for complex SVG features beyond our current validator/renderer rules.

## 2. Key Decisions (Confirmed)
- Default: **first N seconds**, with option **always-on**.
- Lower third overlay should apply across the whole production timeline (intro segments included), not just the “main” video.

## 3. Open Questions (Need Your Answers)
Answered:
- Duration options: `5, 10, 15, 20`, or “Till end”.
- Default duration: `10s`.
- Apply to posters/title/freeze: yes (poster is `t=0`, should match what viewers see).
- Layering with logo watermark: logo sits above lower third.

## 4. Step-by-Step Plan

1) Extend lower third preset schema to store timing
   Status: Pending
   - Add columns to `lower_third_configurations`:
     - `timing_rule` (`first_only|entire`)
     - `timing_seconds` INT NULL (used when `first_only`)
   - Backfill existing presets to `timing_rule='first_only'` and `timing_seconds=10` when missing.
   Testing:
   - `npm run build`
   - Verify DB: `DESCRIBE lower_third_configurations` shows new columns.
   - Record: `agents/implementation/tests/plan_41/step_01_db.md`
   Checkpoint: Wait for developer approval before proceeding.

2) Update lower-third config APIs to read/write timing
   Status: Pending
   - Update `/api/lower-third-configs` create/update:
     - Accept `timingRule` + `timingSeconds` in JSON body (validated).
     - Enforce: if `timingRule='first_n'` then seconds is required and in allowed set; else seconds is null.
   - Ensure list/get returns the timing fields.
   Testing:
   - Canonical: `GET /api/lower-third-configs` returns `items[].timingRule` + `timingSeconds`.
   - Record: `agents/implementation/tests/plan_41/step_02_api.md`
   Checkpoint: Wait for developer approval before proceeding.

3) Update `/lower-thirds` UI to edit timing (preset-level)
   Status: Pending
   - Add “Timing” controls to `frontend/src/app/LowerThirds.tsx`:
     - `First N seconds` vs `Till end`.
     - Duration dropdown (5/10/15/20) when “First N seconds”.
   - Include timing in Save requests and show a small summary in the preset list.
   Testing:
   - Manual: create/edit preset; refresh; timing persists.
   - Record: `agents/implementation/tests/plan_41/step_03_ui.md`
   Checkpoint: Wait for developer approval before proceeding.

4) Persist timing into `productions.config` snapshot (stability)
   Status: Pending
   - When creating a production:
     - Extend `lowerThirdConfigSnapshot` to include `timingRule` + `timingSeconds`.
   - `/produce` should display timing summary for selected preset.
   Testing:
   - Manual: create production; production detail JSON shows the snapshot timing fields.
   - Record: `agents/implementation/tests/plan_41/step_04_produce_snapshot.md`
   Checkpoint: Wait for developer approval before proceeding.

5) Add SVG→PNG rasterization service (server-side)
   Status: Pending
   - Implement a small service to rasterize resolved SVG into a transparent PNG buffer.
   - Preferred approach: add `@resvg/resvg-js` (server-side; supports gradients and basic text).
   - Parse the SVG `viewBox` (width/height) from the resolved SVG to compute overlay aspect ratio.
   - Upload the PNG to S3 (likely `UPLOAD_BUCKET`) under a deterministic-ish key:
     - `lower-thirds/<YYYY-MM>/<DD>/<productionUlid>/<uuid>/lower_third.png`
   Testing:
   - Unit-ish: a script or internal call produces a PNG in S3; ensure non-zero size and correct ContentType.
   - Record: `agents/implementation/tests/plan_41/step_05_png.md`
   Checkpoint: Wait for developer approval before proceeding.

6) Apply lower third overlay in MediaConvert settings (ImageInserter)
   Status: Pending
   - Add `applyLowerThirdIfConfigured(settings, { config, videoDurationSeconds })` in `src/services/productionRunner.ts`.
   - Use `lowerThirdConfigSnapshot` to:
     - Resolve SVG (using the same resolver as preview).
     - Rasterize → PNG and upload to S3.
     - Insert the image for each output rendition:
       - X = 0
       - Width = outputWidth
       - Height = `round(outputWidth * (svgViewBoxHeight/svgViewBoxWidth))`
       - Y = `outputHeight - height` (later we can add a bottom inset)
       - Timing:
         - `first_n`: duration = `N*1000`
         - `entire`: duration = whole program duration (fallback to 1h if unknown)
   - Posters:
     - Apply to FrameCapture outputs too (so poster matches `t=0`).
   - Layering:
     - Lower third uses `Layer=1`; logo watermark uses `Layer=2`.
   Testing:
   - Manual: produce a video with lower third enabled; verify in the HLS output that overlay appears for first N seconds and then stops (and always-on works).
   - Record: `agents/implementation/tests/plan_41/step_06_mc.md`
   Checkpoint: Wait for developer approval before proceeding.

7) End-to-end QA checklist + cleanup notes
   Status: Pending
   - Test cases:
     - Lower third off (no change).
     - Lower third first 10s (overlay disappears after 10s).
     - Lower third always-on.
     - With title page intro + freeze intro.
     - With logo watermark simultaneously.
   - Document known limitations (fonts, long text overflow, etc.).
   Testing:
   - Manual checklist recorded.
   - Record: `agents/implementation/tests/plan_41/step_07_e2e.md`
   Checkpoint: Wait for developer approval before proceeding.
