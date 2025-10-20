Last updated: 2025-10-20

Change Summary
- Confirmed single “space” model; “group” vs “channel” are profiles (defaults), not different data models.
- Subscriptions are a configuration/policy difference, not a hard type.
- Scopes approved: site roles (global) and space roles (per-space).
- Publisher responsibilities folded into Moderator at both site and space scope.
- Clarified posting/producing/publishing lifecycle and hidden space invite behavior.
- Defined credibility as global; suspensions can be global or per-space and apply to posting only.
// 2025-10-20 additions
- Hidden+invite: minimal landing page only, no content preview prior to acceptance.
- UI terminology: members “Post”; moderators “Approve/Publish/Unpublish”.
- Cross-post: space moderators may unpublish within their space even if not the owner.
- Global review hold: per-user boolean is sufficient.
- Credibility: manual adjustments only for now (no automated throttling yet).
- Comments policy clarified with precedence (see Policy Rules).
Maintain two scopes of roles:
Site roles in user_roles for global authority.
Space roles in user_space_roles for per-space authority.
Do not overlap semantics between site and space roles; instead, site roles may include “any-space” permissions where needed (e.g., site_moderator can unpublish anywhere).
Profiles (Defaults, Not Data Types)

Keep spaces table (you already have space_* tables). Use spaces.settings.profile = 'group'|'channel' to seed default:
Visibility, posting policy, review policy, subscription mode, default member roles, default admin roles.
A “group” profile: informal defaults (members can post; review off by default; subscriptions disabled).
A “channel” profile: formal defaults (members read-only by default; review on; subscriptions enabled).
Any space can later flip policies to behave like the other profile; the model stays unified.
Role Scopes

Site roles (user_roles):
- site_admin: all site+space permissions (superuser).
- site_moderator: can review/approve/publish/unpublish anywhere (global + any space), comment to creator, adjust credibility, moderate global feeds. (Publisher folded into moderator.)
- site_member: baseline access to global/public content.
Space roles (user_space_roles), applied to any space; defaults differ by profile:
- space_admin (aka group_admin/channel_admin in UI): manage settings, roles, invites, moderation, publishing.
- space_moderator: moderate content (review/approve/publish/unpublish), comment to creator, adjust credibility, suspend posting (not viewing).
- space_poster: post/upload to the space.
- space_member: view standard content.
- space_subscriber: view subscription‑only content (when subscriptions enabled).

Notes:
- “Publisher” authority is folded into the moderator role at both scopes.
- Moderators may approve/publish content they do not own (site moderators anywhere; space moderators within that space).
Tip: You can keep type-specific names in UI (group_admin, channel_admin) while storing a generic role id with a roles.space_type filter to drive checkboxes.

Permission Dictionary (initial)

Space management: space:manage, space:assign_roles, space:invite, space:settings_update, space:view_hidden, space:view_private.
Content lifecycle: video:upload_space, video:produce, video:post_space, video:review_space, video:approve_space, video:publish_space, video:unpublish_space, video:delete_any, video:delete_own, video:edit_metadata.
Moderation: moderation:comment_creator, moderation:credibility_adjust, moderation:suspend_posting, moderation:ban.
Comments: comment:create, comment:delete_any, comment:moderate.
Subscriptions (channel feature): subscription:manage_plans, subscription:view_subscribers, subscription:grant_comp, subscription:gate_content.
Streaming (if applicable): stream:start, stream:stop, stream:moderate_chat, channel:schedule.
Discovery/global: space:list, feed:publish_global, feed:moderate_global, feed:hold_member_global (flag member’s global posts for review).
These are granular; roles are just bundles of these permissions.

Data Model Tweaks (lightweight)

In roles: add scope = 'site'|'space' and optionally space_type = 'any'|'group'|'channel' (or just a profile tag) to filter role options cleanly in admin.
In permissions: add scope = 'site'|'space' and an optional feature tag (e.g., 'subscription', 'streaming') to help UI and policy checks.
In user_space_roles: add status (active|suspended|banned) to support moderation actions without removing role rows.
Add suspensions table to track posting suspensions (global or space‑scoped) with degree (1,2,3) and auto‑computed end time.
Add user_credibility (or extend users) to store global credibility_score; add credibility_log for auditability.
Add per‑user flag for global publishing hold (e.g., users.require_review_global boolean) to route their posts to review in global feeds.

Comments policy:
- Add `users.default_comments_enabled` (boolean) to support personal/global default.
- Add `spaces.settings.comments` policy: `off` | `on` | `inherit` (default per profile: group on, channel on; global inherits user).
- Add `space_publications.comments_enabled` (boolean) so a poster can toggle per-post when space policy allows.
Keep all space_* tables generic (invitations, publications, subscriptions, follows).
Policy Evaluation

