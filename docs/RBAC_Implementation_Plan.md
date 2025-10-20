RBAC Implementation Plan
Last updated: 2025-10-20

Purpose
Translate decisions in RolesPermissions.md into incremental, testable changes. Each milestone should be shippable and low‑risk.

Milestones

M0 — Terminology, Scopes, Profiles (Agreed)
- Confirm single space model with profiles: group‑like and channel‑like (done).
- Confirm scopes: site vs space (done).
- Roles: publisher folded into moderator at both scopes (done).

M1 — Permission Dictionary + Seeds
- Define final permission keys and descriptions (site vs space scope) matching the dictionary in RolesPermissions.md.
- DB: add `permissions.scope` (ENUM('site','space') or VARCHAR) for clarity.
- Seed permissions idempotently.
- Acceptance: can() registry recognizes all new actions; no behavior change yet.

Permission Keys (canonical)
- Site scope
  - feed:publish_global, feed:moderate_global, feed:hold_member_global
  - moderation:credibility_adjust, moderation:suspend_posting (site), moderation:ban (site)
  - video:upload, video:produce, video:edit_own, video:delete_own, video:publish_own, video:unpublish_own
  - video:delete_any (optional for site_admin only)
  - space:create_group, space:create_channel (profile creators)
- Space scope (requires spaceId unless held by site_moderator/admin performing any‑space duties)
  - space:manage, space:settings_update, space:assign_roles, space:invite, space:kick
  - space:view_private, space:view_hidden (moderation/admin only)
  - space:post (aka video:post_space)
  - video:review_space, video:approve_space, video:publish_space, video:unpublish_space
  - moderation:comment_creator, moderation:suspend_posting (space), moderation:ban (space)
  - comment:create, comment:delete_any, comment:moderate
  - subscription:manage_plans, subscription:view_subscribers, subscription:grant_comp, subscription:gate_content

Migration SQL (permissions.scope)
```
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS scope VARCHAR(16) NOT NULL DEFAULT 'space';
```

Seeding (idempotent pseudo-SQL)
```
INSERT IGNORE INTO permissions (name, scope) VALUES
  ('feed:publish_global','site'),('feed:moderate_global','site'),('feed:hold_member_global','site'),
  ('moderation:credibility_adjust','site'),('moderation:suspend_posting','site'),('moderation:ban','site'),
  ('video:upload','site'),('video:produce','site'),('video:edit_own','site'),('video:delete_own','site'),('video:publish_own','site'),('video:unpublish_own','site'),('video:delete_any','site'),
  ('space:create_group','site'),('space:create_channel','site'),
  ('space:manage','space'),('space:settings_update','space'),('space:assign_roles','space'),('space:invite','space'),('space:kick','space'),('space:view_private','space'),('space:view_hidden','space'),('space:post','space'),
  ('video:review_space','space'),('video:approve_space','space'),('video:publish_space','space'),('video:unpublish_space','space'),
  ('moderation:comment_creator','space'),('moderation:suspend_posting','space'),('moderation:ban','space'),
  ('comment:create','space'),('comment:delete_any','space'),('comment:moderate','space'),
  ('subscription:manage_plans','space'),('subscription:view_subscribers','space'),('subscription:grant_comp','space'),('subscription:gate_content','space');
```

M2 — Role Catalog + Scope Tags
- DB: add `roles.scope` ('site'|'space') and optional `roles.space_type` ('any'|'group'|'channel') columns.
- Seed roles for site and space scopes, including default bundles for both profiles.
- Seed `role_permissions` for bundles (site_admin, site_moderator, space_admin, space_moderator, space_member, space_poster, space_subscriber).
- Update admin UI to filter role checkboxes by scope/type (site vs space; optional space_type).
- Acceptance: admin pages display the right roles in the right context; assignments succeed.

Migration SQL (roles.scope, roles.space_type)
```
ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope VARCHAR(16) NOT NULL DEFAULT 'space';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS space_type VARCHAR(16) NULL;
```

