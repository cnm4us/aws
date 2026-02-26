# plan_77 — Simplified Logo Placement (Deprecate Logo Configs)

## Goal
Make Logos behave like other timeline objects:
- Pick a logo → returns directly to `/create-video`
- Configure via logo **Properties** modal:
  - `Size (% width)`: `10/20/30/40/50` (default `20`)
  - `Placement`: 3×3 grid (default `Top Left`)
  - `Opacity (%)`: `0–100` (default `100`)
  - `Fade`: `none | in | out | in_out` (default `none`)
  - Insets (px): fixed defaults (e.g. `24px` X/Y @ 1080×1920 baseline)
- Remove the need for `logoConfigId/logoConfigSnapshot` in Create Video timelines.

## Non-goals (for now)
- No separate “Logo Config” entity in the Create Video UX.
- No timeline-level timing rules for logos (duration comes from timeline segment length).
- No per-logo rounded corners, shadows, or scaling-by-height.

## Data Model (timeline)
### New Create Video logo segment fields (v1)
Each timeline logo segment stores:
- `id`, `uploadId`, `startSeconds`, `endSeconds`
- `sizePctWidth` (`10|20|30|40|50`)
- `position` (`top_left`…`bottom_right`, 3×3)
- `opacityPct` (`0..100`)
- `fade` (`none|in|out|in_out`)
- `insetXPx`, `insetYPx` (px, baseline 1080×1920)

### Back-compat / migration behavior
Existing timelines may contain:
- `configId`, `configSnapshot`, `opacityPct`, etc

Strategy:
- On timeline load/normalize (frontend + server), map legacy logo segments to the new fields:
  - `sizePctWidth`: default `20`
  - `position`: default `top_left`
  - `opacityPct`: default `100`
  - `fade`: default `none`
  - `insetXPx/insetYPx`: default `24`
- Ignore/remove legacy `configId/configSnapshot` for Create Video rendering going forward.

## UI Changes
### 1) Asset picking flow
- `/assets/logo?mode=pick`:
  - Selecting a logo immediately returns to `return=/create-video?project=<id>` with `cvPickType=logo&cvPickUploadId=<id>`
  - Remove the intermediate “Logo Config” selection step from Create Video.

### 2) Timeline insertion defaults
When inserting a logo into a project:
- Start/end: same default as other inserted objects (e.g. 5s at playhead, with ripple rules applied)
- `sizePctWidth=20`, `position=top_left`, `opacityPct=100`, `fade=none`, `insetXPx=24`, `insetYPx=24`

### 3) Logo Properties modal
From logo context menu → **Properties**:
- Show:
  - Start/Duration/End + adjust start/end (0.1s)
  - `Size (% width)` select: `10/20/30/40/50`
  - `Placement` 3×3 grid (same component/pattern as Graphics/Video Overlay)
  - `Opacity (%)` numeric/slider
  - `Fade` select: `none/in/out/in_out`
- Remove any references to “Logo Config” and `configId`.

## Rendering Changes (ffmpeg export truth)
### Create Video export (ffmpeg)
Update Create Video export overlay computation for Logos:
- Render each logo segment as an overlay image with:
  - scale from `sizePctWidth` relative to 1080×1920 output frame width
  - apply `insetXPx/insetYPx` for placement calculations
  - apply opacity (`opacityPct`)
  - apply fade (`fade`, fixed duration e.g. 0.35s like other fades)
- Ensure layer ordering remains:
  - Logo above Lower Third above Screen Titles above Video Overlay above Graphics above Video.

## Server Validation
Update `src/features/create-video/validate.ts`:
- Accept the new logo fields (position/sizePctWidth/opacityPct/fade/insets).
- Continue enforcing no overlaps in the logo lane.
- Normalize / clamp:
  - `sizePctWidth` to allowed set
  - `opacityPct` to `0..100`
  - `fade` to allowed set
  - insets to reasonable max (e.g. `0..300`)

## Removal / Deprecation
### Create Video / user-facing
- Remove any Create Video routing/UI that references:
  - “Select Logo Config”
  - `/assets/logo-config`
  - `cvPickConfigId` for logos

### Admin pages
- Keep `/logo-configs` and existing DB tables intact for now (admin-only), but stop using them for Create Video.
- Optional follow-up: hide from menus, then delete after a stable period.

## Testing Checklist
- Pick logo → returns to timeline immediately, logo appears.
- Properties edits persist across refresh and export:
  - size, placement, opacity, fade, insets
- Fade behavior: in/out/in_out visually works in exported MP4.
- Existing projects that previously used logo configs still render a logo (with defaults) after migration.

