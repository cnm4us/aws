# Plan 189: Video progress, scrubbing and video-bound publication panel

Status: Active

## Feature Reference

- Accepted discovery, subscriptions and playback baseline: [Plan188](plan_188.md).
- Full-width video, centered cropping and black navigation reserve: [Plan178](plan_178.md).
- Creator/date/story panel: [Plan179](plan_179.md).
- Whole-picture silent feed-entry cover: [Plan180](plan_180.md).
- Shared menu and workflow returns: [Plan186](plan_186.md).
- Aggregate feeds and publication-specific actions: [Plan187](plan_187.md).
- Sequence: [native viewing roadmap](../roadmaps/roadmap_native_viewing.md).

## Context

The user accepted all three build48 phone bundles, then requested a progress indicator and scrubber. On the current phone, the creator/date panel straddles the video boundary: the creator is over the picture while the date extends into the black area below. The agreed arrangement puts the entire publication panel inside the video, ends that panel at the video boundary, and places a stationary scrubber immediately below it. Expanded stories continue growing upward. Future Messages/navigation icons belong below the scrubber.

In scope: native iOS Global, groups, channels, Following and Your Creations; shared picture/panel/control geometry; passive progress; explicit touch and accessible seeking; correct pause intent, captions, checkpoints and lifecycle behavior. Preserve current source-specific permissions and actions.

Out of scope: implementing Messages or new navigation icons, web player redesign, purchases, thumbnail previews, live/DVR seeking, frame-by-frame editing, playback speed, chapters, new ranking or moderation features. The existing black bottom navigation reserve remains reserved space.

**Implementation authorized:** the user approved implementation on 2026-10-30 UTC. Native changes and qualified preview delivery are in scope; no backend/database changes or commit/push are requested.

Baseline: primary HEAD `b9ec2f6`, with accepted Plan188 changes still uncommitted. Signed [build48](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/79905b7a-a65c-4e45-9d11-973bd1599e15), source `366faaea625e78b04d01681b96c055f0fc8339e055da23cc7d54c781a60c0304`, is the comparison point. Its265 unit/128 rendered,146 isolated SQL/API,13 browser,34 live API and25 live browser results are historical evidence, not tests rerun for this plan. All three focused build48 phone bundles passed. Protect these uncommitted bytes rather than assuming HEAD alone captures the baseline.

## Locked Decisions

1. Anchor publication metadata to the **visible video boundary**, not the feed page's bottom. Creator and local publishing date/time both stay above that boundary; the panel's bottom aligns with it. Slightly reduce top padding without shrinking creator/arrow touch targets.
2. Put the progress track at that boundary, at the top of its own black control row. Its touch area extends downward into the row, not upward over the metadata. The story and right-side controls must not intercept scrubbing.
3. Keep the scrubber stationary when the story expands or collapses. The panel grows upward within available picture/header bounds, with internal scrolling when necessary. Keep the existing no-story/no-arrow behavior and creator-profile action.
4. Retain width-fit media, video behind the floating top header and equal top/bottom cropping when the phone is too short. Reserve scrubber height before calculating the media's usable height; do not compress/stretch the image or silently hide the control on short phones.
5. Preserve the existing separate64-point navigation reserve plus bottom safe area. Place no placeholder Messages buttons in it. Tall phones and short/square/landscape sources may retain black spare space below the scrubber.
6. Progress operates for the selected source in release builds even when captions and diagnostics are off. It must not add players or feed-wide renders for every clock update.
7. Dragging previews a target time and temporarily pauses/mutes playback. Release commits one seek. Resume only if the user had not paused and all current visibility/access/lifecycle conditions permit playback. Do not turn this temporary hold into a saved user pause.
8. First version previews the time/thumb while dragging, not continuously decoded video frames. Tap-to-seek and VoiceOver adjustments use the same guarded commit path. No seek per finger-move event.
9. Save only confirmed playback positions. A preview target or an unresolved seek must never become Continue's saved position or Report's captured time. A successful seek requests prompt checkpoint persistence.
10. Playback authority stays in the coordinator. Cancellation, old callbacks, account/source/feed changes, menu/navigation, backgrounding and access loss cannot seek or resume a different player.

## Source Audit

