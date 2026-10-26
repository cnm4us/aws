# Plan 177: Fresh players and named loading splashes for feed entry

Status: Active

## Feature Reference

- Feature contract: [Personal Space, Global Feed, and Context Integrity](../features/feature_02_personal-space-global-feed-context-integrity.md).
- Predecessors: [Plan176](plan_176.md), especially its build26 report analysis and audio-isolation revision; [Plan175](plan_175.md) for outstanding functional/performance/cleanup gates.
- Roadmap: [Native viewing](../roadmaps/roadmap_native_viewing.md).

## Current approved scope

Build28 qualified automatic full-height readiness but reproduced static on retained Global return. The user approved replacing cross-feed native retention with one fresh up-to3-player pool per feed and a named opaque `Loading <feed>…` splash. Keep scalar position/manual-pause checkpoints and bounded authorized data. Global → Launch → Close keeps the original player; committing to another feed releases the old pool before allocating the new one. Ordinary paging keeps its existing preloading. The approved revision and current phase definitions below govern execution; the original investigation/design is preserved as history. No SDK/audio-mixing/server change is part of this revision.

## Original context and investigation (historical)

- Problem: Launch currently closes after destination resolution/data readiness. The new feed then mounts a fresh native player, loads HLS and restores position while displaying a radial indicator over its first image. Back to Global repeats that media work. The user associates the radial indicator with unavailable/error states and wants the waiting to belong to startup/feed selection.
- Requested outcome: selecting a group/channel keeps Launch visible with a horizontal bar and **“Loading new Feed”**. Reveal the destination when its first video is ready at the intended position. Preserve the existing smooth Global → Launch → Close and within-feed paging. Retain Global's native player in its existing view for a bounded, fast return.
- In scope: feed-entry transaction/readiness, stable feed/view ownership, bounded Global retention, shared player capacity, loading-bar presentation, cancellation/failure behavior, startup, other feed-entry routes and targeted regressions.
- Out of scope: backend authorization redesign, longer access deadlines, private HLS enforcement, joining/payment/age/approval flows, codec/CDN changes, SDK upgrades, general UI redesign and public-store distribution. No speculative native loading of every Launch option.
- User authorized implementation after plan review. Execute Phase A first, including its internal feasibility artifact; preserve build26 as the comparison baseline, phone sign-in and fixtures. Commit/push remain unrequested.

### Evidence and investigation findings

Build26/source `c549c1dacbb63f35068af40ae7bbee7083e1fd887b41a6fb4613f7f53edce651` is the measured baseline. The user reports variable waits of about one second. The export generated2026-10-25T22:42:17.535Z has resetCount0. The selected seven exact group/Global pairs show:

| Cumulative stage from selection tap | Group entry, n=7 | Global return, n=7 |
| --- | --- | --- |
| Access ready | median12.20ms; 11.35–14.48ms | Public cached feed; no separate marker |
| Feed data ready | median22.75ms; 21.66–24.55ms | median13.63ms; 10.59–16.55ms |
| First frame, possibly before seek | median428.26ms | median364.72ms |
| Restoration complete | median716.42ms; 332.83–1516.77ms | median583.51ms; 333.10–883.55ms |

Access/data reuse is working in this sample. Source loading and restoration dominate the remaining interval. Moving the wait to Launch changes the experience; retaining Global can remove repeated media work on eligible returns. Neither change establishes a faster cold network load. Component medians must not be added.

Evidence excerpt and calculations: `tests/runs/device/plan_176/build26-navigation-analysis.json`; this is explicitly transcribed selected evidence, not a saved full raw report. Whole history remains qualified:36 transitions,33 first frames,3 incomplete,0 recorded playback errors, peak3, unexpectedPlayback0, earlier7.47s first frame, one failed/cancelled recovery,123 dropped ordinary events and11 dropped access rows. This is not the final controlled performance sample. Position deltas and playing flags do not establish audible quality or manual-pause intent.

| Inspected source | Established behavior / implication |
| --- | --- |
| [ViewerNavigator](../../mobile/src/navigation/ViewerNavigator.tsx) | `transition` releases the current coordinator and changes the keyed Feed route. Launch `onEnter` immediately returns to Feed. Merely retaining a player in a ref will not preserve its mounted view. |
| [LaunchSpacesScreen](../../mobile/src/spaces/LaunchSpacesScreen.tsx), [LaunchStore](../../mobile/src/spaces/launchStore.ts) | `entering` covers resolution, then ends before media preparation. Two bounded prepared JSON entries exist; there is no destination native-media preparation. |
| [GlobalLaunchJourney](../../mobile/src/navigation/globalLaunchJourney.ts) | `enter` marks destination active immediately. Split preparation from committed entry so Close/error does not leave an entered journey. |
| [FeedScreen](../../mobile/src/feed/FeedScreen.tsx), [useViewerFeed](../../mobile/src/feed/useViewerFeed.ts) | Focus currently combines presentation, access renewal and interaction eligibility. Changing entry/restore object identity can recreate the data owner. Hidden preparation needs explicit roles and stable visit inputs. |
| [useSpaceAccess](../../mobile/src/auth/useSpaceAccess.ts) | Publication watches register for visible routes. An authorized preparing visit needs its own bounded selected-item watch without making controls or audio eligible. |
| [coordinator](../../mobile/src/playback/coordinator.ts), [playerBudget](../../mobile/src/playback/playerBudget.ts) | Selected media can load while covered, but ordinary window filling assumes up to three entries per coordinator. Global retention requires explicit shared capacity; allocation exceptions cannot be the scheduling policy. `capture` stops playback/releases neighbors but does not independently guarantee selected media is muted. |
| [useFeedPlayback](../../mobile/src/playback/useFeedPlayback.ts), [VideoSurface](../../mobile/src/playback/VideoSurface.tsx) | Seek assigns `currentTime` then polls to within1s. First-frame callback can precede restoration. Restoration notice is immediate; ordinary startup notice waits250ms. Neither timer nor sampled timeline alone proves presentation of the restored frame. |
| Installed `expo-video`57.0.5 iOS `VideoView.swift`, `VideoPlayerSeeker.swift`, and public event types | First-frame notification observes `AVPlayerViewController.isReadyForDisplay`, also usable on track changes; public events expose no per-seek displayed-frame acknowledgement. Do not require an assumed second first-frame event after every seek. |
| [rendered native harness](../../mobile/tests/rendered/native.cjs) | Default fake immediately invokes first-frame callbacks and completes loads/seeks. Extend controlled signals before using it to prove hidden readiness or cancellation races. |

Build24's player transfer coincided with reported static; builds25/26 isolate players per feed. The causal mechanism remains unproven. This plan preserves **view and coordinator identity**, and does not restore cross-view native-player handoff or change audio mixing settings speculatively.

