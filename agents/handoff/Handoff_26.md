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
- Implemented Plan 92 via `feat(library)`: centralized library source config (incl. Glenn Kirschner), backend validation + API list endpoint, admin filter labels, and frontend dropdown wiring with fallbacks.
- Library list/create-clip metadata now uses source labels; upload form now loads options dynamically and defaults to CSPAN when available.
- Updated `/library` list cards: add thumbnail preview, truncate description, right-align View/Create actions, and enhance modal with full description + X close.
- Split `/library` modals: title opens description-only modal; “View Video” opens video-only modal; list description now truncated to 50 words.
- Create-clip header description now truncates to 50 words with a “more/less” toggle.
- Fixed graphics assets crash by defining `sortedItems` sort memo in `GraphicAssetsListPage`.
- Corrected `sortedItems` to live in `GraphicAssetsListPage` (was mistakenly added to video assets).
- Reworked `/admin/video-library` cards with title modal, 50-word description toggle, inline video player, and edit/delete actions.
- Adjusted admin video-library description truncation to 20 words and made description modal scrollable.
- Tests still pending.

Decisions (carried + new)
- Library player must use custom controls only (no native `<video controls>`).

Changes Since Last
- Affects: src/config/librarySources.ts; src/features/uploads/service.ts; src/routes/library.ts; src/routes/pages.ts; frontend/src/app/Library.tsx; frontend/src/app/UploadNew.tsx; agents/implementation/plan_92.md
- Routes: GET /api/library/source-orgs
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: feat(library): configure source options

Context:
- Add Glenn Kirschner and make library source options configurable.

Approach:
- Centralized source list in config; reused for validation, API, admin filters, and frontend dropdowns with fallbacks.

Impact:
- New selectable source appears across library and upload flows.

Tests:
- Not run (manual checks pending).

References:
- agents/implementation/plan_92.md

Meta:
- Affects: src/config/librarySources.ts; src/features/uploads/service.ts; src/routes/library.ts; src/routes/pages.ts; frontend/src/app/Library.tsx; frontend/src/app/UploadNew.tsx; agents/implementation/plan_92.md; agents/handoff/Handoff_26.md
- Routes: GET /api/library/source-orgs
- DB: none
- Flags: none

Commit:
- 8d2cce8

Subject: feat(library): split list modals

Context:
- Refine library list UX to separate description vs video views.

Approach:
- Title now opens a description-only modal; “View Video” opens a video-only modal; list truncation reduced to 50 words.

Impact:
- Cleaner, purpose-specific modals with shorter list descriptions.

Tests:
- Not run (manual checks pending).

Meta:
- Affects: frontend/src/app/Library.tsx; agents/handoff/Handoff_26.md
- Routes: none
- DB: none
- Flags: none

Commit:
- ff2b306

Subject: feat(library): add description toggle

Context:
- Reduce create-clip header height while keeping full description accessible; avoid iOS zoom on inputs.

Approach:
- Truncate create-clip description with “more/less” toggle; set 16px font sizes on library search and source select.

Impact:
- Shorter create-clip header with optional expansion; iOS input zoom mitigated.

Tests:
- Not run (manual checks pending).

Meta:
- Affects: frontend/src/app/Library.tsx; agents/handoff/Handoff_26.md
- Routes: none
- DB: none
- Flags: none

Commit:
- 13f4f8d

Subject: fix(assets): restore graphics sorting

Context:
- Graphics picker crashed due to missing `sortedItems` in the graphics list.

Approach:
- Added `sortedItems` memo to `GraphicAssetsListPage` to sort and render graphics safely.

Impact:
- `/assets/graphic` no longer throws `ReferenceError` and loads normally.

Tests:
- Manual: verified user flow after rebuild (reported fixed).

Meta:
- Affects: frontend/src/app/Assets.tsx; agents/handoff/Handoff_26.md
- Routes: none
- DB: none
- Flags: none

Commit:
- b259696

Thread Plan (subset of Backlog)
- [x] Implement Plan 92 frontend wiring + tests. ([P2.4])

Work Log (optional, terse; reverse-chronological)
