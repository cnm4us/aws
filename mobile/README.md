# iPhone video viewer

This Expo app is the native client for the existing public video feed. Swipe vertically between full-screen videos; the selected video starts automatically and the previous video stops. It loops, supports tap to pause and mute/unmute, and pauses when the app leaves the foreground. Startup sound defaults to Unmuted and can be saved as Muted in Settings. Your current sound choice follows you between videos and through feed Refresh.

Cursor pagination, deduplication, retry, refresh, and protection against stale playback callbacks are implemented. The original anonymous POC was accepted on the test phone; [Plan 167](../agents/implementation/plan_167.md) retains that evidence. [Plan 168](../agents/implementation/plan_168.md) adds signed-in viewing and native navigation. Its host and recorded independent iPhone development-build acceptance checks pass; Plan 168 is Complete with VoiceOver deferred, large-text clipping accepted and other evidence limits retained.

## Current UI update (Plan 172)

Video Viewer 0.1.0/build 6 is installed and accepted for the recorded internal-preview scope in [Plan 172](../agents/implementation/plan_172.md). [Install signed build 6](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/0f520676-1d89-4b8f-9f0a-b21a78fb59c0) over the current app on the registered iPhone. The separate caption-loading spinner waits 300 ms; cues and errors appear immediately. The user confirms the brief CC flash is gone and captions still follow speech.

The confirmed stable-Wi-Fi, usual-text-size, Captions-On sample passes: 42/42 normal transitions prepared, first-frame median 104.23 ms/p95 121.03 ms/max 124.76 ms, peak three players, zero errors/incomplete/unexpected playback. Two initial/cold frames remain recorded, with a maximum of 1,469.71 ms. The user reports no frozen controls or overlapping audio. Build 5’s earlier p95 miss remains in the plan; individual samples do not establish why timing changed. Source/artifact checks match the installed build; host typecheck and all eight component cases pass.

In the new UI, tap the current space name to open **Spaces**. Closing it or selecting the current space keeps the video and creator-return journey; choosing a different space starts its feed. The build 5 header follow-up replaces the type subtitle with a compact channel/group/personal icon and adds scaled line spacing; the user confirms no bottom cropping at the largest tested size. Long header names remain limited to two lines with ellipsis; the full name remains in Spaces and the accessibility label. The upper-right **Menu** offers Sign in/Account, Sign out, Settings and **Refresh feed**. Creator profiles also have a menu; Account/Settings return directly to their caller. Menu pauses the covered feed. Refresh remains access-checked and preserves the original checkpoint during personal-feed detours.

**CC** is a constant label; the sound control uses speaker-on/off symbols. Both use white glyphs at 50% opacity off and 100% on, with full-size enabled targets. The build 4 follow-up sets their charcoal backgrounds to 25% opacity in both states; build 3 uses the original darker surface. Captionless videos have no CC control. Settings and recovery controls scroll; labels wrap and large-text choice/header rows stack. The header has physical maximum-text-size evidence; all-screen maximum-size qualification remains unverified.

In internal builds, **Menu → Playback diagnostics** replaces title long-press for Share report, Share full report and Reset diagnostics. Ordinary Release has no diagnostic entry. Use `npm run test:ui` for reproducible rendered component checks; [test harness scope](tests/rendered/README.md) explains controlled native ports and physical-layout limits.

## Creator and Global Launch update (Plan 173)

Signed [build10](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/a8c46663-bdb5-42c0-83a0-bef42e486818) is installed and passes the recorded functional phone checks: Creator/Launch, exact paused/playing Global-to-group return, nested personal detours, destination Refresh, caption/story correctness, background/lock/manual pause, automatic permission denial/recovery, offline recovery and protected sign-out. Routine access/text renewal is quiet within a hard60-second verification window; entry/covered/foreground return and failed/expired verification still block. Host161 unit/27 rendered/typecheck/export/archive and signed-artifact checks pass. Fixture mutations are restored and no active native fixture sessions remain. Plan173 is Complete (A–F) for this internal milestone. Confirmed stable-Wi-Fi/CC/usual-size forward sample:54 transitions,52 prepared,p95132.86ms,98.11% normal preparation,peak3,0 recorded errors/incomplete/unexpected playback; all54 have playing/progress. Full timeline review retains a recovered cold186 start (firstFrame7.96s/playing8.27s/progress8.65s) with unconfirmed cause; repeat prepared firstFrame123ms.34 prepared rows with>=2s media progress independently pass p95133.48ms; not every clip had two media seconds. Build6 p95121.03ms remains the comparison baseline. No additional phone run required. Implementation is committed/pushed as `c8583f0`; remote implementation SHA verified, with delivery records following separately. Physical maximum-size/upgrade/VoiceOver/native-memory limits are recorded in Plan173.

The right-side Creator avatar/fallback opens the existing profile; the creator name still works. Global has **Open spaces for this video**. Its chooser requires sign-in, shows accessible group/channel publications of that production, and rechecks the selected destination before entry. Native Like/Comment controls and counts remain deferred; Global stays discovery-only.

