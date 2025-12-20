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
- Unify the front-end HLS playback to fix Chrome's native pipeline issues by ensuring Chrome never receives `video.src = *.m3u8`. We introduced a reusable `HLSVideo` component with warm strategies (attach/buffer), switched Feed to mount per-slide players keyed by ULID, added promotion/tap improvements, and extensive TEMP DEBUG logging. iOS Safari path remains native and stable. Chrome now reliably avoids native HLS; remaining intermittent issue is “N works, N+1 works, N+2 sometimes won’t start on first tap” (see Open Items) — progress ~93%.

Decisions (carried + new)
- Keep using hls.js for non‑Safari browsers; rely on native HLS only on Safari/iOS.
- Never assign `.m3u8` to `<video src>` on Chrome/Android; store manifest in `data-video-src` and let hls.js attach.
- Minimal, targeted edits to existing Feed to avoid broad refactors; keep event handlers and UI intact.
- Use ULID for slide keys to preserve instance identity across stage roles (active/warm/prewarm/linger).
- Split HLSVideo attach/detach (keyed to `src`) from warm control (keyed to `warmMode`) so warm→active does not destroy MSE.
- Warm window: index‑1 (linger), index (active), index+1 (buffer warm ~3s then stop), index+2..+5 (attach warm). Autoplay disabled; user taps start unmuted from frame 0.
- Promotion lock (ignore IO/scroll ~800ms) on tap-based promotion to reduce index bounce.

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

Subject: fix(feed): preserve MSE across warm→active; add attach/buffer warm + play intent

Context:
- Warmed slides were being destroyed on warm→active flips and during IO/scroll bounces, causing canceled XHRs and losing buffers. Chrome still needed a second tap in some cases (N+2).

Approach:
- Split HLSVideo effects: attach/detach only on `src`; warm control via `warmMode` (attach/buffer/none) without destroy. Added unconditional `startLoad(-1)` on user ‘play’. Feed uses ULID keys, mounts stage window (index‑1..index+5), and implements promotion lock + play‑then‑promote behavior when warm exists.

Impact:
- Preserves buffers across stage transitions; prevents Chrome native HLS entirely; reduces first‑tap misses. iOS Safari remains native and reliable.

Tests:
- Manual: Chrome/Windows mobile emulation; iOS Safari. Verified blob currentSrc and branch logs; observed fewer canceled XHRs after gating warm until restore.

Meta:
- Affects: frontend/src/components/HLSVideo.tsx; frontend/src/components/FeedVideo.tsx; frontend/src/app/Feed.tsx
- Routes: none
- DB: none
- Flags: none

Thread Plan (subset of Backlog)
- [x] Implement `frontend/src/utils/isSafari.ts` ([P2])
- [x] Implement `frontend/src/components/HLSVideo.tsx` ([P1])
- [x] Implement `frontend/src/hooks/useVideoWarmup.ts` ([P2])
- [x] Implement `frontend/src/components/FeedVideo.tsx` ([P1])
- [x] Refactor `frontend/src/app/Feed.tsx` to use components, remove Chrome `.m3u8` `src` paths ([P1])
- [x] Preserve MSE across warm→active; ULID slide keys; promotion lock
- [x] Gate warmers until restore completes; add ULID-aware cleanup logs
- [ ] Finalize Chrome N+2 first-tap reliability

Open Items / Next Actions
- Chrome “N works, N+1 works, N+2 sometimes won’t start on first tap” persists (~7% tail):
  - Hypothesis: attach‑warm promoted to active but load doesn’t start under gesture in some paths, or IO/scroll bounce still unmounts briefly. Action: ensure tap handler always calls `hls.startLoad(-1)` (already on onPlay) and consider invoking it directly on non‑active tap when warm exists.
  - Consider upgrading N+2 from attach→buffer warm (small target 2–3s) to increase instant start odds; monitor data tradeoff.
  - Add a stricter promotion guard (ignore IO/scroll for ~1s) and/or keep index‑2 mounted briefly after promotion to prevent churn.
- Suppress initial global feed warming entirely until after “startup restore to space” (implemented gating; verify with logs over multiple reloads).
- CDN sanity for persistent “never plays” ULIDs: confirm portrait master/variant exist, CMAF init (.cmfv/.cmfa) present, first segments (00000/00001) cached and CORS headers set.

Repro Notes
- Pattern: After reload anchored at slide N (TEST GROUP), N plays, N+1 plays, N+2 may not start on first tap; reloading on N+2 makes N+2 play and shifts the issue to N+4. This correlates with attach‑warm promotion timing.

Observability
- HLSVideo logs include `[id:<ULID>] mount/branch/post-attach/cleanup` and `resume startLoad on play`. Use these to trace whether the N+2 slide starts loading on tap and whether any cleanup occurs immediately after promotion.

Work Log (optional, terse; reverse‑chronological)
- 2025-11-15T00:00Z — Initialized Handoff_14 and set plan for HLS unification.

Artifacts (optional)
- Screens: playwright-report/ (local only; not in Git)
