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
- Affects: agents/implementation/plan_05.md; agents/handoff/Handoff_18.md; src/db.ts; src/features/follows/repo.ts; src/features/follows/service.ts; src/features/feeds/repo.ts; src/features/feeds/service.ts; src/routes/spaces.ts; src/routes/profiles.ts; frontend/src/app/Feed.tsx; frontend/src/styles/feed.module.css
- Routes: /api/spaces/:id/users/:userId/follow; /api/profile/:userId
- DB: space_user_follows
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

Thread Plan (subset of Backlog)
- [ ] Preserve currentTime on fullscreen/source swaps (feed)
- [ ] Apply .btn utilities to remaining admin pages (optional)
- [ ] Add utilities.css (abs-fill, grid-center) and migrate small pockets

Work Log (optional, terse; reverse‑chronological)
- 2025-12-21 — [init] Created Handoff_18.md; carried forward backlog and durable decisions from Handoff_17.

Artifacts (optional)
