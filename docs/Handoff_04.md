Handoff Summary (Session: 2025-10-21)

Overview
- RBAC + Admin UX: site/space review toggles implemented with precedence; admin pages wired. Role display/assignment normalized to canonical `space_*` roles.
- Feeds: publication‑centric model (no mirroring). Global feed is an aggregator over `space_publications` (not `uploads`).
- Publishing: production‑centric flow added; multiple productions from the same upload can be published as separate items to the same space.
- Media outputs: per‑production ULID paths under each upload UUID to avoid S3 collisions; feeds prefer production outputs.

Data Model
- `space_publications`
  - New: `production_id`, `owner_user_id`, `visible_in_space` (default 1), `visible_in_global` (default 0).
  - Uniqueness: dropped legacy `(upload_id, space_id)`; added unique `(production_id, space_id)`.
  - Indexes: `idx_space_publications_space_feed`, `idx_space_publications_global_feed`, `idx_space_publications_owner_feed`.
  - `distribution_flags` retained as metadata (origin/promotion requests etc.).
- `productions`
  - New: `ulid CHAR(26) UNIQUE` (ULID). Stores per‑production `output_prefix`.

Media/Outputs
- Per‑production output path: `s3://bacs-mc-public-stream/YYYY-MM/DD/{UPLOAD_UUID}/{PRODUCTION_ULID}/(portrait|landscape)/...`.
- Transform tokens in MediaConvert: `DATE_YYYY_MM_DD`, `ASSET_ID` (upload UUID), `PRODUCTION_ULID` (new).
- Job profiles updated to include `PRODUCTION_ULID` in HLS and poster destinations.
- Runner: inserts a production first (ULID), builds settings with tokens, then updates production with job id + `output_prefix`. `uploads.output_prefix` kept for legacy.

APIs (selected)
- Site settings: GET/PUT `/api/admin/site-settings` include `requireGroupReview`, `requireChannelReview`.
- Space settings: PUT `/api/admin/spaces/:id` accepts `requireReview` and returns 400 when site requires review for that type.
- Upload‑centric publish: POST `/api/uploads/:uploadId/publications`, POST `/api/uploads/:id/publish` now set `owner_user_id`/visibility, bind to latest completed production if present; allow multiple publications per space across productions.
- Production‑centric publish: POST `/api/productions/:productionId/publications` (preferred). GET `/api/productions/:productionId/publications` lists that production’s postings (includes publication `id`).
- Feeds: GET `/api/spaces/:id/feed` and `/api/feed/global` LEFT JOIN `productions` and select `COALESCE(p.output_prefix, u.output_prefix)`.
- Dev: POST `/api/admin/dev/truncate-content` clears uploads/productions/publications/events/action_log.

Frontend
- Feed: added “Global” (aggregator) button; legacy “Global Archive” demoted.
- Productions: each production links to `/publish?production=<id>`.
- Publish page: supports production mode; lists/acts only on that production’s postings; unpublish uses production‑scoped publication ids.
- Admin groups/channels list: Delete buttons added (enabled only when no members) → DELETE `/api/spaces/:id`.
- Roles: list displays canonical `space_*`; new assignments use `space_*` defaults.

RBAC/Policy
- Effective review: site type toggle (group/channel) OR space’s `publishing.requireApproval` (channels default ON; groups OFF).
- Visibility flags: `visible_in_space` (space feed), `visible_in_global` (global aggregator). Defaults — personal: both on; group: space only; channel: space only.
- Global moderation/removal for personal posts removes them everywhere (no global‑only moderation for personal). Channel promotion flow TBD.

Admin/Operational Notes
- Personal spaces: publish options include owner’s personal space if it exists; create one for users imported without it.
- CORS: prod origins allowed are `https://aws.bawebtech.com` and `https://videos.bawebtech.com`. In dev, add localhost or allow all when `NODE_ENV !== 'production'`.
- Truncate content: use /admin/dev; does not touch spaces/users.

Known Gaps / Next Steps
1) Channel → Global promotions (admin toggle or request/approve; RBAC: `feed:publish_global`).
2) DELETE space: optionally purge `space_publications` and `space_publication_events` for that space.
3) Ensure personal space lazily in `/api/uploads/:id/publish-options` if missing.
4) One‑time migration to rewrite legacy `group_*`/`channel_*` roles to `space_*`.
5) Tests for can() permutations, status transitions, feed queries, and runner token/ULID formation.

Quick Verify
- Produce two versions from one upload → distinct S3 folders under `{UPLOAD_UUID}/{PRODUCTION_ULID}/`.
- Publish each version to the same personal/group space → both appear in feeds (global only for personal); unpublish via `/publish?production=<id>` removes them.
- Admin groups/channels → Delete enabled only when no members; delete succeeds.
- Site Settings toggles enforce review precedence.

References
- Decisions: `docs/FeedsRBAC_DB.md`
- Feeds Plan: `docs/Feeds_Implementation_Plan.md`
- ULID Outputs Plan: `docs/Production_ULID_Implementation_Plan.md`
