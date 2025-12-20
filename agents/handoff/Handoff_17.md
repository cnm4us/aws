Handoff 17

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
- [init] New thread. Carry forward CSS consolidation and feed video decisions from Handoff 16. Next focus: polish feed fullscreen/resume, finalize button utilities, and extend styling consolidation where needed.

Decisions (carried + new)
- Keep using hls.js for non‑Safari browsers; rely on native HLS only on Safari/iOS.
- Never assign `.m3u8` to `<video src>` on Chrome/Android; store manifest in `data-video-src` and let hls.js attach.
- Asset orientation drives stream selection; device rotation does not swap stream.
- Use object-fit contain for robust sizing; allow portrait assets to use cover in portrait for edge-to-edge.

Changes Since Last
- Affects: agents/README.md; agents/git.md; agents/handoff/Handoff.md; agents/handoff_process.md; agents/implementation_planning.md; agents/implementation/plan_01.md; agents/implementation/plan_02.md; agents/implementation/plan_03.md; agents/implementation/plan_04.md; agents/readme_maintenance.md; agents/db_access.md; docs/Configuration.md; docs/Operations.md; src/db.ts; src/features/profiles/repo.ts; src/features/profiles/service.ts; src/routes/profiles.ts; src/routes/pages.ts; frontend/src/ui/routes.ts; frontend/src/main.tsx; frontend/src/app/Profile.tsx; frontend/src/menu/ContextPicker.tsx; frontend/src/menu/contexts/ProfileMenu.tsx
- Routes: /api/profile/me; /api/profile/:userId; /profile
- DB: add profiles, space_credibility, and space_credibility_log tables via idempotent ensureSchema updates
- Flags: none

Commit Messages (ready to paste)
Subject: chore(handoff): initialize Handoff 17; carry forward backlog/decisions

Context:
- New thread kickoff after 80% milestone in previous thread.

Approach:
- Create Handoff_17.md; copy backlog and durable decisions from Handoff_16.

Impact:
- Establishes continuity for next steps.

Tests:
- N/A

Meta:
- Affects: agents/handoff/Handoff_17.md
- Routes: none
- DB: none
- Flags: none

Subject: docs(agents): refine workflow instructions

Context:
- Align agent-facing instructions with the current Codex/CLI environment and consolidate them under the `agents/` directory.

Approach:
- Introduced a new `agents/` tree, standardized handoff naming and triggers, added TL;DR and progress rules for implementation plans, simplified Git commit guidance, and documented DB access/migration safety rules.

Impact:
- Provides clearer, lower-friction workflows for future agents while preserving developer-facing docs and Git flow.

Tests:
- N/A (documentation-only change).

Meta:
- Affects: agents/README.md; agents/git.md; agents/handoff/Handoff.md; agents/handoff/Handoff_17.md; agents/handoff_process.md; agents/implementation_planning.md; agents/implementation/plan_01.md; agents/readme_maintenance.md; agents/db_access.md
- Routes: none
- DB: none
- Flags: none

Subject: feat(db): add profiles and space credibility schema

Context:
- Prepare the database schema for Profiles and per-space credibility without changing existing behavior.

Approach:
- Extend `ensureSchema` in `src/db.ts` to create `profiles`, `space_credibility`, and `space_credibility_log` tables using non-destructive, idempotent DDL.

Impact:
- Enables future Profile and credibility features while keeping current routes and flows functioning.

Tests:
- Not yet executed; schema changes are staged for application in the development environment.

Meta:
- Affects: src/db.ts
- Routes: none
- DB: profiles; space_credibility; space_credibility_log
- Flags: none

Subject: feat(profiles): add backend profile module

Context:
- Provide a dedicated backend layer for user Profiles that is separate from Identification and not yet wired into public routes.

Approach:
- Added `src/features/profiles/repo.ts` for direct `profiles` table access and `src/features/profiles/service.ts` for validation and upsert/update helpers keyed by `user_id`.

Impact:
- Enables future Profile APIs and UI to use a consistent backend layer without changing current behavior.

Tests:
- Not yet executed; initial module creation only.

Meta:
- Affects: src/features/profiles/repo.ts; src/features/profiles/service.ts
- Routes: none
- DB: profiles
- Flags: none

Subject: feat(api): add basic Profile endpoints

Context:
- Provide initial APIs to read and update user Profiles without touching identification flows or existing MediaConvert profile behavior.

Approach:
- Extended `src/routes/profiles.ts` with `/api/profile/me` (get/update current user Profile) and `/api/profile/:userId` (public view), while keeping `/api/profiles` intact for encoding profiles.

