# Plan 176: Shared background access confirmations and continuous native navigation

Status: Active

Created: 2026-10-25

Implementation authorized on2026-10-25. Existing work is committed as `407fe73`; no new commit or push requested. Phase A is Complete; Phase B is Complete; Phase C is Complete; Phase D is Complete; Phase E is Complete for build24; Phase F In Progress. Revision R1 is In Progress for fresh native decoder ownership across feed visits; the user now reports normal sound during playback, but full build/pause/time/audio qualification is not established. Revision R2 is In Progress for visible progress labels requested to identify remaining waits. Contracts below guide implementation; phase validation records distinguish proposed and implemented behavior.

## Feature Reference

- [Native viewing roadmap](../roadmaps/roadmap_native_viewing.md)
- [Context integrity and distinct relationships](../features/feature_02_personal-space-global-feed-context-integrity.md)
- [Plan175 checkpoint and build23 investigation](plan_175.md)
- [API documentation](../../docs/API.md), [testing policy](../policies/testing.md)

## Context

The user reports smooth forward paging but disruptive waits when entering a space from Launch and returning to Global. Build23 made the Launch overlay immediate, but space entry still commonly displays Checking access and Global return displays Loading videos. The requested design is to reuse access already confirmed by the server, renew it in the background, and retain a maximum 60-second access age without making every player/navigation wait for a new response.

A separate morning incident involved buffering/unavailable, apparently unsuccessful saved-session retry, and recovery after logout/login. The observed server session was unexpired. A controlled actual-component probe reproduced successful account recovery leaving a failed video unavailable until its separate video Retry. That establishes a recovery defect to address, but does not establish the phone incident's cause.

In scope:

- One account/API-scoped, in-memory owner for bounded session, space and exact-publication playback confirmations; quiet renewal and deadline enforcement shared across routes.
- Eliminate redundant session preflights where the requested protected response already validates the bearer and permission. Keep all server checks.
- Prepare a bounded number of Launch destination entries, reuse authorized feed data, retain one bounded original Global page and preserve exact media identity, position and pause intent. Revision R1 isolates native decoder ownership across feed visits after build24 audio feedback.
- Keep transient verification errors distinct from ended sessions and actual denial. Recover account/access/feed/media coherently without logout, preserving manual pause/time.
- Migrate existing Follow, Comments and text verification ownership without extending data freshness or granting new capabilities. Diagnostics, regression gates and signed-device acceptance.

Out of scope:

- New age-verification, payment, membership approval or discoverability workflows; Following remains independent of access.
- Redis/server authorization caches, push invalidation, JWT/session-format replacement, sliding sign-in lifetime, offline downloads, durable permission/page caches, private CDN/HLS enforcement, TestFlight/public release.
- Unrelated browser behavior, broad permission/schema rewrites, or speculative fixes for the historic native freeze/cold186 stall.

Constraints:

- Preserve build23, its evidence and the user's deferred offline/nested phone check. Do not silently mark Plan175 E/F Complete.
- Maximum three live native players across active/parked/prepared ownership; one may play. Prefetched feed JSON is not permission to allocate extra players.
- No credentials, bearer tokens, raw media URLs, signed artifact URLs or private membership details in committed evidence/diagnostics.
- Phone fixture session128 was last verified active earlier; old105 is revoked. The build26 export includes account generations1/2/3, which do not identify the current server session. Preserve current phone sign-in, exact restored grants and Follow state; re-identify the actual current session before further session/fixture mutation or final sign-out. IDs are historical evidence, not permanent configuration.

## Investigation — Current Behavior and Evidence

| Area | Inspected owner / observed behavior | Consequence |
| --- | --- | --- |
| Initial space entry | `mobile/src/feed/useViewerFeed.ts` calls `auth.validate()` before its authorized feed GET. `InitialFeed` shares that feed with the first guard only. | Separate session RTT still blocks first protected data. |
| Routine access | `auth/useSpaceAccess.ts` owns a screen-local guard; renewal calls session GET followed by `feed?limit=1`. Blur/background clears its value. | Re-entry repeats verification even within the preceding 60 seconds. A one-row probe does not confirm the selected publication. |
| Lease primitive | `auth/verifiedRefresh.ts` renews at45s, expires at60s from original request start, but clears value immediately on any error. | Quiet success is supported; transient failure throws away remaining valid authority. |
| Account lifecycle | `auth/authStore.ts` coalesces concurrent validates; non401 failure publishes unavailable. `auth/useAuth.tsx` validates on foreground and has a60s fallback timer. | Screen owners and foreground ownership can duplicate work; account unavailable hides playback, including Global. |
| Launch | `spaces/launchPreparation.ts` prepares one selected-source list; `launchStore.ts` keeps it30s. Every `enter()` resolves again. Resolve currently rejects all query fields. | List preparation does not contain a feed or reusable playback confirmation. |
| Navigation | `navigation/ViewerNavigator.tsx` transitions by keyed feed remount. `globalLaunchJourney.ts` retains a scalar checkpoint, not feed data. | Back to Global requests a new anchored page before restoring a frame. |
| Media | `playback/playerHandoff.ts` transfers one ready, exact matching production/creator/URL player with a15s parking limit. Native port loads HLS directly. | Avoiding an access wait alone cannot guarantee buffered readiness; keep media ownership independent. |
| Other surfaces | Creator Follow and Comments perform account preflights and own renewal; feed Follow, recognition and captions/story also own freshness/lifecycle. | A feed-only change would leave competing clocks, inconsistent denial/recovery and unnecessary checks. |
| Server session | `features/native-sessions/service.ts` checks SQL session/user/credential validity on every authenticated request. Tokens have a fixed30-day expiry. | Removing a client session preflight does not remove server validation of the data request. |
| Server space | `features/spaces/service.ts` checks bans, role checker, owner/member, public settings or active subscription; personal spaces require explicit authority. `security/permissions.ts` builds role permissions through two SQL reads. | Do not ship raw role configuration to the phone or infer permission solely from membership/Follow. |
| Global public eligibility | `features/feeds/repo.ts::listGlobalFeedRows` uses the same public row predicate with/without a user; user ID affects liked/commented/reported EXISTS fields. Viewer serialization omits those caller-specific flags. | Current Global video rows can be retained as public data once this invariant is covered by server contract tests; no second anonymous preflight is needed. |
| Server publication | Feed repositories filter published/viewable rows. Launch checks actual source/destination production and upload creator, including rechecks. Follow/engagement apply their own exact-source and write rules. | Space access alone cannot authorize every cached publication or every action. |

Recorded Plan175 read-only evidence: `tests/runs/build/plan_175/session-navigation-investigation-build23.json` and `recovery-investigation-build23.json`. Captured morning API logs show346 completed requests:344200, logout204 and login201; no captured4xx/5xx. Session validation server processing was0.89–2.43ms, median1.28ms; Global55.08–175.46ms and space35.49–159.61ms. These exclude phone RTT/TLS/response delivery/UI/native media and requests that never reached the host. They do not prove SQL is never slow or identify the phone failure.

The old test session105 was unexpired and credential-valid until explicit logout at15:16:42Z; new128 was issued15:18:17Z. Current evidence favors investigating client transport/state/media recovery rather than assuming normal token expiry. Build23 full phone report and incident time/context are still missing; planning can proceed without inventing them.

## Locked Decisions

These are the approved implementation contracts. Reopen a decision explicitly if implementation evidence requires a change.

