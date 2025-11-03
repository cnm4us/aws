Handoff 09

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

Thread Plan (subset of Backlog)
- [P1] Replace remaining permission helpers/strings with PERM and service checks (Backlog: P1)
- [P1] Convert spaces feed endpoints to next(err) and/or move remaining DB logic behind services (Backlog: P1)
- [P2] DTO typing + mapping per feature; standardize pagination shapes (Backlog: P2)
- [P2] Pagination helpers adoption where missing (Backlog: P2)
- [P2] Deprecate legacy /api/publish; document and keep compatibility (Backlog: P2)
- [P2] Document and (optionally) relocate enhanceUploadRow with explicit types (Backlog: P2)
- [P2] Docs refresh: API/Architecture for features pattern, Zod, middleware (Backlog: P2)
- [P3] Feature export hygiene (index.ts per feature), error code catalog, remove dead code (Backlog: P3)

Summary
- Bootstrapped new thread per agents README. Reviewed AGENTS.md, Handoff.md, and Handoff_08.md. Audited current routes/services to identify remaining refactor targets. Captured a prioritized backlog to continue modularization and consistency work.

Decisions (carried + new)
- Adopt feature-module service/repo pattern for endpoints (publications, productions, feeds migrated; uploads and spaces largely complete; continue for remaining routes).
- Preserve existing response shapes and error mapping at the route layer.
- Use canonical status/visibility types from `src/db` to avoid drift.
- Feeds: keep Global and Space feeds; legacy uploads-based feed remains removed.
- Poster URLs derived via upload enhancement (current `enhanceUploadRow` usage; consider relocation later).
- Production naming: `productions.name` exists; UI passes optional name; back-compat update path retained in service.
- New: Prefer PERM constants (`src/security/perm.ts`) over string literals across all modules; remove remaining stragglers.

Changes Since Last
- Affects: docs/agents/Handoff_09.md; src/features/productions/service.ts; src/routes/publish.ts; src/features/publications/{repo.ts,service.ts}; src/routes/publish-single.ts; src/features/spaces/service.ts; src/routes/spaces.ts; src/security/permissions.ts
- Routes: POST /api/publish; POST /api/uploads/:id/publish; POST /api/uploads/:id/unpublish; DELETE /api/spaces/:id/members/:userId
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: refactor(publish): delegate /api/publish to productions service wrapper

Context:
- Keep legacy /api/publish behavior but move logic into a service layer. Preserve response shape and permission semantics.

Approach:
- Add productions.service.createForPublishRoute with legacy permission checks (owner, space/global publish, approve, admin). Route delegates and keeps profile selection logic.

Impact:
- No API shape changes; legacy route now thin and aligned with service pattern.

Tests:
- Issue POST /api/publish with owner and moderator roles; verify jobId/output and profile selection unchanged.

Meta:
- Affects: src/features/productions/service.ts; src/routes/publish.ts
- Routes: POST /api/publish
- DB: none
- Flags: none

Subject: refactor(publications): move multi-space publish/unpublish to service

Context:
- The routes handled complex publish/unpublish flows for an upload across multiple spaces. Centralize in publications service while preserving behavior (created vs activated sets, last-actor rule, comments default).

Approach:
- Add publications.service publishUploadToSpaces and unpublishUploadFromSpaces. Pre-check existing production-space mapping for republish vs create; compute comments_enabled default; reuse service permission/event logic.
- Add repo helpers: getUserDefaultCommentsEnabled, setCommentsEnabled, listPublicationIdsForUploadSpaces.
- Update routes to delegate and preserve response shapes.

Impact:
- No API shape changes; routes are thinner and logic is reusable.

Tests:
- POST /api/uploads/:id/publish with various roles and spaces; verify created/activated arrays and comments default. POST /api/uploads/:id/unpublish enforces permissions per space.

Meta:
- Affects: src/features/publications/{repo.ts,service.ts}; src/routes/publish-single.ts
- Routes: POST /api/uploads/:id/publish; POST /api/uploads/:id/unpublish
- DB: none
- Flags: none

Subject: refactor(spaces): delegate member removal to service

Context:
- Keep route thin and centralize permission and mutation logic for removing a space member.

Approach:
- Add spaces.service.removeMember(spaceId, targetUserId, actorUserId) with permission checks (manage_members or site admin) and owner guard. Route delegates and preserves error/status mapping.

Impact:
- No API shape change; route is simpler; logic centralized.

