# Plan 169: Creator Profiles and Authorized Personal Feed Return

Status: Complete

Created: 2026-10-18

Implementation authorized by the user on 2026-10-18. Phases A–F are Complete for the recorded iPhone development milestone. Creator profiles, authorized personal feeds and original-feed return pass host/API/browser and focused physical acceptance, with the evidence limits recorded below. Final stable-Wi-Fi sample passes all numerical gates: 40/40 normal transitions prepared, first-frame p95 120.38 ms, zero errors/incomplete/unexpected playback and peak three players. Earlier whole-app freeze root cause remains unconfirmed, with no recurrence in the short/final post-correction checks. User requested commit and push on 2026-10-22; final staging/review is in progress. Plan 168 is pushed as `6cfad70`.

## Feature Reference

- [Web and native viewing roadmap](../roadmaps/roadmap_native_viewing.md).
- [Profile identity and credibility](../features/feature_01_profile-identity-credibility.md).
- [Personal space and Global context integrity](../features/feature_02_personal-space-global-feed-context-integrity.md).
- [Accepted signed-in native viewer](plan_168.md) and [original playback POC](plan_167.md).
- [Implementation planning standard](../implementation_planning.md), [database safety](../db_access.md), and [test evidence conventions](../../tests/README.md).

## Context

An iPhone viewer can browse Global and existing accessible Spaces, but creator names are inert. Opening another person's profile and entering their personal feed are missing native viewing paths. Changing the current feed context also remounts the feed and resets playback, so a detour cannot yet return to the original video and time.

Deliver this journey: **original feed → creator profile → authorized personal feed → creator profile → original feed**. The original video should resume near the saved position, preserving intentional pause and the current sound choice. Public identity, permission to enter a personal space, and permission to view a publication are separate server decisions.

### In scope

- Tappable creator attribution in Global and personal/group/channel feeds, with a native, read-only profile screen.
- Minimal public identity and visibility-aware optional profile fields from a minimized viewer API.
- A server-resolved personal-space entry state for the selected creator, using existing explicit access relationships.
- Personal-feed playback, pagination, Refresh, empty/error states, and current access revalidation through the existing player and viewer API.
- An in-memory return checkpoint with original feed context, exact publication identity, playback time, intentional pause, and navigation generation.
- A fresh, authorized feed window around the original publication when restoring after a personal-feed detour.
- Shared backend permission corrections needed to enforce personal-space boundaries consistently for web and native.
- Focused host, API, browser, and installed iPhone acceptance; concise updates to developer docs and roadmap status.

### Out of scope

- Profile editing, avatar uploads, credibility labels/explanations, identification or verification UI, counts, badges, or social metrics.
- Creating personal spaces during a read, publishing/cross-posting changes, access-request/invitation approval UI, new memberships, follows, comments, likes, reporting, or checkout.
- Broad discovery, stories, app captions, universal links, account onboarding, account recovery, or production analytics.
- Persisting feed history or playback position across app termination. Relaunch continues to open Global under Plan 168's session rules.
- A new Expo SDK, navigation framework, monorepo migration, Android acceptance, TestFlight/App Store delivery, or the independent bundled-build increment.
- Confidential-media delivery infrastructure. This milestone uses non-confidential test media and must not imply that an API denial revokes copied media URLs.

## Current Integration Points

These observations describe the repository at `6cfad70`, rather than capabilities already delivered by this plan.

| Surface | Current behavior | Required change |
| --- | --- | --- |
| `mobile/src/feed/FeedCard.tsx` | Creator name is text within a `pointerEvents="none"` caption layer. | Give creator attribution its own accessible press target without intercepting vertical scrolling, mute, or video pause. |
| `mobile/src/navigation/ViewerNavigator.tsx` | One Feed route; context/auth changes remount its feed. Temporary screens return through `returnToFeed`. | Add CreatorProfile and an explicit bounded detour state while preserving one Feed route and one player owner. |
| `mobile/src/navigation/returnToFeed.ts` | Focus-aware `popTo('Feed')` prevents duplicate Feed routes. | Preserve that guarantee; profile return must distinguish restoring an origin from intentionally choosing a new destination. |
| `mobile/src/feed/feedStore.ts` and `FeedScreen.tsx` | Store has page/cursor cancellation; session has local index; Refresh creates a new session. | Add initial anchored loading and controlled selected-publication restoration with generation checks. |
| `mobile/src/playback/coordinator.ts` | Revisited selections seek to zero; PlayerPort only has `seekToStart`; blur may retain the current paused player. | Add explicit checkpoint/time-seek restoration and a suspend/release handoff before context replacement. Ordinary swipe revisits still start at zero. |
| `src/routes/profiles.ts` | Public `/api/profile/:userId` requires `profiles.is_public`, honors `show_bio`, and includes a profile creation date. `/api/users/slug/:slug` resolves a user ID. | Add a separate minimized viewer read; preserve legacy endpoint shape and visibility behavior. |
| `src/features/profiles/repo.ts` | Profile rows join user slug; current read does not filter deleted users. | Add an explicit active-user projection; optional profile data must obey visibility flags. |
| `src/features/feeds/viewer.ts` | Creator ID/name are serialized, avatar is always null. Underlying feed owner is the upload owner. | Keep that attribution identity; safely project allowed creator presentation in bounded queries rather than per-item lookups. |
| `src/features/spaces/service.ts` | Ban-first access permits admin, owner, member, public settings, or subscription, without a separate personal-space branch. | Personal access must require existing explicit authority; public flags, Global visibility, or following must not grant it. Apply the rule in the shared service. |
| `src/features/spaces/repo.ts` | `personalSpaceByOwner` finds an existing personal space; My Spaces lists the viewer's own personal space. | Resolve another creator's personal space server-side, without creating it or disclosing its identifiers to denied viewers. |
| `src/features/feeds/repo.ts` | Cursor-ordered queries enforce publishing/context/visibility; pinned lookups use production identity. | Add an authorized window around an exact publication, reusing eligibility filters. Never substitute a publication from another space or production. |
| `frontend/src/app/Feed.tsx` and `ProfilePublic.tsx` | Browser profile peek/public profile already exist; group/channel follow is a separate action. | Keep browser behavior and add focused regressions for any shared access changes. Native must not copy follow controls into this increment. |

## Locked Decisions

