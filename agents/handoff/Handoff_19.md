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

Changes Since Last
- [docs] Clarified Global space semantics in `agents/implementation/plan_06.md` (Global space identified by slug `global-feed`, Global feed depends only on `visible_in_global` for that space).  
- [docs] Refined `agents/implementation/plan_07.md` to pin slug rules (first character must be a letter, reserved names from `agents/requirements/reserved_slug_names.md`), shape the profile/slug APIs, and define `/users/:slug` resolution via a small slug lookup endpoint.  
- [docs] Initialized this handoff file for the new thread with updated summary and decisions around public profile slugs.

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
