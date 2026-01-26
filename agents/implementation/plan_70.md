# Implementation Plan 70: Move Screen Title Styles Management Under `/assets/screen-titles`

## 1. Overview
Goal: align Screen Title Style management with the new Asset Library architecture.

- **Pick**: `/assets/screen-titles?mode=pick&return=...&project=...` remains the selection UI for inserting a style into the active timeline.
- **Manage**: `/assets/screen-titles` becomes the canonical management UI (list + new/edit/delete).
- `/screen-title-presets` remains temporarily for debugging only, with no navigation pointing at it (so we can detect lingering usage and delete it later).

Key UX requirements:
- In pick mode: **Select only** (no edit/delete).
- In manage mode: **New/Edit/Delete only** (no select).
- Editing a style from the timeline should always return to the timeline and re-render all screen title segments in the current project that reference that style.

## 2. Route Map

### 2.1 New SPA routes (Assets bundle)
- `/assets/screen-titles`
  - Manage list (default) OR pick list when `mode=pick`
- `/assets/screen-titles/new`
  - New style form
- `/assets/screen-titles/:id/edit`
  - Edit style form

### 2.2 Legacy SPA route (debug-only, no navigation)
- `/screen-title-presets`
  - Keep working for now but show a “Legacy debug route” banner and log usage.

## 3. Data Flow

### 3.1 Pick mode insertion (unchanged)
- User selects a style card → redirect to `return` with `cvPickType=screenTitleStyle&cvPickPresetId=<id>`
- `/create-video` consumes pick params, inserts the segment, then clears URL pick params.

### 3.2 Manage mode editing round-trip (timeline-driven)
- Timeline object context menu:
  - `Edit Style` → navigates to `/assets/screen-titles/:id/edit?return=<encoded /create-video?...>`
- Save:
  - Persist style (`PATCH /api/screen-title-presets/:id`)
  - Navigate back to the `return` URL
  - Trigger re-render in `/create-video` for the active project:
    - Regenerate preview render uploads for all screen title segments in the current project that reference this preset.

Mechanism for “trigger re-render”:
- Preferred: write a tiny marker into `localStorage` keyed by `projectId` + `presetId` on Save (e.g. `cv_screen_title_preset_updated:<projectId>=<presetId>:<ts>`), and have `/create-video` check it on load and run the existing “refresh preset usages” logic.
- Alternative: include a query param on return (`cvRefreshPresetId=<id>`) and have `/create-video` act on it once and clear it (works better for multi-tab but adds URL noise).

## 4. Implementation Steps

### Step 1 — Extract reusable Screen Title Style components
Status: Pending
- Split `frontend/src/app/ScreenTitlePresets.tsx` into small pieces usable in both places:
  - `ScreenTitlePresetList` (manage list)
  - `ScreenTitlePresetForm` (new/edit)
- Keep existing API calls (`/api/screen-title-presets*`) unchanged.

### Step 2 — Implement `/assets/screen-titles` manage list
Status: Pending
- In `frontend/src/app/Assets.tsx`, wire `typePath === 'screen-titles'`:
  - `mode=pick`: existing pick list (Select only).
  - `mode=manage`: show manage list:
    - `New Style` → `/assets/screen-titles/new`
    - Each card: `Edit` → `/assets/screen-titles/:id/edit`, `Delete` → deletes preset.

### Step 3 — Implement `/assets/screen-titles/new` + `/:id/edit`
Status: Pending
- Add routing for nested screen title routes under the Assets bundle.
- New/edit forms should accept `return=<...>`:
  - On Save: go back to `return` (always timeline for timeline-driven flows).
  - If no `return`, go back to `/assets/screen-titles`.

### Step 4 — Update timeline navigation to new routes
Status: Pending
- `/create-video` screen title object:
  - `Manage Styles` → `/assets/screen-titles?return=<...>` (manage mode, not pick)
  - `Edit Style` → `/assets/screen-titles/:id/edit?return=<...>`
- Remove any remaining navigations to `/screen-title-presets` from Create Video and Assets pick flows.

### Step 5 — Make `/screen-title-presets` debug-only and detectable
Status: Pending
- Add a banner at the top: “Legacy debug route — use `/assets/screen-titles` for management.”
- Add a server-side request log when `GET /screen-title-presets` is hit (best-effort):
  - Log includes user id if available.
- Confirm no UI paths link to this route anymore.

### Step 6 — Verify regeneration behavior
Status: Pending
- When a style is edited from the timeline flow:
  - Save style
  - Return to timeline
  - All screen title segments using that style regenerate preview PNGs and reflect updated styling.

## 5. Acceptance Criteria
- `/assets/screen-titles` is the canonical management UI (mode=manage).
- `/assets/screen-titles?mode=pick...` works for timeline selection (Select only).
- Timeline object context menu → `Edit Style` returns to timeline and triggers re-render of all in-project segments using that preset.
- `/screen-title-presets` remains reachable but is not used by any normal navigation, and its usage is observable (banner + server log).