1. Keep the web and native clients over one backend. Add viewer contracts under `/api/viewer/v1`; preserve existing browser response shapes. Shared authorization fixes apply to both clients.
2. Profile identity is public; personal content requires separate authorization. Global remains discovery-only. Viewing or following a creator never grants personal access or copies their Global videos into a personal feed.
3. Show nominal identity for an existing, non-deleted user, even when no profile row exists or `is_public` is false. Use the account's already-public display name and handle, with a generic Creator fallback. Use an explicitly public profile's display name when available; include avatar only for a public profile and bio only when both `is_public` and `show_bio` allow it. A private profile row's fields must not become fallback values. Omit member-since dates and other optional fields in this increment.
4. Do not reinterpret the legacy `/api/profile/:userId` contract. The new nominal identity read follows the feature contract without exposing optional fields users marked private. Test hidden/missing profiles and deleted users explicitly.
5. For personal spaces, deny active site/space bans first; then permit the existing authorized site-admin authority, owner, or explicit space membership. Public visibility flags and subscription/follow rows alone do not permit entry. Reuse the existing roles/membership representation; do not introduce a new access-grant table or invent an invitation workflow. Group/channel behavior stays as implemented in Plan 168.
6. Require sign-in for personal feeds, including ones with legacy public settings. An anonymous user can view nominal identity and sees an explanation to sign in. Sign-in is an explicit Account action; it clears the anonymous detour and opens signed-in Global as today. No automatic entry after login or restoration of another auth generation's checkpoint.
7. Resolve personal-space ownership on the server. The profile request takes a creator user ID, not a client-supplied personal space ID. Return space identifiers/name only when this viewer may enter. Feed requests authorize independently on every page and foreground/access recheck.
8. Keep one root Feed route and one app-wide player budget of three. A personal detour replaces the root Feed's context after stopping and releasing the previous pool; it does not push another Feed route. Profiles contain no video player.
9. Support one origin plus one creator/personal destination at a time. Repeated taps coalesce. Opening another creator within the destination reuses that detour and retains the original origin; it does not build a recursive stack of hidden feeds. Back labels explicitly identify Profile or the original feed. Choosing a new destination from Spaces/Global ends the detour.
10. Checkpoints are memory-only and keyed by API origin, auth generation, context, and publication ID. Production ULID/upload ID are never substitutes. Keep only one bounded return record and discard it on logout, account/origin change, explicit navigation to another feed, or app restart.
11. Returning from a personal feed re-fetches an eligible window around the exact original publication before rendering it. Never replay a retained media URL or protected snapshot as evidence of current permission. A missing publication falls back to the current feed's first available item with a brief explanation; an inaccessible origin offers Spaces/Global, without showing its cached frame.
12. Restore time before allowing playback. Preserve the original video's manual-pause choice. Current-session mute is a device/session preference: a mute change made during the detour applies on return; the old checkpoint must not overwrite it. Startup sound behavior remains unchanged.
13. Native bearer credentials stay on API requests using the existing transport. Avatar/poster/video requests receive no bearer/cookie headers. All new viewer reads use `no-store`, explicit response allowlists, bounded inputs, sanitized errors, and stale-request guards.

If Phase A disproves a technical assumption, amend this plan with the concrete finding before implementing a replacement. Narrow personal-space policy is an intentional correction for this new entry path, not an accidental platform difference.

## Intended User Experience

| Action or state | Result |
| --- | --- |
| Tap creator attribution | Pause the selected video without changing its manual-pause intent; show CreatorProfile with Back. Load fresh identity/access state. |
| Creator ID missing | Render plain attribution text without a dead button. |
| Loading/error/missing identity | Show bounded loading, Retry, or Profile unavailable with Back; keep origin controls recoverable. Never fill a failed request with private/stale profile fields. |
| Anonymous profile | Show nominal identity and allowed optional fields, plus Sign in to check personal-space access. Profile dismissal returns to the same anonymous video. |
| Authorized personal entry | Show View personal space. Tap checks access again and enters that space's feed, with its name and personal context visible. Start at its first publication. |
| Denied or absent personal space | Show Personal space unavailable to you; no View button, personal metadata, counts, access-request button, or inferred follow entitlement. Treat absent and unauthorized personal destinations alike. |
| Allowed personal space with no publications | Show No videos yet, Refresh, and Back to profile. Do not fill it with Global/other-space content. |
| Back from personal feed | Stop/release destination playback, show its creator profile, and prepare the saved origin for restoration behind the profile. |
| Back/Close from profile | Return to the one existing Feed route. After a detour, restore the original context/publication/time through the authorized anchored window. If no context change occurred, retain the paused original player where safe. |
| Cancel an iOS back gesture | Keep the currently visible screen and eligibility state; never start audio from a screen still covered by the profile. Commit restoration only when the transition completes. |
| Refresh personal feed | Refresh that destination; keep origin checkpoint and sound choice intact. |
| Open/close Account or Settings | Pause current playback and return to the same journey state. A successful identity change resets the entire journey. |
| Choose Spaces/Global explicitly | End the journey and use the existing deliberate-context-selection behavior. Do not later resurrect the old return record. |
| Access denied during destination playback | Stop audio/video and clear its data; retain a safe route back to the original feed. Keep the account signed in on 403. |
| Origin denied/removed while away | Reauthorize on return. Clear denied content; show Access unavailable or restore a fresh allowed item if only the publication disappeared. |
| Offline during entry/return | Show retryable verification/loading state and Back/Spaces/Global escape; preserve credential and checkpoint for same-generation retry. Do not play protected cached content. |
| Session expires or account changes | Cancel requests, stop/release players, remove profile/detour/checkpoint state, and apply Plan 168's anonymous Global/sign-in behavior. |

## API Contracts

The following additions are implemented and documented in `docs/API.md`; host contract/integration checks pass. Physical acceptance remains in Phase F.

### Creator identity and personal entry

`GET /api/viewer/v1/creators/:userId` accepts optional viewer authentication. Validate a strict positive safe integer. Invalid supplied bearer/cookie authentication remains an error, not an anonymous fallback.

```ts
type CreatorView = {
  creator: {
    id: number;
    displayName: string;
    handle: string | null;
    avatarUrl: string | null;
    bio: string | null;
  };
  personalEntry:
    | { state: 'sign_in_required' }
    | { state: 'unavailable' }
    | { state: 'allowed'; space: {
        id: number; ulid: string | null; name: string;
        slug: string; type: 'personal';
      } };
};
```

- Missing/deleted creator: 404 with an error-only response. Active user without a public profile row: 200 with nominal identity and null optional private fields.
- Anonymous: `sign_in_required`, without querying/exposing whether that personal space exists. Signed-in absent/denied: `unavailable`, with no space identifiers/name or policy reason. Authorized empty feed: `allowed`; emptiness belongs to the feed response.
- Do not include email, phone, identity verification, private biography, moderation notes, credibility scores, follower counts, or role/subscriber rosters. Render biography as plain text; HTTPS avatar URLs must exclude embedded credentials and fail to a neutral placeholder.
- A valid identity with a failed access-store query must not become `allowed` or permanent `unavailable`. Return sanitized retryable 503. Current bans override owner/admin/member authority.
- Feed attribution and CreatorProfile must use the same safe identity projection, batched/joined for a feed page. Preserve the current creator meaning: upload owner, not requesting publisher or space owner. A personal destination's owner is resolved separately.
- Personal entry is advisory UI state, not a capability token. Reuse `/api/viewer/v1/spaces/:id/feed` for actual entry/pagination and existing foreground/60-second access checks. GET operations create no space, membership, subscription, or profile.

### Authorized return window

Extend the existing viewer feed GETs with an optional `anchorPublicationId` query parameter, mutually exclusive with `cursor`:

- `/api/viewer/v1/feed/global?anchorPublicationId=123&limit=60`
- `/api/viewer/v1/spaces/:id/feed?anchorPublicationId=123&limit=60`

For an anchored request, return the normal context/items/nextCursor envelope plus:

```ts
type ResumeResult = {
  requestedPublicationId: number;
  restoredPublicationId: number | null;
  outcome: 'restored' | 'unavailable';
};
// Added only for anchor requests: { ...ViewerFeed, resume: ResumeResult }
```

- Preserve normal cursor requests unchanged. Validate anchor/context/limit strictly; reject mixed cursor+anchor and unknown/malformed resume metadata on native.
- Authorize the feed first. Find the anchor through the same publication/upload/context/visibility eligibility as ordinary pages. Use publication ID plus explicit context; do not resolve by production ULID or search other feeds for the same video.
- Fetch a bounded, contiguous window in existing chronological order around the eligible anchor (up to min(20, floor((limit - 1) / 3)) newer rows, anchor, then older rows to the requested limit). Generate `nextCursor` from the last returned row using the existing cursor contract. Native locates the anchor by ID; its new list index need not equal its old index.
- Missing, unpublished, hidden, inaccessible, or wrong-context anchor: return the current feed's normal first page with `outcome: 'unavailable'` and `restoredPublicationId: null`. Do not distinguish why that requested publication is absent. An empty feed remains an empty success. Entire space denied/missing remains 403/404 with error only.
- Replace origin items with this fresh window. No cached prefix/tail is rendered before revalidation. Forward pagination continues from its returned cursor without duplication; backward browsing covers the returned newer portion. Earlier portions of the previously loaded feed can be recovered through an explicit feed Refresh. This milestone promises the same selected item/time, not retention of every previously loaded page.
- Do not fetch an entire feed to locate the anchor. Use bounded repository queries sharing current filters and ordering, including publication-ID tie breaking. Test query behavior and indexes; add an additive index only if the measured query plan requires it.

