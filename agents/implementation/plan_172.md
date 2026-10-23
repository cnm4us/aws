# Plan 172: Native viewer controls, space navigation and account menu

Status: Complete

Created: 2026-10-22

A–F Complete for the recorded internal iPhone UI milestone with explicit coverage limits. Signed build6 is installed; phone acceptance, source-matched playback gate and documentation checks pass. User requested commit and push; delivery is in progress.

## Feature Reference

- [Native viewing roadmap](../roadmaps/roadmap_native_viewing.md)
- [Personal-space and Global context integrity](../features/feature_02_personal-space-global-feed-context-integrity.md)
- Accepted foundations: [Plan 169](plan_169.md), [Plan 170](plan_170.md), [Plan 171](plan_171.md).

## Context

The user requested inspection and a detailed implementation plan for the control/header/menu refinement recorded during bundled iPhone acceptance, then authorized implementation. Work proceeds through the phases below; physical acceptance remains separate from host checks.

Video Viewer 0.1.0/build 2 is accepted as a bundled internal iPhone Release preview. It opens without Metro or the Expo tunnel. Its final stable-Wi-Fi, Captions-On sample has 40/40 normal transitions prepared, prepared first-frame p95 126.87 ms, peak three players, and no reported spinners, frozen controls or overlapping audio. Source identity is `e912143476b62e0a802eec3985058c2bb1982652b6e5feb2ec29e720069e4d0a`; implementation and delivery records are pushed in `1dfd494` and `a12d2b2`. Preserve this baseline and its coverage limits.

The feed currently shows separate Spaces, Account, Settings and Refresh text buttons, plus a conditional Back to profile button. CC On/Off and Mute/Unmute occupy a narrow overlay. The user observed unreadable/clipped buttons at larger iPhone text sizes and proposed constant CC/audio controls, a tappable space label, and an upper-right hamburger menu. The user subsequently confirmed audio opacity: **50% off / 100% on**, matching CC.

In scope:

- Constant CC and audio-symbol controls in matching rounded-square pills.
- Feed space label opens the existing full-screen selector.
- Upper-right menu provides sign-in/account/sign-out, Settings, feed Refresh and internal diagnostics.
- Consistent menu access from creator profiles without losing the original-feed journey.
- Readability and reachability of affected controls at large text sizes, including long names and recovery states.
- Focus, account, caption/story and playback regressions; a new bundled preview and focused physical acceptance after implementation.

Out of scope: backend/API/schema changes, new space discovery or membership workflows, shared links, social participation, redesigning the web viewer, replacing the player, performance tuning without a demonstrated regression, private-media delivery, TestFlight/App Store submission, OTA updates, a new design system, full VoiceOver qualification or native-memory/battery qualification. VoiceOver remains explicitly deferred by the user.

## Inspection Findings

| Current source | Finding and implementation implication |
| --- | --- |
| `mobile/src/feed/FeedScreen.tsx` | Title is a header-role Pressable used only for diagnostic long-press. Actions occupy two rows. Convert title to a clearly named button; move diagnostics to an explicit internal menu entry to avoid tap/long-press conflict. Refresh currently checks access, clears resume and refreshes the selected feed; preserve those semantics. |
| `mobile/src/feed/FeedScreen.tsx` | CC/audio column has `maxWidth: 80`; CC changes between longer labels. Replace with compact reusable controls while keeping saved CC and session mute owners. Off/muted remains enabled and tappable. |
| `mobile/src/navigation/ViewerNavigator.tsx` | A single Feed route is keyed by auth generation/context/visit. Temporary screens blur it through `useIsFocused`; creator journeys retain one checkpoint. Add Menu here rather than another Feed or independent player owner. |
| `mobile/src/navigation/returnToFeed.ts` | `popTo('Feed')` deliberately avoids duplicate hidden Feed routes. Preserve this path for real space switches/refresh return; generic navigation to Feed previously exhausted the player budget. |
| `mobile/src/spaces/SpacesScreen.tsx` | Selector already supports Global, Personal, Groups, Channels, loading/error/retry and anonymous sign-in. Reuse it. Selection always calls `select`, resetting the journey; choosing the current context must instead dismiss without resetting. |
| `mobile/src/profiles/CreatorProfileScreen.tsx` | Body contains Account/Settings buttons and a contextual sign-in CTA. Move general utilities to the menu; retain the personal-space sign-in CTA and native Back. |
| `mobile/src/auth/AccountScreen.tsx`, `accountPresentation.ts`, `authStore.ts` | Account supports valid/saved-session recovery, cancellation and local-first offline sign-out. Reuse presentation rules and sign-out method; do not duplicate token/storage logic. |
| `mobile/src/preferences/PlaybackSettings.tsx` | Settings is a navigator destination rendering a native Modal, already blurring Feed. Review header/choice rows and change help text referring to Mute/Unmute. Preserve persistence. |
| `mobile/src/feed/FeedCard.tsx`, `mobile/src/content/CaptionLayer.tsx` | Both reserve 96 points at right for controls; vertical caption placement depends on measured text. Coordinate this reservation. Header changes resize paging and must preserve publication/index. |
| `mobile/src/ui/Message.tsx`, `mobile/src/content/StoryPanel.tsx`, `mobile/src/playback/VideoSurface.tsx` | Shared actions, story controls and retry feedback need wrapping/height review. Removing toolbar labels alone cannot establish large-text support. |
| `mobile/package.json`, `.easignore`, `mobile/scripts/preview-build.cjs` | No direct icon package is declared. Bundle icons without a new native dependency; new assets enter the existing digest/archive. Installed build 2 needs a new signed binary for source changes. |

