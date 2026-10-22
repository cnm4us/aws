# Plan 171: Bundled internal iPhone viewer

Status: Complete

Created: 2026-10-22

Planning and implementation authorized by the user on 2026-10-22. Phases A–F are Complete for the recorded bundled internal iPhone milestone with explicit coverage limits. The final stable-Wi-Fi/CC-on report and visible behavior pass. Metro/tunnel remain stopped. This plan brought forward bundled internal distribution and completed Plan 170's remaining story/caption acceptance on the embedded Release build; both milestones are Complete.

## Feature Reference

- Roadmap: [Native viewing](../roadmaps/roadmap_native_viewing.md).
- Foundation: [Plan 168](plan_168.md), signed-in viewing; [Plan 169](plan_169.md), creator/personal-feed return.
- Included implementation and completed acceptance: [Plan 170](plan_170.md), stories/captions, A–F Complete with recorded limits.
- Content/access invariant: [Feature 02](../features/feature_02_personal-space-global-feed-context-integrity.md).
- Current setup: [Mobile README](../../mobile/README.md) and [EAS configuration](../../mobile/eas.json).

## Context

The installed Video Viewer is a signed development client. It still downloads JavaScript from Metro on this host through the Expo/ngrok `exp.direct` tunnel. A lost development connection has interrupted phone acceptance. The user wants an installed native app that launches directly and asks whether removing the tunnel will improve occasional loading indicators.

Inspection separates three connections: Metro supplies development JavaScript/tooling; `https://aws.bawebtech.com` supplies accounts, feeds, access checks and text; `https://videos.bawebtech.com` serves CloudFront media. The native player receives HLS URLs directly. Removing Metro is a concrete reliability improvement for app startup/reload, but does not establish the cause of earlier media buffering or eliminate API access-verification indicators.

### Inspected starting point

| Area | Current evidence | Consequence |
| --- | --- | --- |
| Build profiles | `mobile/eas.json` has `development` with `developmentClient: true`, internal distribution and the HTTPS API, plus an inherited simulator profile. | Add a separate internal preview profile using a Release configuration and embedded JavaScript. Keep development available. |
| App identity | Expo project `05dcc3ca-6946-490f-af82-9b3acfe3212c`, owner `mbcollins2`, bundle ID `com.bawebtech.videoviewer`, version `0.1.0`; accepted development binary was build 1. | Reuse the linked project and identity; inspect latest actual EAS build number before choosing the next number. |
| Toolchain | Mobile `.nvmrc` is `22.21.1`; Expo SDK 57, React Native 0.86, `expo-video`, `expo-secure-store`, AsyncStorage and `expo-dev-client` are installed. Previous build used EAS CLI 25.2.0. | Keep the pinned SDK/lockfile and mobile Node version. Verify CLI compatibility before upload; avoid incidental upgrades. |
| Upload boundary | Root `.easignore` allowlists mobile source/config/assets and excludes local environment files, credentials and evidence. | Inspect the actual outgoing archive; the old README's file count predates Plan 170. |
| Diagnostics | `developmentDiagnostics`, report entry, native progress sampling and diagnostic clock interval currently depend on `__DEV__`. | A normal Release preview loses the reports needed for acceptance. Add explicit internal-build diagnostics without enabling development mode. |
| Captions | Plan 170 already adds a selected-player product clock independent of diagnostics, including controlled `__DEV__`-false tests. | Verify on the bundled iPhone and also retain diagnostics-off host coverage; reports must not make captions work accidentally. |
| Source state | HEAD `49e8dd6`; Plan 170 source and docs are uncommitted, plus a prior Plan 169 continuity note. | Include the reviewed working implementation deliberately. HEAD alone cannot identify the binary; retain a private source/archive manifest. No automatic commit or push. |
| Acceptance | User confirmed captions follow speech and hide/reappear across story expansion/collapse. Playback recovered after a development connection notice. | Reuse these observations; finish outstanding Plan 170 F checks in the bundled app and distinguish build-specific confirmation. |
| Host capacity | Inspection shows about 2.7 GB free on root and 2.6 GB available in `/dev/shm`. | Check capacity again before export/archive/build; scope temporary work and avoid deleting projects or broad caches. |

These are source/configuration observations, not a signed-preview build or physical Release pass. No EAS account/signing state was changed or build submitted during planning.

### Scope and boundaries

In scope: preview build configuration, safe build identity/provenance, bounded internal playback diagnostics, archive/config/export checks, signed ad hoc iPhone build/install, direct launch without Metro, targeted bundled-runtime regression checks, remaining Plan 170 acceptance, performance evidence and a recovery/update runbook.

Out of scope: TestFlight/App Store submission, new public release, Android/tablet support, Expo SDK/React Native upgrades, EAS Update/OTA rollout, subscription/payment work, crash-reporting vendors, production analytics, offline downloads, backend deployment changes, media re-encoding, CDN changes and private-media authorization. Existing public HLS delivery remains an explicit later release boundary. VoiceOver remains deferred at the user's request.

## Locked Decisions

