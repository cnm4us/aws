Your scheme is solid and matches the model you already have. Here’s how I’d implement and refine it, mapped to current tables and endpoints.

Lifecycle & Ownership

Uploads: owned by user_id; deletable by owner (video:delete_own) or site_admin/moderator (video:delete_any). Keep asset deletion distinct from unpublishing.
Productions: same ownership/deletion policy as uploads. Deleting a production should not implicitly delete uploads; log in action_log.
Posts to spaces: represented by space_publications (one per space, unique on upload_id, space_id).
Post vs Publish

Post = create a space_publications row.
Publish = set status to published (with approved_by and published_at).
If review is not required: POST creates row directly as published.
If review is required: POST creates row as pending; moderator approves to publish.
Right now

Create post: POST /api/uploads/:uploadId/publications picks status pending or published based on effective review. (src/routes/publications.ts)
Approve/Unpublish/Reject: POST /api/publications/:id/approve|unpublish|reject with RBAC checks. (src/routes/publications.ts)
Visibility of Pending

Feeds query only published rows. Pending items are not visible in the space feed; moderators (and the submitter in a “My submissions” view) should see them via an “inbox/queue” view, not the public feed.
Suggest: add a lightweight “Pending in Space” list API for moderators/space_admins to review.
RBAC

Post: space:post (aka video:post_space) creates the row.
Approve/Publish/Unpublish: video:approve_space, video:publish_space, video:unpublish_space (space-scoped) or site_moderator via any‑space authority.
Owners can unpublish their own if you want that (you already check video:unpublish_own).
Review Policy (effective)

Effective require = site toggle by type (group/channel) OR space’s publishing.requireApproval.
You already implemented precedence and UI.
States & Simplification

Keep statuses minimal and actionable:
pending → moderator queue
published → visible in feed
unpublished → removed from feed
rejected → not visible, final
“approved” is redundant if approve immediately publishes; if you keep it, define a clear handoff from approved→published.
Global Feed Behavior (personal → global)

Recommended: mirror personal publishes into a designated Global space.
On publish to Personal: also publish to Global (respect users.require_review_global).
On unpublish from Personal: cascade unpublish from Global.
Never mirror Group/Channel posts to Global.
Mark with distribution_flags.origin='personal_mirror' for safe cascades.
Frontend: use the Global space feed (not “Global Archive” which lists raw uploads).
Invariants & Audit

Unique per (upload, space) with a clean 409 if it exists.
Track requested_by, approved_by, published_at, unpublished_at.
Log actions in space_publication_events and action_log (add moderator note support as needed).
Do not delete assets on unpublish.
UX suggestions

Button labeling: if review required, show “Submit for Review”; else “Publish”.
Moderator queue: per-space page showing pending items with quick Approve/Reject.
Open question to confirm

Should submitters see their own pending post when they visit the space (visible only to them), or strictly moderators only? Current feeds hide pending from everyone; I recommend: hidden from general members, visible to submitter in a dedicated “My submissions” list.
This setup keeps ownership clear, moderates at the publication layer (not the asset), and cleanly supports site- vs space-level policy and moderation.

Issues & Decisions — Iteration 1 (Global Feed vs Global Archive)

1) Source of Global feed
- Issue: “Global Archive” currently lists raw `uploads` (status=completed) via `/api/uploads` and is not a governed feed.
- Decision: Do NOT use `uploads` for the Global feed. The true Global feed is a standard space feed backed by `space_publications` on a designated Global space (slug `global` or settings.flags.isGlobal=true). “Global Archive” is a legacy/all-uploads view for dev/admin, not user-facing discovery.

2) Personal → Global propagation
- Requirement: Publishing to Personal should place the video in the Global feed; unpublishing from Personal should remove it from Global.
- Decision: Adopt “Mirrored Global Space”. On publish to Personal, auto-create/activate a mirror publication in the Global space (respect `users.require_review_global`: pending vs published). On unpublish from Personal, cascade unpublish to Global. Global moderation (site_moderator/admin) can unpublish the Global mirror without affecting Personal.
- Implementation detail: Mark mirrored rows with `distribution_flags.origin={ type:'personal', spaceId }` and `distribution_flags.mirror={ target:'global', mode:'auto' }` for safe cascades.

3) Groups isolation
- Requirement: Group posts remain in the group and never surface on Global.
- Decision: No mirroring from groups to Global. If a request is attempted, reject with 403. UI should not offer a Global option for group posts.