The repository's modal/floating-panel/nebula guides primarily specify browser CSS and composer properties. Retain their intent of readable contrast, clear close actions and no overflow. Use current black/charcoal native surfaces and native-stack behavior; do not import DOM, CSS blur or web modal infrastructure.

## Locked Decisions

1. **One feed and existing authority.** Preserve server validation, auth-generation isolation, TextResources lifetime, preferences, original-feed checkpoint and release-before-context-replacement. Navigation grants no access. No credentials, URLs, resource objects or callbacks in new route params.
2. **Feed header.** Current space name with a compact channel/group/personal type icon and chevron at left, hamburger at upper right; no text type subtitle, per user feedback. Space button announces “Choose space. Current space: …”. Keep visible Back to profile on personal detours, and existing access/session/restoration messages. Remove the old utility row only after replacements work.
3. **Space selection.** Name opens Spaces and pauses the covered feed through focus. Back/cancel or current-context selection preserves player, publication/time, pause and journey. A different context resets the journey and uses the existing guarded selection/release/return path. Apply to Global and personal/group/channel contexts.
4. **Menu presentation.** One opaque, scrollable native-stack Menu screen, opened by a minimum 44-by-44-point hamburger target from Feed and CreatorProfile. Visible Back/Close returns to caller. Repeated taps cannot stack menus. Feed remains ineligible throughout Menu → Account/Settings transitions.
5. **Menu destinations.** Replace Menu with Account/Settings so Done/Back returns directly to the invoking Feed/Profile. Anonymous menu offers “Sign in”; authenticated menu offers “Account” and “Sign out”; saved/unverified identity offers Account recovery and “Sign out on this phone” using `accountPresentation`. Disable conflicting mutations while restoring/signing in/out/validating. Preserve creator personal-entry sign-in.
6. **Sign-out.** Call existing local-first `AuthStore.signOut` once. Existing principal/group reset clears protected route history/journey and returns to anonymous Global. Preserve storage-clear failure messaging and a reachable retry sign-out action for anonymous-with-saved-session. Do not force navigation that hides failures or await network revocation before local logout. No additional confirmation dialog.
7. **Refresh.** Feed-origin Menu offers “Refresh feed”; Profile-origin Menu does not. Return to the existing Feed, then run existing access-checked refresh-from-start once. Validate current auth generation/context/live owner; a removed menu cannot refresh a replacement account/feed. Refresh retains the original checkpoint when refreshing a personal detour. Merely opening/closing Menu never refreshes.
8. **CC/audio pills.** Rounded-square charcoal surface at 25% opacity in both on/off states (including pressed), per build 3 feedback; constant white `CC` or recognizable speaker artwork. White foreground is 50% off / 100% on for both, as confirmed by the user. Apply state opacity only to glyphs, retaining full hit targets. Hamburger background retains its existing styling. Distinct speaker-with-waves/slash shapes also indicate sound. Off is enabled, not disabled. Keep preference hydration, saved CC, session mute and startup sound semantics; no CC on captionless publications. Caption load errors remain distinct from preference off.
9. **Icons and semantics.** Bundle locally owned speaker/menu/chevron artwork with source assets; no emoji/font fallback, remote icon download or new native dependency. CC may remain text styled as an icon. Glyph sizing is fixed; ordinary labels/body text scale. Pressables own explicit action labels and selected/expanded/disabled state as appropriate, with minimum 44-point targets. Automated semantics do not establish physical VoiceOver acceptance.
10. **Large text.** Remove narrow caps on text actions; allow wrapping and growing/stacked rows. Menu/Spaces/Account/Profile/Settings remain scrollable within safe areas, including keyboard access. Do not globally cap Dynamic Type or shrink all text. Long feed titles may use a bounded two-line summary with full accessible name and full name in Spaces; action labels must not be ellipsized. Switch header/actions to stacked layout when needed; use measured layouts rather than one guessed font-scale breakpoint.
11. **Playback/text.** Covering Feed pauses audio and hides/clears protected story/captions using existing eligibility. Return preserves pause and publication/time, resuming after existing access checks. Story may collapse/reload on blur as today; no new expansion persistence. Keep control lane separate from captions/story and Retry/Next, including no-caption state.
12. **Diagnostics.** Internal/development Menu exposes the existing Share/Share full/Reset implementation under the same build predicate. Remove title diagnostic long-press after entry works. Keep report privacy/reset/resource accounting; ordinary Release has no diagnostic entry/work. Keep Feed paused under report/share UI.
13. **Delivery.** Keep app identity/version and API/media paths. Choose iOS build above the actual latest EAS build (expected 3 if 2 remains latest), regenerate source identity, inspect archive/export and build internally through Plan 171 workflow. Retain accepted build 2 install/evidence. No TestFlight, credential revocation, device deletion or update-service migration.

## Interaction Contract