1. **An internal Release preview is the new acceptance app.** Add `preview` with `developmentClient: false`, `distribution: internal`, `environment: preview`, mobile Node `22.21.1`, iOS Release configuration and explicit public API value. It must contain embedded JavaScript and launch directly. Do not use a Debug build with a hidden development menu as a substitute.
2. **Reuse the existing app identity.** Keep the Expo project, app name and `com.bawebtech.videoviewer`; the preview replaces the installed development client. This avoids a second identity/signing/storage namespace for this milestone. Inform the user before installation; install over the existing app first. Do not require uninstalling or resetting its data. Verify session/preferences after upgrade rather than promise retention. A separately named development variant can be planned later if simultaneous installation becomes useful.
3. **Preserve the development route.** Keep `development` and `simulator` working. Retain `expo-dev-client` for developer builds; verify that the preview artifact has no development-server launcher. Source edits reach the preview only through another signed build/install in this milestone. No automatic remote update dependency is added.
4. **Configuration is explicit and fail-closed.** API remains `https://aws.bawebtech.com`; build-mode and diagnostic flags are public configuration, never credentials. Use direct static `process.env.EXPO_PUBLIC_*` reads compatible with Expo substitution. Unknown/missing internal mode or non-exact flag values disable preview diagnostics. Never route API/HLS through Metro as a workaround. Review the selected EAS environment for conflicting configuration without printing secret values.
5. **Diagnostics are an internal-build choice, independent of `__DEV__`.** Proposed values are `EXPO_PUBLIC_VIEWER_BUILD_KIND=internal-preview` and `EXPO_PUBLIC_VIEWER_DIAGNOSTICS=1` only on `preview`. Centralize a predicate equivalent to development mode OR the exact internal-preview opt-in. Default non-development execution has no diagnostic collector, hidden report action or diagnostic-only progress listener. A public flag is not an authorization control; reports contain no privileged content and grant no server access.
6. **Keep existing report semantics and budgets.** Reuse bounded transition/event/issue history and source-load/readiness timing. Preserve the existing JSON fields; add an optional allowlisted build identity envelope to compact and full reports: build kind, app version/build, source/archive identifier and diagnostics mode. No credentials, user/creator names, story/cue text, arbitrary errors or raw API/media URLs. Reports remain memory-only and leave the device only through explicit Share. No automatic upload, native frame polling or extra player is introduced.
7. **One clock owner remains.** The same diagnostic predicate controls diagnostic interval/progress subscriptions and report access. `createCaptionClock` remains the sole adapter owner of interval changes, restores the correct diagnostic baseline on unsubscribe, and still works with diagnostics disabled. Preserve the three-player budget, selected-only playback, source startup deadline, checkpoint restoration and release cleanup.
8. **Build evidence identifies what was uploaded.** Record git HEAD plus the reviewed dirty source/archive digest, resolved non-secret configuration, dependency lock hash, CLI/Node, EAS build ID, app/build version and artifact metadata. Select an iOS build number above the actual latest build; use one documented versioning strategy without mixing local/manual and remote counters. Internal profile identity is visible in reports so successive binaries are distinguishable.
9. **Signing is scoped to this app and device.** Verify the existing registered iPhone and credentials. Reuse valid signing material without revoking shared certificates or changing unrelated projects. If Apple login/2FA is needed, the account holder completes it privately in the terminal; credentials never enter chat, manifests or reports. A changed device list requires a provisioning check before rebuilding.
10. **Plan 170 acceptance transfers, rather than disappears.** Plan 170 F remains In Progress until its remaining gates pass. Record the bundled build ID in both plans, retain earlier evidence, and revise Plan 170's development-only acceptance wording to name the actual bundled runtime. Do not infer all tests passed from the first two caption/story observations.
11. **Treat spinner types separately.** A development connection failure, feed/access-verification wait, optional caption/story load, HLS startup/rebuffer, and all-controls freeze need different evidence. The baseline versus preview comparison is observational, not a controlled proof of tunnel causation. Preserve cold/error/interrupted samples and user-visible delays even when first-frame metrics are fast.

## Phase Status

- A: Complete — build configuration, identity and provenance
- B: Complete — internal diagnostics and release-mode isolation
- C: Complete — host, archive and export gates
- D: Complete — signed build and direct iPhone installation
- E: Complete — independence, bundled behavior and remaining text acceptance with recorded limits
- F: Complete — playback evidence, handoff and documentation with recorded limits

## Phase A — Build configuration, identity and provenance

Goal: define a reproducible bundled preview without disturbing the development build or credentials.

- [x] Recheck source status, mobile Node/lockfile, installed CLI capabilities, local disk and EAS project/build metadata. Read-only signing/device inspection only; no certificate regeneration as a routine first step.
- [x] Add the preview profile with the locked settings and public environment. Keep existing profiles functional and avoid inheriting `developmentClient: true` accidentally.
- [x] Resolve version/build and build/source metadata through the smallest supported config path. Keep app.json static unless a small `app.config.ts` wrapper is needed; if so merge existing settings/plugins/project metadata rather than replace them. Do not depend on importing undeclared transitive packages for version information.
- [x] Plan the source identity from a deterministic digest over reviewed mobile inputs, excluding the generated identifier itself, environment/credential files, node_modules and evidence. Keep complete file hashes private; embed only an opaque non-secret identifier. Record later EAS build ID externally if unavailable at bundle time.
- [x] Audit the upload allowlist for any new build inputs; retain strict exclusion of secrets/backend/web packages. Record replacement/storage expectations and the previous development-build install link for recovery.

Test gate: parse EAS/app config, resolve preview and development separately with the supported pinned CLI/config tools, verify API/project/bundle ID/version/plugins/Release mode, validate source digest reproducibility and absence of secrets. Confirm no EAS Update configuration or native capability change was introduced. Use dry/read-only resolution before any cloud submission.

Acceptance: reviewed config selects an embedded Release preview; its identity/source are distinguishable; existing development configuration remains usable. No installation or build success is claimed here.

## Phase B — Internal diagnostics and release-mode isolation

Goal: preserve useful local evidence in the preview while proving ordinary Release behavior remains independent.

- [x] Introduce one build-mode/diagnostics policy module and replace the scattered development-only gates in the collector, FeedScreen report action and native adapter. Rename development-specific exports/comments where their meaning expands.
- [x] Keep the existing long-press feed-title → Share report / Share full report path in the internal preview. Add an explicit Reset diagnostics action for a fresh sample without Metro Reload; retain active session/context/player counts correctly. Reset must not reload the feed, seek video, alter sound/CC, lose active load association or make counters negative. Use the existing bounded collector or a tested epoch boundary; do not simply discard live ownership state.
- [x] Add validated optional build metadata to both report forms and the local diagnostics dialog. Reject unexpected metadata keys and bound string lengths. Add a modest build/version display in Settings only if reports alone do not let the installed binary be identified; keep technical detail out of ordinary viewing controls.
- [x] Preserve the 250 ms diagnostic baseline only where enabled. Caption subscription/removal must restore that baseline in internal preview and zero in ordinary Release, with no listener growth across rebindings, backgrounding or disposal.
- [x] Retain useful sanitized error/domain/code and startup/source timings. A frozen app cannot export its own report: document iPhone analytics/crash-log collection from the device as a separate fallback, with a Mac/Xcode trace only if available. Do not add a new crash vendor or claim complete native tracing from Linux.

