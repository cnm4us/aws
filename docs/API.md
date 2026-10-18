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

Feed responses are `{ context, items, nextCursor }`. Context is `{ kind: 'global' }` or `{ kind: 'space', space: { id, ulid, name, slug, type } }`. Items allowlist publicationId, uploadId, productionUlid, spaceId, playbackUrl, posterUrl, creator `{ id, displayName, avatarUrl }`, description, width, height, and durationSeconds. Creator email, storage keys, filenames, job fields, and moderation internals are excluded. Legacy feed payloads have not migrated to this minimized contract.

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