| Trigger | Result and retained state |
| --- | --- |
| Space title → selector → cancel/current space | Existing feed pauses while covered; dismiss preserves player, publication/time, manual pause and creator journey. Different space follows guarded replacement. |
| Menu → Close/Back | Returns to caller, without refresh, seek, preference change or journey reset; same Feed remains mounted. |
| Menu → Account → Done/Back | Account replaces Menu; returns to caller with no intervening playback. Identity change keeps the existing Global reset policy. |
| Menu → Settings → Done | Settings replaces Menu; native Modal closes without a hidden Menu, retains manual pause and applies preference changes. |
| Menu → Sign out | Existing auth reset clears protected media/text/history; ordinary CC/start-sound preferences survive. Offline local sign-out works. |
| Menu → Refresh feed | Existing Feed receives one guarded refresh; access check precedes fetch. Stale requests are discarded. |
| Menu → diagnostics | Report/share/reset while Menu covers Feed; no seek/selection/preference change. No entry in ordinary Release. |
| CC/audio tap | Exactly one preference/sound action; no pause tap-through, navigation or selection change. |
| Creator/personal → Menu utilities → Back to profile → Back | Existing bounded journey returns to original publication/near saved time and pause, with latest sound/CC and correct text. |

## Phase Status

- A: Complete — compact controls and header components
- B: Complete — menu, space selection and guarded returns
- C: Complete — large-text layout and recovery states
- D: Complete — host regression and bundled build gates
- E: Complete — signed build6 installed; focused phone checks pass over recorded ranges/limits
- F: Complete — build6 report/conditions, scoped cleanup and documentation handoff verified

Inspection/plan authoring is complete. Implementation is authorized; at most one phase may be In Progress.

## Phase A — Compact controls and header components

Goal: add visual primitives while existing navigation stays runnable.

- [x] Add reusable pill/icon button under `mobile/src/ui/`, with explicit selected/disabled/accessibility behavior and minimum target; off-state target remains fully interactive.
- [x] Add owned speaker-on/off, hamburger and chevron artwork under `mobile/assets/`, source plus raster variants with static bundler references. Hide decorative images from accessibility; Pressable owns the label.
- [x] Replace CC/audio controls in FeedSession while retaining caption availability/hydration guards and preference owners. Use confirmed 50%/100% glyph opacity.
- [x] Extract a small header component without moving feed/auth ownership. Title becomes button; add menu callback, preserving Back to profile/messages. Keep old utility actions until B replaces them.
- [x] Change Settings help to refer to the sound button.

Test gate: mobile typecheck; rendered actual controls/header with controlled native ports: both states, unavailable captions, hydrating preference, repeated toggle, explicit labels and no pause tap-through. Assert same coordinator/player survives taps and captions use selected-player clock. Inspect symbols over black and bright video backgrounds.

Acceptance: existing behavior with recognizable compact symbols, correct semantics and no extra player/listener. App remains runnable before toolbar replacement.

## Phase B — Menu, space selection and guarded returns

Goal: complete navigation without losing accepted feed/journey boundaries.

- [x] Add Menu to existing auth-keyed stack. Derive rows from current identity presentation; destination handlers validate current identity, focused route and mounted caller. Use serializable source/context identifiers only if necessary.
- [x] Wire title to Spaces and hamburger to Menu. Add profile hamburger in native header, removing redundant general utility row while retaining contextual sign-in.
- [x] Replace Menu with Account/Settings; preserve actual caller through Done/Back. Temporary Profile utilities must not reset creator journey. Rapid taps/Back/gesture leave one Menu at most and exactly one Feed.
- [x] Same-context selection dismisses without `select()`/journey reset. Cover anonymous Global and personal detours as well as groups/channels.
- [x] Extend registered Feed handle or equivalent small guarded command path for deferred Refresh, consumed once after Feed regains focus. Verify generation/context/owner before calling existing refresh. Keep consumption in surviving feed owner so session replacement cannot replay it. No route callbacks/general event bus.
- [x] Connect local-first sign-out, unavailable saved sessions and durable-clear failure retry. Disable duplicate mutation; retain messaging after navigation group changes.
- [x] Move diagnostics entry using the same policy and implementation. Extract report action into a neutral diagnostics helper if needed to avoid Menu/Feed import cycles. Remove title long-press once tested.
- [x] Remove old persistent utility buttons. Keep error escapes to Global/Spaces and personal-feed Back to profile.

Test gate: actual installed stack-router/auth/journey tests cover menu dismissal/replacement, same/different/cancel space, profile returns, Refresh once, rapid events and pending-command identity invalidation. Render actual Menu/Feed/Account/Settings interactions using real stores/coordinator with controlled native navigation/media ports. Assert no playing player while covered, pause/position preservation, one Feed, peak <=3 and cleanup on identity reset. Exercise offline sign-out/storage failure through new entry.

Acceptance: all removed utilities remain reachable; no playback flash, stale refresh, duplicate Feed, protected Back resurrection or lost origin checkpoint. Saved-session recovery remains available.

## Phase C — Large-text layout and recovery states

Goal: fix affected clipping and keep viewing usable when text/header dimensions change.

- [x] Audit shared Action wrapping, Settings header/choices, Menu rows, Spaces entries, Account keyboard, Profile entry actions, story expand/collapse/retry and VideoSurface Retry/Next. Review every native caller of a shared style change; avoid unrelated restyling.
- [x] Use min-height/flexible width/wrapping or stacked rows. Reconcile line height with scaled labels; do not disable scaling globally.
- [x] Define one control-lane reservation shared by FeedCard/CaptionLayer/controls; respect home indicator and avoid caption/story collisions in one/two-control states.
- [x] Verify header resizing from long title, Back, notices and font changes invokes paging realignment without changing publication/index or replaying wrong video. Measurement changes must not repeatedly select/seek.
- [x] Preserve scrollable story, caption ownership and readable recovery controls. Record residual long-cue/body typography limits separately from button acceptance.

