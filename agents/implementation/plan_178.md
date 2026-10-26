# Plan 178: Uniform edge-to-edge feeds, Space switching and a bottom navigation reserve

Status: Active

## Feature Reference

- Feature contract: [Personal Space, Global Feed, and Context Integrity](../features/feature_02_personal-space-global-feed-context-integrity.md).
- Predecessor: [Plan177](plan_177.md), including the accepted build29 loading/paging experience and fresh native player ownership.
- Carryovers: [Plan175](plan_175.md) and [Plan176](plan_176.md) retain their explicitly open acceptance/cleanup limits.
- Roadmap: [Native viewing](../roadmaps/roadmap_native_viewing.md).

## Context

The user sees full-width video in Global and small side margins after launching into a space on iPhone. They want one presentation rule for Global, personal, group and channel feeds. They propose removing Back to Global, using the Space selector for feed changes, placing video underneath the system status indicators, making Spaces an80% black overlay and reserving a black bottom area for future Home, Friends, Inbox, Profile and Search navigation.

The user explicitly agrees that shorter screens should crop equal amounts from the top and bottom while keeping full width and the original proportions. When the width-scaled video fits vertically, it stays top-aligned and remaining space is black below it.

The initial request authorized investigation and planning. The user then explicitly approved this plan and requested implementation. Product implementation and the next signed preview were authorized. The user now accepts the delivered increment with “Looks good” and explicitly requests commit/push; no fixture/session mutation is requested. The predecessor source is committed/pushed as `cb2c93fad7aed427f9bc68e1a8451779e00c3b68`. Build29/source `510f514563851fd61c0ec9ad0abfe7d706a52f648ac0f03a7fd678b2d1fe4cf9` remains the comparison artifact. Its accepted qualitative loading/paging behavior and227 unit/71 rendered tests belong to that source; no new layout is qualified by them.

### Scope

- In scope: shared feed geometry, status-area video, floating header, equal vertical crop, matching poster geometry, fixed paging viewport,80% Spaces overlay, removal of Back to Global, safe checkpoint restoration through the Space menu, captions/actions/error/loading placement and a reserved black bottom region.
- Proposed first increment: reserve the bottom region without exposing inactive Home/Friends/Inbox/Profile/Search buttons. Their intended order and meaning are documented below for follow-on implementation. This scope follows the discussion's layout-first direction; it is not authorization to build five new features.
- Out of scope: changing the web frontend, new feed/social/search APIs, new relationship semantics, joining/payment/age/approval, backend authorization redesign, media encoding/CDN changes, SDK upgrades, native audio mixing changes, landscape app support or public-store distribution.
- Constraints: preserve a fresh pool on actual feed changes, at most3 live players, one permitted playback owner, no native player transfer between feeds, named Loading splashes and smooth ordinary paging. Follow remains context-scoped; Global stays discovery-only.

## Investigation Findings

