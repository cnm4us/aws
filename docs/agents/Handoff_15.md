Handoff 15

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
- Initialize new thread focused on Windows/Chrome feed reliability: N plays, N+1 plays, N+2 sometimes does not start on first tap. Validate user-gesture startLoad behavior, strengthen promotion guard, and consider upgrading N+2 warm from attach→buffer to improve first-tap start odds while preserving resource limits.

Decisions (carried + new)
- Keep using hls.js for non‑Safari browsers; rely on native HLS only on Safari/iOS.
- Never assign `.m3u8` to `<video src>` on Chrome/Android; store manifest in `data-video-src` and let hls.js attach.
- Minimal, targeted edits to existing Feed to avoid broad refactors; keep event handlers and UI intact.
- Use ULID for slide keys to preserve instance identity across stage roles (active/warm/prewarm/linger).
- Split HLSVideo attach/detach (keyed to `src`) from warm control (keyed to `warmMode`) so warm→active does not destroy MSE.
- Warm window: index‑1 (linger), index (active), index+1 (buffer warm ~3s then stop), index+2..+5 (attach warm). Autoplay disabled; user taps start unmuted from frame 0.
- Promotion lock (ignore IO/scroll ~800ms) on tap-based promotion to reduce index bounce.

Changes Since Last
- Affects: docs/agents/Handoff_15.md
- Routes: none
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: docs(agents): add Handoff_15; continue Windows/Chrome N+2 freeze work

Context:
- Seed next thread to resolve intermittent first‑tap start failure on the third video in feed on Windows/Chrome. Carry forward decisions and plan instrumentation + warm strategy adjustments.

Approach:
- Create Handoff_15 with copied backlog and decisions; outline concrete next steps for instrumentation, guard strengthening, and warm policy experiments.

Impact:
- Documentation only.

Tests:
- N/A

References:
- docs/agents/README.md; docs/agents/AGENTS.md; docs/agents/Handoff_14.md

Meta:
- Affects: docs/agents/Handoff_15.md
- Routes: none
- DB: none
- Flags: none

Thread Plan (subset of Backlog)
- [ ] Verify repro on Windows Chrome (real device if possible)
- [ ] Instrument/confirm `hls.startLoad(-1)` under tap path (N+2)
- [ ] Trial: upgrade N+2 from attach→buffer warm (2–3s)
- [ ] Harden promotion guard (≥1s) and keep index‑2 mounted briefly post‑promotion
- [ ] Audit unmount/detach paths around IO/scroll; prevent premature cleanup
- [ ] CDN sanity checks for persistent ULIDs (init segments, CORS, caching)

Open Items / Next Actions
- Chrome “N works, N+1 works, N+2 sometimes won’t start on first tap” persists in tail:
  - Ensure tap handler always executes `hls.startLoad(-1)` (even when warm exists).
  - Consider direct `startLoad(-1)` on non‑active tap when a warm instance exists.
  - Evaluate data cost of N+2 buffer warm (short target window) vs attach-only.
  - Maintain stricter promotion guard; keep index‑2 mounted ~1s post‑promotion.

Work Log (optional, terse; reverse‑chronological)
- 2025-11-16T00:00Z — Initialized Handoff_15; aligned on Windows/Chrome N+2 freeze focus.

Artifacts (optional)
- Screens: playwright-report/ (local only; not in Git)