Test gate: rendered narrow portrait widths (including 320/375 points), default/medium/maximum supported accessibility scales, long names/labels, keyboard and loading/error/no-caption states. Exercise actual onLayout/resize callbacks for selection/pause/paging. Host assertions prove component state/props, not native glyph geometry; physical checks in E are required.

Acceptance: affected actions wrap/grow and stay reachable; compact symbols remain legible; reviewed layouts have no clipped targets or overlapping control/text lanes. Selection/pause survives resize. No full accessibility claim from host render checks.

## Phase D — Host regression and bundled build gates

Goal: validate final source before creating a signed replacement.

- [x] Add meaningful navigation/identity/Refresh and rendered interaction tests, extending existing suites. Render harness must have a reproducible documented command and native-layout limits; do not rely only on private scripts or tests that mirror styles.
- [x] Run `cd mobile && npm test` and `npm run typecheck` with mobile Node 22.21.1. Run rendered actual-component checks with `__DEV__` false, diagnostics on/off. Cover clock intervals/cleanup, no-caption item, paused story and original-feed restore under changed navigation.
- [x] Review dependencies/assets/config for offline bundled icons and no undeclared package use. Reuse backend/browser evidence if their source/contracts remain unchanged.
- [x] Inspect latest EAS build read-only; set higher build number, run `npm run prepare:preview` and `npm run export:preview` with task-scoped storage/output. Freeze source ID/environment for device acceptance. Leave unrelated projects/servers alone.
- [x] Inspect actual EAS archive with pinned CLI workflow from Plan 171. Verify new icons/source and digest; reject private fixtures/credentials/reports. Validate preview stamp/profile; no signing changes.
- [x] Review whitespace/local links and agent-docs findings against baseline. Store host/export/archive evidence in ignored build run directory for plan_172.

Test gate: mobile suite/typecheck, rendered diagnostics on/off, production iOS export, deterministic identity/stamp and complete secret-free archive. Export does not prove native build/install/layout.

Acceptance: new gates pass before cloud submission; source frozen for device testing. Failures have a recorded blocker/residual risk, never an inferred pass.

## Phase E — Preview installation and focused iPhone acceptance

Goal: accept changed UI in a new bundled binary with brief, relevant phone protocols.

- [x] After D, run existing `npm run build:preview -- --non-interactive` workflow. Record source, EAS build ID, app/build, artifact metadata and install link. Reuse valid app/device signing; no auto-submit.
- [x] Build5 installed over the existing app; Menu report matches source/build and home-icon lifecycle/settings checks pass with Metro/tunnel stopped. Fresh preference persistence passed. Pre/post upgrade preference comparison remains unverified; no upgrade-migration claim. Build6 installation/source identity and caption-notice observation also pass.
- [x] Recorded grouped checks in the acceptance matrix over actual reported ranges; no other Plan171 permission/session fixture cycles repeated. Build6 source changes only caption-notice timing/build metadata; unchanged build5 navigation/lifecycle evidence carries forward. Header maximum size passes with accepted long-name ellipsis; Menu/user name passed at larger (not largest) sizes. All-screen maximum-size qualification and pre/post upgrade-state comparison remain unverified. User confirms usual text size restored for final sample. Host-only captionless/error/stale-action cases are identified explicitly.

| Phone check | Required observation |
| --- | --- |
| Title/selector | Global opens Spaces; cancel returns same video/time. Choosing current signed-in space preserves pause and personal journey. Different space selects correctly, without hidden/overlapping audio. |
| Menu/back | Sound stops through Menu/Account/Settings and transitions. Close returns same video. Manual pause survives a repeat. Profile Menu utilities return to Profile; personal-detour Back still returns original Feed. |
| Icons/preferences | Constant CC/state matches cue visibility; audio shapes/state match sound. Taps do not pause. No-caption video has no CC/stale cue. Settings saves CC/start-sound with accurate help. |
| Refresh/report | Refresh works once in Global and a personal detour; original checkpoint survives. Share/reset works with accurate live-player balance and no preference change. Profile menu has no feed Refresh. |
| Large text | Usual/medium/maximum accessible size: header/Back, Menu, selector long names, Settings, Account keyboard and story/retry actions readable/reachable. Record slider range, scrolling and overlap; restore usual size. Do not silently waive a failure at maximum because medium passes. |
| Identity/recovery | Menu offline sign-out → reconnect/full reopen keeps Account/Spaces gated, no protected Back. Normal sign-in gives correct menu identity/Spaces. Storage-clear failure remains host-controlled unless naturally observed. |
| Lifecycle | One background/return and lock/unlock after menu navigation: hidden audio stops; same video/captions resume after validation, pause survives. Do not remove permissions/expire sessions solely to repeat prior acceptance. |

Test gate: actual new build passes controls/navigation/pause/journey/layout; report matches installed source/build. If all controls freeze, stop the run and collect available native error evidence; do not request repeated reproduction. Label host-only edge coverage.

Acceptance: user manages spaces/account/settings through new UI, with affected large-text controls accepted over recorded sizes. Existing playback/independent-launch guarantees hold. No full VoiceOver/public-release claim.

## Phase F — Playback evidence and handoff

Goal: close UI milestone with comparable bundled performance and clear continuity.

