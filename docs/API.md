# API

## Native sessions and viewer API

Enable native sessions explicitly with `NATIVE_SESSIONS_ENABLED=1`. Existing browser session cookies remain unchanged. Native tokens authorize only the native-session and viewer routes below; legacy admin, upload, and payment routes do not accept them as user sessions.

- `POST /api/native/v1/session` — JSON `{ email, password }`, no ambient credentials. Returns 201 `{ token, expiresAt, viewer: { id, displayName } }`, no cookies. Thirty-day absolute lifetime, no sliding renewal. Database-backed limits: 10 attempts/account and 30/client IP per 15 minutes; 429 includes Retry-After.
- `GET /api/native/v1/session` — native bearer required; returns `{ expiresAt, viewer }`, never echoes the token.
- `DELETE /api/native/v1/session` — revokes the current native bearer; 204 is idempotent for well-formed unknown/revoked tokens. Does not log out browser sessions.
- `GET /api/viewer/v1/feed/global?limit=20&cursor=...` — anonymous or viewer-authenticated Global feed.
- `GET /api/viewer/v1/me/spaces` — authenticated `{ personal, groups, channels }`, filtered through current access rules. Global is a separate navigation choice.
- `GET /api/viewer/v1/spaces/:id/feed?limit=20&cursor=...` — authenticated and authorized on every page.

Viewer reads accept either a native bearer or a browser sid cookie. Supplying both returns 400 ambiguous_auth. Invalid supplied credentials return 401 rather than silently falling back to anonymous. Session-store failure returns 503. All new responses use Cache-Control: no-store.

Feed responses are `{ context, items, nextCursor }`. Context is `{ kind: 'global' }` or `{ kind: 'space', space: { id, ulid, name, slug, type } }`. Items allowlist publicationId, uploadId, productionUlid, spaceId, playbackUrl, posterUrl, creator `{ id, displayName, avatarUrl }`, description, width, height, durationSeconds, hasStory, storyPreview (up to 200 characters), and hasCaptions. Creator email, storage keys, filenames, job fields, and moderation internals are excluded. Legacy feed payloads have not migrated to this minimized contract.

Limits are integers 1–100; cursors remain opaque timestamp/ID strings and must be URL encoded. Invalid queries return 400 invalid_query. Missing spaces return 404 space_not_found; denied spaces return 403 forbidden without media URLs. Shared space feeds now exclude visible_in_space=0 and restrict members-only publications to owners, members, active subscribers, and authorized site administrators. Global selection excludes members-only publications.

Native transport requires HTTPS. Only a configured loopback reverse proxy (`NATIVE_TRUST_LOOPBACK_PROXY=1`) may supply forwarded TLS and client IP; the final appended client address is used. `NATIVE_ALLOW_INSECURE_LOOPBACK=1` permits direct loopback development checks and must remain disabled for deployed access. No CORS wildcard is needed.

Native sessions store token and current-password-hash digests. Expiry, revocation, deleted accounts, or a changed password invalidate credentials. Feed API authorization does not protect copied public HLS URLs. Current fixtures reuse public Global media; confidential-media delivery is separate scope.

Native client installation, Metro/dev-client startup and EAS signing are documented in [mobile setup](../mobile/README.md). Native credentials are stored through SecureStore; offline sign-out removes local access before best-effort server revocation. Fixture and sequential API/browser regression commands are in [repository setup](../README.md). Native development-build acceptance is complete in [Plan 168](../agents/implementation/plan_168.md), including device access denial/restoration and expired-session recovery. VoiceOver is deferred and the plan retains the other acceptance limits.

## Existing browser API

Auth: cookie session in development (httpOnly `sid` + `csrf` cookie). `x-admin-token` still allowed for automation.

- GET /health → { ok: true }
- GET /api/me → `{ userId, email, displayName, roles, spaceRoles, personalSpace }`
- POST /api/login { email, password } → `{ ok, userId }` (+ sets `sid`/`csrf` cookies)
- GET /logout → HTML (revokes session, clears cookies)
- POST /api/register { email, password, displayName?, phone? } → `{ ok, userId, space }`
- POST /api/sign-upload { filename, contentType?, sizeBytes?, width?, height?, durationSeconds? }
  - → { id, key, bucket, post: { url, fields } }
- POST /api/mark-complete { id, etag?, sizeBytes? } → { ok: true }
- GET /api/uploads?limit=50[&status=uploaded] → UploadRow[]
- GET /api/uploads/:id → UploadRow with cdn_master/s3_master
- GET /api/profiles → { profiles: string[] }
- POST /api/publish { id, profile?, quality?, sound? }
  - profile: name under jobs/profiles (omit to auto-select by orientation)
  - quality: "standard" | "hq"
  - sound: "original" | "normalize"

