Handoff 11

Priority Backlog (Refactor Objectives)
- Objective:
  - Organize code to facilitate adding new features and extending existing ones quickly.
  - Organize code so it’s optimized for agent work: consistent patterns, thin routes, typed services, standard validation and errors.
- Instructions:
  - Maintain this Priority Backlog at the top of each Handoff_N.md.
  - Copy this section forward to Handoff_{N+1}.md at the start of a new thread and update statuses as items complete or are added.
  - Use P1 for highest-impact foundation items; P2 for high-value follow‑ups; P3 for structural polish.

- P1 (foundation, highest impact)
  - [x] Modularize Admin (roles, users, spaces, site settings, capabilities, members/invitations, dev utils) — completed
  - [x] Add centralized DomainError middleware and register globally — completed
  - [x] Add Zod validation to admin routes — completed
  - [x] Add Zod + middleware cleanup to publications, productions, spaces routes — completed (feeds endpoints left as-is)
- [ ] Replace remaining permission helpers/strings with PERM and service checks (e.g., remove ensurePermission usage in routes/spaces.ts)
  - [x] Remove legacy ensurePermission in routes/spaces.ts; rely on service checks
  - [ ] Convert spaces feed endpoints to next(err) and/or move remaining DB logic behind services while preserving shapes

- P2 (high-value follow-ups)
  - [ ] DTO typing + mapping: introduce DTO types per feature and centralize mapping in services or small mappers; standardize pagination shapes
  - [ ] Pagination helpers adoption across lists (clampLimit, parse*Cursor) where missing
  - [ ] Deprecate legacy /api/publish in favor of POST /api/productions; document deprecation window; keep compatibility
  - [ ] Document and (optionally) relocate enhanceUploadRow with explicit types (core or uploads util)
  - [ ] Docs refresh (docs/API.md, docs/Architecture.md) for features/{repo,service}, Zod use, error middleware, admin structure

- P3 (structural polish)
  - [ ] Feature surface cleanup: add index.ts per feature to simplify imports and exports
  - [ ] Error code catalog per feature to reduce ad‑hoc error strings
  - [ ] Remove dead code (e.g., empty src/models/), stale helpers/imports

Summary
- New thread initialized from agents README. Carrying forward backlog and decisions from Handoff_10. Proposed next step: make feed endpoints consistent with global error middleware and move residual DB access out of routes.

Decisions (carried + new)
- Adopt feature-module service/repo pattern for endpoints (publications, productions, feeds migrated; uploads and spaces largely complete; continue for remaining routes).
- Preserve existing response shapes and error mapping at the route layer.
- Use canonical status/visibility types from `src/db` to avoid drift.
- Feeds: keep Global and Space feeds; legacy uploads-based feed remains removed.
- Poster URLs derived via upload enhancement (current `enhanceUploadRow` usage; consider relocation later).
- Production naming: `productions.name` exists; UI passes optional name; back-compat update path retained in service.
- Prefer PERM constants (`src/security/perm.ts`) over string literals across all modules; remove remaining stragglers.

Changes Since Last
- Affects: src/routes/spaces.ts; src/features/spaces/service.ts
- Routes: GET /api/spaces/:id/feed; GET /api/feed/global
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: refactor(spaces): move feed checks to service and PERM cleanup

Context:
- Align feed routes with global DomainError middleware and remove remaining DB access from routes. Preserve legacy error codes for client compatibility.

 Approach:
  - Added service helpers `loadSpaceOrThrow` and `assertCanViewSpaceFeed` to encapsulate space loading and permission checks with DomainError codes.
  - Updated `/api/spaces/:id/feed` to call service, parse pagination, and `next(err)` with legacy code wrapping (`failed_to_load_feed`).
  - Updated `/api/feed/global` to `next(err)` with legacy code wrapping (`failed_to_load_global_feed`).
  - Removed legacy `ensurePermission` helper and unused imports in `routes/spaces.ts`; routes defer to service + PERM-based checks.

Impact:
- Centralized permission logic; routes are thinner and consistent with error middleware. Response error codes for failures remain stable.

Tests:
- Build passes (`npm run build`). Manual check of routes and imports. Recommend E2E smoke for space feed and global feed with pagination.

References:
- docs/agents/AGENTS.md commit policy; Handoff_10 backlog P1 items

 Meta:
- Affects: src/routes/spaces.ts; src/features/spaces/service.ts
- Routes: GET /api/spaces/:id/feed; GET /api/feed/global
- DB: none
- Flags: none

Commit:
- 
- Committed: 

Git Commands (used when committing)
- git add <paths>
- git commit -m "<subject>" -m "<body>" -m "Meta: Affects: …" -m "Meta: Routes: …" -m "Meta: DB: …" -m "Meta: Flags: …"

Thread Plan (subset of Backlog)
- [ ] Convert spaces feed endpoints to next(err) and move DB logic behind services (Backlog: P1)
- [ ] Replace remaining permission helpers/strings with PERM and service checks; remove dead helpers (Backlog: P1)

Work Log (optional, terse; reverse‑chronological)
- 2025-11-03T00:00Z — Initialized Handoff_11; copied backlog and decisions; ready to proceed with P1 tasks.

Artifacts (optional)
<!-- none -->
