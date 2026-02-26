# Implementation Plan 28: Route-Based Logo Config Picker on `/produce`

## 1. Overview

Goal: Make **Logo Config selection** on the Build Production page (`/produce?upload=:id`) work the same way as the Audio picker: a **route/query-driven full-screen picker**, selection persisted in the URL, tap-to-select closes immediately, and the main page provides a clear “clear selection” path.

In scope:
- Update `frontend/src/app/Produce.tsx` to use a route/query-driven picker for **Logo Config** (`pick=logoConfig`) and persist selection in `logoConfigId`.
- Keep existing `/logo-configs` management page as-is; picker links to it.
- Ensure POST `/api/productions` continues to send `logoConfigId` (or `null`).

Out of scope:
- Route-based pickers for Logo asset selection, banners/title screens, etc.
- Backend/API changes (unless strictly required to expose fields needed for sorting/display).

## 2. Step-by-Step Plan

1. Add URL persistence + parsing for `logoConfigId`  
   Status: Completed  
   Implementation:
   - In `frontend/src/app/Produce.tsx`, add:
     - `parseLogoConfigId()` from query string.
     - state `selectedLogoConfigId` initialized from URL.
     - URL helpers to `replaceQueryParams({ logoConfigId })` whenever selection changes.
   - Remove the current “auto-select Standard watermark” initialization so missing `logoConfigId` truly means None.
   Testing:
   - Manual: load `/produce?upload=<id>&logoConfigId=<validId>` → UI reflects selected config without clicking.  
   Checkpoint: Wait for developer approval before proceeding.

2. Add route-driven picker state for Logo Config (`pick=logoConfig`)  
   Status: Completed  
   Implementation:
   - Extend existing picker pattern (audio) to support `pick=logoConfig`.
   - Add `openLogoConfigPicker()` which `pushQueryParams({ pick: 'logoConfig' }, { modal: 'logoConfigPicker' })`.
   - Add selection flow:
     - selecting a config stores `produce:pendingLogoConfigId` in `sessionStorage`, then `history.back()`.
     - popstate handler consumes pending value and applies selection + clears `pick`.
   Testing:
   - Manual: from `/produce?upload=<id>`, click “Choose” (Logo Config) → overlay opens; click “Clear selection (None)” → returns and URL has no `pick`/`logoConfigId`.  
   Checkpoint: Wait for developer approval before proceeding.

3. Build the full-screen Logo Config picker UI  
   Status: Completed  
   Implementation:
   - Implement the overlay layout matching the audio picker (full-screen, safe-area padding, Back button).
   - List configs with:
     - Name (primary)
     - Summary line (position, size, opacity, timing rule/seconds, fade)
     - Selected state styling
   - Add “None” option at top (sets `logoConfigId=null`).
   - Add Sort toggle: `Recent | Alphabetical` (same UX as audio).
   - Add link: “Manage logo configs” → `/logo-configs`.
   Testing:
   - Manual: sorting changes order; selecting “None” clears and closes immediately.  
   Checkpoint: Wait for developer approval before proceeding.

4. Simplify the main Logo Config section on `/produce`  
   Status: Completed  
   Implementation:
   - Replace the current radio grid with:
     - A compact “Selected Logo Config” line (name + summary).
     - Buttons: “Choose” (opens picker) and “Clear” (sets null + removes `logoConfigId`).
   - Keep “Manage logo configs” link.
   Testing:
   - Manual: “Clear” removes `logoConfigId` from URL and resets the display to None.  
   Checkpoint: Wait for developer approval before proceeding.

5. Ensure production creation uses the selected `logoConfigId` consistently  
   Status: Completed  
   Implementation:
   - Confirm `onProduce()` sends `logoConfigId` from state (or `null`) and that the selection is stable across refresh.
   Testing:
   - Manual: create a production with a chosen config, then open production detail/settings view and confirm config snapshot matches.  
   Checkpoint: Wait for developer approval before proceeding.

6. Build + commit  
   Status: Completed  
   Testing:
   - `npm run build`
   - `npm run web:build:scoped`
   Checkpoint: Wait for developer approval before proceeding.

## 3. Open Questions / Confirmations

Decisions:
- Default selection is **None** when `logoConfigId` is absent (no auto-pick of “Standard watermark”).  
- Archived logo configs are excluded from the picker (current API behavior).  