- [x] Collected the confirmed stable-Wi-Fi, usual-text-size, Captions-On build6 forward sample using Menu → diagnostics → Reset. Let each video play >=2 seconds; Menu Refresh at list end if needed; retain >=30 normal prepared transitions (approximately 40 selections). Keep functional menu/profile/background exercises separate from timing, apart from necessary reset/report/Refresh.
- [x] Passed Plan171 numerical/observational gate: prepared first-frame p95 <=150 ms; normal preparation >=90%; peak players <=3; zero failed/incomplete normal transitions, unexplained unexpected playback or whole-app freeze. Retain cold/initial/interrupted samples and playing/progress evidence separately from frames.
- [x] Compared build2's 40/40 prepared/p95 126.87 ms baseline without causal UI/tunnel/network claims from one run. Record visible spinners/audio/clipping/wrong video even when metrics pass.
- [x] No grants or sessions were created/mutated by host tools during Plan172, so no host-created fixture change or session requires cleanup. User exercised offline Menu sign-out; no ordinary-account mutation or blanket revocation performed. Existing fixture data remains usable; old session-bound access drivers were not reused and no fixture secrets were published.
- [x] Updated plan/index/roadmap/mobile README with accepted build6, navigation/diagnostics workflow, physical/host-only coverage, baseline comparison and limits. Root README gets a scoped Menu/report-path and new `test:ui` workflow update; no backend setup changes.

Test gate: source/build-matched report, conditions/observations, scoped cleanup and no new docs/whitespace/privacy failures. Recheck only justified source changes; product changes after install require new identity/build and affected phone acceptance.

Acceptance: A–F complete with evidence/limits; independent bundle available for next milestone. Commit/push only when requested. Discovery/shared links and store qualification remain later plans.

## Expected File Impact

| Area | Expected changes |
| --- | --- |
| Controls/header | Small `mobile/src/ui/` components, bundled `mobile/assets/`, `mobile/src/feed/FeedScreen.tsx` |
| Navigation/menu | New Menu screen, `mobile/src/navigation/ViewerNavigator.tsx`, guarded feed Refresh command/handle; retain returnToFeed/journey contracts |
| Selector/profile | `mobile/src/spaces/SpacesScreen.tsx`, `mobile/src/profiles/CreatorProfileScreen.tsx`; native header configured in navigator |
| Layout/help | `mobile/src/ui/Message.tsx`, `mobile/src/preferences/PlaybackSettings.tsx`, `mobile/src/feed/FeedCard.tsx`, `mobile/src/content/CaptionLayer.tsx`; StoryPanel/VideoSurface only for demonstrated affected overflow |
| Tests | Existing native navigation/auth/journey/preferences/diagnostics suites and reproducible rendered interaction coverage |
| Build/docs | `mobile/app.json`, generated `mobile/src/config/buildIdentity.json`, mobile README, plan/index/roadmap; `.easignore` only if required inputs fall outside current allowlist |

No endpoint, migration, preference key, native plugin or dependency upgrade is expected.

## Change Log

- Uncommitted — build6 installed and final phone/performance sample accepted; A–F complete with recorded limits and final documentation checks passed. No commit/push requested for this milestone.

- Uncommitted — build 3 phone follow-up: controls/space navigation work and sound stops while covered; requested 25% playback-control background applied for build 4. Access/pause policies unchanged.

- Uncommitted — implementation A–D complete: bundled compact icons/header, Feed/Profile Menu, guarded same-context selection and Refresh, scalable/scrollable controls and reproducible rendered harness. Build 3 submitted as `b26f50bf-b8c3-4be1-9546-9cea89b43881`; physical E/F pending.

- Uncommitted — 2026-10-22: inspected accepted source, authored Plan 172 and recorded user's 50%/100% audio choice; execution Pending. No product/build/source-identity change.
- Baseline: `1dfd494` — accepted text/bundled-preview implementation; `a12d2b2` — delivery documentation.

## Validation

- Commit review: staged source still matches signed/accepted build6 exactly. Staged whitespace check identifies one cosmetic terminal blank line in `mobile/src/diagnostics/share.ts`; retained to preserve the accepted source identity, with no runtime effect. Other whitespace checks pass with `blank-at-eof` excluded. Earlier unstaged checks did not include this then-untracked file. No private artifacts staged; agent-docs remains the same16 older findings. Evidence: `tests/runs/build/plan_172/build6/commit-review.json`.

- Final handoff checks passed: `git diff --check`, explicit untracked-text whitespace,37 relative documentation links, unchanged signed build6 source manifest, and no private evidence/signing files in Git changes. Agent-docs has zero new findings; the same16 pre-existing older plan status/header findings remain. Evidence: `tests/runs/build/plan_172/build6/final-checks.json` and `agent-docs-final.log`. Plan/index/roadmap/mobile/root README agree on delivered UI and limits. No repeat product suite needed for these documentation-only changes.

Validation entries retain newest-first chronology; earlier “pending” notes describe evidence available at that point, superseded by final acceptance above.

- Final build6 phone/numerical acceptance **passed**. Report `2026-10-23T01:39:48.624Z` matches signed artifact and current source `9e4731aebeb1c8aafdf99e313bcd1bca7a47292e708fbf978faa72726283ba65`, app0.1.0/6. User confirms stable Wi-Fi, usual text size, Captions On, captions following speech, no frozen controls or overlapping audio; explicitly reports brief CC spinner is gone. All42 normal transitions prepared, median104.23ms, p95121.03ms, max124.76ms;44/44 total frames, zero errors/incomplete/issues/unexpected playback, peak3. Resource balance1+45−45=1 while diagnostics covers Feed. Two initial/cold frames retained (322.24ms and1469.71ms); not hidden from summary. Five exported details show playing/progress454–468ms, latest interrupted transition retained; compact report omits39 details and cannot prove every transition's motion. Evidence: `tests/runs/device/plan_172/build6-playback-report.json`, `build6-playback-analysis.json`, `build6-user-confirmation.json`.