4) Channels “promotion” to Global
- Requirement: Channel posts remain in-channel by default, but channels want an option to expose some posts publicly on Global (akin to ads/promotions).
- Decision: Channel managers (space_admin/moderator) may Request Global promotion; site_moderator/admin approve to Global.
  - Request flow: channel publication sets `distribution_flags.requestGlobal=true` (or POST a request endpoint). Items appear in a Global Promotions queue for site_moderators.
  - Approval creates a separate publication in Global, with `distribution_flags.origin={ type:'channel', spaceId }` and `mirror={ target:'global', mode:'approved', approvedBy }`.
  - Optional site setting later: `allowChannelDirectGlobal` (default off). When on, users with space_admin/moderator at the channel may post “Channel+Global” in one step (creates both publications), bypassing global review.
  - RBAC: publishing to Global requires `feed:publish_global` [S] (site scope). Channel admins without site scope use the request flow. Site moderators/admins approve/curate via `feed:publish_global` and `feed:moderate_global`.

5) Feeds & visibility
- Global feed: `/api/spaces/:globalId/feed` → `space_publications` where `space_id=global`, `status='published'`.
- Personal feed: `/api/spaces/:id/feed` for the user’s personal space.
- Group/Channel feeds: standard space feeds.
- Legacy “Global Archive”: rename to “All Uploads (Legacy)” or hide behind a dev toggle; it uses `/api/uploads`.

6) States
- Keep: `pending`, `published`, `unpublished`, `rejected`.
- Personal → Global mirror respects `users.require_review_global` (pending if true, published if false).

7) Database & keys (minimal changes)
- Reuse `space_publications.distribution_flags` (JSON) to track mirroring and requests:
  - Example:
    {
      "origin": { "type": "personal|channel", "spaceId": 123 },
      "mirror": { "target": "global", "mode": "auto|approved|requested", "requestedBy": 12, "approvedBy": 34, "requestedAt": "...", "approvedAt": "..." },
      "requestGlobal": true|false
    }
- Optional: `spaces.settings.flags.isGlobal=true` for the designated Global space (or rely on slug 'global').
- Indexes: already have `idx_space_publications_space_status (space_id, status, published_at, id)` sufficient for feeds.

8) RBAC mapping
- Post to any space: `space:post` (aka `video:post_space`).
- Approve/Publish/Unpublish in a space: `video:approve_space`, `video:publish_space`, `video:unpublish_space` (space-scoped) or site_moderator/admin (any-space authority).
- Global curation: `feed:publish_global` and `feed:moderate_global` [S].
- Per-user global hold: `users.require_review_global` used to gate personal→global auto-mirror.
- Optional new permission for request: `feed:request_global` [P] (channel scope) allowing channel admins to flag publications for Global promotion without site scope.

9) API surfaces (draft)
- Auto-mirror (personal): handled inside publication creation when posting to a personal space (create global pub; pending/published per user flag).
- Unpublish cascade (personal): on unpublish in a personal space, also unpublish the Global mirror if `mirror.mode='auto'`.
- Channel request to Global: POST `/api/channels/:id/publications/:pubId/request-global` (or PUT on publication flags). Visible to space_admin/moderator of the channel.
- Global approvals: admin endpoint to list requests and promote → create/publish in Global; reject removes request flag or marks rejected.

10) Frontend
- Default left nav to the Global space feed (if present); demote/rename “Global Archive”.
- Publish flow:
  - Personal: label “Publish (also to Global)” with note if on global-hold.
  - Channel: show “Request Global exposure” checkbox (when site allows requests); if site allows direct, show “Channel only / Global only / Both (Channel+Global)”.
  - Group: no Global options.
- Moderation UI: “Global Promotions” queue for site moderators.

Open Items
- Confirm whether channel managers should ever publish directly to Global without site oversight (default assumption: NO; use request+approve).
- Decide if we want a site setting `allowChannelDirectGlobal` and its default.
- Confirm visibility for submitter’s pending items (My submissions vs appearing in space feed for just the submitter).

Issues & Decisions — Iteration 2 (Unpublish semantics; assets remain)

Summary
- Publications are references to content (production variant preferred, upload legacy). Changing or removing a publication affects feed visibility only; it does not delete the underlying assets.

Decisions
- Do not delete uploads or productions when unpublishing; only change the publication state.
- Prefer soft state over row deletion: use `status='unpublished'` with `unpublished_at` (and record an event). Keep the row for audit and analytics. Optionally add `deleted_at` if you later want hard-deletes.
- Personal ↔ Global behavior:
  - Unpublish from Personal cascades: also unpublish the mirrored Global publication (when `mirror.target='global'`).
  - Global moderation can unpublish from Global without touching Personal (no reverse cascade by default).