Test gate: meaningful policy matrix for development, internal-preview opt-in, unknown/missing/malformed flags and ordinary Release; bounded metadata/privacy contract; Reset with active players/source load and feed Refresh; rendered report access with `__DEV__` false. Exercise the actual adapter/CaptionLayer with diagnostics on and off to verify clock independence, teardown and unchanged startup/pause behavior. Then mobile `npm test` and `npm run typecheck`.

Acceptance: internal preview exports comparable reports and can start a clean sample; ordinary Release has no diagnostic-only work or entry. Captions and playback function in both modes.

## Phase C — Host, archive and export gates

Goal: catch configuration, upload and bundled-runtime regressions before spending a signed cloud build.

- [x] Run mobile tests/typecheck and preview-configured production iOS export with the exact API/build flags intended for EAS. Use the mobile Node pin, isolated task cache/output and available storage. Keep logs under ignored evidence paths.
- [x] Inspect resolved native config and the actual EAS upload archive using the pinned CLI's supported inspect/archive command. Verify all current Plan 170 resources/config are present; no local credentials, `.env`, test evidence, backend packages or development cache is uploaded. Record actual count/size/digest.
- [x] Inspect exported artifacts/config for intended API/build identity and embedded Release bundle. Recognize that package strings alone cannot prove a native artifact has no development launcher; retain that check for D/E.
- [x] Re-run focused caption clock, saved preference, authorized text/profile-return and coordinator integration checks affected by the gating changes, including `__DEV__` false and diagnostics disabled. Reuse Plan 170 backend/browser evidence if no backend/browser source changes.
- [x] Review source diff, dependency/config changes, local doc links and credential exclusion. Run agent-docs check and separate pre-existing findings from new failures.

Proposed gate commands, finalized against the installed CLI during execution: `cd mobile && npm test`, `npm run typecheck`, preview-configured `npm run export:ios`, `npx eas-cli@25.2.0 config --platform ios --profile preview`, and an EAS `build:inspect` archive operation with task-scoped output. The production export must set preview environment values explicitly; local `mobile/.env` alone is not cloud configuration.

Acceptance: passing mobile and focused integration checks, resolved preview config and complete secret-free archive. A successful JavaScript export establishes neither iOS compilation nor signed installation.

## Phase D — Signed build and direct iPhone installation

Goal: deliver a traceable Release preview to the registered iPhone.

- [x] Submit the reviewed working snapshot using the validated CLI: from `mobile/`, `npx eas-cli@25.2.0 build --platform ios --profile preview`, with task cache/TMPDIR sized for the host. Never submit through TestFlight/App Store or add `--auto-submit` in this plan.
- [x] Track the EAS build ID/status and logs. Complete Apple account interactions privately only if required. Verify provisioning includes the intended registered iPhone; do not expose its full identifier in public reports.
- [x] On success, retain install page/artifact link, build/source identity, resolved settings and signing expiry in private evidence. Inspect available artifact metadata for Release configuration and embedded JS; include native crash symbols if EAS makes them available.
- [x] Give the user the direct install link and a clear statement that it replaces the development client. Install over the existing app; record whether saved session, CC and startup-sound settings survive. A missing session may require sign-in but must not restore the wrong account. No destructive reset as the first recovery action.
- [x] Open from the home-screen icon and confirm the reported build identity. There should be no development-server discovery, QR requirement, development menu or dependency on the old launch link.

Test gate: EAS build finishes successfully, correct signed artifact installs on the intended device, expected build metadata matches the manifest, app opens its native UI. No simulator/local-Xcode success is claimed from Linux. If provisioning/install fails, retain exact error and repair this app's configuration without revoking shared credentials.

Acceptance: user has the intended bundled Release preview installed and usable. Cloud-build success alone does not complete this phase.

## Phase E — Independence, bundled behavior and remaining text acceptance

Goal: demonstrate independent code loading and finish targeted runtime checks on the actual binary.

Use short grouped observations with prepared fixture instructions; do not repeat earlier generic five/ten-minute runs. Keep credential display in the existing private terminal mechanism. Preserve already-passed observations in Plan 170 and explicitly record what is newly checked on Release.

| Protocol | Expected result / evidence |
| --- | --- |
| Metro independence | After install, stop only this project's Metro/tunnel, keeping backend/API/media available. Fully close/reopen from the icon on Wi-Fi. Global and authorized feeds play; stories/captions work without reconnecting to a development server. Record stopped process/service and reopen result. |
| Offline code startup | Fully close app, enable Airplane Mode with Wi-Fi off, then reopen from icon. Embedded UI opens and shows recoverable network/access state; no development-server error. Protected cached content/audio stays hidden. Reconnect and recover in the same valid account. This is an offline shell check, not offline media support. |
| Identity and persistence | Confirm normal sign-in, same-account secure restore after close/reopen, expected Spaces and one account switch without stale protected content. Explicit offline Sign out → reconnect → reopen stays anonymous. Device CC/start-sound settings persist independently of identity. |
| Story/caption controls | First captioned fixture: CC/speech and loop/pause behavior, scroll a long expanded story without triggering video pause, collapse and resynchronize. Manually paused video remains paused through expansion. No-caption item remains playable. Record qualitative sync and tested larger-text range/control reachability. |
| Creator return | With CC on, pause a recognizable original video; creator → authorized personal feed → Back to profile → Back returns to original publication/time, still paused and showing its cue. Sound/CC remain consistent and no text/audio overlaps. |
| Covered/background states | One Account/Settings round trip and background/lock cycle stop hidden audio and conceal captions/story. Return after current access checks; intentional pause survives. Brief access-verification UI is measured separately from HLS readiness. |
| Scoped access and expiry | Use Plan 170's guarded disposable access driver only after user confirms the selected personal fixture is playing. Denial stops video/audio and clears protected text while identity remains valid; restore plus Retry recovers without login. Expire only the bound fixture session and foreground: anonymous Global, Account sign-in, Spaces gated, no protected Back resurrection. |
| Resource/connection recovery | Offline protected profile return remains blocked until verified online. Missing/malformed/oversized text, late responses and storage failures retain host coverage; ask for phone recovery only when a real supported fixture exists. Optional caption errors must not freeze video controls. |