Role Seeds (idempotent)
```
INSERT IGNORE INTO roles (name, scope) VALUES
  ('site_admin','site'),('site_moderator','site'),('site_member','site'),
  ('space_admin','space'),('space_moderator','space'),('space_member','space'),('space_poster','space'),('space_subscriber','space');
```

Role→Permission Bundles (pseudo-SQL)
```
-- site_admin: grant all permissions
-- Alternatively enumerate to maintain principle of least privilege; start with all for simplicity.

-- site_moderator
GRANT site_moderator => feed:publish_global, feed:moderate_global, feed:hold_member_global,
  moderation:comment_creator, moderation:credibility_adjust, moderation:suspend_posting,
  space:view_hidden, comment:moderate, comment:delete_any;

-- site_member
GRANT site_member => video:upload, video:produce, video:edit_own, video:delete_own, video:publish_own, video:unpublish_own, comment:create;

-- space_admin
GRANT space_admin => space:manage, space:settings_update, space:assign_roles, space:invite, space:kick,
  space:view_private, space:view_hidden, video:review_space, video:approve_space, video:publish_space, video:unpublish_space,
  comment:moderate, comment:delete_any,
  subscription:manage_plans, subscription:view_subscribers, subscription:grant_comp, subscription:gate_content;

-- space_moderator
GRANT space_moderator => video:review_space, video:approve_space, video:publish_space, video:unpublish_space,
  moderation:comment_creator, moderation:suspend_posting, comment:moderate, comment:delete_any;

-- space_poster
GRANT space_poster => space:post, comment:create;

-- space_member
GRANT space_member => space:view_private, comment:create;

-- space_subscriber
GRANT space_subscriber => (no additional keys; entitlement enforced by subscription membership + policy). Optionally add 'subscription:consume'.
```

UI Filtering
- /admin/users/:id → show site roles only.
- /admin/{groups|channels}/:id/user/:userId → show space roles only; optionally filter by profile/type.

Compatibility & Cleanup
- Keep legacy role names (group_admin/channel_admin) as UI aliases mapping to space_admin if needed.
- Remove/ignore previous seed roles (viewer, member, subscriber, uploader, contributor, publisher, moderator, group_*, channel_*) once new catalog is live; or provide migration map.

Acceptance Tests
- Assign each role and verify expected can() results for a representative action set (view, post, publish, unpublish, moderate).

M3 — Policy Semantics in can()
- Implement context requirements:
  - Space‑scoped permissions require `spaceId`; otherwise return false unless user has corresponding site‑wide authority.
  - Enforce posting‑only suspensions and membership status before evaluating permissions.
- Add support for per‑user global review hold: members’ personal posts to global become pending when flag is set.
- Acceptance: unit tests for can() cover common cases (owner, member, moderator, admin) and suspension/hold paths.

M4 — Moderation & Workflow Wiring
- Map “post” and “publish” to space_publications statuses:
  - Post → draft/pending or published depending on space policy.
  - Approve/Publish → published.
  - Unpublish → unpublished (no asset deletion).
- UI: clarify labels (member sees Post; moderators see Approve/Publish/Unpublish).
- Acceptance: e2e happy path for personal → production → post → approve/publish → unpublish.
 - Cross-post governance: ensure space_moderator/admin can unpublish within their space, even if not the content owner.
 - Hidden invite landing: implement minimal landing page for hidden spaces invite links (no content preview) with accept path.
 - Invitations: generate deep‑link tokens with expiry and single‑use acceptance.

M5 — Suspensions & Credibility (Data + UI)
- DB: add `suspensions` table (id, user_id, target_type site|space, target_id NULLable, kind posting, degree 1|2|3, starts_at, ends_at, reason, created_by, created_at).
- DB: add `users.credibility_score` (or `user_credibility` table) and `credibility_log` (id, user_id, delta, reason, moderator_id, created_at).
- Admin UI: add controls for site/space moderators to apply suspensions; adjust credibility; audit views.
- can(): check active suspensions and deny posting accordingly.
- Acceptance: apply suspension; posting is blocked; auto‑restore after ends_at.

