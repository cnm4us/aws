Handoff 09

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

Open Items / Next Actions
- [P1] Refactor publish routes to services
  - Implemented: `/api/publish` delegates to `productions.service.createForPublishRoute(...)` (legacy perms, same shape).
  - Implemented: `/api/uploads/:id/publish` and `/api/uploads/:id/unpublish` delegate to `publications.service.publishUploadToSpaces(...)` and `.unpublishUploadFromSpaces(...)` (same shapes).
- [P1] Spaces: finish delegations
  - Implemented: moved member removal logic into `spaces.service.removeMember(...)`; route delegates.
  - Ensure space feed permission check remains centralized in `spaces.service` (route already delegates, but keep direct DB usage minimal).
- [P1] Permissions constants cleanup
  - Replace string literals like `'space:create_group'` and `'space:create_channel'` with `PERM.SPACE_CREATE_GROUP` / `PERM.SPACE_CREATE_CHANNEL` (and audit for any remaining literals).
- [P1] Service-level tests (minimal, high-value)
  - Publications: approve/reject/unpublish/republish/create (owner/moderator/admin paths; last-actor rule).
  - Productions: create/list/get (permission boundaries).
  - Spaces: settings update guards; invitations create/revoke/accept/decline; moderation queue; suspensions CRUD.
  - Uploads: list/get (with publications fan-out), delete S3 failure path (mock s3 client).
- [P2] Signing flow consolidation
  - Extract upload DB mutations from `routes/signing.ts` into `features/uploads` (e.g., `createSignedUpload(...)`, `markComplete(id, etag, size)`), preserving current API.
- [P2] Normalize shared helpers
  - Implemented: Deduplicated `slugify` and `defaultSettings` into `src/features/spaces/util.ts`; updated spaces service and admin route; removed unused copies from spaces route.
- [P2] Admin routes modularization (optional)
  - Implemented (partial): created `features/admin/{repo,service}.ts` with roles listing and admin space creation helpers; routes now delegate for `/admin/roles` and `POST /admin/spaces`.
- [P2] Document and type `enhanceUploadRow`
  - Confirm inputs/outputs; consider relocating to `src/core/enhance.ts` or `features/uploads/util.ts` for clearer ownership.
- [P3] Remove stale scaffolding
  - Remove empty `src/models/` directory (now unused) once confirmed clean.
- [P3] Error handling consistency
  - Consider centralized error middleware for consistent `{ error, detail, status }` mapping; phase in without changing response shapes.
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
