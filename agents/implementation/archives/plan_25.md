# Implementation Plan 25: Route-Based Audio Picker Modal on `/produce`

## 1. Overview

Goal: Reduce clutter on `/produce?upload=:id` by moving the **audio selection UI** into a **route-based full-screen modal**. The Produce page becomes a compact “summary + current selections” screen, and the audio picker becomes a separate full-screen view that is opened/closed by changing the URL (no React Router; use query params + `history.pushState`).

Constraints / current routing:
- The SPA router in `frontend/src/main.tsx` routes by `window.location.pathname` only.
- `/produce` is already a single page; query params can control sub-views without adding a new top-level route.

Out of scope for this plan:
- Applying the same picker pattern to Logo / Logo Config / future assets (we’ll follow the same approach later).
- Any server/API changes (we reuse existing `/api/uploads?kind=audio` list).

## 2. Desired UX

On `/produce?upload=45`:
- Replace the long inline audio list with a compact “Audio” row:
  - Current selection summary (name + optional short preview control)
  - `Choose` button/link → opens the picker
  - `Clear` action → sets selection to none

On `/produce?upload=45&pick=audio` (full-screen picker):
- Full-screen modal page (mobile-first) with:
  - Header with `Back` (closes picker)
  - Search/filter (optional but recommended)
  - Scrollable list of audio uploads
  - Per-item audio player (`<audio controls>`)
  - Tap/select an item → sets selection and closes picker
  - “None” row to clear selection

Navigation behavior:
- `Back` button (browser back / swipe back on iOS) closes the picker and returns to `/produce?upload=45`.
- No full page reload required to open/close picker.

## 3. URL/State Model

Recommended query params:
- `upload=45` (existing)
- `pick=audio` (new; controls which picker is open)
- `musicUploadId=<id>` (persist selection across refresh/back)

State sync rules:
- Produce page reads `musicUploadId` on mount and initializes `selectedAudioId`.
- Picker sets selection by:
  1) updating component state (`setSelectedAudioId(id|null)`)
  2) updating the URL (remove `pick`, update `musicUploadId`)

## 4. Implementation Steps

### Step 1 — Add query parsing + URL sync helpers
- Add helpers in `frontend/src/app/Produce.tsx`:
  - `getQuery()` / `setQuery()` utilities
  - `parsePick(): 'audio' | null`
  - `parseMusicUploadId(): number | null` (if we adopt persistence)
- Add a `popstate` listener to re-sync `pick` (and `musicUploadId`) into component state.

Acceptance:
- Manually editing URL `...?pick=audio` opens the picker UI.
- Browser back closes the picker.

### Step 2 — Extract the current audio list into `AudioPicker` (full-screen)
- Create a small internal component in `frontend/src/app/Produce.tsx` (or a new file `frontend/src/app/ProduceAudioPicker.tsx` if it grows):
  - Full-screen container (fixed, `inset: 0`, safe-area padding, scrollable list)
  - “None” option
  - List items render:
    - name
    - size/date (optional)
    - `<audio controls preload="none" src="/api/uploads/:id/file">`
  - Search filter (optional; if included, filter by `modified_filename || original_filename`)

Acceptance:
- On mobile, the picker is usable and doesn’t feel cramped.
- Audio previews play without leaving the picker.

### Step 3 — Replace inline audio section with a compact summary row
- In `frontend/src/app/Produce.tsx`:
  - Replace the `audios.slice(0, 20)` block with:
    - Selected audio name (or “None selected”)
    - `Choose Audio` button/link → sets `pick=audio` via `history.pushState`
    - `Clear` button when selected
    - Keep “Manage audio” link

Acceptance:
- `/produce` no longer shows the large audio list.
- You can still pick/clear an audio selection.

### Step 4 — Persist selection (enabled)
- When selection changes, update the URL param:
  - set `musicUploadId=<id>` when selected
  - remove `musicUploadId` when cleared
- On load, initialize `selectedAudioId` from `musicUploadId`.

Acceptance:
- Hard refresh keeps the selected audio.

### Step 5 — Smoke test end-to-end
- Manual test cases:
  - Open picker → select audio → closes → selection shown on `/produce`
  - Clear selection from `/produce`
  - Open picker → “None” → closes → selection cleared
  - Browser back from picker closes it
  - Produce a production and confirm `musicUploadId` is included in `POST /api/productions`

## 5. Decisions (confirmed)

1) Persist selection in URL via `musicUploadId=<id>`.
2) Close immediately on selection; `/produce` includes a `Clear` action.
3) Picker includes a sort toggle: `Recent | Alphabetical`.