| Area | Observed behavior and implication |
| --- | --- |
| [Feed geometry](../../mobile/src/feed/feedGeometry.ts) | `feedGeometry()` already returns `mediaTop`, `mediaHeight` and `visibleHeight`; short phones crop equally, shorter media starts at the top. The feed page and visible picture can have different bottoms. Add explicit control bounds without making the FlatList page height vary by source aspect ratio. |
| [FeedCard](../../mobile/src/feed/FeedCard.tsx) | Publication wrapper is fixed at page `bottom:28`; it does not use the video's `visibleHeight`. This explains the reported straddling. Poster and video already receive geometry and must continue sharing it. |
| [Publication panel](../../mobile/src/content/StoryPanel.tsx) | Panel padding is10, bottom8; creator target44; metadata minimum65; bounds derive from page height/header. Arrow44 and scrolling already exist. Recompute available panel height from its new bottom; trimming padding alone cannot fix anchoring. |
| [Feed session](../../mobile/src/feed/FeedScreen.tsx) | Owns fixed-height vertical paging, source geometry, story gesture suppression, caption offset, right control lane, full-picture cover and checkpoint registration. Existing `textEligible` must not be reused as a scrub hold if doing so clears/collapses the story. Scrubbing needs its own interaction/eligibility state. |
| [Video surface](../../mobile/src/playback/VideoSurface.tsx) | Native controls are disabled and a full-surface press toggles pause. The new row needs separate hit ownership, and video taps must not toggle pause during a scrub/seek. Loading/access masks keep precedence. |
| [Coordinator](../../mobile/src/playback/coordinator.ts) | Owns selection, user pause, lifecycle, mute, three-player window, restoration and scalar checkpoints; there is no explicit interactive seek operation. Add one rather than writing `player.native.currentTime` from the UI or treating scrubbing as feed scrolling. |
| [Native player adapter](../../mobile/src/playback/useFeedPlayback.ts) | Exposes current time, actual loaded duration and bounded `seekTo`; current confirmation polls timeline within1 second for up to8 seconds. That is not proof of a displayed target frame. Looping remains enabled. Diagnostics-only progress cannot power the public UI. |
| [Shared clock](../../mobile/src/playback/captionClock.ts) | Existing release-capable clock multiplexes subscribers, samples immediately, uses0.25-second events and restores the diagnostic interval after the last subscriber leaves. Reuse it for progress, including caption-free videos, with independent subscriber lifetimes. |
| [Captions](../../mobile/src/content/CaptionLayer.tsx) | Placement uses measured text height plus a fixed bottom offset. Reanchor to the panel's actual top. The current resubscribe dependencies include pause but not successful interactive seeks; paused seeks need an explicit immediate resample so old cues cannot linger. |
| [Persistence](../../mobile/src/navigation/ViewerNavigator.tsx) | Navigator persists periodically, on background/removal and through `onPersist`; current feed's immediate persistence effect follows presentation/pause, not seek completion. Add a confirmed-seek notification without writing checkpoints on every drag event. |
| [Local readiness bridge](../../mobile/src/playback/readinessEvidence.ts), [Swift module](../../mobile/modules/viewer-readiness/ios/ViewerReadinessModule.swift) | Entry preparation has a singleton request, paused/muted prerequisites and decoded-frame probe. Do not call it for every drag or cancel it accidentally from a separate scrub operation. Keep entry reveal behavior intact. |

## Layout Contract

```text
Full-width video, beneath the existing floating header
  Publication panel, aligned to the picture's lower edge
    Creator name                 Expand/Collapse when applicable
    Local publishing date/time
    Story when expanded; panel extends upward
────────────────────────────────── Visible video boundary / progress track
Black scrubber touch row; selected time while interacting
Optional black spare space on taller phones / shorter source shapes
Existing black navigation reserve + bottom safe area
```

- Introduce a single testable layout calculation for page height, media viewport, visible picture bottom, publication bounds, scrubber bounds and caption baseline. Pass the same result to poster, video, panel and controls. Do not derive the boundary separately from uploaded dimensions when loaded presentation size is available.
- Start with a44-point scrubber row and a2–3-point visible track; measure/enlarge the row if scaled interaction labels require it. Keep the row's footprint stable between idle, dragging and seeking so the picture does not jump. Track/labels respect horizontal safe areas; the picture remains full width.
- Keep the existing FlatList page height and snap offsets fixed. The picture's maximum visible height becomes the page height minus the control row, while its fitted height still follows source aspect ratio. The scrubber starts at the resulting visible picture bottom. Extremely small/zero layouts remain finite and noninteractive until measured.
- Place the publication panel immediately above that bottom with no page-bottom offset. Start by reducing top padding from10 to6 points; preserve44-point creator/arrow targets, readable date and dynamic type. Bound expansion above the scrubber and below the floating header; use existing internal scrolling for constrained metadata/story space.
- Captions sit above the collapsed panel with a small gap; expanded stories retain their existing caption suppression and captions return after collapse. Bound the right control lane away from the scrubber without reintroducing avatar/Follow jumps.
- A size/presentation change during a drag cancels that drag before remapping coordinates. Normal source-size discovery may settle geometry once; it must not move a live thumb beneath a finger or change the selected page.
- On empty/footer/unavailable sources, do not show a working scrubber. Unknown duration shows a disabled neutral track rather than a fabricated percentage. Entry/access covers hide and disable timeline/private metadata together.

