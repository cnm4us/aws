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
- [init] New thread. Continuing from Handoff 17 with focus on avatars/profile features in feed and per-space follow/follow UX (plan_05), and explicit Personal vs Global publishing scopes on the Publish page (plan_06). Next thread should pick up public profile slugs and `/users/:slug` per `agents/implementation/plan_07.md`.

Decisions (carried + new)
- Keep using hls.js for non‑Safari browsers; rely on native HLS only on Safari/iOS.
- Never assign `.m3u8` to `<video src>` on Chrome/Android; store manifest in `data-video-src` and let hls.js attach.
- Asset orientation drives stream selection; device rotation does not swap stream.
- Use object-fit contain for robust sizing; allow portrait assets to use cover in portrait for edge-to-edge.
- Publishing semantics (Personal vs Global, Phase 1):
  - Personal and Global Feed are independent scopes; each maps to its own `space_publications` row when selected.
  - The Publish page uses checkboxes as the single source of truth: one diff-based “Publish” button applies both publish and unpublish per space.
  - `visible_in_global` is set only for publications in the designated Global space (slug `global` or `global-feed`); Personal no longer implies global visibility.
  - A dedicated Global space row (channel, slug `global-feed`) backs both `/channels/global-feed` and `/api/feed/global`.

Changes Since Last
- Affects:
  - plan_05 / follows & avatars: agents/implementation/plan_05.md; agents/handoff/Handoff_18.md; src/db.ts; src/features/follows/repo.ts; src/features/follows/service.ts; src/features/feeds/repo.ts; src/features/feeds/service.ts; src/routes/spaces.ts; src/routes/profiles.ts; frontend/src/app/Feed.tsx; frontend/src/styles/feed.module.css
  - plan_06 / Personal vs Global publishing: agents/implementation/plan_06.md; src/db.ts; src/features/publications/repo.ts; src/features/publications/service.ts; src/features/uploads/service.ts; frontend/src/app/Publish.tsx
  - Global Feed routing/menu polish: frontend/src/app/Feed.tsx; frontend/src/menu/contexts/ChannelSwitcher.tsx; public/app/index.html
- Routes: /api/spaces/:id/users/:userId/follow; /api/profile/:userId; /api/feed/global; /api/uploads/:id/publish; /api/uploads/:id/unpublish; /api/productions/:id/publications; /api/publications/:id/unpublish
- DB: space_user_follows; space_publications (visible_in_global semantics, retroactive cleanup)
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

Subject: feat(follow): add per-space user follows and APIs

Context:
- Enable per-space (group/channel) follow relationships between users to support follow UX in the feed and profile overlay.

Approach:
- Added a `space_user_follows` table in `src/db.ts` keyed by `(follower_user_id, target_user_id, space_id)`.
- Implemented `src/features/follows/repo.ts` and `service.ts` to manage follow summaries and mutations, including basic self-follow guards and space-type checks.
- Exposed `GET/POST/DELETE /api/spaces/:id/users/:userId/follow` in `src/routes/spaces.ts` returning `{ following, followersCount }`.

Impact:
- Backend provides a clean, space-scoped follow primitive that the feed and future UIs can consume without altering feed filtering yet.

Tests:
- Not yet run; follow endpoints validated by code inspection.

Meta:
- Affects: src/db.ts; src/features/follows/repo.ts; src/features/follows/service.ts; src/routes/spaces.ts
- Routes: /api/spaces/:id/users/:userId/follow
- DB: space_user_follows
- Flags: none

Subject: feat(feed): show avatars and profile peek overlay with per-space follow

Context:
- Surface author identity in the feed with avatars and a quick profile peek, and wire in per-space follow/unfollow actions without changing feed filtering.

Approach:
- Joined `profiles` into feed rows (`src/features/feeds/repo.ts`) and threaded `avatar_url` through `FeedResponse` to `UploadItem.ownerAvatarUrl` in `frontend/src/app/Feed.tsx`.
- Rendered a 48×48 circular avatar + author name on each slide and added a clickable avatar button that opens a lightweight profile peek overlay.
- The overlay loads `/api/profile/:userId` (including memberSince), links to `/users/:userId`, and, when in a group/channel context, calls the new follow APIs with optimistic follow/unfollow and “N followers in this space” counts.

Impact:
- Feed slides now show author avatars and allow quick inspection + follow in group/channel spaces, improving identity and engagement while preserving existing feed behavior.

Tests:
- Not yet run; manual verification in the browser recommended for avatar rendering, overlay behavior, and follow state consistency.

