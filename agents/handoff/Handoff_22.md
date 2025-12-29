Handoff 22

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
- Thread start: re-read `agents/README.md` and seeded new handoff; awaiting user direction.
- Inherited state (Handoff_21): per-space cultures and end-user reporting (“Flag”) modal implemented (commit 2312cdc).
- Implemented plan_16 (site_admin console): server-rendered `/admin/users*`, `/admin/settings` (stub), `/admin/dev`, `/admin/review/*` (global/personal/groups/channels) and removed SPA ownership so these features do not ship in the normal user bundle.
- Implemented plan_17 (space console split): new `space-app` bundle for `/space/*` + `/spaces/*`, removed space console routes from the normal feed bundle, and updated the feed menu to link out to `/space/admin`, `/space/moderation`, and `/admin`.
- Implemented plan_18 (Global Feed billboard): remove Like/Comment actions and add “Jump” modal listing Group/Channel spaces for the same `production_id`.
- Implemented plan_15 step 2: added shared site_admin slide drawer shell for server-rendered `/admin/*` pages.
- Implemented plan_15 step 3: added server-rendered `/admin/categories` CRUD with safe delete rules + usage counts.
- Implemented plan_15 step 4: replaced `/admin/groups` + `/admin/channels` SPA shells with server-rendered pages (list/new/detail/edit).
- Implemented plan_15 step 5: removed `/admin/groups*` and `/admin/channels*` site_admin React routes from the user SPA bundle.
- Implemented plan_15 step 6: renamed space pre-publish queue to “review” (`/api/spaces/:id/review/queue`, `/spaces/:id/review`) with legacy “moderation” aliases.
- Implemented plan_15 step 7: added `/space/review/*` SPA routes + menu context and `/api/space/review/*` endpoints for space_admin review overviews.
- Implemented plan_15 step 8: removed legacy space_admin “moderation” aliases (`/api/spaces/:id/moderation/queue`, `/spaces/:id/moderation`, slug-based variants); kept site_admin `/admin/moderation/*` for now.
- Commit: `b68aeaa` (feat(admin): split site_admin UI and space review)
- Commit: `43e5462` (docs: update README for admin + review routes)
- Commit: `d0472f6` (feat(admin): server-render users/dev/review)
- Commit: `d926238` (feat(space): split space console bundle)
- Commit: `8cbc984` (feat(feed): global feed jump modal)

Decisions (carried + new)
- Carried (from Handoff_21 / Handoff_20):
  - hls.js vs Safari-native HLS policy; feed behavior/semantics; rules draft/version semantics; cultures (admin-only) semantics.
  - Space ↔ Cultures storage: join table `space_cultures(space_id, culture_id)` (0..N).
  - No implicit “Global” culture: if a space has no cultures, reporting options are empty (configuration-driven).
  - Reporting identity: authenticated users only.
  - Reporting scope: a report is per `space_publications.id` (publication in a space), not global to a production.
  - Reporting selection: single rule (radio) + 409 on duplicate reports by the same user for the same publication.
  - Naming: site_admin pre-publish approval UI is now `/admin/review/*`; `/admin/moderation/*` now redirects to review and “moderation” is reserved for future flags/reports tooling.
  - Space console split: `/space/*` + `/spaces/*` are served by a separate Vite build (`public/space-app`) so space_admin/review/moderation UI is not shipped in `public/app`.
  - Feed menu behavior: feed bundle uses plain links to `/space/admin` + `/space/moderation` gated by `/api/me` flags (`hasAnySpaceAdmin`, `hasAnySpaceModerator`); site_admin uses plain link to `/admin`.

