Handoff 16

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
- Add Admin menu to Menu Selector (site-admin gated). New SPA pages for Group/Channel Moderation listing spaces with pending counts and linking to per-space moderation. Backend: expose `/api/admin/moderation/groups|channels` and add `isSiteAdmin` to `/api/me` for front-end gating.

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
- Affects: src/app.ts; src/routes/admin.ts; frontend/src/ui/SharedNav.tsx; frontend/src/menu/ContextPicker.tsx; frontend/src/menu/contexts/AdminMenu.tsx; frontend/src/ui/Layout.tsx; frontend/src/app/Feed.tsx; frontend/src/app/AdminModerationList.tsx; frontend/src/app/AdminModerationGroups.tsx; frontend/src/app/AdminModerationChannels.tsx; frontend/src/main.tsx; frontend/src/ui/routes.ts
- Routes: GET /api/me; GET /api/admin/moderation/groups; GET /api/admin/moderation/channels; /admin/moderation/groups; /admin/moderation/channels
- DB: none
- Flags: none
 - Affects: src/features/spaces/service.ts; frontend/src/app/SpaceModeration.tsx
 - Routes: GET /api/spaces/:id/moderation/queue (response extended with owner, production{name,createdAt}, space{name})

Commit Messages (ready to paste)
Subject: feat(admin): add Admin menu + moderation overviews; expose isSiteAdmin

Context:
- Need top-right Admin menu for site admins with Group/Channel Moderation lists linking to per-space moderation; front-end needs a robust gate for site admins.

Approach:
- Back end: add `isSiteAdmin` to `/api/me` via PERM.VIDEO_DELETE_ANY; add `/api/admin/moderation/groups|channels` endpoints to list spaces with pending publication counts.
- Front end: add Admin menu context (site-admin gated); add SPA pages for Group/Channel Moderation; wire main.tsx routes and prefetch; pass `isSiteAdmin` through Layout/Feed to SharedNav; render Admin in ContextPicker conditionally.

Impact:
- Site admins see Admin in Menu Selector; can navigate to moderation overviews and into per-space moderation.

Tests:
- Manual: verify `/api/me` includes isSiteAdmin for admin user; check Admin menu visibility; load `/admin/moderation/groups|channels`; click into `/spaces/:id/moderation`.

Meta:
- Affects: src/app.ts; src/routes/admin.ts; frontend/src/ui/SharedNav.tsx; frontend/src/menu/ContextPicker.tsx; frontend/src/menu/contexts/AdminMenu.tsx; frontend/src/ui/Layout.tsx; frontend/src/app/Feed.tsx; frontend/src/app/AdminModerationList.tsx; frontend/src/app/AdminModerationGroups.tsx; frontend/src/app/AdminModerationChannels.tsx; frontend/src/main.tsx; frontend/src/ui/routes.ts
- Routes: GET /api/me; GET /api/admin/moderation/groups; GET /api/admin/moderation/channels; /admin/moderation/groups; /admin/moderation/channels
- DB: none
- Flags: none
 - Affects: src/features/spaces/service.ts; frontend/src/app/SpaceModeration.tsx
 - Routes: GET /api/spaces/:id/moderation/queue

Thread Plan (subset of Backlog)
- [ ] Pick next action from Open Items

Open Items / Next Actions
- Rare “waiting” tail on Windows/Chrome: add one‑shot retry (re‑issue `loadSource+startLoad(-1)` ~500ms after tap if still waiting).
- Boundary‑stop warm on FRAG_LOADED/FRAG_BUFFERED; use integer segment targets to avoid mid‑fragment aborts.
- Consider platform‑specific index+2 short buffer warm on Windows/Chrome.
- Poster pipeline: multi‑size (AVIF/WebP/JPEG), responsive `<picture>`/`<img>`, lazy loading + IO observer, capped concurrency (3–6), 1–2 screens look‑ahead.
- hls.js tuning: `capLevelToPlayerSize: true`, `startLevel: 0`, `maxBufferLength: ~10–12s`.
 - Menu: ensure last-selected menu context opens by default (picker auto-closes on open) — implemented in SharedNav.

Work Log (optional, terse; reverse‑chronological)
- 2025-11-17 — [init] Created Handoff_16.md; carried forward backlog, decisions, and open items.

Artifacts (optional)
- Screens: playwright-report/ (local only; not in Git)
