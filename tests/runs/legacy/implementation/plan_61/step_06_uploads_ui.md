# Plan 61 — Step 6 (Uploads UI)

## Change
- `/uploads` now fetches active production drafts (`GET /api/production-drafts/active`) and shows:
  - `New Production` when no active draft exists for an upload
  - `Resume Production` + `Start Over` (archives draft) when an active draft exists

## Manual checks
- Open `/uploads` (Videos).
- For an upload with no active draft:
  - Open the card overlay (cog) → see `New Production`.
- For an upload with an active draft:
  - Open the card overlay (cog) → see `Resume Production` + `Start Over`.
  - Click `Resume Production` → `/produce?upload=<id>` loads saved selections.
  - Click `Start Over` → confirm → archives the draft and navigates to `/produce?upload=<id>` with a fresh draft.

## Notes
- Frontend uses upload thumbnails first (`/api/uploads/:id/thumb`) with fallback to poster URLs.