Changes Since Last
- Affects: `agents/handoff/Handoff_22.md`; `agents/implementation/plan_15.md`; `src/routes/pages.ts`; `src/routes/spaces.ts`; `public/admin-nav.css`; `frontend/src/main.tsx`; `frontend/src/app/SpaceModeration.tsx`; `frontend/src/app/AdminModerationList.tsx`; `public/js/space-admin.js`; `public/js/space-admin-user.js`; `public/js/space-members.js`; `agents/implementation/tests/plan_15/step_02_admin_shell.md`; `agents/implementation/tests/plan_15/step_03_categories_admin.md`; `agents/implementation/tests/plan_15/step_04_admin_spaces.md`; `agents/implementation/tests/plan_15/step_05_web_build.md`; `agents/implementation/tests/plan_15/step_06_review_queue.md`
- Affects: `agents/handoff/Handoff_22.md`; `agents/implementation/plan_15.md`; `src/routes/pages.ts`; `src/routes/spaces.ts`; `public/admin-nav.css`; `frontend/src/main.tsx`; `frontend/src/ui/Layout.tsx`; `frontend/src/ui/SharedNav.tsx`; `frontend/src/ui/routes.ts`; `frontend/src/menu/ContextPicker.tsx`; `frontend/src/menu/contexts/ReviewMenu.tsx`; `frontend/src/app/SpaceReviewList.tsx`; `frontend/src/app/SpaceReviewGroups.tsx`; `frontend/src/app/SpaceReviewChannels.tsx`; `frontend/src/app/SpaceModeration.tsx`; `frontend/src/app/AdminModerationList.tsx`; `public/js/space-admin.js`; `public/js/space-admin-user.js`; `public/js/space-members.js`; `agents/implementation/tests/plan_15/step_02_admin_shell.md`; `agents/implementation/tests/plan_15/step_03_categories_admin.md`; `agents/implementation/tests/plan_15/step_04_admin_spaces.md`; `agents/implementation/tests/plan_15/step_05_web_build.md`; `agents/implementation/tests/plan_15/step_06_review_queue.md`; `agents/implementation/tests/plan_15/step_07_review_overviews.md`
- Affects: `agents/implementation/plan_15.md`; `agents/implementation/tests/plan_15/step_08_cleanup.md`; `frontend/src/main.tsx`; `public/app/index.html`; `public/app/assets/*`
- Routes: removed `/api/spaces/:id/moderation/queue`; removed `/spaces/:id/moderation`, `/groups/:slug/moderation`, `/channels/:slug/moderation` (legacy aliases)
- DB: none
- Flags: none
- Affects (plan_16): `agents/implementation/plan_16.md`; `agents/implementation/tests/plan_16/*`; `src/routes/pages.ts`; `public/admin-nav.css`; `frontend/src/main.tsx`; `frontend/src/menu/contexts/AdminMenu.tsx`; `frontend/src/ui/routes.ts`; `README.md`
- Routes (plan_16): added `/admin/users*`, `/admin/settings`, `/admin/dev`, `/admin/review/*`; added approve/reject posts under `/admin/review/publications/:id/(approve|reject)`; redirected `/admin/moderation/*` → `/admin/review/*`; redirected `/adminx/*` → `/admin/*`
- Affects (plan_18): `agents/implementation/plan_18.md`; `agents/implementation/tests/plan_18/*`; `frontend/src/app/Feed.tsx`; `frontend/src/app/JumpToSpaceModal.tsx`; `src/routes/publications.ts`; `src/features/publications/service.ts`; `src/features/publications/repo.ts`; `README.md`
- Routes (plan_18): added `GET /api/publications/:id/jump-spaces`

Commit Messages (ready to paste)
- `d0472f6` feat(admin): server-render users/dev/review
- `8cbc984` feat(feed): global feed jump modal

Open Questions / Deferred
- Optional Step 7: add a site-admin view/API for listing recent reports and selected rules.
- Consider whether to allow “edit report” (replace selection) vs current `409 already_reported`.
- Follow-up: decide whether to build separate SPA bundles for site_admin (`/admin/*`) and space console (`/space/*`, `/spaces/*`) vs continue with server-rendered pages.
- Follow-up: implement real post-publish moderation queues under `/admin/moderation/*` (flags/reports) and keep analytics there.
- Follow-up: `/admin/settings` and `/admin/users/new` are stubs (“coming soon”).
- Follow-up (plan_17): add optional redirect aliases `/space/moderator/*` → `/space/moderation/*`.

Work Log (reverse‑chronological)
- 2025-12-29 — Implemented plan_18: Global Feed billboard “Jump to Space” modal + `/api/publications/:id/jump-spaces`.
- 2025-12-28 — Implemented plan_16: moved site_admin Users/Settings/Dev/Review to server-rendered `/admin/*`, updated the admin drawer, and removed the admin SPA routes from the user bundle.
- 2025-12-28 — Removed legacy space_admin “moderation” route aliases for review; rebuilt SPA bundle to drop the client-side redirect.
- 2025-12-28 — Added space_admin “Review” menu context + `/space/review/groups|channels` pages driven by `/api/space/review/groups|channels`.
- 2025-12-28 — Renamed space pre-publish “moderation queue” to “review” across API + UI; kept legacy redirects/aliases.
- 2025-12-28 — Removed SPA ownership of `/admin/groups*` and `/admin/channels*` so site_admin space management no longer ships in user bundle; `npm run web:build` recorded.
- 2025-12-28 — Implemented server-rendered site_admin pages for groups/channels under `/admin/groups*` and `/admin/channels*` (create + edit includes comments policy, require-review, cultures).
- 2025-12-28 — Added `/admin/categories` (list/new/edit/delete) server-rendered pages; delete blocked when category referenced by cultures or rules.
- 2025-12-28 — Added site_admin drawer shell for server-rendered `/admin/*` pages; updated `renderAdminPage` to include nav + responsive toggle; extended `public/admin-nav.css`.
- 2025-12-28 — Thread start: created `agents/handoff/Handoff_22.md`.