M5b — Comments Policy & Controls
- DB:
  - users: add `default_comments_enabled` TINYINT(1) DEFAULT 1.
  - space_publications: add `comments_enabled` TINYINT(1) NULL (null = inherit when applicable).
  - spaces.settings: add `comments` policy key: off|on|inherit.
- UI:
  - User settings: toggle default comments for global/personal posts.
  - Post flow: show per-post comments switch when space policy = on.
  - Space admin: toggle comments policy for the space.
- Enforcement:
  - If space policy = off, hide per-post toggle and disable comments for all publications in that space.
  - If on, honor per-post setting.
  - For global feed, use user default and allow per-post override.
- Acceptance: comments availability matches policy precedence; moderator tools can still remove/lock comments.

M6 — Subscriptions & Visibility (If needed)
- Keep subscriptions in `space_subscriptions`; add permission gates for `space_subscriber` to view gated content; wire visibility settings: public/private/hidden.
- Hidden spaces: invitation landing page with accept.
- Acceptance: subscriber‑only content is gated; invite flows work for hidden spaces.

DB Changes (draft)
- roles: add `scope` VARCHAR(16) NOT NULL DEFAULT 'space'; add `space_type` VARCHAR(16) NULL.
- permissions: add `scope` VARCHAR(16) NOT NULL DEFAULT 'space'.
- user_space_roles: add `status` ENUM('active','suspended','banned') DEFAULT 'active'.
- users: add `credibility_score` INT DEFAULT 0; add `require_review_global` TINYINT(1) DEFAULT 0.
- suspensions (new table) as per M5.
- users: add `default_comments_enabled` TINYINT(1) DEFAULT 1.
- space_publications: add `comments_enabled` TINYINT(1) NULL.
- space_invitations: add `token` VARCHAR(96) UNIQUE NOT NULL, `expires_at` DATETIME NULL, `accepted_at` DATETIME NULL.

Optional Truncate & Reseed (Dev)
- Scripts provided:
  - `ts-node scripts/rbac/truncate-dev.ts --yes` (or dry-run without `--yes`).
  - `ts-node scripts/rbac/migrate-rbac.ts` (use `--dry` to preview SQL).
- Sequence (dev only):
  1) Run truncate (optional) to clear content rows.
  2) Run RBAC migrate to add columns (if missing) and seed permissions/roles/bundles.
  3) Restart server to pick up policy/seeded roles.

Admin UI Changes (draft)
- Role selection filters by scope/type; site roles only on /admin/users/:id; space roles on /admin/{groups|channels}/:id/user/:userId.
- Moderation tools: apply suspension (site or space), adjust credibility, comments to creator, global review hold toggle.
- Publishing workflows: members post; moderators approve/publish/unpublish.

Testing & Rollout
- Unit tests for can() permutations by role, status, suspension, and profile.
- Seed validation script to ensure role→permission integrity.
- Feature flags for: new can() semantics, suspensions enforcement, global hold.
- Staged rollout: enable new semantics in admin first; then broaden.

Optional — Fresh Reset & Reseed (development convenience)
- Since dataset is small, you may truncate content tables and reseed RBAC to reduce migration complexity during M1/M2.
- Provide a script to:
  - Truncate uploads, publications, productions (if acceptable), and related audit entries.
  - Recreate/seed roles, permissions, and role_permissions according to the new catalog.
  - This step is optional and only for non‑prod environments.

Risks & Mitigations
- Ambiguous role names across scopes → solve with `roles.scope` and UI filtering.
- Overreach of site_moderator → define exact permissions and log moderation actions (action_log already exists).
- Hidden space leaks → invitation landing should not reveal content before acceptance.

Open Items to Clarify (blockers for final M1/M2 seeds)
- Final list of permission keys (dictionary) and their scope mapping.
- Whether to use generic role names in DB (space_admin) and render profile‑specific labels in UI, or store both variations.
- Where to store comment‑moderation features (permission keys and UI locations).
