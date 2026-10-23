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
