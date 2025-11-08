Handoff 13

Priority Backlog (Refactor Objectives)
- Objective:
  - Organize code to facilitate adding new features and extending existing ones quickly.
  - Organize code so it’s optimized for agent work: consistent patterns, thin routes, typed services, standard validation and errors.
- Instructions:
  - Maintain this Priority Backlog at the top of each Handoff_N.md.
  - Copy this section forward to Handoff_{N+1}.md at the start of a new thread and update statuses as items complete or are added.
  - Use P1 for highest-impact foundation items; P2 for high-value follow‑ups; P3 for structural polish.

- P1 (foundation, highest impact)
  - [x] Modularize Admin (roles, users, spaces, site settings, capabilities, members/invitations, dev utils)
  - [x] Add centralized DomainError middleware and register globally
  - [x] Add Zod validation to admin routes
  - [x] Add Zod + middleware cleanup to publications, productions, spaces routes (feeds endpoints migrated later)
  - [x] Replace remaining permission helpers/strings with PERM and service checks
    - [x] Remove legacy ensurePermission in routes/spaces.ts; rely on service checks
    - [x] Convert spaces feed endpoints to next(err) and move remaining DB logic behind services while preserving shapes

- P2 (high‑value follow‑ups)
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
- Verified the final outstanding P1 item is complete: no legacy permission helpers remain and spaces feed endpoints are service‑backed and propagate errors via next(err) using DomainError. Documentation updated; no code changes required.

Decisions (carried + new)
- Adopt feature‑module service/repo pattern for endpoints; preserve response shapes and map errors at route layer.
- Use PERM constants (src/security/perm.ts) across modules; remove string literal permission checks.
- Keep Global and Space feeds; legacy uploads‑based feed remains removed.
- Poster URLs derived via upload enhancement (enhanceUploadRow) with future relocation TBD.
- Client SPA currently selects a page by pathname in frontend/src/main.tsx (no React Router). We will introduce lazy loading and a lightweight shell with minimal risk, preserving URLs.
- New: Spaces feed endpoints are fully service‑backed and use assertCanViewSpaceFeed permission gating; routes delegate to features/feeds/service and forward errors via DomainError.

Changes Since Last
- Affects: docs/agents/Handoff_13.md
- Routes: none
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: docs(agents): add Handoff_13; mark P1 permissions/feed complete

Context:
- Close out the outstanding P1 task by capturing verification that permissions use PERM and spaces feed endpoints are service‑backed with DomainError handling.

Approach:
- Audited routes and services for legacy helpers; confirmed feeds delegate to features/feeds/service and errors flow to centralized middleware. Added new handoff with statuses updated.

Impact:
- Documentation only. Confirms foundation is complete; no behavioral changes.

Tests:
- Manual code audit: src/routes/spaces.ts, src/features/spaces/service.ts, src/features/feeds/service.ts, src/middleware/auth.ts.

Meta:
- Affects: docs/agents/Handoff_13.md
- Routes: none
- DB: none
- Flags: none

Thread Plan (subset of Backlog)
- [ ] Context Drawer scaffold + registry (Phase 1–2)
- [ ] Admin: slug/owner edits in detail view
- [ ] E2E: smoke tests for admin lists/create/detail, moderation queue

Open Items / Next Actions
- Context Drawer (Phase 1–2): scaffold ContextDrawer + registry; move Channel Changers into first context; add Context Selector in drawer header.
- Admin: allow editing group/channel slug and owner assignment in Admin detail (PUT via admin service); confirm slug uniqueness.
- Space Moderation: add poster thumbnails and quick preview; pagination for queues >200; optional notes on approve/reject.
- Space Members: role toggles per member (edit in place); confirm remove; pagination for large spaces.
- Site Settings & Capabilities: surface effective site defaults on Admin detail (already computed); optional link to settings.
- E2E: add smoke tests for admin lists, create, detail save, members add/remove, moderation approve/reject.
- Performance: idle prefetch Admin detail from list hover; small skeletons for Admin pages.

Work Log (optional)
- 2025-11-08 17:22Z — Verified P1 permissions/feed item complete; added Handoff_13.md; no code changes.

Artifacts (optional)
- Screens: playwright-report/ (local only; not in Git)
