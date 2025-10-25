Handoff 08

Summary
- Bootstrap new thread from Handoff_07; align on service/repo architecture, preserve route response shapes, and continue the migrations and cleanups outlined previously (Uploads, Spaces, pagination, permissions, and tests).

Decisions (carried + new)
- Adopt feature-module service/repo pattern for endpoints (publications, productions, feeds migrated; continue for uploads and spaces).
- Preserve existing response shapes and error mapping at the route layer.
- Use canonical status/visibility types from `src/db` to avoid drift.
- Feeds: keep Global and Space feeds; legacy uploads-based feed remains removed.
- Poster URLs derived via upload enhancement (current `enhanceUploadRow` usage; consider relocation later).
- Production naming: `productions.name` exists; UI passes optional name; back-compat update path retained in service.

Changes Since Last
- Affects: src/features/uploads/{service.ts,repo.ts}; src/routes/uploads.ts; docs/agents/Handoff_08.md
- Routes: GET /api/uploads; GET /api/uploads/:id; GET /api/uploads/:id/publish-options
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: refactor(uploads): migrate list/get/publish-options to service/repo

Context:
- Continue feature-module extraction. Keep existing response shapes and error mapping for uploads endpoints.
- Unify publications fan-out through the publications service to avoid SQL duplication.

Approach:
- Add uploads repo/service; move SELECTs and publish-options space lookups into repo; permissions in service.
- Update routes to delegate: list/get optionally include publications via publications.service; publish-options enforces same permissions.
- Preserve JSON shapes and query parameters (`status`, `user_id`, `space_id`, `cursor`, `limit`, `include_publications`).

Impact:
- No behavioral changes intended. Publications fan-out gracefully skips when permission checks fail (keeps base upload row).

Tests:
- Exercise uploads page and upload detail with `include_publications=1` and ensure shapes unchanged. Verify publish-options requires auth and returns spaces set.

References:
- docs/agents/Handoff_07.md Open Items; publications service extraction from prior commits.

Meta:
- Affects: src/features/uploads/service.ts; src/features/uploads/repo.ts; src/routes/uploads.ts; docs/agents/Handoff_08.md
- Routes: GET /api/uploads; GET /api/uploads/:id; GET /api/uploads/:id/publish-options
- DB: none
- Flags: none

Open Items / Next Actions
- [ ] Extract Uploads to service/repo:
  - Endpoints: GET `/api/uploads`, GET `/api/uploads/:id`, GET `/api/uploads/:id/publish-options`.
  - Include `include_publications=1` fan-out via publications service; keep response shapes.
- [ ] Extract Spaces to service/repo (split routes):
  - Membership/admin/settings/delete flows; keep `canViewSpaceFeed` and related checks but centralize logic.
- [ ] Centralize cursor helpers in `src/core/pagination.ts` and replace ad-hoc parsing in feeds/services.
- [ ] Standardize permission wrappers (one place for `can(userId, perm, {spaceId|ownerId})`).
- [ ] Tests (service-level, minimal but high-value):
  - Publications: approve/reject/unpublish/republish/create (happy + key forbidden states).
  - Productions: list/get/create mapping and permissions.
  - Feeds: cursor round-trip and item mapping.
- [ ] Optional cleanup: move route-level publication note events into a service helper for consistency.
- [ ] Optional cleanup: consider relocating `enhanceUploadRow` to a shared util folder and documenting its inputs/outputs.

Work Log (optional)
- 2025-10-25 21:50Z — Bootstrapped thread; created Handoff_08.md with carried decisions and next actions.

Artifacts (optional)
<!-- e.g., reports/, playwright-report/ (not committed) -->
