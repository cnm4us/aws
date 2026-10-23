# Native component checks

Run from `mobile/` with the pinned Node version and installed lockfile:

```sh
npm run test:ui
```

The harness bundles actual application components, stores, navigation handlers and playback coordinator with esbuild. React's test renderer executes component hooks/events. The installed StackRouter handles real navigate/replace/pop/back actions; only its native screen host is controlled. Native view primitives, AVPlayer, device storage/network/access ports and layout measurements are controlled inputs. Internal preview and ordinary Release run with `__DEV__` false. Temporary bundles are removed after import. No private fixture, credential or previously prepared `/dev/shm` renderer installation is required.

The caption-loading test uses Node’s controlled timers and actual CaptionLayer/TextResources to distinguish quick loads from delayed feedback, preserve immediate cues/error/retry, and cancel hidden/replaced/unmounted loads. Node reports its MockTimers API as experimental.

These checks cover control actions, saved preference owners, menu identity and storage failures, stale actions, one Feed route, caller/journey preservation, Refresh once, selected-player captions, pause, focus/background, resize handling and player/listener cleanup. Layout cases include narrow widths and accessibility font scales, but React's renderer does not calculate iOS text geometry or prove native transition timing. Physical layout, keyboard, sound, native Modal behavior and the signed app remain separate acceptance checks. React emits a deprecation notice for its test renderer; the host harness is deliberately bounded to component behavior, with iPhone testing retained.