### Error behavior

Keep existing viewer conventions: 400 invalid query/ambiguous auth, 401 invalid/expired session, 403 denied feed, 404 unavailable creator/space, and sanitized 503 for retryable backend failure. No raw SQL/message details. A missing creator never signs out the user; an expired session does. A denied feed never returns media URLs or copied metadata.

## Native State and Playback Design

### Journey state

Add a small controller beside `ViewerNavigator`, with explicit events for open profile, verified personal entry, back to profile, return to origin, choose new feed, and reset identity. It owns one opaque journey generation and one return checkpoint. UI routes receive IDs/keys, never session tokens, player objects, or full API records in navigation params.

```ts
type FeedCheckpoint = {
  apiOrigin: string;
  authGeneration: number;
  journeyGeneration: number;
  context: FeedContext;
  publicationId: number | null;
  positionSeconds: number;
  userPaused: boolean;
};
```

Snapshot identity is the full context and publication pair. Same upload/production in two spaces must not share restore state. Time must be finite and nonnegative; clamp to the current media duration when restoring. No passwords, credentials, signed URLs, complete feed pages, or private profile fields belong in a checkpoint or exported diagnostic event.

### Route and ownership transitions

Keep the existing Feed, Spaces, Account, and Settings routes; add CreatorProfile. The single Feed route serves the original or destination context. An explicit detour header provides Back to profile while personal viewing is active. Profile Back/Close/native dismissal returns to the original feed. Account/Settings returns must target their actual parent journey screen rather than always popping directly to Feed.

Opening a profile pauses origin playback immediately. If the origin remains the same, it may retain at most its one paused current player as today. Entering the destination captures the origin time/pause, releases every origin lease/listener, and then replaces the root context and pops the profile. This sequencing is synchronous with respect to player-budget ownership; a delayed load cannot allocate after release.

Back to profile releases destination players and switches the hidden root back to the saved origin context in a restore-pending state, then shows the creator profile. Dismissing the profile authorizes and restores the anchor before enabling playback. Profile data can reload independently of the origin; its network failure must not trap the user. Gesture cancellation must not commit a half-finished destination or trigger hidden playback.

Allow only one pending navigation/entry transition; disable/coalesce repeated taps. On an obsolete profile response, do nothing. New creator selection within a personal destination reuses the existing journey's origin and replaces its creator/destination state. The UI must continue to name the original return destination so the shallower history is understandable.

### Playback restoration

- Extend PlayerPort with a testable current-time read and seek-to-time operation; implement these with the installed expo-video API. Preserve `seekToStart` behavior for ordinary swiping and Retry unless an explicit restore request is present.
- Capture the origin near the accepted navigation event after pausing it. Never derive release-build position from development-only diagnostic progress events.
- Store a pending restore keyed to the exact publication, activation, and journey/auth generations. Apply it once after source readiness; suppress playback while seeking/restoring. Clear it on a new selection, explicit Refresh, failed authorization, or obsolete activation.
- Restore the original manual-pause intent before any possible play call. A playing origin resumes only after screen focus, foreground, access validation, and seek completion all permit it. Manual pause remains paused. If the platform cannot restore accurately or media changed, show a recoverable result and use the documented safe fallback rather than freezing.
- Set a restore timeout (10 seconds by default) with Retry/Start from beginning/Back controls. Start from beginning is allowed only after current feed/item authorization succeeds. A timeout must leave header/navigation responsive.
- Time target for valid same-media restoration is within one second of the captured position on the test iPhone; record actual deviation. HLS may need a visible cold load. Do not count a cold return as a prepared-swipe regression or imply an instant resume guarantee.
- Preserve the global three-player budget, terminal coordinator disposal, stale-event suppression, and manual pause/mute across Account/Settings/background/lock. Profile-only open/close must not reset the video's time to zero.

## Phase Status

- A: Complete — contracts, policy audit, and test fixtures
- B: Complete — shared authorization, creator projection, and return-window API
- C: Complete — checkpoint restoration and player ownership
- D: Complete — native profiles and the complete detour navigation
- E: Complete — integration, browser compatibility, and failure recovery
- F: Complete — focused iPhone development acceptance and documented handoff limits

## Phase A — Freeze Contracts and Access Fixtures

Goal: resolve identity/privacy and access semantics before any new native entry path can expose content.

- [x] Confirm active-user display-name/handle projection, hidden/no-profile handling, upload-owner attribution, and all personal authorization callers. Record intentional public-flag/subscription exclusions in shared policy tests.
- [x] Verify how explicit personal-space membership is represented and which existing site-admin authority is used. No new approval/grant UI or data migration; if the existing representation cannot express an explicit grant, record the exact missing prerequisite before inventing a substitute.
- [x] Freeze the creator DTO, anchored-window schema, error mapping, and exact route/query names above. Check existing feed filters and cursor boundary/timestamp tie behavior for reuse.
- [x] Specify journey events and the single-root-route transition table, including account generation resets, cancelled gestures, nested creator replacement, and intentional Spaces/Global exits.
- [x] Extend opt-in disposable viewer fixtures with public/hidden/no-profile/deleted creators; owner/member/unauthorized/banned personal viewers; a misleading public-flag and subscription-only personal case; empty and populated personal spaces; and an origin/destination sharing one production with distinct publication IDs.
- [x] Use only labeled fixture users/spaces and non-confidential media. Snapshot fixture mutations, restore in finally blocks, and keep credentials in ignored private files. Do not change ordinary user access or legacy publishing flags globally.

Test gate: reviewable contract tables, fixture IDs without credentials, and executable failing tests for the new behaviors. Run existing `npm run test:viewer` and targeted mobile navigation/playback tests as the pre-change baseline; record outcomes. Read-only schema/index inspection only; do not rerun general schema setup solely to investigate this plan.

Acceptance: all intended permissions/fallbacks can be tested without modifying real accounts; no unresolved policy assumption is hidden in a UI button.

## Phase B — Implement Shared Viewer Reads and Personal Authorization

Goal: expose safe creator information and fresh authorized feeds consistently for web and native.

- [x] Add the creator projection/service and `/api/viewer/v1/creators/:userId`, reusing `resolveViewer` and sanitized error handling. Enforce active-user and optional-field visibility before serialization.
- [x] Add a personal-space branch to shared `canViewSpaceFeed`; retain ban-first behavior and existing group/channel policy. Exercise browser and native route callers. No schema change is expected.
- [x] Resolve an existing personal space without side effects; compute allowed entry without disclosing denied metadata. Test that access checking errors fail with retryable 503.
- [x] Add anchored windows to viewer feed parsing/service/repository and response allowlists. Factor common eligibility rather than creating a less restrictive pinned-query path. Cover normal pagination unchanged.
- [x] Align feed creator names/avatars with the safe profile projection using a join or one bounded batch per page; avoid an N+1 profile/access query per video. Preserve existing creator ID attribution.
- [x] Add backend contract tests and real fixture integration for cookie/native parity, response-key allowlists, deny bodies, profile privacy, origin anchors, pagination, removed items, and invalid query combinations.
- [x] If query inspection proves an index is necessary, amend this plan with exact additive idempotent DDL, measured impact, and a repeat-run check before changing `src/db.ts`. No drops, broad updates, or dump restore are part of this plan.
- [x] Update `docs/API.md` with the implemented contracts and intentional personal-space policy correction.