Pages / Docs APIs
- GET /api/pages
  - Returns root page tree listing (visible nodes only), with section/document metadata.
- GET /api/pages/:path
  - Resolves a page node by hierarchical path traversal (`parent_id` + slug segments).
  - Returns node content + child listing when children exist.
- Visibility filtering for both endpoints:
  - `public`
  - `authenticated`
  - `space_moderator`
  - `space_admin`
  - Response is filtered by current user/session permissions.

Admin Pages (Site Admin)
- GET /admin/pages
  - Hierarchical manager view (root + nested cards), including sibling ordering controls.
- GET /admin/pages/new
  - Create node with:
    - `type` (`section` or `document`)
    - optional `parentId`
    - `sortOrder`
    - `slug` (segment)
- POST /admin/pages
  - Creates node; enforces parent/type/slug constraints.
- GET /admin/pages/:id
  - Edit node.
- POST /admin/pages/:id
  - Updates node and allows reparenting with cycle checks.
- POST /admin/pages/:id/move-up
- POST /admin/pages/:id/move-down
  - Swaps `sort_order` with adjacent sibling.

UploadRow (selected fields)
- id, s3_bucket, s3_key, original_filename, content_type, size_bytes
- width, height, duration_seconds
- status, etag, mediaconvert_job_id, output_prefix, profile, asset_uuid, date_ymd
- cdn_prefix, cdn_master, s3_master (computed)

Creator viewing and original-feed return

- `GET /api/viewer/v1/creators/:userId` accepts optional viewer authentication and returns `{ creator: { id, displayName, handle, avatarUrl, bio }, personalEntry }`. Existing active users have nominal identity even without a public profile. Hidden profile fields are omitted through null optional values; public bio also requires `show_bio`. Missing/deleted users return 404.
- `personalEntry` is `{ state: "sign_in_required" }` for anonymous viewing, `{ state: "unavailable" }` for a missing/denied personal destination, or `{ state: "allowed", space: { id, ulid, name, slug, type: "personal" } }`. Only allowed viewers receive destination metadata. Entry does not create a space or relationship.
- Personal feeds require sign-in and explicit owner/member/site-admin authority, after current bans. Public flags, following and subscriptions alone do not grant personal access. This shared rule applies to existing browser and native feed routes; group/channel rules remain as before.
- Viewer feed GETs accept `anchorPublicationId` instead of `cursor` to obtain a fresh authorized window around an exact publication. Use `limit=60` for native return. The normal envelope adds `resume: { requestedPublicationId, restoredPublicationId, outcome: "restored" | "unavailable" }`. A missing/hidden/wrong-context anchor returns a fresh first page and null restored ID; denied spaces still return an error-only 403/404. Normal cursor responses are unchanged.
- The bounded window includes nearby newer rows and continues forward through the normal `nextCursor`. Publication ID plus context is the restore identity; matching upload/production IDs cannot restore another space's publication. Creator/anchored reads use no-store, validate supplied credentials, and send sanitized retryable 503 errors on backend failure.


Native publication stories and captions

- `GET /api/viewer/v1/feed/global/publications/:publicationId/story` and `/captions.vtt` accept optional viewer identity and require the exact publication to remain eligible for Global.
- `GET /api/viewer/v1/spaces/:spaceId/publications/:publicationId/story` and `/captions.vtt` require viewer identity, current space permission, and exact-publication eligibility in that space.
- Stories return `{ context: { kind: "global" } | { kind: "space", spaceId }, publicationId, storyText }`. Text is the effective publication-specific story (nullable, at most 2,000 characters), not a fallback to the production default. Anonymous Global full-story reads are supported by these viewer routes.
- Caption success is bounded `text/vtt; charset=utf-8`, at most 1 MiB, read from the selected publication's ready production captions. No upload-library transcript fallback or S3 redirect. All responses use `Cache-Control: no-store`.
- Malformed IDs return 400 `invalid_query`; current space denial returns 403 `forbidden`; an ineligible/missing exact publication returns 404 `publication_not_found`; an eligible publication without a ready transcript returns 404 `captions_not_found`. Retryable object/size/encoding failures return 503 `captions_unavailable`; invalid stored stories return 503 `story_unavailable`. Resource absence does not mean that sign-in or feed access is lost.
- Authorization is checked before text/object retrieval and again before response. No storage pointers, transcript IDs or content appear in errors. Legacy browser publication story/caption URLs retain their existing contracts and are not native-token endpoints.