Keep can(userId, action, { spaceId?, ownerId? }).
Require spaceId for space‑scoped permissions; otherwise return false unless the user has an “any-space” site permission (e.g., site_moderator).
Check suspensions first (posting only; never block viewing per current policy).
If a permission is flagged subscription-only or channel-only, check the space’s settings/profile.
Honor membership status (suspended/banned) before role evaluation.
Cache effective permissions per request for (userId, spaceId) to keep checks fast.
Migration Approach

Do not drop “group” immediately — mark it as a profile. Begin treating both as the same model with profile defaults.
Unify role names internally (or tag them with scope and space_type) and update admin UI to filter by scope/type. Keep existing role ids to avoid data churn; mapping tables can translate old names to new display labels.
Phase out any channel-specific role tables (you’ve already removed user_channel_roles) and stop creating more.
Open Clarifications

Resolved Decisions
- Publisher folded into Moderator at both scopes.
- Moderators can approve/publish content they do not own, but only within the target scope (site_moderator anywhere; space_moderator within that space).
- Members upload to their personal space; can produce multiple Productions; can post a Production to spaces where they have permission.
- Personal space: posting auto‑publishes to global feeds unless the member is on a global review hold.
- Spaces with review required: member posts create a pending entry; moderators approve/publish; unpublish removes from that space only (no asset deletion).
- Hidden spaces: invitations allow the recipient to reach a landing page and accept/follow (visibility via invite link prior to acceptance); public listing remains hidden to others.
- Credibility: global. Moderators can adjust; requires audit log.
- Suspensions: apply to posting only (not viewing); can be per‑space or global; degrees 1/2/3 with durations 1/7/30 days; configurable.
- Global feed: site_admins and site_moderators can moderate/publish; site_moderators also act as global publishers.
 - Post vs publish: member UI shows “Post”; moderators/admins see “Approve/Publish/Unpublish”.
 - Hidden spaces: invitation landing shows minimal info; no content preview before acceptance.
 - Comments precedence: see below.

Policy Rules (refined)
- Posting vs Publishing
  - Members upload to personal space and can produce one or more Productions.
  - Post to a space creates a space_publication in `draft/pending` or `published` depending on space policy.
  - Moderators/Admins can Approve/Publish or Unpublish. Unpublish removes from that space only (no asset deletion).
- Hidden Spaces
  - Hidden spaces are not discoverable. Invitations allow a recipient to reach a minimal landing and accept; content remains hidden until acceptance.
  - Invites are delivered as deep links containing a token; tokens expire and are one‑time use. After acceptance, normal access applies.
- Viewing Rules
  - Public: site_member can view.
  - Private: requires space_member.
  - Hidden: requires invitation acceptance (becoming space_member) or moderator/admin.
  - Subscriber content: requires space_subscriber when subscriptions enabled.
- Comments Precedence
  1) Space policy gate: if a space sets comments = off, no member can enable comments for posts in that space.
  2) If space policy = on (default for both group‑like and channel‑like profiles), a poster may toggle comments per publication (space_publications.comments_enabled).
  3) For the global feed (personal posts to global), members can set a personal account default (users.default_comments_enabled) in Account Settings and override per video; global moderation may still remove comments.
  4) Site/space moderators retain comment moderation rights (remove/lock).

Account Settings
- Provide a user account settings page with at least:
  - Default comments setting for global/personal posts (users.default_comments_enabled).
  - Optional privacy controls (future), and the per‑user global review hold flag (users.require_review_global) visible to site_moderator/admin only.

Open Questions / Potential Ambiguities
- Hidden + invite visibility: Should the invitee see any content previews before acceptance, or only a minimal acceptance page? We suggest “minimal info + accept to view”.
- Post vs publish terminology in UI: do we expose both terms to users, or keep “post” for members and “publish” for moderators/admins?
- Cross‑posting governance: who can unpublish from a space where they are not the owner but have moderator/admin? (Proposed: space_moderator/admin of that space can unpublish; owners cannot override moderators.)
- Global review hold: per‑user boolean ok, or do we need a per‑space flag for “global‑like” hubs? (Proposed: start with per‑user boolean only.)
- Credibility effects: beyond manual adjustments, do we apply automated throttling (e.g., cool‑downs) based on score thresholds?
- Comments: Allowed everywhere by default? Who can disable per video or space policy? (Recommend space policy with per‑video override.)

Decision Log
- 2025-10-20: Single space model confirmed; subscriptions are configuration; publisher folded into moderator; global credibility; posting‑only suspensions (global or per space); hidden spaces invite behavior clarified; global feed moderation by site_admin/moderator; per‑user global review hold added.
- 2025-10-20: Defaults confirmed: comments ON for both profiles; account settings will expose default comments toggle; hidden invites will use expiring deep‑link tokens; `users.require_review_global` approved for global hold.

Permission Dictionary (detailed)
Scope legend: [S] site, [P] space (requires spaceId unless noted). “Any‑space” application implies site_moderator/site_admin authority.

