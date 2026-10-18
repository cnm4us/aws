# Plan 167 iOS Anonymous Video Feed POC

Status: Complete

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
- Implementation and Expo Go POC device acceptance are complete on the recorded iPhone, with export/profiling limits preserved below.

## Locked Decisions

1. Create `mobile/` as an independently installed Expo application with its own `package.json`, lockfile, and TypeScript configuration. Keep Expo and React Native dependency resolution separate from the web app. Do not introduce npm workspaces in this POC. Phase A uses SDK 57, which Expo currently recommends for physical-device Expo Go during the SDK 58 transition; confirm the phone's installed Expo Go version at the device gate.
2. Use `expo-video` and React Native `FlatList` with native paging. Keep navigation to one feed screen initially. Do not port browser video components or the large web feed component.
3. Use only `GET /api/feed/global?limit=20&cursor=...` for feed data. Preserve server ordering. Treat the cursor as an opaque string and encode it through URL query helpers.
4. Use `publication.id` for item identity and deduplication. Retain production ULID, upload ID, and space ID as distinct optional metadata; they are not interchangeable identities.
5. Use the actual HTTPS `upload.cdn_master` supplied by the API. Do not construct portrait/landscape variants or guess an S3 fallback. Invalid or absent playback URLs produce an unavailable item with a next-item action.
6. Keep at most three live players: previous, current, and next. Only the active item may play; preloaded neighbors stay paused. Release obsolete players before allocating replacements so the cap also holds during transitions.
7. Save a device-local startup sound preference, default Unmuted (user approved this update after device testing). Hydrate it before any feed playback. App launches use the saved default; the Mute/Unmute pill changes the current browsing session and survives feed Refresh. Settings changes affect the next app launch, not current playback. Re-entering an item starts it from the beginning; returning from a temporary app interruption preserves the current position.
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

Application files created during implementation (representative structure):

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
    preferences/playbackPreferences.ts
    preferences/usePlaybackPreferences.ts
    preferences/PlaybackSettings.tsx
  tests/
    adaptFeed.test.ts
    feedPagination.test.ts
    playbackCoordinator.test.ts
    playbackPreferences.test.ts
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

- A: Complete — Expo foundation and phone connectivity
- B: Complete — Feed adapter and pagination
- C: Complete — Vertical paging and playback correctness
- D: Complete — Preloading and lifecycle reliability
- E: Complete — Device measurement and acceptance
- F: Complete — Documentation and handoff

Complete phases in order, with at most one In Progress. Record actual commands and outcomes before marking a phase Complete.

## Phase A Expo Foundation and Phone Connectivity

Goal: Launch a minimal native screen in Expo Go and reach the existing backend from the iPhone.

Steps:

- [x] Scaffold `mobile/` with SDK 57 per Expo's current physical-device guidance; record SDK, native package, and Node versions. The installed phone Expo Go version still needs confirmation below.
- [x] Add independent install/start/typecheck/test scripts and a lockfile. Use `npx expo install expo-video` to select the matching native package.
- [x] Add environment validation, example configuration, ignore rules, portrait-oriented layout, and safe-area handling.
- [x] Verify one real feed HLS source with a temporary single-video screen before building the scrolling feed.
- [x] Document Metro and API connection routes, including separate tunnels if necessary.

Phase A's temporary single-video preview established the phone connection and native HLS playback path. It has now been replaced by the Phase C feed screen. Its typed feed adapter and anonymous HTTP client remain shared foundations.

Versions installed: Node 22.21.1, Expo 57.0.30, React Native 0.86.3, React 19.2.3, expo-video 57.0.5, safe-area-context 5.7.0. Device: iPhone 17 Pro Max, iOS 26.6.2. The user confirmed that Expo Go opens the preview and a real video plays muted. This establishes compatibility with the installed Expo Go and the phone's API/media path; its exact Expo Go version number is not yet recorded. Additional controls and lifecycle checks remain part of later device acceptance.

Test gate: Run `npm --prefix mobile run typecheck`, `npx expo-doctor` from `mobile/`, and `npm run build` at the root. Open the app on the physical iPhone and verify API/media reachability and single-video playback.

Acceptance: Expo Go launches the app, the phone plays a real published video, and the existing backend build passes. Record the precise blocker if phone access is unavailable; tooling checks alone do not complete this phase.

## Phase B Feed Adapter and Pagination

Goal: Load the public feed through a stable mobile interface with reliable page merging and recovery.

Steps:

