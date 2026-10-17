# Plan 167 iOS Anonymous Video Feed POC

Status: Active

Created: 2026-10-17

## Feature Reference

- Existing context contract: `agents/features/feature_02_personal-space-global-feed-context-integrity.md`.
- Existing message direction: `agents/features/feature_13_feed-campaign-inserts.md`.
- This plan covers the native viewing interaction only. It does not change publishing scope, global discovery semantics, ranking, or engagement policy.

## Context

Build an iPhone proof of concept in Expo Go that shows real videos from the existing public global feed. Users swipe vertically between full-screen items, and the selected video starts automatically. Preloading should make normal forward transitions feel immediate while keeping player allocation and bandwidth controlled.

The public API already supports this starting point. `GET /api/feed/global` accepts anonymous requests and returns `{ items, nextCursor }`. Each item contains a publication, an enhanced upload with playback/poster URLs, and creator metadata. The server filters the feed to completed uploads and published publications marked for global visibility. Native playback can use the existing CloudFront HLS output.

In scope:

- A separate TypeScript Expo application in this repository, tested on a physical iPhone.
- Anonymous global feed, cursor pagination, vertical paging, automatic playback, looping, tap to pause, and mute control.
- Preloading, player ownership, app lifecycle handling, loading/error states, and focused performance measurements.
- A typed mobile adapter and centralized HTTP client that can accommodate future authentication.
- Setup instructions, meaningful automated checks, and a reproducible device acceptance checklist.

Out of scope:

- App login, registration, credentials, bearer sessions, or changes to backend authentication.
- Private feeds, space switching, profiles as separate screens, likes, comments, follows, reporting, uploads, or editing.
- Message inserts, checkout, production viewing analytics, captions, offline downloads, background playback, Picture in Picture, and push notifications.
- Ranking changes, database migrations, API versioning, App Store delivery, or Android acceptance.

Constraints:

- Use the existing public feed and published media; backend feature changes are not expected.
- Existing web/server builds and dependencies must keep working.
- Expo Go must support the selected Expo SDK and native dependencies on the test iPhone.
- Near-instant playback is a measured target for prepared items, not a guarantee under every network condition or rapid fling.
- This is planning only. All implementation phases below start Pending.

## Locked Decisions

1. Create `mobile/` as an independently installed Expo application with its own `package.json`, lockfile, and TypeScript configuration. Keep Expo and React Native dependency resolution separate from the web app. Do not introduce npm workspaces in this POC.
2. Use `expo-video` and React Native `FlatList` with native paging. Keep navigation to one feed screen initially. Do not port browser video components or the large web feed component.
3. Use only `GET /api/feed/global?limit=20&cursor=...` for feed data. Preserve server ordering. Treat the cursor as an opaque string and encode it through URL query helpers.
4. Use `publication.id` for item identity and deduplication. Retain production ULID, upload ID, and space ID as distinct optional metadata; they are not interchangeable identities.
5. Use the actual HTTPS `upload.cdn_master` supplied by the API. Do not construct portrait/landscape variants or guess an S3 fallback. Invalid or absent playback URLs produce an unavailable item with a next-item action.
6. Keep at most three live players: previous, current, and next. Only the active item may play; preloaded neighbors stay paused. Release obsolete players before allocating replacements so the cap also holds during transitions.
7. Start muted. A session-level mute preference follows the user between items. Re-entering an item starts it from the beginning; returning from a temporary app interruption preserves the current position.
8. Separate HTTP transport, feed adaptation/state, playback coordination, and presentation. Leave a small request-header extension point for future user credentials without implementing authentication now.
9. Use no admin token, fake user, copied browser cookie, or relaxed permission check. Never put AWS credentials or backend `.env` values in the mobile app.
10. Use device-local development diagnostics only. Production analytics and message orchestration remain separate follow-up work.

## Existing Integration Points