Tests:
- DELETE /api/spaces/:id/members/:userId enforces permissions; cannot remove owner unless site admin.

Meta:
- Affects: src/features/spaces/service.ts; src/routes/spaces.ts
- Routes: DELETE /api/spaces/:id/members/:userId
- DB: none
- Flags: none

Subject: chore(permissions): replace string literals with PERM constants in services

Context:
- Eliminate drift-prone string permission names in services and core checks.

Approach:
- spaces.service: use PERM.SPACE_CREATE_GROUP/CHANNEL in createSpace; PERM.SPACE_INVITE_MEMBERS / PERM.SPACE_MANAGE_MEMBERS / PERM.VIDEO_DELETE_ANY in invitation flows.
- publications.service: use PERM.VIDEO_APPROVE_SPACE/APPROVE and PERM.VIDEO_UNPUBLISH_OWN/SPACE.
- permissions.ts: compare against PERM constants for video review/approve/publish/unpublish in any-space moderation guard.

Impact:
- No behavior change; improves readability and consistency when editing permissions.

Tests:
- Build in your environment; routes and services compile; permission checks unchanged.

Meta:
- Affects: src/features/spaces/service.ts; src/features/publications/service.ts; src/security/permissions.ts
- Routes: n/a (service/core internals)
- DB: none
- Flags: none

Commit:
- 8da96f22f9d3e801f1160232e618157d65432561
- Committed: 2025-10-26 19:06:21 +0000

Commit:
- 77258c725d36c5a84b55d7881fbbf415849f53cc
- Committed: 2025-10-26 18:43:37 +0000

Subject: refactor(admin): delegate site settings GET/PUT to feature service

Context:
- Centralize site settings fetch/update in admin feature service/repo.

Approach:
- Add repo readSiteSettings/updateSiteSettings; add service getSiteSettings/setSiteSettings with validation and boolean mapping.
- Update routes/admin.ts to delegate GET/PUT /admin/site-settings; preserve response shapes.

Impact:
- No API shape changes; routes thinner and easier to maintain.

Tests:
- Build in your environment; verify settings read/write works.

Meta:
- Affects: src/features/admin/repo.ts; src/features/admin/service.ts; src/routes/admin.ts; docs/agents/Handoff_09.md
- Routes: GET/PUT /admin/site-settings
- DB: none
- Flags: none

Commit:
- 748f34c5e82ed1cdea587bbcf3ec0947381677ff
- Committed: 2025-10-26 22:16:17 +0000

Subject: refactor(admin): delegate user detail/update/delete to feature service

Context:
- Continue admin modularization to align routes with feature service/repo.

Approach:
- Add repo helpers (getUserRow, updateUser, softDeleteUser) and service methods (getUserDetail, updateUser, deleteUser).
- Update routes to delegate GET/PUT/DELETE /admin/users/:id; preserve response shapes and error mapping.

Impact:
- No API shape changes; routes thinner and logic centralized.

Tests:
- Build in your environment; verify the three endpoints behave unchanged.

Meta:
- Affects: src/features/admin/{repo.ts,service.ts}; src/routes/admin.ts; docs/agents/Handoff_09.md
- Routes: GET/PUT/DELETE /admin/users/:id
- DB: none
- Flags: none

Commit:
- 05395d31c6f2ec59530ff0f8e7b836727ec1ed9b
- Committed: 2025-10-26 20:21:47 +0000
- [P2] Document and type `enhanceUploadRow`
  - Confirm inputs/outputs; consider relocating to `src/core/enhance.ts` or `features/uploads/util.ts` for clearer ownership.
- [P3] Remove stale scaffolding
  - Remove empty `src/models/` directory (now unused) once confirmed clean.
- [P3] Error handling consistency
  - Implemented: added centralized error middleware to map DomainError to consistent `{ error, detail }` JSON; added fallback 500 handler. Next: phase out route-level try/catch where feasible.
- [P3] Validation consistency
  - Prefer zod schemas for all route inputs (some routes still parse manually).

Work Log (optional)
- 2025-10-26T00:00Z — Initialized thread; reviewed agents docs and latest handoff; added prioritized refactor list.

Artifacts (optional)
<!-- none -->
Subject: refactor(spaces): centralize slugify/defaultSettings into shared util

Context:
- Deduplicate helper functions used in spaces service and admin route to avoid drift and keep semantics consistent.

