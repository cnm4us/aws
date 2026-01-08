# Implementation Plan 47: Screen Titles (Per Production) + Preview Overlay

## Goal
Add **screen titles** that render near the **top** of a production’s video, using **system fonts** and a small set of **style presets**.

Creators will:
- Choose a **Screen Title Preset** (reusable styling).
- Enter **Screen Title Text** (varies per production).
- See a **sanity-check preview overlay** on `/produce` (like logo + lower third preview overlays).

Screen titles are **per production** (not per publication/space).

## Non-goals (this plan)
- Per-space/per-publication title overrides.
- Rich text (no HTML/markdown), links, emojis-as-styles, etc.
- Complex multi-block layouts (title + subtitle + badge), beyond 1–2 lines.
- Title page templates (separate feature).

## Key Decisions
1) Rendering method: **ffmpeg drawtext** (burn-in) so it applies to:
   - the video itself
   - poster frames generated downstream
   - frozen frames / title-image intros (because those are already pre-mastered in ffmpeg)
2) Presets are **user-owned** (like logo configs).
3) Text is stored on the **production** (in `productions.config`) alongside a **preset snapshot** to keep renders stable if the preset changes later.
4) Preview overlay in `/produce` is **approximate** (CSS), not pixel-perfect.
5) Fonts are **curated** (not arbitrary user uploads). MVP uses a single default font, but the data model leaves room to add more curated choices later.

## Style Presets (MVP)
Offer a small, opinionated set of styles. Each preset stores the style choice + positioning/timing values.

Recommended MVP styles:
- `pill` — bold white text on a semi-transparent black rounded rectangle
- `outline` — bold white text with thin black outline + subtle shadow (no box)
- `strip` — top gradient strip (dark → transparent) with bold text

All styles support:
- position: `top_left` | `top_center` | `top_right`
- insets: `inset_x_preset` + `inset_y_preset` (`small|medium|large` using existing inset mapping)
- max width percent (e.g. 90%) to encourage wrapping before the close button / safe areas
- timing: first N seconds vs till end
- fade in/out: none/in/out/in_out

## Open Questions (confirm before coding)
1) Text rules:
   - Max characters: recommend **140** (screen title), allow `\\n` line breaks? (recommend **yes**, max 2 lines)
2) Timing defaults:
   - Default: **First 10s** + `fade_out` (recommended); also offer **Till end**.
3) Font:
   - MVP: standardize on a server-installed font file: `DejaVuSans-Bold.ttf` (`/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`) for consistent output.
   - Future: allow choosing from a small curated font list (enum) in the preset, mapped server-side to `fontfile` paths.

## Step 1) Data model: `screen_title_presets`
Add a table (idempotent in `src/db.ts`) similar to other “config” tables:
- `screen_title_presets`
  - `id` PK
  - `owner_user_id`
  - `name` (required)
  - `description` (optional; future-proof)
  - `style` enum: `pill|outline|strip`
  - `font_key` (curated enum; MVP default `dejavu_sans_bold`)
  - `position` enum: `top_left|top_center|top_right`
  - `max_width_pct` (default 90)
  - `inset_x_preset`, `inset_y_preset` (`small|medium|large`, default `medium`)
  - `timing_rule` (`entire|first_only`) (MVP)
  - `timing_seconds` (nullable; required when `first_only`)
  - `fade` (`none|in|out|in_out`) (MVP)
  - `archived_at` (nullable)
  - `created_at`, `updated_at`

## Step 2) API: CRUD for presets
Add endpoints, ownership enforced:
- `GET /api/screen-title-presets` (active only)
- `POST /api/screen-title-presets`
- `PUT /api/screen-title-presets/:id`
- `DELETE /api/screen-title-presets/:id` (soft-archive)

## Step 3) Production config plumbing (snapshot + per-production text)
Extend production creation flow to accept:
- `screenTitlePresetId?: number|null`
- `screenTitleText?: string|null`

Server-side in `src/services/productionRunner.ts` when building `configPayload`:
- If presetId is present and text is non-empty:
  - Load preset row; verify ownership.
  - Store in production config:
    - `screenTitlePresetId`
    - `screenTitlePresetSnapshot` (style/position/insets/timing/fade/maxWidth)
    - `screenTitleText`

## Step 4) Triggering ffmpeg jobs (so screen titles actually render)
Update the “needs media job” decision in `src/services/productionRunner.ts`:
- If screen title is configured, set `needsMediaJob=true` even if:
  - no intro
  - no audio

Job selection:
- If `hasMusic` → `audio_master_v1` (must also apply screen title)
- Else → `video_master_v1` (must apply screen title, even when intro is null)

This ensures the title is burned in before MediaConvert.

## Step 5) ffmpeg implementation (shared video filter builder)
Add a new helper module to support future features (LUTs, more overlays) without rewriting pipelines:
- `src/services/ffmpeg/videoFilters.ts`
  - `buildScreenTitleFilter({ presetSnapshot, text, videoW?, videoH? }): string[]`
  - `applyScreenTitle(...)` integrated into the master pipeline

Integrate into:
- `src/media/jobs/videoMasterV1.ts` / `src/services/ffmpeg/introPipeline.ts`
- `src/media/jobs/audioMasterV1.ts` / `src/services/ffmpeg/audioPipeline.ts`

Notes:
- Use `drawbox` for pill/strip backgrounds (or `color` source overlay) + `drawtext`.
- Use safe-area-ish y inset via presets (consistent with logo inset mapping).
- Support 1–2 lines via `drawtext` with `textfile` or escaped `\\n`.
- Ensure no shell injection: write the title text to a temp text file and use `textfile=...`.
- Font handling:
  - Resolve preset `font_key` → `fontfile` path server-side (no user-supplied paths).
  - Start with a small mapping object, e.g.:
    - `dejavu_sans_bold` → `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`
  - Later we can expand the curated list without changing ffmpeg call sites.

## Step 6) Frontend: Screen Title UI on `/produce`
On `frontend/src/app/Produce.tsx`:
- Add a new “Screen Title” section:
  - Dropdown to select preset
  - Textarea for the title text (small, 2–3 visible rows)
  - Manage presets link → `/screen-title-presets`
  - Clear button resets preset + text

Persisting UI state:
- Keep preset selection in URL (`screenTitlePresetId`) like other pickers.
- Keep text in `sessionStorage` keyed by uploadId (so refresh doesn’t wipe it).

## Step 7) Frontend: Presets management page
Add `frontend/src/app/ScreenTitlePresets.tsx`:
- Create/edit/archive presets:
  - name, style, position, max width, insets, timing (first 5/10/15/20 vs till end), fade
- Route: `/screen-title-presets`

## Step 8) `/produce` preview overlay (sanity check)
Add a CSS overlay on the preview thumbnail:
- Positioned near top according to the selected preset.
- Uses an approximate style mapping (pill/outline/strip).
- Wraps text (max width) to avoid going under the preview’s close button.

This preview is not meant to be perfect; it’s just to catch “wrong preset selected” or “text too long”.

## Step 9) Manual test checklist
1) Create 2–3 presets (pill/outline/strip).
2) On `/produce`, pick a preset and enter text; confirm preview overlay appears.
3) Create a production with:
   - no audio, no intro → confirm a `video_master_v1` job is used and title is burned in.
   - audio replace/mix → confirm `audio_master_v1` job includes title overlay.
   - title-image intro / freeze intro → confirm title appears during the intro and on the poster.
4) Confirm re-editing a preset does not retroactively change older productions (snapshot works).
