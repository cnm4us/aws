# Implementation Plan 46: Lower Thirds as Uploaded Images + Configs (Like Logos)

## Goal
Replace the SVG-template-based lower thirds workflow with a simpler, user-driven approach:
- Users create lower-third graphics externally (e.g. Canva), upload them as images.
- Users choose a **Lower Third Image** + a **Lower Third Config** when producing a production.
- Rendering uses **MediaConvert ImageInserter** (same mechanism as logos), so it applies consistently to:
  - poster frame
  - title page / freeze frames (when present)
  - the entire HLS output

## Non-goals
- Multi-image “slides” lower thirds
- Multiple lower thirds at once
- Advanced per-space lower third overrides (per-publication)
- Removing legacy lower-third SVG routes immediately (we’ll just stop using them in `/produce`)

## Key Decisions
- Lower third images are stored in `uploads` as:
  - `kind='image'`
  - `image_role='lower_third'`
- **PNG only** (MediaConvert ImageInserter supports PNG/TGA; we already enforce PNG for overlays).
- Lower third configs are **user-owned** (same model as `logo_configurations`).
- MVP positioning: **bottom_center only** (we can widen to 3×3 later).
- Lower third layer order:
  - lower third = `Layer: 1`
  - logo watermark = `Layer: 2` (logo on top)
- Lower third width can expand to **full width** via `size_pct_width` up to `100%` (add a `Full width` preset).

## Open Questions (confirm before implementation)
1) Should lower third rendering be disabled automatically if the image has no alpha (fully opaque), or allow it (creator choice)?

## Step 1) Data model: lower_third_configurations
- Add a new table (idempotent in `src/db.ts`), mirroring `logo_configurations`:
  - `lower_third_image_configurations` (kept separate from legacy SVG lower thirds tables):
    - `id` PK
    - `owner_user_id`
    - `name`
    - `position` (same enum as logo configs; MVP restrict to `bottom_center`)
    - `size_pct_width` (default 82; allow up to 100 for full-width designs)
    - `opacity_pct`
    - `timing_rule` (`entire`, `start_after`, `first_only`, `last_only`)
    - `timing_seconds` (nullable)
    - `fade` (`none`, `in`, `out`, `in_out`) (optional; consistent with logos)
    - `inset_x_preset`, `inset_y_preset` (reuse inset presets behavior)
    - timestamps + `archived_at`

## Step 2) API: CRUD for lower third configs
- Add endpoints (new namespace to avoid breaking the existing SVG-based APIs):
  - `GET /api/lower-third-configs?limit=...` (active only)
  - `POST /api/lower-third-configs`
  - `PUT /api/lower-third-configs/:id`
  - `DELETE /api/lower-third-configs/:id` (archive)
- Auth: logged-in required; ownership enforced.

## Step 3) Uploads: lower-third image role support + validation
- Ensure uploads list can filter:
  - `/uploads?kind=image&image_role=lower_third`
- Add server-side validation for `image_role=lower_third`:
  - require PNG (`content_type=image/png` or `.png` key)
  - record width/height (already happens for images)

## Step 4) Frontend: Lower Third Configs page (like Logo Configs)
- Add `frontend/src/app/LowerThirdConfigs.tsx` modeled after `LogoConfigs.tsx`:
  - name, position (MVP: bottom-center only), size presets (include `Lower third` 82% + `Full width` 100%), opacity, timing, insets
  - archive
- Add route `/lower-third-configs`

## Step 5) Frontend: Update Produce page to use image+config pickers
- Remove/stop using:
  - `/lower-thirds` “Manage presets”
  - `/api/lower-third-templates/resolve` preview plumbing
- Add two selections in `/produce`:
  - **Lower third image** picker:
    - list `uploads?kind=image&image_role=lower_third` (new picker modal like audio/logo pickers)
    - show selected image name + small thumbnail
    - clear
  - **Lower third config** picker:
    - list `lower_third_configurations`
    - clear

## Step 6) Production settings: persist selections
- Extend production settings JSON schema to include:
  - `lowerThirdUploadId`
  - `lowerThirdConfigId`
  - `lowerThirdConfigSnapshot` (server-side snapshotting like logo/audio)

## Step 7) MediaConvert: apply lower third image overlay
- In `src/services/productionRunner.ts`:
  - Add `applyLowerThirdImageIfConfigured(settings, { config, videoDurationSeconds })`:
    - load upload by `lowerThirdUploadId` (validate kind/image_role/status/png)
    - load config snapshot
    - compute rect via `computeOverlayRect(...)` (works for arbitrary aspect ratios)
    - insert via `VideoPreprocessors.ImageInserter.InsertableImages.push({ ... })`
      - `Layer: 1`
      - include fades and timing
    - apply to posters too (same behavior as logo watermark when enabled)
  - If both legacy SVG lower third + image lower third exist, prefer image lower third.

## Step 8) Navigation / UX polish
- Add “Lower Thirds” link where appropriate (matching Logos/Title Pages patterns):
  - uploads: `/uploads?kind=image&image_role=lower_third`
  - configs: `/lower-third-configs`

## Step 9) Manual test checklist
1) Upload a PNG lower-third graphic via `/uploads?kind=image&image_role=lower_third`.
2) Create a lower-third config with:
   - `position=bottom_center`
   - `size=Lower third (82%)` and `size=Full width (100%)`
   - desired opacity
   - `first_only 5/10/15/20` and `entire` variants
3) Produce a video with:
   - logo watermark ON (verify logo overlays above lower third)
   - title page / freeze intro ON (verify overlay appears on poster + intro)
4) Verify it renders correctly in HLS playback.
