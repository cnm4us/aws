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
- Feed: canonical stream by asset orientation; iOS/Windows-safe sizing (no clipping) with object-fit containment; portrait assets in portrait use cover for edge-to-edge; added fullscreen toggle.
- Styling consolidation Phase 1–3: introduced global variables/base/buttons and migrated Feed, SharedNav/Menu, Drawer, Space Moderation, and Admin Moderation List to CSS Modules.

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
- Affects: src/app.ts; src/routes/admin.ts; src/routes/pages.ts; src/features/spaces/service.ts
- Affects: frontend/src/app/Feed.tsx; frontend/src/components/HLSVideo.tsx; frontend/src/ui/SharedNav.tsx; frontend/src/ui/Layout.tsx; frontend/src/ui/routes.ts; frontend/src/menu/ContextDrawer.tsx; frontend/src/menu/ContextPicker.tsx; frontend/src/menu/contexts/AdminMenu.tsx; frontend/src/menu/contexts/MyAssets.tsx; frontend/src/menu/contexts/ChannelSwitcher.tsx; frontend/src/app/SpaceModeration.tsx; frontend/src/app/AdminModerationList.tsx; frontend/src/app/AdminModerationGroups.tsx; frontend/src/app/AdminModerationChannels.tsx; frontend/src/main.tsx
- Affects: frontend/src/styles/variables.css; frontend/src/styles/base.css; frontend/src/styles/buttons.css; frontend/src/styles/feed.module.css; frontend/src/styles/sharedNav.module.css; frontend/src/styles/menu.module.css; frontend/src/styles/channelSwitcher.module.css; frontend/src/styles/drawer.module.css; frontend/src/styles/spaceModeration.module.css; frontend/src/styles/adminModerationList.module.css
- Routes: GET /api/me; GET /api/admin/moderation/groups; GET /api/admin/moderation/channels; /admin/moderation/groups; /admin/moderation/channels; GET /api/spaces/:id/moderation/queue (response extended with owner, production{name,createdAt}, space{name})
- DB: none
- Flags: none

Commit Messages (ready to paste)
Subject: feat(feed): canonical stream by asset orientation; fullscreen toggle; iOS-safe sizing

Context:
- Landscape assets should always use the landscape stream; portrait assets the portrait stream. Orientation flips on iOS previously triggered sizing/clipping and source confusion. Needed an explicit fullscreen affordance.

Approach:
- Choose manifest by asset orientation (not device). Portrait-only assets never synthesize landscape URLs. Added a simple frame that fills the slide and object-fit containment to avoid clipping on iOS. Added fullscreen toggle on the active slide. Portrait assets in portrait use cover for edge-to-edge.

Impact:
- Stable playback across rotation on iOS Safari and Windows/Chrome; no clipping; explicit fullscreen option.

Tests:
- Manual on iOS Safari (PWA and in-browser) and Windows/Chrome device emulation for 9:16 and 16:9 assets across rotations.

Meta:
- Affects: frontend/src/app/Feed.tsx; frontend/src/components/HLSVideo.tsx; frontend/src/styles/feed.module.css
- Routes: none
- DB: none
- Flags: none

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
Meta:
- Affects: src/features/spaces/service.ts; frontend/src/app/SpaceModeration.tsx
- Routes: GET /api/spaces/:id/moderation/queue

Subject: refactor(css): extract global styles and move nav/menu/drawer/moderation/feed to CSS Modules

Context:
- Inline styles were duplicated and hard to maintain; needed consistent buttons and layout classes.

Approach:
- Added variables.css, base.css, buttons.css. Created CSS Modules for feed, shared nav, drawer, menu, channel switcher, space moderation, admin moderation list. Replaced inline styles with classes. Introduced shared .btn utilities for overlay/outline/primary/danger.

Impact:
- Cleaner, unified styling; easier theming and future tweaks; reduced inline CSS.

Tests:
- Visual QA across Feed, Drawer, Nav/Menu, Admin lists, Space Moderation overlays.

Meta:
- Affects: frontend/src/main.tsx; frontend/src/styles/*; frontend/src/ui/SharedNav.tsx; frontend/src/menu/ContextDrawer.tsx; frontend/src/menu/ContextPicker.tsx; frontend/src/menu/contexts/{AdminMenu,MyAssets,ChannelSwitcher}.tsx; frontend/src/app/{Feed,SpaceModeration,AdminModerationList}.tsx
- Routes: none
- DB: none
- Flags: none

Thread Plan (subset of Backlog)
- [ ] Pick next action from Open Items

Open Items / Next Actions
- Rare “waiting” tail on Windows/Chrome: add one‑shot retry (re‑issue `loadSource+startLoad(-1)` ~500ms after tap if still waiting).
- Boundary‑stop warm on FRAG_LOADED/FRAG_BUFFERED; use integer segment targets to avoid mid‑fragment aborts.
- Consider platform‑specific index+2 short buffer warm on Windows/Chrome.
- Poster pipeline: multi‑size (AVIF/WebP/JPEG), responsive `<picture>`/`<img>`, lazy loading + IO observer, capped concurrency (3–6), 1–2 screens look‑ahead.
- hls.js tuning: `capLevelToPlayerSize: true`, `startLevel: 0`, `maxBufferLength: ~10–12s`.
 - Menu: ensure last-selected menu context opens by default (picker auto-closes on open) — implemented in SharedNav.
 - Fullscreen resume: preserve currentTime and playing state when swapping streams (if we re‑enable swaps on rotate/Full).
 - Optional: auto-fullscreen prompt on rotate for landscape assets.
 - Apply shared .btn utilities to remaining admin pages; consider utilities.css for abs-fill/grid-center.

Work Log (optional, terse; reverse‑chronological)
- 2025-11-19 — CSS Modules + global styles: Feed, SharedNav/Menu, Drawer, SpaceModeration, AdminModerationList; variables/base/buttons added.
- 2025-11-19 — Feed: canonical streams; iOS-safe contain; portrait cover; fullscreen toggle.
- 2025-11-17 — [init] Created Handoff_16.md; carried forward backlog, decisions, and open items.

Artifacts (optional)
- Screens: playwright-report/ (local only; not in Git)