Entry opens the exact space publication near the Global position when production identity is known, preserving manual pause. Legacy unknown production ULID starts at0 without applying an unverified offset. **Back to Global** restores the original publication/time/pause through fresh feed authorization. Creator/personal-space detours first return to the launch-space video, then to Global. Menu Refresh resets only the current destination feed; selecting a different space clears the launch journey. A missing launch target cannot silently autoplay a fallback video. Sign-in/account changes discard old launch intents; anonymous sign-in returns to Global for a fresh Launch tap.

Signed preview source/build/install and physical observations belong in [Plan173](../agents/implementation/plan_173.md). Disposable test credentials remain in ignored local fixture storage; no credentials are committed. Existing API access checks, hidden audio/text behavior and the three-player limit remain in force.

## Signed-in viewing

Browse **Global** anonymously, or use **Menu → Sign in / Account** and sign in with an existing application account. **Spaces** lists your personal space and existing accessible groups/channels, including active subscriptions. Selecting a different space resets its feed to the beginning; selecting the current one dismisses the selector. Global always uses the public aggregator. Creating accounts, joining spaces, payments and comments are subsequent features. Publication stories and app captions are implemented under Plan 170, accepted in bundled build 2 with the limits recorded in Plans 170/171.

The feed pauses while Account, Spaces, Settings, or a creator profile is open. Returning preserves an intentional pause. Protected viewing checks identity and space access after foregrounding and at least once per minute while active. A denied space clears its videos and offers Global/Spaces recovery; a lost session clears viewer state. Retryable verification failures hide and pause the existing feed so retry preserves manual pause. New app launches validate saved credentials, then start in Global.

## Stories and captions

Videos with a written story show its preview beside the creator. **Expand story** opens that publication's full text; **Collapse story** closes it. Long stories scroll within the panel. Expansion preserves playing/paused state and sound. Swiping to another video, leaving the feed or Refresh collapses it. Without a story, the existing upload description remains the fallback.

The **CC** button appears on videos with ready production captions. The choice applies immediately across videos/feeds and is saved for the next app launch, separately from sound and account identity. It defaults off. **Settings → Captions → On / Off** changes it even when the current video has no captions. Save failures keep the current visit's choice and offer Retry in Settings.

Captions follow the selected player's media time, including manual pause, loop and profile-return time restoration. They hide during expanded stories, scrolling, covered/hidden screens, initial/recovery access verification, failed/expired verification and playback errors. Routine successful checks retain already-verified content within the bounded freshness window. A missing or malformed caption resource offers **Retry captions** without replacing the video or requiring sign-in. Genuine session/space/publication denial still clears protected content through the existing access recovery.

Stories are publication-specific, so different spaces can have different text for the same video. Native text endpoints enforce exact feed/publication eligibility, including anonymous Global reading. Caption parsing supports bounded plain-text WebVTT, existing short-cue linger/merging and one display style. No new transcription job, native subtitle track, persistent text download or private media delivery is added.

[Plan 170](../agents/implementation/plan_170.md) records host/API/browser and bundled iPhone acceptance with explicit coverage limits. Release-mode host checks exercise the caption clock independently of development diagnostics; bundled native release behavior and physical alignment remain separate acceptance.

## Creator profiles and personal viewing

Tap a creator's name to open their read-only profile. Public identity is available without signing in; optional biography/avatar obey existing visibility settings. Personal-space entry appears only when the server permits the current account. Public Global videos and following/subscription relationships do not grant personal access. Personal owner/member/site-admin authority remains subject to bans.

**View personal space** checks access again before opening that feed. **Back to profile**, then the profile's Back control, returns to the original feed/video near its saved time. Intentional pause is preserved; a mute change made during the detour follows you back. The return reloads current authorized content, so it may briefly load. An original video removed while away falls back to the current feed; lost space access shows recovery controls.

One original feed checkpoint is kept in memory. Repeated creator detours reuse it; choosing another feed through Spaces/Global or changing accounts clears it. Reopening the app starts on Global. No feed history is saved to disk. Account/Settings opened from a profile return to that profile when closed.

[Plan 169](../agents/implementation/plan_169.md) is Complete for the recorded iPhone development milestone: profile and authorized personal-feed return, pause/mute preservation, access recovery and offline return passed focused device checks, supported by host/API/browser coverage. The final Wi-Fi sample has 40 prepared normal transitions (100%), first-frame p95 120 ms, zero errors/incomplete/playback warnings and peak three players. Recorded coverage limits and the earlier unconfirmed native-freeze cause remain in the plan. Profile editing, access requests, social actions and release distribution remain later scope.

Native sign-in uses a separate revocable 30-day session. There is no sliding renewal yet; expiry requires signing in again. Credentials use Expo SecureStore with device-bound unlocked Keychain storage. A non-secret install/sign-out marker prevents a surviving Keychain item from restoring after reinstall or interrupted logout. Passwords and feeds are not persisted. Sound settings remain device preferences, separate from the account.