Meta:
- Affects: src/features/feeds/repo.ts; src/features/feeds/service.ts; src/routes/profiles.ts; frontend/src/app/Feed.tsx; frontend/src/styles/feed.module.css
- Routes: /api/profile/:userId
- DB: none
- Flags: none

Subject: feat(publish): explicit Personal vs Global scopes (plan_06)

Context:
- Separate Personal and Global Feed publishing so that creators choose exactly where a video appears, and make the Publish page checkbox state the single source of truth.

Approach:
- Updated the Publish page (`frontend/src/app/Publish.tsx`) to:
  - Remove the “All eligible spaces” toggle and the redundant “Published To” summary.
  - Show Personal, Global Feed, groups, and channels as individual checkboxes with no implicit defaults.
  - Replace separate Publish/Unpublish buttons with a single diff-based Publish action that computes `toPublish`/`toUnpublish` and calls the existing upload/production endpoints.
- Adjusted publication creation (`src/features/publications/service.ts`) so `visible_in_global` is set only when publishing to the designated Global space (slug `global` or `global-feed`), not for Personal.
- Added an idempotent migration in `src/db.ts` to clear legacy “Personal ⇒ Global” flags and to align existing Global-space publications with `visible_in_global=1`.
- Extended publish options (`src/features/uploads/service.ts`) and the Global feed query to respect the new Global space row.

Impact:
- Creators explicitly choose Personal vs Global Feed (or both) per video; the Global feed only shows items intentionally published there, and checkbox state is authoritative and reversible.

Tests:
- Manual: verified checkbox state for new/existing uploads, diff-based publish/unpublish behavior, and that Global feed content matches explicit Global selections.

Meta:
- Affects: agents/implementation/plan_06.md; src/db.ts; src/features/publications/repo.ts; src/features/publications/service.ts; src/features/uploads/service.ts; src/features/feeds/repo.ts; src/routes/spaces.ts; frontend/src/app/Publish.tsx; frontend/src/app/Feed.tsx
- Routes: /api/uploads/:id/publish; /api/uploads/:id/unpublish; /api/productions/:id/publications; /api/publications/:id/unpublish; /api/feed/global
- DB: space_publications (visible_in_global); space_publications indexes
- Flags: none

Subject: chore(ui): simplify Global Feed switcher entry

Context:
- Remove ambiguity between the root Global feed and the Global Feed channel in the Channel Changer, and ensure one tap from non-feed pages lands on the canonical Global channel route.

Approach:
- Updated `frontend/src/menu/contexts/ChannelSwitcher.tsx` to:
  - Remove the separate “Global Feed” button that linked to `/`.
  - Treat the Global space entry like other spaces and navigate to `/channels/global-feed`.
  - Clean up the label so it appears simply as “Global Feed” without an extra `(global)` suffix.
- Adjusted Feed canonical resolution so `/channels/global-feed` correctly resolves to the Global space even when it appears in `spaceList.global` and not in `spaceList.channels`.

Impact:
- From both the Feed and non-feed contexts (e.g., the Publish page), selecting Global Feed in the menu consistently lands on the Global Feed channel and loads its space feed on the first click.

Tests:
- Manual: from `/publish?production=:id`, opened the menu, selected “Global Feed”, and confirmed navigation to `/channels/global-feed` with the expected feed items; repeated from the main feed view.

Meta:
- Affects: frontend/src/menu/contexts/ChannelSwitcher.tsx; frontend/src/app/Feed.tsx; public/app/index.html
- Routes: /channels/global-feed
- DB: none
- Flags: none

Thread Plan (subset of Backlog)
- [ ] Preserve currentTime on fullscreen/source swaps (feed)
- [ ] Apply .btn utilities to remaining admin pages (optional)
- [ ] Add utilities.css (abs-fill, grid-center) and migrate small pockets
- [ ] Next thread: implement user slugs + public profile pages (`/users/:slug`) per `agents/implementation/plan_07.md`.

Work Log (optional, terse; reverse‑chronological)
- 2025-12-21 — [init] Created Handoff_18.md; carried forward backlog and durable decisions from Handoff_17.
- 2025-12-21 — [publish] Implemented explicit Personal vs Global publishing scopes (plan_06), including checkbox-driven diff-based publish/unpublish and `visible_in_global` semantics tied to the Global space.
- 2025-12-21 — [feed] Wired Global space into `/api/feed/global`, added retroactive cleanup for legacy Personal ⇒ Global coupling, and aligned Global Feed channel and root Global feed behavior.
- 2025-12-21 — [ui] Simplified Channel Changer Global entry to a single “Global Feed” item that navigates to `/channels/global-feed` from both feed and non-feed contexts.

Artifacts (optional)