| Inspected source | Established behavior and consequence |
| --- | --- |
| [FeedScreen](../../mobile/src/feed/FeedScreen.tsx), [FeedHeader](../../mobile/src/ui/FeedHeader.tsx), [Message/Action](../../mobile/src/ui/Message.tsx) | The feed is inside a top/bottom SafeAreaView. A normal-flow toolbar precedes the video. Launch destinations add Back to Global as a separate minimum44-point row with an8-point header gap. Back to profile also occupies a separate row. This reduces video height while width remains shared. It is a strong explanation for the reported portrait margins, not a measured phone diagnosis. |
| [VideoSurface](../../mobile/src/playback/VideoSurface.tsx), [FeedCard](../../mobile/src/feed/FeedCard.tsx) | Both contexts share full-container video with `contentFit="contain"` and contain-sized posters. A shorter container can therefore yield narrower portrait imagery. Removing horizontal padding alone would not address this path. |
| [FeedScreen paging](../../mobile/src/feed/FeedScreen.tsx), [PagingController](../../mobile/src/playback/paging.ts) | One measured height controls page rows, getItemLayout, offsets, Next and settled selection. Media aspect ratio must not change this page height, or landscape/mixed-aspect clips will break paging. |
| [SpacesScreen](../../mobile/src/spaces/SpacesScreen.tsx), [ViewerNavigator](../../mobile/src/navigation/ViewerNavigator.tsx) | Spaces is currently a regular native-stack screen with an opaque black ScrollView. Its `select` clears journeys and transitions without a restore checkpoint. Removing Back to Global without changing selection loses the existing exact return behavior. Selecting the current context already avoids a transition. |
| [LaunchSpacesScreen](../../mobile/src/spaces/LaunchSpacesScreen.tsx), navigator Launch route | Existing Launch provides the reusable pattern: header hidden, transparentModal/fade, one80% black scrim, fixed Close, safe-area content and source feed retained only while the chooser is open. Actual destination selection releases the old pool and uses its own Loading splash. |
| [ViewerJourney](../../mobile/src/navigation/viewerJourney.ts), [GlobalLaunchJourney](../../mobile/src/navigation/globalLaunchJourney.ts) | Separate bounded scalar origins preserve Creator detours and exact Launch publication/time/pause. They still serve exact-target validation and Retry; removing a button does not make these modules obsolete. |
| [useViewerFeed](../../mobile/src/feed/useViewerFeed.ts), [GlobalFeedMemory](../../mobile/src/feed/globalFeedMemory.ts) | Anchored loading and unavailable-origin feedback already exist. Only one authorized public data window is cached; it is not a general checkpoint store. Scalar per-feed memory must not become a protected-page or player cache. |
| [useFeedPlayback](../../mobile/src/playback/useFeedPlayback.ts), installed Expo Video57.0.5 types | HLS contentType is already explicit. The native player exposes current track size and sourceLoad/videoTrackChange events, but our port does not currently publish dimensions. Feed width/height metadata exists, but production edits can make upload geometry an imperfect fallback. Source-scoped dimension observation needs cleanup/stale-event guards. |
| [Native readiness module](../../mobile/modules/viewer-readiness/ios/ViewerReadinessModule.swift), [entry gate](../../mobile/src/playback/feedEntryReadiness.ts) | Existing decoded evidence includes pixel-buffer width/height at entry. Raw buffer size alone does not prove display orientation or crop geometry. Do not add native seeks/output readers to ordinary swipes just to measure layout. Changing the actual viewport requires a new physical presentation check, not another default diagnostic campaign. |
| [App](../../mobile/App.tsx), [IconButton](../../mobile/src/ui/IconButton.tsx), captions/story/engagement components | Status indicators already use light content. SafeAreaProvider can remain while video bypasses top padding. Header and44-point actions still need measured safe insets. Text, story and right-side actions currently use page-relative bottom offsets and must move with the new visible region. |
| [FeedContext](../../mobile/src/feed/context.ts), [native viewer router](../../src/routes/viewer.ts), [feed services](../../src/features/feeds/service.ts) | The native client currently has Global and individual space contexts. No native Home/Following, Friends, Inbox or group/channel Search screen is wired. Existing web [HomePage](../../frontend/src/app/HomePage.tsx) is a CMS page, not the requested Following feed. Existing web/backend features do not establish complete native destination contracts. |

### Primary technical references