When connectivity prevents session verification, Account keeps the saved sign-in separate from the fresh password form. It offers **Retry saved sign-in** and **Sign out**, including while verification is pending. Retry validates the retained session; offline sign-out removes local access before trying server revocation. A genuine expired/rejected session returns to the password form. The phone checks confirm both no-password recovery after reconnection and explicit offline sign-out staying signed out after reconnect/Reload; Plan 168 retains the evidence.

**Sign out** removes local access immediately and revokes the native session when reachable. Offline sign-out cannot confirm server revocation; the app explains that limit. A storage failure offers retry and must be resolved before claiming durable sign-out. Switching accounts clears old spaces, feed requests, navigation history, and players.

For another backend installation, enable `NATIVE_SESSIONS_ENABLED=1` and configure `NATIVE_TRUST_LOOPBACK_PROXY=1` only behind a trusted loopback TLS proxy. Startup applies the additive native session/login-limit tables; browser cookies remain unchanged. Keep `NATIVE_ALLOW_INSECURE_LOOPBACK=0` outside local test servers. [API contracts](../docs/API.md) document routes, limits, and errors. This development host has native sessions enabled.

Viewer endpoints minimize response fields on the server. Legacy broad feed endpoints still require their own compatibility migration. Space API access does not protect copied public media URLs; current test fixtures reuse public Global videos, with confidential media delivery deferred.

## Requirements

- Node 22.21.1, pinned in this directory's `.nvmrc`. The root server's Node configuration is separate.
- Expo Go supporting **SDK 57** on the iPhone. Install Expo Go once on the phone; it can open multiple projects. This project's dependencies are installed separately in `mobile/node_modules`.
- A free Expo account signed into both the CLI on the development machine and Expo Go on the phone when required by the installed Expo Go version.
- An HTTPS API address reachable from the phone and the supplied CloudFront HLS media.

This project uses Expo 57.0.30, React Native 0.86.3, React 19.2.3, expo-video 57.0.5, and AsyncStorage 2.2.0, with exact resolved dependencies in `package-lock.json`. AsyncStorage's Expo Go-compatible version was selected by `expo install` using the installed SDK's module map. SDK 57 was chosen because Expo's [project setup instructions](https://docs.expo.dev/get-started/create-a-project/) recommend it for physical-device Expo Go during the SDK 58 transition as of October 17, 2026. If the installed Expo Go reports a version mismatch, confirm its supported SDK before changing dependencies.

The original POC device target is iPhone 17 Pro Max running iOS 26.6.2 with Expo Go 57.0.9. The user confirmed initial launch, playback, swiping, the ten-minute manual lifecycle/audio checks, saved startup sound, current mute surviving Refresh, icon removal with CC still working, and fully-offline feed error/reconnect/Retry playback. Normal Wi-Fi and mixed cellular reports both show prepared-frame p95 around 122 ms and peak three players. Some diagnostic exports are compact or clipped; the ten-minute run has no separate resource export, and no native memory profile is claimed. Acceptance applies to this Expo Go POC on the recorded phone. For Plan 168, the initial sign-in, space navigation and restored-session checks passed; repeated Global/Channel playback passed after the navigation fix below, with subsequent signed-in acceptance completed as recorded in Plan 168. A standalone production build needs its own validation.

## Install and run

From the repository root:

```bash
cd mobile
nvm install
nvm use
npm ci
cp .env.example .env
```

Copy the example environment file only during first setup; preserve an existing local configuration. Its public API address defaults to `https://aws.bawebtech.com`. This hostname and `http://127.0.0.1:3300` returned the same running build identifier during the initial host check. After restarting the backend, recheck `/health` and `/version` if you need to confirm which running build the proxy serves.

For a development machine on the same reachable LAN as the phone:

```bash
npm start
```

For this remote development machine:

```bash
npm run start:tunnel
```

Scan the terminal QR code using the iPhone Camera app and open it in Expo Go. Keep Metro running while using the app. The tunnel helper is a local development dependency; a global ngrok install is unnecessary.

If Expo Go asks for a matching developer account:

```bash
npx expo whoami
npx expo login
```

Use the same Expo account on the phone. An existing CLI login from another project can be reused. This is Expo development access, separate from application login; the app makes anonymous API requests.

## Sound settings

Open **Settings** beside Refresh, then choose **Start videos → Unmuted / Muted**. The setting saves automatically and applies on the next app launch (or Expo Go Reload during development). The default is Unmuted. Changing this startup setting leaves the currently playing video's sound unchanged; **Done** closes Settings.

The **Mute / Unmute** pill controls sound for the current browsing session, including all swipes, background/foreground cycles, retries, and feed Refresh. Refresh restarts the feed without resetting that choice. A new app launch starts from the saved setting rather than the last temporary pill override.

