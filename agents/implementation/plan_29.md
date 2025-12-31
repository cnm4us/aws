# Implementation Plan 29: Route-Based Logo Picker on `/produce`

## 1. Overview

Goal: Update the **Logo selection** UX on the Build Production page (`/produce?upload=:id`) to match the Audio picker and Logo Config picker pattern:
- full-screen picker driven by `?pick=logo`
- selection persisted in the URL
- tap/select closes immediately
- main page shows a compact “selected logo” indicator with **Choose** + **Clear**

In scope:
- Frontend changes in `frontend/src/app/Produce.tsx` only.
- Picker list supports sorting `Recent | Alphabetical`.
- Picker links to existing logo management pages (`/uploads?kind=logo`, `/uploads/new?kind=logo`).

Out of scope:
- Backend changes (unless we discover the list API is missing fields required for sorting/display).
- Any MediaConvert changes (this is UI-only selection wiring; existing `logoUploadId` usage stays).
- New logo preview tooling (beyond thumbnail display).

## 2. Step-by-Step Plan

1. Persist selected logo in URL (`logoUploadId`)  
   Status: Completed  
   Implementation:
   - In `frontend/src/app/Produce.tsx`, add:
     - `parseLogoUploadId()` from query string `logoUploadId`.
     - Initialize `selectedLogoId` from `parseLogoUploadId()` (default None).
     - Add `applyLogoSelection(id)` that updates state + `replaceQueryParams({ logoUploadId })`.
   - Update the `popstate` handler to re-parse `logoUploadId` on back/forward.
   Testing:
   - Manual: load `/produce?upload=<id>&logoUploadId=<logoId>` → UI reflects the selected logo immediately (and changing the selection updates `logoUploadId` in the URL).  
   Checkpoint: Wait for developer approval before proceeding.

2. Add route-driven picker state for Logo (`pick=logo`)  
   Status: Completed  
   Implementation:
   - Extend `parsePick()` to support `pick=logo`.
   - Add `openLogoPicker()` which does `pushQueryParams({ pick: 'logo' }, { modal: 'logoPicker' })`.
   - Add selection flow (same as audio/logoConfig):
     - selecting a logo stores `produce:pendingLogoUploadId` in `sessionStorage`, then `history.back()`.
     - `popstate` consumer applies the pending value and clears `pick`.
   Testing:
   - Manual: from `/produce?upload=<id>`, open picker and click “Clear selection (None)” → returns to main page and URL clears `pick` and `logoUploadId`.  
   Checkpoint: Wait for developer approval before proceeding.

3. Build the full-screen Logo picker UI  
   Status: Completed  
   Implementation:
   - Implement overlay layout matching the audio/logoConfig pickers.
   - Add `Recent | Alphabetical` sort toggle.
   - Add “None” option at top (clears selection).
   - Render each logo item as a selectable card:
     - Thumbnail from `/api/uploads/:id/file`
     - Name (`modified_filename || original_filename`)
     - Optional description + meta (date/size)
     - Selected state styling + “Select/Selected” button (or tap card).
   - Add right-side link: “Manage logos” → `/uploads?kind=logo` and secondary link “Upload logo” → `/uploads/new?kind=logo`.
   Testing:
   - Manual: sort works; selection works; “None” clears and closes immediately.  
   Checkpoint: Wait for developer approval before proceeding.

4. Simplify the main Logo section on `/produce`  
   Status: Completed  
   Implementation:
   - Replace the current radio grid with a compact card (like Audio and Logo Config):
     - Selected logo name (gold) or “None”
     - Buttons inside the card top-right: **Choose** (opens picker) and **Clear** (only when selected)
     - Optional: thumbnail preview when selected
   - Keep header row:
     - “Logo” left aligned
     - “Manage logos” right aligned
   Testing:
   - Manual: “Clear” removes `logoUploadId` from URL and resets to None.  
   Checkpoint: Wait for developer approval before proceeding.

5. Confirm production creation uses `logoUploadId` consistently  
   Status: Completed  
   Implementation:
   - Ensure `onProduce()` continues to send `logoUploadId: selectedLogoId ?? null`.
   - Confirm refresh/back/forward preserves selection.
   Testing:
   - Manual: create a production with a chosen logo; production settings show `logoUploadId` and watermark appears in outputs.  
   Checkpoint: Wait for developer approval before proceeding.

6. Build + commit  
   Status: Completed  
   Testing:
   - `npm run build`
   - `npm run web:build:scoped`
   Checkpoint: Wait for developer approval before proceeding.

## 3. Open Questions / Confirmations

Decisions:
- Use URL param `logoUploadId` (matches API field).
- Picker list shows only ready logos (`uploaded` / `completed`).