- Baseline comparison: build2 prepared p95126.87ms; final build6 p95121.03ms (5.84ms lower) passes150ms. Prior build5 p95155.13ms miss remains recorded. Individual samples do not establish why first-frame timing differs or that caption-feedback delay caused improvement. Caption-notice fix is accepted directly from user observation, with host coverage of immediate cues/errors/retry and delayed-feedback cancellation.

- Scope/cleanup: 147 existing mobile unit checks passed earlier in implementation; final typecheck/eight rendered cases, production Hermes export, source/archive/artifact identity checks passed. Navigation/pause/Refresh/settings/lifecycle/offline-signout build5 physical evidence carries forward because only CaptionLayer notice timing/build metadata changed for6. No host-created fixture grants/sessions need cleanup; no backend/native dependency/access freshness changes. Full maximum-size qualification across all screens, VoiceOver, native memory/battery and public-store qualification are not claimed. Upgrade-state comparison remains unverified; fresh setting/account persistence passed. Brief Checking Access on protected returns remains current policy and a separately scoped polish candidate.

- Build6 signed artifact **verified**: EAS `0f520676-1d89-4b8f-9f0a-b21a78fb59c0` FINISHED; [install build6](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/0f520676-1d89-4b8f-9f0a-b21a78fb59c0). Same bundle ID, app0.1.0/build6; expected source/API embedded in2,065,075-byte Hermes bundle; registered phone/provisioning matches, no debug entitlement or enabled OTA. IPA8,227,686bytes, SHA256 `4f1ac8ead475c2a0f2989dde9232304bbe12b3edb36f1eaff86b95633b871b22`. Evidence: `tests/runs/build/plan_172/build6/artifact-check.json`. Install/caption-focused sample question delivered next; physical acceptance/performance remain pending.

- Build6 caption-notice host/export/archive gates pass: typecheck and8 rendered cases (including actual CaptionLayer/TextResources controlled fast/slow/retry/refresh/hide/replacement/unmount checks). Cues and errors remain immediate; only loading notice waits300ms. Source `9e4731aebeb1c8aafdf99e313bcd1bca7a47292e708fbf978faa72726283ba65`, build0.1.0/6; compared with5 only `app.json` and `src/content/CaptionLayer.tsx` change. Production Hermes export embeds expected source/API; actual archive89 inputs/90 files/478995bytes matches with no private inputs. EAS submission running; artifact/phone acceptance pending. Evidence: `tests/runs/build/plan_172/build6/`. No frame-speed or physical spinner pass inferred.

- Build 5 final protocol report received (`2026-10-23T01:18:09.705Z`): exact source/build match; 43/43 frames, 41/42 normal prepared (97.62%), zero errors/incomplete/unexpected playback, peak3; balance1+48−48=1 while Menu diagnostics covers Feed. Prepared p95 **155.13ms exceeds150ms gate** by5.13ms (baseline126.87ms); normal p95157.73ms, normal max181.23ms, initial444.87ms. Retain cold and interrupted details. All six unique compact transitions show playing/progress; remaining37 details unavailable in compact. User reports otherwise good playback but brief separate CC spinner; conditions follow requested protocol without separately worded Wi-Fi confirmation. Evidence: `tests/runs/device/plan_172/build5-playback-report.json` and `build5-playback-analysis.json`. Gate not waived and no causal claim.

- Caption indicator follow-up in E: CaptionLayer immediately renders its own ActivityIndicator while loading captions, independent of video readiness. Delay only that notice by300ms, cancel on completion/hide/replacement/unmount, keep cue presentation and errors immediate, retain all authority/cache/player behavior. Cover fast/slow/retry/cancel/publication changes in actual-component test; prepare a new signed build6 and focused phone check, then source-matched F sample. Prior navigation/lifecycle checks carry forward for unchanged source.

- Build 5 lifecycle/settings/offline Menu sign-out physical checks **passed**: hidden/locked audio stops, same video/captions return; fresh Captions On/start-muted settings and account survive full reopen; offline Menu sign-out followed by reconnect/reopen keeps Account/Spaces gated with no protected return. User reports a small Checking Access interruption after background/lock and asks whether avoidable. Inspection confirms foreground session validation and protected-space guard validation gate resumption (session then space check; in-flight session validations coalesce). This remains expected current policy; no latency measurement or cause beyond this code path is inferred. Quieter presentation/return-latency optimization is a follow-up candidate, without weakening access freshness. Evidence: `tests/runs/device/plan_172/build5-lifecycle-settings-signout-observation.json`. No product source change.

- Build 5 personal-detour Refresh physical check **passed**: user confirms personal feed reloads through Menu → Refresh feed, then Back to profile → Back restores the original video near its saved position, still paused. Evidence: `tests/runs/device/plan_172/build5-refresh-return-observation.json`. No source change or repeat required.

- Build 5 intentional-pause/current-context/profile-menu physical check **passed**: user confirms all prompted actions from a visibly Paused video. Account/Done, Settings/Done and same-space selection preserve pause/position; creator profile Menu → Settings → Done returns to Profile, then Back restores original paused video. Evidence: `tests/runs/device/plan_172/build5-pause-return-observation.json`. The earlier manual-pause uncertainty is resolved; do not repeat this check.

