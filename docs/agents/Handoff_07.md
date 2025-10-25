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

- Production naming:
  - DB: add `productions.name VARCHAR(255) NULL` (idempotent migration + column in initial schema).
  - API: POST `/api/productions` accepts optional `name` and persists it.
  - Runner: `startProductionRender` insert includes `name`; route applies a back-compat UPDATE to set `name` after insert if runner did not persist it (older build).
  - Types: add `name` to `ProductionRow` (server + frontend).
  - UI (upload-scoped view `/productions?upload=:id`): add a text input “Name this production (optional)” above the Create Production button; pass through on create; Existing Productions table shows `prod.name` (fallback `Production #<id>`); link remains to `/publish?production=<id>`.
  - Files: `src/db.ts`; `src/services/productionRunner.ts`; `src/routes/productions.ts`; `frontend/src/app/Productions.tsx`.

- Bugfix: name not persisted from UI
  - Root cause: `handleCreateProductionForUpload` was wrapped in `useCallback` without `newProductionName` in the dependency list, so it always sent an empty/undefined name.
  - Fix: add `newProductionName` to the dependency array so the latest value is posted.
  - File: `frontend/src/app/Productions.tsx`.

Refactor — Publications (skeleton only, no behavior change)
- Added foundational structure to migrate heavy logic out of routes:
  - `src/core/errors.ts` — DomainError + common subclasses (NotFound/Forbidden/Conflict/InvalidState/Validation).
  - `src/core/http.ts` — middleware to translate DomainError → HTTP JSON (not yet wired).
  - `src/features/publications/types.ts` — domain types for publications/events and service context.
  - `src/features/publications/repo.ts` — stubbed SQL layer (functions throw not_implemented for now).
  - `src/features/publications/service.ts` — stubbed use-case methods with TODOs.
  - `src/features/publications/routes.ts` — thin-route placeholders (not mounted yet).
- Scope: skeleton only; no imports/wiring changed, so runtime behavior is unchanged.

Refactor — Publications (first endpoint migrated)
- Route GET `/api/productions/:productionId/publications` now delegates to the new service/repo:
  - Service: `listByProductionForDto` handles permission check (owner/admin) and uses repo projection.
  - Repo: `loadProduction`, `listPublicationsForProduction` mirror the previous SQL.
  - Route preserves the exact response shape and error mapping.
- Files: `src/features/publications/{service.ts, repo.ts}`; `src/routes/publications.ts` (handler updated).

Refactor — Publications (second endpoint migrated)
- Route GET `/api/uploads/:uploadId/publications` now delegates to the new service/repo:
  - Service: `listByUploadForDto` enforces owner/admin permission with the same logic as before (including `video:publish_own` for owners).
  - Repo: `loadUpload`, `listPublicationsForUpload` mirror the previous SQL and ordering.
  - Route preserves the exact response shape and error mapping.
- Files: `src/features/publications/{service.ts, repo.ts}`; `src/routes/publications.ts` (handler updated).

Refactor — Publications (third endpoint migrated)
- Route GET `/api/publications/:id` now uses the service/repo:
  - Service: `getForDto` loads the publication and events, enforces permissions (admin/owner/moderator), and computes `canRepublishOwner` using the last unpublish event rule.
  - Repo: `getById`, `listEvents`, and `loadUpload` provide needed projections.
  - Route keeps the response shape `{ publication, events, canRepublishOwner }` and prior error mapping.
- Files: `src/features/publications/{service.ts, repo.ts}`; `src/routes/publications.ts` (handler updated).

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
  - On `/productions?upload=<id>`: entering a name and clicking Create Production persists the name; the Existing Productions table displays the name (linked to publish page).

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

Commit
- Subject: feat(productions): square previews and streamlined columns
- Hash: 943925e
- Committed: 2025-10-24T19:30:31+00:00
- Meta:
  - Affects: frontend/src/app/Productions.tsx; src/routes/productions.ts
  - Routes: /productions; /publish?production=:id
  - DB: none
  - Flags: none

Commit
- Subject: feat(productions): naming + production-specific poster; show names in lists
- Hash: 133d611
- Committed: 2025-10-24T21:27:00+00:00
- Meta:
  - Affects: src/db.ts; src/services/productionRunner.ts; src/routes/productions.ts; frontend/src/app/Productions.tsx; frontend/src/app/Publish.tsx; docs/agents/Handoff_07.md
  - Routes: POST /api/productions; GET /api/productions; GET /api/productions/:id
  - DB: add column productions.name (idempotent)
  - Flags: none

Commit
- Subject: refactor(publications): extract list-by-production to service/repo
- Hash: 0a1a845
- Committed: 2025-10-25T18:59:09+00:00
- Meta:
  - Affects: src/routes/publications.ts; src/features/publications/types.ts; src/features/publications/repo.ts; src/features/publications/service.ts; src/features/publications/routes.ts; src/core/errors.ts; src/core/http.ts
  - Routes: GET /api/productions/:productionId/publications
  - DB: none
  - Flags: none

Commit
- Subject: refactor(publications): migrate upload publications list to service/repo
- Hash: 0ee79db
- Committed: 2025-10-25T19:14:19+00:00
- Meta:
  - Affects: src/routes/publications.ts; src/features/publications/repo.ts; src/features/publications/service.ts; docs/agents/Handoff_07.md
  - Routes: GET /api/uploads/:uploadId/publications
  - DB: none
  - Flags: none
