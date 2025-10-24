Handoff Summary (Session: 2025-10-24)

Context
- Request: Adjust the upload‑scoped productions table at `/productions?upload=:id`.
- Current columns: ID, Status, Created, Job ID. First column links to production detail (`/productions?id=...`). Job ID not linked.

Additional Context
- Feeds: Ensure only posted/published items appear. Remove legacy uploads-based feed path that surfaced completed items not yet posted to any space.

Changes Implemented
- Column header ID → Name on the upload‑scoped table.
- First column link points to Publishing Options: `/publish?production=<id>`.
- Job ID column links to Production Detail: `/productions?id=<id>` when a job id is present; shows `—` when absent.
- File: `frontend/src/app/Productions.tsx` (upload‑context “Existing Productions” table).

- Feed: remove legacy uploads feed; default to Global feed (publication-driven) and Space feeds only.
- Files: `frontend/src/app/Feed.tsx`.

- Productions list thumbnails: replace the ID column with a poster thumbnail (links to production detail). Poster derived from the production’s resolved output prefix (prefers production output over upload output).
- Files: `frontend/src/app/Productions.tsx`; `src/routes/productions.ts` now enriches the joined upload with `poster_*` URLs via `enhanceUploadRow`.

- Productions main list columns/labels:
  - Rename column “Source Upload” → “Name”.
  - In the Name cell, remove the “Production #N” line and the “Source:” label; show only the production name (upload filename) linking to the publish page. Keep the meta line (status • size • WxH).
  - Remove “Created”, “Status”, and “Job ID” columns; keep “Completed”.
  - Files: `frontend/src/app/Productions.tsx`.
  - Preview thumbnail style: square 96×96 (match Uploads page), center-cropped with `object-fit: cover`.

Rationale
- Product asked to funnel users from the upload workspace directly to per‑production publishing options.
- Header reads “Name” to better reflect row intent; content remains “Production #<id>” (no canonical production name exists today).

Notes / Follow‑ups
- If we want “Name” to be a real label (e.g., editable production name), we’ll need a `name` field on `productions` and UI to edit it; otherwise we can switch label to “Production” for clarity.
- General productions list (no `upload` param) still shows its original headers; only the upload‑scoped table was changed per request.
- Build currently fails locally due to Node/TS runtime mismatch (Node too old for TS’s `??` in `_tsc.js`). App code compiles in CI/servers with current toolchain.

Quick Verify
- Open `/productions?upload=<id>` → “Existing Productions” table shows header “Name”.
- Clicking the Name opens `/publish?production=<id>`.
- Clicking a non‑empty Job ID opens `/productions?id=<id>`.

- Create a Production but do not publish → it does not appear in Global.
- Publish a Production to a space (with global visibility) → appears in Global.
- Space feeds show only published posts for that space.

- Open `/productions` (no `id`/`upload` params): first column shows poster thumbnails; click opens the production detail. Rows still show Source Upload with link to publish page.
  - Header shows “Preview, Name, Status, Completed”. No Created/Job ID columns.
  - Name cell shows just the file name linking to publish options.

Next Session Suggestions
- Confirm whether to rename the general list’s first column to “Name” for consistency.
- Decide on introducing a true production display name (and where to surface/edit it).
- Optional: add an inline “Publish” action in the upload‑scoped table for quicker access.

Commit
- Subject: feat(productions): update Name/Job ID links
- Hash: e106d5a
- Committed: 2025-10-24T17:15:13+00:00
- Meta:
  - Affects: frontend/src/app/Productions.tsx; public/app/index.html
  - Routes: /productions?upload; /publish; /productions
  - DB: none
  - Flags: none

Commit
- Subject: fix(feed): remove legacy uploads feed; default to Global
- Hash: 03e3ffe
- Committed: 2025-10-24T18:42:26+00:00
- Meta:
  - Affects: frontend/src/app/Feed.tsx
  - Routes: GET /api/feed/global; GET /api/spaces/:id/feed
  - DB: none
  - Flags: none