- Build 5 physical header check: user reports the space-name selector now handles the **largest** text size without bottom cropping. A long name displays “Test Gr…”; the user accepts this. This matches the designed two-line header summary with full name available in Spaces/accessibility label. Vertical clipping is resolved for the recorded check; this does not establish all screens at maximum size. Evidence: `tests/runs/device/plan_172/build5-header-observation.json`. No source change/rebuild is needed.

- Build 5 signed artifact verified: EAS `6b69e8da-4ad6-4cf6-8617-da860a2f9e6b` FINISHED; install https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/6b69e8da-4ad6-4cf6-8617-da860a2f9e6b . IPA 8,227,403 bytes, SHA256 `a4bb4f6b68a4768d5da8cb9f41eedbd73b09a19e8a0e2fea9ee8608b803a08bc`. Same app 0.1.0/build5, matching source/API in embedded Hermes, expected registered phone/provisioning, no debug entitlement or enabled OTA. Evidence: `tests/runs/build/plan_172/build5/artifact-check.json`. User has header-focused install/check question; reply pending. No native clipping pass claimed.

- Build 5 host gate: typecheck/seven existing rendered cases pass (updated header semantics/type icon coverage, including the real-router journey); Hermes iOS export/source/API identity pass. Actual archive matches 89 source inputs, 90 files/478,484 bytes, no private inputs. Compared with build 4 only FeedHeader, new type artwork and build number change; auth/playback/navigation code stays identical. Source `7b9901e7c1c0b503c3860f774f0e4198ac30cf665e1bedcfca10d823fe8f6884`. Evidence: `tests/runs/build/plan_172/build5/`. Signed submission in progress; no native clipping pass inferred from renderer.

- Header follow-up: user approves type icons instead of subtitle. Build 5 adds bundled channel/group/personal icons and explicit scaling line height/padding for the name, retaining two-line wrap and full type/name accessibility label. Installed React Native Text defaults to overflow hidden; header permits glyph overflow within added spacing. Host checks cannot establish the precise native clipping cause or prove the fix; physical confirmation remains required. User clarified videos left playing resume; manual-pause physical result still unverified, no repeat requested at this point.

- Build 4 device response: 25% backgrounds accepted; return interruption described as barely noticeable, without an explicit manual-pause pass (follow-up requested). Larger-text check was explicitly **not the largest setting**: pills retain fixed size as intended, Menu/user name look good, but channel title and type subtitle clip at bottom. Header defect remains open; no maximum-size acceptance. Saved in `tests/runs/device/plan_172/build4-feedback.json`. Optional channel/group icon choice and pause confirmation questions are pending.

- Build 4 signed artifact verified: EAS `3de05af8-ecb5-4595-94ee-8b31b54d7aae` FINISHED, direct install https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/3de05af8-ecb5-4595-94ee-8b31b54d7aae . App ID/version/build correct; expected source/API embedded, provisioning matches accepted phone, get-task-allow false, OTA disabled. IPA 8,211,632 bytes; SHA256 `5bb349b152e37fe75cbee6f2a6d175ff128950c37a49d9d9bbdb66600d323d04`. Evidence: `tests/runs/build/plan_172/build4/artifact-check.json`. Install/background/manual-pause return question sent; largest-text question on build 3 also pending. No new physical pass inferred.

- Build 4 host follow-up: typecheck, existing seven rendered cases and production export pass. Actual EAS archive/source/API identity match: 77 inputs, 78 files/464,741 bytes, no private inputs. Manifest comparison against build 3 changes only `app.json` and `src/ui/IconButton.tsx` (generated identity excluded by design); access/auth/navigation/player source is identical. Build 3's 147-test business-logic gate is reused for this style-only change. Evidence: `tests/runs/build/plan_172/build4/`, plus typecheck-build4/rendered-build4 logs.

- Build 3 device response: space changer and CC/audio controls work; Account/diagnostics returns briefly show Checking Access and resume same position, Settings/Menu-close usually return immediately. User separately confirms sound stops throughout every covered screen and the delay occurs only on return. This establishes covered-audio behavior, not every Phase E row or upgrade persistence. Record: `tests/runs/device/plan_172/installation-navigation-build3.json`.
- Feedback follow-up: user requests constant 25% charcoal background for CC/audio. Build 4 changes only playback-button background plus build identity; glyph opacity/controls/authority remain unchanged. Source inspection: every protected-feed focus activates AccessGuard verification; auth foreground/periodic validation can also display Checking access. Notice visibility depends on request/presentation timing; no screen-specific weaker Settings policy exists. No change to access freshness, pause or verification timing is made.

- Phase E signed artifact verified: EAS build `b26f50bf-b8c3-4be1-9546-9cea89b43881` FINISHED; direct install https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/b26f50bf-b8c3-4be1-9546-9cea89b43881 . IPA is 8,211,571 bytes, SHA256 `0d5314668c4c4f3c72f7c185e1ca0c33bc75a28643bdee2e3977a0456172d746`. Info.plist confirms same bundle ID, 0.1.0/build 3; embedded 2,063,301-byte Hermes bundle contains expected source/API. Provisioned device matches build 2, get-task-allow false, signing expires 2027-10-15; no enabled OTA. Evidence: `tests/runs/build/plan_172/artifact-check.json`. User has the install link and first short launch/navigation/readability/persistence question; reply pending. Cloud success is not a physical pass.

- Additional rendered journey check passes after submission (test-only edit): actual Menu diagnostics sees the covered Feed's one live player; Share/reset preserves selected position/manual pause. No source-digest input changed.

