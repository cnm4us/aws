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

## Global launch destinations

Authenticated viewer reads (native bearer or browser cookie, never both) use `Cache-Control: no-store`:

- `GET /api/viewer/v1/feed/global/publications/:publicationId/spaces?limit=20&cursor=...` returns `{ sourcePublicationId, productionUlid, creator: { id, displayName, avatarUrl, bio }, items: [{ space: { id, name, type, description }, publicationId }], nextCursor }`. Limit1–50, default20; cursor is opaque and scoped to source/viewer. Only currently viewable group/channel publications of the source production **and displayed upload creator** appear, including the source's own group/channel when eligible. Personal and Global aliases are excluded. No mapped production yields an empty list.
- `GET /api/viewer/v1/feed/global/publications/:publicationId/spaces/:spaceId` resolves the chosen destination again and returns `{ sourcePublicationId, productionUlid, creator: { id, displayName, avatarUrl, bio }, space: { id, name, type, description }, publicationId }`. It accepts no query parameters. The destination publication ID can equal or differ from the source ID; context remains distinct.

Both verify exact current Global source eligibility and destination space/publication eligibility, including the same displayed upload creator rather than space owner or publisher. Public creator avatar/bio obey the existing profile visibility/show-bio projection; missing/deleted source creator is unavailable. Source creator changes invalidate the native chooser intent. The nullable space description is a bounded plain-text introduction, never raw settings or an inferred moderation policy. Hidden destinations, engagement fields, media URLs, settings and private identities are omitted. Invalid queries/cursors return400 `invalid_query`; missing/ineligible source404 `publication_not_found`; absent/inaccessible destination404 `launch_target_unavailable`; missing auth401; service/scan budget failure503. Candidate work is serial in batches of50, capped at5000 scanned rows/10 seconds, returning explicit503 rather than false exhaustion. Final target access and source are checked again; responses are snapshots, not reusable access capabilities. Native must still use the authorized destination feed and reject a missing/mismatched anchor before playback. Existing legacy browser Jump is unchanged and does not accept native bearer credentials.

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

### Contextual viewer engagement

Authenticated, no-store engagement lives under `/api/viewer/v1/spaces/:spaceId/publications/:publicationId`: GET `/engagement`, POST/DELETE `/like`, GET/POST `/comments`. Native bearer retains viewer-only scope and HTTPS/mixed-auth rules; cookie unsafe methods retain CSRF protection. There is no Global engagement route. Global alias spaces are rejected; a publication also projected into Global can be engaged only through its explicit eligible space. Personal access still requires explicit authority.

Every operation rechecks space authority and exact published/upload/feed visibility. POST comments also checks current space/publication comments policy, site comment permission and posting suspensions. Disabled commenting preserves reads. Like/unlike and comment creation update rows/counters in one connection/transaction with per-publication serialization; this does not repair historical counter drift.

GET engagement returns exact IDs, `likes:{count,likedByMe}` and `comments:{count,hasCommentedByMe,canComment,disabledReason}`. Comment pages add sanitized top-level `items` and `nextCursor`; rows contain only `id,body,createdAt,author:{id,displayName},isMine`. Counts include visible replies; native top-level presentation must identify that distinction. Query: limit20/default,50/max, order newest/default or oldest, context/user/order-bound opaque cursor. Hidden/deleted content and email fallbacks are excluded. POST comments accepts exact JSON `{body:string}` (trimmed1–2000 UTF-16 code units;16KiB parser bound), returns201 with created row and confirmed comment summary. No native replies/liker directory.

Legacy cookie-only `/api/publications/:id/likes`, `/likes/users`, `/comments` and reply reads now require `?spaceId=...` and use the same shared authority. Browser callers are migrated together. Their comment/liker responses no longer include email; legacy replies require a visible top-level parent in the same publication. Missing/invalid context is400; native bearer headers on these cookie-only engagement routes are rejected. Native comment POST is not idempotent: after a lost response, read/reconcile before an explicit resend; no automatic retry is promised.

### Space introduction authoring

Existing authenticated space-admin GET/PUT `/api/spaces/:id/settings` supports optional `discoveryDescription` for group/channel spaces. PUT accepts a string of at most500 characters or null/empty to clear; invalid types/length return400. Existing space-management permissions and cookie CSRF apply. The field is stored as optional `settings.discoveryDescription` with a JSON merge preserving unrelated settings; the Launch response projects only its nullable text after destination authorization. The existing space settings page provides the bounded introduction field. This does not expose inaccessible spaces or implement joins, payment, age verification or approval.

