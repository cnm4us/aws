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
- Canonical routing enabled: `/groups`, `/groups/:slug`, `/channels`, `/channels/:slug` now render the SPA without server redirects. Feed derives mode from the path and skips any LS/global restore, eliminating stray warms from the wrong feed.
- LocalStorage persistence removed for last feed/video. Canonical pages always start at index 0. Warm gating requires items to match the active feedKey and restore completion.
- hls.js pipeline stabilized for Windows/Chrome: attach‑warm defers manifest (no early .m3u8), on user play we guarantee `loadSource+startLoad(-1)`, and cleanup uses a gentle destroy. Videos loop automatically after completion.
- Media ladders updated for mobile: added 360p rung, reduced MaxBitrate ceilings (1080→6.5 Mbps, 720→3.5, 540→1.8, 480→1.5), AAC 128 kbps. Outputs verified in S3.

Decisions (carried + new)
- Keep using hls.js for non‑Safari browsers; rely on native HLS only on Safari/iOS.
- Never assign `.m3u8` to `<video src>` on Chrome/Android; store manifest in `data-video-src` and let hls.js attach.
- Minimal, targeted edits to existing Feed to avoid broad refactors; keep event handlers and UI intact.
- Use ULID for slide keys to preserve instance identity across stage roles (active/warm/prewarm/linger).
- Split HLSVideo attach/detach (keyed to `src`) from warm control (keyed to `warmMode`) so warm→active does not destroy MSE.
- Warm window: index‑1 (linger), index (active), index+1 (buffer warm ~3s then stop), index+2..+5 (attach warm). Autoplay disabled; user taps start unmuted from frame 0.
- Promotion lock (ignore IO/scroll ~800ms) on tap-based promotion to reduce index bounce.
- Canonical feed URLs are the source of truth; bypass PWA forced `/` redirect for `/groups/*` and `/channels/*`.
- Disable LS read/write for feed/video. Canonical pages land on slide 0.
- Loop active videos.

Changes Since Last
- Affects: frontend/src/main.tsx; src/routes/pages.ts; frontend/src/app/Feed.tsx; frontend/src/components/HLSVideo.tsx; frontend/src/components/FeedVideo.tsx; jobs/mixins/output/portrait-cmaf-1080-720-540.json; jobs/mixins/output/landscape-cmaf-1080-720-480.json; jobs/mixins/output/portrait-from-landscape-cmaf-720-540.json; jobs/mixins/output/portrait-1080-720-540.json; jobs/mixins/output/landscape-1080-720-480.json; jobs/mixins/audio/normalize-lufs-16.json; src/services/productionRunner.ts; src/jobs.ts
- Routes: /groups; /groups/:slug; /channels; /channels/:slug
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: feat(routing): add canonical group/channel routes; serve SPA without redirects

Context:
- Users need shareable deep links for `/groups/:slug` and `/channels/:slug`. Previous server redirect prevented SPA mounting.

Approach:
- Frontend: add canonical paths and bypass PWA redirect. Server: serve index.html for canonical paths (no 302).

Impact:
- Canonical links work in web and PWA.

Meta:
- Affects: frontend/src/main.tsx; src/routes/pages.ts
- Routes: /groups; /groups/:slug; /channels; /channels/:slug
- DB: none
- Flags: none

Subject: fix(feed): disable localStorage restore; path‑driven feed; tighten warm gating

Context:
- LS restore caused stray warms and wrong feed warming.

Approach:
- Parse canonical path; defer global load; disable all LS read/write for last feed/video; restrict warming to items matching active feedKey after restore.

Impact:
- No more stray global requests on canonical pages; start at index 0.

Meta:
- Affects: frontend/src/app/Feed.tsx
- Routes: none
- DB: none
- Flags: none

Subject: fix(video): defer attach‑warm manifest; re‑prime on play; gentle destroy; loop

Context:
- Attach‑warm canceled manifests and N+2 no‑start on Windows/Chrome.

Approach:
- Defer `loadSource` for attach‑warm; on play ensure `loadSource+startLoad(-1)`; gentle destroy waits FRAG_LOADED or ~160ms; enable `loop`.

Impact:
- ~90% fewer canceled .m3u8; improved first‑tap reliability; seamless looping.

Meta:
- Affects: frontend/src/components/HLSVideo.tsx; frontend/src/components/FeedVideo.tsx
- Routes: none
- DB: none
- Flags: none

Subject: feat(encoding): add 360p rung; lower ceilings; set AAC 128k; align HQ

Context:
- Provide high quality on strong links and a safe floor on poor mobile connections.

Approach:
- Add 360p rung; 1080/720/540/480 caps to 6.5/3.5/1.8/1.5 Mbps; AAC 128k; update HQ mapping.

Impact:
- Better ABR on 0.6–2 Mbps; reduced peaks.

Meta:
- Affects: jobs/mixins/output/*; src/services/productionRunner.ts; src/jobs.ts
- Routes: none
- DB: none
- Flags: none

Thread Plan (subset of Backlog)
- [x] Implement canonical routing and SPA fallbacks
- [x] Disable LS restore; path‑driven feed selection
- [x] Defer attach‑warm manifest; on‑tap re‑prime; gentle destroy; loop
- [x] Update CMAF/HLS ladders; add 360p; audio 128k
- [ ] Optional: stop buffer‑warm on FRAG_LOADED (segment‑aligned)
- [ ] Optional: index+2 short buffer on Windows/Chrome only
- [ ] Optional: add hls.js capLevelToPlayerSize/startLevel and a debug level selector
- [ ] Posters: responsive variants + lazy <img> + concurrency cap

Open Items / Next Actions
- Rare “waiting” tail on Windows/Chrome: add one‑shot retry (re‑issue `loadSource+startLoad(-1)` ~500ms after tap if still waiting).
- Boundary‑stop warm on FRAG_LOADED/FRAG_BUFFERED; use integer segment targets to avoid mid‑fragment aborts.
- Consider platform‑specific index+2 short buffer warm on Windows/Chrome.
- Poster pipeline: multi‑size (AVIF/WebP/JPEG), responsive <picture>/<img>, lazy loading + IO observer, capped concurrency (3–6), 1–2 screens look‑ahead.
- hls.js tuning: `capLevelToPlayerSize: true`, `startLevel: 0`, `maxBufferLength: ~10–12s`.

Work Log (optional, terse; reverse‑chronological)
- 2025-11-17 — Canonical routes + SPA fallbacks; Feed path parsing; PWA bypass.
- 2025-11-17 — Disabled LS read/write for feed/video; tightened warm gating.
- 2025-11-17 — HLS attach‑warm defer + on‑tap re‑prime; gentle destroy; video loop.
- 2025-11-17 — Media ladders updated (360p added; ceilings lowered; AAC 128k); HQ mapping aligned.

Artifacts (optional)
- Screens: playwright-report/ (local only; not in Git)
