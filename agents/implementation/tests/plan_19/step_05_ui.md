# Plan 19 — Step 5 UI (forward ?pin to /api/spaces/:id/feed)

Date: 2025-12-29

## Implementation notes

- `frontend/src/app/Feed.tsx`
  - Reads `?pin=<production_ulid>` from `window.location.search`.
  - Passes it to `/api/spaces/:id/feed` only on the initial space feed fetch (cursor absent).
  - Load-more requests still include only `cursor` (server ignores pin when cursor is present anyway).

## Manual verification checklist

- From Global Feed, click Jump to a group/channel:
  - URL should include `?pin=<production_ulid>` (from Step 4).
  - The destination feed should show that pinned video as the first slide.

