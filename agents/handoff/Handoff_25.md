Handoff 25

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
- Implemented Plan 89 core features: captions API + rolling captions panel, transcript search normalization, and waveform click-to-seek/polish in the Library player. Adjusted waveform window from 30s to 10s and updated captions list to keep active cue near the top; fixed scroll offset math to keep active cue visible. Updated Plan 89 statuses; API tests logged for captions/search, UI tests pending. Started Plan 90 and completed Steps 1–4: SPA route for `/library/create-clip/:id`, Library frontend split into list vs create-clip views, list page includes View modal + Create clip action with URL state sync, and create-clip page includes header + metadata + back link preserving filters. Step 5 polish in progress: iOS input zoom mitigation plus waveform scrubber changes (fixed playhead, drag-to-scrub pause/resume, +/-10s long-press nudges). Added 16px font sizing + box-sizing for clip title/description to prevent iOS zoom and overflow. Curl tests logged, UI tests pending.

Decisions (carried + new)
- Library player must use custom controls only (no native `<video controls>`).

Changes Since Last
- Affects: frontend/src/app/Library.tsx; src/features/library/service.ts; src/routes/library.ts; src/routes/pages.ts; agents/implementation/plan_89.md; agents/implementation/plan_90.md; agents/implementation/tests/plan_89/step_03_captions.md; agents/implementation/tests/plan_89/step_04_search.md; agents/implementation/tests/plan_90/step_01_route.md; agents/implementation/tests/plan_90/step_02_spa.md
- Routes: GET /api/library/videos/:id/captions; GET /api/library/videos/:id/search (matching behavior updated); GET /library/create-clip/:id (SPA)
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: feat(library): add captions API, search normalization, waveform controls

Context:
- Library player needed custom controls, captions toggle, waveform seeking, and improved transcript search.

Approach:
- Added captions fetch endpoint and VTT parsing on the backend.
- Normalized transcript search with stopword/token matching.
- Implemented custom control bar, rolling waveform with click-to-seek, and captions panel with active cue alignment.

Impact:
- Library users can scrub with a tighter waveform window, toggle captions, and get more precise transcript search hits.

Tests:
- `GET /api/library/videos/874/captions` → 200 (logged).
- `GET /api/library/videos/874/search?q=independent+investigation` → 200 (logged).

References:
- agents/implementation/plan_89.md

Meta:
- Affects: frontend/src/app/Library.tsx; src/features/library/service.ts; src/routes/library.ts; agents/implementation/plan_89.md; agents/implementation/tests/plan_89/step_03_captions.md; agents/implementation/tests/plan_89/step_04_search.md
- Routes: GET /api/library/videos/:id/captions; GET /api/library/videos/:id/search
- DB: none
- Flags: none

Thread Plan (subset of Backlog)
- [x] Implement captions endpoint + rolling captions UI. ([P2.4])
- [x] Improve transcript search normalization + token match. ([P2.5])
- [x] Add waveform click-to-seek + control polish. ([P2.6])

Work Log (optional, terse; reverse-chronological)