- [x] Implement the centralized fetch client, environment-based URL resolution, optional header provider, timeout, cancellation, and structured error handling.
- [x] Add feed types, runtime validation, safe URL handling, and field minimization.
- [x] Implement initial fetch, deduplicated page merging, near-end fetch, retry, refresh, cursor guards, and stale-response protection.
- [x] Render poster-only feed cards and explicit loading, empty, unavailable-media, and fetch-error states.
- [x] Add focused tests for malformed envelopes, missing IDs/media, overlapping pages, repeated cursors, failed-page retry, and refresh racing with an older fetch.

Test gate: Run mobile typecheck and tests. Verify two live API pages with an encoded cursor and no authentication header/cookie. Compare the mobile normalized fields to the real response without storing creator email or signed URL query strings in diagnostics.

Acceptance: Feed ordering and identity match the server, next pages do not duplicate items, and a failed/stale request cannot corrupt the current session.

## Phase C Vertical Paging and Playback Correctness

Goal: Swipe between real videos with exactly one eligible player and deterministic selection.

Steps:

- [x] Build a paged `FlatList` with stable keys, fixed measured item layout, memoized cards, and a modest render window.
- [x] Implement the playback coordinator and one authoritative selection function, initially without speculative preloading.
- [x] Add looping, session mute, tap pause, poster-to-video transition, and unobtrusive creator/description overlays.
- [x] Implement error/timeout recovery and explicit next-item actions, including the first/last item and end-of-feed behavior.
- [x] Test selection races, drag without momentum, duplicate settle events, delayed readiness for an old item, user pause, and teardown.

Implementation and automated gate passed. The user confirmed “Swiping and playback work” after being asked to test forward/backward swipes, previous audio stopping, rapid swipes, and tap pause. This passes the Phase C interaction gate; detailed lifecycle stress and performance measurements remain separate Phase D/E checks.

Test gate: Run mobile typecheck and tests. On the iPhone, check forward/backward paging, a cancelled swipe, a rapid multi-item fling, pause/mute controls, and unavailable media. Listen for overlapping audio with mute disabled.

Acceptance: Only the settled selected item plays. An old callback cannot restart a previous video, user controls behave predictably, and posters cover initial loading.

## Phase D Preloading and Lifecycle Reliability

Goal: Reduce transition delay while bounding native resources and handling interruptions.

Steps:

- [x] Extend ownership to the previous/current/next window with an enforced cap of three live players, releasing obsolete allocations before creating new ones.
- [x] Preload the next item's HLS source while paused and attach the same prepared player on activation. Avoid destroying it simply because its card becomes visible.
- [x] Add generation checks around asynchronous loads/retries, source replacement, and late first-frame callbacks.
- [x] Pause on background/inactive, preserve explicit user pause, reconcile on return, and dispose players/listeners on teardown and refresh.
- [x] Add tests for allocation caps, double release, late events, rapid A-to-B-to-C changes, and background/foreground transitions.
- [x] Add development-only timing and allocation diagnostics. Never send POC events into production viewing metrics.

The implementation and host test gate pass. The controller trims before allocation, prioritizes the current load, retains paused/muted neighbors, reuses a prepared next player, and seeks retained previous videos to the beginning. Backgrounding releases neighbors and preserves the paused current source. Expo receives a five-second preferred buffer hint; the OS controls actual buffering.

Development diagnostics use monotonic selection/first-frame timestamps and record positive buffered duration before labeling a forward destination prepared. Playing/progress evidence, incomplete/error/interrupted transitions, initial samples, resource totals, and discarded history are explicit. Long-press Global to inspect counters and share JSON through the phone's share sheet; there is no analytics API ingestion. History is capped at 200 transitions/1,000 events.

The user reopened the build and confirmed “Works; player counts stay at or below 3” after being asked to check normal/rapid swipes, overlapping audio, background/foreground, Refresh, and live/peak counts. This passes the Phase D functional/resource gate. Quantitative transition timing and the ten-minute stress sample remain Phase E work.

Test gate: Run mobile typecheck and tests; exercise rapid swipes and repeated refresh/background cycles on the iPhone. Verify current allocation count never exceeds three, and all owned players are released on teardown.

