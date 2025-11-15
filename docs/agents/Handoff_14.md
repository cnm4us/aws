Handoff 14

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
- Start unifying the front-end HLS playback to fix Chrome freezing around 2s by ensuring Chrome never receives `video.src = *.m3u8`. Introduce a reusable `HLSVideo` component and `isSafari` util; plan to refactor `frontend/src/app/Feed.tsx` to use these and warm-up the next slide.

Decisions (carried + new)
- Keep using hls.js for non‑Safari browsers; rely on native HLS only on Safari/iOS.
- Never assign `.m3u8` to `<video src>` on Chrome/Android; store manifest in `data-video-src` and let hls.js attach.
- Minimal, targeted edits to existing Feed to avoid broad refactors; keep event handlers and UI intact.

Changes Since Last
- Affects: docs/agents/Handoff_14.md; frontend/src/utils/isSafari.ts; frontend/src/components/HLSVideo.tsx; frontend/src/hooks/useVideoWarmup.ts; frontend/src/components/FeedVideo.tsx; frontend/src/app/Feed.tsx
- Routes: none
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: docs(agents): add Handoff_14; plan HLS unification for feed

Context:
- Begin thread to fix Chrome freezing by unifying HLS playback and preventing Chrome from attempting to load the manifest via `<video src>`.

Approach:
- Add new Handoff with backlog for componentized HLS player, warm-up preloading, and Safari detection. Implementation to follow in this thread.

Impact:
- Documentation only at this step; no behavior change yet.

Tests:
- N/A — planning and handoff docs only.

References:
- docs/agents/README.md; docs/agents/AGENTS.md; docs/agents/Handoff.md

Meta:
- Affects: docs/agents/Handoff_14.md
- Routes: none
- DB: none
- Flags: none

Subject: fix(feed): unify HLS playback; avoid Chrome native m3u8

Context:
- Chrome was freezing around 2s due to the feed assigning `.m3u8` directly to `<video src>`, triggering Chrome's native pipeline. iOS/Safari were reliable.

Approach:
- Added `HLSVideo` component that attaches hls.js for non‑Safari and uses native HLS only on Safari; stores manifest in `data-video-src` and never sets `src` on Chrome/Android. Added `isSafari` util. Wrapped with `FeedVideo` and integrated into `Feed.tsx` to render per‑slide videos with warm‑up for the next slide. Removed legacy shared `attachAndPlay` path and `playSlide`/`prewarmSlide` code that set `video.src`.
- Refactored modal viewer to use the same HLS component.

Impact:
- Eliminates Chrome's native HLS path; prevents 2s stalls. Safely tears down hls.js on unmount. Warm‑up in place for next slide. No server/API changes.

Tests:
- Built the SPA via `npm run web:build:scoped` (vite) successfully. Manual review of feed navigation/pause logic; event listeners reattached to active slide.

References:
- docs/agents/README.md; plan notes in user thread

Meta:
- Affects: frontend/src/utils/isSafari.ts; frontend/src/components/HLSVideo.tsx; frontend/src/components/FeedVideo.tsx; frontend/src/hooks/useVideoWarmup.ts; frontend/src/app/Feed.tsx
- Routes: none
- DB: none
- Flags: none

Thread Plan (subset of Backlog)
- [ ] Implement `frontend/src/utils/isSafari.ts` ([P2])
- [ ] Implement `frontend/src/components/HLSVideo.tsx` ([P1])
- [ ] Implement `frontend/src/hooks/useVideoWarmup.ts` ([P2])
- [ ] Implement `frontend/src/components/FeedVideo.tsx` ([P1])
- [ ] Refactor `frontend/src/app/Feed.tsx` to use components, remove Chrome `.m3u8` `src` paths ([P1])

Work Log (optional, terse; reverse‑chronological)
- 2025-11-15T00:00Z — Initialized Handoff_14 and set plan for HLS unification.

Artifacts (optional)
- Screens: playwright-report/ (local only; not in Git)
