Handoff 21

Priority Backlog (Refactor Objectives)
- Objective:
  - Organize code to facilitate adding new features and extending existing ones quickly.
  - Organize code so it’s optimized for agent work: consistent patterns, thin routes, typed services, standard validation and errors.
- Instructions:
  - Maintain this Priority Backlog at the top of each Handoff_N.md.
  - Copy this section forward to Handoff_{N+1}.md at the start of a new thread and update statuses as items complete or are added.
  - Use P1 for highest-impact foundation items; P2 for high-value follow-ups; P3 for structural polish.

- P1 (foundation, highest impact)
  - [ ] Unify HLS playback across browsers; avoid Chrome native .m3u8
  - [ ] Componentize feed video player (HLSVideo)

- P2 (high‑value follow‑ups)
  - [ ] Warm-up preloading for next slide
  - [ ] Centralize Safari detection utility
  - [ ] Minimal refactor of Feed.tsx to use components

- P3 (structural polish)
  - [ ] Future: pool hls.js instances to reduce GC churn
  - [ ] Future: predictive preloading hooks

Summary
- Implemented plan_13: per-space (group/channel) Culture assignment via join table + admin APIs + SPA admin UI checkboxes.
- Implemented plan_14 (steps 1–6): end-user reporting (“Flag”) modal on feed slides driven by space cultures → categories → rules; reporting is per `space_publications.id` and persists across devices for the same login.

Decisions (carried + new)
- Carried (see Handoff_20):
  - hls.js vs Safari-native HLS policy; feed behavior/semantics; rules draft/version semantics; cultures (admin-only) semantics.
- New:
  - Space ↔ Cultures storage: join table `space_cultures(space_id, culture_id)` (0..N).
  - No implicit “Global” culture: if a space has no cultures, reporting options are empty (configuration-driven).
  - Reporting identity: authenticated users only.
  - Reporting scope: a report is per `space_publications.id` (publication in a space), not global to a production.
  - Reporting selection: single rule (radio) + 409 on duplicate reports by the same user for the same publication.

Changes Since Last
- Affects: `.gitignore`; `src/db.ts`; `src/routes/admin.ts`; `src/routes/publications.ts`; `src/features/admin/repo.ts`; `src/features/admin/service.ts`; `src/features/feeds/repo.ts`; `src/features/feeds/service.ts`; `src/features/feeds/types.ts`; `src/features/reports/repo.ts`; `src/features/reports/service.ts`; `frontend/src/app/AdminSpaceDetail.tsx`; `frontend/src/app/Feed.tsx`; `frontend/src/app/ReportModal.tsx`; `agents/implementation/plan_13.md`; `agents/implementation/plan_14.md`; `agents/implementation/tests/plan_13/*`; `agents/implementation/tests/plan_14/*`
- Routes:
  - GET `/api/admin/cultures`
  - GET `/api/admin/spaces/:id` (now includes `cultureIds`)
  - PUT `/api/admin/spaces/:id` (now accepts optional `cultureIds`)
  - GET `/api/publications/:id/reporting/options` (includes `myReport` when reported)
  - POST `/api/publications/:id/report` (single `ruleId`)
  - GET `/api/feed/global` and GET `/api/spaces/:id/feed` (publication includes `reported_by_me`)
- DB:
  - Added: `space_cultures`
  - Added: `space_publication_reports`
- Flags: none

Commit Messages (ready to paste)
Subject: feat(moderation): per-space cultures and reporting modal

Context:
- Support channel/group culture configuration and end-user reporting driven by space-specific rule sets.

Approach:
- Added `space_cultures` and admin APIs/UI to assign cultures to spaces.
- Added reporting schema + APIs for reporting options and submission; enriched feed with `reported_by_me`.
- Added feed flag button and lazy-loaded reporting modal (single-rule select + on-demand rule details).

Impact:
- Site admins can configure per-space reporting rule sets.
- End users can flag a published slide and see/report against the rules for that space; “reported” state persists across devices for the same user.

Tests:
- API/manual logs under `agents/implementation/tests/plan_13/*` and `agents/implementation/tests/plan_14/*`.

Meta:
- Affects: `.gitignore`; `src/db.ts`; `src/routes/admin.ts`; `src/routes/publications.ts`; `src/features/admin/*`; `src/features/feeds/*`; `src/features/reports/*`; `frontend/src/app/*`; `agents/implementation/plan_13.md`; `agents/implementation/plan_14.md`; `agents/implementation/tests/plan_13/*`; `agents/implementation/tests/plan_14/*`
- Routes: `/api/admin/cultures`; `/api/admin/spaces/:id`; `/api/publications/:id/reporting/options`; `/api/publications/:id/report`; `/api/feed/global`; `/api/spaces/:id/feed`
- DB: `space_cultures`; `space_publication_reports`
- Flags: none

Commit:
- 2312cdc

Git Commands (used when committing)
- git add .gitignore frontend/src/app/AdminSpaceDetail.tsx frontend/src/app/Feed.tsx frontend/src/app/ReportModal.tsx src/db.ts src/features/admin/repo.ts src/features/admin/service.ts src/features/feeds/repo.ts src/features/feeds/service.ts src/features/feeds/types.ts src/features/reports/repo.ts src/features/reports/service.ts src/routes/admin.ts src/routes/publications.ts agents/implementation/plan_13.md agents/implementation/plan_14.md agents/implementation/tests/plan_13 agents/implementation/tests/plan_14
- git commit -m "feat(moderation): per-space cultures and reporting modal"

Open Questions / Deferred
- Optional Step 7: add a site-admin view/API for listing recent reports and selected rules.
- Consider whether to allow “edit report” (replace selection) vs current `409 already_reported`.

Work Log (reverse‑chronological)
- 2025-12-28 — Added reporting modal UX + pre-select previously reported rule; commit 2312cdc.
- 2025-12-27 — Implemented plan_13 (space cultures) and plan_14 (reporting APIs + feed marker) with tests logged under `agents/implementation/tests/plan_13/` and `agents/implementation/tests/plan_14/`.