The app loads the saved preference before mounting playback. It stores only a versioned startup boolean using [AsyncStorage](https://docs.expo.dev/versions/latest/sdk/async-storage/), under `video-feed-poc:playback-preferences:v1`; no app login is needed. A save failure leaves the prior setting selected and presents a retryable message in Settings. A read failure falls back to Unmuted and shows a message in Settings.

The feed sets `allowsVideoFrameAnalysis={false}` to hide iOS Live Text's frame-analysis overlay. The user confirmed the four-corner icon is gone and the existing CC control still works.

## Networking and configuration

Set the single public configuration value in `mobile/.env`:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://aws.bawebtech.com
```

Restart Expo after changing it. Missing or invalid configuration produces a setup message in the app. Use HTTPS without embedded credentials, query parameters, or fragments. Do not copy the backend `.env`, passwords, AWS keys, or admin tokens into this project. Expo public environment variables are bundled into the client.

The phone connects to three services:

1. Metro through the LAN or Expo tunnel to load JavaScript.
2. The configured HTTPS API to load the public feed.
3. CloudFront to load HLS playlists, segments, and posters returned by the API.

An Expo tunnel exposes Metro only. It does not expose the API on port 3300. On the phone, `localhost` refers to the phone itself. The current HTTPS reverse proxy avoids a separate API tunnel. Starting this app does not start or restart the backend; use `npm run serve` from the repository root if needed.

The app uses the viewer API's provided `playbackUrl` and does not guess alternate orientations or public S3 access. The versioned viewer API minimizes fields on the server, and its mobile adapter also accepts only the viewer contract. Legacy web feed responses retain their existing broad payloads pending a separate compatibility migration.

## Checks

Run from `mobile/`:

```bash
npm run typecheck
npm test
npx expo-doctor
npm run check:api
# After opt-in root viewer:fixtures:text setup:
npm run check:text
npm run export:ios
```

`check:api` verifies anonymous health/feed access, a second page when a cursor exists, plus one HLS master, variant playlist, media segment, and optional poster. It reads `.env`, prints status and publication IDs without raw feed records or signed URLs, and sends no cookies or credentials. These are checks from the development host; they do not establish reachability from the iPhone's network.

`export:ios` compiles the JavaScript/Hermes bundle under ignored `mobile/dist/`. It verifies the iOS bundle graph without requiring Xcode, signing, or a physical device. It does not build an installable iOS app or prove native playback.

The expanded tests cover secure session hydration and serialized writes, cancelled/late logins, failed/ambiguous storage, offline logout, identity generations, access validation, context isolation, field minimization, and playback eligibility/resource limits.

The original playback tests cover configuration validation, feed field mapping/minimization, malformed responses, publication identity, overlapping pages, cursor cycles, retry, refresh cancellation, playback ownership, stale callbacks, mute/pause state, and paging with or without momentum. Pool tests exercise a 40-video feed, the three-player cap at every allocation, prepared-player reuse, failed preloads, background cleanup, and listener disposal. Diagnostic tests cover timing, incomplete/error samples, resource totals, and bounded history. Preference tests cover delayed hydration, next-launch persistence, temporary mute across refreshed coordinators, serialized saves, failed/corrupt storage, and applying sound before the first native play request while keeping neighbors muted.

From the repository root, `npm run build` verifies the existing backend still compiles. All mobile install/build commands operate in the mobile package; root dependencies and build scripts are unchanged.

## Independent development build

The Expo project is linked to [mbcollins2/aws-video-feed-poc](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc). The application name is Video Viewer and the iOS bundle identifier is `com.bawebtech.videoviewer`. `eas.json` defines development/internal-distribution and simulator profiles, with the public HTTPS API address. Expo and root Node pins remain separate.

The repository-root `.easignore` explicitly includes mobile source/assets, build configuration and the preview build helper. EAS uploads omit backend/web packages, local environment/credential files, dependencies and test evidence. Add future build inputs to both that allowlist and the helper's input inventory. The Plan 171 archive contains 58 files (442,351 bytes); its source digest matches the reviewed working tree. Archive/config inspection does not compile or sign an iOS app.

From `mobile/`:

```bash
npx eas-cli@25.2.0 build --platform ios --profile development
npm run start:dev-client
```

On this host, reuse the prepared CLI cache with `npm_config_cache=/dev/shm/plan168-npm-cache TMPDIR=/dev/shm npx eas-cli@25.2.0 build --platform ios --profile development`. Root disk space is limited; this keeps task cache and temporary build files in memory-backed storage.

The device development build requires Apple Developer Program access and iOS signing credentials. The account holder completed Apple authentication directly in the terminal. [The first signed device build](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/66023796-973d-4c98-8ad3-39fc6433d0b7) succeeded (Video Viewer 0.1.0/build 1). The user confirmed installation, Global/space playback, sign-in restored after fully closing/reopening, and logout returning Spaces to its sign-in prompt. Its stable-Wi-Fi sample also passed: 33 prepared transitions, first-frame p95 about 110 ms, three peak players and zero errors; two cold/initial selections remain separately recorded. The independent-app core smoke is accepted, including session restore/isolation, sound/storage, offline recovery and mixed lifecycle/resource checks. Integrated denied/expired-access checks also passed; Plan 168 records the completed milestone and accepted limits. Linux uses the cloud build service; local Xcode/simulator work requires macOS. [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/).

Install from the EAS build page on the registered iPhone, then open Video Viewer. Start Metro with `npm run start:dev-client`; scan its QR code or enter its HTTPS tunnel address manually in the app. Automatic local-server discovery may not find this remote host. If Reload cannot connect, verify the development server is still running; a stopped tunnel requires restarting Metro. The [debugging cookbook](../agents/tools/debugging.md#expo-development-client-reload-on-the-remote-host) records the verified remote-host checks and low-disk restart command. The CLI's `s` key switches an already-running server between development-client and Expo Go modes. A native development build still loads development JavaScript from Metro; it is not an offline preview/release bundle.

Expo Go remains available through `npm run start:tunnel`. It and the independent app use separate Keychain namespaces, so sign in again in the independent app. TestFlight/App Store publication is separate scope.

## Bundled internal iPhone preview

The `preview` profile builds a Release app with embedded JavaScript, the same Expo project/bundle identifier, and the direct `https://aws.bawebtech.com` API. It replaces the installed Video Viewer development client. Install over the existing app first; verify saved sign-in, CC and sound preferences rather than uninstalling/resetting data. Development/simulator profiles remain available for debugging. [Plan 171](../agents/implementation/plan_171.md) records host/export/archive/signed-artifact and bundled functional phone checks. The final numerical report passes (40/40 normal prepared, first-frame p95 126.87 ms, peak three, zero recorded errors/incomplete/unexpected playback); user confirms stable Wi-Fi/CC On/usual size with no spinners, frozen controls or overlapping audio. Plans170/171 are Complete for this internal milestone with recorded limits; Metro/tunnel are off and the API remains online. The earlier baseline preview [build 2 succeeded](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/7a049a95-613f-4e81-98ee-4c761cc80772).

From `mobile/`, using Node `22.21.1`:

```bash
npm run export:preview
npm_config_cache=/dev/shm/plan168-npm-cache TMPDIR=/dev/shm npm run build:preview -- --non-interactive
```

The wrapper sets the profile's public flags for export, prepares `src/config/buildIdentity.json` from included mobile inputs, and invokes pinned EAS CLI 25.2.0 for builds. The cloud pre-install hook rejects a stale identity/upload. `npm run prepare:preview` prepares the stamp alone. Source identity excludes the generated stamp itself, test files, local secrets, environment files and dependencies; the private archive manifest additionally records HEAD and each included file hash. Include uncommitted source deliberately: a HEAD SHA alone does not identify this build. No extra runtime dependency or EAS Update configuration is added.

Versions use local `appVersionSource`: check the latest EAS iOS build, choose a new larger `ios.buildNumber` in `app.json`, then prepare/build. Keep `0.1.0` until a product version change is intended. No automatic version increment occurs. Source edits do not reach an installed preview through Metro Reload; produce and install another signed build. Signing or device-list changes may require the account holder's private Apple authentication. Reuse valid credentials; do not revoke certificates shared with other projects. Check root/tmpfs capacity before exporting or building.

After installation, open from the home-screen icon. Metro/tunnel supplies development JavaScript only; the bundled app obtains content/access through the HTTPS API and HLS through CloudFront. A cold offline launch can open the embedded UI but still needs connectivity to validate protected access and obtain media. A checking-access indicator is distinct from media buffering. Tunnel removal is not proof that prior HLS delays are fixed.

Internal playback reports are enabled only by development mode or the exact pair `EXPO_PUBLIC_VIEWER_BUILD_KIND=internal-preview` and `EXPO_PUBLIC_VIEWER_DIAGNOSTICS=1`. Long-press the feed title to inspect build/version/source, Share report, Share full report, or Reset diagnostics. Reset leaves playback, position, CC and sound alone; the next selection starts timing. It retains active source readiness and ownership; after reset, `carriedPlayers + allocations - releases = livePlayers`. Refresh keeps the sample. Reports are bounded, local and contain no credentials, source URLs, story or cue text; sharing uses the device share sheet. Ordinary Release defaults to no diagnostic collector/action/progress sampling, while captions retain their independent selected-player clock. An instrumented preview is not uninstrumented store-build performance qualification.

Recovery: retain the successful preview install page and the [previous development binary](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/66023796-973d-4c98-8ad3-39fc6433d0b7). Reinstalling that development binary restores the Metro debugging workflow under the same app identity; it is not an automatic source rollback. If every control freezes, stop repeated trials, record build/source and approximate time, and check iPhone Settings → Privacy & Security → Analytics & Improvements → Analytics Data for a matching crash or Jetsam event. A freeze may leave no crash entry. Share only the relevant log after checking for personal information; Mac/Xcode tracing is a separate option if available. Linux export/ownership counters do not establish native crash freedom or leak-free memory.

## iPhone checks

Plan 168 adds these required checks to the original playback checklist below. Plan 168 records completed phone checks and the remaining gates; this list is the full acceptance scope:

- Sign in, reload, and confirm identity is restored only after server validation.
- Switch Global → Personal → Group → Channel → Global; confirm title, content, pagination, and Refresh match the selected space.
- Open Account/Spaces/Settings and perform a cancelled back gesture; confirm hidden audio stops and intentional pause survives returning.
- Sign out, reload to anonymous Global, then sign in as an account with different spaces; confirm no old content or audio remains.
- While a protected feed is open, test background/lock, offline recovery, and denied/expired access. Network failures must offer retry without deleting valid saved credentials.
- Collect separate normal-Wi-Fi, rapid/context-switch, and ten-minute mixed reports. Confirm peak players ≤3; retain cold/error/incomplete records. Repeat the core checks in the independent build after signing.


- Confirm Expo Go opens the project without an SDK mismatch.
- Confirm the first available video appears, uses the saved startup sound choice (Unmuted by default), and loops.
- Swipe forward and backward; verify each newly selected video starts and the old video's audio stops. Revisited videos start from the beginning.
- Try rapid swipes and a cancelled swipe. Verify skipped videos cannot begin playing later and a cancelled swipe preserves an intentional pause.
- Tap Unmute, verify audio, then Mute. Tap the video to pause and resume.
- Confirm mute/unmute persists across video changes and feed Refresh.
- Set Start videos to Muted, then reload Expo; verify the first video starts muted. Repeat with Unmuted. Changing Settings alone should not change the currently playing video's sound.
- Confirm the four-corner Live Text icon is absent and the existing CC control still works.
- Send the app to the background and lock the phone; verify audio stops.
- Return to the app; verify playback resumes unless you manually paused it before leaving.
- Tap Refresh; verify the old player stops and browsing resets to the beginning. Continue beyond the first 20 videos to exercise pagination when enough public videos exist.
- Keep the app open, enable Airplane Mode with Wi-Fi off, and tap the feed's Refresh. Wait up to 20 seconds for the error, then reconnect and tap Try again; confirm the feed loads and plays.
- Confirm creator/description text and controls are readable and avoid the notch/home indicator.

Record the Expo Go version, iOS version, device model, network, and results in Plan 167. Initial playback, swipe playback, normal Wi-Fi timing, the ten-minute manual lifecycle/audio checks, saved sound settings, cellular browsing, and fully-offline feed recovery passed for the POC, with report/profiling limits preserved in the plan.

## Preloading and development diagnostics

The coordinator retains at most three native players: previous, current, and next. It starts speculative loading after the selected source is ready, keeps neighboring players paused and muted, and promotes the same prepared player when you swipe forward. Returning to a retained previous video seeks to its beginning. Backgrounding releases neighboring players and pauses the current one; foregrounding rebuilds the window while preserving a manual pause.

Once a selected source has been ready, seek/rebuffer loading preserves its play request. Native play/pause commands follow changes in playback intent instead of being repeated on every status callback. Scrolling, backgrounding, manual pause, failure, and deselection still stop playback. This corrects a controller path that paused selected sources during rebuffering. In the user's repeat browsing check, two loading indicators cleared on their own and the persistent stall did not return; the 93-selection report has zero errors/unexpected playback and peak three players. The user also confirmed lifecycle/audio and cellular/offline recovery checks. Error diagnostics distinguish startup timeout, source loading, and native errors.

iOS receives a five-second preferred forward-buffer duration. This is a system hint, not a hard byte or duration limit. Persistent HLS disk caching is not used. A transition is classified as prepared only when its source was already ready with positive buffered duration before selection; revisits requiring a seek are classified conservatively as cold.

In development/internal builds 3 and later, open Menu → Playback diagnostics (builds 1/2 use feed-title long-press) to see live/peak player counts, transition/error counts, unexpected-playback count, and prepared first-frame p95. **Share report** exports compact JSON with aggregate metrics, the last ten error/unexpected-playback records, the latest five transitions, and up to five slow/cold/incomplete normal transitions. It explicitly counts omitted details. This avoids the clipping observed when forwarding long reports. **Share full report** includes the complete retained transition/event history. Both use the iOS share sheet. Diagnostics send no application API requests and contain no raw media URLs, credentials, or creator details. The hidden entry and diagnostic progress sampling are disabled in ordinary Release execution. Each transition can include `sourceLoad`: monotonic load-request time, `replaceResolvedMs` for the native asynchronous source-replacement promise, and `readyMs` for the first ready status, both relative to the load request. Source replacement completion does not establish buffered playback readiness. These timings stay with the bounded transition history after player release or progress-event rollover; no extra media request or polling is added. Compact outliers use `slowTransitions` and disclose omitted rows. Reports contain no source URLs.

Compact issues/transitions retain their feed context and auth generation across context switches. Native status/source-load failures include recognized iOS error domains and numeric codes when available; original error messages are discarded because they can contain signed URLs. Allocation failures distinguish a full shared player budget from a native creation failure. Progress is recorded independently of the first-frame display event so missing presentation evidence does not hide a running playback clock.

The Plan 168 Channel → Global failure report showed shared-budget exhaustion. Returning from Spaces/Account had pushed duplicate Feed routes, each retaining a paused player. These returns now pop to the existing feed; router/coordinator regression tests verify one Feed and preserve prepared playback, the three-player cap, and manual pause. The phone repeat confirms recovery across 81 transitions: zero errors/issues, peak three players, and prepared-frame p95 about 124 ms. Channel entry still checks session/space access and cold-loads its first player; subsequent prepared swipes are fast. Initial-load outliers remain in the report rather than being counted as prepared performance. Subsequent native device acceptance is complete with the exceptions and limits recorded in Plan 168.

The report records monotonic selection-to-first-frame timing separately from playing/progress evidence, preserves incomplete/failed/interrupted transitions, and separates initial-load samples. The displayed transition count includes the initial selection: one immediately after reload is expected, and prepared first-frame p95 has no samples until a prepared destination is selected. It retains up to 200 transitions and 1,000 events while keeping cumulative allocation/release totals; discarded history is counted explicitly. A separate ten-record issue history prevents progress updates from evicting every error or unexpected-playback detail. New unexpected-playback records include the selected publication and eligibility state; the coordinator pauses the affected player immediately. Such a record needs investigation and does not establish that overlapping audio was audible.

For a normal-swipe sample, reload the Expo project to start a fresh diagnostic run, stay on Wi-Fi, and spend at least two seconds on each video before swiping forward. Capture at least 30 forward transitions, using the app's **Refresh** if the available list is shorter. Feed Refresh preserves the diagnostic run and adds another initial selection; reloading Expo resets it. Confirm the diagnostic transition count starts at one before each separate run. Share the report before mixing in rapid swipes or background tests. Run those as separate samples and label network/device conditions. The user's stable-Wi-Fi report records 31 prepared swipes with p95 122 ms and a 100 percent normal preparation rate; its attachment was truncated, limiting independent full-row verification. Mixed-direction/rapid/cellular runs retain their cold and incomplete samples; their lower preparation rates are not compared to the forward-only Wi-Fi target.

For the Phase D resource check, try normal and rapid swipes, then background/foreground and Refresh repeatedly. Open Menu → Playback diagnostics to confirm live/peak players stay at or below three and that errors/overlapping audio do not accumulate. A zero-leak native-memory claim requires platform profiling beyond these ownership counters.

## Troubleshooting

- **Project incompatible with Expo Go:** Confirm the phone's supported SDK. This is an SDK 57 project; installing dependencies in another project does not change it.
- **QR code cannot open the project:** Keep Metro running, use the tunnel on remote hosts, and check Expo CLI/phone account alignment. Tunnel URLs can change after restarting.
- **Feed cannot load:** Open the API `/health` address in Safari on the phone, run `npm run check:api`, and confirm the configured HTTPS origin serves this backend.
- **Video stays on its poster:** Check CloudFront reachability on the phone and retry. The app shows recovery controls after a startup error or timeout. Collect the device result before changing codecs or encoding profiles.
- **Concern about URL expiry:** The current public feed supplies unsigned HLS playback URLs and signed poster URLs. Retry recreates the player with the same loaded playback URL; it does not fetch fresh feed URLs. Current host checks establish reachability, not the cause of an earlier phone-network failure. Use the compact report's issue details when investigating repeat stalls.
- **No videos available:** Only published public-feed entries are included. Refresh after publishing material. Missing or invalid video URLs remain unavailable cards that can be swiped past; failed pagination offers retry while preserving loaded videos.
- **Native testing from Linux:** Use Expo Go on the physical iPhone. A local iOS simulator or Xcode build requires macOS; a successful bundle export is not a simulator test.

## Implementation boundaries

`src/auth/` owns native sessions, secure persistence, serialized identity changes, and foreground validation. API calls use `expo/fetch` with redirects rejected and cookies omitted; bearer credentials attach only to native-session/viewer paths on the configured API origin. Credentials never enter the player, poster loader, navigation parameters, or diagnostics.

`src/feed/adaptFeed.ts` validates the minimized viewer contract and context. FeedStore owns cancellation, cursor protection, deduplication, refresh, and removal of media after access denial. Navigation replaces the one feed context rather than leaving stacks of player-owning feeds alive. The playback coordinator owns the previous/current/next window and combines app state, screen eligibility, scrolling, source readiness, and intentional pause. A process-wide player budget enforces a maximum of three allocations across replacements. Diagnostics remain device-local and limited to development or explicitly opted-in internal preview builds.

Backend native credentials work only on native-session/viewer routes. Existing browser sessions and CSRF behavior remain separate; both clients call the same feed and space permission services. Native session, API/browser integration scripts, and fixture setup are documented in the repository README. No production viewing analytics is introduced by this increment.

Plan 168 native account-switch follow-up: one Video unavailable → Retry incident froze all controls until full close/reopen, with subsequent repeats successful. The supplied mixed report has 51 selections, zero recorded errors, peak three players and one selected-player scrolling guard event; it does not capture the frozen incident. Terminal coordinator disposal now ignores queued callbacks from removed feeds; synchronous native loading failures become retryable errors and partial subscription setup rolls back its player/listeners. Three new host regressions pass with the full 103-test suite. The updated-build account-switch repeat stayed responsive across 76 selections, with zero errors and three peak players (prepared first-frame p95 about 135 ms). The original whole-app freeze remains recorded with unconfirmed root cause; no failed-source Retry was explicitly reported in the successful repeat. Native offline recovery to the same account without a password, explicit offline sign-out staying anonymous after full close/reopen, and saved startup Muted also passed. The first mixed run was about five minutes; a subsequent requested ten-minute protocol passed with 104 selections/frames, zero errors/incomplete, three peak players and prepared p95 about 136 ms. Three selected-player ineligible guard events are retained (one scrolling, two screen suppressed); no overlap/freeze was reported in that protocol. Final device access checks passed: denial stopped audible playback while Account stayed signed in, restoration plus Refresh recovered without login, and expired sign-in returned to anonymous Global. Test subscription restored and expired fixture session revoked; Plan 168 is Complete with the recorded limits.

Known accessibility limit on the test iPhone: build2 text/controls are readable at medium sizes, but some buttons become unreadable/clipped at larger sizes. The prior text-size slider left-to-middle check also passed for its recorded development scope. The user accepts this limitation for the current milestone; full maximum-size readability is not claimed. VoiceOver was explicitly deferred at the user's request; no physical screen-reader pass is claimed.

Plan 169 performance acceptance: the first stable-Wi-Fi sample missed preparation (30/35 normal transitions, 85.7%) despite prepared first-frame p95 110 ms and peak three. Diagnostics distinguished early preloading from delayed native readiness. After the selected-cold playback/startup corrections below, the final controlled sample passed: 42 selections/frames, 40/40 normal transitions prepared, median 87.57 ms / p95 120.38 ms / maximum 130.08 ms for normal first frames, zero errors/incomplete/unexpected playback, live/peak three. Two initial/cold frames reached 628 ms. The user observed one roughly 500 ms spinner around transition 14; its cause is not established by first-frame timings. No normal-swipe latency or preparation failure is hidden or excluded from the recorded before/after evidence.

Plan 169 startup follow-up: a subsequent Global third-video load took about 13.6 seconds to become ready despite source replacement resolving in 238 ms. The user also reports an earlier all-controls freeze requiring force quit; its native cause is unconfirmed and the captured second attempt was manually paused. The selected cold player now receives a play request after asynchronous replacement resolves, with native buffering handled by AVPlayer; speculative neighbors still cannot play. A coordinator-owned ten-second eligible startup deadline waits for both first frame and playing/progress evidence, and remains cancelled/deferred by intentional pause, scrolling, foreground/access eligibility and position restoration. Timed-out sources remain failed until Retry replaces them. This protects recoverable startup behavior while JavaScript remains responsive; it does not guarantee recovery from a native thread freeze. All 129 mobile tests/typecheck/iOS export pass; the short phone follow-up reports no problems/stalling and the final forward sample meets the recorded numerical gate. The earlier whole-app freeze did not recur in these follow-ups; its exact native cause is still unconfirmed. Position and near-five-minute mixed duration are qualitative, some privacy/empty/cancelled-gesture cases have host coverage rather than separately confirmed physical results, and full large-text/VoiceOver/release qualification is not claimed.

Plan171 bundled acceptance: Video Viewer0.1.0/build2 is accepted on the registered iPhone. Direct/Metro-off/offline startup, identity/settings, stories/captions/loop/pause, creator return, lifecycle, scoped access loss/recovery, expired-session reset, offline logout, B isolation and non-captioned playback passed within the recorded coverage. Stable-Wi-Fi/CC-on report:41 selections/frames, 40/40 prepared normal, median105.39ms/p95 126.87ms/max154.29ms, one initial/cold483.56ms, live/peak3, zero recorded errors/incomplete/issues/unexpected playback. User confirms no spinners/frozen controls/overlapping audio. Reports are compact; ownership counters do not establish native-memory safety or every transition's motion. Larger-size button clipping is user-deferred, VoiceOver is skipped, and upgrade-state comparison/expanded-story recovery/second offline Back/separate expiry audio-Back details retain explicit host-versus-device limits in the plans. Both fixture accounts are signed out server-side and original grants restored. Proposed control/header/menu UI refinements are recorded in the native roadmap; this build does not implement them.


Plan172 internal UI acceptance: signed build6/source `9e4731aebeb1c8aafdf99e313bcd1bca7a47292e708fbf978faa72726283ba65` is installed. Controls, space selection, covered audio, intentional pause, personal Refresh/original checkpoint, profile-menu caller return, fresh settings/account persistence and offline Menu sign-out pass over recorded phone coverage. The header no longer clips letter bottoms at the largest tested text size; long-name ellipsis is accepted. Menu/user-name checks used larger, explicitly not largest text. All-screen maximum-size qualification and pre/post upgrade-state comparison remain unverified. Hidden audio stops and same video/captions return; brief Checking Access after protected returns remains intentional. Host-only captionless/error/storage-failure/stale-action coverage, compact-report limits, deferred VoiceOver and native memory/battery/store qualification remain explicit in the plan. No host fixture/account changes or session revocations were needed in Plan172. Metro/tunnel remain stopped. Implementation is committed/pushed as `f0ed1b3`; remote implementation SHA verified, with delivery records following separately.