Impact:
- Enables minimal Profile surfaces for identity while preserving legacy `/api/profiles` usage.

Tests:
- Not yet executed; manual API checks pending.

Meta:
- Affects: src/routes/profiles.ts
- Routes: /api/profile/me; /api/profile/:userId
- DB: profiles
- Flags: none

Subject: feat(ui): add /profile route and placeholder page

Context:
- Wire a dedicated SPA route for the Profile page into the existing frontend routing and layout, ahead of implementing the full Profile form.

Approach:
- Added `loadProfile` to `frontend/src/ui/routes.ts`, a `/profile` branch in `frontend/src/main.tsx` using `Layout`, and a minimal `frontend/src/app/Profile.tsx` placeholder component.

Impact:
- Enables navigation to `/profile` with the shared nav layout, without affecting existing routes.

Tests:
- Not yet executed; manual navigation to `/profile` pending.

Meta:
- Affects: frontend/src/ui/routes.ts; frontend/src/main.tsx; frontend/src/app/Profile.tsx
- Routes: /profile
- DB: none
- Flags: none

Subject: feat(avatar): add signed avatar upload and finalize APIs

Context:
- Provide backend support for user avatar uploads stored under the OUTPUT_BUCKET using the new profiles/avatars prefix.

Approach:
- Added `src/features/profiles/avatar.ts` to create presigned S3 POSTs for `profiles/avatars/{userId}/{yyyy-mm}/{uuid}.ext` and implemented `/api/profile/avatar/sign` and `/api/profile/avatar/complete` routes that update `profiles.avatar_url` for the current user.

Impact:
- Enables the upcoming Edit Avatar UI to upload and persist profile images without touching the main uploads pipeline.

Tests:
- Not yet executed; API tested via code inspection only.

Meta:
- Affects: src/features/profiles/avatar.ts; src/routes/profiles.ts
- Routes: /api/profile/avatar/sign; /api/profile/avatar/complete
- DB: profiles (avatar_url)
- Flags: none

Subject: docs(avatars): document avatar storage layout

Context:
- Capture where user avatar images live in S3/CloudFront so future avatar flows have a clear, consistent target.

Approach:
- Updated `docs/Configuration.md` and `docs/Operations.md` to describe avatar storage under the public OUTPUT_BUCKET using a `profiles/avatars/{userId}/{yyyy-mm}/{uuid}.jpg` prefix and CloudFront-backed URLs.

Impact:
- Provides an explicit, documented convention for profile image storage without changing application behavior yet.

Tests:
- N/A (documentation only).

Meta:
- Affects: docs/Configuration.md; docs/Operations.md
- Routes: none
- DB: none
- Flags: none

Thread Plan (subset of Backlog)
- [ ] Preserve currentTime on fullscreen/source swaps (feed)
- [ ] Apply .btn utilities to remaining admin pages (optional)
- [ ] Add utilities.css (abs-fill, grid-center) and migrate small pockets

Work Log (optional, terse; reverse‑chronological)
- 2025-12-20 — [ui] Added `/profile/avatar` SPA page for avatar upload with signed S3 POST and wired it into the Profile menu as “Edit Avatar”.
- 2025-12-20 — [api] Implemented signed avatar upload and finalize endpoints for user profile images.
- 2025-12-20 — [docs] Documented avatar storage layout and prefix under OUTPUT_BUCKET in Configuration/Operations docs.
- 2025-12-20 — [ui] Added Profile context to Menu Selector (`ContextPicker`/`SharedNav`) and ProfileMenu with link to `/profile`.
- 2025-12-20 — [ui] Implemented Profile form UI at `/profile` backed by `/api/me` and `/api/profile/me`, with display name, avatar URL, bio, and public/visibility toggles.
- 2025-12-20 — [ui] Added `/profile` SPA route and placeholder Profile page component.
- 2025-12-20 — [api] Added `/api/profile/me` and `/api/profile/:userId` endpoints to `routes/profiles.ts` for basic Profile read/update and public view.
- 2025-12-20 — [profiles] Created `src/features/profiles/repo.ts` and `service.ts` to encapsulate profile persistence and validation.
- 2025-12-20 — [db] Updated `ensureSchema` in `src/db.ts` to create profiles and space_credibility tables for future Profile/Credibility features.
- 2025-12-20 — [docs] Created `agents/` directory and refined agent workflow docs (handoff, implementation planning, Git, DB access, README maintenance).
- 2025-11-19 — [init] Created Handoff_17.md; carried forward backlog and decisions.

Artifacts (optional)
- Screens: playwright-report/ (local only; not in Git)