- Groups remain isolated (no Global publications); Channels can request/receive Global publications via the promotions flow.

DB notes
- Keep using `space_publications.status` ∈ { pending, published, unpublished, rejected }.
- Continue logging transitions in `space_publication_events` (include moderator notes).
- Denormalize `owner_user_id` on `space_publications` for fast filtering (truth source remains `productions.user_id` or legacy `uploads.user_id`).
- Migration path remains: add `production_id` alongside legacy `upload_id`; start publishing against `production_id`.

Issues & Decisions — Iteration 3 (Feed data, denormalization, indexes, capacity)

Goal
- Serve all feeds (Global, Personal, Group, Channel, and User profile views) from `space_publications` with efficient, index-friendly queries; keep the schema coherent and minimal while avoiding premature complexity.

Data model (publication-centric, single row)
- `space_publications`
  - `production_id` BIGINT (new, preferred) — exact variant being published; keep `upload_id` for legacy.
  - `owner_user_id` BIGINT (new, denormalized) — mirrors `productions.user_id` for fast filters (e.g., user profile feed).
  - `status` ENUM('pending','published','unpublished','rejected') — master visibility state across surfaces.
  - `visible_in_space` TINYINT(1) NOT NULL DEFAULT 1 — appears in its space feed.
  - `visible_in_global` TINYINT(1) NOT NULL DEFAULT 0 — included in global aggregator.
  - `requested_by`, `approved_by`, timestamps — workflow.
  - `distribution_flags` JSON — optional metadata (e.g., channel request details).
  - Unique key: one publication per (space, content):
    - Legacy: UNIQUE(upload_id, space_id)
    - Target: UNIQUE(production_id, space_id)

Defaults and policy
- Personal: `visible_in_space=1, visible_in_global=1`.
- Groups: `visible_in_space=1, visible_in_global=0` (never global).
- Channels: default `visible_in_space=1, visible_in_global=0`; admins can request/approve setting `visible_in_global=1`. “Global only” ads: `visible_in_space=0, visible_in_global=1`.
- Global moderation/removal of personal posts removes from personal as well (no global-only moderation for personal; use status transitions on the same row).

Feed queries (keyset pagination)
- Personal feed: WHERE `space_id = ?` AND `status='published'` AND `visible_in_space=1` ORDER BY (`published_at` DESC, `id` DESC) LIMIT N.
- Group/Channel feed: same as personal (by `space_id`).
- Global feed: WHERE `status='published'` AND `visible_in_global=1` ORDER BY (`published_at` DESC, `id` DESC) LIMIT N.
- User profile (all publicly available posts by user): WHERE `owner_user_id = ?` AND `status='published'` AND (`visible_in_space=1` OR `visible_in_global=1`), optionally excluding groups.

Indexes (cover common access paths)
- `idx_space_feed (space_id, status, visible_in_space, published_at, id)`
- `idx_global_feed (visible_in_global, status, published_at, id)`
- `idx_owner_feed (owner_user_id, status, published_at, id)`
- Unique: `(space_id, production_id)` (and/or legacy `(space_id, upload_id)`).

Denormalization vs joins
- Keep `owner_user_id` on `space_publications` to serve user-profile and moderation views without joins.
- Media URLs (HLS master, posters) should live in `productions` (preferred) or be resolvable via a single join to `uploads` during transition. Favor adding stable, resolved URLs (or their components like `output_prefix`) to `productions` to avoid joins in hot paths later.
- Display name/email are safe to join from `users` on demand; not worth denormalizing unless a hard requirement. Cache at the application layer if needed.

Read/write contention
- A single `space_publications` table for both reads and writes is fine for MVP. InnoDB uses row-level locking; our workload is read-heavy, write-light.
- Use keyset pagination (published_at,id) to keep scans tight. Verify plans with `EXPLAIN`.

Capacity (MVP guidance)
- With proper indexes above, a single small EC2 (e.g., t3.medium/t3.large) with MariaDB and Node can handle thousands of feed requests per minute for tens of thousands of publications, since video delivery is offloaded to S3/CloudFront.
- Optimize DB:
  - Set `innodb_buffer_pool_size` to ~60–70% of RAM.
  - Use a modest MySQL pool (10–20 connections) in the app.
  - Keep queries selective and avoid `SELECT *` on large joins; fetch only needed columns for feed cards.
- Next steps when growing:
  - Move MariaDB to a managed instance (RDS/Aurora) or separate EC2.
  - Add a read replica if needed (reads dominate).
  - Introduce a small Redis cache for popular pages/cursors.
  - Consider materialized feed snapshots only if query patterns become complex.