## Original locked decisions (superseded by the approved revision below)

1. Show one indeterminate horizontal bar, labeled exactly **Loading new Feed**, on startup and actual feed switches. No fabricated percentage, minimum display time or automatic “100%” animation. Show it on the first render after a selection, before revealing destination imagery.
2. Launch keeps its current creator/space content,80% scrim and fixed Close. Place a stable loading section below the header, outside the scrolling options. Disable repeated entry taps while preparing; keep Close usable throughout. Close cancels preparation and resumes the original Global intent if still authorized.
3. Candidate media belongs to one freshly created destination visit, in a stable mounted view. Preparing → visible changes roles/layering, never player ownership, parent/key identity, feed store or `VideoView` attachment. Retained Global remains in its original view/coordinator.
4. Only the selected destination gets native preparation, starting after its tap and exact authorization. Keep existing bounded two-entry JSON preparation. Earlier pre-tap native preparation is deferred until measurements justify its added ownership/bandwidth cost.
5. Reveal requires current authority, exact target data/source, usable media, restoration completion and presentation readiness for that restoration attempt. Paused entry must work without playing/progress. Pre-seek first-frame evidence alone cannot satisfy the gate.
6. Preparing/parked visits are paused and muted, noninteractive and absent from accessibility traversal. Their text/engagement reads and mutations do not activate as if visible. The destination may start audible playback only after presentation commits and only if its saved intent permits it.
7. Keep at most three live native players across all visits and at most one permitted playback owner. Prioritize visible selected media and forward preparation over return retention. No unbounded feed stack/native cache.
8. Authority remains account/API/generation/source scoped with original deadlines. Access denial, removal, expiry or identity replacement blocks/masks promptly, even if media was already prepared. Following never grants viewing access. Every protected server request retains its existing authorization.
9. Ordinary swipes and routine background renewal get no feed-loading bar or radial spinner. Keep bounded startup/failure detection, useful delayed text for unusual buffering, and explicit Retry/Next/error states. Feature loading uses its own text/action state; it must not masquerade as feed switching.
10. Plans175/176 remain open for outstanding evidence and cleanup. Existing deferred offline/nested physical testing remains deferred. Host mocks cannot certify sound quality or native hidden rendering.

## Original proposed design (historical; cross-feed retention removed)

### One feed host, stable visits and explicit presentation roles

Introduce a bounded feed host owned by the permanent Feed route. Render stable keyed sibling visit slots in one full-size stage. A visit owns its `FeedScreen`, data store, coordinator and selected video view for its lifetime. Roles are `visible`, `preparing`, `parked` or `dormant`; changing roles must not move nodes between parent trees. Route callbacks/commands register by visit ID, not a single mutable handle that a hidden visit can overwrite.

Launch remains a logical navigation overlay. First test whether the current native transparent-modal route leaves the host attached and able to prepare frames. If native-stack detachment/freezing prevents readiness, render the Launch presentation inside the permanent host and adapt logical Back/focus handling there. Make that choice in Phase A before migrating callers. Do not patch installed dependencies or reattach a used player to solve it.

The candidate occupies real full-size layout behind an opaque cover; it is never visible through Launch's translucent scrim. Keep the original Global image beneath the existing scrim. Do not assume zero-size, `display:none`, zero opacity or an inactive native screen can render frames. Phase A must verify the selected layering on iPhone. Hidden controls/paging/accessibility stay disabled independently of native layout.

At most three visit slots are needed for the existing nested path: parked Global, a parked group origin for a Creator/personal detour, and one candidate/visible destination. Only Global is promised native retention; a nested group origin keeps its scalar/data checkpoint and releases native media before the next candidate allocates. There is never a third media-owning feed. Preserve existing journey generations and exact return semantics; native retention is an optional acceleration, not return authority.

### Feed-switch transaction

Add a navigator-owned switch controller with immutable transaction ID, account/API generation, source visit, source tuple, target context/publication, captured intent and an abort scope. It controls the bar and candidate; the Launch store continues to own list/resolve caching.

| State | Presentation and allowed work | Exit |
| --- | --- | --- |
| Idle | Current feed or idle Launch; no bar | Selection creates a transaction synchronously |
| Resolving | Launch/departing-screen cover plus bar; validate entry and existing proof ages | Exact result → preparing; error → failed |
| Preparing | Same cover/bar; load one authorized candidate and restore time; no candidate audio | Complete readiness → commit check |
| Commit check | Recheck active transaction, app/focus, account, source and proof deadlines from current stores | Valid → reveal; changed → cancel/block/re-resolve |
| Revealed | Same candidate view becomes visible; close chooser/update journey, enable intended playback | Dispose obsolete destination; retain eligible Global only |
| Failed / empty | Bar stops; overlay has an honest reason and Retry/Choose another/Close as applicable | Retry creates a fresh attempt; never silently choose another video |
| Cancelled / invalidated | Invalidate ID first, then abort/release/watch/timer cleanup | Restore authorized source presentation; ignore all late callbacks |

Preparation cannot call today's mutating `launch.enter` as a commitment. Separate pure entry validation/intent construction from journey commit. Close, background, account changes and late native callbacks cannot commit after cancellation. A retry gets a new attempt ID and readiness evidence; obsolete events cannot complete it. Keep switch state independent of optional diagnostics.

Commit has a defined ordering: keep cover opaque; stop/mute departing media; recheck authority; commit visible role/navigation; remove cover; enable destination playback in the presentation commit/layout effect. Any denial during this interval masks again before audio is allowed. Native playing events for an ineligible owner still trigger the existing stop guard and diagnostics.

### Readiness contract and the native proof gap

The controller consumes a subscription-based `FeedEntryReadiness` snapshot, not diagnostic events or delays. It identifies visit/activation/source/restore attempt and reports data, authority, source readiness, restoration, presentation, error and terminal-empty state. Unmount/source replacement invalidates all readiness. A source-load promise or poster image is not a usable video frame.

Phase A is a release-blocking feasibility gate:

- Exercise a covered full-size view with time0 and nonzero entry, both manually paused and playing intent. Record first-frame, native ready, seek completion/timeline, target presentation and subsequent reveal; qualify across quality/track changes and lifecycle interruption.
- Confirm how much the installed public API can prove. Existing timeline polling may remain a fallback diagnostic, but its1s acceptance does not become a new frame-accuracy guarantee. Define a tested restore tolerance without relaxing the established pause/time behavior.
- Do not invent a second `onFirstFrameRender` after seek, key-remount the view to force it, require diagnostics-only progress, or briefly play audible media to open the gate.
- If exact post-seek presentation cannot be established with public signals, add a narrow, repository-owned iOS readiness adapter with attempt-scoped native seek completion and target-frame/presentation evidence. Verify it against real installed AVPlayer behavior, cancellation and paused HLS before broader implementation. Its packaging/configuration and future uninstrumented release behavior must be tested; no ad hoc edits in `node_modules`.
- A small native adapter increases scope but may be necessary for the promised reveal contract. If it cannot meet that contract, leave Phase A incomplete and document the measured limitation. Do not ship a weaker timeline-plus-old-frame gate as “ready at restored position.”

No first-frame/progress/playing evidence is required from a video that remains intentionally paused after readiness. For moving playback, separately measure playing and advancing time after reveal; readiness is not proof of audible quality or sustained playback.

### Global retention and shared capacity

Capture origin publication/production/creator/source URL, position and user pause once when Launch opens. Stop/mute it and release its neighbors. Use an explicit park operation; do not replace the saved sound preference or manual-pause state to achieve muting.

Proposed retention cap: at most60s from departure, additionally bounded by the **remaining original public proof deadline**, whichever is earlier. No cache hit or nested return restarts the lease. Release on background/inactive, memory warning, account/API change, sign-out, known removal, exact tuple change or failed native state. Keep a scalar checkpoint for an authorized cold return; a dormant slot must not automatically reallocate media while covered.

| Situation | Allocation policy |
| --- | --- |
| Visible feed, no retained origin | Existing current + next + previous, maximum3 |
| Idle Launch | Parked Global1; JSON preparation only |
| Selecting destination | Parked Global1 + candidate current1; selected restoration has priority |
| Destination visible, Global retained | Global1 + destination current/next2; release old entries before allocating during swipes |
| A swipe/other route needs full window, lease expires or memory pressure arrives | Release parked Global first, preserve checkpoint, restore visible feed's full3 window |
| Return to valid parked Global | Stop/release destination, reveal same Global view/time without source replacement or seek, then restore Global neighbors |
| Return after eviction/expiry/source change | Cover departing screen with bar; perform current authorized anchored return; never reuse invalid native media |

Add an explicit capacity policy shared by host/coordinators, with deterministic selected/next/previous priorities. Reserve/shrink before construction, count all native leases, and keep `PlayerBudget` as the hard invariant. Losing the previous preload while retaining Global is a known tradeoff: run forward/reverse tests and evict Global proactively if the visible feed needs it. Return acceleration must not degrade the accepted swipe experience.

### Startup and remaining navigation/loading surfaces

| Trigger | Planned behavior |
| --- | --- |
| Cold app start | Same bar component on an opaque startup shell through preferences, saved sign-in resolution, initial Global data/media and entry readiness. Each owner reports its phase; no cascading radial screens. Global public readiness must not wait indefinitely on unrelated authenticated work. |
| Global → Launch → Close, no selection | Existing immediate overlay/close; no feed bar. Loading available spaces, if necessary, uses inline text. |
| Launch group/channel selection | Bar starts inside Launch at tap; keep original image/scrim; exact destination revealed once ready. |
| Back to Global | Valid retained origin returns directly without bar/reload/seek. Otherwise show bar over departing screen until authorized Global is ready. |
| Spaces chooser or Creator → personal feed | Same transaction/readiness with bar on the initiating screen/cover; preserve creator/origin Back semantics. No new Launch requirement for unrelated routes. |
| Return from Comments/Settings/profile without feed change | Resume existing owner when eligible; no feed bar. Expired authority blocks with explicit access text/actions. |
| Choose another destination / retry failed entry | Release old candidate before new preparation; current overlay remains cancellable. No two simultaneous candidates. |
| Menu Refresh or explicit feed-level recovery | Treat explicit full feed replacement as preparation under a bar cover; preserve exact anchor/intent where valid. Routine revalidation stays quiet. |
| Swipe / pagination within a feed | Preserve paging/preloading. No bar/radial spinner. Delayed text can explain an exceptional cold video or end-of-page fetch; bounded Retry/Next remains. |
| Captions/story/comments, sign-in/out, preference save | Scope-specific text/disabled-action feedback, existing error/retry semantics; no feed bar. Avoid a global `Message` replacement that relabels these as feed loading. |

Empty feeds are terminal content states, not infinite readiness waits. Exact Launch target removal is an error on Launch, not an empty-feed success. Source unavailable prevents exposing the old Global image; use an opaque unavailable surface while keeping Close/other navigation usable.

Bar styling: reuse current dark palette with a thin contrasting track and animated segment; label and optional destination name wrap at large text sizes. Expose an indeterminate progress role/busy state without a percentage, announce state changes once, respect Reduce Motion with static progress/text, and keep Close reachable outside the scrolling body. No diagnostics or source-loading jargon in the user-facing flow.

Reuse existing request/source/restore deadlines and impose an overall20s switch deadline from tap as the initial upper bound, including resolution. Native restoration retains its existing10s bound and seek8s bound; the first timeout/error ends the attempt and releases the candidate. Review these bounds with Phase A evidence. A failed/rejected attempt must never leave an indefinitely moving bar. Timeout stops speculative work; Retry uses current authorization.

### Diagnostics and acceptance measurements

Keep existing transition/source-load records and navigation stages. Add bounded allowlisted switch records: transaction/visit IDs, kind, retained-origin hit or eviction reason, tap, overlay shown, data/access ready, media ready, restore complete, presentation ready, revealed, playing/advancing after reveal and terminal outcome. Include cancellation/failed/timeout attempts and dropped-record counts. Retention does not count as a new allocation; no player transfer events for retained views.

Measure tap → reveal and reveal → playing/advancing separately from existing tap → first frame/restore. Do not reset the clock at reveal to claim faster total loading. Record sampled timeline tolerance separately from frame evidence and physical audio observations. Preserve errors/incomplete history; deliberate cancellations get explicit classification. No bearer credentials, raw media URLs, private response bodies or persistent private logs.

## Approved revision — one player pool per feed (2026-10-26)

The user reports correct position but static on retained Global return in build28 and explicitly confirms clear audio in the automatic full-height playing check. Both automatic checks were confirmed at440×956: paused7 remains7.000001s; moving0 advances to12.4102963s. Target→automatic reveal is2.33/2.17ms; reveal→playing108.47ms and advancing352.95ms for the moving check. Report resources5 allocations/4 releases/1 live, peak2, unexpected0 do not measure audio distortion. Native reuse across feeds fails its audio gate; the exact native failure mechanism remains unproven.