## Progress and Seeking Contract

### Display and availability

- Use the selected player's finite current time and positive finite **loaded production duration**. Upload duration may describe an earlier edit; it is not seek authority. Re-read duration after readiness and subsequent source/clock updates when initially unknown.
- Passive progress is clamped to0–100%; a normal loop resets the bar to the beginning without selecting another publication. Format `m:ss`, or `h:mm:ss` when needed. While dragging show the candidate time and duration; return to a quiet thin track afterward.
- Subscribe locally in the progress component, shared with the caption clock. Do not publish every tick into the feed store/coordinator snapshot or rerender all FlatList cards. Release subscriptions on unmount, selection, background/visibility loss and source change; diagnostics retain their own policy.
- Enable interaction only for the current authorized, presented, active, measured source with a valid duration and no conflicting restore, failed state, feed swipe or seek. New requests during a pending seek are disabled for this first version.

### Gesture and coordinator operation

1. At gesture start, validate source identity, current activation, feed/auth visit and eligibility. Capture the actual scalar position and original user pause intent. Acquire a distinct temporary seek hold that pauses/mutes before any native seek and blocks page swiping/video pause taps.
2. During horizontal movement, clamp the candidate against measured track bounds and duration. Update only local preview state. Handle out-of-bounds movement and responder termination; do not fall through to the full-video press surface.
3. On release, validate the same identity again and issue one bounded seek through the coordinator/player port. Clamp the end target slightly before duration, consistent with the existing restoration guard, so looping does not immediately discard the intended end position. Keep audio held while pending and show seeking feedback in the row.
4. Confirm the native timeline through the adapter; sample and display the actual result. Treat the current1-second timeline tolerance as an explicit existing limit, not frame-accurate evidence. Qualify paused forward/backward seeks on the phone. If public adapter confirmation cannot reliably establish completion for this control, add a separate bounded, attempt/player/item-scoped native completion method before release; do not reuse the global entry-preparation singleton or silently accept a wrong frame.
5. After a successful, still-current result, clear the hold, notify captions to resample immediately, and request persistence once. Restore original user pause intent and let the coordinator reconcile current mute/access/visibility. Successful resolution alone does not authorize playback.
6. A pre-commit cancellation seeks nowhere and restores the original playing/paused intent only if still eligible. If a committed seek is interrupted, invalidate its completion and retain the last confirmed pre-seek checkpoint; reestablish that confirmed position before later playback if the native seek moved the retained player. Feed replacement can discard that player normally.
7. A current seek failure/timeout stays silent with retry/cancel feedback; do not resume an uncertain position or permanently label the user as paused. Retry remains bound to the same selected item and target. Cancellation/recovery resolves to a confirmed position before playback is eligible again.

Use existing React Native responder/PanResponder facilities first; no slider dependency is needed by the design. Suspend pending paging settlement while the scrubber owns a gesture and restore it on release/cancel; feed swipes outside the row remain unchanged. Give story scrolling and scrubbing separate owners so one ending cannot release the other's lock.

### Lifecycle, checkpoints and accessibility

- Selection, URL/production replacement, auth/API generation, access expiry/revocation, background, navigation and disposal invalidate the gesture/seek token. Ignore late UI/native completions and release timers/locks. Preserve the three-player cap and the existing fresh-player behavior between feeds.
- During preview or pending completion, `checkpoint()`/`capture()` expose the last confirmed position and original user pause intent. On success, include the new confirmed position. Report/menu/rules/comments/profile and feed switching cannot capture an uncommitted thumb value. Preserve current independent checkpoints for ordinary and aggregate destinations and exact publication context.
- Suppress stale caption text during a pending seek and resample on success even if the source remains paused or no time event arrives. Do not force protected story/caption renewals merely because the user starts dragging.
- Expose an adjustable control labeled “Video position,” with current/duration text, disabled/seeking state and increment/decrement actions. Start with5-second adjustments, clamped to valid bounds and routed through the same seek operation. No unsolicited spoken announcement on each passive clock tick. Keep the44-point touch area and readable interaction labels at large text sizes.

