Feeds Implementation Plan
Last updated: 2025-10-21

Scope
- Implement a publication-centric feed system using a single row per space+production (no mirroring).
- Personal/global coupling: global moderation/removal also removes from personal posts (status change on the same row). Assets remain intact.
- Visibility placement via booleans: `visible_in_space`, `visible_in_global`.
- Global feed is an aggregated query across `space_publications` (not `uploads`).

References
- Decisions and schema notes: docs/FeedsRBAC_DB.md
- Prior RBAC work and review toggles: docs/RBAC_Implementation_Plan.md

Milestone 1 — Schema (publication-centric)
- space_publications (target shape)
  - production_id BIGINT NOT NULL (exact variant being published)
  - owner_user_id BIGINT NOT NULL (denormalized from productions.user_id)
  - space_id BIGINT NOT NULL
  - status ENUM('pending','published','unpublished','rejected') NOT NULL DEFAULT 'draft' → normalize to NOT DEFAULT 'draft' when creating rows
  - requested_by BIGINT NULL, approved_by BIGINT NULL
  - published_at DATETIME NULL, unpublished_at DATETIME NULL
  - visible_in_space TINYINT(1) NOT NULL DEFAULT 1
  - visible_in_global TINYINT(1) NOT NULL DEFAULT 0
  - distribution_flags JSON NULL
  - Constraints & indexes:
    - UNIQUE (space_id, production_id)
    - idx_space_feed (space_id, status, visible_in_space, published_at, id)
    - idx_global_feed (visible_in_global, status, published_at, id)
    - idx_owner_feed (owner_user_id, status, published_at, id)

Notes
- We are early in development; we can drop legacy `upload_id` usage and rebuild content.
- Keep space_publication_events for audit (create_pending, auto_published, approve, unpublish, reject).

Milestone 2 — Backend APIs
- Create publication (production-centric)
  - POST /api/productions/:id/publications { spaceId, visibility?, distributionFlags? }
  - Resolve effective review policy (site-by-type OR space setting) and set:
    - status = 'pending' or 'published'
    - requested_by = userId, approved_by = userId only when auto-published
    - owner_user_id from productions.user_id
  - Defaults by space type:
    - personal: visible_in_space=1, visible_in_global=1
    - group: visible_in_space=1, visible_in_global=0
    - channel: visible_in_space=1, visible_in_global=0 (by default)

- Approve/Unpublish/Reject (existing endpoints by publicationId)
  - Approve → status='published', approved_by=userId, published_at=now
  - Unpublish → status='unpublished', unpublished_at=now
  - Reject → status='rejected'
  - RBAC: `video:approve_space`, `video:publish_space`, `video:unpublish_space` (space-scoped) or site_moderator/admin (any-space)

- Channel promotion to Global
  - v1: site_moderator/admin can toggle visible_in_global for channel publications (RBAC: `feed:publish_global`).
  - v2 (optional): request flow for channel admins; moderators approve and set visible_in_global=1.

Milestone 3 — Feed Endpoints
- Space feed (auth required):
  - GET /api/spaces/:id/feed → WHERE space_id=? AND status='published' AND visible_in_space=1 ORDER BY (published_at DESC, id DESC) LIMIT N (keyset).
- Global feed (auth required):
  - GET /api/feed/global → WHERE status='published' AND visible_in_global=1 ORDER BY (published_at DESC, id DESC) LIMIT N.
- User profile feed (public posts by user) — later:
  - GET /api/users/:id/feed → WHERE owner_user_id=? AND status='published' AND (visible_in_space=1 OR visible_in_global=1).

Milestone 4 — Frontend
- Replace legacy “Global Archive” with Global (uses /api/feed/global). Keep Archive in a dev menu if needed.
- Publish flows
  - Personal: “Publish” (goes to personal+global by default; pending when review is required).
  - Channel: show “Show on Global” toggle to users with permission; otherwise hide or show “Request Global”.
  - Group: no global toggle.
- Moderation views (later): pending list per space; optional “Global Promotions” queue if request flow is enabled.

Milestone 5 — RBAC & Policy
- Enforce `space:post` for creation, `video:approve_space|publish_space|unpublish_space` for moderation.
- Global curation requires `feed:publish_global` / `feed:moderate_global` (site scope).
- Effective review policy precedence already implemented (site-by-type OR space setting).

Milestone 6 — Validation & Performance
- Unit tests: publication creation (pending vs published), unique per (space, production), RBAC enforcement.
- Feeds return only published rows honoring visibility flags; keyset pagination works as expected.
- Index plans verified via EXPLAIN.

Milestone 7 — Rollout
- Apply schema changes and rebuild dev content.
- Switch backend create/unpublish to production-centric endpoint.
- Switch frontend to use /api/feed/global.
- Disable/rename legacy Global Archive in UI.
- Enable channel global toggles for site moderator/admin.

Open Items (non-blocking)
- Decide on “Global only” for channel ads (visible_in_space=0, visible_in_global=1) and who can set it.
- Timing for user profile feed endpoint.