The user now approves a simpler design: each feed owns up to3 selected/next/previous players; an actual feed change releases all departing native media before allocating the replacement. Keep scalar checkpoints and bounded authorized feed data, without a parked Global player. Fresh startup, feed switches and returns show a named opaque loading splash with a horizontal indeterminate bar until authorized media, completed restoration and native target/view readiness permit reveal. Within-feed paging retains its current preloading and stays quiet; Global → Launch → Close is not a feed change and retains the same source player. A successful destination resolution commits to replacement and the new splash; failures/cancellation during chooser resolution preserve the source. The earlier requirement to keep Launch over a prepared destination and the warm-native-return latency target are superseded. Native full-height experiment is accepted for this readiness contract, with decoded evidence versus physical presentation limits still explicit. No SDK/audio-mixing/media-delivery change is authorized by this revision.

Implement B/C/D under this revised scope, then run E and prepare the next numbered artifact. Physical audio on fresh-player return remains a required gate; do not rerun the accepted readiness experiment by default. All original authority, stale callback, cancellation, resource bounds and predecessor cleanup gates remain in force.

## Phase Status

- A: Complete for the recorded native readiness experiment — automatic full-height checks confirmed; retained cross-feed audio failed and was removed from the approved design.
- B: Complete for host implementation — One isolated up-to3-player pool per feed; checkpoints and Launch Close preserved.
- C: Complete for host implementation — Fresh destination waits behind its own splash for authority, source, restore, view-frame and exact paused target evidence.
- D: Complete for host implementation — Named loading splashes for startup/feed replacement and quiet ordinary paging; physical layout remains part of F.
- E: Complete —227 unit/71 rendered/typecheck/export/archive and downloaded signed build29 artifact/native module/API/accepted-phone signing checks pass; source frozen and OTA disabled.
- F: In Progress — User accepts build29 loading feedback and seamless within-feed scrolling and requests commit/push. Broader quantitative/audio/edge-case and predecessor closure evidence remains scoped as below.

Build27 manual paused0/7 and clear playing audio are accepted. Build28 automatic full-height paused7/playing0 are accepted; reports and analysis are saved under `tests/runs/device/plan_177/`. Native decoded evidence remains distinct from hardware pixel acknowledgement and audible quality. Fresh-player phone audio acceptance is still required.

## Phase A — Prove hidden media readiness

- Goal: Resolve the native prerequisite before promising a ready restored frame or restructuring all navigation.
- Steps:
  - [x] Extend controlled native test ports to delay source, frame, seek and playing independently; support stale events, pause intent, expiry and release assertions.
  - [x] Implement the stable-view experiment using actual Expo VideoView and opaque cover; manual and automatic full-height observations are now accepted as recorded below.
  - [x] Qualify the recorded build27 manual paused/playing0/7 and build28 automatic full-height paused7/playing0 cases. Cancellation is host-qualified; physical cancellation coverage remains bounded. These are separate from final fresh-player acceptance.
  - [x] Record the stable full-height VideoView under an opaque cover, independent first-frame and exact paused seek/decoded target evidence (±0.1s), with layout-commit reveal. Local native module provides bounded cancellable preparation; no remount/reattachment at reveal. Physical evidence qualifies the measured contract, not a hardware pixel API.
- Test gate: targeted port/readiness tests plus actual iOS evidence under `tests/runs/device/plan_177/`; host mocks alone cannot pass this phase's native claims.
- Acceptance: reliable, bounded, silent preparation and restored-frame presentation without remount/reattachment; paused entry does not wait for playback; unresolved proof gap explicitly blocks reveal implementation.

### Phase A execution — native feasibility check

Implemented an internal-only **Global → Menu → Feed readiness check** route. One separate public-video candidate uses the existing shared player budget; the original Global visit stays covered in its existing owner. Four selectable cases cover paused/playing intent at0s/7s, with native-modal cover by default and a paused7s inline comparison. Candidate native media stays muted/paused until explicit Reveal commits and its screen is focused. Cancel/timeout/background/account/proof invalidation releases the candidate and prevents late events from revealing. Closing the check returns through Menu without changing preferences, credentials or fixtures. Production feed switching is deliberately unchanged at this gate.

Added the repository-owned `mobile/modules/viewer-readiness` Expo module. It accepts ExpoVideo's public `SharedRef<AVPlayer>` base type without accessing private registry IDs or modifying dependencies. Native main-queue work performs an exact seek with completion, obtains an `AVPlayerItemVideoOutput` frame within0.1s of target, reports allowlisted timing/dimensions and removes the output/timer/native references on every termination. The8s native and20s overall bounds remain explicit. It does **not** acknowledge VideoView pixels or claim that the earlier first-frame event belongs to the seek; the report says so, and physical image/audio confirmation is recorded separately. Bridge conversion, covered decoding and rendered result remain phone gates even after compilation.