## Phase Status

- A: Complete — protect accepted48 and finalize geometry/operation contracts.
- B: Complete — coordinator-owned seeking, progress clock and checkpoint semantics.
- C: Complete — panel geometry, scrubber UI and gesture/caption integration.
- D: Complete — integrated host and signed-artifact qualification.
- E: Focused build52 gesture/playback acceptance passed; broader physical caption/VoiceOver/large-text/device coverage remains unconfirmed.

## Phase A — Baseline and layout/state contracts

- Goal: make layout and ownership explicit before changing playback.
- Steps:
  - [x] Snapshot current accepted source, including uncommitted Plan188; isolate implementation and retain signed48 evidence.
  - [x] Define pure layout/time/coordinate functions, fixed page versus picture/control bounds, invalid-size behavior and large-text measurements.
  - [x] Specify idle/dragging/seeking/error states, operation tokens, independent story/paging locks, cancellation and confirmed-checkpoint rules.
  - [x] Confirm actual loaded seek/duration behavior from the installed adapter and choose the completion path described above; record its precision and timeout limits.
- Test gate: meaningful boundary cases for tall/short phones, portrait/square/landscape/unknown source, safe areas, large text, 0/end/invalid time and track coordinates. No product/database rollout.
- Acceptance: one video boundary drives all affected placement and an explicit state contract prevents preview/pause leakage.

## Phase B — Progress and guarded seek ownership

- Goal: provide selected-player progress and seek operations independent of diagnostics.
- Steps:
  - [x] Add coordinator begin/commit/cancel/retry semantics and a transient hold without changing `userPaused`; keep native mutation out of UI components.
  - [x] Reuse the shared release clock and finite actual duration with minimal selected-component updates.
  - [x] Implement bounded confirmation, stale-result protection, native cancellation if required, and silent failure/recovery behavior.
  - [x] Make capture/persistence observe confirmed scalar state; signal successful seek for persistence/caption resampling.
- Test gate: coordinator tests for paused/playing/muted seeks, forward/back/end, cancel, timeout, access/background/navigation/disposal races, source replacement, no extra allocations, one seek per commit and late callbacks. Clock tests with captions and diagnostics both off, both on, independent subscriber cleanup and selected-player replacement.
- Acceptance: only a current operation can alter playback; user pause survives success/cancellation and no speculative target reaches storage.

## Phase C — Video-bound panel and scrubber integration

- Goal: deliver the agreed layout and reliable touch/accessible behavior across feeds.
- Steps:
  - [x] Use shared geometry for poster/video, move creator/date panel wholly inside the picture, trim padding and bound story expansion upward.
  - [x] Add stationary progress row with drag/tap/accessibility controls, candidate time and seeking/error feedback.
  - [x] Separate responder/paging/story ownership; block accidental pause/page gestures and keep right controls clear.
  - [x] Reanchor captions and resample after seek; retain creator navigation, date formatting, no-story behavior and opaque entry/access masks.
  - [x] Wire confirmed completion to existing persistence without backend/schema changes or extra player reuse.
- Test gate: rendered real FeedScreen/coordinator integration, panel and caption tests at narrow/tall/short layouts and large text. Assert fixed page/row positions, no touches through masks, interaction cancellation, no erroneous swipe/pause, per-source progress, actual captured Report time and saved destinations. Extend the controlled-native harness only for exercised responder/seek behavior.
- Acceptance: creator and date fit above the video boundary, expansion leaves the scrubber fixed, and every enabled control has a real bounded action.

## Phase D — Host and preview qualification

- Goal: qualify the integrated change and protect accepted48 before delivery.
- Steps:
  - [ ] Run relevant phase tests; then native typecheck, unit and rendered suites once for the completed change. Record actual counts; do not reuse48's counts as new results.
  - [ ] Verify Global/space/Following/Creations, duplicate publications across spaces, access renewal/denial, navigation detours, interrupted seeks, captions/story coexistence and saved resume.
  - [ ] Check release mode with captions/diagnostics disabled; test host render/clock work stays bounded and the three-player cap is unchanged.
  - [ ] Guard primary promotion against the captured accepted/uncommitted bytes. Confirm no backend, flags, discovery preferences, subscriptions, public listings or web assets changed.
  - [ ] Build the next available iOS preview after host gates (49 is the current candidate, not reserved). Verify source manifest, export, exact archive whitelist and downloaded IPA identity/API/native module/signing/device/OTA policy before sharing.
