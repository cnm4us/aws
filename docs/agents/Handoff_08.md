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
- Affects: src/features/uploads/{service.ts,repo.ts}; src/routes/uploads.ts; src/features/spaces/{service.ts,repo.ts}; src/routes/spaces.ts; src/features/publications/service.ts; src/routes/publications.ts; docs/agents/Handoff_08.md
- Routes: GET /api/uploads; GET /api/uploads/:id; GET /api/uploads/:id/publish-options; GET /api/me/spaces; GET/PUT /api/spaces/:id/settings; GET /api/spaces/:id/members; GET /api/spaces/:id/invitations; DELETE /api/spaces/:id; GET /api/feed/global; GET /api/spaces/:id/feed; POST /api/publications/:id/(approve|unpublish|reject)
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

Commit:
- 44b8ee16617e810641bf45befdc11b8cf2858f00
- Committed: 2025-10-25T22:08:41+00:00

Subject: refactor(spaces): extract settings/members/invitations/delete and my-spaces to service/repo

Context:
- Continue modularization. Centralize space settings, membership listing, invitations listing, delete, and “my spaces” aggregation under a spaces service.
- Keep response shapes and error mapping unchanged.

Approach:
- Add spaces repo/service. Move site flags lookups, global candidate scan, and subscription/ban checks into repo/service.
- Delegate routes: GET /api/me/spaces; GET/PUT /api/spaces/:id/settings; GET /api/spaces/:id/members; GET /api/spaces/:id/invitations; DELETE /api/spaces/:id.
- Centralize canViewSpaceFeed in spaces service and use it from the feed route.

Impact:
- No functional change intended. Permissions and shapes preserved. Logic now reusable across routes.

Tests:
- Build frontend. Hit settings read/update, members/invitations endpoints, my-spaces aggregator; verify identical JSON shapes.

References:
- docs/agents/Handoff_07.md Open Items; feeds/publications refactors.

Meta:
- Affects: src/features/spaces/service.ts; src/features/spaces/repo.ts; src/routes/spaces.ts; docs/agents/Handoff_08.md
- Routes: GET /api/me/spaces; GET/PUT /api/spaces/:id/settings; GET /api/spaces/:id/members; GET /api/spaces/:id/invitations; DELETE /api/spaces/:id
- DB: none
- Flags: none

Commit:
- 224931d8cc5131e892d35c9e88c515b9a0f60ac6
- Committed: 2025-10-25T22:35:19+00:00

Open Items / Next Actions
- [ ] Extract Uploads to service/repo:
  - Endpoints: GET `/api/uploads`, GET `/api/uploads/:id`, GET `/api/uploads/:id/publish-options`.
  - Include `include_publications=1` fan-out via publications service; keep response shapes.
- [ ] Extract Spaces to service/repo (split routes):
  - Membership/admin/settings/delete flows; keep `canViewSpaceFeed` and related checks but centralize logic.
- [ ] Centralize cursor helpers in `src/core/pagination.ts` and replace ad-hoc parsing in feeds/services.
  - Implemented: added `parseTsIdCursor`, `buildTsIdCursor`, `clampLimit`; feeds service updated.
- [ ] Standardize permission wrappers (one place for `can(userId, perm, {spaceId|ownerId})`).
  - Implemented: services now resolve a checker per request and pass it to `can(...)` consistently (uploads, productions, spaces, publications already used checker).
- [ ] Tests (service-level, minimal but high-value):
  - Publications: approve/reject/unpublish/republish/create (happy + key forbidden states).
  - Productions: list/get/create mapping and permissions.
  - Feeds: cursor round-trip and item mapping.
 - [ ] Optional cleanup: move route-level publication note events into a service helper for consistency.
   - Implemented: routes now call publications.service.recordNoteEvent; models-level event writer no longer used here.
 - [ ] Optional cleanup: consider relocating `enhanceUploadRow` to a shared util folder and documenting its inputs/outputs.

Subject: chore(publications): remove legacy models/spacePublications and dead route helpers

Context:
- With publications now fully serviced via features/publications/{service,repo}, legacy models are unused.
- A local canViewSpaceFeed + parseSpaceSettings duplicate in routes/spaces.ts was left after service extraction.

Approach:
- Delete src/models/spacePublications.ts; remove its import from routes/publications.ts.
- Remove unused canViewSpaceFeed/parseSpaceSettings helpers from routes/spaces.ts (route uses spaces service).

Impact:
- No behavior change; reduces duplication and potential drift.

Tests:
- Build and lint; no references to deleted modules remain.

