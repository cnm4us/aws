Handoff 18

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
- [init] New thread. Continuing from Handoff 17 with focus on avatars/profile features in feed and per-space follow/follow UX as outlined in agents/implementation/plan_05.md.

Decisions (carried + new)
- Keep using hls.js for non‑Safari browsers; rely on native HLS only on Safari/iOS.
- Never assign `.m3u8` to `<video src>` on Chrome/Android; store manifest in `data-video-src` and let hls.js attach.
- Asset orientation drives stream selection; device rotation does not swap stream.
- Use object-fit contain for robust sizing; allow portrait assets to use cover in portrait for edge-to-edge.

Changes Since Last
- Affects: agents/implementation/plan_05.md; agents/handoff/Handoff_18.md
- Routes: none
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: docs(plan): refine avatars and per-space follow plan

Context:
- Capture clarified scope and behavior for Phase 1 of avatars-in-feed and per-space follow, based on discussion.

Approach:
- Updated `agents/implementation/plan_05.md` to lock in group/channel-only follow scope, `/users/:userId` as the public profile route, feed avatar data flow via `profiles.avatar_url`, and concrete follow API endpoints.
- Initialized `agents/handoff/Handoff_18.md` for the new thread and recorded these clarifications for future agents.

Impact:
- Provides a clear, executable plan for implementing avatars in the feed and per-space follow without touching feed filtering yet, and improves cross-thread continuity.

Tests:
- N/A (documentation and planning changes only).

Meta:
- Affects: agents/implementation/plan_05.md; agents/handoff/Handoff_18.md
- Routes: none
- DB: none
- Flags: none

Thread Plan (subset of Backlog)
- [ ] Preserve currentTime on fullscreen/source swaps (feed)
- [ ] Apply .btn utilities to remaining admin pages (optional)
- [ ] Add utilities.css (abs-fill, grid-center) and migrate small pockets

Work Log (optional, terse; reverse‑chronological)
- 2025-12-21 — [init] Created Handoff_18.md; carried forward backlog and durable decisions from Handoff_17.

Artifacts (optional)