- space:manage [P] Administer space settings (name, policy), delete/unarchive space.
- space:settings_update [P] Update policy toggles (comments, visibility, review required, subscriptions).
- space:assign_roles [P] Assign/remove space roles for members.
- space:invite [P] Send invites (hidden/public/private) with token; revoke invites.
- space:kick [P] Remove member from space.
- space:view_private [P] View private space content.
- space:view_hidden [P] View hidden space + metadata without invite (moderators/admins only).
- space:post [P] Create a post (space_publication) for a Production into the space; respects review policy.
- space:create_group [S] Create a space with group‑like defaults (profile=group). (Kept for compatibility; becomes profile=create:group.)
- space:create_channel [S] Create a space with channel‑like defaults (profile=channel). (Kept for compatibility.)

- video:upload [S] Upload media (to personal space).
- video:produce [S] Create Productions from an Upload (transcode, title page, lower thirds, etc.).
- video:edit_own [S] Edit own uploads/productions metadata.
- video:delete_own [S] Delete own uploads (subject to policy), never implicit asset deletion on unpublish.
- video:delete_any [S] Delete any upload/production (site_admin only typically).
- video:post_space [P] Alias of space:post (use space:post going forward).
- video:review_space [P] Review pending posts in a space.
- video:approve_space [P] Approve a pending post in a space.
- video:publish_space [P] Publish a post in a space (may be same step as approve).
- video:unpublish_space [P] Unpublish a post from a space.
- video:publish_own [S] Publish to own personal/global context when no review is required.
- video:unpublish_own [S] Unpublish own posts from own contexts.

- moderation:comment_creator [S/P] Leave moderator comment to creator visible in review context.
- moderation:credibility_adjust [S] Adjust global credibility_score (with audit log).
- moderation:suspend_posting [S/P] Apply posting suspension (global or per space).
- moderation:ban [S/P] Hard ban (rare; typically site_admin only).

- comment:create [S/P] Create comments (respecting space/global toggles and per‑post setting).
- comment:delete_any [S/P] Delete comments (moderation).
- comment:moderate [S/P] Lock/disable comments threads.

- subscription:manage_plans [P] Manage subscription plans for a space (when enabled).
- subscription:view_subscribers [P] View subscriber list and entitlements.
- subscription:grant_comp [P] Grant complimentary access.
- subscription:gate_content [P] Mark publications as subscriber‑only.

- feed:publish_global [S] Publish/approve to global feeds (any‑space context for site_moderator/admin).
- feed:moderate_global [S] Moderate global feeds (remove/unpublish).
- feed:hold_member_global [S] Place member on global review hold (users.require_review_global).

Role Bundles (initial mapping)
Note: bundles are seeds; assignments can be customized later. Publisher powers are folded into Moderator roles.

- site_admin (site scope)
  - All permissions.

- site_moderator (site scope)
  - feed:publish_global, feed:moderate_global, feed:hold_member_global
  - moderation:comment_creator, moderation:credibility_adjust, moderation:suspend_posting
  - video:delete_any (optional; can be restricted to site_admin if preferred)
  - space:view_hidden (for investigation)

- site_member (site scope)
  - video:upload, video:produce, video:edit_own, video:delete_own
  - video:publish_own, video:unpublish_own (subject to global hold)
  - comment:create

- space_admin (space scope)
  - space:manage, space:settings_update, space:assign_roles, space:invite, space:kick
  - space:view_private, space:view_hidden (within their space context)
  - video:review_space, video:approve_space, video:publish_space, video:unpublish_space
  - comment:moderate, comment:delete_any
  - subscription:manage_plans, subscription:view_subscribers, subscription:grant_comp, subscription:gate_content (when enabled)

- space_moderator (space scope)
  - video:review_space, video:approve_space, video:publish_space, video:unpublish_space
  - moderation:comment_creator
  - moderation:suspend_posting (space‑scoped)
  - comment:moderate, comment:delete_any

- space_poster (space scope)
  - space:post (aka video:post_space)
  - comment:create

- space_member (space scope)
  - space:view_private
  - comment:create (when allowed by space policy)

- space_subscriber (space scope)
  - space_member
  - View subscriber‑only content (enforced by policy; no extra key required, or add subscription:consume if you prefer explicitness)

Profile Defaults (at space creation)
- Group‑like profile
  - Visibility: public (or private by org policy)
  - Review: off
  - Subscriptions: disabled
  - Comments: on
  - Default roles: creator/admin gets space_admin; joiners get space_member + space_poster

- Channel‑like profile
  - Visibility: public | private | hidden (admin chooses)
  - Review: on
  - Subscriptions: enabled
  - Comments: on
  - Default roles: creator/admin gets space_admin; joiners get space_member only (no posting); moderators can be assigned

A concrete roles→permissions matrix for site and space profiles (group-like vs channel-like defaults).
Minimal schema changes and updates to your seedRbac and can() to enforce the new shape.
Admin UI filtering of role checkboxes (by scope, space_type, and feature flags like “subscription”).