Test gate: user observations on the installed build plus internal reports and host-controlled edge cases, cross-referenced to Plan 170 F. For fixture access changes follow `.codex-local/plan170-device-access.cjs` status/prepare/deny/restore/expire/finish safeguards; inspect current state first rather than assume the earlier prepared session count. Restore only fixture-owned grants and revoke bound test sessions; leave normal accounts untouched. No fixture password in reports/chat.

Acceptance: direct and offline-shell startup are independent of Metro; product/auth/text/journey/lifecycle behavior passes on Release; remaining Plan 170 F functional rows have an explicit pass, host-only limit or user-accepted exception. Whole-app freezing stops further phone tests and opens focused native-error investigation; do not ask repeated reproductions or call it fixed based on a reload.

## Phase F — Playback evidence, handoff and documentation

Goal: establish a clear bundled baseline, close the current text milestone and make future updates predictable.

- [x] After functional acceptance, use Reset diagnostics and confirm clean transition/issue counters with accurate live-player ownership. Collect one stable-Wi-Fi forward-only sample with CC on, at least two seconds playing per video and at least 30 normal prepared transitions. Use feed Refresh if needed; avoid profile detours, rapid reversals and backgrounding in this sample.
- [x] Gate: prepared first-frame p95 <=150 ms, normal preparation rate >=90%, peak players <=3, zero errors/incomplete normal transitions, zero unexplained unexpected playback and no freeze. Retain all initial/cold/interrupted records; confirm playing/progress evidence as well as frames. An interrupted or nonconforming run is labeled, not selectively edited to pass.
- [x] Record visible spinner frequency/estimated duration separately from first-frame timing. Compare with the accepted Plan 169 development sample (40/40 prepared normal, p95 120.38 ms, peak three) and Plan 170 evidence under known network/device/source conditions. Describe improvement/regression without inferring that Metro caused HLS waits. If the gate fails, inspect source-load/readiness/error evidence before changing player policy, CDN or encoding.
- [x] Report is from an instrumented Release preview. Preserve diagnostics-off host gates and explicitly defer uninstrumented store-build performance/native-memory qualification. First-frame/ownership counters do not prove smooth motion, caption timing, absence of native leaks or store readiness.
- [x] Finish Plan 170 F when its functional/numerical gates and fixture cleanup are satisfied. Update its runtime wording and link the actual preview build and evidence rather than claim an independent development-only run happened.
- [x] Update mobile/root README as applicable, native roadmap and plan index: direct installation/start, retained development workflow, included API environment, diagnostics/reset/share, build identification, replacement/storage behavior, signing/device limits and next update procedure. Use [README maintenance policy](../readme_maintenance.md) for root changes.
- [x] Document recovery: retain current successful preview install link and previous development link; return to development only if debugging requires Metro. A future source change needs a new preview build/install, with a fresh build/source identity. Provisioning renewal and new-device registration are explicit distribution tasks. No automatic app-data deletion or certificate revocation.

Test gate: recorded phone protocols and numerical report; fixture cleanup status; mobile checks rerun only for new code changes; doc links/whitespace/privacy check and agent-docs comparison. Evidence under ignored `tests/runs/device/plan_171/` and `tests/runs/build/plan_171/`, with Plan 170 evidence referenced rather than duplicated. No commit or push unless requested.

Acceptance: traceable installed preview works with Metro/tunnel stopped, remaining stories/captions accepted, bundled playback baseline documented, and user has an install/update/recovery runbook. TestFlight/public-release completion remains separate.

## Expected File Impact

| Area | Expected changes |
| --- | --- |
| Build configuration | `mobile/eas.json`; `mobile/app.json` or a small dynamic wrapper if required; root `.easignore` only for necessary new inputs; mobile package scripts if useful |
| Internal policy/identity | New small module under `mobile/src/config/`; validated report identity fields and a reset boundary |
| Diagnostics and player integration | `mobile/src/diagnostics/development.ts`, `playbackDiagnostics.ts`, `mobile/src/playback/useFeedPlayback.ts`, `mobile/src/feed/FeedScreen.tsx`; Settings only if necessary for build visibility |
| Tests | Focused build-policy/report/reset tests under `mobile/tests/`, existing adapter/clock/coordinator/rendered coverage; no backend schema or authorization changes expected |
| Continuity/docs | This plan, Plan 170, implementation index, native roadmap, mobile README and root README if developer workflow changes |

No new runtime dependency is assumed. Prefer validated build metadata in existing config over a package added only to read a version. If a native dependency is demonstrated to be required, record why and its rebuild consequence before adding it.

## Change Log

- 2026-10-22 — `1dfd494a2021ad7e54d80221b668bffafde91678` — Committed completed native stories/captions and bundled iOS preview implementation, regression tests, build configuration, accepted-device documentation and prior Plan169 continuity note (51 files). A–F remain Complete with recorded limits. Pushed normally to origin/main at the user's explicit request; git ls-remote verifies the remote implementation SHA and local/tracking divergence0/0. This required post-commit delivery record is included in a documentation-only follow-up.