Test gate: `npm run build`, `npm run test:viewer`, and the new focused creator/return API fixture check. Re-run `npm run viewer:check` after extending its intentional policy expectations; run fixture-mutating checks sequentially. Anonymous, native bearer, and browser cookie calls must exercise real route/service behavior, not only stubbed serializers.

Acceptance: an unauthorized caller sees nominal identity only, no optional private fields or personal feed metadata/media; owner/explicit member can enter; bans win; public/subscription/follow shortcuts fail; no read creates a relationship.

## Phase C — Add Return Checkpoints and Restore Playback

Goal: preserve original item/time/pause without retaining a hidden player pool.

- [x] Add a bounded memory-only checkpoint/journey controller and generation-scoped reset behavior. Reject restore after identity/API origin change.
- [x] Extend native player adapter/coordinator with direct time capture, suspend/release, and one-shot pending time restore. Guard asynchronous status/seek/error callbacks against old activations and terminal disposal.
- [x] Extend feed adaptation/store/session to load an anchored window, locate the returned publication, initialize FlatList at its actual index, and continue pagination from fresh response state. Avoid a one-frame playback flash of item zero before restore.
- [x] Restore pause before enabling playback; retain current mute. Explicit feed Refresh clears pending item/time restoration while preserving the original journey checkpoint when refreshing only the destination.
- [x] Implement finite restore/error timeout and controls, including no progress deadlock or native-thread busy loop on synchronous player failure.
- [x] Test paused/playing origins, invalid/changed duration, missing anchor, seek failure, late first-frame/status events, cancelled load, account change during restoration, repeated entry/return, and zero-to-three player ownership at every handoff.

Test gate: mobile `npm test` and `npm run typecheck`; new tests must drive the actual checkpoint controller, FeedStore, PlaybackCoordinator, and PlayerBudget with a controllable player clock/seek port. At each transition, assert old players stopped/released, no wrong-publication seek/play, and no allocation above three. Baseline ordinary swipe revisit/Retry behavior stays intact.

Acceptance: original selection/time/pause can be restored deterministically; stale callbacks cannot allocate, seek, or play; failure leaves usable recovery controls.

## Phase D — Build Profiles and Complete Native Navigation

Goal: make the complete creator detour usable in the installed app.

- [x] Add a minimized mobile profile adapter/client/store and `CreatorProfileScreen`; validate identity/entry/context schemas and cancel/coalesce requests by creator/auth/journey generation.
- [x] Add an accessible creator press target with a clear spoken label, avatar fallback, plain-text bio, expandable layout, and loading/retry/unavailable states. Prevent double activation or conflict with scrolling/video tap controls.
- [x] Wire anonymous Sign in to Account with clear existing reset behavior. Allowed entry uses server space metadata and performs fresh authorization; unavailable entry has explanatory text without dead/request-access controls.
- [x] Add CreatorProfile to the existing stack and implement the one-Feed-route detour transitions. Make Account/Settings return to the screen that opened them; remove assumptions that every temporary screen should always pop to Feed.
- [x] Give the personal feed a Back to profile action and context label; profile Back/Close returns to the original feed. Handle native back gestures, cancelled gestures, repeated creator taps, selecting the creator already being viewed, and a new creator within the destination.
- [x] Implement deliberate Spaces/Global exit, empty personal feed, access loss, offline retry, and session/account reset paths without trapping or replaying stale origin content.
- [x] Extend development-only diagnostics with origin/destination context, journey generation, restore outcome and sanitized time deviation; no credentials, biography, or media URL. Separate cold resume from prepared-swipe metrics and retain errors/incomplete events.

Test gate: mobile tests/typecheck/iOS export. Use the installed StackRouter and actual journey/controller/coordinator code for navigation assertions: one Feed route after repeated detours, no late entry on obsolete auth, correct Account/Settings parent, and gesture cancellation preserving eligibility. Test screen/store integration for permission errors and request cancellation; avoid tests that merely duplicate a route-name constant.

Acceptance: Global or any space can open a creator, authorized personal viewing works, and return reaches the original context/item with intended pause/sound and responsive controls.

## Phase E — Verify Integration and Web Compatibility

Goal: exercise the new journey against real authorization and failure transitions before device handoff.

- [x] Run the creator/return fixture suite against the integrated backend, covering public/no-profile/private-profile/deleted identity, permission grant/removal while away, expired session, unavailable origin publication, same production in two contexts, and cursor continuation after restore.
- [x] Verify frontend profile peek and public profile remain functional with existing legacy contracts; browser Global/own-personal/group/channel feeds retain expected behavior. Add explicit web denial checks for another private personal space with misleading public flags.
- [x] Verify no personal metadata/media leak in denied responses and no native auth reaches avatar/poster/media hosts. Check standard viewer transport behavior for invalid/ambiguous credentials and store failures.
- [x] Exercise offline entry/return, coalesced taps, API timeouts, avatar failure, cancellation during a request/seek, and account switch during each transition. Failed profile/restore requests must leave Back, Account, Spaces, and Refresh usable where appropriate.
- [x] Review query counts/plans, bounded journey/store lifetime, subscriptions/listeners, and diagnostic limits after repeated detours. No new dependency or native build unless an actual native configuration change requires one.

Test gate: backend build/contract tests, mobile tests/typecheck/export, focused real-API creator/return checks, then `npm run viewer:check:web` extended with relevant browser cases. Broaden to session integration only if shared session code changes. Save sanitized API/browser evidence under ignored harness folders with scope, environment, expected/observed results, and gaps.

Acceptance: web and native agree on personal-space access, optional private fields stay hidden, and all automatic identity/access resets and recoverable failures reach the intended state.

## Phase F — Accept on iPhone and Document the Milestone

Goal: verify the new behavior on the installed Video Viewer app with a small, explicit acceptance set.

- [x] Confirm the installed app/runtime/server versions and reload the new JavaScript. Reuse the existing signed build unless native inputs changed; do not request Apple sign-in again without a concrete need.
- [x] Perform the three device sessions below. Ask for concise observations and one compact report per relevant run; do not repeat Plan 168's accepted checks unless this implementation changes them or a regression appears.
- [x] Review normal playback metrics separately from cold entry/return timings. When changes touch shared playback, take one focused normal-forward sample; compare against Plan 168's prepared p95 about 110 ms and peak three players. Proposed regression gate: prepared p95 ≤150 ms and ≥90% prepared on normal forward transitions after initial entry, using at least 30 samples on stable Wi-Fi; cold returns remain separate.
- [x] Update `mobile/README.md`, `docs/API.md`, roadmap, implementation index, and this plan with delivered behavior, evidence, exceptions and next scope. Update root README only for confirmed developer-facing changes.
- [x] Mark all phases Complete only after their gates pass or a clearly recorded exception is accepted. Do not claim VoiceOver/release qualification from the existing user deferral. Commit/push only when explicitly requested.

Acceptance coverage and limits:

- Installed Video Viewer 0.1.0/build 1 on the recorded iPhone 17 Pro Max / iOS 26.6.2 uses SDK 57 with the new JavaScript; no native-input change or second Apple sign-in/build was needed.
- Device observations cover profile-only and paused/playing personal-feed return, current mute through destination Refresh, restored sign-in/Spaces, destination denial/audio stop, no-password recovery, expiry reset, offline return/reconnect, qualitative mixed resource/lifecycle behavior, and profile readability/reachability.
- Stable-Wi-Fi final sample has 40 prepared normal transitions (100%), first-frame p95 120.38 ms, zero errors/incomplete/ownership warnings, peak three players. Two initial/cold selections and the user's single perceived ~500 ms spinner are retained separately; no unsupported cause is assigned to that spinner.
- Position is qualitatively near the saved time, not a separately measured physical ±1-second deviation. Mixed browsing was estimated close to five minutes, perhaps shorter, and background/lock checks were completed separately. Hidden/empty/unavailable identity/privacy cases and cancelled gesture/late-callback cases have API/browser/rendered host coverage; do not claim separate physical acceptance for every planned edge case.
- New profile text/buttons were readable/reachable at the tested size; full larger-text/screen-reader coverage is not claimed. Existing explicit VoiceOver deferral and accepted baseline high-size pill clipping remain. Post-correction timeout controls are host-tested; the phone follow-up had no stall requiring them.
- Prior whole-app freeze has an unconfirmed native cause; no recurrence was observed in the short/final post-correction checks. The JavaScript watchdog cannot recover a blocked native/JS thread. Release/native profiling and confidential media delivery remain later scope.

### Device session 1 — Profiles and return

1. In anonymous Global, play a video several seconds in, open its creator profile, and close it. Confirm same video/time and no hidden audio. Verify public identity, avatar fallback, allowed bio, and sign-in explanation.
2. Signed in with an authorized fixture, start from a recognizable non-first Global publication. Pause around 5–10 seconds, open creator → personal feed, swipe a few videos, then Back to profile → original feed. Confirm context/publication, position within one second where media permits, and still paused until Play.
3. Repeat once from a group/channel origin while playing with sound. Change mute during the destination; confirm return resumes original playback with the current mute choice. Refresh the destination and open/close Account/Settings once; origin checkpoint must survive.
4. Check a denied personal destination, an allowed empty feed, and a hidden-bio/no-profile identity using prepared fixtures. Repeated creator taps and a cancelled back gesture must not duplicate feeds or start hidden audio.

### Device session 2 — Access and recovery

Use disposable accounts only. While away in the personal destination/profile, remove origin or destination access in a controlled host step, then return/retry. Confirm playback stops/does not restore denied content and the valid account stays signed in. Restore access and confirm recovery without a password. Test one fully-offline entry or return and reconnect/Retry. Finally expire the fixture session or switch accounts while a profile is open; confirm anonymous Global or the new account with no stale return route. Snapshot/restore exact grants/session state and clean up fixture sessions afterward.

### Device session 3 — Resources and layout

Browse for about five minutes with repeated Global/space → creator → personal → original journeys, several rapid swipes and one background/lock cycle. Verify no overlap/wrong video, frozen controls, accumulating players, or persistent spinner; report peak ≤3 and any guarded/errors/incomplete transitions. Check long creator names/bio, larger text and clear accessible labels on the new controls. VoiceOver remains deferred unless the user elects to test it; do not repeat the prior explanatory/testing loop.

Acceptance: the complete new journey passes on the installed iPhone app, with API/browser tests supporting privacy/access cases and recorded cold-load/seek limits. A development build still needs Metro; this plan does not claim independent release distribution.

## Deliverable Map

| Area | Expected files or modules |
| --- | --- |
| Backend identity projection | New viewer-facing profile module under `src/features/profiles/`; safe feed creator projection shared with `src/features/feeds/viewer.ts` |
| Shared access and anchored selection | `src/features/spaces/service.ts`, `repo.ts`; `src/features/feeds/{repo,service,viewer}.ts`; `src/routes/viewer.ts` |
| Native creator presentation | New `mobile/src/profiles/` API/adapter/store/screen modules; creator press target in `mobile/src/feed/FeedCard.tsx` |
| Journey and restore state | New small controller/checkpoint module under `mobile/src/navigation/`; navigator and temporary-screen return integration |
| Feed and player integration | `mobile/src/feed/{FeedScreen,feedStore,useViewerFeed,adaptFeed}.ts*`; playback coordinator/adapter; diagnostics as needed |
| Regression coverage | Backend tests named within the existing `native*.test.ts` runner; mobile profile/journey/restore tests; opt-in API/browser fixture scripts |
| Documentation | API and mobile docs, roadmap/index and this plan; root README only if implemented developer workflow changes |

File names beyond existing paths are implementation targets, not files already present. No schema, package, app-signing, or build-profile change is expected without a demonstrated need.

## Change Log

- 2026-10-22 — User explicitly requested commit and push. Reviewing/staging the completed creator/profile/return implementation, regression tests and acceptance docs, including the prior Plan 168 continuity note. Private credentials/fixtures, generated output and diagnostic reports remain ignored.

- 2026-10-22 — Completed A–F for the recorded development milestone after final forward sample passed: 40/40 prepared normal transitions, p95 120.38 ms, peak three and zero errors/incomplete/unexpected playback. Documented brief spinner, unresolved prior native-freeze cause and host/physical coverage limits. Source/contracts and acceptance docs ready for review; no commit/push requested.

- Startup failure follow-up — user reports third-video loading delays twice and all controls frozen on the first attempt. Queue selected cold play after source replacement and keep the startup deadline until both frame and playback evidence; no speculative player/buffer/authorization/native-input changes. Host verified; native freeze cause and phone acceptance remain unresolved. No commit/push.

- Stable-Wi-Fi speed acceptance follow-up — normal preparation misses target despite passing prepared latency/resource checks. Added diagnostic-only source replacement/readiness stage timing and compact outliers; scheduling/buffering/auth unchanged. No commit/push or native build.

- 2026-10-19 — Offline return/reconnect passed on iPhone. User requested a pause for travel and expects to return in about three days; no further implementation or device requests until they return. Recorded a resume checkpoint; no commit/push requested.

- 2026-10-18 — Corrected device-discovered sign-in regression: screen-group identity key no longer changes at request-generation advancement. Account remains mounted during pending login; successful principal/API changes still reset navigation. Added permanent AuthStore/StackRouter regression tests and expanded controlled rendered checks to actual AccountScreen/SpacesScreen. No commit or push.

- 2026-10-18 — Implementation authorized and A–E completed: minimized creator/profile read, explicit shared personal authorization, exact-publication return windows, one-root native detour, current-time/manual-pause restoration, safe profile store/screen, diagnostics and regression/docs updates. Phase F awaits physical iPhone acceptance. No dependency/schema/native-build change, commit, or push.

- 2026-10-18 — Planning only: created Plan 169 for creator profiles, explicit personal-space entry, authorized original-feed restoration, and focused host/browser/device acceptance. Updated roadmap/index links. No implementation, dependency install, database write, commit, or push.

## Validation

- Final handoff review: `git diff --check` passes; all local Markdown targets in the six changed developer/plan/roadmap documents resolve. Private fixture credential scan covers 40 intended changed source/docs/test files and five fixture secret values, with zero matches. `npm run check:agents:docs` retains exactly the same 16 pre-existing older-plan status/header findings (Plans 138, 140–142, 148–159), with none for Plan 169 or new broken references. No unrelated plans changed. No source changes since the 129-test/typecheck/iOS-export pass, so no redundant host suite was rerun after the device report. Evidence: `tests/runs/device/plan_169/final-review.json` and `final-agent-docs.log`.

- Final physical normal-forward gate PASSED, report generated 2026-10-22T15:10:26.487Z: 42 selections/first frames, 40 normal and all 40 prepared (100%), normal/prepared median 87.57 ms / p95 120.38 ms / max 130.08 ms; zero errors/incomplete/unexpected playback, live/peak three and 45 allocations / 42 releases. Two initial frames max 628.36 ms remain separate. User reports one roughly 500 ms spinner near transition 14; cause is not established by compact readiness timings. Latest five retained details show playing and progress; omitted details are not inferred. No history dropped. Post-correction smoke/final run reports no freeze recurrence, without proving its native root cause. All numeric checks evaluated against saved JSON; no source change or repeated host suite for this observation. Evidence: `tests/runs/device/plan_169/forward-speed-final-report.json` / `forward-speed-final-observation.json`.

