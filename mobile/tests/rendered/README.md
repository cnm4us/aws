# Native component checks

Run from `mobile/` with the pinned Node version and installed lockfile:

```sh
npm run test:ui
```

The harness bundles actual application components, stores, navigation handlers and playback coordinator with esbuild. React's test renderer executes component hooks/events. The installed StackRouter handles real navigate/replace/pop/back actions; only its native screen host is controlled. Native view primitives, AVPlayer, device storage/network/access ports and layout measurements are controlled inputs. Internal preview and ordinary Release run with `__DEV__` false. Temporary bundles are removed after import. No private fixture, credential or previously prepared `/dev/shm` renderer installation is required.

The account-validation cases run actual AuthStore, FeedScreen, captions and coordinator with a controlled pending verifier in ordinary Release/internal preview. Public Global keeps paused/playing video and cues during a pending check; failed checks and covered screens hide/pause content.

Protected-renewal cases use the real useSpaceAccess and AccessGuard with controlled native/HTTP ports. They advance a monotonic clock and real product timers through differing app/space ages, quiet paused/playing renewal, hanging response expiry, late success,401/503, Retry, covered/background returns and context/sign-out invalidation. The simulated provider interval calls the same routine-validation entry point as AuthProvider. Native rendering/media and real network enforcement remain separate signed-phone/API gates.

Caption/story cases advance actual component/resource timers through quiet renewal, original cache age, hard protected expiry, failure/denial/Retry, and hidden/replaced cancellation. They also cover delayed initial caption feedback and public Global cue replacement. Node reports MockTimers as experimental.

Plan173 also exercises the actual Launch chooser, navigator, strict feed loader and existing player coordinator: exact-target entry, missing-target rejection before activation, paused Global/space/Creator return, Refresh anchor consumption, source-unavailable invalidation and stale auth/API-origin callbacks. Its network and native media ports remain controlled; real database/auth/API and signed iPhone behavior are separate gates.

These checks cover control actions, saved preference owners, menu identity and storage failures, stale actions, one Feed route, caller/journey preservation, Refresh once, selected-player captions, pause, focus/background, resize handling and player/listener cleanup. Layout cases include narrow widths and accessibility font scales, but React's renderer does not calculate iOS text geometry or prove native transition timing. Physical layout, keyboard, sound, native Modal behavior and the signed app remain separate acceptance checks. React emits a deprecation notice for its test renderer; the host harness is deliberately bounded to component behavior, with iPhone testing retained.

Plan174 adds actual navigator/feed/Comments interaction coverage: Global issues no engagement reads, Like does not gate playback, Comments preserves playing/manual-pause position on return, keyboard dismissal, Comments versus Feed routine-validation ownership, healthy draft renewal, background clearing, denial/recovery and pending Send after close/sign-out. The list port now renders header/footer/empty content; access Retry tests select the covering access message rather than a hidden feed-footer button. Keyboard avoidance and maximum physical geometry still need signed-device checks.

The Plan174 larger-text revision additionally checks the actual transparent-modal options, retention of one paused Feed/video surface, opaque checking/inactive/background/denied states, quiet authorized translucency, square accessible icon-only Close, and scrolling count/sort plus stacked Send controls at a controlled320-point width/1.6fontScale. These structural assertions do not calculate native text layout; the signed iPhone recheck remains required.

The subsequent count/sort revision verifies the centered count label for Newest, Oldest label for the oldest order, checked overlay choices, actual order-specific requests and list order, cancellation/outside/system dismissal without a request, retained draft, disabled selector during Send, quiet renewal while open, and popup removal on background/access loss/sign-out. The current verified scrim is80% black; physical overlay geometry still needs iPhone acceptance.

Plan175 adds actual Creator-profile Follow coverage: Global/personal absence, exact captured tap context across a Launch/personal detour, confirmed group/channel state/count, self count/no writes, playing/manual-pause return, quiet account-verification ownership, background/denial/recovery and pending-write close/sign-out. These controlled native-port tests do not qualify physical text geometry or server session revocation.

Plan175 revision adds selected-video Follow/profile reconciliation, one feed account-renewal owner, pending/uncertain/background/expiry cases, plus Launch transparent-modal/one80% scrim, source creator and per-space descriptions, fixed Close, covered-Feed input/accessibility isolation and paused/playing return checks. Native video compositing and actual font geometry still require phone observation.

The avatar Follow revision checks gray/yellow/green precedence, plus-only feed writes, profile Unfollow and refocus reconciliation, separate44px hit areas, self/Global/personal absence and neutral background/denial/expiry/uncertain states. Elsewhere state is supplied in the same selected-publication request; no preloaded creator requests or duplicate account timer. Color and native geometry still require signed-phone observation.

Global recognition additionally exercises yellow/no plus after contextual Follow, gray after the last contextual Unfollow and return, profile entry without a Global Follow card, selected-only read requests, neutral background/expiry/error, ignored late creator response, continued public playback and anonymous/personal absence. These remain controlled native-port cases; signed-phone color/return observation is separate.

The navigation-performance revision runs the actual feed loader together with the access hook: one selected-source prepared Launch list, one initial account/feed authorization, exact-media player transfer with manual pause/time retained, fresh Global return, protected denial and background during a pending entry. Different media still loads normally. Native AVPlayer reattachment/frame presentation and measured phone latency require the signed build23 observation; controlled ports establish ownership and request counts.
