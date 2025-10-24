Handoff Summary (Session: 2025-10-20)

Overview
- Project compiles and runs; uploads → productions → publish flows verified after rebuild.
- Major focus this pass: RBAC cleanup (site vs space roles), admin UX split, moderation controls, and comments policy wiring.

Key Outcomes
- Unified “space” model with profiles (group-like/channel-like) remains; differences handled via settings and default role bundles.
- Canonical role catalog established:
  - Site roles: site_admin, site_moderator, site_member
  - Space roles: space_admin, space_moderator, space_member, space_poster, space_subscriber
- Legacy roles (admin/moderator/publisher/member/viewer/subscriber/uploader, group_*, channel_*) are deprecated in UI; scopes normalized in DB.

RBAC Highlights
- Seeds + migration
  - scripts/rbac/seeds.ts: canonical permissions (with scope) and role bundles
  - scripts/rbac/migrate-rbac.ts: adds permissions.scope, roles.scope, roles.space_type; seeds roles/permissions; links role_permissions; normalizes legacy role scopes to site; enforces correct scopes for new catalog
  - scripts/rbac/truncate-dev.ts: optional content-clear helper (dev only)
  - Ran migrate script; scopes now correct and bundles in place
- Permission semantics (src/security/permissions.ts)
  - Widened Permission to string to avoid churn
  - Space-scoped permissions require spaceId; site moderators/admins have any-space moderation for review/publish/unpublish
  - Posting suspensions enforced (site/space-scoped) for space:post/video:post_space; silent if table not present
  - Own permissions respected (publish_own/unpublish_own/edit_own/delete_own)
- /api/me normalization (src/app.ts)
  - Site roles filtered to /^site_/
  - spaceRoles normalized to space_* (maps legacy names), deduplicated and ordered
- Registration defaults (src/app.ts)
  - New users receive site_member, and in personal space: space_member + space_poster

Admin UX (split pages)
- Pages routed via src/routes/pages.ts (both plural and singular paths):
  - Settings: /admin/settings (public/admin-settings.html)
  - Users: /admin/users, /admin/users/new, /admin/users/:id (listing, create, detail)
  - Groups: /admin/groups, /admin/groups/new, /admin/groups/:id, /admin/groups/:id/user/:userId
  - Channels: /admin/channels, /admin/channels/new, /admin/channels/:id, /admin/channels/:id/user/:userId
  - Dev: /admin/dev (stats + truncate)
- Role selection
  - Add Member lists (group/channel) show only space_* roles
  - Per-user role editors for group/channel show only space_* roles
  - User detail now shows “Site Roles” with only site_* roles
- Moderation
  - /admin/users/:id: toggle global review hold; apply/revoke posting suspensions (site-wide or per-space) with 1/7/30 day durations and reason

Comments Policy
- DB
  - users.default_comments_enabled (default ON)
  - space_publications.comments_enabled
  - spaces.settings.comments: 'on' | 'off' | 'inherit'
- Admin
  - Group/Channel pages expose Comments Policy; saved via PUT /api/admin/spaces/:id
- Publish behavior
  - New space_publications set comments_enabled based on space policy; if 'off' → disabled; otherwise takes user’s default

Database & EnsureSchema (src/db.ts)
- uploads: modified_filename (TEXT), description (TEXT)
- suspensions: table for posting suspensions (global or per-space)
- users: deleted_at, credibility_score, require_review_global, default_comments_enabled
- space_publications: comments_enabled
- roles/permissions tables extended by migration script (scope, space_type)

Uploads & Frontend Adjustments
- Signing accepts modifiedFilename + description; stored at upload creation (src/routes/signing.ts)
- /uploads
  - Listing shows modified_filename (link) and description under title
  - Layout consolidated (Video + Details), responsive card layout
  - Link to Upload Files → /uploads/new
- /uploads/new (frontend/src/app/UploadNew.tsx): file picker, modified filename, description, progress, and status

Productions & Job Polling
- Enhanced MediaConvert poller (src/server.ts): tracks both uploads and productions, updates statuses (queued/processing/completed/failed) per job id

Admin API (selected endpoints)
- GET /api/admin/roles → id,name,scope,spaceType
- Users: GET/POST/PUT/DELETE /api/admin/users, /api/admin/users/:id
- Site roles: GET/PUT /api/admin/users/:id/roles
- Memberships: GET /api/admin/users/:id/spaces (normalized roles)
- Moderation: GET/PUT /api/admin/users/:id/moderation; POST/DELETE /api/admin/users/:id/suspensions
- Spaces: GET/PUT /api/admin/spaces/:id (supports commentsPolicy + name); members/invitations endpoints reused
- Dev: GET /api/admin/dev/stats; POST /api/admin/dev/truncate-content

Docs to Consult Next
- docs/RolesPermissions.md
  - Strategy, permission dictionary, role bundles, policy rules, decisions
- docs/RBAC_Implementation_Plan.md
  - M1–M6 milestones, DB changes, seeds, can() semantics, comments policy, invitations tokens, test and rollout plan

Known Gaps / Next Steps (high value)
1) RBAC data cleanup (optional hardening)
   - Backfill user_space_roles to canonical space_* role ids (we normalize on read now; can migrate in DB if desired)
   - Optionally delete legacy roles (admin/moderator/publisher/member/viewer/subscriber/uploader, group_*, channel_*) once you’re confident nothing references them
2) Comments UX
   - Add per-post toggle where allowed; add Account Settings page for users to set default_comments_enabled
3) Invites (hidden spaces)
   - Implement token + expiry on invitations and minimal landing page (M4 item)
4) can() coverage
   - Add unit tests for common permutations, including any-space moderation, suspensions, and own-actions
5) Credibility
   - Expose adjust controls and audit log UI (data field exists)
6) Subscriptions (M6)
   - Enforce gating for subscriber-only content and polish related admin flows

Quick Test Notes
- Upload → produce → publish to space works; comments_enabled defaults applied
- /api/me: roles only site_*; spaceRoles only space_* and ordered
- Admin
  - Users: prefill works; site roles manageable; moderation toggles work
  - Groups/Channels: name/comments policy prefill and save; members listing; add member with space_* roles; per-user space roles edit shows only space_* roles
  - Dev Tools: stats and truncate operational