- Fixture final read-only audit: driver complete, original roles 3359/3360 restored, expired bound session revoked. One fresh disposable phone login from the resumed acceptance run remains active intentionally; it is not an uncleaned host-created test session. No ordinary accounts changed.

- Resumed after bedtime at user request. Public API health returns 200/ok, Expo tunnel reports packager-status:running, and ports 3300/8081 are listening. No restart or source/test changes needed. Request a fresh Reload and the final stable-Wi-Fi forward-only numerical sample; earlier short recovery result remains passed and other accepted checks need no repetition.

- User paused for bedtime before supplying the final numerical report. Short updated-controller follow-up remains passed; do not mark the preparation/speed gate complete. Resume when the user returns: verify server/tunnel availability, then fresh Reload for a clean forward-only stable-Wi-Fi sample if the previous session was backgrounded overnight. No repetition of earlier accepted profile/access/mixed checks and no commit/push requested. Development servers left running; availability must be verified on return.

- Updated-controller short phone follow-up passed qualitatively: user replies “No more problems. No more stalling” to the first-3-to-5 Global protocol. No new compact report/measured count supplied; timeout error UI not exercised. Original native-freeze cause remains unconfirmed and absence of recurrence is not root-cause proof. No source change/host suite repeat needed for this observation. Final numerical sample requested by continuing the same forward-only Global session on stable Wi-Fi to about 40 transitions, ≥2 s per item, feed Refresh permitted. No repeated mixed/profile/access run or Reload required if the sample remains forward-only. Evidence: `tests/runs/device/plan_169/startup-recovery/device-observation.json`.

- Targeted diagnostic attempt failed: user reports third Global video delayed twice; first froze Account/Spaces/Refresh/swipes and required force quit, without a captured report. Captured second attempt includes intentional pause: publication 244 had 3.07 s preload lead, replacement resolved in 238 ms, ready at 13.56 s from load / 10.48 s from selection, first frame 10.45 s, no playing/progress and zero errors. Do not attribute lack of playback/timeout errors solely to a bug because manual pause suppresses them, or claim this is a trace of the lost first freeze. Native freeze cause is unconfirmed. Evidence: `tests/runs/device/plan_169/startup-failure-report.json` / `startup-failure-observation.json`.