Apple API references for this distinction: [seek completion](https://developer.apple.com/documentation/avfoundation/avplayer/seek(to:tolerancebefore:toleranceafter:completionhandler:)), [decoded pixel buffer and presentation time](https://developer.apple.com/documentation/avfoundation/avplayeritemvideooutput/copypixelbuffer(foritemtime:itemtimefordisplay:)). These describe native signals; they do not replace device evidence for the composed Expo view.

The new `FeedLoadingBar` is exercised by the experiment with Reduce Motion support and no percent value. It is not yet wired into ordinary startup/Launch/swipes. Existing runtime player handoff stays disabled. Frame callbacks in the controlled harness are independently driveable; actual navigator tests prove candidate view identity through reveal, no hidden play, release on cancel and original Global return. Eight new controller tests cover ordering, paused/playing intent, stale attempt/source/frame evidence, expiry/account invalidation, hung reads/native failures and bounded reports. A ninth unit test protects native-module input fingerprinting and private-input rejection.

Release packaging now includes local modules in both the EAS allowlist and source inventory; autolinking resolves `ViewerReadinessModule`/`ViewerReadiness` correctly. An observed concurrent export/test read saw a transient truncated build-identity JSON; stamp publication now uses atomic rename outside the public input roots. The affected focused tests pass after correction.

Build27 is the Phase A feasibility artifact, not the final feed-switch implementation: source `eb2f735ec81fa7c0a25a59a25f3e6026b5847fc5c88b0b176ec041e8feebf5ee`,141 public inputs including4 local-native files,142 archive files,2251348-byte Hermes export. Workspace/archive/input manifest/exported source and API match; private inputs0. EAS `e671271e-f626-4d73-94fb-07dfc8538b79` finished2026-10-25T23:54:53.694Z; downloaded signed artifact verified23:56:52Z. IPA8338088 bytes, SHA256 `ea066472a70cefb07be0513319f87ca65d76fd185ce7ac3b0d0c7ab5ee1e6b89`, embedded Hermes2251441 bytes. Executable contains `ViewerReadinessModule`; bundle/source/API/internal-preview match, same one accepted phone as26, get-task-allow false and OTA disabled. Source remains identical after submission. [Install verified feasibility build27](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/e671271e-f626-4d73-94fb-07dfc8538b79). Physical qualification was pending at submission; subsequent manual pause/audio observations are recorded below. Build26 evidence is preserved.

Host gates:215 full unit/63 full rendered/typecheck pass; final focused9 unit/2 actual navigator cases pass after final report/packaging changes. No backend/API/fixture/session mutation. Evidence under `tests/runs/build/plan_177/`: `host-gates-build27.json`, `source-manifest-build27.json`, `archive-export-build27.json`, `artifact-build27.json`, `build27-meta.json`; logs `/dev/shm/plan177-a-{unit-final,ui-final,focused-final,readiness-ui-final,typecheck-final}.log`. Native compilation is established by the finished build/downloaded executable; physical behavior is not inferred from it.

Phone handoff: install27 over the existing app without uninstall/reset; from Global open Menu → Feed readiness check. Run paused/playing at0s/7s. Each ready case offers Reveal check video; inspect the first image, intended pause/play and sound if enabled, then choose Frame and playback correct only when observed (otherwise End without confirming). Share readiness report afterward. If a case fails, Cancel readiness preparation returns to the check and preserves its failure report; use the inline7s paused comparison only if the modal result needs diagnosis. The gate tests automatic silent preparation plus an explicit diagnostic reveal; production navigation will only be wired after the result is reviewed. No prior deferred offline/nested phone work is requested here.

### Build27 phone report received2026-10-26 — partial physical evidence

User reports running the checks a couple of times and finding the procedure initially unclear. The supplied JSON matches verified build27/source and retains two completed, user-confirmed **playing-intent** checks, at0s and7s on public publication724. Both use the native-modal cover. Evidence: exact JSON transcription at `tests/runs/device/plan_177/build27-readiness-report-1.json`; reproducible calculations at `tests/runs/device/plan_177/build27-readiness-analysis-1.json`, generated by ignored `.codex-local/plan177-analyze-readiness.cjs`. Email/table formatting is excluded. No absolute event timestamp, report generation time or reset count was supplied.

| Observed interval | Playing from0s | Playing from7s |
| --- | --- | --- |
| Selection → decoded target ready | 1302.15ms | 730.43ms |
| Native exact-seek completion | 173.21ms | 85.68ms |
| Native decoded target frame from native attempt start | 173.57ms | 86.40ms |
| Earlier view first-frame → decoded target evidence | 308.33ms | 144.34ms |
| Ready → manual Reveal | 1231.57ms | 2420.02ms |
| Reveal → observed playing | 141.72ms | 146.48ms |
| Reveal → observed advancing time | 433.75ms | 399.80ms |

Both native results report muted=true/rate0 during preparation, with decoded frame time and sampled timeline matching their exact target0/7. Playing/advancing evidence occurs after Reveal; final sampled times3.8585/11.1742s are compatible with the requested moving playback. The native bridge and covered preparation operate on this phone for these two cases. `userConfirmed:true` records the check's combined frame/playback confirmation; the subsequent explicit user reply confirms clear playing audio, silence until Reveal and both paused0/7 outcomes. The diagnostic deliberately has no resume control; ordinary feed tap-to-resume remains required and tested.

Original report-only assessment, superseded where resolved by the follow-up below:

- The viewport is440×280, decoded frame720×1280. This establishes covered rendering for the diagnostic view, not full-height production-feed geometry. The1.23/2.42s manual wait before Reveal gives the underlying view additional settling time; it does not prove immediate automatic reveal after native target evidence. Keep full-size/automatic presentation qualification open.
- First-frame events precede native seek/target evidence in both records. They cannot replace the readiness contract. These two variable trials include a public subject read and are not a controlled cold/warm comparison or final forward-performance gate.
- Global resource accounting balances99 allocations−98 releases=1 live, peak3. It does not prove leak freedom or a per-check peak. `unexpectedPlayback:1` is a **session-wide unresolved flag**. The readiness check's diagnostic callbacks emit allocation/release only; ordinary coordinators emit unexpected-playback issues when an ineligible/nonselected native player is still reported playing and then pause it. The event could involve underlying Global or another earlier feed/lifecycle episode. Do not attribute it to these two candidates, dismiss it as harmless, or claim clean session audio without the full issue record.
- No paused/cancelled/failed check rows are retained. Probe history belongs to one `ReadinessProbe` instance (max8), while attempt serials are module-wide. Closing/reopening the screen or replacing its client/generation discards the old history;13/14 do not imply12 prior failures. The earlier user-facing statement that one report includes all four checks omitted this lifetime limit. Explain that limitation rather than asking the user to repeat all four automatically.
- Requested only the missing paused0/7 and clear-playing/silent-covered observations plus **Playback diagnostics → Share full report**, without reset, to locate the one unexpected-playback issue. Phase A remains In Progress; B–F remain Pending until the prerequisite evidence is resolved. No new app edit/build/fixture/session operation is performed merely to process this report.

Read-only investigation gate:9 existing filtered coordinator/probe tests covering unexpected playback, covered/paused intent and stale callbacks pass. Log: `/dev/shm/plan177-report-guard-tests.log`. These verify guard behavior under controlled ports, not the cause or absence of the phone event. Build27 source/artifact remains frozen.

### Build27 follow-up and Phase B implementation — 2026-10-26

The user explicitly confirms that paused0/7 remain paused, playing audio is clear and the cover stays silent until Reveal. Their full report matches frozen build27/source and has resetCount0. Selected fields and observations are retained in `tests/runs/device/plan_177/build27-full-report-excerpt-1.json`; it is explicitly an excerpt, not a reconstructed full export. Email headers/addresses are excluded.

The single unexpected-playback issue belongs to Global publication222/session20/activation5 during scrolling, with the selected ID still222, active app/screen and no manual pause. Selection is at352829943.660875ms; the issue is at352830005.984083ms; playing=false follows at352830006.053166ms. That0.069083ms event spacing does **not** measure audible duration. The guard stopped a reported ineligible play; keep it as a real swipe race, separate from the readiness checks. Later readiness sessions26–36 follow this issue, while early sessions9–14 precede it. No readiness-context issue is retained.

The mixed session has108 allocations/107 releases/1 live, peak3,57 transitions/47 frames/10 incomplete/0 errors and normal preparation63.16%; prepared p95126.33ms. This is not the controlled40-forward gate. Several initial selections jump to a neighbor and back in24–52ms. The new paging controller ignores unsolicited layout offsets and orphan momentum completions, suspends queued movement on cover, and accepts explicit gestures/programmatic navigation. The coordinator now mutes every ineligible entry before cancelling native play intent; a late native play is still stopped and recorded, never hidden from diagnostics.

Phase B now uses keyed sibling visits in the permanent Feed route. Global retains its own FeedScreen/store/coordinator/VideoView, with visit-scoped command registrations. A single native-retention lease captures the original public proof and exact selected player/source; the cap is min(60s, original remaining proof). Cache reads, renewal and duplicate taps cannot restart it. Background/inactive, memory warning, authority/source/player invalidation or capacity pressure evict and release. A dormant source cannot allocate again until an explicit authorized cold return. Nested group/personal detours retain only scalar group checkpoints; there are at most two media owners. A visible destination initially has selected/forward capacity2 beside parked Global1; needing a third slot disposes Global synchronously before allocating. The global3-player budget remains the final guard. Hidden visits do not fetch ahead, run engagement/text reads, receive native hit/accessibility traversal or overwrite active commands. Warm return reuses the original owner without replace/seek and performs quiet anchored JSON revalidation; `retained_ready` records the presentation layout commit, without fabricating a first-frame event.

Host gates:222 unit tests and67 rendered tests pass, plus typecheck. Targeted final retention3 and Launch23 tests additionally verify duplicate-tap deadline stability, original view identity, paused/playing warm trips, capacity/memory eviction, cold fallback and cleanup of native listeners, AppState/memory listeners and publication jobs before AuthStore disposal. These are host results, not native sound/latency acceptance. No server/session/fixture mutation or commit/push.

Remaining Phase A geometry/presentation gap: build27 used440×280 and manual ready→Reveal dwell. The next internal artifact adds **automatic full-height** paused7/playing0 checks, with immediate effect-driven Reveal once independent view-frame and exact native target evidence arrive. Manual comparison checks remain available. The decoded evidence contract is unchanged and still does not acknowledge VideoView pixels. Two focused physical observations replace another whole four-check campaign; production automatic reveal remains gated until this gap is qualified. Phase B native warm-return/audio acceptance also remains open.

## Phase B — One fresh native pool per feed

- Goal: Simplify actual feed transitions without changing within-feed paging.
- Steps:
  - [x] Release the departing coordinator synchronously before committing a new keyed Feed visit; remove parked visits, retention leases and capacity-pressure policy.
  - [x] Keep only scalar publication/time/manual pause checkpoints and bounded authorized JSON across feed changes. Keep cross-view PlayerHandoff disconnected.
  - [x] Preserve Global → Launch → Close player identity and intent; actual group/personal/Global transitions use fresh decoders and the existing shared maximum3 budget.
- Test gate: actual navigator trips, full3-player window while paging, paused/playing checkpoint returns, release-before-allocation, stale commands and listener/watch cleanup. Native audible quality remains a physical gate.

## Phase C — Fresh-feed readiness and reveal

- Goal: Show the named destination splash until the selected authorized media is ready at the intended position.
- Steps:
  - [x] Add an attempt-scoped entry gate, independent of diagnostics, to the stable full-height VideoView. Hold pause/mute and interaction until source replacement, ready status, restore completion, first-frame and exact native target evidence agree.
  - [x] Consume existing prepared JSON in one data owner; retain exact Launch target validation through native preparation and Retry until presentation commits.
  - [x] Recheck authority and lifecycle at completion/presentation; cancel on departure/background/identity change, ignore late evidence and expose bounded20s Retry errors. Empty/unplayable feeds expose normal actions.
  - [x] Record `entry_revealed` from the presentation layout commit, preserving cumulative first-frame/restore/playing timings. Entry failures remain explicit `entry_readiness` errors.
- Test gate: delayed source/frame/native evidence, stale completion, failed/missing exact-target Retry, diagnostics on/off, authority/lifecycle changes, pure timeout/clamping/error-redaction contracts and actual navigator cleanup.
- Acceptance: no controls/audio before reveal, no second player/data mount at reveal, no stale commit or silent fallback to another Launch target. The decoded target contract does not claim hardware pixel acknowledgement.

## Phase D — Named splash and route coverage

- Goal: Use consistent loading feedback for fresh startup and feed changes; retain smooth normal paging.
- Steps:
  - [x] Add an opaque black splash with `Loading <feed>…` and an indeterminate horizontal bar, reduced-motion handling and accessible text. Use the destination name during chooser resolution and keep Close usable there; after resolution, navigation controls remain above the destination splash.
  - [x] Cover preference/auth bootstrap, initial Global, Spaces/personal/Launch entry, Global returns and explicit Refresh. Source-resolution cancellation/failure preserves the original feed; after commit, Back/Global can leave a preparing destination.
  - [x] Remove radial indicators from product call sites; retain delayed buffering/caption text and explicit feature Retry/error actions. Ordinary slides bypass the entry gate and never show the feed splash.
  - [x] Preserve large-text scrollable splash content, hidden underlying accessibility/actions and normal preloading/caption behavior in rendered checks. Physical VoiceOver/layout qualification retains its existing limits.
- Test gate: full rendered route/feature suites, native unit/typecheck gates and source audit of all ActivityIndicator call sites.

## Phase E — Host and artifact qualification

- Goal: Establish regression evidence for final source before phone acceptance.
- Steps:
  - [x] Run mobile unit/rendered/typecheck and iOS export against final inputs; include readiness behavior with diagnostics disabled.227 unit/71 rendered pass; final stamped typecheck/export pass.
  - [x] Full rendered suites cover access/Follow/engagement/text under entry eligibility. Server inputs unchanged by this revision; prior Plan176 backend/API/browser evidence retained with its original scope.
  - [x] Navigator/pure tests assert release and cleanup of native listeners, AppState/memory listeners, access jobs and entry timers after departure/cancel/repeated trips and stale completions; existing access/identity regression suites pass. Peak3 is an additional bound, not sole leak evidence.
  - [x] Prepare build29 after fresh history confirmed28 was latest; source manifest/archive/export/downloaded embedded bundle/API/native module and accepted-phone provisioning verified. Source remains frozen after submission; build26/27/28 evidence preserved.
- Test gate: appropriate suites plus source/archive/export/downloaded artifact checks under `tests/runs/build/plan_177/`; docs/links/whitespace checks with known baseline findings separated.
- Acceptance: matching source/artifact, passing relevant regressions, no private build inputs, bounded resources and no weaker authority. No audio/performance claim from host verification.

## Phase F — Physical acceptance and predecessor closure

- Goal: Validate the requested experience and measure actual cost, then reconcile open work without repeating obsolete-build campaigns.
- Steps:
  - [ ] Confirm exact installed build/source and saved sound/CC; observe cold startup and Global → Launch → Close with no unnecessary feed bar.
  - [ ] First perform a focused final-build check: fresh startup, one playing Global → Launch → group → Back to Global trip, one paused return and a few forward/reverse swipes. Confirm named splash, original time/pause, clear single-owner audio and working controls. Do not repeat the accepted diagnostic readiness experiment by default; expand testing only after this functional gate passes.
  - [ ] Report fresh-entry/return totals separately from post-reveal playing/advancing, with build26 as a qualified comparison. The old retained-return250ms/no-replace target is superseded; feed-switch delay is explicitly accepted, without an invented cold maximum guarantee.
  - [ ] Exercise Close during chooser resolution, leaving a preparing destination, Retry, choosing another destination, expired-data return, background and reachable non-Launch feed entry; include host-proven access/identity races in the recorded disposition.
  - [ ] Preserve existing stable-Wi-Fi/usual-text/CC-on40-forward gate: prepared first-frame p95<=150ms, normal preparation>=90%, peak<=3, zero errors/incomplete/unexpected playback in the controlled gate. Review playing/advancing time, cold outliers, frame history and user-observed stalls/audio separately. Inspect reverse swipes in the full within-feed window too.
  - [ ] Carry Plan175/176 access-loss/recovery/overnight, final unsent-draft/sign-out/current-session revocation and exact owned-fixture cleanup forward. Previously deferred offline/nested physical tests remain deferred until the user resumes them; record any final accepted coverage limit explicitly.
  - [ ] Reconcile Plans175/176 and roadmap with successor evidence; do not mark complete while required work remains. Re-identify current phone/session provenance before any eventual mutation; never assume historical session128 is current.
- Test gate: full diagnostics and explicit physical observations plus targeted server/session/fixture cleanup evidence, stored under this plan's harness paths and linked to predecessor gates.
- Acceptance: requested loading location, exact entry/return semantics, static-free single-owner audio and preserved swipe performance proven for final artifact; unresolved limitations remain explicit.

## Expected File Impact

| Area | Expected changes |
| --- | --- |
| `mobile/src/navigation/ViewerNavigator.tsx`, new feed-host/switch-controller modules | One active keyed visit, release-before-allocation and scoped route registrations |
| `mobile/src/navigation/globalLaunchJourney.ts`, `viewerJourney.ts` | Keep bounded scalar origins, exact Launch targets and nested return semantics |
| `mobile/src/spaces/LaunchSpacesScreen.tsx`, `launchStore.ts`, `launchPreparation.ts` | Overlay-owned loading/cancel/error state; preserve bounded exact-entry JSON caching |
| `mobile/src/feed/FeedScreen.tsx`, `useViewerFeed.ts`, `globalFeedMemory.ts` | Single data owner, exact-target Retry, bounded data reuse and fresh-entry readiness |
| `mobile/src/playback/coordinator.ts`, `useFeedPlayback.ts`, `VideoSurface.tsx`, `playerBudget.ts` | Entry presentation policy, shared3-player budget, release-grade readiness and delayed buffering text |
| Repository-owned native readiness adapter/configuration, only if Phase A requires it | Attempt-scoped seek/presentation evidence; exact packaging decided and documented before use |
| `mobile/src/auth/useSpaceAccess.ts`, shared access registrations as needed | Bounded preparation authorization without granting interaction/playback eligibility |
| `mobile/App.tsx`, new dedicated loading-bar component, scoped loading call sites | Startup/feed bar and text/action feedback in other features |
| `mobile/src/diagnostics/playbackDiagnostics.ts`, native unit/rendered harness and suites | Honest switch stages, native signal control, races/resource/identity regression coverage |
| Plan/index/roadmap and relevant mobile developer docs | Final implemented behavior and qualification limits; product docs change when behavior is implemented |

No server/schema change is currently indicated by the investigation. If native feasibility changes scope, update this plan before broadening execution.

## Change Log

- 2026-10-26 — User accepts the delivered build29 experience: “Video to Video is seemless within a Feed. We get a loading bar and notice when we jump to another feed.” Commit and push explicitly requested. Record this as qualitative loading/paging acceptance; no additional full diagnostics, explicit static-free audio statement or expanded edge-case campaign was supplied. Publish the integrated Plan176/177 implementation and earlier local Plan175 checkpoint, preserving phone sign-in/fixtures and existing validation limits.

- Uncommitted2026-10-26 — Accepted build28 full-height paused7/playing0 observations and recorded retained Global static. User approved fresh pools and named loading splashes. Removed parked native retention; production readiness gates authority/source/restore/frame/native target before audio/interaction, with exact-target Retry and bounded cancellation/errors.227 unit/71 rendered/typecheck pass; final stamped export/archive match144 inputs/145 files and4 native files. Build29 submitted as `d457b46e-af26-41f9-9439-e6faee85ad7d`, source `510f514563851fd61c0ec9ad0abfe7d706a52f648ac0f03a7fd678b2d1fe4cf9`; downloaded artifact verification passed, phone gates pending. No server/session/fixture mutation or commit/push.

- Uncommitted2026-10-26 — Build28 frozen source `2692de46c20c18843e285660440ae8034cb96ace49e06f313a7307a1303312db`, EAS `da73edb2-a549-4e15-97a8-7621dfed5e11`, export/archive/downloaded IPA/native module/API/accepted-phone signing namespace verified; OTA off.222 unit/67 rendered pass; final typecheck passes after a test-only empty-array narrowing correction. No app input changed after submission. Automatic full-height and retained native audio observations remain pending.

- Uncommitted2026-10-26 — Accepted explicit build27 paused/audio observations, retained a sanitized full-report excerpt and located the Global222 swipe issue. Implemented scoped stable visits, original-proof native retention, synchronous capacity eviction and cold fallback; hardened mute/gesture handling.222 unit/67 rendered/typecheck pass; final retention3/Launch23 pass with listener/watch cleanup. Added two automatic full-height diagnostic cases; production reveal remains gated.

- Uncommitted2026-10-26 — Recorded source-matching build27 report with two confirmed playing checks at0/7s; decoded readiness1.30/0.73s, native seek174/86ms, playing142/146ms after manual Reveal. Documented per-screen history loss,440×280/manual-dwell limits and unresolved session-wide unexpectedPlayback1. Requested paused/audio confirmation and full ordinary diagnostics without another full four-check run;9 controlled guard tests pass. No product source/build/session/fixture mutation.
- Uncommitted2026-10-25 — User authorized execution. Implemented Phase A native feasibility check, controlled evidence/cancellation tests, local-module packaging and atomic source-stamp publication;215 unit/63 rendered/typecheck pass. Build27 source/export/archive/native compile/downloaded signed artifact verified; physical qualification pending. Ordinary feed-switch behavior remains gated; no database/session/fixture changes or commit/push.
- Uncommitted2026-10-25 — Investigated current navigator, Launch/data/access owners, player budget, seek/view readiness and installed Expo iOS source. Wrote the requested plan; implementation phases remain Pending. No product source/build/session/fixture mutation.

## Validation

- Environment: `/home/ubuntu/aws`, `main`, integrated Plan176 work preserved; prior local checkpoint `407fe73` is included in the explicitly authorized commit/push delivery.
- Source inspection: files linked above and installed `expo-video`57.0.5 public types/iOS view/seeker. Phase A experiment, host evidence and verified native artifact are recorded above; physical observation remains separate.
- Baseline phone evidence: build26 selected report analysis in Plan176. Prior206 native unit/61 rendered/typecheck results belong to build26; they are not new Plan177 validation.
- Prior planning-only checks2026-10-25: `npm run check:agents:docs` retained exactly16 pre-existing status findings, zero new; before/after diagnostics matched. All49 local Markdown links resolved and whitespace passed. SHA256 comparison of963 non-agent files showed zero changes in that prior planning turn. Current execution has the explicit Phase A product changes above.
- Execution docs checks: same16 pre-existing status findings, zero new;63 local Markdown links across plan/index/roadmap/predecessor/mobile docs resolve; tracked/new-source whitespace passes. Final workspace/archive source identity matches the submitted manifest. No commit or push.
- Known gap: fresh-player final-build audio/layout/startup acceptance remains pending. Build27 manual and build28 automatic full-height readiness are accepted with recorded limits; build28 retained-return audio failed. Host callbacks cannot certify audible quality.

## Open Risks / Deferred

- Hidden native rendering/presentation is the main feasibility risk. Public first-frame and timeline APIs are insufficient to claim target-frame acknowledgement without further evidence; the adapter contingency is explicit and gated.
- Cross-feed native retention was removed after build28 static; fresh-player audio still needs physical confirmation. Its exact native cause remains unproven; no SDK/mixing patch is inferred.
- Every actual feed change intentionally incurs fresh native preparation; bounded authorized JSON can still accelerate data readiness. Expired data/access must renew before reveal.
- No committed latency improvement is claimed for cold HLS. Slow/failing loads must remain cancellable and measured, with bounded errors.
- Pre-tap native destination warming, SDK upgrade, CDN/media work and private-delivery enforcement remain deferred. VoiceOver physical qualification and prior deferred phone work are not silently reopened or certified by rendered tests.

### Build28 verified — 2026-10-26

EAS `da73edb2-a549-4e15-97a8-7621dfed5e11`, version0.1.0/build28, frozen source `2692de46c20c18843e285660440ae8034cb96ace49e06f313a7307a1303312db`. The142 public inputs and143-file upload archive match exactly, including4 local-native module files; private inputs0. Hermes export2261947 bytes contains the intended source/API, automatic full-height actions and retained-ready stage.222 unit/67 rendered/typecheck pass; final stamped typecheck/export/archive pass. Docs retain16 pre-existing findings with zero new,56 local links resolve and whitespace passes. Host evidence is under `tests/runs/build/plan_177/{source-manifest-build28.json,archive-export-build28.json,host-gates-build28.json}`. EAS finished2026-10-26T06:54:08.761Z; the downloaded IPA was verified06:57:49Z. IPA8343925 bytes, SHA256 `ed3902b16ae5b78e30f65cc7e0892cdc57be155a5fa765c629b5dcc635690e3f`, embedded Hermes2262039 bytes. Bundle/source/API and local native module match; the accepted single-phone device set, signing namespace and bundle ID match build26, get-task-allow=false and OTA=false. No private provisioning values are included in public evidence. [Install verified build28](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/da73edb2-a549-4e15-97a8-7621dfed5e11). Artifact evidence: `tests/runs/build/plan_177/artifact-build28.json` and `build28-meta.json`. This is the stable-owner/native-feasibility increment; C/D production reveal/loading/startup migration is still pending.

### Build29 verified — 2026-10-26

User-approved fresh-player revision: `d457b46e-af26-41f9-9439-e6faee85ad7d`, version0.1.0/build29, frozen source `510f514563851fd61c0ec9ad0abfe7d706a52f648ac0f03a7fd678b2d1fe4cf9`. All144 public source inputs match the145-file archive exactly, including4 native module files; private inputs0. Hermes export2265639 bytes, embedded bundle2265731 bytes.227 unit/71 rendered/typecheck pass; final stamped typecheck/export/archive pass. Downloaded IPA8345097 bytes, SHA256 `2ebd492d058d5f09373770edb65629b5ccb8e49da3058c1b18504a5cfdd8e161`. EAS finished2026-10-26T17:08:07.822Z; artifact verified17:08:42Z. Bundle/source/API/native module and accepted single-phone device set/signing namespace match build26; get-task-allow=false, OTA=false. Source unchanged after submission. Docs retain exactly16 baseline findings with zero new; local links and whitespace pass. Evidence: `tests/runs/build/plan_177/{source-manifest-build29.json,archive-export-build29.json,host-gates-build29.json,artifact-build29.json,build29-meta.json}`. [Install verified build29](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/d457b46e-af26-41f9-9439-e6faee85ad7d). Final phone audio/layout/startup/swipe acceptance and predecessor closure remain pending. No server/session/fixture mutation or commit/push.

## Resume Here

- User accepts seamless within-feed scrolling and named loading feedback between feeds on build29 and explicitly requests commit/push. This is the accepted delivery checkpoint; retain remaining evidence limits without requiring another phone campaign for this commit.
- A–E host/artifact work is complete. [Install build29](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/d457b46e-af26-41f9-9439-e6faee85ad7d) is verified, frozen and ready to install over the existing app. F is In Progress with qualitative loading/paging acceptance; broader evidence and predecessor closure remain open.
- Loading/paging experience is accepted. No new numerical performance report, explicit audio confirmation or expanded edge-case evidence was supplied in this acceptance; keep those limits and predecessor gates recorded rather than inferring them. No diagnostic readiness rerun or full20-trip/40-forward campaign is requested for publication.
- Build27 manual and build28 automatic full-height readiness are accepted. Build28 retained return has correct position but static audio; build29 replaces that ownership path. An audio fix is not established until the phone confirms it.
- Preserve build26/27/28 evidence, all Plan175/176 work, fixtures and phone sign-in. Their outstanding final performance/sign-out/cleanup gates remain open. Commit/push is explicitly authorized for this accepted checkpoint.