- Phase D: 147/147 mobile tests, seven rendered integration/layout cases and typecheck pass. Production Hermes iOS export succeeds. Build 3 prepared source `77e9aab44e295ef39554be223725855103c2a2f80f7d92896de77f8e592f08e1`; actual EAS archive matches all 77 inputs (78 files including stamp, 464,563 bytes), mobile-only, no credential/fixture/test evidence. Icon alpha/variants verified. Evidence: `tests/runs/build/plan_172/`. Whitespace and 28 doc links pass; agent-docs retains the same 16 older status/header findings. API health passes; Metro/tunnel untouched.

- Phase C host gate: seven rendered cases and typecheck pass, including 320/375 point widths at font scales 1/1.5/3.1; actual resize/paused selection, scalable action labels, scrollable settings/recovery/anonymous Spaces and common control lane. Native glyph bounds/large-text appearance remain unaccepted until physical Phase E.

- Phase B: actual ViewerNavigator/Feed/Menu/Account/Settings/Profile/Spaces render using installed StackRouter and real auth/preferences/journey/coordinator passed: same/different context, current personal detour, direct caller returns, duplicate Refresh, stale command after sign-out and <=3-player cleanup. Menu identity/storage-clear failure/stale sign-out and diagnostics policy cases pass in both Release modes.

- Phase A: actual compact controls/header and FeedScreen/CaptionLayer/coordinator/native-port checks passed in ordinary Release and internal-preview policy (three rendered cases); mobile typecheck passed. Icons generated from owned SVG source to bundled 1x/2x/3x PNGs. Added pinned development-only esbuild/react-test-renderer for reproducible host rendering; no native/runtime dependency added.

- Environment: `/home/ubuntu/aws`, `main`, starting HEAD `a12d2b2117683ad3bb3eec6da64a9df2be1e0722`; starting working tree clean.
- Inspected feed/session/controls, navigator/journey/return, selector/profile/account/preferences/text/player, access/auth owners, archive/identity helper and existing router/auth/journey tests.
- Planning commands: `git status --short`, `git log -3 --oneline`, targeted source reads; pre-edit `npm run check:agents:docs` reports 16 existing status/header findings in older Plans 138, 140–142, 148–159. No product tests run for documentation-only task.
- Post-authoring checks: all 20 relative Markdown links across the three changed documents resolve; required plan sections and six Pending phases verified. `git diff --check` passes; new-plan whitespace checked separately because the file is untracked. Agent-docs checker still reports the same 16 older status/header findings, with no new findings for Plan 172 or its index links.
- Execution evidence will use ignored build/device run directories for plan_172 following Plan 171 harness separation; none is represented as passed during planning.
- Historical host-only gaps before installation: native layout/transition timing, account/lifecycle/upgrade persistence and final performance were pending; final phone evidence above supersedes these except the explicit remaining limits. Access ports in rendered tests are controlled; existing server/access-guard contract coverage is reused because backend and authority code are unchanged. Build 2 remains accepted baseline, not physical acceptance of build 3.

## Open Risks / Deferred

- Full maximum-text-size qualification across all screens, pre/post upgrade-state comparison and physical VoiceOver remain unverified. Header maximum size passed; long-name ellipsis accepted. Menu/user-name checks used larger, not largest text. Other controlled layout cases are host evidence.
- Host controls cover stale-owner/identity/duplicate Refresh, captionless/errors/storage failure, resize and ordinary-Release diagnostic isolation. They do not prove native geometry, screen-reader behavior, AVPlayer memory/battery or public-release qualification.
- Caption files loading longer than300ms still show an honest loading indicator; the confirmed fix removes brief feedback flashes, without delaying cues/errors or changing authorization.
- Protected return Checking Access waits remain current policy. Quieter presentation/faster validation is a separately scoped follow-up candidate; this milestone does not relax freshness or attribute delays to the former development tunnel.
- Earlier whole-app freezes have no proven native root cause. Passing runs cannot prove that cause fixed. Compact diagnostics omit transition/event details and first frames do not establish every transition's motion.
- Signed source changes require a new build. Development tunnel restarts cannot update this embedded app. Private-media delivery, native profiling and TestFlight/App Store need separate plans.

## Resume Here

- E Complete for recorded phone coverage/limits. Build6 installed; brief CC spinner removed; source-matched report and explicit conditions/observations pass. All previous icon/header/navigation/pause/journey/Refresh/lifecycle/preferences/offline-signout evidence retained. No further phone run is needed.
- A–F Complete, including final documentation/checks. Final app0.1.0/build6, EAS `0f520676-1d89-4b8f-9f0a-b21a78fb59c0`, source `9e4731aebeb1c8aafdf99e313bcd1bca7a47292e708fbf978faa72726283ba65`. Final42/42 normal prepared, median104.23ms/p95121.03ms/max124.76ms, peak3, zero errors/incomplete/unexpected playback. Two initial/cold frames remain in report, including1469.71ms maximum.
- Next: user requested commit/push; review and publish the accepted implementation and delivery records. No further implementation or phone check for Plan172. Subsequent discovery/shared links, participation, release qualification or access-return polish need separately scoped planning.
- All-screen maximum text size and pre/post upgrade settings comparison remain unverified; retain tested ranges. VoiceOver user-deferred; native memory/battery, private-media delivery and TestFlight/App Store require separate plans. Quieter/faster Checking Access return is a follow-up candidate without changing current freshness policy.
- No host fixture/account mutation or Metro/tunnel restart. Commit/push explicitly requested; delivery in progress.
