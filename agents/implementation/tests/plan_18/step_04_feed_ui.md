# Plan 18 — Step 4 Feed UI (Global Feed: Jump, no Like/Comment)

Date: 2025-12-29

## Changes

- `frontend/src/app/Feed.tsx`
  - Global Feed billboard detection: `isGlobalBillboard` is true when either:
    - `feedMode.kind === 'global'` (root Global Feed mode), OR
    - the active space slug is `global` / `global-feed` (e.g. `/channels/global-feed`).
  - When `isGlobalBillboard`:
    - Like/Comment UI is not rendered.
    - A “Jump” icon is rendered; clicking opens `JumpToSpaceModal`.
    - The eager `ensureLikeSummary()` prefetch effect is disabled (since Like UI is not rendered).
  - When not `isGlobalBillboard`: Like/Comment remain unchanged.

## Manual verification checklist

- Visit `/channels/global-feed`:
  - Like/Comment icons and counts are not shown.
  - Jump icon is shown; clicking opens modal.

- Visit any non-global channel/group feed:
  - Like/Comment still appear and behave as before.