- Test gate: `npm run typecheck`, `npm test`, `npm run test:ui` from `mobile`; exact preview export/archive/artifact verification; docs baseline/link/whitespace checks. Run additional backend/web tests only if actual implementation dependencies expand there and update scope first.
- Acceptance: qualified installable preview and honest evidence limits, with accepted48 recoverable.

## Phase E — Focused phone acceptance and records

- Goal: verify physical layout, gestures, seeking and audio where host tests cannot.
- Steps:
  - [ ] Layout: Global and another feed; creator/date wholly above picture bottom; progress immediately beneath; no-story and expanded long story; fixed scrubber and reachable creator/arrow; representative landscape/square source if available.
  - [ ] Seeking: playing and paused forward/backward drags, tap, cancel, start/near-end and unbuffered seek; correct resulting picture/time, no wrong-video swipe or pause toggle, no audio while held; resume only previous playing intent. Confirm normal looping.
  - [ ] Accessibility/layout: large text, safe-area clearance, VoiceOver adjustable actions and honest unavailable/unknown-duration state. Record any device size that cannot be physically checked rather than claiming coverage.
  - [ ] Returns: seek to a distinct time, Menu/rules/report/comments/profile and feed switch/return, then reopen app; correct position/pause, clear audio, silent covers, synchronized captions and smooth ordinary swipes. Report captures confirmed time.
  - [ ] Record replies against the exact signed source, keep any unsupported native behavior open, update index/roadmap/status and retain explicit limits.
- Test gate: focused user phone replies plus any required source-specific retest, not simulated pixel/audio claims. No fixture/publication edits merely to create coverage without authorization.
- Acceptance: focused physical bundles pass; no commit/push unless requested separately.

## Files and Ownership

- Geometry/composition: [feedGeometry](../../mobile/src/feed/feedGeometry.ts), [FeedScreen](../../mobile/src/feed/FeedScreen.tsx), [FeedCard](../../mobile/src/feed/FeedCard.tsx), [StoryPanel](../../mobile/src/content/StoryPanel.tsx), [VideoSurface](../../mobile/src/playback/VideoSurface.tsx).
- Playback/time: [coordinator](../../mobile/src/playback/coordinator.ts), [native adapter](../../mobile/src/playback/useFeedPlayback.ts), [shared clock](../../mobile/src/playback/captionClock.ts), proposed `mobile/src/playback/PlaybackProgress.tsx` and small pure helpers as needed. Keep the existing exported clock name compatible if generalized.
- Caption/persistence integration: [CaptionLayer](../../mobile/src/content/CaptionLayer.tsx), [ViewerNavigator](../../mobile/src/navigation/ViewerNavigator.tsx); local readiness bridge only if completion qualification establishes a need.
- Tests: existing geometry/coordinator/clock, rendered panel/caption and navigation harness; add focused progress/seek tests for contracts, not tests that merely mirror style constants.
- Plan/index/roadmap and ignored evidence under `tests/runs/build/plan_189/`. Secrets, private logs and raw provisioning remain excluded from source/build inputs.

## Validation

- Planning environment: `/home/ubuntu/aws`,2026-10-30 UTC; no applicable AGENTS.md found. No agents or skills used. Read planning/template/policy/UI index and relevant current native source, installed player types and test harness.
- Planning used a private1309-file source snapshot; only plan189/index/roadmap changed then. Implementation now uses a separate1310-file snapshot covering accepted uncommitted188 and the approved189 plan.
- Documentation baseline `/dev/shm/plan189-docs-before.log` and final `/dev/shm/plan189-docs-after.log` retain the same16 pre-existing findings, zero new. All79 local links across plan/index/roadmap resolve; whitespace check passes. The planning1309-file snapshot confirmed only index/roadmap changed and plan189 was added in that turn. Implementation evidence follows below.
- Planning evidence above remains historical. Implementation is now authorized; new qualification is recorded in Implementation Notes. No backend/database/flags/web/payment mutation is needed.

## Open Risks / Deferred

