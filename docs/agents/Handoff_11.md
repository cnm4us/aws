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
  ; frontend/src/app/Feed.tsx
- Routes: GET /api/spaces/:id/feed; GET /api/feed/global; GET /groups/:slug/admin; GET /channels/:slug/admin; GET /groups/:slug/moderation; GET /channels/:slug/moderation
  ; UI: feed unlock gesture plays muted synchronously
  - Slug routes perform 302 redirects to canonical `/spaces/:id/...` to keep UI nav logic stable
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: refactor(spaces): move feed checks to service, PERM cleanup, add slug admin routes; fix Chrome first-play gesture

Context:
- Align feed routes with global DomainError middleware and remove remaining DB access from routes. Preserve legacy error codes for client compatibility.

 Approach:
- Added service helpers `loadSpaceOrThrow` and `assertCanViewSpaceFeed` to encapsulate space loading and permission checks with DomainError codes.
- Updated `/api/spaces/:id/feed` to call service, parse pagination, and `next(err)` with legacy code wrapping (`failed_to_load_feed`).
- Updated `/api/feed/global` to `next(err)` with legacy code wrapping (`failed_to_load_global_feed`).
- Removed legacy `ensurePermission` helper and unused imports in `routes/spaces.ts`; routes defer to service + PERM-based checks.
- Added slug-aware page routes for groups/channels admin and moderation by resolving `(type, slug) → id` before applying existing guards.
 - Canonicalization: slug routes issue 302 redirects to `/spaces/:id/...`.
- Removed client-side slug→id resolution in static admin pages; pages assume numeric ID paths.
 - Feed (SPA): first play now starts muted inside unlock click/touch handler to satisfy Chrome autoplay policy; unmute follows via subsequent user action.

Impact:
- Centralized permission logic; routes are thinner and consistent with error middleware. Response error codes for failures remain stable.
- Admin UI accessible via `/groups/:slug/admin[...]` and `/channels/:slug/admin[...]` without requiring numeric IDs.
 - Sidebar/nav now stays on slug paths. Client JS resolves slug→id as needed for API calls.

Additional Changes
- Added missing PERM constants and removed literals in checks:
  - PERM.SPACE_SETTINGS_UPDATE ('space:settings_update')
  - PERM.MOD_COMMENT_CREATOR ('moderation:comment_creator')
  - Updated `src/security/permissions.ts` to use PERM and typed the spaceScoped Set.

Tests:
- Build passes (`npm run build`). Manual check of routes and imports. Recommend E2E smoke for space feed and global feed with pagination.

References:
- docs/agents/AGENTS.md commit policy; Handoff_10 backlog P1 items

 Meta:
- Affects: src/routes/spaces.ts; src/features/spaces/service.ts
  ; frontend/src/app/Feed.tsx
- Routes: GET /api/spaces/:id/feed; GET /api/feed/global; GET /groups/:slug/admin; GET /channels/:slug/admin; GET /groups/:slug/moderation; GET /channels/:slug/moderation
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

Refactor Plan — App Shell + Lazy Routes (Ready)
- Pre‑flight (validated):
  - History fallback: server returns SPA shell for `/, /uploads, /productions, /publish` (direct reload OK).
  - Cleanup hooks: feed detaches hls.js, observers, timers on route change (no .m3u8/.ts after leaving; media‑internals clean).
  - Playback: Windows Chrome uses hls.js; iOS uses native HLS; unlock respected; first‑visit + snapshot restore are stable.
  - CORS: CloudFront CORS headers in place for `*.m3u8/*.ts` (ACAO, expose headers, OPTIONS allowed).
  - Snapshot TTL: configurable via `VITE_FEED_SNAPSHOT_TTL_MS` (default 5m).

- Phase 1 — App Shell + Router
  - Extract `Layout` (both nav bars + providers) and wrap SPA routes.
  - Keep routes: `/` (feed), `/uploads`, `/productions`, `/publish`.
  - Add Suspense skeletons for route transitions; add top‑level error boundary.

- Phase 2 — Code‑splitting + Preload
  - Convert features to `React.lazy()`; split feed (hls.js), uploads, productions, publish into separate chunks.
  - Add hover/idle preloading for likely next routes; small route skeletons.

- Phase 3 — Nav across admin/space pages (bridge)
  - Option A (bridge now): ship small web components `<app-nav>` + `<feed-switcher>` to static admin/space HTML; consume `/api/me` + `/api/me/spaces`.
  - Option B (migrate later): move admin/space pages into SPA routes incrementally; keep existing server guards.

- Phase 4 — Migrate admin/space pages (incremental)
  - Admin: users, roles, site settings, spaces, members; Space: members, settings, moderation.
  - Decommission static HTML per section as the SPA route reaches parity.

- Phase 5 — Perf/Polish
  - Bundle analysis (vite visualizer); ensure hls.js confined to feed chunk; admin tooling in admin chunk.
  - Overlay dismissal tuned to `playing` for Global restores; snap/smooth re‑enable after overlay hides.
  - Strict cleanup on route change (hls detach, IO disconnect, cancel RAF/timers) enforced in shell.

Implementation Checklist (initial thread)
1) Create `Layout` with both nav bars and wrap existing SPA pages
2) Add React Router (or minimal route switch) + Suspense skeletons
3) Lazy‑load feature routes; verify chunking and fallbacks
4) Add small preload helpers (hover/idle)
5) Optional bridge: web component nav for static admin/space pages

Acceptance Criteria
- Navigating between `/`, `/uploads`, `/productions`, `/publish` keeps both nav bars present; route transitions show skeletons (no blank/flicker).
- Initial JS served is limited to shell + route chunk; other chunks load on demand.
- Leaving the feed stops media/network activity; returning restores position cleanly (snapshot/overlay).
- Static admin/space pages either include nav (bridge) or are SPA routes.

Risks & Mitigations
- Multiple media layers: enforce single active feed layer; detach hls on hide.
- Memory: cap snapshot cache (size 8) and items window (~150); TTL tunable.
- Deep links: keep pagesRouter mappings; server returns SPA shell for new routes.