Acceptance: Ordinary forward swipes use prepared sources, no stale video begins playing, and lifecycle transitions preserve the single-player rule. [Expo preloading guidance](https://docs.expo.dev/versions/latest/sdk/video/#preloading-videos).

## Phase E Device Measurement and Acceptance

Goal: Establish whether the POC delivers the desired immediate-play feel on real hardware.

Steps:

- [x] Implement the user-approved sound preference and Refresh persistence; disable Live Text frame analysis independently of caption controls.
- [x] Verify saved startup sound, Refresh persistence, Live Text overlay removal, and existing CC behavior on the phone before final acceptance.
- [x] Run the device checklist below and capture device model, iOS, Expo Go/SDK versions, media IDs, API address, network conditions, and any diagnostic overhead.
- [x] Record first-frame timings, buffering incidents, errors, player allocations, and release counts. Use monotonic timestamps and one record per activation.
- [x] Run the normal-swipe sample, rapid-swipe sample, and ten-minute check as separate user tasks; retain the cumulative/clipped rapid-report and manual ten-minute resource-evidence limits below.
- [x] Tune preload timing, native buffer settings, and list window only against observed problems. Do not increase the player cap to hide failures.
- [x] Record unresolved failures and distinguish Expo Go observations from any future standalone-app benchmark.

Test gate: Complete the functional and performance acceptance criteria below. Store a device checklist and machine-readable timing output under a documented device evidence location, separate from browser/API harness results. Reference that location in this plan.

Acceptance: Functional checks pass on a physical iPhone and measured transition results meet the target, or the phase stays In Progress with the measured gap stated explicitly.

POC result: accepted on the test iPhone. The normal Wi-Fi device summary reports 31 prepared forward transitions, 100 percent preparation, median 86.28 ms/p95 121.95 ms against the 300 ms target. User completed rapid browsing, confirmed the ten-minute lifecycle/pause/audio checks, passed saved sound/Refresh/CC checks, and verified fully-offline feed error followed by reconnect/Retry playback. Reports retain cold/incomplete/interrupted observations and guard events. The early rapid export is cumulative/clipped, the ten-minute check is a manual result without its own resource export, and no native memory profile exists. Resource evidence combines device reports capped at three and the ownership/disposal tests. This completes the Expo Go POC gate with those evidence limits; it is not standalone-app certification.

## Phase F Documentation and Handoff

Goal: Make the POC reproducible and preserve a clear path to the next mobile increment.

Steps:

- [x] Finish `mobile/README.md` with tested installation/start commands, SDK/Expo Go requirements, example configuration, networking troubleshooting, device checklist, and known limitations.
- [x] Add a concise root README entry linking to the mobile app and this plan after the app exists.
- [x] Verify a clean mobile dependency install with `npm ci` in an isolated memory-backed copy, then rerun mobile typecheck/tests and root backend build.
- [x] Run `npm run check:agents:docs`; separate pre-existing findings from new problems.
- [x] Update phase status, validation evidence, change log, and next steps. Add commit SHAs only for commits actually made.

Test gate: Follow the documented start procedure and confirm the app opens on the test phone. Verify relevant builds/checks and review the final diff for unintended root dependency/API changes.

Acceptance: Another developer can launch the POC using the documented setup, and follow-up authentication can be added through the existing transport/viewer boundaries.

Handoff result: complete. Clean install/typecheck/58 tests passed in an isolated memory-backed copy after disk space prevented a second filesystem install. Final application code also passes iOS export (622 modules), Expo Doctor 21/21, backend build, and live anonymous API/media checks. Phone launch/setup and acceptance were demonstrated on the recorded device. Final scope review confirms only `mobile/` and the README/plan/index documents change; root dependency/runtime files, backend, web code, and public output are unchanged. Environment, node_modules, Expo state, and build outputs are ignored. Package/lockfile dependency agreement and whitespace checks pass. The agent docs checker retains its 16 pre-existing errors in older plans, with no new finding from this plan. Implementation committed as `d7a286f` at the user's request and pushed to `origin/main`; remote HEAD verified against the local commit.

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
- 2026-10-17 — `5ba58e0` — Recorded the planning commit in this continuity plan. Confirmed from read-only history during final handoff; this is an existing planning-only commit, not a new implementation commit.
- 2026-10-17 — Phase A implementation started: added the independent mobile package, SDK 57 setup, typed public-feed connection, a single-video native preview, automated contract/transport checks, a connectivity script, and setup instructions. No new commit has been made for implementation.
- 2026-10-17 — Phase A completed after the user confirmed that the preview opens on the iPhone, plays muted, and can be unmuted. Phase B completed with cursor paging, field minimization, race-safe refresh/retry, poster cards, 21 passing automated tests, and two successful live feed pages (20 + 9 entries).
- 2026-10-17 — Phase C implemented: replaced the probe with the vertically paged feed, a single-owner native playback controller, selection generations, pause/mute controls, safe disposal, retry/next actions, and gesture settlement handling. All 32 automated tests and native iOS bundle compilation pass. The running preview was reloaded for a separate swipe test; device acceptance is pending.
- 2026-10-17 — Phase C device acceptance passed after the user confirmed “Swiping and playback work.” Phase D implemented the three-player preload window, prepared-player promotion, background neighbor cleanup, retry/source ownership guards, and development diagnostics. All 44 tests and iOS bundle compilation pass; the physical-device Phase D check is pending. No implementation commit has been created.
- 2026-10-17 — Phase D device acceptance passed: the user confirmed the checks work and player counts stay at or below three. Phase E started. The user reports roughly 95 percent of swipes now appear immediate without a loading indicator; this is subjective feedback, not a measured latency percentile. After reload, diagnostics showed two live/two peak players, one selection, zero errors, and no prepared first-frame samples. The selection counter includes the initial video; a normal forward-swipe sample is still needed.
- 2026-10-17 — Phase E partial device sample: user reported 28 selections, zero errors, three live/three peak players, and prepared first-frame p95 of 107 ms. This is below the 300 ms timing threshold for the observed prepared subset. At least 30 actual forward transitions, preparation hit rate, raw report review, network context, and separate stress checks remain outstanding; Phase E stays In Progress. No playback tuning was justified by this result.
- 2026-10-17 — Reviewed the user's exported diagnostic JSON: one initial load plus four prepared swipes, prepared first-frame p95 76.46 ms, normal preparation rate 100 percent, zero errors/incomplete/interrupted rows, and playing/progress evidence for all five videos. Six allocations minus three releases equals three live players, with peak three and no unexpected playback. This export has a different history from the earlier 28-selection observation; preserve it separately. No code tuning or reload was needed. The 30-forward-transition and separate stress gates remain open.
- 2026-10-17 — Extended report (generated 2026-10-18T00:03:29.984Z) reports 31 prepared noninitial transitions and two cold initial loads: prepared median 86.28 ms, p95 121.95 ms, maximum 123.25 ms, preparation rate 100 percent, zero errors/incomplete/unexpected playback, and three peak players. Numerical normal-swipe targets are met in the device summary. Attachment truncation leaves 31 complete rows out of 33 selections, so full percentile recomputation remains unavailable. Preserve the original, extracted complete rows, and review under Phase E evidence. Network confirmation and separate stress checks remain open; no repeated normal run or playback tuning is needed.
- 2026-10-17 — User supplied the 20-rapid-swipe report (generated 2026-10-18T03:05:38.653Z). It retains earlier normal history: cumulative 61 selections, zero errors/incomplete, three live/peak players, balanced 73 allocations/70 releases, and one unexpected-playback event. The attachment clips before current rows/event details. Rapid correctness stays under investigation. Added compact sharing and independent bounded issue retention with selected-publication/eligibility context, preserving the playback guard behavior; asked the user about visible/audible symptoms. No implementation commit made.
- 2026-10-17 — Five-minute back-and-forth device run exposed sustained spinners and one unavailable video, recovered by Retry. Video signature expiry is unsupported: 29 current feed HLS URLs are unsigned; Retry reloads the same source without refetching URLs. Found and corrected the controller pausing ready sources when a seek/rebuffer changed status to loading; preserve play intent across buffering and deduplicate native commands. Added failure-kind diagnostics and three regressions; typecheck, all 50 tests, and iOS bundle export pass. Device reproduction/recovery remains pending; Phase E stays In Progress.
- 2026-10-17 — Device repeat after the buffering correction: the user reports only two brief self-resolving spinners and no persistent stall. Complete compact report records 93 selections, zero errors/unexpected playback, three peak/live players, and prepared p95 122.18 ms. Two incomplete transitions remain retained; mixed-direction cold loads are slower and not judged against the forward-only preparation target. Targeted persistent-stall regression passes for this repeat; ten-minute lifecycle/resource and cellular acceptance remain pending.
- 2026-10-17 — Implemented the approved startup sound setting (default Unmuted) in a Settings modal, device-local AsyncStorage 2.2.0, preference hydration before playback, and a current mute choice owned above refresh-created feed sessions. Startup changes apply on next launch; the pill remains temporary. Disabled Live Text frame analysis without changing subtitle selection. Typecheck, 58 tests, iOS export (622 modules), Expo Doctor 21/21, and backend build pass. Phone settings/overlay checks remain pending; no implementation commit created.
- 2026-10-17 — User confirmed “Yes. All good.” to the four physical-device sound/overlay checks: current mute survives Refresh; saved startup Muted and Unmuted both survive Expo reload; the four-corner icon is gone and CC still works. This increment passes native acceptance. The remaining Phase E work is cellular recovery and closing the lifecycle/rapid evidence notes; no new code change or repeat host test was needed for this confirmation.
- 2026-10-17 — User provided Expo Go 57.0.9 and the cellular/network-toggle report: 50 selections, zero playback errors, one incomplete retained, three live/peak players, prepared p95 122.11 ms. Two guard events identify the selected video while scrolling and were paused. User reports brief loading only under extremely fast swiping, clearing at normal speed. Confirmed the earlier ten-minute background/foreground, lock/unlock, manual pause, and no hidden/overlapping/wrong-video checks passed. Playback continued during attempted offline testing, so actual feed-error/retry recovery is not yet demonstrated; requested one short Airplane Mode/Wi-Fi-off Refresh/reconnect/Retry check.
- 2026-10-17 — User confirmed fully-offline Refresh shows the feed error in Airplane Mode, then reconnecting and retrying loads the feed and plays. Phase E is complete for the Expo Go POC with recorded export/profiling limits. Phase F handoff review started. No new application code or Git history change was required for this acceptance result.
- 2026-10-17 — Phase F handoff completed: finalized mobile/root README links, acceptance record, plan/index status, clean-install/check evidence, and final file/ignore/dependency/scope review. All six phases complete for the accepted Expo Go POC. Implementation remains uncommitted; no Git history change or push performed.
- 2026-10-17 — `d7a286f` — Committed the complete anonymous iPhone Expo Go POC at the user's explicit request: 38 mobile files plus root README, plan, and implementation index (41 files total). All six phases remain Complete. No push performed. This SHA entry is the repository-required local post-commit continuity update.

## Validation

- Planning checks: reviewed the public feed route, response construction/types, URL enhancement, current web feed behavior, repository planning standard, and official Expo/React Native documentation.
- Earlier API assessment in this session: local health and anonymous global feed returned HTTP 200; the first feed HLS master returned HTTP 200 with HLS content type and variant entries; anonymous access to `/api/me/spaces` returned HTTP 401. These checks establish backend feasibility, not device playback performance.
- Commands run for this documentation change: `npm run check:agents:docs` before and after writing; `git diff --check`; focused verification of plan structure and links.
- Documentation checker baseline: 16 existing status-header errors in older plans, including plans 138, 140, 141, 142, and 148 through 159. Those unrelated files are outside this change.
- Outcomes: the checker returned the same 16 baseline errors after this change, with no new findings. Whitespace checks passed. Focused checks passed for all six Pending phases, required phase fields, balanced code fences, source references, and the implementation index entry.
- Commit review: only this plan and the implementation index were included in `3d34f6f`. Root README changes are unnecessary because developer-facing application behavior and startup workflows have not changed.
- Phase A host validation: `npm --prefix mobile run typecheck` passed; `npm --prefix mobile test` passed all 13 tests; `npx expo-doctor` from `mobile/` passed 21/21 checks; `npm --prefix mobile run export:ios` produced a native iOS Hermes bundle (605 modules); root `npm run build` passed.
- `npm --prefix mobile run check:api` passed through `https://aws.bawebtech.com`: health, 20 anonymous normalized feed entries, HLS master, HLS variant, HTTP 206 media segment, and JPEG poster. Evidence: `tests/runs/api-curl/2026-10-17_plan_167_phase_a/artifacts/public-connectivity.log`.
- Local and public `/version` returned the same running build identifier (`84d1190-2026-04-15T212513+0000`), confirming the HTTPS proxy serves the existing running backend. Documentation-only commits are newer than that running process.
- Metro tunnel successfully started on port 8081 using the existing Expo CLI account. The local iOS manifest returned HTTP 200 with `runtimeVersion: exposdk:57.0.0`. The tunnel command/session and transient device QR are recorded in local evidence; no account credentials are stored in tracked files.
- The public tunnel's iOS manifest and development bundle also returned HTTP 200; the manifest points to the public tunnel for its launch asset. Device preparation evidence and current QR: `tests/runs/device/plan_167_phase_a/summary.md` and `tests/runs/device/plan_167_phase_a/expo-go-qr.png`. The user subsequently confirmed native launch, muted video playback, and successful unmute on the target iPhone.
- The SDK-compatible dependency install reported upstream npm audit findings (23 advisory entries after adding the tunnel helper). No forced SDK downgrade or unrelated dependency overhaul was applied; Expo Doctor compatibility checks pass. Assess upstream fixes before production packaging.
- Phase B: typecheck and all 21 tests passed; anonymous pagination returned 20 items then 9 different items through the HTTPS API. No cookies or authorization headers were used.
- Phase C: typecheck and all 32 tests passed, including stale loads/frames/timeouts, rapid selection, no double release, pause/mute preservation, cancelled gestures, drag without momentum, and selecting the final flung-to item before unpausing. `npm --prefix mobile run export:ios` compiled 611 modules successfully. The user then confirmed swiping and playback work on the target iPhone. Transition performance remains unmeasured.
- Phase D: typecheck and all 44 tests pass; iOS export compiled 613 modules. New cases cover exact prepared-player reuse, a 40-video feed with a hard allocation cap, retained-player seek, failed preloads, late released-source callbacks, background cleanup, listener disposal, and diagnostic integrity. Simulation counters return to zero on disposal. The user confirmed device checks work and live/peak player counts stay at or below three.
- Phase E: earlier user-reported display showed 28 selections and prepared first-frame p95 107 ms. The subsequent pasted report (generated 2026-10-17T23:51:44.897Z) instead contains one initial load and four prepared swipes; these observations are kept separate. The exported small sample shows prepared p95 76.46 ms, initial frame 279.02 ms, normal preparation rate 100 percent, all five rows with frame/playing/progress evidence, zero errors/incomplete/interrupted rows, and three live/peak players. A Python consistency check recomputed count, preparation rate, nearest-rank p95, minimum preceding dwell (5,164.89 ms), and allocation/release balance successfully. The extract is `tests/runs/device/plan_167_phase_e/2026-10-17T235144-report-extract.json`. At least 30 actual forward transitions, network/Expo Go version context, and separate rapid-swipe/ten-minute/slower-network results remain outstanding; full performance acceptance stays open.
- Phase E extended sample supersedes the small sample's size gap: device summary reports 31 noninitial transitions, all prepared, with median 86.28 ms/p95 121.95 ms/max 123.25 ms; two initial frames remain separate at 279.02/281.54 ms. Zero errors/incomplete/unexpected playback, three live/peak players, and 36 allocations minus 33 releases balances correctly. The attached text is truncated during session 2 activation 3: 31 of 33 selection rows (29 noninitial) are complete. Python checks confirm received frame/playing/progress evidence, positive prepared buffers, minimum preceding dwell 2,193.01 ms, and resource balance; they cannot recompute the full 31-swipe percentile. One received row is interrupted and retained; 62 event records were discarded by the bounded log, with zero dropped transitions. Evidence: `tests/runs/device/plan_167_phase_e/2026-10-18T000329-received-truncated.txt`, `2026-10-18T000329-report-extract.json`, and `2026-10-18T000329-review.json` in the same directory. The user confirmed stable Wi-Fi. Numerical normal-swipe targets are met as reported on the intended network; separate stress acceptance remains pending.
- Evidence summaries: `tests/runs/api-curl/2026-10-17_plan_167_phase_b/summary.md`, `tests/runs/device/plan_167_phase_c/summary.md`, `tests/runs/device/plan_167_phase_d/summary.md`, and `tests/runs/device/plan_167_phase_e/summary.md`.
- Phase E rapid-swipe report: preserved as `tests/runs/device/plan_167_phase_e/2026-10-18T030538-rapid-received-clipped.txt` with extracted header/complete older rows in `2026-10-18T030538-rapid-extract.json`. Resource counters pass the three-player cap/balance; unexpected playback increased from zero to one since the last report. Cumulative data and clipped current details prevent isolating the rapid interval or diagnosing this event. Typecheck, all 47 tests, and iOS export (613 modules) pass after adding compact sharing, issue retention across event rollover, and eligibility context. The new host tests verify observability and guard behavior, not a native bug fix or rapid-test pass.
- Phase E extended browsing failure: report generated 2026-10-18T03:14:53.149Z, original/extract under `tests/runs/device/plan_167_phase_e/2026-10-18T031453-five-minute-*`. User observed persistent spinners after revisiting older videos, followed by error/retry recovery. Summary retains nine incomplete transitions and one error (publication 186, activation 62), with peak/live three and balanced 111 allocations/108 releases. All three pinned playback-guard issues identify the selected item while scrolling, not a different publication. Clipping prevents inspecting the failed activation's full timeline. Local code and anonymous live checks rule against video-signature renewal: all 29 HLS URLs unsigned, media masters/variants/segments accessible for four relevant publications, Retry uses the same URL. Evidence `2026-10-18-signature-check.json` in the same directory.
- Buffering-control correction: installed native source confirms loading can indicate rebuffering rather than an initial unready source. The controller now preserves selected playback intent across loading after readiness, deduplicates play/pause commands, and maintains all eligibility/ownership guards. Added startup/native/source/unavailable error categories. Typecheck, 50 tests, and iOS export (613 modules) pass. Native repeat remains required; the code defect is demonstrated by regression tests but not conclusively established as the sole cause of the phone stall.
- Buffering device repeat: `tests/runs/device/plan_167_phase_e/2026-10-18T033210-buffering-repeat.json` is a complete compact export. User confirms two brief self-resolving loading indicators and no persistent stall. 93 selections, 91 frames, two incomplete retained, zero errors/issues/unexpected playback, 102 allocations/99 releases/three live and peak players. Prepared p95 122.18 ms (60 samples); mixed-direction framed p95 415.75 ms and cold max 3,599.87 ms remain explicit. Python consistency checks pass for count partitions, resource balance/cap, and omitted-detail counts. Compact mode intentionally omits 88 transition details and 1,000 retained events, so full percentile/progress/completeness review is unavailable. The targeted regression passes as observed without claiming a ten-minute stress pass or universal instant playback.
- Sound/overlay increment: AsyncStorage 2.2.0 installed using SDK 57's module map; root dependencies unchanged. Typecheck and all 58 tests pass, iOS export compiles 622 modules, Expo Doctor passes 21/21, and root backend build passes. New tests cover hydration before playback, exact startup persistence/current-session separation, Refresh-created coordinators, storage errors, pending saves, and keeping preload neighbors muted. An initial isolated clean install failed with ENOSPC on this host; only its task-created temporary copy was deleted, and verification was moved to a memory-backed isolated copy. See `tests/runs/device/plan_167_phase_e/preferences-clean-install.log`; memory-backed result is recorded below when complete. Metro reload was attempted, but no phone was connected; user was asked to reopen the existing project and verify four focused sound/overlay checks.
- Clean-install follow-up passed: installed the current mobile lockfile from scratch with `npm ci` in an isolated `/dev/shm` copy, then ran typecheck and all 58 tests successfully. The verification copy was removed; the live mobile install/Metro process was preserved. Evidence `tests/runs/device/plan_167_phase_e/preferences-clean-install-memory.log`. Root backend build passed, and `npm --prefix mobile run check:api` verified health, anonymous pages of 20 and nine items, HLS master/variant, segment HTTP 206, and poster JPEG. The documentation checker still reports the same 16 pre-existing older-plan status errors; whitespace checks pass. No physical-device settings/overlay result has been received yet.
- Sound/overlay native result received: “Yes. All good.” confirms all four explicitly requested iPhone checks. Evidence `tests/runs/device/plan_167_phase_e/preferences-summary.md` now records the pass. No new code changed, so the previous 58-test/typecheck/export/clean-install/Expo Doctor/backend results still apply.
- Cellular/lifecycle evidence: exact Expo Go version 57.0.9. `tests/runs/device/plan_167_phase_e/2026-10-18T045205-cellular.json` is a complete compact export: 50 selections, 49 frames, one incomplete retained, zero playback errors, 67 allocations minus 64 releases equals three live players, peak three. Prepared median 104.33 ms/p95 122.11 ms/max 146.97 ms; mixed-direction framed p95 837.66 ms and cold max 1,940.40 ms remain explicit. Both pinned guard issues are current-selection/scrolling cases, not different-publication playback. All five retained tail rows have frame/playing/progress evidence. Python checks pass for partitions, resources, issue context, and omitted details; percentiles are device-reported, not recomputed from five rows. User explicitly confirmed background/foreground and lock/unlock stop hidden audio, preserve manual pause, and avoid overlapping/wrong-video playback in the prior ten-minute run. No run-specific ten-minute resource export is available; ownership evidence comes from other reports and the bounded controller tests. Actual fully-offline feed error and successful Retry remain pending. Current API response has ETag but no explicit Cache-Control/Expires/Age; continuing playback cannot establish whether cache, buffering, or connectivity explains the observation.
- Final offline result: user confirmed “Error appears with airplane mode on. When switched off and reconnected, feed loads and plays.” The feed error/retry branch passes on the phone. All Phase E results and limits are consolidated in `tests/runs/device/plan_167_phase_e/acceptance.md`.
- Phase F review: `tests/runs/device/plan_167_phase_f/summary.md` consolidates final checks. Read-only Git review confirmed no root package/lockfile/Node configuration, backend, frontend, or public-output diff. All 38 new mobile source/config/test files are expected; local environment/build/dependency directories are ignored, and the package lock agrees with declared dependencies. No additional runtime change after the passing 58-test build; further repeated tests were unnecessary for documentation-only completion.
- Commit validation: reviewed and staged exactly the 41 intended files; staged whitespace checks passed. Root runtime/dependency/API/web diff remained empty; local environment/build/dependency directories stayed ignored. Pre-commit agent docs check retained only the same 16 pre-existing older-plan errors. The previously executed 58 tests, typecheck, clean install, Expo Doctor, iOS/backend builds, API checks, and physical-device acceptance apply to the committed application code. Root README already documents the implemented workflow; no post-commit README change is needed.
- Push attempt: user explicitly authorized pushing. Fetched origin; local main is three commits ahead with no remote-only commits (`3d34f6f`, `5ba58e0`, `d7a286f`). Ordinary `git push origin main` failed because this host has no HTTPS GitHub credentials; no remote branch changed. No existing CLI login, token environment, SSH key/agent, or credential helper was configured. Installed the checksum-verified official GitHub CLI in the user-local bin directory and started browser/device authentication. The user completed browser/device authentication; no credentials or one-time codes are stored in the repository. Existing connected GitHub object-creation tools cannot upload these exact local commits with their original author/committer metadata, so no alternate rewritten history was published.

- Push validation (2026-10-18): after user-confirmed GitHub authentication, fetched origin again and verified zero remote-only commits and three outgoing commits. Normal fast-forward push published all three commits to `origin/main`. Remote `refs/heads/main` and local HEAD both resolve to `d7a286f04cf5d2f7a9c170bd8afebdea6d5bd142`. Used a command-scoped GitHub CLI credential helper; no additional commit or history rewrite.

## Open Risks / Deferred

- Evidence limits: older raw reports are clipped and newer compact reports intentionally omit most event/transition details; complete percentile recomputation is unavailable for the final samples. The ten-minute lifecycle result is manual without a dedicated resource export. Guard events identifying the selected video during scrolling remain recorded. Native memory profiling and standalone/release-build performance validation remain future work.
- Device environment: iPhone 17 Pro Max, iOS 26.6.2, Expo Go 57.0.9, Expo SDK 57. Repeat compatibility checks when upgrading the SDK.
- The existing HTTPS API hostname may serve a different checkout or need network access configuration. Confirm the endpoint identity without changing unrelated hosting.
- CDN startup time, source bitrate/keyframe layout, and network throughput may limit the 300 ms target. Record measurements before considering backend encoding/CDN changes as a separate increment.
- Expo Go timing and memory behavior may differ from a standalone development/release build. Production performance acceptance will need another device pass.
- Global feed responses currently expose more fields than a viewer needs, including creator email. Server response minimization is deferred, not solved by the adapter.
- Authentication, richer discovery, captions, message inserts, reporting, production analytics, offline use, and app distribution remain deferred.
- Feed metadata grows with fetched pages during a POC session. The native player window is bounded; long-session feed-cache eviction and unlimited backward history need a later explicit policy if required.

## Resume Here

Completed: all six POC phases and device acceptance on iPhone 17 Pro Max / iOS 26.6.2 / Expo Go 57.0.9. Setup is in `mobile/README.md`; consolidated acceptance is in `tests/runs/device/plan_167_phase_e/acceptance.md`; handoff evidence is in `tests/runs/device/plan_167_phase_f/summary.md`. No further implementation or phone test is pending for this scope.

Git state: implementation committed as `d7a286f` (`feat: add anonymous iPhone video feed POC`) and pushed to `origin/main` under the user's explicit authorization. All three outgoing commits were published; remote HEAD matches local HEAD (`d7a286f04cf5d2f7a9c170bd8afebdea6d5bd142`). This plan's SHA/validation update remains an uncommitted continuity note; no application-code change remains outside the commit. Do not create another commit without a new explicit request.

Future scope: authentication, additional native screens/interactions, standalone distribution, native memory profiling, production analytics, and API response minimization remain separate increments. Preserve cold/incomplete/guard observations and export limits when using these results as a baseline.
