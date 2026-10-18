# iPhone video feed POC

This Expo app is the native client for the existing public video feed. Swipe vertically between full-screen videos; the selected video starts automatically and the previous video stops. It loops, supports tap to pause and mute/unmute, and pauses when the app leaves the foreground. Startup sound defaults to Unmuted and can be saved as Muted in Settings. Your current sound choice follows you between videos and through feed Refresh.

Cursor pagination, deduplication, retry, refresh, and protection against stale playback callbacks are implemented. The user confirmed swipe playback, next-video preloading, and live/peak player counts at or below three on the target phone. [Plan 167](../agents/implementation/plan_167.md) records the accepted Expo Go POC and its validation limits. Newly selected cold videos can still show a loading poster. Application authentication is deferred.

## Requirements

- Node 22.21.1, pinned in this directory's `.nvmrc`. The root server's Node configuration is separate.
- Expo Go supporting **SDK 57** on the iPhone. Install Expo Go once on the phone; it can open multiple projects. This project's dependencies are installed separately in `mobile/node_modules`.
- A free Expo account signed into both the CLI on the development machine and Expo Go on the phone when required by the installed Expo Go version.
- An HTTPS API address reachable from the phone and public CloudFront HLS media.

This project uses Expo 57.0.30, React Native 0.86.3, React 19.2.3, expo-video 57.0.5, and AsyncStorage 2.2.0, with exact resolved dependencies in `package-lock.json`. AsyncStorage's Expo Go-compatible version was selected by `expo install` using the installed SDK's module map. SDK 57 was chosen because Expo's [project setup instructions](https://docs.expo.dev/get-started/create-a-project/) recommend it for physical-device Expo Go during the SDK 58 transition as of October 17, 2026. If the installed Expo Go reports a version mismatch, confirm its supported SDK before changing dependencies.

The device target is iPhone 17 Pro Max running iOS 26.6.2 with Expo Go 57.0.9. The user confirmed initial launch, playback, swiping, the ten-minute manual lifecycle/audio checks, saved startup sound, current mute surviving Refresh, icon removal with CC still working, and fully-offline feed error/reconnect/Retry playback. Normal Wi-Fi and mixed cellular reports both show prepared-frame p95 around 122 ms and peak three players. Some diagnostic exports are compact or clipped; the ten-minute run has no separate resource export, and no native memory profile is claimed. Acceptance applies to this Expo Go POC on the recorded phone; a standalone production build needs its own validation.

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

The app uses the provided `cdn_master` URL and does not guess alternate orientations or public S3 access. Its adapter discards creator email and internal storage/job fields from mobile state. The server still sends those fields; response minimization is separate backend work.

## Checks

Run from `mobile/`:

```bash
npm run typecheck
npm test
npx expo-doctor
npm run check:api
npm run export:ios
```

`check:api` verifies anonymous health/feed access, a second page when a cursor exists, plus one HLS master, variant playlist, media segment, and optional poster. It reads `.env`, prints status and publication IDs without raw feed records or signed URLs, and sends no cookies or credentials. These are checks from the development host; they do not establish reachability from the iPhone's network.

`export:ios` compiles the JavaScript/Hermes bundle under ignored `mobile/dist/`. It verifies the iOS bundle graph without requiring Xcode, signing, or a physical device. It does not build an installable iOS app or prove native playback.

The automated tests cover configuration validation, feed field mapping/minimization, malformed responses, publication identity, overlapping pages, cursor cycles, retry, refresh cancellation, playback ownership, stale callbacks, mute/pause state, and paging with or without momentum. Pool tests exercise a 40-video feed, the three-player cap at every allocation, prepared-player reuse, failed preloads, background cleanup, and listener disposal. Diagnostic tests cover timing, incomplete/error samples, resource totals, and bounded history. Preference tests cover delayed hydration, next-launch persistence, temporary mute across refreshed coordinators, serialized saves, failed/corrupt storage, and applying sound before the first native play request while keeping neighbors muted.

From the repository root, `npm run build` verifies the existing backend still compiles. All mobile install/build commands operate in the mobile package; root dependencies and build scripts are unchanged.

## iPhone checks

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