1. **Server authority remains on every protected API request.** The mobile snapshot controls reuse of already delivered content in the compliant viewer. It is not a bearer capability and cannot bypass server checks or authorize writes. This follows [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
2. **Maximum confirmation age remains60s.** Begin quiet renewal at45s, earlier if a known session/subscription/policy boundary shortens validity. A cache hit, screen return, request start or pending response never resets a deadline. A successful new check may replace only the scopes it actually checked. [RFC7662 security considerations](https://www.rfc-editor.org/rfc/rfc7662.html#section-4) explain the revocation tradeoff of cached security decisions; our opaque native session API is not OAuth introspection.
3. **Identity, access, data and media readiness are separate state.** An existing valid credential can be temporarily unverifiable. Space authority is distinct from exact-publication authority, Follow/count freshness, comments posting capability and media buffering.
4. **Memory only, account isolated.** One provider-owned manager per normalized API origin and auth generation/credential instance. Keys include space, action and relevant publication/source tuple. No raw token in a cache key, diagnostic or persisted file. Destroy all entries on sign-out, identity/origin change or current-session401.
5. **Navigation may reuse valid confirmations.** Blur does not revoke them. Background immediately stops playback and masks protected presentation; the elapsed deadline continues. On foreground, check elapsed time synchronously before showing/playing anything protected. Reuse only the remaining valid interval and renew quietly; an expired or uncertain clock requires a fresh check.
6. **Unknown/expired access can still wait.** First entry without a prepared, valid exact-publication result must obtain one server response. No stale protected playback after expiry, including offline. A delayed response can establish a fresh result only if its own original validity is still positive and no newer denial/identity change superseded it.
7. **Use fewer requests before adding server infrastructure.** Remove redundant client session preflights and duplicate request-local permission work. Keep live SQL authorization per protected request. Do not introduce cross-request server decision caches or invalidation infrastructure in this increment.
8. **Bound speculative preparation.** Prepare at most two visible Launch destinations, two concurrent entry requests, one active navigation and one retained Global origin page of at most20 items. Cancel source/account-invalid work and prioritize the tapped destination. No all-space permission download on login and no background crawl.
9. **Preserve exact identity and playback intent.** Source/destination must match current publication, production and upload creator. Native player reuse, if enabled, additionally requires exact media URL; R1 disables cross-feed native reuse for audio isolation. Preserve manual pause/time; cached data never invents a matching video or resurrects a removed publication.
10. **Failures are scoped and actionable.** Current-session401 invalidates account authority. Confirmed space403 invalidates that space, not sign-in. Missing exact publication invalidates that publication/source and dependent entry. Posting-only denial disables that capability without revoking readable video. Timeout/network/5xx retain only the remaining valid interval; do not renew it.
11. **Recovery is read reconciliation.** One explicit Retry can repair identity verification, access, feed and the selected failed player. Never automatically retry Like/Follow/Comment writes or resend a draft. Preserve existing uncertain-write reconciliation.
12. **Private media enforcement remains separate.** The current HLS path is independently fetched without an app bearer. This plan bounds compliant-app access reuse; it does not revoke copied URLs, secure a public distribution or guarantee stop within60s on a frozen OS process.

## Runtime Contract

### Confirmation Envelope and API Changes

Add optional, versioned `access` metadata to native viewer session/feed/entry responses. Existing build23 response fields and behavior remain compatible. New client adapters validate the envelope and bind it to their captured identity/request; missing or malformed protected proof never grants cached playback.

The envelope contains `version:1`, server-derived `viewerId` for authenticated proof, session validity duration, optional space-view validity and a bounded list of publication-view confirmations. Global additionally supplies a separately identified public-view freshness budget, which is not contingent on account verification. Each publication confirmation binds to the actual returned feed item: space/publication/upload/production/upload-creator and media identity. Do not accept caller-provided creator/production/allowed values as authority. Do not return raw roles, subscription records or hidden-space lists. `view` confirmation does not grant `follow`, `comment`, `like` or management actions.

Implemented logical shape (existing feed/entry fields remain intact):

```ts
type AccessMetadata = {
  version: 1;
  identity?: { viewerId: number; remainingMs: number };
  spaceView?: { spaceId: number; remainingMs: number };
  publicationViews: Array<{
    publicationId: number; spaceId: number;
    uploadId: number | null; productionUlid: string | null;
    creatorId: number | null; remainingMs: number;
  }>;
  publicView?: { remainingMs: number; publicationIds: number[] };
};
```

Publication proof is attached to the checked response's actual item tuple, including its media URL; matching only an ID from a different payload is insufficient. A missing production/creator can remain a viewable legacy item if current policy permits it, but cannot qualify for exact Launch matching or cross-feed player handoff. The metadata is not accepted as authorization input by any server endpoint. A protected space requires identity, space and selected-publication proof; a public Global row uses public freshness independently.

- Each duration is a nonnegative integer at most60000ms; zero grants no usable interval, conservatively capped by known expiry boundaries. Anchor the server budget before the earliest authorization read contributing to the result; subtract server elapsed time before serialization. Never grant a new full interval to a reused server result.
- Client records monotonic `requestStartedAt` before sending and `receivedAt` after parsing. Use `deadline = requestStartedAt + min(60000, remainingMs)`, intersected with the session deadline from this same newly validated response and any shorter known policy boundary. Update that session proof before computing the new intersection; do not cap a fresh successful renewal to an obsolete previous session-confirmation deadline. Subtracting server elapsed again is deliberately conservative. Reject proof already expired on receipt; never anchor validity to receipt time.
- Session expiry is enforced using a server-derived remaining duration, not a device wall clock alone. Space validity also accounts for scheduled applicable ban starts and subscription end if they affect the granting path. Do not shorten an owner/member's grant merely because an unrelated subscription expires. Derive boundaries in the same shared server policy helper; no second authorization policy in the route serializer.
- Feed proof covers only rows actually returned after authorization, never arbitrary future publications. Renewing only selected/neighbor items does not refresh an entire cached page's age. No304 or HTTP cache response silently extends proof; use private/no-store HTTP headers while allowing explicit memory reuse in the app.
- Native session login/restore can seed identity proof. Fetch per-space proof lazily when used/prepared; login does not download every permission. Existing `/me/spaces` labels/list membership are not playback proof.

Implemented routes:

| Route | Proposed behavior |
| --- | --- |
| Existing GET `/api/viewer/v1/spaces/:id/feed` | Keep existing filtering/anchor contract; attach proof for the returned rows and space/session. No preceding session GET required. |
| Existing GET `/api/viewer/v1/feed/global/publications/:publicationId/spaces/:spaceId?include=entry` | New opt-in query, strictly validated. Perform current source/destination checks and return existing destination fields plus an authorized20-item anchored `entry` page and proof. No second feed/session request on successful entry. Legacy no-query resolve remains unchanged. |
| New GET `/api/viewer/v1/spaces/:id/playback-access?publicationIds=...` | Lightweight read, at most three unique positive IDs: selected and current neighbors. Validate session/space and fetch those exact authorized publication rows through shared feed policy. Return current adapted item identity plus proof for allowed rows; missing rows get only opaque unavailable IDs. Space denial403, session denial401. No engagement/count/text payload. |
| Existing protected Follow/engagement/comments/text reads | Keep server policies and data contracts. Eliminate redundant client session preflight. Successful reads may seed session proof, but must not extend publication playback proof unless they explicitly return that checked scope through the shared contract. Their own data/capability freshness remains separately bounded. |

Entry response construction must retain the current final source/destination rechecks. If the requested target disappears during page construction, return the existing opaque target-unavailable outcome; do not redirect to an unrelated video. Handle an empty-but-viewable space distinctly from denial. Scheduled policy boundary discovery must cover site and space bans; if a safe bound cannot be computed, issue no reusable grant and record the blocker rather than invent a long duration.

The new playback-access read must not become a duplicate media policy. Reuse actual viewer feed eligibility and serialization, including private/personal rules, missing/deleted creator behavior and the current publication filters. A caller can guess IDs but cannot receive media or proof without the same authorization as the real feed.

### Shared Manager and State Transitions

Implemented manager: `mobile/src/auth/accessManager.ts` and a provider/hook beside `useAuth.tsx`. Inject clock, scheduler and transport for deterministic tests. Existing `VerifiedRefresh` remains for unrelated callers until explicitly migrated; do not silently change its semantics globally.

Manager operations: observe/seed a checked response, acquire/release a visible scope, obtain an immediately usable snapshot, ensure missing proof, force recovery, invalidate exact scopes, dispose. A synchronous `canPresent/canPlay` check verifies identity and deadlines even if a JS expiry callback was delayed.

| State/event | Presentation/playback | Background work |
| --- | --- | --- |
| No proof | Block protected content; retain safe navigation shell | One coalesced check for the requested scope |
| Valid proof before renewal | Present/play immediately if data/media ready | Reuse; no navigation preflight |
|45s renewal due | Continue with remaining valid proof | One shared quiet refresh; no full-screen spinner |
| Transient renewal error | Continue only until original deadline; optional unobtrusive status | Bounded retries around50s and55s, respecting Retry-After and deadline; no busy loop |
| Deadline reached without replacement | Pause/mute; mask protected data and disable protected actions | Show Cannot verify access / Retry, preserve route and pause intent |
| Explicit scoped denial | Stop affected content immediately; clear its data/proof | No silent grant or sign-in prompt for space-only denial |
| Successful Retry | Reconcile required reads and selected failed media | No logout and no write replay |
| Background/identity change | Stop all audio immediately; mask protected surfaces | Cancel or detach consumers safely; identity change destroys all cache |

One scheduler manages the earliest active deadline/renewal. Foreground work covers the visible feed and selected/neighbor publication proofs or the currently visible protected surface. Dormant entries expire naturally without being kept alive by timers. Concurrent feed/profile requests for the same proof share work; cancelling one consumer must not cancel another's request. Abort when the last consumer leaves unless it is an explicitly bounded prepared-entry request.

Bound metadata with an initial128-record LRU cap, prioritizing active proofs; do not evict an active proof without immediately updating eligibility. Store no unbounded publication history. Response acceptance checks request sequence, auth generation and scope invalidation epoch: an older in-flight success cannot overwrite a newer denial, explicit Refresh or mutation invalidation. A current-session401 from a current captured credential invalidates it; a late401 from a replaced credential cannot log out its replacement.

AuthStore retains a distinction between credential present, recently confirmed, verification temporarily unavailable and definitively ended. A transient check must not publish a global playback-blocking state while relevant authority is still valid. At expiry block protected usage, retain the quarantined credential for Retry, and offer public Global. Restore after process restart has no memory proofs and validates before protected use. Keep30-day token lifetime and durable sign-out/storage suppression unchanged.

### Navigation and Data Continuity

- Keep source Launch-list preparation and its30s metadata lifetime. While the chooser is visible, prepare the first two visible destinations using the combined entry response; no speculative space feed request before server-authorized destination discovery.
- A tap consumes a matching, still-valid prepared entry synchronously. If preparation is in flight, join it; if missing, send one combined request. Display the chooser/origin with a localized Opening state and usable Close; do not transition to an empty feed solely to show Checking access. Genuine cold waits remain measured.
- Preparation produces data/proof only. Continue using the existing one-player handoff when exact media/production/creator match and the player remains ready. Do not claim immediate first frame from cached permission alone.
- Capture one20-item Global origin window, original selected item/time/manual-pause, identity and receipt timestamps before leaving. Restore this window immediately on Back within a60s data freshness bound, then quietly refresh around the anchor. Do not call `FeedStore.refresh()` in a way that clears the visible restored page first.
- Global reuse must be **public-safe**: derive `publicView` from the existing shared Global predicate in the same data response; current membership visibility is excluded identically for anonymous and signed-in reads. Lock that invariant with tests and keep caller-specific flags out of the retained public snapshot. No extra anonymous preflight is required. During transient account verification failure, valid public rows stay usable and optional recognition/engagement clears to neutral; quiet public refresh uses the anonymous transport explicitly without changing the account or repeatedly sending an invalid bearer.
- Expired Global metadata requires fresh public data before replaying a possibly withdrawn source. Retain only a safe shell/placeholder meanwhile. A fresh response reporting source removal wins immediately, clears handoff and shows the existing unavailable/updated-feed outcome. No60s renewal of an entire page from checking one source.
- Cached protected page rows are rendered only while their own view proof is valid; stale rows can remain hidden memory until bounded eviction. Scrolling into an expired row first renews it and the selected-neighbor window; preloaded native media never overrides eligibility.
- Background pauses/masks; retain only bounded non-draft state needed for a valid return. No comments drafts or protected text become visible just because a feed page survived. Keep caption/story content timestamps and byte/entry bounds; clear protected content on actual denial, expiry, sign-out and current lifecycle privacy rules.
- Explicit Menu Refresh remains a fresh read and invalidates dependent preparation. Preserve the captured user's pause intent while reconciling. Nested personal return remains account/context bound; personal feeds never inherit group Follow authority.

Public-safe Global freshness is issued only from the inspected shared public row predicate, with tests comparing anonymous and authenticated visible tuples. A future policy that makes a row account-dependent must omit its public grant. Keep the first version bounded; if public eligibility cannot be demonstrated, fall back to fresh public loading rather than exposing uncertain rows. Refreshing only the source does not renew the entire origin window.

### Recovery and Surface Integration

Use one recovery coordinator per active navigation attempt, with cancellation on account/route change. Determine the failure layer; perform only required reads. A successful authorized feed/access response can recover identity confirmation without an extra session request. If no protected data request is needed, validate the existing session directly. Then reconcile feed data if absent/denied, reacquire exact view proof and reload only a failed selected media source. Restore original time/manual pause, subject to normal duration clamping and current eligibility.

Do not automatically restart a healthy paused player, trigger playback from a covered screen or repeatedly reload a persistently failing media URL. One explicit recovery attempt permits one selected-media reload; subsequent native failure shows a media-specific Retry. Observe terminal callbacks and shared player budget; no new account generation is needed for transient recovery.

Remove screen-owned account fallback claims as consumers migrate. Session renewal uses either a current protected read that checks the principal or one fallback session validation when no such read is due. A Follow count refresh is not a subscription renewal; a captions fetch is not permission to post. Keep surface snapshots bound to space/publication/creator and refresh their actual data on original deadlines. Use shared lifecycle/identity/denial notifications, not separate inconsistent account timers.

Follow/Like/Comments writes still check server authority at request time, even if the button was enabled from recent data. Preserve desired-state Follow semantics and uncertain-write read reconciliation. Comments close/background/sign-out/access-loss continue to clear drafts; transient quiet renewal within valid authority must not clear an open draft merely because a request is pending. If posting is denied while reading is still allowed, show the real disabled capability without discarding unrelated playback.

### Diagnostics and Performance Acceptance

Extend existing bounded full-tap navigation records with access hit/miss/expired, original proof age/remaining duration, renewal start/result/expiry, coalesced request count and failure layer. Capture end-to-end request time through body parsing, feed adaptation, native source readiness and first frame/playing/progress separately. Preserve interrupted/failed transitions and existing bounded event counters. Use safe route kinds/status codes and local trace IDs; never token, raw URL, password, private bio or membership dump.

Deterministic acceptance:

- A warm tap/return with valid exact proof/data needs **zero awaited authorization requests** before eligible rendering. Quiet renewal is allowed concurrently. First cold Launch entry needs at most one combined entry request, no separate session/feed round trips. Initial direct space feed also needs one authorized feed request.
- At45s renewal leaves valid presentation/audio state intact. At60s (or earlier server cap), a failed/hanging renewal cannot keep protected playback eligible. Test exact boundary and delayed timer callback, not only timer counts.
- Warm Global return uses retained public-safe data before a fresh feed response; missing/expired data has an honest cold-loading path. No change to protected/private eligibility merely to remove a spinner.

Physical acceptance is a separate gate: repeat paused and playing Global → Launch → group/channel → Global paths, compare full-tap timing distributions and user-visible waits, and verify pause/time/audio. Record at least10 warm round trips under stated Wi-Fi/text/CC/sound conditions, plus separately labeled cold entry. Do not assign a synthetic device p95 target without baseline evidence. Require no full-screen access/loading overlay for valid warm paths and no frozen controls/overlapping audio. Media readiness can still cause a real, measured wait; an unexplained warm spinner is an open finding, not a cosmetic pass.

Keep existing forward-playback numerical gates: prepared first-frame p95<=150ms, normal preparation>=90%, peak players<=3, zero recorded errors/incomplete/unexpected playback; independently review playing/progress and retained-history limits. Compare the prior build15 prepared p95117.39ms without causal claims. Final full report and sign-out/scoped cleanup from Plan175 remain required and can be qualified against the successor build without another obsolete-build campaign.

## Phase Status

- A: Complete — server confirmations and compatible entry/read contracts
- B: Complete — shared manager, identity integration and hard expiry
- C: Complete — prepared entry, bounded Global return and player continuity
- D: Complete — surface migration and complete recovery
- E: Complete — integrated regression, instrumentation and release verification
- F: In Progress — focused phone acceptance, performance and scoped cleanup

## Phase A — Server Confirmation Contract

- Goal: Produce bounded server-derived proof in the same response as checked data, without changing access policy.
- Steps:
  - [x] Extract a shared read decision/context helper that preserves existing bans, membership, owner/admin, public/subscription and personal-space rules. Compute relevant time boundaries; reuse request-local checker results where safe. Do not cache writes' permission decisions across requests.
  - [x] Implement envelope typing/serialization, conservative timing and private/no-store headers; keep legacy response shape compatible.
  - [x] Add the bounded exact-publication playback-access read and combined `include=entry` Launch resolve. Preserve final source/target checks and viewer feed serialization.
  - [x] Define and implement server-confirmed public-safe Global row eligibility and retained-origin validation; demonstrate anonymous policy equivalence rather than assuming it.
  - [x] Update `docs/API.md` for implemented contracts and source-bound denial outcomes. Avoid exposing protected reasons through discovery metadata.
- Test gate: `npm run build`; `npm run test:viewer`; targeted mounted real-API checks under `tests/runs/api-curl/plan_176_phase_a/` using owned fixtures and exact session cleanup.
- Acceptance: Legacy build23 calls still work; new fields cannot bypass server checks; omitted/malformed/wrong-viewer proof does not become authority. Test active/expired/revoked session, personal/public/member/subscriber/admin/ban, scheduled ban/subscription/session expiry, source/creator/production mismatch, removed item, malformed/oversized ID query and unauthorized guessed IDs. Compare request-local SQL work; no claim of production-scale performance from fixtures.

## Phase B — Shared Confirmation Manager

- Goal: Allow immediate reuse with bounded quiet renewal across route lifetimes.
- Steps:
  - [x] Implement provider-owned memory manager, injected clock/scheduler, single-flight acquisition, per-scope invalidation epochs and bounded LRU.
  - [x] Integrate response observation with API adapters without making transport trust arbitrary successful payloads. Add synchronous age checks at eligibility transitions and foreground.
  - [x] Refactor AuthStore/provider so transient error preserves remaining verified authority, ended sessions clear it, and active proof renewal supersedes duplicate fallback validation. Keep secure storage/sign-out semantics.
  - [x] Remove initial space session preflight; seed feed/view proof from actual authorized feed response. Migrate `useSpaceAccess` to subscribe instead of owning screen-local authority.
- Test gate: `npm --prefix mobile run typecheck`; `npm --prefix mobile test`; targeted actual-provider/feed rendered tests, then `npm --prefix mobile run test:ui`.
- Acceptance: Deterministic45s/59.999s/60s checks; short server caps; future/negative/malformed timing; slow body parse; timer delay; wall clock jumps and suspend/resume uncertainty; transient/429/503/offline/hanging renewal; grace never extends; late success/denial and old-account401 isolation; consumer cancellation/coalescing; route blur reuse; identity/origin/sign-out clearing; no timer/request leak or silent all-page renewal.

## Phase C — Entry and Return Continuity

- Goal: Remove avoidable navigation waits while preserving exact source/media identity.
- Steps:
  - [x] Extend Launch preparation to two visible entry payloads; join in-flight selected requests; enforce caps, priority and cancellation. Use one combined response on a cold tap.
  - [x] Seed FeedStore and proof without a second fetch; validate source/target tuples before committing transition. Retain existing15s one-player exact-match handoff and budget accounting.
  - [x] Add bounded20-item origin-window storage and non-clearing quiet revalidation. Restore only public-safe, unexpired Global rows; apply source removal immediately.
  - [x] Keep chooser/origin and Close responsive through genuine cold loads; preserve playing/manual-pause/time on every leg. Handle rapid multiple taps and navigation cancellation deterministically.
- Test gate: native typecheck/unit/rendered gates; targeted mounted navigation tests with real stores/coordinator and controlled native ports. Verify network request counts and no extra live player.
- Acceptance: Warm prepared entry and valid Global return render before delayed server responses; zero awaited preflights. Cold entry uses one combined request. Test partial preparation, failed/slow prefetch, changed source/media, removed destination, account change, deadline during transition, expiry before scroll, explicit Refresh, nested personal return, pause/playing restoration, handoff expiry and late callbacks. Public eligibility failure must produce a safe loading/fallback path.

## Phase D — All Protected Surfaces and Recovery

- Goal: Unify access lifecycle and repair failed viewing without logout.
- Steps:
  - [x] Migrate Creator/feed Follow, Comments/engagement and captions/story to shared identity/access notifications; retain their own bounded data freshness and exact action rules. Leave Global recognition optional/neutral on failure.
  - [x] Remove redundant session preflights and obsolete routine-owner timer plumbing after the last caller migrates. Verify every protected route still independently resolves server identity.
  - [x] Implement scoped recovery coordinator and clear feedback for session ended, verification unavailable, space denied, feed failure and media failure.
  - [x] Promote the Plan175 controlled recovery probe into a maintained regression using actual components/stores, including paused/playing intent and no write replay.
- Test gate: native typecheck/unit/rendered; server `test:viewer`; actual mounted API/browser regression for Follow/engagement/text and legacy Launch, preserving original fixture state.
- Acceptance: Valid quiet renewal does not flicker or erase drafts; explicit denial/expiry/background/sign-out masks appropriate surfaces and stops protected audio. Successful saved-token Retry recovers failed media without logout; no automatic write retry, leaked draft, group/personal authority inheritance or cross-account state. Posting-only denial leaves authorized reading intact. No obsolete duplicate account timer remains.

## Phase E — Integrated Evidence and Signed Build

- Goal: Qualify the entire change and make latency/security behavior reviewable.
- Steps:
  - [x] Add safe navigation/access/recovery stages to full diagnostics and verify bounded histories, failed/interrupted records, transfer/allocation balance and no sensitive fields.
  - [x] Run integrated request-count/expiry/race tests with actual navigator/providers and existing API/browser harnesses. Review emitted payloads and server query plans for changed paths.
  - [x] Run final backend build/tests and mobile typecheck/unit/rendered; run web/space builds only if shared browser inputs change. Maintain root README/mobile README/API for implemented behavior, no prospective claims.
  - [x] Determine next available internal build number at execution time; do not hard-code24. Follow `mobile/scripts/preview-build.cjs` from the mobile directory, source/private-input checks, export/archive match, EAS identity and downloaded signed IPA verification. Freeze source after submission; issue a new verified binary for later product edits.
  - [x] Compare docs findings to the existing16-item baseline; run whitespace and relative-link checks. Preserve all build23 manifests/reports.
- Test gate: the Phase A–D gates plus `npm run check:agents:docs`, `git diff --check`, verified source/archive/export/IPA/API/provisioning, and a sanitized evidence summary under `tests/runs/build/plan_176/`.
- Acceptance: All required host gates pass with actual counts, no new docs findings/private inputs, legacy app compatibility demonstrated, final artifact matches qualified source. No physical performance claim from host gates.

## Revision R1 — Launch Audio Isolation

Status: In Progress (native host gates pass; build25 source/export/archive/downloaded signed artifact pass; phone observation pending).

Build24 phone feedback reports considerably shorter buffering waits but repeatable wave-like static during Launch/space navigation, persisting on Global return until the user advances to another video. Exact onset (opening the overlay versus selecting a destination) and paused/playing cases remain unconfirmed; full diagnostics were requested without Reset. Existing fake-native tests cannot hear distortion.

Inspection found the same native `expo-video` player can move from Global to a freshly mounted space feed and back, including source seeks and `VideoView` attachment changes. The installed iOS implementation already defaults to `doNotMix`; do not introduce an unrelated audio mode/dependency change or claim an Expo defect. Reuse/seek/attachment is a hypothesis, not a proven phone root cause.

The focused isolation change removes native handoff from `ViewerNavigator` transitions. Each departing feed releases its native resources before the next visit allocates a fresh decoder. Prepared authorized entry JSON, original-deadline access confirmations and the bounded public Global page remain in use. Exact publication/production/creator selection and scalar pause/time restoration remain. Opening/closing the Launch overlay alone keeps the original mounted player/view. The isolated handoff primitive remains covered by unit tests but is no longer used by the app navigator. A brief native media startup wait can return; no claim that data reuse eliminates media readiness.

- [x] Remove cross-feed player handoff from actual navigation, including choose-another-space and Back to Global.
- [x] Actual rendered sound-on paused/playing repeated round trips (three each), overlay-only close, original time/pause restoration, release/listener cleanup and one-playing/maximum-three-player assertions. Keep prepared entry request-count and delayed Global revalidation checks.
- [x] Native typecheck,206 unit and61 rendered tests pass. No backend inputs changed by R1; prior57 backend/35+35 access/API/browser gate evidence remains associated with build24.
- [x] Prepared build25 after confirming24 latest; source/archive/export and downloaded signed artifact/provisioning verified,24 evidence preserved.
- [ ] Focused phone audio/navigation comparison, including overlay-only close versus actual destination entry and repeated return. Distortion remains unqualified until observed on device. Preserve current phone sign-in/history and deferred offline/nested work.

## Revision R2 — Visible Progress Messages

Status: In Progress (native typecheck/206 unit/61 rendered pass; build26 source/export/archive/downloaded signed artifact verified; phone localized both remaining navigation waits; duration/full report and complete acceptance pending).

User feedback in replies to build24/25 audio questions says sound is normal when playing, but progress indicators remain, including indicators with no visible message. Record this limited positive audio observation without assuming an explicit build25 confirmation or complete paused/playing/time/overlap acceptance. The user requests visible messages to identify which operation triggers a wait.

Audit found bare spinners in native video startup/position restoration and captions/story loading (the latter two had accessibility-only labels). Implemented visible labels: **Preparing video**, **Starting playback**, **Loading video to restore position**, **Restoring video position**, **Loading captions**, **Loading story**. Existing feed/access/Launch/profile/preferences messages remain visible. Account's generic Please wait becomes the actual operation (Signing in, Signing out, Restoring sign-in, Verifying saved sign-in); sound preference saving and feed Retry also have explicit labels. Shared Message gives the spinner an accessibility label matching its visible title or busy label.

This revision changes presentation only. Retain current250ms media and300ms caption notice delays, permissions, requests, source ownership, playback/audio and restoration behavior. No deliberate minimum wait and no new persistent logs or private identifiers. Progress messages identify the active UI phase; they do not prove the server/media cause or measure duration. User reports should pair the exact message with the navigation leg. New low-impact label-only tests are unnecessary; run existing native typecheck/unit/rendered gates and source/static audit, then qualify a new numbered signed build. Keep build25 source/artifact evidence frozen.

- [x] Audit all native ActivityIndicator sites and give every spinner visible operation text and a matching accessibility label.
- [x] Keep labels readable over video, wrapped at larger text sizes, with unchanged non-interactive overlay behavior and spinner delays.
- [x] Existing native typecheck/206 unit/61 rendered gates pass; source audit finds seven app-owned ActivityIndicator sites, each now paired with visible operation text and an accessibility label. Build26 export/archive match133 source inputs/134 archive files, zero private inputs; nine operation labels found in exported Hermes.
- [x] Build26 source/export/archive/downloaded signed artifact/provisioning verified; all nine expected operation strings found in signed Hermes. Source remains frozen after submission.
- [x] Phone identifies **Loading video to restore position** on Launch overlay → Launch test group and Back to Global.
- [x] User supplies build26 full report generated2026-10-25T22:42:17.535Z, matching source `c549c1dacbb63f35068af40ae7bbee7083e1fd887b41a6fb4613f7f53edce651`, resetCount0; describes varied brief flashes/about1s.
- [ ] Confirm preferences and full audio/manual-pause-return behavior separately; the export does not certify audible quality or user intent. Offline/nested and final performance/sign-out/cleanup remain open.

## Build26 Media-Wait Investigation

User observation: Global → Launch overlay → Launch test group displays **Loading video to restore position**; Back to Global displays the same message. The subsequent full export confirms build26/source identity/resetCount0, generated2026-10-25T22:42:17.535Z. User describes variable brief flashes/about1s. Preferences and complete manual-pause/audio observation are still not explicit; do not infer those from successful restore records.

Inspected current code:

- `VideoSurface` selects that label when `snapshot.restoring` is true and native status is not `readyToPlay`. It identifies a native-media restoration stage; it does not measure SQL, network delivery, decoding or seek duration.
- `FeedSession` reaches restoration after feed data exists and the selected protected item passes its current load-authority check. Other quiet API work can still run; this label does not prove every navigation request was a cache hit.
- R1's navigator disposes the old coordinator and remounts each feed with a fresh native player. `createEntry` starts HLS source replacement; `applyRestore` waits for native readiness, then applies the saved position, retaining manual pause. Thus prepared data/access reuse alone does not remove the native source load on either leg. Do not re-enable the cross-feed handoff which was removed after distortion without a qualified audio/lifecycle design.
- Restoration currently displays its notice immediately. Ordinary startup uses a250ms notice delay. An actual-component controlled probe confirms restoration's label/spinner is present at0ms, while ordinary startup first shows at250ms. This can explain visible flashes, not a substantial phone delay. No artificial delay exists in restoration itself.

Read-only evidence: `tests/runs/build/plan_176/restore-notice-investigation-build26.json`, generated through the actual rendered VideoSurface with controlled timers. This is UI timing, not physical source/seek/frame measurement. Product source26 remains unchanged/frozen; no new binary or fixture/session mutation from this investigation.

The phone report now quantifies the dominant interval, below; no further report is required for this initial media-latency diagnosis. Potential follow-up directions include preparing a separately owned fresh destination player or keeping the Global player in its existing mounted view, with maximum-three/one-playing ownership and deadline/background/account cleanup proven. These are investigation directions, not implemented changes or a promise to eliminate cold-load waits. Consistent notice delay could reduce flashes, but must not substitute for reducing real media latency or preserving pause/time.

## Build26 Phone Report Analysis and Follow-up Design

Successor: [Plan177](plan_177.md) now implements fresh native pools and a named opaque Loading splash for startup/actual feed changes. Build27 manual and build28 automatic full-height readiness are accepted. Build28 retained Global return reproduced static despite correct position; the user approved removing cross-feed native retention while preserving scalar checkpoints, authorized JSON, Launch → Close identity and within-feed preloading.227 unit/71 rendered/typecheck pass; [Install build29](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/d457b46e-af26-41f9-9439-e6faee85ad7d) source/archive/export/downloaded signed artifact/native module/accepted-phone provisioning verified; OTA disabled. Final fresh-player phone audio/layout/swipe observations and this plan's outstanding phone/performance/access/sign-out/cleanup gates remain open. Build26/27/28 evidence, fixtures and sign-in are preserved.

Evidence: `tests/runs/device/plan_176/build26-navigation-analysis.json` contains explicitly identified fields transcribed from the user export and reproducible aggregates. It is an excerpt, not a claimed saved copy of the entire export; original full report remains in the conversation. Analysis script is ignored at `.codex-local/plan176-analyze-build26.cjs`.

Use seven consecutive exact Launch test group/Global round trips (sessions15–28; navigation15–34, plus their preceding chooser records14/17/20/23/26/29/32). Earlier trips include other space/publication IDs, account generations and background episodes; retain them separately, not as the same controlled sample. All navigation stages are cumulative from tap. Native readiness durations begin at source-load request; component medians must not be summed as one median.

| Stage | Group entry, n7 | Global return, n7 |
| --- | --- | --- |
| Access-ready from tap | median12.20ms, range11.35–14.48ms | Public cached data; no separate access-ready stage emitted |
| Feed-ready from tap | median22.75ms, range21.66–24.55ms | median13.63ms, range10.59–16.55ms |
| First frame from tap (may precede seek completion) | median428.26ms, range225.06–1093.37ms | median364.72ms, range191.08–595.40ms |
| Completed restoration from tap | median716.42ms, range332.83–1516.77ms | median583.51ms, range333.10–883.55ms |
| Native source first-ready from load request | median497.22ms, range242.01–1236.40ms | median437.59ms, range215.51–632.94ms |
| First native-ready → restore record | median194.47ms, range66.63–261.99ms | median124.14ms, range103.93–330.59ms |

Chooser-ready for these7 trips: median14.14ms, range11.48–19.21ms. The readiness-to-restore interval includes native seek, native/JS callbacks, polling and scheduling; it is not an isolated native seek measurement. All14 focused restores report restored with negligible sampled timeline delta; all14 have first frames and13 have playing/progress evidence. Group session15 has no playing/progress evidence, compatible with a paused visit but not proof of intended pause behavior. Its Global return subsequently plays; the export lacks user pause/tap intent, so do not certify the manual-pause sequence from these records alone.

Conclusion: prepared access/feed reuse is working for these observed warm trips. The remaining roughly0.3–1.5s is dominated by fresh native media readiness plus position restoration. Forward prepared-video timing cannot be assumed for a new player. A250ms restoration-notice grace could reduce flashes, but does not remove these measured waits. Keep visible operation labels and do not substitute a spinner change for source/readiness improvement.

Whole export remains open evidence:36 transitions,33 frames,3 incomplete,0 recorded playback errors;78 allocations/77 releases/1 live, peak3, unexpectedPlayback0, issues empty. There are123 dropped ordinary events,11 dropped access records and0 dropped transitions. Earlier history includes7.47s first-frame startup, a5.75s space-entry restore (space16/pub251, not this test group), one interrupted Global return and a failed/cancelled recovery. Both API and media times were higher during some earlier/background/account-change periods; no attribution to SQL, CDN, radio, OS or true token expiration is established. Retained HTTP status-bearing access records are200; cancellations are not authentication rejection. This is not the final prescribed40-forward performance sample and does not establish clean audible quality, leak freedom or complete access-loss/recovery acceptance.

Proposed follow-up design (not implemented; source26 remains frozen):

1. Keep at most one Global origin player **in its existing mounted view/coordinator** during a short Launch space visit. Capture pause/time once, pause/mute while covered and release its neighbors. Returning to still-valid, exact-source Global should expose that same view at its saved time without reloading/seeking. Do not resume moving the already attached player across feed views.
2. Reserve the shared maximum-three-player budget explicitly: parked Global1 permits destination current+one neighbor2. Restore the ordinary3-player window only after the retained origin is released. Always stop/release the departing destination before allowing Global to resume; one may play. Avoid budget-allocation errors as normal control flow.
3. For entry, investigate preparing **one fresh destination** while the chooser is open, after exact-publication authority. Keep its own stable owner/view; no audible speculative playback or all-destination native preloading. Existing max2 prepared JSON entries stay separate. Wrong selection, expired proof, failed preparation or source mismatch must safely fall back to a fresh authorized load.
4. Bound origin/candidate retention by original freshness and a short explicit lease. On background, identity/origin change, sign-out, denial, source removal or tuple/URL change, dispose/mask rather than revive old data/media. An expired/uncertain return can legitimately wait for current data; no hidden renewal may manufacture a new original deadline. Following still grants no viewing authority.
5. Cover nested Creator/personal-space navigation, alternate destination selection, delayed/denied reads and account races in actual navigator tests before any signed build. Verify stable view/native ownership, no warm Global reload/seek, pause/time, one-playing/peak3 and exact cleanup. Add safe media-preparation/return-reuse evidence while preserving real load timing and incomplete records.
6. Phone must qualify repeated paused/playing trips, static-free audio and actual latency separately. A staged return-first change is preferable if combined preparation obscures which lifecycle change affects audio. No performance or audio result is promised from host ports alone.

This follow-up is a concrete investigation/design direction. No product-source edit, database/session change, commit/push or new binary is made by receiving/analyzing this report.

## Phase F — Phone Qualification and Cleanup

- Goal: Demonstrate noticeable warm navigation improvement and the agreed access boundary on the signed phone build.
- Steps:
  - [ ] Install over existing app retaining data/history; confirm build and saved CC/sound, usual size, API health. Run paused/playing Global → Launch → group/channel → Global checks and record timings/full reports as specified above.
  - [ ] Exercise background/overnight resume and explicit saved-session recovery without logout; distinguish actual token expiry from network failure and native media failure. Do not require destructive account resets to demonstrate recovery.
  - [ ] Observe controlled real access loss and restoration: valid proof allows only its remaining interval; denial/expiry then blocks with public profile retained and no protected audio. Restore exact owned membership afterward.
  - [ ] Keep the previously deferred offline/nested phone check deferred until the user resumes it. Controlled host coverage does not substitute for that observation; final acceptance must explicitly record any accepted remaining limit.
  - [ ] Complete the stable-Wi-Fi40-forward performance/full-report gate and review playing/progress, resources and user-observed stalls/freeze/audio independently.
  - [ ] Perform final unsent-draft/sign-out phone check, capture exact current session provenance and remote revoke result, audit rejection afterward, then restore/delete only owned Plan175/176 fixture deltas. Preserve ordinary user data. Record any remote-revocation failure separately from local sign-out.
  - [ ] Reconcile Plan175 E/F with successor evidence; mark neither plan Complete while required checks/cleanup remain. Commit/push only per explicit user request and repo git policy.
- Test gate: signed artifact identity, phone observations plus full diagnostics, targeted server access/revocation audit and exact before/after fixture cleanup report under `tests/runs/device/plan_176/` and API evidence paths.
- Acceptance: No warm-path access/loading screen with valid prepared data; honest cold waits measured; no frozen controls/overlap; all existing forward numerical gates pass; access deadline/denial/pause/recovery account isolation hold; scoped cleanup and then-current session revocation proven or explicit residual disposition recorded. Missing phone evidence stays open.

## Expected File Impact

- Server: `src/routes/viewer.ts`, native session service/types, shared space/read decision helper, viewer feed/Launch serializers and eligible-publication lookup; targeted `tests/backend/native*.test.ts`, owned API harness and `docs/API.md`.
- Native: auth manager/provider/store/API adapters, `useSpaceAccess`, `useViewerFeed`, FeedStore/FeedScreen, Launch store/preparation/API, ViewerNavigator/journey cache, surface verification and recovery coordinator, diagnostics; preserve player coordinator/handoff contracts unless tests establish required adjustments.
- Tests: deterministic manager/auth/navigation/recovery unit tests and actual mounted rendered tests; existing browser Follow/engagement/text checks remain regression gates.
- Continuity: Plan175, this plan, implementation index and native roadmap. Root README is unchanged by planning; update only once behavior is implemented.

## Change Log

- Uncommitted2026-10-25 — Received build26/source-matching full phone export with resetCount0 and variable ~1s wait observation. Reproducible7-pair analysis: group access12.20ms/feed22.75ms versus restoration716.42ms median; cached Global feed13.63ms versus restoration583.51ms. Recorded whole-history slow/incomplete/recovery findings and drafted bounded stable-view/fresh-destination follow-up. No new product source/binary or full phone acceptance.

- Uncommitted2026-10-25 — Phone localizes both group entry and Global return waits to Loading video to restore position. Traced fresh-player source/readiness/seek path; actual rendered probe confirms restoration notice has no250ms startup grace. Requested durations/full report and audio/pause confirmation; no product edit/new binary, latency claim or acceptance inferred.

- Uncommitted2026-10-25 — R2 build26 source/archive/export/downloaded signed IPA/provisioning verified. All seven app spinner sites have visible text and accessibility labels; nine operation labels verified in signed Hermes. R2/F stay In Progress awaiting exact phone messages/navigation legs and remaining acceptance gates. No commit/push requested.

- Uncommitted2026-10-25 — R2 requested/implemented: visible phase messages accompany previously bare video/start/restore/captions/story spinners; Account busy, sound saving and feed retry use explicit operation text. Native timing/access/audio behavior unchanged. User reports normal playing sound but remaining unlabeled waits; no full R1/F acceptance inferred. New signed artifact required.

- Uncommitted2026-10-25 — R1 build25 source/archive/export/downloaded IPA/provisioning qualified; device audio comparison requested. R1/F remain In Progress; build24 reported distortion is not accepted or proven resolved by host tests. Current source is frozen after submission. No new commit/push requested.

- Uncommitted2026-10-25 — R1 native audio isolation implemented: navigator releases each departing feed player rather than transferring it across feed visits, while prepared entry/public page/access reuse and scalar pause/time survive. Typecheck/206 unit/61 rendered pass, including six repeated sound-on round trips. A new signed build is required; device audio root cause/resolution not yet proven.

- Uncommitted2026-10-25 — Build24 phone feedback: buffering waits improved considerably, but Launch/space navigation produces wave-like static which persists on Global return; advancing to another Global video clears it and repeating Launch reproduces it. Exact onset (overlay open versus destination selection) and paused/playing cases require clarification; full report requested without Reset. No audio/pause/time acceptance inferred. Cross-feed native-player reuse, seek/attachment and audio-session behavior are under investigation; source24/artifact remain frozen. F remains In Progress, audio regression blocks acceptance.

- Uncommitted2026-10-25 — E Complete for signed build24 after source/archive/export/downloaded IPA/provisioning and host/API/browser verification. F In Progress awaiting first focused install/navigation observation; preserve all Plan175 carryovers. No new commit/push requested.

- Uncommitted2026-10-25 — A–D implemented and host-qualified: additive server confirmations/combined entry, shared original-deadline manager, exact selected/neighbor gating, bounded prepared/public-page reuse, no session preflights on protected data reads, transient grace, coordinated recovery and safe diagnostics. Build24 prepared; E In Progress/F Pending. New commit/push not requested.

- `407fe73` — committed baseline: Plan175 contextual Follow/recognition, Launch UI/descriptions, navigation reuse and build23 investigation. E/F remain open; not pushed.
- 2026-10-25 — inspected current auth/guard/feed/Launch/navigation/surface/server/SQL owners and existing read-only incident/recovery evidence. Drafted this proposed plan at user request. No product source, database state, runtime service, credentials or signed binary changed by planning.

## Validation

- R2 build26 signed artifact verified2026-10-25T19:16:53Z: EAS `7c340ac8-b396-4b4c-9349-f1d8ff4af976`, finished19:16:34Z,0.1.0/build26, source `c549c1dacbb63f35068af40ae7bbee7083e1fd887b41a6fb4613f7f53edce651`.133 inputs/134 archive files, exported Hermes2226130 bytes, embedded2226226; all nine expected operation strings present. IPA8318817 bytes, SHA256 `573a24c793112b362c06ed1d8e42f4ffe1c2948c0476075146b4236b273bfcd9`. Bundle/API/source match; same one accepted phone, get-task-allow false and OTA disabled. Source/archive unchanged after submission. Native206 unit/61 rendered/typecheck pass, same16 known agent-doc findings/zero new and70 relative links/zero broken. Evidence: `tests/runs/build/plan_176/{host-gates-build26.json,progress-label-audit-build26.json,artifact-build26.json,build26-meta.json,source-manifest-build26.json,archive-export-build26.json}`. [Install verified build26](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/7c340ac8-b396-4b4c-9349-f1d8ff4af976). Focused phone message/leg observation pending.

- R2 host gate2026-10-25: native typecheck/206 unit/61 rendered pass. Audit covers all seven app-owned ActivityIndicator sites, visible text and accessibility labels; exported Hermes contains nine explicit operation labels. Build26 source `c549c1dacbb63f35068af40ae7bbee7083e1fd887b41a6fb4613f7f53edce651`,133 inputs/134 archive files/2226130-byte Hermes export match; no private inputs. Submitted EAS `7c340ac8-b396-4b4c-9349-f1d8ff4af976`; downloaded signed artifact pending. Backend/requests/player behavior unchanged by R2; no fixture/session mutations.

- R1 build25 signed artifact verified2026-10-25T18:38:55Z: EAS `86577c07-7b15-4f32-8c4e-cd35d2efe274`, finished18:37:46Z,0.1.0/build25, source `8f0f6ead4b1d3b8f21764a87b3e0ef71fe3f8ee8de3dc037c4c1ceb0dbca88af`.133 source inputs/134 archive files; exported Hermes2225118 bytes, embedded2225213. IPA8318346 bytes, SHA256 `23c21c990824d4f3f639c33544f9eff00728c065e6b619216453822131c0e2e5`. Bundle/API/source/internal-preview match; same one accepted phone, get-task-allow false, OTA disabled. Source/archive unchanged after submission; only `app.json` and `src/navigation/ViewerNavigator.tsx` differ from24 build inputs. Evidence: `tests/runs/build/plan_176/{artifact-build25.json,build25-meta.json,source-manifest-build25.json,archive-export-build25.json,host-gates-build25.json}`. [Install verified build25](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/86577c07-7b15-4f32-8c4e-cd35d2efe274). Phone audio result pending; root cause not proven.

- R1 host gate2026-10-25: native typecheck/206 unit/61 rendered pass;35 live HTTPS access checks pass without fixture mutations and with existing sessions preserved. Agent docs retain the same16 known findings/zero new; whitespace passes. Build25 source/export/archive identity `8f0f6ead4b1d3b8f21764a87b3e0ef71fe3f8ee8de3dc037c4c1ceb0dbca88af`,133 inputs/134 files/2225118-byte Hermes. No backend source changes in R1, so prior backend/API/browser qualification remains explicitly build24 evidence rather than claiming repeated checks. Build25 submitted as `86577c07-7b15-4f32-8c4e-cd35d2efe274`; downloaded signed artifact pending.

- Build24 signed artifact verified2026-10-25T17:59:28Z: EAS `15ca30f6-765f-441e-adce-c5d3e175827c` finished17:57:11Z,0.1.0/build24, source `6c7c9460b7c75ddd4fd04d7351fd7eae86d886ba88d9e9821633e6733872a016`.133 source inputs/134 archive files only; exported Hermes2225376 bytes, embedded2225471 bytes. Downloaded IPA8318521 bytes, SHA256 `fa0f5dbde5e00d25b1c216a79159ddadfd6e50dad18cae8900b74005d3991a9e`; bundle/API/source/internal-preview match, same one accepted phone, get-task-allow false and OTA disabled. Source/archive identity unchanged after submission. All E host gates complete; F phone/performance/sign-out/cleanup pending. Evidence: `tests/runs/build/plan_176/artifact-build24.json`, `build24-meta.json`, `archive-export-build24.json`, `source-manifest-build24.json`, `host-gates.json`; live HTTPS35 checks under `tests/runs/api-curl/plan_176_live_https/summary.json`. [Install verified build24](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/15ca30f6-765f-441e-adce-c5d3e175827c).

- Phase E host gate2026-10-25: backend build/57 tests, mobile typecheck/206 unit and59 full rendered pass, with12 source/expiry/recovery rendered checks repeated after final error-copy changes. Access API35 assertions pass with preexisting sessions preserved. Final diagnostics include200 bounded allowlisted records, original-age hits, renewal/coalescing/expiry, request/body duration/status/outcome and recovery; no raw token/URL/private membership payload. Source replacement invalidates older media tuples and preserves pause/time; older late proof cannot regrant replaced media. Documentation links69 pass, whitespace passes, agent docs retain identical16 known findings/zero new. Build24 prepared after fresh EAS history confirms23 is latest;133 inputs, source `6c7c9460b7c75ddd4fd04d7351fd7eae86d886ba88d9e9821633e6733872a016`. Export/archive qualified:134 expected files only,2225376-byte Hermes bundle includes source/API, zero private inputs. Signed build24 submitted as `15ca30f6-765f-441e-adce-c5d3e175827c`, in progress; downloaded artifact/phone still pending. Live HTTPS API35 checks also pass with phone session preserved.

- Phase D: mobile typecheck/204 unit/54 full rendered pass, plus17 targeted surface/rendered checks include the three subsequently added expiry/optional-text cases (next full expected57). Maintained actual AuthStore/FeedScreen/native-source regression proves saved-token recovery restores both playing/paused intent and time without new account generation or write requests. Hung renewals are cancelled at the old deadline/request timeout and late cancelled bodies cannot seed proof; unknown/expired neighbors do not load or play before confirmation. Backend57 pass;171 mounted Follow/237 engagement/84 text API and18 Follow/12 engagement browser checks pass with exact fixture/session restoration. Legacy harness domain equality excludes the newly additive expiring access transport metadata, separately checked by the Plan176 API harness. Text browser regression subsequently passes9 checks after fixing its old unpinned-first-fixture assumption; no product text change. Phase D evidence copied under `tests/runs/api-curl/plan_176_phase_d/`; detailed local logs `/dev/shm/plan176-d-*`. No private-media enforcement or physical performance claim.

- Phase C: mobile typecheck/203 unit pass, prior full51 rendered pass plus updated15 actual-navigation tests pass (one added delayed-Global-response case; next full total52). Combined entry makes no second space feed request; cached return renders before pending revalidation and keeps the exact paused player/time. Bounded two-entry/coalescing/cancel and20-item public-window expiry tests pass. Server-reported source removal clears public memory/proof; no known-removed origin reuse. Logs `/dev/shm/plan176-c-unit-final.log`, `plan176-c-navigation-final.log`, `plan176-c-typecheck.log`.

- Phase B: mobile typecheck/201 unit/51 rendered tests pass. Actual protected-hook coverage now exercises combined identity+publication proof,45s quiet renewal,60s hanging-request expiry,503 grace, immediate403/401, shared requests, bounded background return and late-response age. Baseline obsolete session-preflight expectations updated; public Global no longer blacks out solely on retryable account validation failure. Logs `/dev/shm/plan176-b-typecheck.log`, `plan176-b-unit.log`, `plan176-b-ui-final.log`. Backend build still passes after additive identity metadata on protected JSON reads.

- Phase A2026-10-25: backend build passes;57 backend tests pass. New read-only real SQL/mounted API check passes31 assertions, preserves all preexisting native sessions and mutates no fixture data; only exact newly created check token is revoked and audited401. Evidence: `tests/runs/api-curl/plan_176_phase_a/summary.json`; local logs `/dev/shm/plan176-a-build.log`, `plan176-a-tests-final.log`, `plan176-a-api.log`. Caller-specific signed poster URLs can differ per request; anonymous/signed public tuple comparison excludes that expiring poster representation.

- Environment: `/home/ubuntu/aws`, `main`, baseline `407fe73`; internal iOS0.1.0/build23 source `7a156b3953f48fb9da8c546a48345755e2b33b07fae694fcfe3410da442bf1c6` remains the product baseline.
- Checkpoint checks: build23 input identity matches manifest; `git diff --check` and staged whitespace checks passed; precommit `npm run check:agents:docs` retained the known16 findings/zero new. Root README evaluated after commit: implemented behavior already documented; no planning-only update needed.
- Prior baseline gates, not rerun as new implementation tests:51 backend tests,194 mobile unit,52 rendered, mobile typecheck;171 mounted Follow/recognition API and18 browser checks; earlier50 introduction API/7 browser and237 engagement API/12 browser retained with their recorded source limits.
- Current planning checks: `npm run check:agents:docs` exits1 with exactly the same16 pre-existing findings and zero new; full output matches the precommit baseline. Relative Markdown links in all four changed planning/continuity documents and whitespace checks pass. Product input identity still matches build23. No proposed manager/API/recovery implementation or new-build tests have run.
- Evidence: Plan175 investigation paths above; `/dev/shm/plan175-precommit-docs.log` (local baseline output); final planning validation output is local under `/dev/shm/plan176-planning-docs.log`.
- Gaps: build23 full phone diagnostic report/time/context missing; phone root cause unproven; new architecture/API behavior host-qualified and signed artifact verified; physical timing/audio/recovery unqualified; deferred offline/nested observation and final performance/sign-out/cleanup still open.

## Open Risks / Deferred

- A60s lease deliberately permits a bounded delay after an unseen permission change. Explicit denial shortens it immediately. Harder revocation guarantees need a separate server/media delivery design, not a longer-lived client configuration.
- Public Global eligibility must be proven for retained authenticated rows. This is a required safety gate for immediate public return, not an assumption or an excuse to block all public video on account-network failure.
- The proposed combined entry payload increases bytes and bounded prefetch increases requests. Measure actual network/body/serialization cost; cancel unnecessary work and preserve selected media priority. Scale SQL optimization only from measured changed-path evidence.
- JavaScript scheduling/suspension and native audio callbacks need phone observation. Synchronous deadline checks and background stop/mask reduce risk; they cannot promise execution while the OS suspends the process.
- Existing direct HLS URLs, cached buffers and independently reachable media are outside app confirmation enforcement. Private CDN/origin enforcement remains separately planned scope.
- Cross-device membership/payment/admin events are not instantly pushed. Quiet checks and deadline bound are mandatory; event-driven invalidation may later accelerate them but cannot replace expiry.
- Plan174's remote-revocation gap and build10 cold186/native freeze uncertainty remain historical unresolved findings; neither commit nor this design resolves them.
- Proposed API additions, memory limits and public-safe proof are reviewable design choices. If implementation exposes a conflict with real shared policy, revise this plan with evidence before weakening a boundary or expanding scope.

## Resume Here

- User accepts successor build29 loading feedback and seamless within-feed scrolling and explicitly requests the integrated implementation be committed and pushed. Publish this work with Plan177 and the prior Plan175 checkpoint; keep outstanding quantitative/audio/edge-case and cleanup evidence scoped rather than marking all predecessor gates complete.

- Next implementation is [Plan177](plan_177.md): automatic full-height readiness is accepted, retained Global audio failed, and the user-approved fresh-player/named-splash revision passes host gates. Build29 artifact qualification passes; finish focused phone audio/startup/return checks; preserve this plan's outstanding performance/sign-out/cleanup requirements.
- A–E Complete for build24 host/artifact gates; R1/R2/F In Progress. Build26/source confirmed by full phone report generated2026-10-25T22:42:17.535Z, resetCount0. Seven latest exact-group/Global pairs show access/feed-ready11–25ms, restored716ms group/584ms return medians; native fresh source readiness and restoration dominate remaining variable ~1s waits. Evidence and explicit whole-history limits plus proposed stable-view/one-fresh-destination design are above. Product source26 remains frozen; no new binary from analysis. Complete audio/manual-pause/preferences, final40-forward/access/overnight/sign-out/scoped cleanup gates remain open; offline/nested phone work stays deferred.
- Host gates: backend57 for build24, mobile206 unit/61 rendered/typecheck through26,35 access API plus35 live HTTPS,171 Follow/237 engagement/84 text API,18 Follow/12 engagement/9 text browser checks; exact fixture/session preservation. Downloaded signed IPA/provisioning/source/API/export/archive pass; physical speed/audio/overnight and final performance remain unqualified.
- Preserve phone sign-in and exact current Plan175 fixture state; previously observed session128 must not be presumed current after account generations changed, and actual current provenance must be re-identified before mutation/sign-out. Keep Plan175 E/F open. Offline/nested phone observation remains explicitly deferred; final performance/sign-out/scoped cleanup still require evidence. Commit/push is now explicitly authorized for the integrated build29 checkpoint, including prior baseline `407fe73`.
- Root untracked `app.json` remains the unrelated empty Expo CLI artifact, untouched/excluded. Release metadata/evidence stays ignored under `tests/runs/build/plan_176/` and `.codex-local/`; never print signed artifact URLs or credentials.