Approach:
- Add src/features/spaces/util.ts exporting slugify and defaultSettings.
- Update spaces service and admin route to import these helpers; remove local copies and unused route versions.

Impact:
- No behavior change; consolidation improves maintainability.

Tests:
- Type build in your environment; verify space creation (admin and non-admin flows) still works.

Meta:
- Affects: src/features/spaces/util.ts; src/features/spaces/service.ts; src/routes/admin.ts; src/routes/spaces.ts; docs/agents/Handoff_09.md
- Routes: n/a
- DB: none
- Flags: none

Commit:
- eeff554c2d0d5d194543ca28940a56c68af29d93
- Committed: 2025-10-26 19:44:24 +0000
- Subject: refactor(uploads): move signing and completion to service

Context:
- Consolidate upload signing and completion logic in uploads service; keep routes thin and preserve response shapes.

Approach:
- Add uploads.service.createSignedUpload and uploads.service.markComplete; reuse naming utils and S3 presign.
- Update routes/signing.ts to delegate to service; retain requireAuthOrAdminToken.

Impact:
- No API changes. Centralized logic for owner association and S3 conditions.

Tests:
- Build locally in your environment; verify POST /api/sign-upload returns { id, key, bucket, post } and POST /api/mark-complete returns { ok: true }.

Meta:
- Affects: src/features/uploads/service.ts; src/routes/signing.ts; docs/agents/Handoff_09.md
- Routes: POST /api/sign-upload; POST /api/mark-complete
- DB: none
- Flags: none

Commit:
- eca8d938af331e7aa7c14f95f5695fe136c2eb90
- Committed: 2025-10-26 19:24:42 +0000

Subject: refactor(admin): add admin service/repo; delegate roles list and admin space creation

Context:
- Begin modularization of admin routes by extracting roles listing and admin space creation to a feature service/repo.

Approach:
- Add features/admin/repo.ts (listRoles, isSlugTaken, insertSpace) and features/admin/service.ts (listRoles, createSpace).
- Update routes/admin.ts to delegate GET /admin/roles and POST /admin/spaces; keep response shapes.

Impact:
- No API changes; establishes pattern for future admin modularization.

Tests:
- Build in your environment; verify GET /admin/roles and POST /admin/spaces work as before.

Meta:
- Affects: src/features/admin/{repo.ts,service.ts}; src/routes/admin.ts; docs/agents/Handoff_09.md
- Routes: GET /admin/roles; POST /admin/spaces
- DB: none
- Flags: none

Commit:
- 232c51c5dc70699a0c8ec8040380ebbfa9295579
- Committed: 2025-10-26 19:51:23 +0000

Subject: refactor(admin): delegate users list/create to feature service

Context:
- Continue admin modularization by moving user listing and creation to the admin feature service/repo.

Approach:
- Add repo helpers (listUsers, insertUser, insertPersonalSpaceForUser) and service methods (listUsers, createUser with scrypt hashing).
- Update routes to delegate GET /admin/users and POST /admin/users; preserve response shapes and errors.

Impact:
- No API shape changes; routes thinner and logic centralized.

Tests:
- Build in your environment; verify GET /admin/users and POST /admin/users work as before.

Meta:
- Affects: src/features/admin/{repo.ts,service.ts}; src/routes/admin.ts; docs/agents/Handoff_09.md
- Routes: GET /admin/users; POST /admin/users
- DB: none
- Flags: none

Commit:
- 9307fa2be95e9ba48c552a88f1493076abc912c6
- Committed: 2025-10-26 19:57:56 +0000

Subject: refactor(admin): delegate site user roles GET/PUT to feature service

Context:
- Continue admin modularization to centralize site role management for users.

Approach:
- Add repo helpers to list/replace site-scoped roles and resolve site role ids; add service methods getUserSiteRoles/setUserSiteRoles.
- Update routes/admin.ts to delegate GET/PUT /admin/users/:id/roles; preserve shapes and error mapping.

Impact:
- No API shape changes.

Tests:
- Build in your environment; verify GET/PUT roles behavior unchanged.

Meta:
- Affects: src/features/admin/{repo.ts,service.ts}; src/routes/admin.ts; docs/agents/Handoff_09.md
- Routes: GET /admin/users/:id/roles; PUT /admin/users/:id/roles
- DB: none
- Flags: none

Commit:
- d789901686225bbb2dd62ec54a929d75cdd59dc5
- Committed: 2025-10-26 20:16:46 +0000