### Contextual creator Follow

Authenticated GET/POST/DELETE `/api/viewer/v1/spaces/:spaceId/publications/:publicationId/creator-follow` read/set a desired Follow state for the eligible video's displayed upload creator in that group/channel. The target is server-derived, independently checked as nondeleted, and can differ from the publication publisher. All methods require current exact space/publication visibility; Global aliases and personal spaces are rejected. Public non-member group/channel viewers use existing view authority. Follow does not grant membership, subscription or personal-space access and does not filter feeds.

Success200 returns `{space:{id,name,type},publicationId,creatorId,following,followingElsewhere,followersCount,canFollow,disabledReason}`. Counts are scoped to creator+space; different publications by that creator share the relationship. `followingElsewhere` is a boolean for the authenticated caller's existing Follow of this creator in another group/channel, excluding personal spaces and Global aliases. It returns no other-space IDs, names or counts, remains independent of current access to those other spaces and grants no access. Current exact-publication authority still gates the entire response. Self reads return the real count with `following:false,followingElsewhere:false,canFollow:false,disabledReason:'self'`; self writes403 `cannot_follow_self`. Ordinary summaries use `canFollow:true,disabledReason:null`. POST/DELETE are idempotent desired states; writes and summary use one transaction/connection, unique tuple and current authority checks. No follower directory is exposed.

No query/body fields on native methods; canonical positive safe-integer route IDs required. Native keeps HTTPS/bearer/omit-cookie and mixed-auth rules; cookie writes keep CSRF. Responses including legacy auth/CSRF failures are no-store, and errors are sanitized:400 `invalid_query`/`invalid_body`,401 `unauthorized`,403 `forbidden`/`cannot_follow_self`,404 `space_not_found`/`publication_not_found`/`creator_not_found`,503 `service_unavailable`.

Authenticated read-only GET `/api/viewer/v1/feed/global/publications/:publicationId/creator-recognition` returns `{publicationId,creatorId,followingInSpaces}` for the exact eligible Global video's derived upload creator. The boolean describes only the caller's existing group/channel column relationships, excluding personal spaces and Global aliases. No other-space IDs/names/counts or Follow write/capability is exposed. Anonymous401, invalid/extra query/body400, missing/ineligible/retargeted/deleted source or creator404; errors sanitized, all responses no-store. Source/creator are rechecked before reply. Self returns false. Global remains a public discovery feed; this status grants no membership/view rights and introduces no Global Follow relationship.

Legacy cookie-only GET/POST/DELETE `/api/spaces/:spaceId/users/:creatorId/follow` now require `?publicationId=N`, with the path creator matching the eligible feed creator. Successful responses retain `following,followersCount` and add the native context/capability fields. All browser call sites migrate with this tightening; omitted/malformed/repeated/extra context fails. Browser Global/personal feeds issue no contextual Follow requests. After an uncertain write result, refresh/read status before a deliberate new action; there is no automatic queued resend.


### Native viewer access confirmations

Viewer feed responses include additive `access` version1 metadata. Protected space pages bind identity, space and each returned publication/upload/production/creator to a maximum60000ms remaining validity; native session expiry, future applicable bans and subscription-dependent members-only content can shorten it. Clients anchor the budget to their original request start, not response receipt. This metadata supports in-memory presentation reuse; all protected API requests and writes still perform server authorization. It is not an authorization credential.

- GET `/api/viewer/v1/spaces/:id/playback-access?publicationIds=1,2,3` checks at most three unique positive IDs through the regular authorized feed policy. Returns current viewable items/proofs and opaque `unavailable` IDs. Space/session denial retains403/401. Unknown query fields and duplicate/oversized ID lists fail400.
- GET `/api/viewer/v1/feed/global/publications/:publicationId/spaces/:spaceId?include=entry` retains exact source/creator/production checks and adds `entry`, an authorized20-item anchored page with access metadata. The existing no-query response is unchanged.
- Global `publicView` freshness comes from the same anonymous/signed-in public row predicate; identity confirmation is separate. No roles, hidden memberships or subscription records are exported. Responses remain `Cache-Control: no-store`.

Authenticated protected viewer JSON reads/writes also attach identity-only `access` metadata, allowing the native client to avoid a second session preflight. These identity-only confirmations never renew publication playback or grant an action. Follow/count/Comments/story freshness remains independent. Scheduled ban and subscription limits are derived from shared space policy; Global public freshness is independent of account validation. Missing optional captions remain a text outcome rather than a space denial. Existing response fields and no-query Launch calls remain compatible with build23.
