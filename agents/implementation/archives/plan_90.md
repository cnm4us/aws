# Plan 90 — Split Library List vs Create Clip Page (View Modal + State Preservation)

## 1. Overview
Goal: Separate the `/library` browse experience from the clip creation tools by introducing `/library/create-clip/:id`, add a simple View modal for quick playback, and preserve list search/filter state when navigating back.

In scope:
- SPA routing for `/library/create-clip/:id`.
- Library list page with search + source filter + results only.
- View modal for quick video playback.
- Create clip page with player, waveform, captions, and clip tools plus title/metadata.
- Back link that restores search/filter state (via query params).

Out of scope:
- New backend APIs beyond SPA routing.
- Major visual redesign of Library styling.
- Changing clip storage behavior or permissions.

## 2. Step-by-Step Plan

1. Add SPA route for `/library/create-clip/:id` on the backend
   Status: Completed
   Implementation:
   - Serve `app/index.html` for `/library/create-clip/:id` (and optional trailing slash).
   Testing:
   - Canonical (expected): `curl -sS -I http://localhost:3300/library/create-clip/874` → `HTTP 200` and `Content-Type: text/html`.
   - Record actual output: `agents/implementation/tests/plan_90/step_01_route.md` (pass).
   Checkpoint: Wait for developer approval before proceeding.

2. Refactor Library frontend routing to support list vs create-clip view
   Status: Completed
   Implementation:
   - Split `frontend/src/app/Library.tsx` into list and create components (same file or new components).
   - Detect pathname `/library/create-clip/:id` and render the create page layout; otherwise render list.
   - Ensure create page pulls video data by id (e.g., `/api/library/videos/:id`).
   Testing:
   - Canonical (expected): `curl -sS http://localhost:3300/library/create-clip/874 | rg -n "Library"` → HTML served (SPA shell).
   - Record actual output: `agents/implementation/tests/plan_90/step_02_spa.md` (pass).
   Checkpoint: Wait for developer approval before proceeding.

3. Update Library list page (browse-only) with View modal + Create Clip action
   Status: Completed
   Implementation:
   - Keep search + source filter + results list.
   - Add a `View` button that opens a modal with a simple video player for quick preview.
   - Add a `Create clip` button that navigates to `/library/create-clip/:id`.
   - Sync `q` and `source_org` into the URL query string so it can be restored.
   Testing:
   - Canonical (expected): manual UI: search + filter applied; View modal plays; Create clip navigates.
   - Record actual notes: `agents/implementation/tests/plan_90/step_03_list_ui.md` (pending).
   Checkpoint: Wait for developer approval before proceeding.

4. Build the create-clip page with header + back link preserving search state
   Status: Completed
   Implementation:
   - Show selected video title + metadata at the top.
   - Render the existing player, waveform, captions panel, and clip tools below.
   - Add a `Back to library` link using the stored query string (q + source_org).
   Testing:
   - Canonical (expected): manual UI: create page loads for `/library/create-clip/:id`, header shows metadata, back link restores list filters.
   - Record actual notes: `agents/implementation/tests/plan_90/step_04_create_ui.md` (pending).
   Checkpoint: Wait for developer approval before proceeding.

5. Polish and regression checks
   Status: In Progress
   Implementation:
    - Ensure clip tools still work after route split.
    - Ensure view modal cleanup on close (stop playback, clear state).
    - Verify query persistence across refreshes and back navigation.
   - iOS input stability: avoid zoom on transcript search field (font size >= 16).
   - Waveform scrubber: fixed playhead, drag-to-scrub with pause/resume, and +/-10s long-press nudges.
   Testing:
   - Canonical (expected): manual UI: no console errors; captions/waveform/clip tools still function.
   - Record actual notes: `agents/implementation/tests/plan_90/step_05_polish.md`
   Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes
- Step 1 — Status: Completed — SPA route serves index.html (see `agents/implementation/tests/plan_90/step_01_route.md`).
- Step 2 — Status: Completed — SPA list vs create-clip route split rendered (see `agents/implementation/tests/plan_90/step_02_spa.md`).
- Step 3 — Status: Completed — List page has View modal + Create clip action with URL state sync (manual UI check pending).
- Step 4 — Status: Completed — Create clip page has back link + metadata header (manual UI check pending).
- Step 2 — Status: Pending
- Step 3 — Status: Pending
- Step 4 — Status: Pending
- Step 5 — Status: Pending
