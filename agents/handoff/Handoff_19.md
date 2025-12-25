Handoff 19

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
- [init] New thread. Continuing from Handoff 18 with focus on implementing public profile slugs and `/users/:slug` public profile pages per `agents/implementation/plan_07.md`. Prior work from plan_05 (avatars/follows) and plan_06 (Personal vs Global publishing) is considered baseline context.
- [update] This thread later expanded into Pages/Rules CMS work (plan_08/plan_09) and Rule draft editing + publish flow (plan_10); admin-only testing is performed in the real target environment and logged under `agents/implementation/tests/`.

Decisions (carried + new)
- Carried:
  - Keep using hls.js for non‑Safari browsers; rely on native HLS only on Safari/iOS.
  - Never assign `.m3u8` to `<video src>` on Chrome/Android; store manifest in `data-video-src` and let hls.js attach.
  - Asset orientation drives stream selection; device rotation does not swap stream.
  - Use object-fit contain for robust sizing; allow portrait assets to use cover in portrait for edge-to-edge.
  - Publishing semantics (Personal vs Global, Phase 1) from Handoff 18 and `agents/implementation/plan_06.md` remain in force.
- New (from current plan focus):
  - Introduce globally unique, user-editable `users.slug` values with a reserved list and strict validation.
  - Add public profile routes/pages at `/users/:slug`, with numeric-id fallback preserved for backwards compatibility.
- New (later in thread):
  - Rules support an editable head “draft” in `rule_drafts`:
    - **Save** updates `rule_drafts` plus `rules.title`/`rules.category_id` immediately, without creating a new `rule_versions` row.
    - **Publish Version** snapshots the current draft to a new immutable `rule_versions` row and updates `rules.current_version_id`.
  - Admin `/admin/rules` supports:
    - “Draft pending” indicator (draft updated after current published version).
    - Sortable column headers via `?sort=<key>&dir=asc|desc`.
    - Category filter jump menu via `?categoryId=<id>` (All option; no submit).

Changes Since Last
- [docs] Clarified Global space semantics in `agents/implementation/plan_06.md` (Global space identified by slug `global-feed`, Global feed depends only on `visible_in_global` for that space).  
- [docs] Refined `agents/implementation/plan_07.md` to pin slug rules (first character must be a letter, reserved names from `agents/requirements/reserved_slug_names.md`), shape the profile/slug APIs, and define `/users/:slug` resolution via a small slug lookup endpoint.  
- [docs] Initialized this handoff file for the new thread with updated summary and decisions around public profile slugs.
 - [feat] Implemented `users.slug` column and unique index, shared slug validation helper, profile APIs and routes for reading/updating slugs, `/users/:slug` public profile page (with numeric-id fallback), and Profile editor slug UI per `agents/implementation/plan_07.md`.  
 - [feat] Added `/users/:slugOrId` SPA shell route in `src/routes/pages.ts` to ensure public profile URLs are served by the existing app shell.  
 - [plan] Authored `agents/implementation/plan_08.md` for the editable Pages and Versioned Rules systems, including DB schema, Markdown pipeline, public routes, admin UIs, and moderation linkage via `moderation_actions`.
- [feat][rules][plan_10] Added rule drafts + publish flow (`rule_drafts` table, `/admin/rules/:id/edit`, Save/Publish actions, draft pending indicator, and optional backfill script), with real-env step logs under `agents/implementation/tests/plan_10/`.
- [admin] Added sortable column headers and a categories jump-menu filter to `/admin/rules` (real-env notes: `agents/implementation/tests/admin_rules_sort_filter.md`).

Commits (this thread)
- `bcff49d` — plan_10: rule drafts save/publish flow
- `c74db31` — admin: sortable rules list + category filter
- `aa5df3a` — docs: document admin CMS + auth_curl testing

Open Questions / Deferred
- plan_10: draft refresh/clear-on-publish is not implemented (draft remains; “Draft pending” uses timestamps vs current published version).
- Moderation workflows and reporting UI remain deferred (flagging, sanctions, per-space rule sets).

Commit Messages (ready to paste)
- Subject: docs(plan): clarify global feed and slug behavior  
  
  Context:  
  - Align documentation with the latest decisions for Global space semantics and public profile slug rules so future agents can execute plan_06 and plan_07 without re-deriving them.  
  
  Approach:  
  - Updated `agents/implementation/plan_06.md` to treat the Global space as the `global-feed` slug, ensure Global feed queries depend only on `visible_in_global` for that space, and clarify that `visible_in_space` is only for non-global feeds.  
  - Updated `agents/implementation/plan_07.md` to require slugs start with a letter, reference the reserved names in `agents/requirements/reserved_slug_names.md`, and spell out backend/frontend behavior for resolving `/users/:slug` via a dedicated slug lookup endpoint plus the existing `GET /api/profile/:id`.  
  - Created `agents/handoff/Handoff_19.md` to capture this thread’s focus on plan_07 and record these clarified decisions.  
  
  Impact:  
  - Provides a precise, executable specification for Global publishing semantics and slug behavior, reducing ambiguity for subsequent implementation work.  
  
  Meta:  
  - Affects: agents/handoff/Handoff_18.md; agents/handoff/Handoff_19.md; agents/implementation/plan_06.md; agents/implementation/plan_07.md; agents/requirements/reserved_slug_names.md  
  - Routes: /api/users/slug/:slug (planned); /users/:slug (frontend); /api/profile/:id  
  - DB: users.slug (planned); space_publications.visible_in_global semantics for global-feed  
  - Flags: none
  
- Subject: feat(profile): add public slugs and profile pages  
  
  Context:  
  - Implement public, shareable profile URLs and a user-editable handle field so avatars and other UI can link to stable `/users/:slug` pages, while preserving existing numeric-id URLs.  
  
  Approach:  
  - Added a `slug` column and unique index on `users` in `src/db.ts`, plus a shared `requireValidUserSlug` helper in `src/utils/slug.ts` enforcing slug rules and reserved names.  
  - Extended profile repo/service and `GET /api/profile/:id` to surface `slug`, created `GET /api/users/slug/:slug` and `PUT /api/profile/slug` routes, and wired slug validation and uniqueness errors to stable error codes.  
  - Built a `/users/:slugOrId` public profile page in `frontend/src/app/ProfilePublic.tsx`, routed via both `frontend/src/main.tsx` and a new `/users/:slug` SPA shell route in `src/routes/pages.ts`, and updated the feed avatar overlay to prefer slug links when available.  
  - Updated the Profile editor at `/profile` to include a “Profile handle” field with client-side guidance and server-side validation for slug format, reserved names, and conflicts.  
  
  Impact:  
  - Enables stable, user-editable profile URLs and integrates them into existing feed and profile flows, while keeping behavior backward compatible for users without slugs.  
  
  Meta:  
  - Affects: src/db.ts; src/utils/slug.ts; src/features/profiles/repo.ts; src/features/profiles/service.ts; src/routes/profiles.ts; src/routes/pages.ts; frontend/src/app/Feed.tsx; frontend/src/app/Profile.tsx; frontend/src/app/ProfilePublic.tsx; frontend/src/main.tsx; public/app/index.html; agents/implementation/plan_07.md  
  - Routes: /api/profile/:id; /api/profile/me; /api/profile/slug; /api/users/slug/:slug; /users/:slugOrId; /profile  
  - DB: users.slug (unique); no destructive migrations  
  - Flags: none
