# Plan 168: Signed-in Native Viewing Across Global and Spaces

Status: Complete

Created: 2026-10-18

Implementation authorized and completed on 2026-10-18. Phases A–H are complete for signed-in native Global/Spaces viewing alongside the web client. VoiceOver was deferred at the user's explicit request; high-text-size pill clipping is accepted and recorded. Cancellation races passed controlled actual-component tests; the ~100 ms physical in-flight gesture remains unexercised. The earlier non-reproduced freeze and other evidence limits remain below. TestFlight/public release and later viewer parity are separate scope. Implementation committed as `6cfad70` on 2026-10-18 and pushed to `origin/main` at the user's explicit request; remote HEAD verified against local HEAD.

## Feature Reference

- [Web and native viewing roadmap](../roadmaps/roadmap_native_viewing.md).
- [High-level roadmap artifact](https://chatgpt.com/space/page_7bdd6dd99d048191a8df5747c8374bf8).
- [Accepted native POC, Plan 167](plan_167.md).
- [Context integrity contract](../features/feature_02_personal-space-global-feed-context-integrity.md).
- [Profile and identity direction](../features/feature_01_profile-identity-credibility.md), as background for minimal viewer identity only.
- [Implementation policy](../policies/implementation.md), [testing policy](../policies/testing.md), and [database change policy](../db_access.md).

## Context

The anonymous iPhone POC demonstrates fast vertical video viewing, bounded preloading, sound preferences, and recovery on the recorded iPhone. It has one Global feed screen and deliberately omits application authentication. The next increment must let an existing account sign in and browse its existing spaces while retaining anonymous Global viewing and keeping the web application operational.

The deliverable is an end-to-end viewer milestone: launch anonymously, sign in, choose Global or an accessible personal/group/channel space, paginate and play videos, reopen the app with a validated session, and sign out without retaining another account's content or playback. This does not complete the entire native/web parity roadmap.

### In scope

- Existing-account email/password sign-in, durable native session storage, identity validation, explicit expiry/revocation handling, and sign-out.
- Anonymous Global viewing and signed-in Global viewing through a minimized, versioned viewer API.
- A native space selector listing the viewer's own personal space and existing accessible groups/channels, including existing channel subscriptions.
- A shared native feed screen driven by an explicit Global/space context; pagination, refresh, empty, denied, unavailable, and recovery states.
- Account and context isolation across requests, native players, caches, navigation, and app lifecycle transitions.
- Route-local native authentication, response allowlists, focused API permission tests, and browser regressions.
- Independent iOS development-build configuration and a device acceptance gate, with Expo Go retained while compatible.

### Out of scope

- Registration, password reset, email verification, social login, biometric unlock, and account deletion UI. Existing accounts are provisioned through current supported workflows; release onboarding gets a later plan.
- Broad group/channel discovery, new memberships, invitations, subscription checkout, or viewing other people's personal spaces through new entry flows.
- Profiles as separate screens, stories, app-provided captions, comments, likes, follows, reporting, sharing/deep links, push notifications, downloads, or background/Picture in Picture playback.
- In-feed messages, campaign attribution, production viewing analytics, and changes to ranking or publication scope. Development playback diagnostics remain local.
- Web UI redesign, creator/editor/admin tools on native, a workspace/package-manager migration, Android acceptance, TestFlight, or public App Store release.
- New private-media infrastructure, unless Phase A identifies it as required for the selected acceptance content. Confidential-media rollout must not be claimed on the strength of feed authorization alone.

### Constraints and existing evidence

- Keep `mobile/` separately installed; preserve root/web dependencies and runtime configuration unless a specific backend dependency is needed and justified.
- Reuse the tested playback coordinator and its maximum of three live players. No feed stack may keep additional hidden player pools alive.
- Preserve saved startup sound and current-session mute across space changes and Refresh. Logout does not erase device sound preferences.
- The prior acceptance target is iPhone 17 Pro Max, iOS 26.6.2, Expo Go 57.0.9. Recheck versions at execution; SDK/library upgrades are not an implied prerequisite.
- Plan 167 records roughly 122 ms prepared first-frame p95 on the test phone. That measures presentation readiness separately from observed playing/progress; cold and incomplete transitions remain in reports.
- Implementation was authorized after planning. This development host now serves the new routes with native sessions enabled; the additive native schema is applied. Keep the native feature flag disabled by default for other installations until their own setup/checks are complete.

## Current Integration Points

| File or surface | Existing behavior and consequence |
| --- | --- |
| `src/app.ts` | Parses browser sessions before CSRF; `/api/login` sets cookies; `/api/me` returns an anonymous identity envelope when signed out; `/logout` returns HTML. Native transport needs a distinct JSON contract. |
| `src/security/sessionStore.ts` | Browser session creation/revocation; reusable account infrastructure, but current browser tokens are stored directly. Do not silently migrate or repurpose browser sessions. |
| `src/middleware/sessionParse.ts` and `src/middleware/auth.ts` | End-user identity currently comes from `sid`; the existing bearer check is for an automation/admin token. It is not native end-user authentication. |
| `src/routes/spaces.ts` | `/api/feed/global` is anonymous-capable; `/api/me/spaces` and `/api/spaces/:id/feed` require browser authentication. Space feed entry calls `assertCanViewSpaceFeed`. |
| `src/features/spaces/service.ts` | My Spaces returns personal/global/groups/channels. Feed access checks bans, then existing owner/admin/member/public/subscriber policy. Preserve this policy; a list entry alone does not authorize a feed. |
| `src/features/feeds/service.ts`, `types.ts`, and `repo.ts` | Reuse ordering, completion/publishing filters, production outputs, and cursors. Current responses contain broad upload fields and creator email; add a server-side viewer serializer. |
| `frontend/src/app/Feed.tsx` and `frontend/src/menu/contexts/ChannelSwitcher.tsx` | Behavior reference and regression targets. Do not import the browser feed component into native. |
| `mobile/src/api/client.ts` | Anonymous GET-only client with timeout/cancellation and a header-provider hook; extend for structured errors, credential snapshots, and JSON session requests. |
| `mobile/src/feed/feedStore.ts` | Loader injection, deduplication, cancellation, cursor protection, and refresh generations already exist; generalize context without losing those protections. |
| `mobile/src/playback/useFeedPlayback.ts` and `coordinator.ts` | AppState eligibility exists; screen focus, navigation overlays, and account authorization must become additional eligibility inputs. |

## Locked Decisions

These are implementation defaults for this milestone. If Phase A disproves a technical assumption, revise this plan with the evidence before implementing the replacement.

1. Retain two clients and one backend. All permission and publication rules stay on the server; native routes call existing domain services rather than copying SQL or policy into the phone.
2. Keep Global anonymous-capable and discovery-only. Signing in does not turn it into a social engagement surface or grant personal-space access.
3. Sign in with existing accounts. Extract credential verification into a shared backend service so web and native use the same password formats and account eligibility checks. Preserve browser login response/cookie behavior.
4. Add an opaque, revocable native session, transmitted in `Authorization: Bearer`. Generate 32 random bytes; store only a SHA-256 digest in a new native-session table. Use a 30-day absolute lifetime initially, matching the existing browser lifetime. No refresh token or sliding renewal in this increment; expiry asks the user to sign in again. Keep the mobile session interface replaceable so later renewal does not affect feed code.
5. Native bearer credentials authorize only the new native-session and viewer routers. Do not populate a fake browser `req.session`, broaden the existing admin-token behavior, or make bearer tokens automatically work on admin/upload/payment endpoints. Viewer routes may also accept valid browser cookies through the same route-local principal resolver.
6. Use additive API namespaces: `/api/native/v1/session` for native sessions and `/api/viewer/v1/...` for client-neutral viewer reads. Preserve existing web routes and payloads during this milestone. Web can adopt the new viewer contracts later.
7. A request with a bearer header must validate it explicitly. An invalid/expired bearer must not silently become anonymous Global access or fall back to a cookie identity. Reject simultaneous bearer and `sid` credentials on these new routes as `ambiguous_auth`, even if the browser cookie is stale. Native sends `credentials: 'omit'`.
8. Store the native credential with `expo-secure-store`; use the SDK-compatible version selected by `expo install`. AsyncStorage remains for non-secret sound settings and a sign-out suppression marker. Never persist a password, token in a URL, or viewer feed data on disk.
9. Use React Navigation with a native stack for Feed, Spaces, Account/Sign In, and Settings. Choose versions compatible with the installed Expo SDK; avoid adding a second navigation framework or upgrading Expo just to use the newest package.
10. Keep one feed owner. Space selection replaces its context and releases all old players before loading the destination. Switching spaces resets that feed to its first item. Closing a temporary screen without changing context preserves the position and intentional pause when authorization remains valid.
11. Key viewer state by API origin, auth generation, and feed context. Publication ID remains the item identity within that context; production ULID and space ID are distinct fields.
12. Fail closed for protected viewing while session validation is pending or fails. Network failure is retryable and does not by itself delete a valid saved credential; anonymous Global remains available through a separate credential-free request path.
13. Do not change publishing, personal-space access rules, or engagement policy as part of viewer adoption. Current runtime policy is the integration baseline; historical docs that describe auto-mirroring do not authorize new publishing changes.
14. Do not claim private-media protection from API gates. Phase A classifies media delivery and records whether this increment is limited to non-confidential fixtures or needs a preceding protected-delivery plan.

## Intended User Experience

| State or action | Behavior |
| --- | --- |
| First launch without a session | Open Global and start using the saved startup sound preference. Header offers Spaces and Account; Settings and Refresh remain available. |
| Open Sign In or Account | Pause the feed and release speculative neighbors. Email/password form supports keyboard navigation, secure password entry, progress, cancellation, and retry. No password is logged or saved. |
| Successful sign-in | Validate and persist the session, advance the auth generation, discard anonymous feed state, and load signed-in Global. Spaces becomes available. |
| Open Spaces | Pause playback. Show Global plus Personal, Groups, and Channels sections from the server, with loading/retry/empty states and the selected context marked. No create/join/checkout controls. |
| Select a space | Dispose old feed/player ownership, close selector, show the space name and type, and load its first page. Changing a title never substitutes for an actual context change. |
| Select Global | Always use the Global aggregator, even when My Spaces includes a legacy Global-space row. Do not substitute `/spaces/:id/feed` for Global semantics. |
| Close a screen without selection | Resume the same item only if the screen is focused, app active, authorization valid, no blocking overlay, and the user had not paused. |
| Refresh | Refresh current feed and relevant access metadata, preserving current-session sound. Do not silently switch to Global after an ordinary network failure. |
| Relaunch with stored credential | Show session restoration; validate with the server before protected content mounts. Successful validation opens signed-in Global. Do not persist the last protected destination in this increment. |
| Offline during restoration | Offer Retry and Browse Global. Keep the saved credential quarantined from protected viewing; Browse Global uses an anonymous client and will show its own network error if offline. |
| Expired/revoked session | Stop protected playback, invalidate old requests and navigation, clear the invalid credential, show a short sign-in explanation, and return to anonymous Global. |
| Space access denied | Clear that space's items and players; show Access unavailable with Spaces/Global actions. A 403 does not sign out the whole account. |
| Sign out | Immediately stop playback and clear viewer state; revoke the native session online and remove local credential. Anonymous Global is the destination. Explain if offline sign-out could only remove local access. |
| Switch accounts | Complete sign-out first, then sign in as the other account. Never reuse the previous account's space list, pending requests, media players, or navigation history. |

## API Contract

The following routes are planned, not existing. Record exact schemas in `docs/API.md` and checked backend/mobile fixtures during execution. No native credential is ever sent to CloudFront or poster hosts.

| Method and path | Authentication | Result |
| --- | --- | --- |
| `POST /api/native/v1/session` | Email/password over HTTPS; no ambient session credentials | `201` with `{ token, expiresAt, viewer }`; no `Set-Cookie`. Generic `invalid_credentials`, bounded body, and rate limiting. |
| `GET /api/native/v1/session` | Valid native bearer required | `200` with `{ expiresAt, viewer }`; no token echo. Missing/expired/revoked credentials return `401`. |
| `DELETE /api/native/v1/session` | Native bearer | Revoke current native session only; `204`. A well-formed unknown/already revoked token may return `204` for idempotency; missing/malformed header returns `401`. Never revoke a browser cookie session implicitly. |
| `GET /api/viewer/v1/feed/global?limit=20&cursor=...` | Optional viewer auth | `{ context, items, nextCursor }` from existing Global selection/order. Invalid supplied credentials return `401`. |
| `GET /api/viewer/v1/me/spaces` | Required native bearer or browser session | `{ personal, groups, channels }`, filtered through current feed access policy; Global is a fixed native navigation choice. |
| `GET /api/viewer/v1/spaces/:id/feed?limit=20&cursor=...` | Required native bearer or browser session | `{ context, items, nextCursor }`; authorize before serializing metadata/media, on every page. |

### Minimal data shapes

```ts
type Viewer = { id: number; displayName: string | null };
type FeedContext = { kind: 'global' } | { kind: 'space'; spaceId: number };
type SpaceSummary = {
  id: number; ulid: string | null; name: string; slug: string;
  type: 'personal' | 'group' | 'channel';
  relationship: 'owner' | 'admin' | 'member' | 'subscriber';
  subscribed: boolean;
};
type ViewerVideo = {
  publicationId: number;
  uploadId: number | null;
  productionUlid: string | null;
  spaceId: number;
  playbackUrl: string | null;
  posterUrl: string | null;
  creator: { id: number | null; displayName: string | null; avatarUrl: string | null };
  description: string | null;
  width: number | null; height: number | null; durationSeconds: number | null;
};
type ViewerFeed = {
  context: { kind: 'global' } | {
    kind: 'space'; space: Pick<SpaceSummary, 'id' | 'ulid' | 'name' | 'slug' | 'type'>;
  };
  items: ViewerVideo[];
  nextCursor: string | null;
};
type ViewerError = { error: string; requestId?: string };
```

- Serialize explicit fields; do not spread an enhanced upload or owner record into JSON. Missing creator name uses a generic label on native, never an email fallback. Avatar may be null if not currently available; do not add per-row profile queries just to fill it.
- Do not return creator email, S3 identifiers, processing/job fields, filenames, requester/approver identities, or raw distribution settings. The authenticated viewer envelope also does not need roles or email for this milestone.
- Preserve server ordering and opaque timestamp/ID cursors. Validate new-route IDs, limit, and cursor shape; return `400 invalid_query` rather than silently treating malformed cursors as a first page. Do not change legacy endpoint cursor behavior incidentally.
- Keep context on empty pages. Return `404 space_not_found` for a missing space and `403 forbidden` for denied access, with no feed records or media URLs. No native navigation decision is an authorization proof.
- Use `Cache-Control: no-store` for all session and viewer responses in this milestone, including anonymous Global, to prevent shared cache mixing while contracts settle. Do not cache authenticated responses by URL alone.
- Document `401` as invalid/missing session, `403` as space denial, `404` as unavailable space, `429` with `Retry-After`, and `5xx` as retryable service failure. Do not expose DB errors or credential details.
- New viewer response minimization does not fix the already-public legacy feed's broad payload. Record that residual exposure and schedule migration/minimization of legacy clients separately; do not describe client-side filtering as a backend privacy fix.

## Native Session Design

### Server

- Create a route-local principal such as `{ userId, source: 'cookie' | 'native', nativeSessionId? }`. Existing domain services receive its user ID. Leave browser-only middleware and page guards intact.
- Credential verification shares the current `s2` password format and normalized email handling. Use timing-safe comparison, check `users.deleted_at`, and validate hash parameters. Avoid duplicating the synchronous password-verification path; use bounded asynchronous work and generic failures. Any change affecting browser login needs its regression gate.
- Persist only the native token digest. Resolve a non-revoked, unexpired row and an eligible current user for every protected request; fail with `503` on a session-store failure, not a false anonymous success. Do not infer a current role from a token payload.
- Apply route-local login throttling by normalized account and trusted client IP, with bounded storage and `Retry-After`. Establish proxy trust from deployment configuration; do not trust arbitrary forwarded headers. Phase A decides the shared backing if more than one API process serves traffic.
- Audit logs and tracing for token/password leakage, including response bodies and URL logging. Log auth outcomes and request IDs without credential values. Never include tokens or signed-media query strings in exported playback diagnostics.
- Set explicit HTTPS policy behind the known reverse proxy. Production native login must not issue credentials over HTTP. Keep existing CORS allowlists; native access does not require allowing every browser origin.

### Additive database change

Use an idempotent migration in the existing schema mechanism. Confirm the actual users ID type and table naming in Phase A. The intended new table is:

```sql
CREATE TABLE IF NOT EXISTS native_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash BINARY(32) NOT NULL,
  credential_hash BINARY(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  UNIQUE KEY uq_native_sessions_token_hash (token_hash),
  KEY idx_native_sessions_user (user_id, revoked_at, expires_at),
  KEY idx_native_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

No existing browser session row/column is dropped, rewritten, or backfilled. Define bounded retention/cleanup of expired native sessions as a follow-up operation with a scoped predicate, not startup-wide deletion. Test migration reruns against a disposable development database, never by replaying schema backups. If a password-change or account-disable flow already exists, include native-session invalidation in that flow; otherwise record the missing account-lifecycle hook explicitly before public release.

### Device

- Persist one versioned SecureStore record containing API-origin binding, token, and expiry. Keep viewer identity in memory after validation. Use device-bound unlocked Keychain accessibility where supported; no biometric prompt is required. SecureStore read/write/delete errors must be handled.
- SecureStore is available in Expo Go, but select the installed SDK's module version. iOS Keychain data can survive reinstall; a fresh-install marker and server validation prevent assuming reinstall means sign-out. See [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).
- Serialize session storage writes and tag all operations with an auth generation. A delayed login write must not restore credentials after Logout or an account change. Login only becomes durable after storage succeeds; on failure, revoke the newly issued session when reachable and offer retry without saving the password.
- On sign-out, write a durable non-secret suppression marker before deleting the credential, and prevent restoration while it is set. Clear it only after a new successful sign-in. If persistence fails, quarantine the in-memory session and show retry; do not claim the next launch is signed out until the marker or deletion succeeds. Online revocation failure must not prevent local sign-out. Offline removal cannot guarantee server revocation; the token expires normally.
- Do not retry login automatically or replay a session request after a generation changes. Cancelled/late login responses must never change the active account; best-effort revoke a newly issued late token. A lost network response can leave an unused server session until expiry, which is recorded as a limitation.
- Attach a credential snapshot only to relative paths on the configured HTTPS API origin. Reject protocol-relative/absolute paths; never send bearer headers through the video player, Image component, external browser, or redirected API requests. Validate redirect behavior on native rather than assuming browser fetch behavior.

## Feed and Playback Ownership

Use an auth generation and a context generation independently of the existing refresh/source/activation generations. A response may update the screen only when all relevant generations still match. Preserve FeedStore cancellation, deduplication, cursor-cycle detection, and safe pagination retry.

On login, logout, account change, or space selection: pause/release every old player, invalidate pending feed work and native callbacks, clear items and cursors, then load the new context. Do not temporarily keep two mounted feed coordinators across a navigation transition. Add global resource accounting so a three-player cap remains verifiable across coordinator replacements.

Playback eligibility is the conjunction of app active, feed screen focused, viewer session valid for a protected feed, no blocking screen/overlay, not scrolling, no intentional pause, and no selected-source failure. Keep manual pause independent from temporary suppression. Spaces, Account, Sign In, and Settings pause the selected player and release neighbors; returning rebuilds neighbors only after eligibility returns. An iOS back-swipe cancellation must restore the correct focus state without auto-resuming a manual pause.

For a protected feed, revalidate session and current space access before resuming after background/lock. Foreground validation pauses playback and blocks interaction with stale protected content; network failure shows Retry/Global rather than playing through an unverified authorization state. During continuous foreground browsing, recheck authorization at least every 60 seconds as well as on pagination/Refresh. Denial/expiry clears selected and preloaded sources. This bounds app-side detection; it is not instantaneous CDN revocation or retroactive removal of already-buffered media.

Retain provided HLS URLs. Do not invent S3 fallbacks or alternate orientation paths. At this milestone, sound remains a device/session preference and is not synchronized to the user account.

## Media Access Review

Phase A must trace representative Global, personal, group, and channel media URLs, including master/variant playlists, segments, and posters. Current POC evidence establishes unsigned public HLS for Global, not the delivery policy for every restricted space.

- If acceptance uses media intended for public delivery, test feed permissions with non-confidential fixtures and record the exact limitation. API-authorized space viewing may proceed without claiming confidential delivery.
- If any target content requires confidentiality from someone with a copied media URL, add a preceding protected-media plan before accepting that content. Do not quietly loosen space policy or invent a partially signed playlist scheme.
- A protected design must cover playlists, segments, poster assets, expiry during playback, native credential propagation, origin access, and browser compatibility. Signing only the master URL is insufficient if child requests remain public. AWS documents access policy and expiry for signed URLs in [CloudFront private content guidance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html).

## Phase Status

- A: Complete — Contract, access, media, and environment baseline
- B: Complete — Backend native sessions
- C: Complete — Minimized viewer API and authorization parity
- D: Complete — Native session lifecycle
- E: Complete — Navigation and Global/space feed selection
- F: Complete — Playback focus, access changes, and recovery
- G: Complete — API/browser/device acceptance with user-deferred VoiceOver and recorded limits
- H: Complete — Independent iPhone build, account/storage/playback/lifecycle/network smoke and handoff

Only one implementation phase may be In Progress at a time. Keep the app runnable after each phase. Do not mark a phase complete based only on a compile or an unrun checklist.

## Phase A — Establish Contracts and Acceptance Fixtures

Goal: resolve integration assumptions before adding credentials or protected viewing.

- [x] Confirm existing endpoint behavior with anonymous and ordinary-member accounts; distinguish planned routes from deployed routes.
- [x] Record allowed/denied space matrix: owner personal, group member, channel member, active/expired subscriber, public-space nonmember, private-space nonmember, banned viewer, and deleted/missing space.
- [x] Select two ordinary test accounts with different space access. Avoid admin accounts masking permission errors. Use existing local credential profiles without copying secrets into the plan or reports.
- [x] Inspect publication-level visibility behavior in both existing web and domain services. Resolve any private-publication leakage before routing new native traffic through it; do not add a native-only workaround.
- [x] Complete the media-access review above using non-confidential fixtures; record release limits or a concrete dependency plan if protected delivery is required.
- [x] Confirm account eligibility, password-change/disable hooks, deployed process count, trusted proxy handling, and login rate-limit backing. Specify the actual limiter thresholds in the implementation record.
- [x] Finalize API field/error fixtures, proposed source-file paths, navigation dependency compatibility, and native-session schema. No workspace extraction is required.
- [x] Establish baseline mobile tests/typecheck and backend/browser checks; record the existing docs-check failures separately.

Test gate: existing mobile `npm test` and `npm run typecheck`; root `npm run build`; focused read-only API calls for the access matrix. Record API evidence under the api-curl harness with a Plan 168 Phase A run ID. If fixtures are missing, create narrowly scoped development fixtures during execution and document them; do not ask the user to paste passwords.

Acceptance: contract and fixtures are concrete, media-delivery scope is explicit, and no unresolved access-policy assumption is hidden behind a successful admin request. Phase B can proceed while later release work remains scoped separately.

## Phase B — Implement Backend Native Sessions

Goal: a native credential authenticates the existing user without changing browser session semantics.

- [x] Add the native-session migration/repository/service and shared credential verification.
- [x] Implement POST/GET/DELETE session routes, route-local principal resolution, TLS policy, expiry/revocation, and generic JSON errors.
- [x] Add rate limiting and verify log/trace redaction for credentials and response tokens.
- [x] Mount routers with intentional middleware/error-handler order. Current login routes appear after the centralized error handlers, so new routers must not inherit that mistake; verify thrown failures reach the intended JSON handler.
- [x] Keep native principals independent from `req.session` and admin bearer tokens. Reject ambiguous credentials and ineligible/deleted users.
- [x] Document native session lifetime, individual-session revocation, offline logout limits, and any account-lifecycle hooks still deferred.

Test gate: add and run focused backend tests for correct/incorrect credentials, malformed hash/body/token, expiry, revocation, unknown token, ambiguity, rate limits, deleted users, store failure, migration idempotency, no raw token persistence, and no cookie issuance. Verify native bearer cannot authorize existing browser/admin/upload routes. Run root build and browser login/logout/CSRF regression checks. Record exact new test command in Validation; no backend test script is claimed to exist yet.

Acceptance: native login/validation/revocation works against the development backend, secrets stay out of evidence, and a browser session works before and after a native session is revoked.

## Phase C — Add Viewer API Contracts

Goal: both credential types reach the same feed policy through minimal, stable responses.

- [x] Add a viewer router and serializer using the existing feed/spaces domain services.
- [x] Implement Global, My Spaces, and space-feed routes from the API table. Check every space page and filter denied entries from the selector result.
- [x] Validate query inputs, retain server cursor/order semantics, and include context on empty feeds.
- [x] Enforce response allowlists and no-store headers on success and error paths. Make existing broad web responses a tracked residual issue.
- [x] Ensure the browser-cookie and native-bearer versions of the same request return the same publication IDs and access outcome for the same account.
- [x] Add reusable backend/mobile JSON fixtures without live media signatures, personal data, or credential material.

Test gate: run the Phase A permission matrix against new routes with ordinary accounts and anonymous access. Test banned users, removed memberships, ended subscriptions, unpublished/pending content, invalid/stale cursors, empty feeds, and access changed between pages. Assert serialized field allowlists recursively. Verify denied requests return no media URLs. Compare old web endpoint ordering and existing web rendering after the additive routes land.

Acceptance: anonymous Global and authorized space reads work; cookie/bearer parity is demonstrated; denied users cannot retrieve feed metadata through new viewer routes.

## Phase D — Implement Native Session Lifecycle

Goal: sign-in persistence and identity changes are correct before adding more feeds.

- [x] Add SDK-compatible SecureStore and a storage adapter with injectable test doubles. Keep secrets separate from preferences and diagnostics.
- [x] Extend ApiClient for JSON POST/DELETE, stable error codes, origin binding, credential snapshots, cancellation, and explicit `401`/`403`/`429` handling. Maintain a separate anonymous request path.
- [x] Implement AuthStore/provider states: restoring, anonymous, signing in, authenticated, validation unavailable, and signing out. Serialize storage operations and invalidate by auth generation.
- [x] Implement the native sign-in/account screen and persistent restore validation. Handle invalid credentials without erasing the typed email; clear password on completion or leaving the form.
- [x] Implement logout suppression/deletion, offline behavior, expiry, and account change. Revalidate on launch and foreground; do not replay protected requests after losing identity.
- [x] Preserve anonymous Global behavior and current sound choices during these transitions.

Test gate: mobile typecheck/tests plus new meaningful auth tests for delayed hydration, invalid record, origin change, storage failures, failed revocation, stale login after logout, sign-in A racing sign-in B, `401` from an old generation, network failure versus credential rejection, throttling, foreground validation, and reinstall-marker behavior. Phone smoke: sign in with an existing ordinary account, reload, restore identity, sign out, reload to anonymous Global. SDK-compatible iOS export must pass.

Acceptance: saved credentials are validated and never restore a stale account. Logout and account switch cannot leave old viewer state or audio alive. No password or bearer appears in local exports.

## Phase E — Add Navigation and Space Viewing

Goal: use one native feed implementation for Global and existing accessible spaces.

- [x] Add React Navigation native stack and stable screens for Feed, Spaces, Account/Sign In, and existing Settings. Honor safe areas, readable labels, text scaling, keyboard avoidance, and VoiceOver focus.
- [x] Generalize `useGlobalFeed`/API loader into explicit feed context while retaining FeedStore pagination/cancellation and the existing item adapter protections.
- [x] Add My Spaces loading, retry, refresh, empty sections, relationship labels, selected state, and denial recovery. Never hide Global because no legacy Global space row exists.
- [x] Switch context through one operation that invalidates requests, disposes old coordinator resources, resets paging, and loads the new page. Use a stable context/auth key rather than only publication ID for screen state.
- [x] Keep Refresh, Settings, mute, tap-pause, and unavailable-video Retry/Next behavior in every feed. Add a clear route back to Global.
- [x] Avoid feed data persistence, hidden stack-mounted feed instances, and cached space lists shared between users. New launches start in Global after session validation.

Test gate: mobile tests/typecheck/export plus context tests for A-to-B switches with A's late page, same publication in two spaces, logout during pagination, duplicate IDs, repeated cursors, removed destination, empty space, failed pagination preserving valid items, and switcher retries. Phone: Global → Personal → Group → Channel → Global, with paging and Refresh in more than one nonempty space.

Acceptance: selected title, feed records, pagination cursor, and player all belong to the same viewer/context. No stale item appears briefly during account changes.

## Phase F — Extend Playback Eligibility and Recovery

Goal: navigation and authorization transitions preserve the POC's playback behavior and resource bound.

- [x] Feed focus, blocking screens, validation, and space authorization become explicit coordinator eligibility inputs without modifying intentional pause.
- [x] Pause/release neighbors on screen blur. Dispose old feed resources before destination allocation; retain one app-wide diagnostic resource counter.
- [x] Add foreground and periodic protected-feed access validation. Coalesce simultaneous checks, cancel obsolete checks, and prevent a late success from re-enabling a logged-out feed.
- [x] Clear protected items/players on `401` or current-space `403`/`404`; treat network/server errors as retryable validation failures. Do not classify media-host errors as automatic session expiry.
- [x] Exercise cancellation of iOS back navigation, keyboard/form dismissal, Settings return, rapid selector changes, background while switching, and refresh while validating.
- [x] Extend local diagnostics with non-secret context/generation/focus evidence and retain error/incomplete transitions. Do not introduce production analytics.

Test gate: coordinator/auth integration tests must prove no eligible playback on blur/validation failure/logout, no manual-pause reset, stale callback rejection, and a maximum of three live players across replacements. Device checks: rapid cross-space switches, background/lock and resume, Account/Spaces/Settings overlays, manual pause, cellular interruption, and denied-access recovery. Keep normal-swipe timing separate from deliberately cold cross-space transitions.

Acceptance: exactly one eligible selected video can play; hidden audio is absent; all old resources release on account/context change; validation failure cannot leave a protected feed playing.

## Phase G — Complete Integrated Acceptance and Browser Regression

Goal: demonstrate the signed-in viewer on a physical iPhone and prove web continuity.

- [x] Run the API permission/contract matrix with two ordinary accounts and browser/native credentials. Include expiry, revocation, removal from a space, and subscription ending during an open feed.
- [x] Verify web anonymous/signed-in Global, space switching/viewing, login/logout, and one existing authenticated mutation with CSRF. Confirm missing CSRF still fails and new native routes did not broaden existing automation/admin access.
- [x] Execute the device matrix below with labeled network and build versions. Use compact diagnostics and preserve separate error/playing/progress evidence. VoiceOver is explicitly deferred; text-size/cancellation/observation limits are retained.
- [x] Review viewer responses, screenshots, reports, and request logs for unintended personal data or secrets. Store sanitized artifacts by harness.
- [x] Fix failures in the owning phase and rerun the affected gate before completing acceptance. Do not erase incomplete/cold samples to meet performance targets. The original one-off freeze remains a documented non-reproduced incident with unconfirmed cause.

Test gate: run mobile tests/typecheck/Expo Doctor/iOS export, root build, focused API/browser suites, and the physical-device matrix. Browser tests use a temporary local bundle/output path where possible so validation does not overwrite deployed public assets. Record commands, outcomes, limits, and sanitized evidence in Validation.

Acceptance: all required behavior and access checks pass, no persistent spinner/wrong-video/overlapping audio occurs, and web viewing/authenticated writes continue to work. Unavailable fixtures or device checks remain explicit pending gates.

## Phase H — Independent Development Build and Handoff

Goal: verify the expanded app outside Expo Go and leave a reproducible development path.

- [x] Configure `expo-dev-client`, a unique iOS bundle identifier, and EAS development profile using SDK-compatible tooling. Preserve the Expo Go start commands when still supported.
- [x] Inspect the upload package and evaluate app configuration in isolation. A repository-root `.easignore` allowlist includes the independently installed mobile app's source/build inputs only; backend/web packages, local environment/credentials, dependencies and test evidence are excluded.
- [x] Record Expo/Apple account and signing prerequisites without placing credentials in the repository. Build/install an iOS development app using available authorized signing; Linux development uses a supported cloud build path.
- [x] In the development build, sign in afresh, play Global/Personal/Channel feeds, fully close/reopen with restored sign-in, and sign out to the anonymous Spaces gate. Treat its Keychain namespace as separate from Expo Go.
- [x] Repeat independent-app account switch, focus/lifecycle, sound, offline recovery, and resource checks; label the build/runtime separately from Expo Go.
- [x] Update mobile README and API docs with setup, session expiry, fixture/test commands, development-build install, and residual media/privacy limits. Evaluate the root README under its maintenance policy.
- [x] Update this plan, roadmap milestones as actually achieved, and implementation index. Keep TestFlight/App Store and full viewer parity deferred with concrete next scope.

Test gate: a real development build launches on the recorded iPhone and passes the smoke above. An Expo export alone is not a native build. If account/signing access is unavailable, prepare all local configuration and record the exact missing prerequisite; leave this phase Pending/In Progress rather than claiming standalone acceptance. No new permission is needed for authorized local preparation.

Acceptance: another developer can reproduce API/mobile setup and run the accepted viewing flows in the independent development app. The final handoff distinguishes completed checks, remaining distribution work, and future product features. [Expo development-build guidance](https://docs.expo.dev/develop/development-builds/introduction/).

## Device Acceptance Matrix

| Scenario | Required result |
| --- | --- |
| Anonymous launch and sign-in cancellation | Global works; cancelling sign-in cannot start a late account session. |
| Sign-in and relaunch | Existing account authenticates; secure restore is server-validated before protected playback. |
| Account A → logout → account B | Different spaces and content appear correctly; A's items, requests, navigation, and players are gone. |
| Global / Personal / Group / Channel | Correct title/context; each nonempty feed plays and paginates; empty space offers a useful way back. |
| Invalid session or access removed | Session denial and space denial use different recovery; denied content clears and stops. |
| Normal stable Wi-Fi swipes | At least 30 prepared forward transitions across nonempty feeds; prepared first-frame p95 ≤300 ms, with initial/cold/incomplete/error samples separately retained. |
| Rapid swipes and context switches | No wrong-video/hidden audio; peak players ≤3 across the whole app; guard events investigated rather than automatically called audible overlap. |
| Ten-minute mixed browsing | Several space changes, Refresh, background/foreground and lock/unlock cycles; no persistent spinner or resource growth; capture final resource report. |
| Manual pause and overlays | Pause survives background and temporary screens; dismissing an overlay resumes only a previously playing authorized item. |
| Airplane Mode and reconnection | Session validation/feed errors recover; network loss does not delete saved sign-in or expose unvalidated protected content. |
| Sound preferences | Session mute survives Refresh/context change; saved startup choice survives relaunch; sign-out retains device preference. |
| Accessibility | Controls readable at enlarged text, usable with VoiceOver, and clear of notch/home indicator and keyboard. |
| Independent build | Core sign-in, storage, navigation, player, and recovery behavior repeated outside Expo Go. |

### Current device acceptance progress

| Check | Recorded status |
| --- | --- |
| Native build, sign-in, Global/Personal/Channel, full-close restore, logout gate | Passed |
| Native account-switch responsiveness repeat | Passed; original one-off whole-app freeze retained as an incident with unconfirmed root cause |
| Stable-Wi-Fi prepared timing and three-player cap | Passed: 33 prepared frames, p95 109.70 ms; mixed reports also peak three |
| Manual pause, session mute, saved startup sound, offline sign-out durability | Passed |
| Native offline saved-session recovery | Passed |
| Continuous ten-minute mixed browsing with resource report | Passed by response to requested protocol: 104 selections/frames, zero errors/incomplete, three live/peak; duration user-reported, not separately instrumented |
| Native rapid-swipe/hidden-audio observations | Mixed protocol reported successful; three ineligible selected-player guard events investigated/retained (one scrolling, two suppressed screen); no overlap/freeze reported |
| Sign-in cancellation | Controlled actual AccountScreen/Action/AuthStore response/save/unmount cases passed; manual in-flight gesture unexercised because sign-in finished in ~100 ms |
| Device denied/expired access | Passed: denial stopped audible playback with identity retained; Refresh after restoration recovered without login; session expiry returned to anonymous Global; fixture cleanup complete |
| Device accessibility (enlarged text, VoiceOver, safe areas/keyboard) | Limited evidence: left-to-middle text slider looks good; higher-size pill clipping accepted; VoiceOver explicitly deferred by user, no full accessibility pass claimed |

Three-player accounting does not replace native memory profiling. Release memory/thermal profiling, broader phone coverage, and production network qualification remain later release gates.

## Expected File Boundaries

Representative new paths to finalize in Phase A:

- Backend: `src/features/native-sessions/` (repository/service/types), `src/security/credentials.ts`, `src/routes/native-session.ts`, `src/routes/viewer.ts`, and a viewer serializer under the feed feature.
- Existing backend integration: `src/app.ts`, `src/db.ts`, space/feed service helpers, and only necessary logger/typing changes. No wholesale browser authentication rewrite.
- Native: `mobile/src/auth/`, `mobile/src/navigation/`, `mobile/src/spaces/`, native session API adapter, generalized feed loader, and existing player focus integration.
- Tests: mobile auth/context/coordinator tests; focused backend session/viewer tests; reusable API/browser smoke coverage under the existing harness conventions.
- Docs: `docs/API.md`, `mobile/README.md`, this plan and its index; root README only if setup changes warrant it.

Do not introduce a shared React package or change root/mobile Node pinning by default. Shared JSON contract fixtures and explicit serializers are sufficient for this increment.

## Rollout and Rollback

1. Land additive session storage and endpoints with native access disabled by a backend feature flag until contract gates pass. The flag controls both issuance and use, so disabling it stops protected native requests.
2. Validate viewer reads with browser and native test accounts. Existing web routes remain available throughout.
3. Point development native builds at the new viewer routes. Preserve the previous app commit as the working anonymous POC rollback.
4. On regression, disable native session routes/validation and roll back the mobile build; preserve the additive table and browser sessions. Revoke only affected native sessions with narrowly scoped operations when needed.
5. Do not drop tables, rewrite publication visibility, or perform bulk cleanup as rollback. Native credentials remain unrecognized by legacy browser/admin routes.

## Change Log

- 2026-10-18 — User explicitly requested pushing. Fetched origin and verified zero remote-only commits and one outgoing commit; normal fast-forward push published `6cfad70` to `origin/main`. Remote `refs/heads/main` and local HEAD both resolve to `6cfad7021f9fc1658887c08b765e82b80c97142c`. No new commit or history rewrite; local continuity note remains uncommitted.

- 2026-10-18 — `6cfad70` — Committed signed-in native Global/Spaces viewing, native sessions/shared viewer APIs, playback/account lifecycle fixes, iOS development-build setup, regression tests, and developer/roadmap docs (69 files). A–H remain Complete. No push performed. This is the repository-required local post-commit continuity note.

- 2026-10-18 — User explicitly requested committing the completed Plan 168 implementation, developer docs, roadmap, and earlier Plan 167 continuity notes. Final diff/secret/whitespace review is in progress; no push requested.

- 2026-10-18 — Uncommitted closeout: completed A–H, including installed native build, final device denial/expiry and fixture cleanup. VoiceOver deferred by user; accessibility/cancellation/freeze/media limits retained. No implementation commit or push requested/performed.

- 2026-10-18 — Uncommitted implementation: completed A–F host gates, G host API/browser/media verification, independent EAS project/configuration preparation, and developer handoff docs. No commit or push requested or performed. G physical-device acceptance and H independent signed build remain unfinished.

- 2026-10-18 — Planning only: created this implementation plan and the linked web/native roadmap. No implementation commit, dependency install, schema migration, or push performed for this request.

## Validation

- Commit gate: reviewed and staged exactly 69 intended files; staged whitespace, scope and credential checks passed. Private fixtures, credentials, environment files, generated output and test-run artifacts stayed excluded. Agent docs checker retains the same 16 pre-existing older-plan errors and no Plan 168 finding. Latest 103 mobile tests, typecheck/iOS export, backend/API/browser checks and recorded physical-device acceptance remain applicable; no application code changed during final commit preparation. Root README already covers the committed developer workflow; no additional README change needed.

- Final closeout verification: fixture driver finish/status confirms phase complete, original active subscription and zero new active fixture sessions. JSON/plan structure and all A–H Complete statuses verified; no unchecked phase tasks remain. Whitespace check passes. Scanned 146 changed/source/evidence text files: no fixture passwords exported and no native credential strings in evidence. `npm run check:agents:docs` still reports the same 16 pre-existing status/header errors in Plans 138, 140–142 and 148–159; no Plan 168 finding. Log: `tests/runs/device/plan_168_phase_g/closeout-doc-check.log`. A stale mobile README pending-status sentence found during review was reconciled. No new application code or broad runtime suite rerun; no commit/push.


- Final native access gate passed and cleanup complete: user confirms expiring the test session ended sign-in and returned to anonymous Global, and previously audible video stopped when channel access ended. Earlier Account identity retention and Refresh restoring video without login were already confirmed. Ran finish: original fixture subscription active with ended_at=null, expired test session revoked, zero new active fixture sessions, private driver phase complete. Final Account/Spaces prompts were not separately described in this reply; native logout gating and automated expiry state coverage are already recorded. Evidence: `tests/runs/device/plan_168_phase_g/access-recovery-observation.json` and final device `summary.md`.
- Closeout: mark G and overall Plan 168 Complete with A–H delivered for this milestone. VoiceOver explicitly deferred; large-text pill clipping accepted; manual in-flight cancellation unexercised but three controlled actual-component cases pass. The earlier one-off freeze remains non-reproduced with unconfirmed cause, not silently erased. Final observation/cleanup/docs work changed no app source; latest 103-test/typecheck/export and backend/API/browser evidence remains applicable. Metro running and public viewer API 200; root disk ~3.9G free after authorized npm cache cleanup. No commit or push; next product scope is a separate detailed creator-profile/authorized personal-space plan.


- Device space-access recovery passed: user confirms Account remained signed into the test account and feed Refresh restored the video without another login. Audio stop while denied is still not explicitly reported; do not claim that observation. After recovery confirmation, driver status showed restored subscription/one new active session; executed expire-session for exactly that session. Current phase expired, original subscription still active/ended_at null, zero new active fixture sessions. Await phone foreground validation producing ended sign-in/anonymous Global and Account/Spaces sign-in prompts, then run finish. No normal-account/source changes. Evidence updated: `tests/runs/device/plan_168_phase_g/access-recovery-observation.json`.


- Phone shows **Access unavailable** after fixture access removal; user estimates five to ten seconds from the assistant message, not an independently measured revocation latency. Audio stop and Account still-signed-in were not explicitly reported. Having collected the denial-screen observation, restored the original subscription ended_at=null with the guarded driver; status is restored with exactly one new active fixture session. Await Account identity check and same-account Try again/Refresh playback recovery, plus whether audio stopped during the denial. Do not expire session before collecting recovery. No source changes/tests for this fixture-only step. Evidence updated: `tests/runs/device/plan_168_phase_g/access-recovery-observation.json`.


- Final phone access test advanced: user explicitly confirms video playing in **Native test subscribed**. Driver status was prepared with one new active fixture session. Executed deny-space, ending exactly that fixture subscription, and verified phase denied with the same one active session. Await phone playback/audio stop and Access unavailable, plus Account remaining signed in. Keep fixture denied until that observation, then restore-space and test Retry recovery before expiring the session. No normal-account/app/source changes. Evidence: `tests/runs/device/plan_168_phase_g/access-recovery-observation.json`.


- Prepared final denied/expired-access phone test using the existing ordinary fixture A and subscriber-only **Native test subscribed** channel, with public media only. Private ignored driver/state under `.codex-local/plan168-device-access*.{cjs,json}` assert fixture identity/role, channel ownership/visibility, absent membership shortcuts and exact subscription. Scoped controls end/restore that subscription and expire only one new active fixture session above a saved baseline (refuse ambiguity); no normal accounts/tokens changed or exported. Validated the controls against real HTTPS sequentially: baseline 200, denied space 403/error-only with session still 200, restored space 200, session expiry 401 for identity/bearer Global, anonymous Global 200. Test session revoked, original subscription restored, fresh baseline saved; current phase prepared, active subscription ended_at null, zero new active sessions. Syntax checks passed; no app source/dependency change or broad test rerun. Evidence: `tests/runs/api-curl/plan_168_device_access/`. Await user signing into the disposable account and opening its subscribed channel; credentials are displayed only in their terminal by the driver's credentials action, never via agent tool output/chat. Do not run other fixture integration suites during this phone test.


- User-authorized npm download-cache cleanup completed with `npm cache clean --force --cache /home/ubuntu/.npm --logs-dir /dev/shm/plan168-npm-clean-logs`. Confirmed installed npm 10.9.4 implementation removes `_cacache`, preserving `_npx`. Recovered 3.54 GiB; available root space increased from ~284 MiB to 3.82 GiB (`df -h`: 3.9G free, 91% used). Manifest/lockfile and installed-package sentinel hashes unchanged; npx tooling entries retained. Metro status running, public tunnel and HTTPS viewer API both 200. No project/source/dependency/editor/browser/monitoring-service deletion and no source change or unrelated tests. Evidence: `tests/runs/device/plan_168_phase_g/npm-cache-cleanup.json`. Remaining app acceptance is controlled denied/expired-access UI; VoiceOver remains explicitly deferred by user.


- Storage safety follow-up: directory names alone are not cleanup permission. Read-only process inventory confirms `aws/.tmp` contains running Jaeger, Prometheus and OpenTelemetry collector executables, plus ~417 MiB Prometheus data; retain that tree. `.vscode-server` contains active remote server/extensions including this Codex session; keep active versions. Playwright browser binaries may serve tests/automation across projects. The lowest-impact initial cleanup candidate is specifically npm downloaded-package cache `~/.npm/_cacache` (~3.6 GiB), whose removal does not remove installed `node_modules`; future installs may need network downloads. Do not remove all `~/.npm` or project directories. No deletion performed. Classification recorded in `tests/runs/device/plan_168_phase_g/storage-review.json`.


- User explicitly requests skipping VoiceOver. Record it deferred/unexercised; do not request another screen-reader test or claim a pass. Retain user-accepted large-text pill clipping and reported good left-to-middle slider range as limited accessibility evidence. User then reports another error/space concern: read-only check shows root ~287 MiB free, Metro/tunnel status responding, and user subsequently confirms the app is working. `/home/ubuntu/snap` is only 552 KiB of Chromium user data. Larger review candidates: `.vscode-server` 4.9 GiB, npm 3.8 GiB, downloaded Playwright browsers 2.7 GiB, project `.tmp` 1.9 GiB, and system Snap images 3.6 GiB (disabled revision package sizes sum ~1.65 GiB). No project/Snap deletion performed; no application changes/tests needed for this inventory. Evidence: `tests/runs/device/plan_168_phase_g/storage-review.json` and updated accessibility observation. Current priority: recommend disk headroom cleanup, then final denied/expired-access device acceptance.


- Text-size clarification: above the middle of the slider, text clips inside its pill container; the user says "I think that is okay." Record this as a known large-text layout limitation accepted for this milestone, not full maximum-size readability. No speculative layout change made. User requests more explanation for VoiceOver, so provide the screen-reader purpose and one-tap-to-hear/double-tap-to-activate walkthrough with Siri on/off guidance, then collect actual label/action observations. VoiceOver is still pending; no source changes/new runtime tests. Evidence: `tests/runs/device/plan_168_phase_g/accessibility-observation.json`.


- Development-server recovery confirmed on the phone: user says the app opens again. Accessibility partial result: larger text looks good from the far left through the middle of the size slider. Record only that sampled range; the user has not established the right-hand sizes, individual screen/keyboard coverage or VoiceOver. Clarify whether the middle was simply the furthest tried or whether larger sizes caused trouble, and collect the pending VoiceOver labels/activation observation. No new test run or source change for this evidence update. Evidence: `tests/runs/device/plan_168_phase_g/accessibility-observation.json`; reload recovery evidence updated. Host Metro status still running; root ~292 MiB free. G remains In Progress; H Complete.


- Accessibility check interrupted by development-server outage: user reports Reload error. Host inspection found no Expo/ngrok process, port 8081 refused connections, tunnel `/status` returned 404, and root free space was zero. Relocated regenerable Node compile cache (29,453,296 bytes, file-size manifest checked) and six SHA256-verified npm cache objects (271,976,091 bytes) to tmpfs with original paths preserved; freed ~294 MiB. A tsx cache copy encountered IPC sockets, so its original directory was left untouched and partial tmpfs copy removed. Restarted Metro in development-client mode with task npm cache/TMPDIR/Node compile cache on tmpfs. New running unified exec session **21522** replaces dead session 68614; same tunnel/address and native launch link. Local/public status running, native manifest 200 with current public bundle hostname, native launch redirect 307, local dev bundle 200 / 5,172,279 bytes and actual manifest-linked public native bundle 200 / 4,740,741 bytes. Phone reopen confirmation requested before resuming accessibility. Metro exit cause itself was not captured; do not claim the full disk proves it. No app source/dependency/native-build change; no new behavior tests needed. Evidence: `tests/runs/device/plan_168_phase_g/reload-server-recovery.json`.


- Cancellation device attempt: sign-in completed in roughly 100 ms, before the user could read or press Cancel. Record physical in-flight cancellation as unexercised; no repeated racing requested. Verified the actual AccountScreen/Action/AuthStore using React test renderer and controlled pending API/storage: Cancel during delayed response, Cancel during delayed save, and screen unmount with a pending response all pass. In each, the signal aborts, late success is ignored/revoked, saved credentials stay absent after writes/restore, and cancelled navigation is not repeated. Password field clears before waiting. Existing store race tests also cover cancellation in the 103-test suite. Verification-method adjustment: accept deterministic actual-component race coverage for this too-fast manual case while retaining the native gesture limitation; no requirement for late-success suppression is waived and no artificial latency is added. No app source/dependency changes; focused component check only. Evidence: `tests/runs/api-curl/plan_168_cancellation_followup/`; physical observation: `tests/runs/device/plan_168_phase_g/cancellation-observation.json`. Next physical check is accessibility; denied/expired-access UI remains pending.


- Independent-app mixed duration/lifecycle/resource protocol passed: user responds "It is all looking good" to the requested continuous ten-minute signed-in Global/Spaces/Refresh/rapid/background/lock/sound protocol. Report `2026-10-18T17:56:09.804Z` has 104 selections and first frames, zero incomplete/errors, 168 allocations/165 releases, three live/peak players, 74 prepared frames (median 87.44 ms, p95 135.65 ms, max 154.78 ms), cold max 792.09 ms. Three guard events are all the selected player while ineligible: one scrolling, two screenEligible=false. Reviewed the existing immediate-pause handler and host regressions; retain these events and do not equate them with audible overlap. User reports no problem in this protocol. Preserve bounded-history limits (1,557 dropped old events, no dropped transitions/issues), cold/initial samples, and two latest transitions lacking progress despite playing evidence. Duration is accepted from the protocol response, not independently timed by compact export. Raw report/assessment: `tests/runs/device/plan_168_phase_h/ten-minute-mixed-compact.json` and `ten-minute-mixed-assessment.json`.
- H completed after the actual native build/install, native identity/restore/isolation responsiveness, pause/mute/startup sound, offline recovery/sign-out, and mixed lifecycle/resource evidence. Mobile/API/root setup and handoff docs reviewed/updated under documentation policy; native startup requires the development server, public-media limits and TestFlight/public-release scope remain explicit. Move G In Progress for final device cancellation, denied/expired-access and accessibility checks; plan remains Active. Original one-off account-switch/Retry freeze remains a recorded non-reproduced incident with unconfirmed root cause. No source changes or new runtime tests for this observation/docs update; latest code gate is 103 mobile tests/typecheck/iOS export plus actual Metro HTTP 200. No commit/push.


- Independent-app offline sign-out and startup sound passed: user confirmed all three results after Settings → Start videos → Muted, explicit Account → Sign out in Airplane Mode/Wi-Fi off, reconnect and full-close/reopen: Account shows the sign-in form, Spaces requires sign-in, and Global starts muted. This establishes local credential removal and native preference durability in the installed app's own storage; it does not establish server-side revocation while offline. Evidence: `tests/runs/device/plan_168_phase_h/native-offline-signout-sound.json`. No source changes/new runtime tests. Remaining acceptance is now tracked below; next requested continuous ten-minute mixed run covers the remaining independent-app hidden-audio/rapid/context/resource smoke as well as G duration. Prior ~five-minute run is retained without upgrading its duration.


- Independent-app offline recovery passed: responding to the Channel 2 Airplane Mode/Wi-Fi-off → background/reopen → reconnect protocol, the user confirms playback recovered in the same account without a password ("yes, all good"). No logout was requested in this check. Evidence: `tests/runs/device/plan_168_phase_h/native-offline-recovery.json`. User also estimates the prior mixed browsing run was approximately five minutes; record that duration accurately and leave the continuous ten-minute gate incomplete. Rapid-swipe/hidden-audio observations were not explicitly confirmed in this reply. Do not repeat the passed recovery or account-switch timing tests. Next short native check combines saved startup sound with explicit offline sign-out and full-close/reopen; the development app's own storage namespace needs this evidence. No source changes or new runtime tests for these observations.


- Updated native account-switch repeat passed: user reports it stays responsive; compact export `2026-10-18T17:29:59.393Z` records 76 selections, 69 frames, seven incomplete, zero errors, 101 allocations/98 releases and three live/peak players. Prepared frames: 50, median 84.26 ms, p95 134.54 ms, maximum 586.82 ms; cold maximum 1,663.68 ms. Latest five Channel 2 transitions include playing/progress evidence, one interrupted. One selected-player playback-during-scroll guard event remains recorded; existing coordinator handling immediately pauses it, and corresponding regressions pass. Do not infer audible overlap from this event alone or erase incomplete/outlier samples. The original whole-app freeze was not reproduced; its exact cause remains unproven, and a failed-source Retry was not explicitly reported in this successful run. Targeted responsiveness repeat is accepted, with the earlier incident retained as a residual risk. No source changes/new runtime tests for this evidence update. Raw report/assessment: `tests/runs/device/plan_168_account_switch_followup/post-fix-compact.json` and `post-fix-assessment.json`. Next: short native offline recovery check; clarify already-performed rapid/mixed duration and hidden-audio observations without requesting another timed run.


- Native mixed-run follow-up (`2026-10-18T17:12:46.504Z`): user explicitly confirmed manual pause through overlays/backgrounding and session mute through Refresh/space changes. During A→B sign-in, one Global item showed Video unavailable; tapping Retry caused a whole-app freeze (all buttons unresponsive) requiring app-switcher close/reopen. Sign-in survived; several further attempts did not reproduce it. Treat the incident as open, not a pass. Export records 51 selections, 48 frames, three incomplete, zero errors, 81 allocations/78 releases, three live/peak players and one unexpected-playback guard event. The event is the selected publication while scrolling; existing code immediately pauses it and regressions verify that behavior. No audible overlap was reported, but the guard event is retained and not erased. Prepared 22 frames have p95 113.14 ms; cold maximum 862.28 ms. This mixed sample does not replace the already-passed labelled normal Wi-Fi sample. It does not contain an error from the frozen incident, and duration/all requested mixed checks were not explicitly confirmed. Device evidence: `tests/runs/device/plan_168_account_switch_followup/`.
- Targeted host corrections after this report: reproduced three failure paths before editing—queued callbacks revived a disposed coordinator and acquired a hidden player; synchronous native source loading escaped Retry's promise error handler; partially initialized subscriptions leaked setup. Disposal is now terminal, synchronous native load throws become retryable source errors, and partial setup removes listeners/releases its player with balanced diagnostic accounting. All 103 mobile tests, typecheck and iOS export pass; actual updated Metro bundle returned HTTP 200 / 5,172,813 bytes. No dependencies/native binary/backend changes. These are verified corrections to plausible failure paths, not proof of the reported whole-app freeze's cause or resolution. Evidence: `tests/runs/api-curl/plan_168_account_switch_followup/`. Next request is a short account-switch/Retry check, not another ten-minute run.
- Host storage during follow-up: Metro had logged ENOSPC and root had zero free space. Relocated all regenerable `/tmp/metro-cache` content (3,246 files, 34,572,774 bytes) to `/dev/shm/plan168-metro-cache`, checked the copied file-size manifest and kept the original path via symlink. About 40 MiB freed; no source/dependencies/evidence removed. This may affect development serving but is not established as the cause of the phone freeze. Keep npm cache, exports and temporary files on tmpfs.


- Native stable-Wi-Fi timing sample received (`2026-10-18T16:47:58.960Z`): 35 selections/first frames, zero incomplete/errors/issues/unexpected playback; 33 prepared forward frames, median 95.22 ms, p95 109.70 ms, maximum 111.22 ms. All 33 non-initial selections were prepared (100% normal preparation); overall preparation 94.29% includes two cold/initial selections (maximum 574.54 ms). Resources: 36 allocations, 33 releases, three live/peak players. This meets the ≥30 prepared samples / ≤300 ms p95 numerical Wi-Fi target on Video Viewer 0.1.0/build 1 under the requested signed-in stable-Wi-Fi protocol. Latest five transition details have playing/progress evidence; compact export does not independently attest identity or every omitted transition. Preserve initial samples and distinguish presentation readiness from playback progress. Report/assessment: `tests/runs/device/plan_168_phase_h/wifi-compact.json` and `wifi-assessment.json`. No source changes or new runtime tests for this evidence update. Next requested one ten-minute mixed native run consolidates rapid swipes, contexts/Refresh, lifecycle/pause/audio, session sound and account switching; remaining access/accessibility checks stay open.


- Independent auth/storage smoke passed: the user confirmed Personal/Channel playback, retained valid sign-in after fully closing and reopening Video Viewer, and the Spaces sign-in prompt after logout. Reconnecting to the development server after reopen was needed; this is a development-client/Metro dependency and does not invalidate persisted account state. Evidence: `tests/runs/device/plan_168_phase_h/native-session-smoke.json`. No source changes or new host runtime tests for this result. Next requested native timing sample: sign in first, then fresh close/reopen on stable Wi-Fi, 35 forward swipes at ≥2 seconds per video, Refresh at feed end if needed, compact report before rapid/background checks. Remaining independent-app H checks and G acceptance are still open.

- Independent iOS build succeeded: the user completed Apple authentication in their terminal, reused their existing distribution certificate, and provisioned the registered iPhone for `com.bawebtech.videoviewer`. EAS build `66023796-973d-4c98-8ad3-39fc6433d0b7` finished successfully as an INTERNAL iOS device build (development profile, version 0.1.0/build 1). CLI verification reports FINISHED with artifacts and no error. [Build page](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/66023796-973d-4c98-8ad3-39fc6433d0b7). No Apple password, certificate material or device identifier is retained in repo evidence.
- Native launch confirmed: after the user reached the development-server search screen, switched the existing Metro process to development-client mode using `s`, preserving the tunnel/server. Verified custom scheme `exp+aws-video-feed-poc`, tunnel loading page/native manifest HTTP 200, matching remote bundle hostname, and 307 native-app launch redirect. The user entered the tunnel address and explicitly confirmed video is playing in Video Viewer. Native account/secure-storage smoke remains pending; fresh sign-in is expected because this app's Keychain namespace differs from Expo Go. Direct host artifact HEAD/GET probes returned 403, so no IPA binary inspection is claimed; the user nevertheless installed/launched the app. Sanitized build/server evidence: `tests/runs/device/plan_168_phase_h/build-result.json`.
- Execution sequencing adjustment: Apple authentication is complete and the native build is installed, so move H In Progress and G Pending to obey the one-active-phase rule while running the independent-app core smoke. G's remaining acceptance requirements are unchanged and may run on this build after the H smoke; completed host/Expo Go evidence is retained, and neither G nor the plan is Complete.

- H archive preparation passed: default EAS archive inspection included the whole repository (43,488,918 bytes), so added root `.easignore` according to the installed CLI's Git-root ignore lookup. The final real `eas build:inspect --platform ios --profile development --stage archive` output contains only 44 mobile source/build-input files, 379,131 bytes; every required file's hash matches the workspace. Local environments, credential files, backend/web, dependencies and evidence are excluded. An intermediate allowlist rejected directories due to trailing-slash matching in EAS copy filtering; the empty temporary archive was caught by assertions, directory rules corrected, and the final inspection passed. Expo prebuild configuration evaluation from a separate copy of the inspected app passed with SDK 57, expected bundle/project ID, video/SecureStore and development-client plugins. Dependencies were linked only into that config-check copy; no source/node_modules change or installable build is claimed. Evidence: `tests/runs/device/plan_168_phase_h/archive-summary.json` and archive/config logs. Reference: [Expo EAS ignore files](https://docs.expo.dev/build-reference/easignore/).

- Explicit offline sign-out phone repeat passed: the user confirmed both Account's sign-in form and Spaces' sign-in prompt after tapping Sign out in Airplane Mode/Wi-Fi off, reconnecting, and Expo Reload. Combined with the prior no-password recovery result, both halves of the Account offline fix are now accepted for the reported phone checks. No new runtime tests or source changes for this confirmation. `tests/runs/device/plan_168_account_recovery_fix/observation.json` records the completed result.

- Post-fix saved-session recovery passed on the phone: offline Account now offers Retry saved sign-in and Sign out; reconnecting restored the same account without a password. The user explicitly clarified that their phrase "first sign out" meant enabling Airplane Mode only, not pressing the app's Sign out button. Do not treat that automatic restore as a logout-resurrection bug. Explicit offline button sign-out and reconnect/Reload durability remain pending; a single focused question requests that action. Evidence updated in `tests/runs/device/plan_168_account_recovery_fix/observation.json`. No further source changes for this result.

- Offline sign-out device failure: after enabling Airplane Mode/Wi-Fi off, the user could not find Sign out in Account and was instead prompted to sign in; after reconnecting, they still needed sign-in. This does not pass offline sign-out. Code review found Account treated `unavailable` like anonymous despite retaining the quarantined credential, and hid Sign out while validation was pending. Host recovery tests retain the saved token on network failure; the device report does not independently prove server revocation or a 401.
- Account recovery fix: added a tested presentation policy distinguishing authenticated, saved/unverified, and fresh sign-in states. Unavailable or deliberately quarantined saved sessions offer Retry saved sign-in and Sign out without a password form. Retry uses existing-session validation; Sign out remains available during pending validation and still clears local state before best-effort server revocation. Genuine 401/expiry continues to clear invalid credentials and show sign-in. Four new integration regressions cover offline failure → recovery without a password, offline removal/reload, pending-validation sign-out with stale-success rejection, cold offline restore/anonymous browsing, and real server rejection. Full suite now passes 100 mobile tests; typecheck, iOS export, actual AccountScreen React rendering with mocked native hosts, whitespace check, and updated Metro bundle HTTP 200 (5,171,420 bytes) passed. Component harness verified visible recovery/sign-out actions, no password inputs in unavailable state, sign-out during validation, and no resurrection after offline removal. No new dependencies or backend/browser changes. Evidence: `tests/runs/api-curl/plan_168_account_recovery_fix/`; device failure: `tests/runs/device/plan_168_account_recovery_fix/observation.json`. A two-part phone repeat is pending: recover the retained account without signing out first, then explicitly sign out offline and verify anonymous state after reconnect/Expo Reload. G remains In Progress.
- Storage during this fix: moved three task-related dependency tarballs from the disposable npm cache to hash-verified tmpfs backups behind symlinks, freeing about 15.2 MB. No source or installed dependency was removed. Continue task npm cache/TMPDIR in /dev/shm; root disk is critically low.

- Account-switch phone check: the user used two existing accounts. A logout opened anonymous Global and stopped A's audio; B sign-in showed B's identity, personal content and expected spaces without A-only spaces; Expo Reload retained B's valid sign-in and opened Global. These checks pass. The user explicitly confirmed that after B logout, Spaces shows the sign-in prompt; no Back button on root Global is expected. The functional two-account identity/content/session/logout-navigation check is passed. Observation: `tests/runs/device/plan_168_navigation_fix/account-isolation-observation.json`. No source changes or new runtime tests for this evidence update.

- Signed-in offline recovery passed on Channel 2: with Airplane Mode on and Wi-Fi off, the user saw Cannot verify access immediately; it persisted after background/reopen and waiting 20 seconds. Restoring connectivity resumed video immediately in the same signed-in account, without another login or a manual Retry. Immediate offline failure and automatic recovery satisfy this functional check. This does not establish offline sign-out or invalid/expired-session behavior. Observation: `tests/runs/device/plan_168_navigation_fix/signed-in-offline-observation.json`. No source changes or new runtime tests for this evidence update.

- Signed-in lifecycle check passed on Channel 2: Settings Done returns to the still-paused video; the user explicitly confirmed manual pause also survives background/foreground and lock/unlock until Play is tapped. For initially playing video, audio stops throughout the hidden/locked interval and playback resumes with sound at the previous position on return, following a brief access check/loading indicator. These are user-observed functional checks, not a timed ten-minute resource report or memory profile. No source changes or new runtime tests for this evidence update. Observation: `tests/runs/device/plan_168_navigation_fix/signed-in-lifecycle-observation.json`.

- Post-fix phone repeat received: the user switched Global/Channel 2 more often than in the failing run and reports smooth subsequent swipes without the failure cascade. Compact report `2026-10-18T15:21:53.721Z` records 81 selections, 79 first frames, two incomplete transitions, zero errors/issues/unexpected playback, 92 allocations/89 releases, three live/peak players. Prepared frames: 50 samples, median 81 ms, p95 124 ms, max 132 ms; normal first-frame p95 284 ms. Latest five Channel 2 transitions have playing/progress and frame evidence. The navigation/player-starvation regression is accepted as recovered on this phone run. Full report is saved at `tests/runs/device/plan_168_navigation_fix/post-fix-compact.json`; the user did not label this run's network, so do not claim the separate stable-Wi-Fi target gate from it.
- Channel entry behavior: the user observes roughly 300 ms of account/access checking, then about 500–700 ms of first-video loading, followed by immediately prepared swipes; returning to Global lacks the access-check step. Current code validates the native session and space access on protected-feed entry, while Global needs no space gate. Context replacement cold-loads its initial player. This short entry delay is distinct from the recovered allocation failure. Preserve cold/incomplete samples: initial first-frame median 645 ms and maximum 4.39 s; normal maximum 3.25 s. Compact data cannot identify the circumstances of all outliers. Entry latency optimization remains separate from this accepted functional recovery. No source changes were made for this result.

- Navigation fix: the user's compact report generated at `2026-10-18T15:07:19.369Z` identifies repeated `player_allocation / budget_exhausted` failures, with 33 allocations, 30 releases, live/peak three, zero unexpected playback, 34 transitions and four errors. They reproduced anonymous/signed-in Global working initially, slower Channel 2 playback, then every-other and ultimately near-universal failures after switching back and forth. This is one report supplied twice, not two independent runs.
- Root cause reproduced using the installed React Navigation 7 stack reducer: `navigate('Feed')` from Spaces or Account pushes a new Feed route rather than returning to the old one. Old blurred Feed routes retain one paused player each, starving the shared budget without exceeding three live players. Logout removes the navigation stack, which explains recovery. The initial temporary render harness replaced a single feed directly and therefore missed navigation-stack accumulation. Primary behavior reference: [React Navigation 7 migration: navigate and popTo](https://reactnavigation.org/docs/upgrading-from-6.x/).
- Corrected both Spaces selection and Account Done to use a shared return helper that pops to the existing Feed. Its focus guard ignores late Account completion after an auth-group reset. The three-player limit and deliberate current-player retention during temporary screens remain intact. Four regression tests use the actual stack reducer plus actual coordinators/budget: reproduce starvation with the old action; verify one Feed, prepared swipes, zero issues and balanced release across 20 context switches/220 swipes; preserve position/manual pause through temporary screens; ignore completion from a removed Account route. Final checks passed: 96 mobile tests, mobile typecheck, iOS export, whitespace check, and updated Metro bundle HTTP 200 (5,169,828 bytes). Host evidence: `tests/runs/api-curl/plan_168_navigation_fix/`; extracted device observation: `tests/runs/device/plan_168_navigation_fix/`. The user is asked to Expo Reload to discard the old duplicate-route stack and repeat Channel 2/Global switching. Physical-device recovery is pending; G remains In Progress.
- Host storage follow-up: backed up and evicted about 14.4 MB of generated backend transpilation cache from the task's `/tmp/.ts-nodea2zc3l/compiled` into `/dev/shm/plan168-compiled-cache-backup/` to allow source/docs/evidence writes. No source or installed dependencies were removed. Continue using the task npm cache/TMPDIR because root disk remains critically low.

- Device follow-up: the user confirmed anonymous Global, existing-account sign-in, Personal/Group/Channel navigation, and restored sign-in after Expo Reload. They reported a playback regression after browsing a Channel and switching to signed-in Global: progressively longer spinners, then Video unavailable; feed Refresh did not recover, while signing out and browsing anonymous Global did. This is an unresolved G failure, not acceptance. A compact report from the failing phone state is requested, including time to failure and whether audio continues.
- Follow-up investigation: a live ordinary-fixture-account comparison returned 200 for both Global pages (20 + 9 items), matching anonymous/signed-in publication IDs and playback URLs; playback URLs had no signature query parameters. Ten sampled HLS masters returned 200. A temporary React render harness exercised the actual feed/hooks with mocked native players through ten Channel/Global cycles, 150 swipes, validation and Refresh: 206 allocations/releases balanced at teardown, peak three, zero unexpected playback. It did not reproduce the failure and does not test iOS decoding/display/network behavior.
- Added diagnosis only: retain recognized iOS error domains/numeric codes from status and source-load failures, identify native allocation versus shared-budget rejection, retain feed context/auth generation in compact issues/transitions, and record progress independently of first-frame events. No raw error messages, media URLs or credentials enter exports. The playback regression is not claimed fixed. Final host follow-up passed 92 mobile tests, typecheck, and iOS export; evidence is in `tests/runs/api-curl/plan_168_playback_followup/`. The temporary React harness dependencies remain outside the repository. Root disk is full; final npm checks used the task cache and TMPDIR in /dev/shm. The prior generated mobile/dist export and 14 native-session/viewer compiled cache files were backed up in /dev/shm before eviction. The RN 0.86.3 cached tarball was hash-verified and relocated to tmpfs behind a symlink to free about 3.9 MB. No source, installed dependencies or unrelated data were removed. The updated Metro development bundle returned HTTP 200 (5,169,030 bytes). An initial documentation write hit ENOSPC; its truncated tail was restored and checked before handoff.

- Final handoff checks: standalone TypeScript checking passed for all five new fixture/integration scripts; final iOS export/typecheck passed after applying React Navigation auth-group keys to clear account-specific navigation history. Document links/fences/phase statuses and whitespace checks passed. Agent docs checker still reports the same 16 historical plan status errors, with no new finding. A leftover read-only Phase A audit process was terminated; the serving backend and Metro tunnel remain running.

- Final host results: 87 mobile tests passed; mobile typecheck passed; final auth-focused rerun passed 16 tests after the last session-message adjustment; final iOS export passed (871 modules). The existing Metro server also served the development bundle successfully (HTTP 200, 5,165,138 bytes). Expo Doctor passed 21/21 checks; root/mobile manifest-lock dependency agreement and npm dependency checks passed.
- Backend build and 14 contract tests passed, including the new browser session-store failure/503 check. The final real session integration passed 24 assertions, including browser deletion eligibility and CSRF mutation. The final viewer integration passed 150 assertions, including two-account isolation, real membership removal between pages without owner/public shortcuts, pending/unpublished exclusion, ended subscriptions, cookie/native parity, and sanitized errors. Live HTTPS/media check passed 17 assertions (including malformed/oversized credential-body sanitization and direct HTTP rejection); browser regression passed 8 checks through actual UI login and space switching. These host checks do not establish native phone behavior.
- Consolidated API/mobile/build evidence: `tests/runs/api-curl/plan_168_phase_g/`. Browser run and sanitized screenshot: `tests/runs/playwright/plan_168_phase_g/`. Fixture passwords and native bearer patterns were scanned and absent from exported text evidence. Existing Plan 167 continuity changes were preserved.
- Browser gate initially hit a backend restart and a test wait race; the final test waits for the actual video element and passed against the stable development host. No frontend source or deployed bundle was changed to make that test pass.
- Additional auth review: deleted users are now excluded by shared browser session parsing as well as native validation. Session parsing records store failure so new cookie-authenticated viewer routes return retryable 503 rather than invalidating a valid identity. Native JSON parser errors are sanitized before request logging; every new-route response sets no-store, including CORS errors. Rate limits check IP before creating account keys.
- H preparation: linked EAS project `05dcc3ca-6946-490f-af82-9b3acfe3212c` under mbcollins2/aws-video-feed-poc; app name Video Viewer, iOS bundle com.bawebtech.videoviewer. SDK-compatible expo-dev-client 57.0.20 installed; development/internal and simulator profiles configured. EAS CLI 25.2.0 noninteractive device build stopped before a successful build because no suitable internal-distribution signing credentials exist. Evidence: `tests/runs/device/plan_168_phase_h/build-blocker.log`. Membership is confirmed; interactive Apple authentication remains pending as recorded below. No credentials were requested in chat or stored in the repo.
- Current host configuration: ignored backend .env enables native sessions and trusts the verified loopback Nginx proxy; insecure loopback access remains disabled on the serving process. Public .env.example defaults all native flags off. Live native login/validation and anonymous viewer reads work over the existing HTTPS origin. Existing Expo tunnel remains running at exp://tt3-jho-mbcollins2-8081.exp.direct.
- Signing follow-up: the user confirmed an Apple Developer membership. The interactive EAS development build reached Apple authentication; the remembered Apple session had expired and the CLI requested a password. Cancelled at that prompt without collecting a password or two-factor code. The user must complete Apple authentication directly in a terminal, then signing/device registration and the actual build can continue. No successful native build/install is claimed.
- Required input: the navigation fix now has a successful phone repeat as recorded above. Continue the remaining signed-in lifecycle/network/performance/access checks in G. A real signed development build in H is still required before marking this plan Complete.

- Phase F host gate: typecheck and 86 mobile tests passed. Added foreground/access guard cancellation, coalescing, denial/retry, cross-context player budget, screen-blur readiness, neighbor-release, and manual-pause tests. Existing diagnostics already aggregate resources across coordinator sessions; context/focus evidence now stays in that bounded local report. An app-wide allocation budget enforces the three-player cap. Protected playback is withheld during revalidation, and transient validation failures retain a hidden paused coordinator so retry preserves manual pause. Phone acceptance is still pending in G.

- Phase E host gate: typecheck, all 79 mobile tests, and the complete iOS navigation/auth/feed bundle export passed. Added six viewer/context/denial tests; installed React Navigation 7.5.1/native-stack 7.21.0 and SDK-compatible react-native-screens ~4.26.0 (resolved 4.26.2). Root/mobile runtime pins unchanged. Native UI uses one feed route, account isolation generations, typed space list, and native-stack navigation; physical checks consolidated in G.

- Phase D host gate: mobile typecheck and all 73 tests passed, including 15 new session/storage/transport tests; iOS export passed (622 modules; new screens are wired into the bundle in E). Added SDK 57 SecureStore 57.0.4. Inspected installed Expo iOS fetch implementation: redirect=error cancels redirect following and credentials=omit disables cookies; native API transport uses expo/fetch, not React Native's redirect-ignoring fetch path. Device confirmation remains required in G. Logs temporarily in /dev/shm/plan168-mobile-d.log and /dev/shm/plan168-ios-d.log, to consolidate into harness evidence at handoff.

- Phase C: backend build and 13 backend contract tests passed; real viewer integration passed 132 assertions (`LOG_LEVEL=error TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register scripts/check-native-viewer.ts`). Verified cookie/native access parity across nine fixture spaces, payload allowlists, pagination, banned/nonmember denial, subscription expiry, malformed cursors, stale bearer rejection, and shared web/native members-only/hidden publication filtering. Evidence: `tests/runs/api-curl/plan_168_phase_c/`.
- Execution sequencing adjustment: the user is unavailable overnight and authorized continuing until input is needed. Consolidate the phone checks described in D/E/F into G after the host implementations and test gates pass; do not waive any physical-device acceptance. H still requires a real independent build.

- Phase B: backend build passed; 10 focused native-session tests passed (`node -r ts-node/register --test tests/backend/nativeSession.test.ts`); real-backend integration passed 23 assertions (`LOG_LEVEL=error node -r ts-node/register scripts/check-native-sessions.ts`). Migration ran twice successfully. Checked hashed storage, token isolation from admin/legacy auth, expiry/revocation/password change/deleted user, browser login/logout continuity, and real browser CSRF mutation (missing token 403, valid token 200). Evidence logs: `tests/runs/api-curl/plan_168_phase_b/`. No native credential was exported.

- Phase A executed: 58 mobile tests, mobile typecheck, and backend build passed. Ordinary member baseline confirms public/own feeds allowed and private nonmember denied. Isolated two-member fixtures and nine spaces created with public Global media only (ignored credential record); actual confidential delivery is excluded. HLS master/variant/poster returned 200; segment range 206. Evidence: `tests/runs/api-curl/plan_168_phase_a/audit.json`.
- Phase A decisions: use database-backed login limits (10/account and 30/trusted IP per 15 minutes) so multiple processes share enforcement. Trust forwarded TLS/IP only from a configured loopback reverse proxy; current Nginx replaces protocol and appends the true peer IP. Native session rows also bind to a digest of the current password hash, so existing admin password changes invalidate native credentials without rewriting browser sessions. Deleted users are rejected at validation.
- Phase A policy gaps to fix in C: shared feed SQL omits visible_in_space and members-only publication constraints; subscription listing ignores ended_at, role labels miss canonical space_admin, and ban-query failure currently permits access. Existing published rows are all inherit/visible-in-space, so explicit filtering preserves the baseline sample.

- Planning environment: repository `/home/ubuntu/aws`; `main` synchronized with `origin/main` at the prior implementation commit `d7a286f`; the existing local Plan 167 post-commit continuity note is preserved.
- Read the implementation planning/template/index, policies, database guide, accepted POC plan, feature/context contracts, actual auth/session middleware and login routes, feed/space services, native client/store/player, and web space-switcher implementation.
- Consulted primary documentation for SecureStore, React Navigation authentication flows, Expo development builds, and CloudFront signed URLs on 2026-10-18. Latest SDK documentation is guidance, not permission to install SDK 58 packages into the current SDK 57 app. Navigation should derive protected screens from current auth state; see [React Navigation authentication flows](https://reactnavigation.org/docs/auth-flow/).
- Planning baseline `npm run check:agents:docs`: fails with the same 16 pre-existing status-header findings in Plans 138, 140–142, and 148–159. These are unrelated to this milestone.
- Planning document checks passed: all relative Markdown links resolve, code fences balance, required plan sections exist, and all eight implementation phases are Pending. `git diff --check` passed. Re-running `npm run check:agents:docs` produced exactly the same 16 baseline findings and no new finding.
- Created the private roadmap Page and verified its title and all content by readback (32 canonical blocks). Rendered Page layout and Mermaid preview were not inspected; no Page preview capability was available in this workflow.
- The original planning-only validation did not execute runtime gates. Subsequent execution results supersede that planning state above; native physical-device gates remain pending.

## Open Risks / Deferred

- Large accessibility text sizes clip inside pill controls; user accepts this limitation for the milestone. Left-to-middle slider sizes were reported good. Do not claim full maximum-size accessibility from this evidence.

- One independent-app account-switch/Retry whole-app freeze remains unexplained. The targeted updated-build account-switch repeat passed (76 selections, zero errors, cap three); retain the original incident as a residual risk. Host regressions address stale ownership and synchronous setup failures, but do not prove the exact cause or resolution of an iOS main-thread/native runtime freeze.

- Feed authorization does not protect copied public HLS URLs. Private-media requirements may add a separate prerequisite plan; Phase A must resolve this for the chosen acceptance content.
- Existing My Spaces lists are not themselves proof of current access, and publication visibility requires confirmation against runtime behavior. Service-level flaws must be fixed for both clients.
- A 30-day absolute native token favors a small, revocable initial design; renewal, device-session management UI, and broader account-lifecycle invalidation need later scope before public release if current hooks are insufficient.
- Offline sign-out clears local access but cannot prove server revocation. Storage failures and delayed requests must not restore the removed session.
- Legacy broad public-feed responses remain exposed until their own compatibility migration. New response allowlists are not a retroactive fix.
- Continuous authorization checks bound app-side detection; already-buffered media and CDN access have their own revocation characteristics.
- Expo/Apple signing access and development-build device installation are operational dependencies. Do all authorized local preparation first; record an exact blocker only when encountered.
- The current host had limited disk space during Plan 167 validation. Check available space before installs/builds and use task-scoped temporary paths; do not remove unrelated files or disrupt the running Expo preview.
- Plan 166 remains separate active moderation work. This plan does not depend on its reporting-model changes because native reporting is deferred.
- Profiles, captions, stories, discovery, sharing, memberships, engagement/reporting, messages/production analytics, TestFlight, App Store delivery, and Android remain subsequent roadmap milestones.

## Resume Here

Plan 168 is Complete (A–H), with user-approved deferrals and recorded evidence limits. No required work remains within this accepted viewer milestone.

1. Final device access/expiry checks and fixture cleanup passed. Private driver state is **complete**; original fixture subscription active/ended_at null, expired session revoked, zero new active fixture sessions. Normal accounts were not changed. User can return to their normal account; no further test-account login is needed.
2. Preserve the limits: VoiceOver explicitly deferred, high-text pill clipping accepted, too-fast manual cancellation replaced by controlled actual-component race checks, prior one-off whole-app freeze non-reproduced/unexplained, public fixture media only, no release memory/thermal or App Store qualification. User-observed mixed protocol and compact-history limits remain recorded. Do not repeat passed tests absent a regression.
3. Metro remains in development-client mode on port 8081, unified exec session **21522** (old 68614 dead). Address `https://tt3-jho-mbcollins2-8081.exp.direct`; native launch link ends `/_expo/link?choice=expo-dev-client&platform=ios`. Restart from mobile with `npm_config_cache=/dev/shm/plan168-npm-cache TMPDIR=/dev/shm NODE_COMPILE_CACHE=/dev/shm/plan168-node-compile-cache npm run start:dev-client`. The existing iOS build needs Metro; ordinary JS changes need no new native build. Npm download-cache cleanup recovered 3.54 GiB, leaving ~3.9G free; preserve active editor/browser/monitoring files and private credential records. Tmpfs caches are regenerable.
4. Implementation committed as `6cfad70` (`feat: add signed-in native viewing across Global and Spaces`), including prior Plan 167 continuity edits. Pushed to `origin/main` at the user's explicit request; remote HEAD matches local HEAD. Only this required post-commit SHA/validation/push note remains uncommitted; no application-code change remains outside the commit. Next recommended product increment: creator profiles and authorized personal-space entry under a new detailed implementation plan. Later discovery/stories/captions/sharing, participation, TestFlight/App Store and Android remain separate scope.

The repository roadmap is the primary user-accessible artifact; the optional Page link was unavailable to the user. This milestone maintains the existing web client over the shared backend and accepts the installed iPhone development viewer, with the exceptions above.