In Expo's development preview, long-press **Global** to see live/peak player counts, transition/error counts, unexpected-playback count, and prepared first-frame p95. **Share report** exports compact JSON with aggregate metrics, the last ten error/unexpected-playback records, and the latest five transitions. It explicitly counts omitted details. This avoids the clipping observed when forwarding long reports. **Share full report** includes the complete retained transition/event history. Both use the iOS share sheet. Diagnostics send no application API requests and contain no raw media URLs, credentials, or creator details. The hidden entry and progress sampling are disabled in release execution.

The report records monotonic selection-to-first-frame timing separately from playing/progress evidence, preserves incomplete/failed/interrupted transitions, and separates initial-load samples. The displayed transition count includes the initial selection: one immediately after reload is expected, and prepared first-frame p95 has no samples until a prepared destination is selected. It retains up to 200 transitions and 1,000 events while keeping cumulative allocation/release totals; discarded history is counted explicitly. A separate ten-record issue history prevents progress updates from evicting every error or unexpected-playback detail. New unexpected-playback records include the selected publication and eligibility state; the coordinator pauses the affected player immediately. Such a record needs investigation and does not establish that overlapping audio was audible.

For a normal-swipe sample, reload the Expo project to start a fresh diagnostic run, stay on Wi-Fi, and spend at least two seconds on each video before swiping forward. Capture at least 30 forward transitions, using the app's **Refresh** if the available list is shorter. Feed Refresh preserves the diagnostic run and adds another initial selection; reloading Expo resets it. Confirm the diagnostic transition count starts at one before each separate run. Share the report before mixing in rapid swipes or background tests. Run those as separate samples and label network/device conditions. The user's stable-Wi-Fi report records 31 prepared swipes with p95 122 ms and a 100 percent normal preparation rate; its attachment was truncated, limiting independent full-row verification. Mixed-direction/rapid/cellular runs retain their cold and incomplete samples; their lower preparation rates are not compared to the forward-only Wi-Fi target.

For the Phase D resource check, try normal and rapid swipes, then background/foreground and Refresh repeatedly. Long-press Global to confirm live/peak players stay at or below three and that errors/overlapping audio do not accumulate. A zero-leak native-memory claim requires platform profiling beyond these ownership counters.

## Troubleshooting

- **Project incompatible with Expo Go:** Confirm the phone's supported SDK. This is an SDK 57 project; installing dependencies in another project does not change it.
- **QR code cannot open the project:** Keep Metro running, use the tunnel on remote hosts, and check Expo CLI/phone account alignment. Tunnel URLs can change after restarting.
- **Feed cannot load:** Open the API `/health` address in Safari on the phone, run `npm run check:api`, and confirm the configured HTTPS origin serves this backend.
- **Video stays on its poster:** Check CloudFront reachability on the phone and retry. The app shows recovery controls after a startup error or timeout. Collect the device result before changing codecs or encoding profiles.
- **Concern about URL expiry:** The current public feed supplies unsigned HLS playback URLs and signed poster URLs. Retry recreates the player with the same loaded playback URL; it does not fetch fresh feed URLs. Current host checks establish reachability, not the cause of an earlier phone-network failure. Use the compact report's issue details when investigating repeat stalls.
- **No videos available:** Only published public-feed entries are included. Refresh after publishing material. Missing or invalid video URLs remain unavailable cards that can be swiped past; failed pagination offers retry while preserving loaded videos.
- **Native testing from Linux:** Use Expo Go on the physical iPhone. A local iOS simulator or Xcode build requires macOS; a successful bundle export is not a simulator test.

## Implementation boundaries

`src/api/client.ts` owns anonymous HTTP requests and has a header-provider extension point for future authentication. `src/feed/adaptFeed.ts` converts unknown API data into the stable mobile item shape. `FeedStore` owns cursor paging, cancellation, merging, and refresh sessions; the hook exposes it to the native screen. The playback coordinator owns the bounded native preload window, releases obsolete entries before allocation, and ignores callbacks from released sources or earlier activations. HLS loading uses `replaceAsync`. Diagnostics are device-local development support.

No application account, privileged API request, database change, persistent feed cache, or production viewing analytics is introduced by this increment.