- 2026-10-22 — User explicitly requested commit and push. Reviewing/staging the completed Plan170/171 source/tests/config/docs and prior Plan169 continuity note. Private credentials, fixture state, logs, reports and exports remain ignored. No app source change since the signed/accepted build2; Git handoff will record its resulting SHA after commit.
- 2026-10-22 — A–F Complete for bundled internal build2: user explicitly confirms stable Wi-Fi, CC On/usual size and no spinners/frozen controls/overlapping audio. Final numerical gate passes, docs/review/fixture cleanup complete. Plan 170 also Complete with coverage limits. Metro remains off; API online. UI refinements are deferred; no commit/push.

- 2026-10-22 — F numerical gate passed from the supplied compact build2 report (40/40 prepared normal, p95 126.87ms, peak3, zero errors/incomplete/unexpected playback); source/artifact identity and fixture cleanup verified. Await only run-condition/visible-behavior confirmation before final completion. No code/encoding/CDN changes or buffering-cause claim.

- 2026-10-22 — E Complete with recorded limits: B isolation/no-caption item pass; medium text readable, larger-size button clipping explicitly deferred by user. Both fixture users have zero active sessions; original permission restored. F started for final clean Global/CC-on stable-Wi-Fi report. UI control/header/menu ideas added to roadmap backlog; no product code or new binary change.

- 2026-10-22 — E offline profile error/reconnect and explicit offline logout/restart passed; second offline Back not specifically reported. Scoped read-only cleanup confirms zero active A26 sessions and restored original permissions. Prepared private B27 terminal-only credential helper for remaining isolation/no-caption/larger-text observations; no app source/config changes.

- 2026-10-22 — E expiry reset passed (anonymous Global/session-ended message, Account/Spaces sign-in). Expanded-story recovery was not checked. Guarded finish cleanup completed: original roles restored, session71 revoked, zero active fixture sessions. Requested offline profile-return/recovery and explicit offline logout using a fresh fixture login; separate cleanup required for a new session.

- 2026-10-22 — E restored playback/audio/captions passed after Refresh. Expired only the bound fixture session71 after guarded state verification; original fixture space roles remain restored. Await device expiry behavior and story-recovery clarification before cleanup.

- 2026-10-22 — E automatic denial and lifecycle checks passed. Restored original fixture roles3359/3360 in personal64, kept exact phone session valid, no normal account change. Await recovery observation before scoped session expiry.

- 2026-10-22 — E scoped access denial applied after explicit playing readiness: fixture A26 → personal64 roles removed transactionally, exact phone session bound and left valid. Await observation, then restore with the guarded driver. No normal account/other space/product source changed.

- 2026-10-22 — E creator return observation passed: authorized personal detour restores original publication/time/pause/cue/story without overlap. Read-only fixture status is prepared, original roles 3359/3360 intact and exactly one active fixture session. Requested bundled Account/Settings/background/lock and covered manual-pause observations, then explicit readiness with personal video/CC/sound playing before any denial. No grant/session mutation yet.

- 2026-10-22 — E bundled text observations passed: CC/speech/loop, story expansion/scroll/collapse while playing, manual pause preserved, current-size control/text readability. No code/config/fixture change. Next: creator/personal-feed return with correct restored cue and pause.

- 2026-10-22 — E observation: offline embedded-UI startup and protected concealment passed; Wi-Fi recovery retains the same account without another password. No product source/config, credentials, fixture grants or server changes. Continue remaining text/journey/lifecycle/access gates.

- 2026-10-22 — E observation: Metro-off cold restart, secure same-account restore and freshly saved CC/start-muted persistence passed. No source/config/binary, fixture or server changes. Next: offline embedded-UI startup and same-account recovery.

- 2026-10-22 — D Complete: user confirms installed preview opens Global and plays with no development-server prompt. Previous sign-in/CC/startup sound are not remembered, so upgrade persistence is unverified. E started: scoped Metro PID 301350 and child ngrok stopped; port 8081 closed, API health true/3300 listening. Requested a fresh Wi-Fi restart with same-account and saved CC/start-muted checks. No product source, account or fixture changed.

- 2026-10-22 — Signed preview build FINISHED and artifact verified; direct installation requested. D remains In Progress until physical install/launch is confirmed. E/F and Plan 170 F remain pending phone results. Build/install/update/reset/native-log runbooks updated; no commit/push.

- 2026-10-22 — A–C Complete; D submitted: internal report/build policy, source identity verification, epoch reset and diagnostics-on/off release adapter checks pass. Preview archive 58 files / 442,351 bytes, source `e912143476b62e0a802eec3985058c2bb1982652b6e5feb2ec29e720069e4d0a`. Signed build `7a049a95-613f-4e81-98ee-4c761cc80772` submitted using existing remote credentials. No code commit/push.

- 2026-10-22 — Phase A implemented, uncommitted: preview Release/internal profile with explicit flags/API/Node, local iOS build 2 (latest EAS build is 1). Static app config retained; a Node-only prepare/export/build wrapper embeds a deterministic reviewed-input stamp, and the EAS pre-install hook rejects mismatched source. No runtime dependency or native capability added. Phase B implementation started.
- 2026-10-22 — Planning only, no implementation commit: inspected build/source/upload/diagnostic paths and outstanding Plan 170 acceptance; checked official Expo references; chose an internal Release preview reusing the app identity, explicit internal diagnostics, source provenance and grouped iPhone gates. Linked plan/index/roadmap and preserved all product changes.

## Validation

- Git commit gate: staged exactly 51 intended files; whitespace, 53 local links and nine private fixture-value exclusion checks passed. Current included mobile inputs match accepted build2. No product source changed after 147-mobile-test/typecheck/export and phone acceptance. Agent-docs checker retains only its same 16 unrelated older-plan findings. Implementation commit `1dfd494a2021ad7e54d80221b668bffafde91678` pushed and remote HEAD verified; divergence0/0. Existing GitHub CLI authentication supplied through the command-scoped credential helper; no credential material entered the commit. Root README already documents committed developer workflows, so no additional post-commit README change is needed.