- HLS seeking can require unbuffered data; the current timeline guard does not prove displayed pixels. Physical paused-seek confirmation is a delivery gate, and a separate native completion bridge is conditional work, not presumed complete.
- Responder arbitration cannot be fully proven with the rendered harness. Test cancellation and vertical swipes on the actual iPhone, including opening navigation during a pending seek.
- Very short picture regions, large text and the floating header constrain how much metadata/story fits; retain accessible scrolling and record actual device coverage. Reserving a scrubber row slightly reduces the short phone's visible video height, while preserving symmetric cropping.
- Live/DVR streams, continuous visual previews, editing precision, haptics, speed/chapters and new bottom icons are deferred. Unknown/non-finite duration remains noninteractive.
- Android and web parity are separate tasks. Existing discovery/payment/moderation/age-policy work is unchanged; purchases remain deferred under Plan188.

## Change Log

- 2026-10-30 UTC — User authorizes implementation. Completed host-qualified layout, coordinator/clock, independent native completion/cancellation and integration tests; signed49 delivery underway.
- 2026-10-30 UTC — User approves the discussed panel/scrubber arrangement and requests an implementation plan. Audited geometry, pause/seek ownership, shared clock, captions, lifecycle and persistence; drafted A–E. No implementation commit exists.

## Resume Here

Build52 focused gesture/playback phone checks pass: direct horizontal scrubbing on/above/below/near left end no longer exposes Home; vertical paging outside the zone and Menu → Home work; selected seek time, pause intent, silent seeking and clear audio pass. Earlier panel-spacing acceptance remains recorded. No further gesture fix is pending. Caption synchronization, VoiceOver, large text and other-device physical coverage remain unconfirmed. Source remains uncommitted; do not commit/push without user request.


## Implementation Notes

