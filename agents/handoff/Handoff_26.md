Handoff 26

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

- P2 (high-value follow-ups)
  - [ ] Warm-up preloading for next slide
  - [ ] Centralize Safari detection utility
  - [ ] Minimal refactor of Feed.tsx to use components
  - [ ] Library UI: captions API + rolling captions panel (Plan 89)
  - [ ] Library search: normalize + tokenized transcript matching (Plan 89)
  - [ ] Library waveform: click-to-seek + control polish (Plan 89)

- P3 (structural polish)
  - [ ] Future: pool hls.js instances to reduce GC churn
  - [ ] Future: predictive preloading hooks

Summary
- Implemented Plan 92: centralized library source config (incl. Glenn Kirschner), backend validation + API list endpoint, admin filter labels, and frontend dropdown wiring with fallbacks.
- Library list/create-clip metadata now uses source labels; upload form now loads options dynamically and defaults to CSPAN when available.
- Tests still pending.

Decisions (carried + new)
- Library player must use custom controls only (no native `<video controls>`).

Changes Since Last
- Affects: src/config/librarySources.ts; src/features/uploads/service.ts; src/routes/library.ts; src/routes/pages.ts; frontend/src/app/Library.tsx; frontend/src/app/UploadNew.tsx; agents/implementation/plan_92.md
- Routes: GET /api/library/source-orgs
- DB: none
- Flags: none

Commit Messages (ready to paste)

Thread Plan (subset of Backlog)
- [x] Implement Plan 92 frontend wiring + tests. ([P2.4])

Work Log (optional, terse; reverse-chronological)
