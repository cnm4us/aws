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
- Affects: agents/README.md; agents/git.md; agents/handoff/Handoff.md; agents/handoff_process.md; agents/implementation_planning.md; agents/implementation/plan_01.md; agents/readme_maintenance.md; agents/db_access.md
- Routes: none
- DB: none
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

Thread Plan (subset of Backlog)
- [ ] Preserve currentTime on fullscreen/source swaps (feed)
- [ ] Apply .btn utilities to remaining admin pages (optional)
- [ ] Add utilities.css (abs-fill, grid-center) and migrate small pockets

Work Log (optional, terse; reverse‑chronological)
- 2025-12-20 — [docs] Created `agents/` directory and refined agent workflow docs (handoff, implementation planning, Git, DB access, README maintenance).
- 2025-11-19 — [init] Created Handoff_17.md; carried forward backlog and decisions.

Artifacts (optional)
- Screens: playwright-report/ (local only; not in Git)