- Controller correction implemented: selected eligible cold source queues play after owned asynchronous source replacement resolves, letting native buffering proceed; neighbors stay paused/muted and prepared classification stays conservative. Coordinator owns a ten-second eligible startup watchdog requiring BOTH first frame and playing/progress evidence. Manual pause, scrolling, background/screen eligibility, restore and disposal defer/cancel it; callbacks from disposed/obsolete selections are ignored and late ready cannot undo failed state. VideoSurface spinner also waits for playback evidence. No native rebuild, dependency/buffer/count/auth change. New regressions cover queued cold selection eligibility, first-frame-only timeout, playing-without-frame timeout, manual pause/background/selection/disposal, near-zero progress and retry. All 129 mobile tests, typecheck and iOS export pass; evidence `tests/runs/device/plan_169/startup-recovery/`. This is a bounded startup/recovery correction, not a proven native-freeze or performance fix. SDK 57 and Apple AVPlayer primary docs reviewed: [Expo Video](https://docs.expo.dev/versions/v57.0.0/sdk/video/), [native automatic buffering](https://developer.apple.com/documentation/avfoundation/avplayer/automaticallywaitstominimizestalling).

- Stable Wi-Fi explicitly confirmed for forward sample; ≥90% normal preparation remains unmet at 85.7%. Native installed-source review shows asynchronous replacement includes asset-property loading before assigning the player item; promise completion and buffered-ready status are distinct and not timed separately by the old report. Added `load_started`/`load_resolved` diagnostics, per-transition `sourceLoad` timings and up to five compact cold/slow/incomplete normal rows. Live-load association is removed on release; retained transition timings survive event rollover, keep retries/sessions separate and export copies. No media URLs, extra requests/polling, buffer/player-count/authorization changes or native upgrade. Five new regressions cover stage separation, stale disposed callbacks, retry/session attribution, rollover/outlier retention and compact size. All 124 mobile tests, typecheck, iOS export pass; API health, Metro manifest and 4,772,478-byte bundle return 200. Evidence: `tests/runs/device/plan_169/loading-diagnostics/`. Next focused device collection stops at the first noticeable forward-loading delay or end of one Global pass; no repeated mixed-duration checks. This is not a speed fix or acceptance pass.

- Existing full phone report reviewed (generated 2026-10-22T06:13:02.306Z): cold normal publications 222/201/186/144/137 were allocated 2.65–4.05 s before selection, with 4.40–8.42 s allocation-to-ready and zero buffered seconds at selection. No intervening replacement/eligibility check affects those five entries. Brief access revalidation at activation 16 recreates neighbors, but next 197 is prepared; later backgrounding follows final selection and does not explain earlier slow selections. All selection metrics match the earlier compact. Current host public HLS checks for five cold and two prepared items return master/first-listed variant 200 and media-resource range 206 with CloudFront hits; no current signature denial reproduced. Some playlists reference byte ranges in one file; whole-resource size must not be presented as segment size. Exact phone rendition/network/native-preparation cause remains unconfirmed; no speculative playback change or new timed run. Network condition not explicitly confirmed. Evidence: `tests/runs/device/plan_169/forward-speed-full-excerpts.json` (selected extracts, not a complete raw copy), `media-startup-host-check.json`; reproducible ignored read-only checker `.codex-local/plan169-media-startup-check.cjs`.

- Forward-speed sample generated 2026-10-22T06:08:02.126Z: 37 selections/frames, zero errors/incomplete/unexpected playback and peak three players. Two initial selections; 35 normal, of which 30 prepared (85.7%). Prepared p95 110.12 ms meets ≤150 ms with 30 samples; normal preparation fails ≥90%. Normal p95 3008.06 ms, max 5747.98 ms; user reports mostly seamless swipes with 3–4 roughly one-second spinners. Keep measured presentation readiness distinct from subjective spinner time. Latest five compact details are all prepared; all 649 events and 32 earlier transitions omitted but no history dropped. Stable Wi-Fi confirmation requested; collect existing full report to inspect allocation/readiness/eligibility around slow selections. Source comparison does not establish a specific preloading regression; no speculative product changes or new timed run. Phase F remains In Progress. Evidence: `tests/runs/device/plan_169/forward-speed-report.json` / `forward-speed-observation.json`.

- Mixed-run duration now estimated by user as close to five minutes, possibly shorter; retain qualitative limit and do not request a repeated mixed run.

- Audio/layout follow-up passed: user explicitly confirms sound stops the entire hidden/locked interval, resumes with video, and creator-profile text/buttons are readable/reachable. Resource ceiling remains live/peak three. Record mixed-run seven incomplete selections, three immediately-paused selected-player scrolling guard events and cold loads up to 5.23 s; do not silently classify them as error-free completion or audible overlap. No exact duration, larger-text size or measured position deviation supplied. Requested only a rough earlier duration estimate (no repeat run) and final focused forward sample: fresh Reload, stable Wi-Fi, Global, 35 forward swipes with two seconds per video, Refresh allowed, no mixed activities. Evidence updated in `tests/runs/device/plan_169/mixed-browsing-observation.json`.

- Mixed-run follow-up: user clarifies original run omitted background/lock, then tried both separately. Return shows access check/loading usually about one second and occasionally two before resuming; Account return similar, Settings described as immediate. Source review confirms foreground identity validation and protected feed foreground/refocus identity + space validation; playback is suppressed during checks. Both Account/Settings return paths share the feed guard; visible timing alone does not establish a bypass. Hidden/locked audio cessation, same-video resume and profile readability/reachability confirmation requested without another timed run. No product change or host suite repeat. Evidence updated in `tests/runs/device/plan_169/mixed-browsing-observation.json`.

- Resumed mixed device run, report generated 2026-10-22T05:52:20.806Z: 89 selections / 82 first frames / 7 incomplete, zero errors, 111 allocations / 108 releases and live/peak three players. Prepared p95 120.61 ms; cold max 5230.37 ms. User reports early rapid forward/backward spinners mostly resolved. All three unexpected-playback issues are the selected player reporting playing while scrolling; coordinator immediately pauses it. These records do not establish audible overlap or its absence. No nonselected/background warning appears. Seven incomplete reasons are unavailable in compact details. recentRestores is empty and shares the rolling 1000-event history (43 events dropped), so no new measured return claim. Await explicit duration/lifecycle/layout confirmation and separate normal-forward sample; no product source change or repeated host suite. Evidence: `tests/runs/device/plan_169/mixed-browsing-report.json` and `mixed-browsing-observation.json`.

- 2026-10-19 — Offline personal-feed return passed: user confirms Cannot Verify Access, no video or sound while offline, and video loads after reconnecting without another sign-in. Evidence: `tests/runs/device/plan_169/offline-return-observation.json`. Work paused at user request; no additional device check requested.

- 2026-10-19 — Session-expiry acceptance passed: user confirms foreground returns to anonymous Global with protected video stopped, Account showing sign-in and Spaces requiring sign-in. No separate Back-gesture observation supplied. Scoped driver finish completed: both original fixture roles restored, bound session revoked, zero active fixture sessions and normal accounts unchanged. Access-loss/recovery/expiry sequence is complete; offline return/reconnect is next. Evidence: `tests/runs/device/plan_169/access-recovery-observation.json`.

- Personal-feed recovery passed on iPhone: after restoring the original fixture grants, user confirms video plays again without signing in. Scoped driver then expired only the bound fixture session; status is expired, original grants restored and zero active fixture sessions. Await foreground anonymous reset/protected-route removal, then run finish cleanup. Evidence updated in `tests/runs/device/plan_169/access-recovery-observation.json`.

- Controlled personal-access denial passed on iPhone: user confirms Access unavailable, video and sound stop, and Account remains signed in. Scoped driver restored both original fixture grants; status is restored with one active fixture session. Await personal-feed recovery via Try again/Refresh without another login before expiring the bound session. Evidence updated in `tests/runs/device/plan_169/access-recovery-observation.json`. No product source change or repeated host suite.

- Controlled personal-access check is underway: user explicitly confirms disposable A is playing with sound in creator B's personal space. Scoped driver `deny` removed only the two snapshotted fixture roles; status is denied with zero explicit grants and one still-active fixture session. Device denial/audio-stop/account-retention observation is pending. Keep grants denied until that observation, then restore and check recovery before expiring the bound fixture session. Evidence: `tests/runs/device/plan_169/access-recovery-observation.json`.

- Phone personal-return acceptance passed: user explicitly confirms paused origin → creator → personal-feed browsing → profile → origin restores the same publication near the saved position and remains paused. A playing origin → destination mute + Refresh → return also passes: original resumes near prior position, current mute carries back, no overlapping audio or persistent spinner. Position is user-observed, not an independently timed numeric deviation. Source unchanged; no host suite repeat. Evidence: `tests/runs/device/plan_169/personal-return-observation.json`.

- Prepared ignored scoped driver `.codex-local/plan169-device-access.cjs` for the later phone access/expiry check. Syntax/status checks pass; prepare has now saved the exact original fixture grant roles. Driver phase is prepared with two explicit role grants and one active fixture session. No role/session mutation or deny action executed. It guards exact fixture A/B identities and personal space, snapshots role IDs, binds one active fixture session at deny, restores grants and expires/revokes only that bound session. Do not deny until the user explicitly confirms disposable A is playing in its B personal destination. Normal accounts are outside driver scope.

- Sign-in phone retest passed: after Reload user confirms the requested Account signed-in identity and Spaces account list now work. Their broad “all works now” reply may include the resumed personal detour, but exact item/time/pause confirmation was not separately stated; ask once without requesting a repeat if already observed. No source changes or additional host suite needed for this observation. Evidence updated in `tests/runs/device/plan_169/signin-regression-observation.json`.

- Sign-in regression fixed: actual rendered AccountScreen/AuthStore/ViewerNavigator/StackRouter reproduction was red before fix (submit immediately became anonymous/Feed before requesting login), green afterward (pending sign-in remains Account; successful identity persists and actual SpacesScreen renders the authorized group). Explicit Back cancellation still aborts and revokes a late session. Navigation group now keys API origin + viewer principal; auth generations remain on transport/checkpoint/playback and stale-response guards. All 119 mobile tests, typecheck, iOS export and prior 140-assertion rendered profile/detour harness pass. Live fixture login 201 → validation 200 → Spaces 200, test session revoked. Metro manifest/bundle 200 (4,770,357 bytes). Phone Reload/retry is pending. Prior user-reported signed-in Global profile result did not independently confirm account state and is qualified accordingly; anonymous profile result remains passed. Evidence: `tests/runs/api-curl/plan_169_signin_regression/`.

- Device acceptance regression: user reports both normal and disposable accounts appear to sign in, then Spaces asks for sign-in. Reopened D to investigate. New navigation group key includes auth generation, which advances at sign-in start; Account unmount cleanup calls cancelSignIn while login is pending. Existing rendered navigation harness mocked Account and did not exercise this lifecycle. Reproduce with real AccountScreen/AuthStore plus stack before changing the key; prior profile-only Global passes remain valid.

- Phase F first phone result: user confirms creator profile open/close works from Global both anonymously and signed in, including audio stopping while covered, returning to the same video/position, and preserving manual pause. This validates the profile-only path; personal-feed context handoff/time-seek restoration and the remaining access/resource/layout cases are not yet accepted. No source change or repeated host suite was needed for this observation. Evidence: `tests/runs/device/plan_169/profile-global-observation.json`.

- Final pre-device review: new profile content observes bottom safe area; obsolete creator/back callbacks cannot release or navigate the new identity's feed; an unavailable media card cancels pending restore without an impossible seek timer. Latest focused tests/typecheck/export and 140-assertion rendered harness pass after these fixes. Credential/scope scan covers intended source/docs and sanitized evidence; private fixture files, credentials and builds remain ignored. Whitespace passes; agent docs checker retains the same 16 older-plan findings and no new Plan 169 issue. First phone observation remains pending; no physical acceptance or Git action claimed.

- Current host gate: backend 18 tests/build; creator API 83 checks; prior viewer API 150 checks; mobile 117 tests/typecheck/iOS export; actual React navigator/profile harness 140 assertions; live browser 12 checks all pass. Live HTTPS fixture API/master/variant/segment/poster all 200, no credentials sent to media. Metro manifest/bundle 200 (4,768,471-byte development bundle). Actual EXPLAIN uses existing space-status/global-feed indexes and primary-key anchor lookup (1 row); no DDL. Controlled timeout test confirms failed seek cannot late-resume and Start from beginning stays usable. New restore diagnostics record bounded context/generation/outcome/time deviation; physical frame/time confirmation remains outstanding.

- Phase D: creator screen/store, single-route detour, current-time return and parent-aware Account/Settings close are implemented. Mobile 117 tests, typecheck and iOS export pass, including timeout/unavailable-source restore regressions. Final focused creator/journey tests and the actual rendered navigator/profile harness were rerun after stale-identity and safe-area review. A controlled React harness renders actual ViewerNavigator and CreatorProfileScreen with the installed StackRouter and native-boundary doubles: 140 assertions pass over 12 full detours, one live root owner, Account/Settings parents, original checkpoint, late auth completion, cancellation/unmount and fresh denied entry. Harness uses existing temporary React test-renderer; no dependency/package upgrade. Device gestures, native seek and layout remain Phase F.
- Phase E: live HTTPS creator/space reads succeed and source HLS master returns 200. Initial cloned-fixture keys used a different filename leaf and produced invalid derived media URLs; corrected only fixture metadata to unique directory plus original leaf, and updated fixture generator. No S3 objects or original uploads changed. Browser profile/peek test initially used an incorrect accessible-name selector; corrected to the visible existing title attribute. The live browser regression now passes 12 checks, including public/hidden legacy profile, UI login, origin feed, actual profile peek, allowed personal reads, denied cross-account personal read and logout.

- Phase C: all 110 mobile tests and typecheck pass. Actual coordinator tests cover captured current time, seek-before-play, manual pause, stale completion after disposal, clamping/seek failure, moving past failed restore, and 20 resource handoffs under the shared budget. Adapter/store tests reject wrong or absent restored items and carry fresh return metadata. Checkpoints/journey state are memory-only; explicit initial anchored loading and ordinary cursor pagination remain separate. Native time seek uses release-build current-time reads rather than diagnostic events. Physical seek accuracy remains for Phase F.

- Phase B: backend build and all 18 contract tests pass (new privacy, input and exact-publication window cases included). Real creator integration passes 83 checks across anonymous/native/browser identity, optional-field visibility, empty/deleted creators, anchored windows/tie ordering/pagination, removed/wrong-context publication fallback, shared web denial, subscription/public-flag exclusion, owner ban and injected access-store failure (503). Explicit fixture grants restored and created native sessions revoked. Initial harness failures concerned legacy no-store expectations and the subscription table composite primary key; cleanup and harness corrected. No schema/index change. The live development watcher stalled waiting for a compiled cache marker; restarted the watcher using task-specific memory-backed cache, then health returned 200. An unrelated existing media worker progress_message error appears in startup logs and is outside this viewer change. Existing viewer integration also passes all 150 checks, including the prior web/native space matrix.

- Phase A: baseline backend 14/14 and mobile 103/103 tests pass. New creator/anchor contract test fails as expected before implementation (missing projection/export). Read-only DB audit confirms existing personal membership roles (`space_member`, `space_poster`), ten personal spaces, eight with public flags, no non-owner role grants and no personal subscriptions. Existing feed indexes include global/space publication cursors; no schema change is planned. Disposable Plan 169 fixtures use new ordinary accounts and metadata-only copies of public outputs with unique fixture storage keys, explicit personal grants and distinct origin/destination publications. First fixture attempt rolled back on upload bucket/key uniqueness; corrected to unique metadata keys without creating media objects or changing source assets. Canonical evidence is under `tests/runs/api-curl/plan_169_phases_abc/`; heavier temporary build caches remain under `/dev/shm/plan169-*`.

- Baseline: `6cfad70`, Plan 168 accepted and pushed; its local post-commit continuity edit remains preserved.
- Planning inspection: read the profile/context feature contracts, roadmap, native navigation/feed/player/auth modules, backend profile/space/feed/viewer services and routes, schema definitions, and existing viewer test harnesses.
- Planning baseline findings: legacy private-profile response differed from nominal identity; shared personal access accepted public flags; playback only sought to zero; context changes remounted the root Feed. A–E now implement the documented identity/access/return contracts while preserving deliberate context resets.
- Planning documentation checks passed for structure and local references; execution phase status is tracked above. `npm run check:agents:docs` reports the same 16 pre-existing status/header errors in Plans 138, 140–142 and 148–159, with no new Plan 169/reference finding. Current host validation is recorded above; new physical-device checks remain pending.
- Execution evidence destinations: ignored API/browser run folders following `tests/README.md`, and device observations under `tests/runs/device/plan_169/`. Record exact run paths/results as execution proceeds; never export credentials or raw signed-media URLs.

## Open Risks / Deferred

- Earlier user-confirmed whole-app freeze during third-video loading has an unconfirmed native root cause. Controller corrections passed 129 host tests and subsequent short/final physical checks without reported recurrence; this is not proof of the native cause or a release qualification pass. Obtain native traces if it recurs.

- Existing ordinary personal spaces may rely on public flags/subscription shortcuts. Phase A audits callers; the shared policy change intentionally removes those shortcuts without deleting data or granting replacement access. Any wider migration or new audience-control UI needs its own explicit scope.
- Minimal nominal identity is an intentional viewer contract. Private profile bio/avatar/display fields remain hidden; the existing account display name/handle is already public identity, not permission to expose optional profile data.
- Exact HLS seek depends on the native player/media. Record measured deviation and fallback; preserve a usable UI if seek fails. Cold return after releasing players can briefly load.
- A fresh anchored window preserves selected publication/time and continuation, not an unlimited prior scroll history. Deleted/reordered content can change the surrounding rows.
- The bounded detour deliberately has one original return destination. Broader recursive profile/feed navigation and persistent history are separate scope.
- Public media URLs remain independently retrievable after feed denial. Confidential personal media needs a separate delivery policy before deployment with sensitive content.
- Plan 168's earlier rare, non-reproduced freeze, deferred VoiceOver and accepted high-text-size clipping remain known baseline limits. New profile controls should wrap/scroll correctly; no existing exception is silently promoted to a pass.
- Bundled internal builds, TestFlight, release accessibility/memory/network qualification, discovery/stories/captions/sharing and participation remain later roadmap increments.

## Resume Here

1. A–F are Complete for the recorded development milestone; no further device run is currently required. Final stable-Wi-Fi report passes with 40/40 normal transitions prepared, first-frame p95 120.38 ms, zero errors/incomplete/unexpected playback and peak three players. Preserve the single brief-spinner observation, unconfirmed earlier native-freeze cause, qualitative seek/duration and host-versus-physical coverage limits above. VoiceOver remains explicitly deferred; this does not claim release/private-media qualification.
2. User explicitly requested commit and push on 2026-10-22. Review/stage the intended source/docs/test set and prior Plan 168 continuity note, keep ignored credentials/fixtures/reports/exports out, commit, then push normally and verify remote HEAD. Record the resulting SHA immediately after the implementation commit. Keep this recent plan at its linked path through Git handoff. Host validation is 129 mobile tests/typecheck/iOS export, backend build/18 contracts, 83 creator API checks, 150 prior viewer API checks, 12 browser checks and actual rendered navigation/auth checks; see Validation for chronology and scope. Final whitespace/local-reference/credential checks pass; agent docs checker retains the same 16 older-plan status/header findings and no Plan 169/new reference error. Do not edit unrelated plans to clear them.
3. Scoped fixture access driver is complete: A21/B22 personal60 original roles3359/3360 restored and bound expired session revoked. Fresh disposable phone sign-in used by the final run remains active intentionally. Credentials stay in ignored `.codex-local/plan169-fixtures.json`; display privately through `node .codex-local/plan169-device-credentials.cjs credentials` if later testing requires them. Never print/paste secrets or modify ordinary account access.
4. API last running on 3300 (exec session31166), Metro development-client 8081 (session5285), tunnel https://tt3-jho-mbcollins2-8081.exp.direct. Verify current availability before reconnecting later. Installed build needs JavaScript Reload for these changes; no dependency/native-input upgrade was made. Keep the terminal player-disposal/single Feed ownership fix, auth isolation and restore guards.
5. Next product scope is the remaining viewing/discovery roadmap, with a separate plan before implementation; independent bundled internal distribution can also be planned separately. Do not mark stories, captions, discovery, social participation, private-CDN protection, TestFlight or App Store distribution delivered here.
