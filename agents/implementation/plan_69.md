# Implementation Plan 69: Unify Asset Library Under `/assets` (Manage + Pick Mode)

## 1. Overview
Goal: remove duplicated “asset list” UIs that currently exist in both:
- `/create-video` (timeline editor with embedded asset pickers + management UIs), and
- `/uploads?...` (legacy asset lists for logos/images/etc).

Replace with a single canonical **Asset Library** under `/assets` with two modes:
- **Manage mode** (default): create/edit/delete assets (no selection).
- **Pick mode**: selection-only flow used by `/create-video` “Add” to insert assets into the current timeline.

Key UX requirements:
- The entry screen should remain the same **asset-type cards grid** (Video, Graphics, Logos, Lower Thirds, Screen Titles, Narration, Audio/Music).
- Pick mode should be **selection only** (no upload/edit/delete), to keep return-to-timeline simple.
- Exception: Screen Title Style editing round-trip (from timeline → style edit → back to timeline) stays supported.

Bundle goals:
- Shrink `/create-video` bundle: timeline + playback + export + insertion logic.
- New `/assets` bundle contains asset library UI.

## 2. Route Map

### 2.1 New SPA routes
- `/assets`
  - Shows the asset-type cards grid.
  - Reads `mode=manage|pick` (default `manage`).
  - Reads `return=<url>` + `project=<id>` only when `mode=pick`.
- `/assets/:type`
  - Lists items for the selected type (cards).
  - `mode=manage`: manage UI (New/Edit/Delete).
  - `mode=pick`: selection-only UI (Select + Back to timeline).

### 2.2 Existing routes (unchanged)
- `/create-video`
  - “Add” should navigate to `/assets?mode=pick&project=<id>&return=<encoded>`.
  - Insertion continues to be handled by `/create-video` based on URL params (or a small `/api/create-video/.../insert` endpoint if needed later).
- `/screen-title-presets`
  - Keep the existing “Back to timeline” and “re-render style usages” loop.
  - Continue using `from=<return>` to re-open the Create Video context.

## 3. Data Flow: Pick Mode → Timeline Insertion

Pick mode should not mutate projects directly.

### 3.1 Selection redirect contract (URL-based)
When the user taps “Select” on an asset card inside `/assets/:type?mode=pick...`:
- redirect to the `return` URL with selection payload appended:
  - `pickType=<type>` (e.g. `video|graphic|logo|lowerThird|audio|narration|screenTitleStyle`)
  - `pickUploadId=<id>` or relevant identifiers:
    - video: `pickUploadId`
    - graphic: `pickUploadId`
    - narration: `pickUploadId`
    - audio/music: `pickUploadId` + optional `pickAudioConfigId`
    - logo: `pickUploadId` + `pickLogoConfigId` (two-step picker)
    - lower third: `pickUploadId` + `pickLowerThirdConfigId` (two-step picker)
    - screen title style: `pickPresetId`
- `/create-video` consumes the payload and:
  - inserts the appropriate timeline object at playhead (existing behavior),
  - clears the pick query params using `history.replaceState`.

Rationale: keeps `/assets` dumb and avoids CSRF/403 issues; `/create-video` remains the only “timeline mutator”.

## 4. Implementation Steps

### Step 1 — Add `/assets` SPA route + basic grid (manage-only)
Status: Pending
- Add new React page `frontend/src/app/Assets.tsx`
  - renders the asset-type card grid.
  - each card links to `/assets/<type>` in manage mode.
- Wire route into `frontend/src/main.tsx` and `frontend/src/ui/routes.ts`.

### Step 2 — Add `/assets/:type` manage pages (reuse existing list UIs)
Status: Pending
For each type, implement manage list + edit/create screens:
- `video` (raw uploads list):
  - can be a thin wrapper linking to existing `/uploads` video view for now, or a dedicated list that calls `/api/uploads?kind=video&video_role=source` (preferred).
- `graphic` (overlay images)
- `logo`
- `lowerThird`
- `audioMusic` (system + my audio, with Search tab)
- `narration` (named voice clips)
- `screenTitles` (style list + link to editor)

Migration approach:
- Start by reusing the existing components that currently live inside Create Video pickers.
- Extract those into `/assets` pages with props (mode, return, project).

### Step 3 — Add Pick mode (selection-only)
Status: Pending
- Add `mode=pick` support to `/assets`:
  - show same grid, but card clicks preserve `mode`, `return`, `project`.
- Add `mode=pick` support to `/assets/:type`:
  - hide New/Edit/Delete entirely.
  - show `Select` on cards.
  - show a top bar:
    - `← Back to Timeline` (href = `return`)
    - (optional) “Picking for: <timeline name>” if project name is available via `/api/create-video/projects/:id`.
- Implement selection redirects (contract above).

### Step 4 — Wire `/create-video` “Add” to `/assets?mode=pick...`
Status: Pending
- Replace current internal “Add Assets” navigation inside Create Video with:
  - `window.location.href = /assets?mode=pick&project=<id>&return=<encodedCreateVideoUrl>`
- Ensure the return url includes the current `project` query param.

### Step 5 — Remove duplicated asset pick/manage UIs from Create Video
Status: Pending
- Delete or dead-code the following Create Video screens that are now served by `/assets/*`:
  - logo list/manage
  - lower third list/manage
  - graphics list/manage
  - narration list/manage
  - audio list/manage/search
  - screen title style list (keep only timeline object properties + “Manage Styles” link)
- Keep the modal property editors for timeline objects (position/trim/config, etc).

### Step 6 — Menu updates
Status: Pending
- Slideout menu: add `Library` section with:
  - `Assets` → `/assets`
  - `Timelines` → `/create-video` (or `/create-video?picker=1` if we add a landing picker later)
  - `Exports` → `/exports`
  - `Productions` → `/productions`
- Update any existing “My Assets” links that point to `/uploads?kind=...` to point to `/assets` or `/assets/<type>`.

## 5. Testing Checklist
- `/assets` shows the asset-type cards grid in manage mode.
- `/assets/<type>` manage mode supports create/edit/delete (as applicable).
- `/create-video` Add → navigates to `/assets?mode=pick...`.
- `/assets` pick mode:
  - selecting a type → selecting an item → returns to timeline and inserts correctly.
  - no upload/edit/delete visible in pick mode.
- Screen title styles:
  - from timeline → manage styles → edit → back to timeline; affected titles re-render.
- Build:
  - `npm run web:build` passes.

## 6. Open Questions (to confirm before coding)
Resolved:
1) `/assets/video` should be a dedicated list (aligned with the new architecture).
2) Add a dedicated `/timelines` page (list projects) outside of Create Video’s in-page picker.