Meta:
- Affects: src/models/spacePublications.ts (deleted); src/routes/publications.ts; src/routes/spaces.ts; docs/agents/Handoff_08.md
- Routes: n/a
- DB: none
- Flags: none

Commit:
- d3bda78e40255084801fc082fa689bcccd744226
- Committed: 2025-10-25T23:03:53+00:00

Work Log (optional)
- 2025-10-25 21:50Z — Bootstrapped thread; created Handoff_08.md with carried decisions and next actions.

Artifacts (optional)
<!-- e.g., reports/, playwright-report/ (not committed) -->
Subject: refactor(feeds): centralize pagination cursor and limit helpers

Context:
- Avoid duplicated cursor parsing/building and limit clamping across services; standardize feed pagination.

Approach:
- Add src/core/pagination.ts with parseTsIdCursor, buildTsIdCursor, clampLimit.
- Update feeds service to use helpers for both global and space feeds.

Impact:
- No API changes; cursors remain "<timestamp>|<id>". Code is simpler and consistent.

Tests:
- Build passes in your environment; feeds continue to accept/emit the same cursors.

References:
- Prior refactors; this follows the Handoff plan to centralize pagination.

Meta:
- Affects: src/core/pagination.ts; src/features/feeds/service.ts; docs/agents/Handoff_08.md
- Routes: GET /api/feed/global; GET /api/spaces/:id/feed
- DB: none
- Flags: none

Commit:
- b70dc2d4e1993bfaeab76d6e79eaff2cbdcd44ed
- Committed: 2025-10-25T22:42:00+00:00
Subject: chore(permissions): standardize can() usage with resolved checker across services

Context:
- Mixed patterns for permission checks caused inconsistent performance and readability.
- Standardize on resolving a checker once per request and passing it to can(userId, perm, { spaceId|ownerId, checker }).

Approach:
- Update services to resolve checker and pass it to can: uploads, productions, spaces (publications already used this pattern).

Impact:
- No behavior change; reduces duplicate permission resolution and improves consistency.

Tests:
- Build verified in your environment previously; endpoints continue to authorize as before.

References:
- docs/agents/Handoff_07.md; ongoing service/repo refactors.

Meta:
- Affects: src/features/uploads/service.ts; src/features/productions/service.ts; src/features/spaces/service.ts; docs/agents/Handoff_08.md
- Routes: n/a (service internals)
- DB: none
- Flags: none

Commit:
- 41a4970a7394151ce79ed4292088f14020805bd3
- Committed: 2025-10-25T22:48:05+00:00

Subject: refactor(publications): move moderation note event recording into service helper

Context:
- Routes previously recorded note events via models; moved to publications service for consistency and encapsulation.

Approach:
- Add publications.service `recordNoteEvent(publicationId, userId, action, note)` using repo.insertEvent.
- Update routes to call service helper for approve/unpublish/reject optional notes; remove direct models call.

Impact:
- No API shape changes; event stream gains the same note detail but recording is centralized.

Tests:
- Build and manual endpoint checks; notes persist alongside moderation events.

References:
- Handoff plan optional cleanup.

Meta:
- Affects: src/features/publications/service.ts; src/routes/publications.ts; docs/agents/Handoff_08.md
- Routes: POST /api/publications/:id/approve; POST /api/publications/:id/unpublish; POST /api/publications/:id/reject
- DB: none
- Flags: none

Subject: chore(publications): remove unused helpers/imports from routes

Context:
- After migrating publications endpoints to service/repo, routes had dead helpers and type imports.

Approach:
- Remove mapPublicationRow, local loaders, and related db/permission imports from src/routes/publications.ts. Keep routes thin; delegate DTO shaping and permission checks to the service.

Impact:
- No behavior change; reduced noise and tighter ownership boundaries.

Tests:
- Build verified previously; file now imports only what's needed.

Meta:
- Affects: src/routes/publications.ts
- Routes: n/a
- DB: none
- Flags: none

Commit:
- d1f7b5e22e6596a79cbfa9296face6c2fbe22244
- Committed: 2025-10-26T00:51:17+00:00
Subject: chore(productions): remove unused imports and legacy mapping from routes

Context:
- After moving productions list/get/create to features service/repo, the route retained unused imports and mapping helpers.

Approach:
- Remove unused imports (config OUTPUT_BUCKET, permissions can, db types/getPool) and delete unused mapProduction/safeJson helpers in src/routes/productions.ts.

Impact:
- No behavior change; routes delegate fully to service; file is slimmer.

Meta:
- Affects: src/routes/productions.ts; docs/agents/Handoff_08.md
- Routes: n/a
- DB: none
- Flags: none