- `src/routes/spaces.ts`: anonymous global feed route and cursor inputs.
- `src/features/feeds/service.ts`: feed response construction and poster selection.
- `src/features/feeds/types.ts`: existing response types; `upload` is currently broad and needs a mobile-owned adapter.
- `src/utils/enhance.ts`: CloudFront HLS and poster URLs.
- `src/features/feeds/repo.ts`: publication visibility, completion filtering, ordering, and production output selection.
- `frontend/src/app/Feed.tsx`: behavior reference only; its browser APIs and URL rewriting must not become native dependencies.

The existing anonymous response includes creator email and internal upload/storage/job fields. The mobile adapter must discard those fields and must not display email as a creator-name fallback. Server response minimization remains an acknowledged follow-up; client filtering does not remove the exposure at the API boundary.

## Application Structure

Proposed files, created during implementation:

```text
mobile/
  App.tsx
  app.json
  package.json
  package-lock.json
  tsconfig.json
  .env.example
  README.md
  src/
    api/client.ts
    api/feed.ts
    config/environment.ts
    feed/types.ts
    feed/adaptFeed.ts
    feed/useGlobalFeed.ts
    feed/FeedScreen.tsx
    feed/FeedCard.tsx
    playback/coordinator.ts
    playback/useFeedPlayback.ts
    playback/VideoSurface.tsx
    diagnostics/playbackDiagnostics.ts
  tests/
    adaptFeed.test.ts
    feedPagination.test.ts
    playbackCoordinator.test.ts
```

Use the smallest SDK-compatible dependency set: Expo, its matching React/React Native versions, `expo-video`, and safe-area support if required by the template. Select and lock versions in Phase A after confirming physical-device Expo Go compatibility. Select a lightweight TypeScript-capable test runner in the mobile package; no new root test framework is required.

The app config targets portrait use. Measure the actual feed viewport with layout events so safe areas, display sizes, and any host orientation changes do not corrupt paging offsets. Keep controls above the home indicator and below the notch. Use a black background and aspect-preserving `contain` for video so landscape material remains fully visible.

## Feed Contract and Data Handling

The normalized mobile item contains:

```ts
type FeedVideoItem = {
  publicationId: number;
  uploadId: number | null;
  productionUlid: string | null;
  spaceId: number | null;
  playbackUrl: string | null;
  posterUrl: string | null;
  creator: { id: number | null; displayName: string; avatarUrl: string | null };
  description: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

type FeedPage = { items: FeedVideoItem[]; nextCursor: string | null };
```

- Validate unknown JSON at the boundary. Reject malformed page envelopes visibly. Skip rows without a valid publication ID; retain valid-ID rows with unavailable media as explicit error cards.
- Prefer `poster_cdn`, falling back only to a supplied poster URL consistent with the item's known orientation. If no usable image exists, show the neutral loading surface.
- Display a generic creator label when a name is missing. Trim/limit overlay text and keep it readable without opening other screens.
- Merge pages by publication ID in server order. Deduplicate overlapping responses and prevent concurrent requests for the same cursor.
- Fetch the next page when five or fewer loaded items remain ahead of the active item. On a successful empty page, honor a new non-null cursor; stop at null. Detect repeated cursors and stop with retry instead of looping.
- Permit at most two automatic consecutive page advances with no newly usable items. Then show an explicit continue/retry action. Do not treat failed fetches as the end of the feed.
- Refresh replaces the current feed session, resets the active index and pagination, cancels pending requests, and releases old players. A visible refresh/retry control avoids conflict between pull-to-refresh and vertical video navigation.
- Use request cancellation and a feed-session generation ID so responses from an old refresh/unmounted screen cannot append items or start playback. Keep existing items usable after a pagination failure.
- Do not persist feed data or viewing position to disk in this POC. Future login/logout must invalidate viewer-dependent feed state and pending requests at this same boundary.

## Playback Contract

The playback coordinator is the only component allowed to decide which item plays. Feed cards render posters, metadata, controls, and a video surface for the selected item; mounting a card must not independently call `play()`.

Selection and transitions:

1. After the initial page loads and the screen is active, select its first item and request playback.
2. Pause on drag start. Commit the selected index when paging settles, using the measured viewport and one shared selection function. Handle drag completion without momentum as well as momentum completion; duplicate callbacks must be harmless.
3. On selection, invalidate the previous playback activation, pause all other players, attach the selected player's video surface, reset a newly selected item to time zero, and play when it is ready and still eligible.
4. Prepare the next item while the current item plays. Retain the immediately previous player when within the cap; prioritize current playback over additional preload work.
5. During rapid flings, act on the final selected item. Skipped items must never start because of delayed source-load or readiness callbacks.
6. Associate every asynchronous source operation, retry, first-frame callback, and playback callback with item identity and an activation/source generation. Ignore obsolete events and never reuse a released player.

Playback eligibility requires: the screen is mounted, the app is active, paging is settled, the item is selected, the player is current, and the user has not paused it. Track user pause separately from buffering, scrolling, and app interruption.

UI and lifecycle:

- Loop the selected video. Tap toggles pause/play; tapping mute must not also toggle playback.
- Keep the poster visible until the selected surface reports its first frame. Show a subtle loading indicator after 250 ms; avoid flashing it for prepared transitions.
- If loading has not produced a frame after 10 seconds, show Retry and Next actions. Do not automatically skip or remove the item. A playback error presents the same recovery controls.
- Retry replaces the failed source safely and cannot revive a previous activation. Failed poster images do not prevent playback.
- Pause when the app becomes inactive/backgrounded, on screen unmount, and when an audio interruption requires it. Resume only if the same item is selected and was eligible to play before interruption; preserve an intentional user pause.
- Release all players and listeners on teardown. Reconcile ownership on refresh and development Fast Refresh as well as normal navigation.
- Do not depend on persistent HLS caching on iOS. The POC uses transient player buffering; Expo documents that its disk video cache does not support iOS HLS sources. [Expo video caching](https://docs.expo.dev/versions/latest/sdk/video/#caching-videos).

## Development Connectivity

The phone needs two independent reachable services: Metro for the JavaScript bundle, and the existing API over HTTPS. CloudFront delivers the media separately.

- Configure `EXPO_PUBLIC_API_BASE_URL` in the mobile environment. This is a public address, not a secret. Validate it at startup and show an actionable configuration error if missing or invalid.
- On an iPhone, `localhost` points to the phone. It cannot reach this development server through `http://localhost:3300`.
- Prefer the existing reachable HTTPS reverse-proxy address after checking it serves this checkout. If a separate API tunnel is needed, document its address and lifecycle. A Metro tunnel does not expose port 3300 or the API.
- Run Metro on a reachable LAN or use `npx expo start --tunnel` when the development machine is remote. Record any Expo CLI/Expo Go account requirement separately from application login. [Expo development setup](https://docs.expo.dev/get-started/start-developing/).
- Validate the health endpoint, feed response, poster, HLS master, a variant playlist, and a media segment through the actual phone network path.
- Pin the Node version required by the selected Expo SDK inside `mobile/` if necessary. Do not change the root `.nvmrc` just to scaffold the mobile app.
- Ensure `mobile/.env*`, `.expo/`, and mobile build output are ignored while keeping the mobile example environment file tracked.

## Phase Status

- A: Pending — Expo foundation and phone connectivity
- B: Pending — Feed adapter and pagination
- C: Pending — Vertical paging and playback correctness
- D: Pending — Preloading and lifecycle reliability
- E: Pending — Device measurement and acceptance
- F: Pending — Documentation and handoff

Complete phases in order, with at most one In Progress. Record actual commands and outcomes before marking a phase Complete.

## Phase A Expo Foundation and Phone Connectivity

Goal: Launch a minimal native screen in Expo Go and reach the existing backend from the iPhone.

Steps:

- [ ] Scaffold `mobile/` using an Expo SDK compatible with the test phone's Expo Go; record SDK, native package, Node, and Expo Go versions.
- [ ] Add independent install/start/typecheck/test scripts and a lockfile. Use `npx expo install expo-video` to select the matching native package.
- [ ] Add environment validation, example configuration, ignore rules, portrait-oriented layout, and safe-area handling.
- [ ] Verify one real feed HLS source with a temporary single-video screen before building the scrolling feed.
- [ ] Document Metro and API connection routes, including separate tunnels if necessary.

Test gate: Run `npm --prefix mobile run typecheck`, `npx expo-doctor` from `mobile/`, and `npm run build` at the root. Open the app on the physical iPhone and verify API/media reachability and single-video playback.

Acceptance: Expo Go launches the app, the phone plays a real published video, and the existing backend build passes. Record the precise blocker if phone access is unavailable; tooling checks alone do not complete this phase.

## Phase B Feed Adapter and Pagination

Goal: Load the public feed through a stable mobile interface with reliable page merging and recovery.

Steps:

- [ ] Implement the centralized fetch client, environment-based URL resolution, optional header provider, timeout, cancellation, and structured error handling.
- [ ] Add feed types, runtime validation, safe URL handling, and field minimization.
- [ ] Implement initial fetch, deduplicated page merging, near-end fetch, retry, refresh, cursor guards, and stale-response protection.
- [ ] Render poster-only feed cards and explicit loading, empty, unavailable-media, and fetch-error states.
- [ ] Add focused tests for malformed envelopes, missing IDs/media, overlapping pages, repeated cursors, failed-page retry, and refresh racing with an older fetch.

Test gate: Run mobile typecheck and tests. Verify two live API pages with an encoded cursor and no authentication header/cookie. Compare the mobile normalized fields to the real response without storing creator email or signed URL query strings in diagnostics.

Acceptance: Feed ordering and identity match the server, next pages do not duplicate items, and a failed/stale request cannot corrupt the current session.

## Phase C Vertical Paging and Playback Correctness

Goal: Swipe between real videos with exactly one eligible player and deterministic selection.

Steps:

- [ ] Build a paged `FlatList` with stable keys, fixed measured item layout, memoized cards, and a modest render window.
- [ ] Implement the playback coordinator and one authoritative selection function, initially without speculative preloading.
- [ ] Add looping, session mute, tap pause, poster-to-video transition, and unobtrusive creator/description overlays.
- [ ] Implement error/timeout recovery and explicit next-item actions, including the first/last item and end-of-feed behavior.
- [ ] Test selection races, drag without momentum, duplicate settle events, delayed readiness for an old item, user pause, and teardown.

Test gate: Run mobile typecheck and tests. On the iPhone, check forward/backward paging, a cancelled swipe, a rapid multi-item fling, pause/mute controls, and unavailable media. Listen for overlapping audio with mute disabled.

Acceptance: Only the settled selected item plays. An old callback cannot restart a previous video, user controls behave predictably, and posters cover initial loading.

## Phase D Preloading and Lifecycle Reliability

Goal: Reduce transition delay while bounding native resources and handling interruptions.

Steps:

- [ ] Extend ownership to the previous/current/next window with an enforced cap of three live players, releasing obsolete allocations before creating new ones.
- [ ] Preload the next item's HLS source while paused and attach the same prepared player on activation. Avoid destroying it simply because its card becomes visible.
- [ ] Add generation checks around asynchronous loads/retries, source replacement, and late first-frame callbacks.
- [ ] Pause on background/inactive, preserve explicit user pause, reconcile on return, and dispose players/listeners on teardown and refresh.
- [ ] Add tests for allocation caps, double release, late events, rapid A-to-B-to-C changes, and background/foreground transitions.
- [ ] Add development-only timing and allocation diagnostics. Never send POC events into production viewing metrics.

Test gate: Run mobile typecheck and tests; exercise rapid swipes and repeated refresh/background cycles on the iPhone. Verify current allocation count never exceeds three, and all owned players are released on teardown.

Acceptance: Ordinary forward swipes use prepared sources, no stale video begins playing, and lifecycle transitions preserve the single-player rule. [Expo preloading guidance](https://docs.expo.dev/versions/latest/sdk/video/#preloading-videos).

## Phase E Device Measurement and Acceptance

Goal: Establish whether the POC delivers the desired immediate-play feel on real hardware.

Steps:

- [ ] Run the device checklist below and capture device model, iOS, Expo Go/SDK versions, media IDs, API address, network conditions, and any diagnostic overhead.
- [ ] Record first-frame timings, buffering incidents, errors, player allocations, and release counts. Use monotonic timestamps and one record per activation.
- [ ] Run the normal-swipe sample, rapid-swipe sample, and ten-minute resource check separately.
- [ ] Tune preload timing, native buffer settings, and list window only against observed problems. Do not increase the player cap to hide failures.
- [ ] Record unresolved failures and distinguish Expo Go observations from any future standalone-app benchmark.

Test gate: Complete the functional and performance acceptance criteria below. Store a device checklist and machine-readable timing output under a documented device evidence location, separate from browser/API harness results. Reference that location in this plan.

Acceptance: Functional checks pass on a physical iPhone and measured transition results meet the target, or the phase stays In Progress with the measured gap stated explicitly.

## Phase F Documentation and Handoff

Goal: Make the POC reproducible and preserve a clear path to the next mobile increment.

Steps:

- [ ] Finish `mobile/README.md` with tested installation/start commands, SDK/Expo Go requirements, example configuration, networking troubleshooting, device checklist, and known limitations.
- [ ] Add a concise root README entry linking to the mobile app and this plan after the app exists.
- [ ] Verify a clean mobile dependency install with `npm --prefix mobile ci`, then rerun mobile typecheck/tests and root backend build.
- [ ] Run `npm run check:agents:docs`; separate pre-existing findings from new problems.
- [ ] Update phase status, validation evidence, change log, and next steps. Add commit SHAs only for commits actually made.

Test gate: Follow the documented start procedure and confirm the app opens on the test phone. Verify relevant builds/checks and review the final diff for unintended root dependency/API changes.

Acceptance: Another developer can launch the POC using the documented setup, and follow-up authentication can be added through the existing transport/viewer boundaries.

## Functional Acceptance Checklist

- Cold launch loads real public videos without app login or a privileged credential.
- Swipe forward and backward, cancel a swipe, and fling across several items. Exactly one settled item plays, including when an earlier item's load completes late.
- Looping, pause/resume, mute, and creator/description overlays work for portrait and landscape sources.
- Pagination continues beyond the first page; overlapping rows do not duplicate cards. An exhausted feed has an explicit end state.
- Initial/feed-page/media/poster failures have recovery paths; refreshing cannot mix old and new sessions.
- Background, lock/unlock, interruption, and foreground cycles produce no hidden audio and respect manual pause.
- At most three players exist concurrently; teardown leaves zero app-owned players and listeners.
- Existing web startup/build still works, and no protected API has been opened for the POC.

## Performance Acceptance

The primary target is a first visible frame within 300 ms of committing selection for a prepared item, measured at the 95th percentile in the normal-swipe sample. This is a POC target to validate, not an existing performance claim.

Measurement rules:

- Start at the centralized settled-selection timestamp. Finish at the active `VideoView` first-frame callback, guarded by the activation generation. Count only the first such callback; quality switches can emit it again. This measures presentation readiness, so also record playing/buffering state and verify visible motion rather than treating a decoded still as proof of sustained playback. [Expo first-frame callback](https://docs.expo.dev/versions/latest/sdk/video/#onfirstframerender).
- Collect at least 30 forward transitions on a physical iPhone over stable Wi-Fi, with at least two seconds spent on each preceding item. Record whether each destination was prepared before selection, plus median, p95, maximum, and buffering/error counts.
- Include every normal transition in the results. Report warm and cold subsets and the preparation hit rate; target at least 90 percent prepared destinations. Do not improve the reported result by dropping misses or errors.
- Record initial-load timing separately. Run at least 20 rapid transitions as a stress test; these must preserve playback correctness even when destinations are cold.
- Run a ten-minute session with forward/backward navigation and repeated background/refresh cycles. Require the player cap and release invariants throughout, with no crash or accumulating player/listener ownership. Inspect native memory trends when tooling is available; a player-count check alone cannot prove the absence of every native memory leak.
- Repeat a shorter run on a slower connection. Buffering may exceed the Wi-Fi timing target, but recovery must work without wrong-item playback or overlapping audio.
- If the feed has insufficient distinct videos, record the sample size and repeat via a fresh feed session; do not silently represent repeated cached observations as independent cold loads.

## Future Authentication and Additional Screens

The POC must leave these extension points intact:

- Transport can attach future user credentials; playback code has no dependency on token/cookie storage.
- Feed sessions can be reset when viewer identity changes. Later caches must be keyed by viewer and feed, and private playback allocations must be released on logout.
- The normalized media item can support additional feed sources without moving permission decisions onto the device. Source-specific fetching and selection remain outside the player.
- Application login and secure token storage can be added without changing publication identity or swipe coordination.
- Authenticated interactions, message inserts, captions, analytics, and standalone distribution are separate increments. Message insertion will require revisiting sequence-item types; this POC does not build a speculative campaign framework.

## Change Log

- 2026-10-17 — `3d34f6f` — Added the detailed anonymous iPhone POC plan and implementation index entry. All implementation phases remain Pending; no application code changed.

## Validation

- Planning checks: reviewed the public feed route, response construction/types, URL enhancement, current web feed behavior, repository planning standard, and official Expo/React Native documentation.
- Earlier API assessment in this session: local health and anonymous global feed returned HTTP 200; the first feed HLS master returned HTTP 200 with HLS content type and variant entries; anonymous access to `/api/me/spaces` returned HTTP 401. These checks establish backend feasibility, not device playback performance.
- Commands run for this documentation change: `npm run check:agents:docs` before and after writing; `git diff --check`; focused verification of plan structure and links.
- Documentation checker baseline: 16 existing status-header errors in older plans, including plans 138, 140, 141, 142, and 148 through 159. Those unrelated files are outside this change.
- Outcomes: the checker returned the same 16 baseline errors after this change, with no new findings. Whitespace checks passed. Focused checks passed for all six Pending phases, required phase fields, balanced code fences, source references, and the implementation index entry.
- Commit review: only this plan and the implementation index were included in `3d34f6f`. Root README changes are unnecessary because developer-facing application behavior and startup workflows have not changed.
- Device playback, mobile builds/tests, and performance measurements belong to implementation phases and remain pending.

## Open Risks / Deferred

- SDK/Expo Go compatibility and developer account setup must be verified against the actual iPhone before depending on native APIs. Select versions in Phase A rather than assuming the latest SDK is installed on the phone.
- The existing HTTPS API hostname may serve a different checkout or need network access configuration. Confirm the endpoint identity without changing unrelated hosting.
- CDN startup time, source bitrate/keyframe layout, and network throughput may limit the 300 ms target. Record measurements before considering backend encoding/CDN changes as a separate increment.
- Expo Go timing and memory behavior may differ from a standalone development/release build. Production performance acceptance will need another device pass.
- Global feed responses currently expose more fields than a viewer needs, including creator email. Server response minimization is deferred, not solved by the adapter.
- Authentication, richer discovery, captions, message inserts, reporting, production analytics, offline use, and app distribution remain deferred.
- Feed metadata grows with fetched pages during a POC session. The native player window is bounded; long-session feed-cache eviction and unlimited backward history need a later explicit policy if required.

## Resume Here

Next action: When implementation starts, mark Phase A In Progress, select an Expo SDK compatible with the physical test iPhone, scaffold `mobile/`, and prove one existing HLS video plays through the chosen API/network route.

Execution dependencies: Access to a physical iPhone with compatible Expo Go and a reachable API/media path. These are Phase A checks; no clarification is required to finish this plan.