- Completion review passes: 51 touched/new source/doc files, 53 local Markdown links, no whitespace or fixture-credential matches, both Plans170/171 Status Complete and A–F Complete. The broad agent-docs checker retains only its same 16 pre-existing older-plan findings. Current included mobile source matches the signed artifact and final phone report. No new application source, test rerun or binary build was needed for final observation/document updates.
- Final conditions/visible behavior confirmed by user: stable Wi-Fi, Captions On, usual text size, no spinners, frozen controls or overlapping audio. Together with 40/40 prepared normal transitions/p95 126.87ms/peak3 and zero recorded errors/incomplete/unexpected playback, this closes the bundled milestone gate. Evidence `tests/runs/device/plan_171/final-forward-conditions-observation.json`; full scope matrix `tests/runs/device/plan_171/acceptance-matrix.md`. Known readability/physical-sampling/profiling limits remain. Recorded device baseline from Plan167 is iPhone17 Pro Max/iOS26.6.2; OS/model were not re-reported in this final run. Fixture A26/B27 active sessions zero, original roles restored; no normal account changes.

- Final documentation/privacy review passes for 51 touched/new source/doc files, 53 local links, whitespace, phase consistency and zero matches for the two private fixture passwords. Agent-docs checker still has the same 16 unrelated older-plan findings. See `tests/runs/build/plan_171/final-review.json` and `tests/runs/device/plan_171/acceptance-matrix.md` for explicit physical versus host coverage. No tests were repeated for documentation-only updates; source identity remains the tested/signed build2 identity.
- Final bundled forward report numerically passes: build2/source `e912143476b62e0a802eec3985058c2bb1982652b6e5feb2ec29e720069e4d0a`, resetCount2; 41 selections/frames, 40/40 normal prepared, normal/prepared median105.39ms / p95 126.87ms / max154.29ms; one initial/cold frame483.56ms; zero errors/incomplete/issues/unexpected playback; live/peak3. Reset ownership balances carried3 + allocations41 - releases41 = live3. Latest five normal rows all show playing/progress evidence and no interruption; compact export omits36 transition details, no dropped transitions/events. Evidence `tests/runs/device/plan_171/final-forward-compact.json` and `final-forward-evaluation.json`. Exact build/source identity matches signed IPA and current mobile inputs. Stable-Wi-Fi/CC/usual-size and visible spinner/freeze/audio confirmation requested; no new run/full report. F remains In Progress pending that confirmation and final handoff.
- Final cleanup verified read-only: A26/B27 have zero active sessions, original A26→personal64 roles3359/3360 restored, access driver phase complete. Metro8081/tunnel stay off; API3300/public health remain online. No cleanup mutation or product code change for this report.

- Final bundled functional observations: B identity/space isolation passed (Text test B/personalB; A-only origin absent). Second non-captioned video plays with no CC control or old cue. Medium-size readability passes; some buttons unreadable/clipped at larger sizes. User says UI changes need not happen now, so this is an explicit current-milestone limit and deferred UI refinement, not a full large-text pass. Read-only query after requested logout finds zero active sessions for A26 and B27, original fixture roles restored; no further revocation needed. Evidence `tests/runs/device/plan_171/isolation-no-caption-readability-observation.json`. B-specific Spaces logout prompt was not separately stated; existing offline logout UI and zero server sessions are recorded without inventing a new observation.

- Bundled offline-return observation: Back to profile shows “Cannot load profile / Try again”; reconnect recovers the feed under the same account without a password. Source `CreatorProfileScreen` confirms this is the recoverable profile-error branch with Retry. The second Back to original feed while still offline was not explicitly confirmed; keep that physical coverage limit, alongside prior host/development return coverage. Explicit offline Sign out → reconnect → full close/reopen passed: Account/Spaces remain signed out. Read-only cleanup confirms restored roles3359/3360 and zero active A26 sessions; no additional revocation needed. Evidence `tests/runs/device/plan_171/offline-return-logout-observation.json`.

- Bundled expiry UI passed: user reports anonymous Global with session-ended message; Account and Spaces both require sign-in. Expanded-story recovery after prior permission restoration was “Not checked”; retain this as physical coverage limit with host resource tests, without rerunning the permission cycle. Separate expiry audio/Back observations were not supplied. Guarded `finish` restored original roles3359/3360 and revoked bound fixture session71; phase complete, zero active fixture sessions, no ordinary account change. Evidence `tests/runs/device/plan_171/session-expiry-observation.json`. Requested a new fixture login for offline profile-return/recovery followed by explicit offline sign-out/restart; clean up any newly created fixture session separately.

- Bundled restored-access recovery: user used Refresh and confirms video, sound and captions returned. Expanded-story recovery was not explicitly reported; retrospective confirmation requested. After recovery, guarded driver verified the exact one bound fixture session71 and original roles, then expired only session71 for A26. Status expired, roles3359/3360 still restored, zero active fixture sessions; no normal accounts changed. Await foreground anonymous reset/clear protected media-text/Account sign-in/Spaces gate/Back isolation before final cleanup. Evidence `tests/runs/device/plan_171/access-recovery-and-expiry-applied.json`.

- Bundled access denial passed automatically: user reports “Refresh was not needed. Still signed in. All good” for Access unavailable, stopped video/audio and hidden protected story/captions. Lifecycle retrospectively confirmed “Passed all those checks”: covered Account/Settings and background/lock stop audio, same video/captions return, manual pause survives Account. Original roles3359/3360 restored to only A26 in personal64; guarded status restored, one bound active phone session, normal accounts unchanged. Await video/audio/caption/story recovery without login before expiry. Evidence `tests/runs/device/plan_171/access-denial-and-lifecycle-observation.json`.