- User authorized implementation. Isolated worktree preserves all1310 primary source/doc files including accepted uncommitted188/189. Native-only change; no server/web/database/flags actions.
- Shared geometry reserves a stable56-point minimum scrubber row, enlarged for font scale. Panel anchors to `visibleHeight`, media/poster clip at that edge, captions/right controls stay above it, and fixed FlatList height/navigation reserve remain.
- Interactive seeking has a distinct coordinator hold; previews never seek or persist. One confirmed seek increments a revision for immediate captions/checkpoints. Cancel/background/navigation preserve original confirmed position and pause intent, with rollback before playback returns. Captions are hidden during seek without renewing protected text.
- Added an independent attempt/player/item-scoped AVPlayer completion bridge (`seekAsync`/`cancelSeekAsync`) with8-second native bound, exact native tolerance and cancellation. It attaches no video output and leaves decoded-frame entry preparation intact. JS timeout is8.5 seconds. Apple documents pending-seek cancellation and interrupted completion in [AVPlayerItem.cancelPendingSeeks](https://developer.apple.com/documentation/avfoundation/avplayeritem/cancelpendingseeks%28%29); inspected2026-10-30. Native completion/timeline is not pixel proof.
-275 unit tests/typecheck and136 rendered tests pass; targeted five scrubber cases also pass after adding globally unique seek IDs across coordinators. Signed49 qualification follows. Paused-caption resampling fixture uses non-merged cues so it tests timeline changes rather than the existing short-cue merging behavior.

- Final [build49](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/a315d6fe-0b96-436c-b13a-35911d46d1f1) source `c6e3a381ea16b1729d7e441597143099b443c9c84fd60bfdc1841e2f870ba19e`:183 public inputs/184 archive files, Hermes export2500092 bytes; downloaded IPA8473137 bytes, SHA256 `37d6c75ef1496330f4268fe69169909a1da080fe2247314c3320e46b92443a45`. Bundle source/API/UI markers and compiled native TimelineSeekRequest/bridge paths verified, provisioning matches accepted26, OTA disabled. Swift small string optimization prevents assuming short method names must appear contiguously in the executable; unique compiled type/error paths plus exact source archive verify the bridge. Physical pixels/audio/gesture and VoiceOver coverage remain pending.
- Guarded promotion compared all1310 primary files to the captured accepted bytes and copied only22 authorized native/test/docs files, with private backups. No backend/web/schema/flag/user record changes. Original188 uncommitted changes remain intact. No commit/push requested.


### Build49 physical feedback

- User confirms creator/date are inside the video and progress is immediately below. Horizontal inset is now too thin: implementation changed general panel padding10 to6, including left/right, although the intended trim concerned the top. Creator's centered44-point name-only target also leaves visual space above/below the name. Restore horizontal inset and compact visible metadata while retaining a sufficiently large combined metadata/profile target.
- User reports touches aimed directly at the line/thumb frequently initiate feed swiping; deliberately starting below the line works. Current hit rectangle starts at the line and extends only downward. Gesture acceptance remains open. Proposed revision: a narrow area above/below the line with horizontal-intent arbitration above it, plus a small persistent thumb enlarged while dragging. Preserve creator/arrow taps and vertical story/feed scrolling outside the scrub zone. This proposal is under discussion, not yet implemented.
- User answers yes to the full third bundle: confirmed seek time in Report, menu/rules/report return position/pause, feed switching/reopen persistence, clear audio, silent covers and smooth ordinary swipes. Record that bundle as passed. The reply does not separately confirm story scrolling, large text, captions or VoiceOver, and the second gesture bundle is not passed.
- No product source or build changed while reviewing this feedback.


### Build50 revision — authorized implementation

- User approves the spacing and gesture proposals. R1 protects1314 primary files including uncommitted188/189 and the complete49 feedback; implementation is isolated in a new worktree.
- Panel uses12-point horizontal inset,4-point top and6-point bottom inset. Creator/date share one minimum44-point profile target; metadata minimum44 replaces65, removing the name-only centered target gap. Published time remains available in the profile target's accessibility value. Story retry/arrow targets remain44 points.
- A parent responder observes starts in a20-point strip above and8 points below the line, claims only horizontal intent (at least6 points and1.5 times vertical movement), and delegates to the same guarded seek operation. It places no intercepting view over the story or creator. Above-line vertical scrolling/taps retain child ownership; direct below-line track touch retains its existing behavior. Native pager callbacks cannot mark scrolling or select a row once a seek owns the gesture. FlatList directional locking is enabled.
- Parent capture accounts for stage screen coordinates and track inset, uses activation-bound touch candidates and resets on layout/eligibility/visibility changes. Taking horizontal ownership releases the story touch lock. Responder termination cancels the preview; pending seek/native cancellation/checkpoint behavior remains unchanged from49.
- A persistent8-point thumb marks current position and enlarges to12 while dragging/seeking. Track/time/picture boundaries and56-point lower grab row are unchanged. No native bridge, backend, web, data or provider changes.
- New tests cover horizontal versus vertical/tap intent, persistent/enlarged thumb, combined profile target, actual navigator capture above the line (including metadata lock and late paging callback) and cancellation. Final suite/build50 qualification follows; physical finger behavior remains a phone gate.

- R1 host qualification passes:276 unit/140 rendered/typecheck; exact183-input/184-file archive/export verification with source `18503f785deb606fbd09b26fd4a97ad1e883120f624b10861147d0152ffa2bf8`. Build50 is submitted; downloaded native/signing verification and physical acceptance follow. Initial Follow test failures were selector ambiguity from metadata also gaining a hint; publishing time now uses an accessibility value, preserving both date announcement and existing avatar-hint meaning. No Follow implementation changed.

- Final [build50](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/9c3adeae-9d4f-49eb-b5eb-d8895fa759cb) source `18503f785deb606fbd09b26fd4a97ad1e883120f624b10861147d0152ffa2bf8`: downloaded IPA8475367 bytes, SHA256 `7cd73a90a21cfc5dbef1fdda423bf71e1f5c7abc30e5dc2b329bb0fc48c8906a`. Persistent-thumb/bundle/source/API/compiled native bridge/signing/accepted-device checks pass, OTA disabled. Guarded promotion preserves all1314 captured primary files except13 authorized revision paths, with private backups. Primary source matches the signed archive.276 unit/140 rendered/typecheck pass; documentation retains16 pre-existing findings,81 local links resolve, whitespace passes. New physical spacing and gesture acceptance remains pending;49 return/playback acceptance is retained, not claimed as new50 physical evidence.


### Build50 feedback and build51 touch ownership revision

- User accepts creator/date spacing and visible thumb. Direct horizontal dragging can still lose ownership to paging; a vertical initial movement avoids the collision. Build50 gesture acceptance therefore remains failed, not complete.
- User explicitly authorizes a reserved scrubber zone: touch-down anywhere in the track row or20 points above it claims the responder immediately, without directional arbitration. Grant blocks native responders; active ownership refuses termination and pager callbacks remain guarded. Release/cancellation use the existing seek/rollback path.
- Panel is raised20 points to keep creator/story controls outside the reserved band; accepted internal metadata spacing is unchanged. Captions move with that clearance. Outside-zone feed/story gestures retain existing behavior. Error Retry/Cancel controls remain available because an unavailable seek port does not claim touches.
- Native bridge/backend/web/data unchanged. Build51 host qualification and signed delivery follow. Physical immediate-horizontal and vertical-motion ownership must be checked on iPhone; captions/VoiceOver/large-text coverage remains unconfirmed. No commit/push authorized.

- R2 host qualification:276 unit/140 rendered tests and typecheck pass; expanded focused tests also confirm native blocking on grant, refusal to yield, continued ownership outside the band, lower-band capture and outside-band rejection. Exact183-input/184-file source/archive/Hermes verification passes for51 source `9e3c0e21795023aee8661507821430b66e5d773c36b803d06b6a9030e4dc3113`. Native build pending; no physical acceptance claimed.

- Final [build51](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/407e5775-5020-4690-ac85-d774feecfa48) verified: IPA8475314 bytes, SHA256 `783a72547fd207e2218c6f5662232885c884178236a5966f02990b96886e23a3`; exact source/API/bundle/native bridge/accepted signing-device/OTA-disabled checks pass. Unit276/UI140/typecheck pass; documentation findings unchanged, whitespace passes. Await immediate horizontal drag, vertical-motion retention and controls/playback iPhone checks. Changes remain uncommitted.


### Build51 physical feedback — horizontal ownership still unresolved

- User reports direct horizontal line/knob dragging still has fragile ownership; an initial vertical movement then horizontal drag holds reliably. Build51 physical gesture gate fails. Host tests do not simulate UIKit gesture recognition and are insufficient evidence of native ownership.
- Investigation found Feed has no gesture override; installed react-native-screens RNSScreen.mm `isFullScreenSwipeEffectivelyEnabled` enables undefined full-screen swipe on iOS26. RNSScreenStack.mm accepts native content-pop recognizers independently of React responder ownership. This is a concrete competing horizontal recognizer, while the video FlatList pages vertically. Asked user whether movement exposes the prior screen horizontally or advances a video vertically before choosing further native changes.


### Build52 — confirmed native navigation conflict

- User confirms failed scrubs move the Feed sideways and expose Home, identifying interactive navigation pop rather than vertical video paging.
- Feed now explicitly sets native-stack `gestureEnabled:false` and `fullScreenGestureEnabled:false`. Installed RNSScreenStack checks the first flag before accepting navigation touches; the explicit second flag also overrides the iOS26 undefined/full-screen default. Feed menu navigation remains available; no other screen changes. Existing reserved scrubber band, metadata layout and vertical video paging remain unchanged.
- Rendered release navigator test checks both actual Feed screen options while exercising scrub/pause/menu restoration. Native iOS recognizer competition remains a physical acceptance gate; prior JS responder tests could not simulate it. Build52 delivery qualification follows. No backend/web/data/native bridge changes or commit/push.

- Final [build52](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/0477f358-f824-4e59-9036-977180f3e5b5): source `236d40ea0e20af0e7db5ae3e54a4ddd36d248c404eaaf1db70e4460fc33ea821`,183 public inputs/184 archive files; IPA8475474 bytes SHA256 `08f1e4084890ad8a1574489c565350fe50061211b3b44cffb74007bc7c95bdb2`. Source/export/archive/downloaded bundle/native bridge/signing/accepted-device and OTA-disabled checks pass. Typecheck/140 rendered tests pass; prior276 playback unit tests apply to unchanged playback code. Documentation findings unchanged; whitespace passes. Await iPhone immediate-horizontal scrub and vertical paging/menu confirmation. No commit/push.

### Build52 focused physical acceptance

- User confirms direct horizontal scrubbing on the knob/line, just above/below and near the left end stays in scrubbing without exposing Home.
- User confirms vertical video swipes outside the zone, Menu → Home, correct selected time and paused/playing intent, silent seeking and clear playback audio.
- This closes the reported navigation-versus-scrubber defect. Prior spacing/thumb acceptance remains; do not infer caption/VoiceOver/large-text/other-device coverage from these replies. No product changes, new build, commit or push in this acceptance turn.

## Commit delivery

- Implementation committed as `2652677` after explicit user request to commit and push. Includes accepted Plan188 discovery/independent shortcuts/subscription gates and Plan189 scrubber through build52. No new purchase support. Push verification follows; broader physical coverage limits remain as recorded.