- Expo's [SDK57 video sizing contract](https://docs.expo.dev/versions/v57.0.0/sdk/video/#videocontentfit) distinguishes contain, cover and distortion-producing fill. Use explicit width-derived geometry; a blanket cover setting could also enlarge/crop landscape content horizontally. [Track-change events](https://docs.expo.dev/versions/v57.0.0/sdk/video/#videotrackchangeeventpayload) support source-scoped dimension updates.
- [Safe-area APIs](https://docs.expo.dev/versions/latest/sdk/safe-area-context/#api) apply padding through SafeAreaView and expose individual insets. Keep video edge-to-edge and inset interactive controls independently.
- React Navigation's [transparentModal presentation](https://reactnavigation.org/docs/native-stack-navigator/#presentation) retains the previous screen beneath translucent content. Match the existing Launch pattern and independently withhold feed interaction/audio while covered.
- Apple's [layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout) distinguishes edge-extending imagery from controls that respect system obstructions. Its [tab-bar guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars) supports recognizable labeled destinations; this increment reserves space rather than claiming those destinations exist.

## Locked Decisions

1. One layout and crop rule for Global and every existing feed. No extra vertical header/return row in selected contexts.
2. Video extends to the top edge behind time, signal, Wi-Fi and battery. The Space selector, Menu and any contextual profile-return control float below the top safe inset. System indicators remain visible; no gesture or button is placed under the notch/Dynamic Island.
3. Scale to full width without distortion. If too tall, crop equal amounts vertically; if it fits, top-align and leave black below. Never use horizontal cropping to fill spare height.
4. Remove Back to Global from ordinary feed UI. Global remains clearly available in Spaces. Preserve bounded scalar return state through menu selection and fresh native preparation. Same-feed selection simply dismisses Spaces.
5. Spaces uses one80% opaque black overlay, fixed Close and scrollable safe-area choices. Open/Close retains the same source player/time/pause; actual selection creates a fresh pool and named Loading splash.
6. Reserve a consistently sized black footer including the bottom safe inset. Extra unused media-stage height is also black, visually joining the footer. No media or feed gesture extends under the footer.
7. Keep current pause, mute, CC, Follow/recognition, comments, stories, Launch, exact-target Retry and Creator-return behavior. Move their presentation without weakening authority or silently changing navigation semantics.
8. Layout changes do not replace/seek/remount the current video, allocate another player or re-run readiness merely because insets, font size or track resolution change. New source/feed visits retain Plan177's readiness gate.
9. Preserve all existing server authority and original access deadlines. Known denial/removal/identity change masks protected content opaquely even when a chooser is translucent.

## Proposed Implementation

### Shared media geometry and page structure

Use a pure geometry helper and one common feed scaffold. Let `W,H` be the actual full feed-root layout size in logical points, `B` the bottom safe inset, and `N` the reserved navigation-content height. Proposed initial `N=64` points, centralized as a layout token and subject to phone/layout review, not a promise about the future tab implementation.

```
footerHeight = N + B
pageHeight   = max(0, H - footerHeight)
mediaHeight  = W * orientedSourceHeight / orientedSourceWidth
cropEachSide = max(0, (mediaHeight - pageHeight) / 2)
mediaTop     = -cropEachSide
visibleHeight = min(mediaHeight, pageHeight)
```

The video view is `W × mediaHeight`, inside an overflow-hidden `W × pageHeight` page. Its horizontal offset is0; its vertical offset is `mediaTop`. Use the same source aspect ratio for the view so contain does not introduce additional side bars. When there is no crop, mediaTop is0. Posters follow the same rectangle when their geometry agrees; a differently shaped poster must not masquerade as proof of video framing.

Illustrative9:16 arithmetic, not device measurements:

| Root size | Bottom inset | Reserved footer | Video/page heights | Result |
| --- | --- | --- | --- | --- |
|375×667 |0 |64 |666.67 /603 |Crop31.83 points from each vertical edge |
|390×844 |34 |98 |693.33 /746 |No crop;52.67 points black below video before footer |
|440×956 |34 |98 |782.22 /858 |No crop;75.78 points black below video before footer |

Do not subtract the top inset from pageHeight: imagery intentionally occupies that area. Measure the feed root, not a guessed model-specific screen height. Handle zero/invalid layout and nonfinite dimensions without dividing or mounting a zero-sized list.

Keep every FlatList page, footer page, getItemLayout length, settling offset and Next movement equal to pageHeight. The media rectangle changes by clip; the page length does not. Resizing keeps selected publication/time/pause and realigns the list programmatically without an unsolicited neighbor selection.

### Dimensions and stable presentation

- Prefer the selected source's oriented presentation size from the loaded native track. Observe sourceLoad/current videoTrack/videoTrackChange through a bounded port; accept only finite positive sizes for the exact player/source/activation.
- Validate encoded versus displayed orientation, including rotated-source media, before using decoded pixel-buffer dimensions as a fallback. Keep valid feed metadata as a provisional fallback, not an assumption that every clip is9:16.
- Resolve a usable size behind the initial entry splash. If native events are unavailable, determine in Phase A whether the existing entry evidence plus orientation metadata can supply the size without another native operation. Unknown dimensions must have a bounded error/fallback disposition; never an endless splash or guessed hard-coded portrait ratio.
- For ordinary paging, use already loaded neighbor track sizes and available metadata; no extra seek, player, per-slide splash or polling loop. If a source still lacks reliable dimensions, show an honest bounded placeholder/contain fallback and record that exception; do not certify universal full-width behavior until this case is resolved in the media matrix.
- ABR resolution changes with the same ratio must not cause visible geometry churn. Actual ratio/source changes update geometry in place and ignore old subscriptions. Cache only small scalar dimensions tied to the media identity.

### Floating controls, safe areas and black footer

Replace the feed-wide top/bottom SafeAreaView padding with an edge-to-edge root plus separately inset control layers. Keep the application SafeAreaProvider. Use a small dark top scrim/control backgrounds for light video; preserve the current status-bar style. No new UI library is required by this plan.

Place Space selector and Menu in the same overlay in all contexts. Long names/larger fonts can wrap within the overlay without shrinking or moving the video viewport. Preserve Back to profile as a contextual control in that overlay with its existing action; it must not reintroduce an extra normal-flow row. It remains a hierarchical profile return, distinct from selecting a feed.

Anchor app captions, creator/description/story and the action lane within visible, unobscured stage bounds above the footer. Keep text clear of the header and44-point action targets separate. For very short landscape media, use the black spare stage area for readable actions/text rather than enlarging the video or putting controls under system UI. Expanded stories and crowded controls scroll within a bounded area; they do not resize the page or intercept footer/system gestures. Text burned into the source may be cropped by the agreed rule; app-rendered captions must remain visible.

The footer remains black during video, loading, error and empty-feed states. Decorative/reserved areas are not fake buttons, accessibility destinations or feed taps. The initial loading/error feedback uses safe text/action placement even though the covered image starts at the physical top. Keep Space/Menu escape actions reachable while a destination prepares or fails.

### Menu selection and scalar checkpoints

Add a navigator-owned, memory-only checkpoint collection, proposed maximum16 context entries with least-recently-used eviction. Scope its lifetime to API origin, AuthStore identity and auth generation. Store only feed context, publication/upload/production/creator identity, position, userPaused and enough visit sequencing to reject stale saves. No native player, bearer token, playback URL, protected page, membership details or durable storage belongs here. Keep the existing small public data cache separate.

| Action | Proposed behavior |
| --- | --- |
| Open Spaces | Pause/mute through current focus eligibility; remember intent without releasing the selected player or restarting its source. Cancel queued paging. |
| Close or select current feed | Dismiss the overlay; no feed request, replacement, seek, splash or checkpoint overwrite. Resume only the prior permitted intent. |
| Select another feed | Capture the last presented source's scalar checkpoint, release its pool before allocation, restore the target's saved anchor if present and show its named Loading splash. First visit starts normally. |
| Select Global after Launch | Restore the original Global checkpoint through the ordinary selector. No Back to Global button or native retention is needed. |
| Launch exact-video entry | Explicit Launch target/time/pause takes precedence over any saved destination checkpoint. Keep exact-target validation through Retry; no fallback autoplay on failed Launch. |
| Saved menu anchor removed/retargeted | Reuse existing authorized anchored-load checks and unavailable-origin notice; clear the unusable checkpoint and apply the existing normal feed fallback. This differs deliberately from strict Launch-target entry. |
| Refresh feed | Explicit Refresh clears that context's saved anchor and starts from the normal beginning; failure must not resurrect a stale pre-refresh checkpoint. |
| Leave a preparing/failed destination | Do not replace a good saved checkpoint with an unseen/invalid candidate. Ignore late native/HTTP/save callbacks. |
| Sign-out/account/API replacement | Clear all checkpoints and pending choices; generation-isolated callbacks cannot re-enter old content. Access denial is independently enforced, not bypassed by a checkpoint. |

Do not delete GlobalLaunchJourney merely because its return button is removed: its exact-source checks, missing-source handling and Retry/Choose another space still matter. Reconcile it with ViewerJourney so Creator → personal → profile and subsequent menu switches remain coherent. Preserve only scalar state across actual feed changes.

### Spaces overlay lifecycle

Match Launch's native-stack route pattern: transparentModal, fade, header hidden, transparent route content, explicit fixed Close and one80% black scrim. Avoid a second opaque ScrollView/native header that defeats translucency, or stacking two scrims into96% opacity. The scrolling list uses transparent backgrounds; authorization/error masking can intentionally become fully opaque.

Add focus/AppState/auth-generation guards to Spaces data loading and actions. Close/unmount cancels owned requests; loading/error/anonymous states keep Close and public Global reachable. Signed-out users are not shown unavailable private choices. Repeated taps select once. Account replacement removes old routes and callbacks. Underlying feed controls and accessibility traversal remain disabled while covered; no text/engagement work behaves as though that feed were active. Test access expiry/denial while the underlying frame is visible through the scrim.

### Future bottom destinations: reserved, separate work

| Intended destination | Boundary for the follow-on |
| --- | --- |
| Home | A personalized feed of followed creators' authorized content. It is distinct from Global, the CMS web Home page and the user's personal publishing space. Current Follow is creator+space scoped; decide aggregation/deduplication and preserve visible source context. Following does not grant access to other columns, memberships or personal content. A dedicated backend/native plan is needed. |
| Friends | Define relationship, reciprocity, discovery and privacy semantics before adding routes/data. Do not silently equate existing Follow or personal-space access with friendship. |
| Inbox | Establish user-to-user messaging/notification scope and authorization. Existing web/backend messages are not proof of an equivalent native inbox. |
| Profile | Define the signed-in user's profile destination, editing/account behavior and anonymous entry; distinguish it from viewing another creator's profile. Existing Account remains reachable through Menu meanwhile. |
| Search | Define discoverable groups/channels, result metadata and denied/private-space behavior. Reuse server discoverability policy; current accessible-spaces list is not a complete search service. |

The reserved footer is designed for this order with icon+label touch targets and bottom safe area. Do not implement placeholder actions, automatic permissions, new subscriptions or tab-specific native pools. Actual tabs and their selection/return semantics need their own working destination contracts.

## Phase Status

- A: Complete for host implementation — Width-fit/center-clip geometry, native presentation-size query and scalar checkpoint contracts.
- B: Complete for host implementation — Common edge-to-edge stage, floating header and64-point plus inset footer reserve.
- C: Complete for host implementation —80% Spaces overlay, bounded checkpoint returns and Back to Global removal.
- D: Complete for host implementation — Existing feature/control behavior integrated; physical layout/accessibility limits remain explicit.
- E: Complete —232 unit/76 rendered/typecheck, stamped iOS export/archive and downloaded signed build30/native sizing API/accepted-phone signing checks pass. Public source remains frozen; OTA disabled.
- F: In Progress — User qualitatively accepts the delivered build30 increment and requests commit/push. Specific physical crop/audio/accessibility cases and predecessor evidence limits remain unreported or open.

A–E host/artifact qualification and qualitative user acceptance are recorded below. Specific physical observations remain separate from general acceptance.

## Phase A — Establish geometry and checkpoint contracts

- Goal: Make clipping, page length, dimension authority and feed-return precedence explicit before changing navigation.
- Steps:
  - [x] Add a pure geometry helper with width fit, top alignment/center clipping, footer/inset calculation and invalid-input guards.
  - [x] Inspect actual oriented track availability for current HLS sources through the existing port. Resolve unknown/rotated metadata behavior without SDK/dependency changes or extra per-swipe native work.
  - [x] Add bounded scalar checkpoint storage with identity/generation isolation, source tuple validation, eviction and explicit Refresh/Launch precedence.
- Test gate: geometry examples above plus square/landscape/very-tall media, invalid/zero sizes, equal-crop tolerance and changed insets; checkpoint expiry of authority versus scalar memory, source replacement, stale saves, strict Launch versus menu fallback and collection bound.
- Acceptance: deterministic expected rectangles and navigation outcomes, no player/page/credential ownership in scalar memory. Any unresolved dimension limitation is recorded before renderer migration.

## Phase B — Build the shared full-width feed presentation

- Goal: Identical video bounds for the same source and device in every feed.
- Steps:
  - [x] Introduce the edge-to-edge stage, black footer reserve and source-sized clipping rectangle; migrate video and posters together.
  - [x] Remove feed-wide top/bottom content padding and normal-flow header height; inset the floating controls independently.
  - [x] Keep pageHeight fixed across source aspects; realign on resize without changing publication/time/pause or native view/player identity.
- Test gate: actual FeedScreen/VideoSurface/FeedHeader paths across Global/personal/group/channel, source dimensions and multiple measured viewports/insets; page/Next/settling behavior and default/large fonts.
- Acceptance: width equals stage width, vertical crop symmetric within rounding tolerance, image starts at top when uncropped, no horizontal crop/stretch and no layout-triggered source load/allocation/seek.

## Phase C — Use the translucent Space menu for feed changes

- Goal: Remove the special Global return row while preserving feed continuity and one fresh native pool.
- Steps:
  - [x] Convert Spaces to the explicit80% overlay with fixed Close, scrollable transparent choices and focus/lifecycle guards.
  - [x] Capture/restore scalar checkpoints on actual selection, including Global after Launch; current-feed selection only dismisses.
  - [x] Remove Back to Global UI/callback wiring after replacement paths work. Preserve profile-return action and exact Launch Retry/Choose another space semantics.
- Test gate: paused/playing open-close/current selection, Global → Launch → group → Spaces → Global, arbitrary space switches/revisits, fresh versus resumed targets, missing source/target, refresh, denied access, background, account/API replacement and repeated taps. Update old Back-to-Global button tests to exercise the replacement menu path while retaining their assertions.
- Acceptance: original authorized publication/time/pause restored, no native reuse across feeds, peak3, no hidden playback and no duplicate Feed routes or stale commits.

## Phase D — Integrate controls and all feed states

- Goal: Keep the feed usable under the new geometry without reviving side margins or invisible controls.
- Steps:
  - [x] Position captions, story/description, creator/Follow/recognition, Launch, engagement, CC and sound controls within usable stage bounds; support crowded/short-video cases and larger text.
  - [x] Apply common bounds to startup, named Loading splashes, errors, unavailable media and end-of-feed states. Keep escape/Retry actions reachable above the footer.
  - [x] Verify status-indicator readability, touch routing,44-point targets, reduced motion and covered-screen accessibility isolation; preserve prior physical accessibility limits explicitly.
- Test gate: existing captions/story/Follow/engagement/renewal suites and actual geometry/controls matrix. No new cosmetic-only snapshots; assertions check bounds, actions, cancellation and ownership.
- Acceptance: app captions/actions are not cropped with the source image; no overlap with unsafe system areas/footer, no new feed splash on ordinary swipes and no altered engagement authority.

## Phase E — Qualify the final source and signed build

- Goal: Establish relevant host and artifact evidence before phone review.
- Steps:
  - [x] Run `npm --prefix mobile test`, `npm --prefix mobile run test:ui`, `npm --prefix mobile run typecheck`; include diagnostics enabled/disabled and cleanup of dimension listeners, paging timers, media and access jobs.
  - [x] Export iOS and inspect the upload archive using the existing preview workflow. Query fresh EAS history before choosing the next build number; do not assume30 remains available later.
  - [x] Freeze public inputs after submission; verify downloaded embedded source/API/native module, accepted phone provisioning and OTA disabled. Preserve build29 for comparison.
  - [x] Run docs/link/whitespace checks and reconcile current product docs only when the behavior exists. Retain unchanged-server evidence; add backend/API checks if scope actually changes server code.
- Acceptance: passing relevant suites, exact source/archive/artifact identity, no private build inputs and no weakened authority/player budget. No physical crop/audio claim from rendered mocks.

## Phase F — Focused phone acceptance and handoff

- Goal: Confirm uniform width, status-area placement, chosen crop and navigation on the actual signed artifact.
- Steps:
  - [ ] Compare the same portrait clip in Global and a launched space, then return through Spaces. Observe equal width/framing, image behind system indicators, legible floating controls and no separate Back to Global row.
  - [ ] Check paused/playing menu Close, current-feed selection and restored menu returns; confirm clear single-owner audio and the accepted Loading behavior. Check several forward/reverse swipes with mixed aspect ratios.
  - [ ] Verify top alignment/black spare area on a tall viewport and equal top/bottom crop on a shorter one. Include square/landscape and an orientation-sensitive source where available.
  - [ ] Use a suitable shorter iPhone simulator/device for exact clipping/layout if the registered phone is tall; combine arithmetic/rendered coverage with screenshots. Do not represent a tall-phone observation as a short-phone physical result. A new phone/provisioning change requires its normal release workflow.
  - [ ] Exercise representative large text and story/caption/control reachability. Keep prior deferred accessibility/overnight/offline/nested and predecessor performance/sign-out/cleanup gates recorded; do not reopen an obsolete full campaign by default.
- Acceptance: explicit final-artifact observations for the changed layout and navigation, with any untested device/media cases recorded. Mark only this increment's completed scope; do not silently close predecessor evidence gaps.

## Implementation record — fresh feed layout

- Shared `feedGeometry` uses the agreed width-derived rectangle and equal vertical clipping; every list page still has one measured stage height. Full-width video/poster geometry is updated in place. The64-point plus bottom-inset black reserve is present without inactive tabs.
- Feed-wide safe-area padding/normal-flow toolbar are replaced by an overlay. Header actions honor individual insets; profile return uses the existing chevron asset as a44-point labeled icon. Video starts under the system indicators, with a35% black header scrim for readability. Crowded right-side actions remain scrollable below measured header bounds; error/loading controls avoid the header.
- Installed Expo track construction can expose encoded natural size. Rather than infer rotation from that, the repository-owned module now adds `presentationSizeAsync`, a read-only main-queue query of `AVPlayerItem.presentationSize`. It creates no output, seek or player and changes no audio settings. Source/track/first-frame/status signals trigger bounded selected-player reads; stale results and subscriptions are ignored/cleaned. Apple's [presentation-size contract](https://developer.apple.com/documentation/avfoundation/avplayeritem/presentationsize) describes the displayed size and its possible pre-ready zero value. Valid feed dimensions are the provisional fallback; unknown native+feed size stays behind the existing bounded entry gate and exposes Retry at20s. Actual rotated-media/native clipping remains a physical gate.
- Spaces matches the existing transparent-modal/fade pattern with one80% scrim, fixed Close and transparent scrolling content. Focus/mount/auth/AppState guards cancel list reads and reject old actions. Selected publication denial also adds an opaque feed mask while the route is covered, so a translucent menu cannot expose an invalid protected frame.
- A16-entry scalar LRU collection is scoped to AuthStore/API/generation. Actual transitions save only presented, authorized media and release its pool before allocation. Same-context selection only closes. Menu returns restore scalar time/pause and validate publication/upload/production/creator identity; cached Global tuples are checked too. Explicit Launch still takes precedence and retains strict target Retry. Refresh and unavailable origins clear saved context anchors. Menu transitions keep cumulative navigation diagnostics.
- No backend/web frontend, dependency, audio-mixing or fixture/session changes. No native retention or cross-view handoff is reintroduced. The five future bottom destinations remain separate work.

## Expected File Impact

| Area | Planned change |
| --- | --- |
| New geometry/scaffold/footer modules under `mobile/src/feed` or `mobile/src/ui` | Pure rectangle math, common stage and reserved black footer |
| `mobile/src/feed/FeedScreen.tsx`, `FeedCard.tsx`, `mobile/src/playback/VideoSurface.tsx` | Shared full-width clip, fixed page height, poster/loading/error and overlay placement |
| `mobile/src/ui/FeedHeader.tsx`, `mobile/App.tsx` only if needed | Floating safe-area controls, remove Global return row, status/provider integration |
| `mobile/src/playback/useFeedPlayback.ts`, coordinator port/snapshot if needed | Source-scoped oriented dimensions and bounded listener cleanup; ownership/readiness unchanged |
| `mobile/src/navigation/ViewerNavigator.tsx`, new scalar checkpoint module, journey helpers as needed | Menu-driven restoration, refresh/Launch precedence and one fresh pool |
| `mobile/src/spaces/SpacesScreen.tsx` |80% scrim, fixed Close, transparency, focus/background/action guards |
| Caption/story/engagement/control positioning call sites | Usable bounds above footer, large-text/short-media handling |
| Mobile unit/rendered harness and relevant suites | Insets/dimensions, geometry, menu replacement paths, identity/audio/resource/authority regressions |
| Plan/index/roadmap; mobile developer docs after implementation | Approved behavior, release/phone evidence and explicit future-tab boundaries |

No backend/schema/web frontend change is indicated for this increment. If implementation discovers such a requirement, revise scope concretely before expanding it.

## Validation

- Planning environment: `/home/ubuntu/aws`, `main`, clean initial working tree at pushed `cb2c93f`. No AGENTS.md found in the repository or workspace ancestor locations inspected in this session.
- Inspected source and primary references are linked above. The geometry explanation is an inference from source and the phone observation; viewport/crop measurements are not yet collected on the new layout.
- Before/after `npm run check:agents:docs` retain the same16 existing findings, zero new. All73 relative Markdown links across this plan/index/predecessor/roadmap resolve; tracked/new-plan whitespace passes. Exactly4 planning files changed and all144 public build29 app inputs still match the frozen source manifest. Local validation: `/dev/shm/plan178-planning-validation.json` and `plan178-docs-{before,after}.log`.
- Implementation validation now passes232 unit/76 rendered/typecheck; final stamped build30 export/archive match147 inputs/148 files, including4 native module files, with zero private inputs. Native artifact verification passes; phone gates remain pending. No database/session/fixture mutation, commit or push. Previous227 unit/71 rendered/artifact results remain build29 evidence only.
- Future evidence: `tests/runs/build/plan_178/` and `tests/runs/device/plan_178/`, with explicit source/build identifiers and no credentials/raw media URLs/private provisioning values.

## Open Risks / Deferred

- Physical status-area/AVPlayer clipping, orientation metadata and initially missing track dimensions need verification; contain/cover flags alone do not establish the agreed rectangle.
- Symmetric cropping can remove source-baked text/faces near either edge. This is the explicitly chosen sizing rule; app captions and controls remain separately positioned.
- A64-point footer is a proposed initial reserve, not a finalized five-tab specification. Tune one shared token from actual layout review; all feeds keep the same rule.
- Home/Following aggregation, Friends, Inbox, own Profile and Search remain separate working-feature plans. No inactive tab controls ship in this layout increment.
- Arbitrary menu returns add scalar state paths; stale-account/source saves, unpresented entries and exact Launch precedence must be proven before replacing the old button.
- Build29's static-audio mechanism remains unproven; this layout work must not reintroduce retained/reattached cross-feed players. Existing Plan175/176/177 evidence limits remain open.

## Change Log

- 2026-10-26 — User explicitly approves Plan178 implementation. Added common stage/centered crop, scalar menu checkpoint returns,80% Spaces overlay and reserved black footer; native presentation-size query avoids encoded-orientation assumptions.232 unit/76 rendered/typecheck pass. Build30 frozen source `516af618006771b67c613291f87cfa554e43254b163cca6b7044c3cd06031a49` matches147 source inputs/148 archive files; EAS `2ff9a4f7-dad3-4f9b-aff3-05b2a837775c` finished and downloaded artifact/native sizing API/signing checks pass. Phone gates remain open. No server/session/fixture mutation or commit/push.

- 2026-10-26 — Investigated shared feed/header/video/paging layout, Spaces/Launch routes, journey/checkpoint/access owners, installed video dimension APIs and primary platform guidance. Wrote the requested plan for full-width status-area video, symmetric vertical crop,80% Space chooser and future navigation reserve. Planning only.

### Build30 verified — 2026-10-26

Source `516af618006771b67c613291f87cfa554e43254b163cca6b7044c3cd06031a49`,147 public inputs/148 archive files,4 native module files and no unexpected/private input. Hermes export2276575 bytes contains source/API, new geometry/footer/header/menu markers and native sizing-call marker.232 unit/76 rendered/typecheck pass; final stamped typecheck/export/archive pass. EAS `2ff9a4f7-dad3-4f9b-aff3-05b2a837775c` submitted2026-10-26T19:44:20.478Z. Public inputs are frozen. Docs retain exactly16 known findings/zero new;88 local links resolve and whitespace passes. Evidence: `tests/runs/build/plan_178/{source-manifest-build30.json,archive-export-build30.json,host-gates-build30.json,docs-build30.txt}`. Downloaded signed artifact verified2026-10-26T19:49:11Z after EAS finished19:48:35.820Z. IPA8351242 bytes, SHA256 `f2b14567c95dbc2683c31917ed27481628c24386e7f6c060eb48379bdc8dc1a1`, embedded Hermes2276666 bytes. Bundle/source/API/native module and native presentation-size API match. The accepted single-phone device set/signing namespace match build26, get-task-allow=false, OTA=false. Artifact records: `artifact-build30.json` and `build30-meta.json` in the same harness directory. [Install build30](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/2ff9a4f7-dad3-4f9b-aff3-05b2a837775c). The user subsequently accepted the delivered increment with “Looks good. Please commit and push.” Specific clipping/status-area/audio observations were not supplied; no public source changed after submission.

## User acceptance and delivery

On2026-10-26 the user accepted the delivered layout increment with “Looks good. Please commit and push.” This is qualitative acceptance; it does not establish each unchecked Phase F scenario, short-phone physical clipping, specific return-audio results or quantitative performance. Commit/push is explicitly authorized. Preserve predecessor evidence and cleanup limits.

## Resume Here

- The build30 increment is qualitatively accepted and authorized for commit/push. A–E host/artifact work passes. [Install build30](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/2ff9a4f7-dad3-4f9b-aff3-05b2a837775c) is verified; retain the unchecked F cases as coverage limits unless specific observations are later supplied.
- The proposed first increment reserves the bottom area and preserves existing navigation features; the five future destinations are not silently included. Footer reserve starts at64 points plus bottom inset for review.
- Preserve build29, existing fresh-player/readiness behavior, fixtures and phone sign-in. Commit/push is explicitly requested for this increment. A taller registered iPhone cannot by itself qualify shorter-phone physical crop; retain that coverage limit and use suitable simulator/device evidence when available.