- Bundled access protocol: user confirms the test personal feed is currently playing (“Okay, it's playing”). Read-only driver status confirmed original roles3359/3360 and exactly one active fixture session; guarded `deny` bound that session and removed only A26's roles in fixture personal space64. After status: denied, zero explicit roles, one active fixture session, no normal accounts changed. Evidence `tests/runs/device/plan_171/access-removal-applied.json`. Await device denial/media-text concealment/still-signed-in observation before restoring. Lifecycle protocol success is not inferred from the readiness-only reply; a concise retrospective confirmation is pending.

- Bundled CC-on creator/personal-feed return passed: user confirms “Yes, all is good” for original publication/near saved position, still manually paused, correct original cue, no overlapping audio, and “Origin story” restored rather than the destination publication story. Evidence `tests/runs/device/plan_171/creator-return-observation.json`. Position is qualitative, not a synchronized timing trace. No lifecycle/access or numerical gate inferred.

- Bundled build 2 caption/story physical check passed: user answers “Yes, all good” to CC speech alignment and restart after a loop; playing story expand/scroll/collapse preserves video/audio while captions hide/return; expansion/collapse preserves manual pause; text and controls readable/reachable at current phone size. Evidence `tests/runs/device/plan_171/story-captions-observation.json`. Speech sync is qualitative; no larger-size range, numerical timing or creator-return acceptance inferred.

- Offline cold-launch/reconnect physical check passed on bundled build 2 with Metro/tunnel stopped: recoverable connection/access UI opens without a development-server prompt, no protected video/audio/captions, same-account Account/Spaces recover without password. Evidence `tests/runs/device/plan_171/offline-startup-observation.json`. No explicit offline logout, protected profile-return, caption rendering or numerical performance result is inferred.

- Metro-off Wi-Fi cold restart and fresh saved preferences passed: user confirms “Yes, all good. Settings retained. video viewer honors settings.” Covered direct Global playback without server prompt, same-account restore, Captions On retained and startup Muted honored after full close/reopen. Evidence `tests/runs/device/plan_171/metro-off-restart-observation.json`. Pre-install upgrade persistence is still unavailable; do not infer new caption-rendering or performance results. Port 8081 remains closed; API3300 remains listening. Offline cold launch/reconnect is the next focused check.

- Physical installation/direct launch passed by user report: “Does Global open and play without asking for a development server? -> Yes.” Old settings are unverified, not failed or inferred retained. Evidence `tests/runs/device/plan_171/installation-observation.json`. Artifact/build identity was host-verified; the first physical diagnostic export will confirm report identity. Scoped process cmdline/cwd verified before graceful Metro shutdown; ngrok stopped, 8081 closed, public API `/health` returns `{ "ok": true }`, 3300 remains listening. Metro-off restart/fresh saved preference observations requested and pending.

- Signed preview FINISHED 2026-10-22 18:08:45 UTC: build `7a049a95-613f-4e81-98ee-4c761cc80772`, 0.1.0/build 2. Downloaded IPA 8,190,349 bytes; SHA256 `b769982ef2d7f660ba96183959dc1bed3bdcc46b11bbabdfb733037425cb9461`. Inspected Info.plist identity/version, embedded Hermes main.jsbundle (2,053,912 bytes) containing expected source/API, ad hoc provisioning matching the registered phone, get-task-allow false and no enabled OTA updates. Cloud pre-install log confirms the expected source stamp. Artifact evidence `tests/runs/build/plan_171/artifact-check.json`; raw build/cloud/config logs are private mode 600. No physical launch result yet.
- Final source/docs review: 51 touched/new files, 53 resolved local Markdown links, whitespace pass; two private fixture password values checked, zero matches in source/docs. Agent-docs checker retains the same 16 unrelated findings. Product code is unchanged since upload; later edits are documentation/evidence only.

- Phase C: final 147 mobile tests/typecheck and preview production Hermes iOS export pass. Actual rendered FeedScreen/CaptionLayer/native adapter passes in both diagnostics modes with `__DEV__` false: clock, pause/story, background, swipe/focus, profile checkpoint, listener disposal and <=3 owned players. Internal report/share/reset responds; ordinary Release exposes no report entry. Actual EAS archive matches the mobile-input digest; stale stamp is rejected by the cloud pre-install verifier. Source manifest is saved privately under `tests/runs/build/plan_171/source-manifest.json`; final logs and artifact identity are retained there during handoff. No backend/browser source was changed in this increment, so prior Plan 170 backend/API/browser evidence is reused.
- Phase B host gate: all 147 mobile tests pass (143 existing plus policy/privacy/source-digest/reset contracts); typecheck passes. Reset preserves live ownership and in-flight speculative readiness, excludes old partial selections, keeps context and starts a new bounded sample. Ordinary Release policy remains off unless the exact internal-preview opt-in is present. Logs `/dev/shm/plan171-mobile-tests.log`; rendered native-adapter verification follows in C.
- Execution: EAS CLI 25.2.0 build list confirms the sole/latest finished iOS development build is 0.1.0/build 1, `66023796-973d-4c98-8ad3-39fc6433d0b7`. Preview config resolves with no remote preview plaintext/sensitive variables; public API/kind/diagnostics come from its explicit profile. Local prepare/verify produce the same source digest; final digest will be restamped after code changes. Node v22.21.1, root free 2.7 GB, tmpfs available 2.6 GB.
- Environment: `/home/ubuntu/aws`, branch main, HEAD `49e8dd6`. Existing dirty Plan 170 implementation and prior Plan 169 continuity note preserved.
- Inspection: targeted reads/`rg` of build/app/package/lockfile, `.nvmrc`, `.easignore`, diagnostic collector/native adapter/feed entry/caption clock, environment validator, README and Plans 168–170. No cloud build, dependency installation, fixture mutation, source/config change, server stop or phone install performed for planning.
- Before/after-edit `npm run check:agents:docs`: identical 16 existing older-plan status/header findings (Plans 138, 140–142, 148–159); no new finding. Unrelated history unchanged.
- Targeted documentation check passes: four plan/index/roadmap files, 28 local Markdown links resolved, required plan sections and all six Pending execution phases present, unique Plan 171 number, no trailing whitespace. `git diff --check` passes; the targeted scan also covers the new untracked plans that git diff omits.
- Remaining gate: user confirmation of final sample conditions/visible behavior and documentation handoff. Supplied build2 report passes numerical limits (40/40 prepared normal, p95 126.87ms, peak3, zero recorded errors/incomplete/unexpected playback). B27 identity/space isolation and non-captioned item passed; medium text passes while larger-size clipping is deferred by the user. Offline profile recovery and explicit logout passed; second offline Back/original concealment and expanded-story restoration remain physical coverage limits with host/development coverage. Expiry anonymous reset/Account/Spaces gating passed; expanded-story recovery is physically unchecked with host coverage. Video/sound/caption recovery passed after Refresh; exact fixture session71 expired with original roles restored. Bundled lifecycle and automatic access denial passed; original fixture permission is restored. Bundled creator return passed with correct publication/story/cue, pause and near saved position. Basic bundled caption/story/loop/manual-pause/current-size readability passed. Offline cold launch conceals protected media/text and recovers the same account after reconnect. Metro-off Wi-Fi cold restart, same-account restore and freshly saved CC/sound persistence passed. Pre-install preference/session comparison is unavailable because the user does not remember its state. Existing certificate/provisioning was reused; ad hoc profile includes the previously registered iPhone and expires 2027-10-15. No Apple sign-in, new registration, certificate replacement or revocation occurred.

### External technical references

Checked 2026-10-22. Installed SDK/CLI behavior must be verified during execution; rolling docs do not authorize an SDK upgrade.

- [Expo EAS profiles](https://docs.expo.dev/build/eas-json/): preview versus development build purpose and profile separation.
- [EAS configuration schema](https://docs.expo.dev/eas/json/): explicit development-client, build environment, version and toolchain fields.
- [EAS environment usage](https://docs.expo.dev/eas/environment-variables/usage/): selecting build environment and resolving public configuration.
- [Internal distribution](https://docs.expo.dev/build/internal-distribution/): direct iPhone installation, registered-device provisioning and credential constraints.
- [App variants](https://docs.expo.dev/build-reference/variants/): simultaneous installations require different bundle identifiers. Reusing the existing identifier is this plan's chosen scope.

## Open Risks / Deferred

- Build2 medium text is readable; some larger-size buttons clip/become unreadable. User explicitly defers the proposed control/header/menu redesign until later; see native-roadmap UI notes. This does not establish full large-text support. Sound-on opacity was stated as 50% as well as sound-off; leave the on-state decision open. No acceptance-build UI changes made.

- EAS availability/build queue, account authentication, Apple device registration and provisioning expiry can delay installation. Signing validity is verified at execution; previous success is not proof of current access.
- Same-identity install replaces the development client; persistence across actual signing/install conditions needs observation. Keep recovery links; avoid uninstall until the specific failure and data consequences are understood.
- Uncommitted Plan 170 must be captured in source/archive provenance. A HEAD-only report would misidentify this binary; an unreviewed upload or stale local environment can produce the wrong acceptance app.
- Diagnostic sampling has overhead. Instrumented Release is more representative than Metro development, but not an uninstrumented store build. No native memory, battery, accessibility certification or native crash-freedom claim follows from bounded JS counters.
- Earlier whole-app freezes have unconfirmed native cause. Neither a new binary nor absence of recurrence proves root-cause resolution; preserve startup safeguards and collect native evidence if it recurs.
- Removing code-loading infrastructure cannot guarantee fast API access checks, CloudFront readiness or phone connectivity. The bundled UI still needs network services for content and access validation.
- Public HLS authorization remains separate from feed/text access. Private playlists/segments/posters, TestFlight, store metadata/privacy/review, account onboarding and final release qualification require later plans.
- No OTA update workflow is introduced. Every changed preview requires a new signed install until a separately designed update policy exists.
- Host root storage is limited. Inspect scoped build outputs and caches; never remove old projects, signing material or shared caches as an unreviewed shortcut.

## Resume Here

1. Complete: A–F for bundled internal iPhone build2. User installed and verified Metro-free direct/offline startup, accounts/settings, text/creator/lifecycle/access behavior and the final CC-on stable-Wi-Fi performance sample. 40/40 normal prepared, p95 126.87ms, median105.39ms, normal max154.29ms; one initial/cold483.56ms; peak3; zero recorded errors/incomplete/issues/unexpected playback. User confirms no spinners/frozen controls/overlapping audio. No further device run or conditions question is pending.
2. Plan 170 is also Complete for the recorded native story/caption milestone. Preserve acceptance-matrix physical/host limits and user-deferred larger-text clipping. Do not claim full accessibility/native-memory, private-media or TestFlight/public-release qualification.
3. Installed build `7a049a95-613f-4e81-98ee-4c761cc80772`, version0.1.0/build2, source `e912143476b62e0a802eec3985058c2bb1982652b6e5feb2ec29e720069e4d0a` matches current included mobile inputs. Metro/tunnel are off; API/backend/media stay online. New source requires another signed preview build/install; development profile and old build link remain for debugging.
4. Cleanup complete: original fixture roles3359/3360 restored; old bound session71 revoked; A26/B27 active sessions zero. No ordinary account or outstanding fixture grant/session cleanup. Keep private evidence/credentials ignored.
5. Implementation committed as `1dfd494a2021ad7e54d80221b668bffafde91678` including Plan170 and prior Plan169 continuity note. User-authorized normal push to origin/main completed; remote SHA matches and divergence0/0. Delivery records are in the documentation follow-up; tested application source is unchanged. Keep recent completed plans through Git handoff, then evaluate archiving. The next proposed UI pass is recorded in the roadmap: constant CC pill50/100 opacity, audio-symbol pill (sound-on opacity unresolved), current-space label opens selector, upper-right hamburger with Login/Logout/Settings. No UI implementation started; create a focused plan when requested.
