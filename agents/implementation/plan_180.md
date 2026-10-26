# Plan 180: Full-height opaque feed loading cover and unified picture reveal

Status: Complete

## Feature Reference

- Predecessors: [Plan177](plan_177.md) for fresh players/readiness, [Plan178](plan_178.md) for edge-to-edge video/floating header/checkpoints, and [Plan179](plan_179.md) for the accepted creator/date/story panel.
- Contract: [Personal Space, Global Feed, and Context Integrity](../features/feature_02_personal-space-global-feed-context-integrity.md).
- Roadmap: [Native viewing](../roadmaps/roadmap_native_viewing.md).

## Context

During a feed change the user sees part of the incoming image behind the dimmed top scrim while the area below remains covered. They find the split reveal jarring and suspect the early image may be a poster. They approve the recommendation to show black behind both regions until the restored picture is ready, then reveal the full picture together. The destination name, Space selector and Menu remain visible on black throughout loading.

The user reviewed this plan and explicitly authorized implementation, including its signed preview and validation. The user now explicitly requests a local commit; push remains unrequested for this increment. Planning starts from clean `main` at local delivery commit `7f6f083`, following implementation `adeed1e`; both are unpushed. Accepted signed build31/source `c4621b6ac97f38b74546e28672e2d4107296ca163a5da31c818dcb929e25f5c8` is the comparison artifact. Its panel acceptance and234 unit/81 rendered/58 backend tests remain evidence for that source, not proof of this proposed cover fix.

In scope: the native feed-entry cover from the physical top edge through the video stage, beneath the floating controls; consistent loading/error presentation; targeted regressions; next signed preview and focused phone qualification when execution is authorized. Preserve the per-feed publication/time/manual-pause bookmarks the user explicitly likes.

Out of scope: frozen incoming previews, crossfades, poster redesign/removal, video sizing changes, delayed space-name updates, new player retention/pools, new readiness/seek/buffering policy, audio configuration, backend/API/schema changes, bottom tabs and broad predecessor test campaigns.

## Investigation Findings

| Source | Established behavior and consequence |
| --- | --- |
| [FeedScreen](../../mobile/src/feed/FeedScreen.tsx), FeedSession `covered` overlay | The absolute-fill wrapper has `paddingTop: headerHeight` and no background. Its black child begins below that padding. The padded top strip is transparent, allowing media beneath the floating scrim to show while the lower region is black. This directly explains a split-cover path in source. |
| [FeedLoadingSplash](../../mobile/src/ui/FeedLoadingSplash.tsx) | The child owns `backgroundColor: '#000'`, the named Loading bar and retry/error contents. Moving its contents below the header is appropriate; relying on that inset child for the whole cover's opacity creates the gap. Separate the opaque surface's bounds from content placement. |
| [FeedCard](../../mobile/src/feed/FeedCard.tsx), [VideoSurface](../../mobile/src/playback/VideoSurface.tsx) | FeedCard mounts a poster below its media children; VideoSurface also mounts a poster until `hasFrame`, alongside the actual VideoView. A poster can occupy the exposed strip before a frame; decoded video can occupy it afterward. The user's exact observed pixels are unconfirmed. The fix must hide either source without needing to identify which one was visible on the phone. |
| FeedScreen floating toolbar and access masks | The toolbar is a later absolute sibling with a35% black scrim; image intentionally extends behind it after presentation. Existing authorization masks already own full black backgrounds including their padded area. Keep these layers opaque and keep the header above the loading surface. |
| [FeedEntryReadiness](../../mobile/src/playback/feedEntryReadiness.ts), FeedSession presentation effect | Existing entry checks require authorized source readiness, restoration/native target evidence, independent view frame and usable geometry, with revalidation at presentation. Playing evidence is not required to reveal an intentionally paused restored video. Ordinary within-feed paging bypasses this entry gate after presentation. Keep this contract and layout-commit ordering. |
| [Launch rendered tests](../../mobile/tests/rendered/launch.test.cjs), [entry unit tests](../../mobile/tests/feedEntryReadiness.test.ts) | Tests hold native target readiness after a pre-seek view frame and verify silence, hidden actions and stable view identity. They do not assert that the outer cover paints black through the header padding. Add a regression for that gap and its removal at reveal, rather than another readiness implementation. |

## Locked Decisions

1. During actual feed entry, one opaque black surface covers the entire media stage from `top: 0`, including beneath the time/status indicators and floating header. Neither incoming poster nor video is visible in the top strip before reveal. The bottom reserve stays black as today.
2. Keep destination name, Space selector, Menu and contextual escape actions visible, legible and usable over black. Loading bar, messages and Retry remain below the measured header. Header text may change as soon as the destination is selected; incoming imagery waits for readiness.
3. Reveal the picture behind the scrim and the picture below it together. Preserve the normal35% top scrim once the cover is removed. No stagger, crossfade, guessed timer or early poster preview.
4. Reveal only under the existing restored-frame/authority/presentation contract. Saved manual pause stays paused; a playing visit resumes according to its saved intent. Do not wait for actual playback to reveal a paused return or add a play/pause/seek to solve a layout issue.
5. Keep the incoming VideoView/player mounted while preparing and revealing. The cover changes opacity/visibility; it does not replace, reparent or resize the video, create another player or alter native readiness evidence.
6. Cover failed, timed-out and retrying entry opaquely through the same top area. Access denial remains fully opaque. Leaving or replacing the destination cancels its work; late callbacks cannot reveal an old feed or revive its audio.
7. Apply the rule to Global, personal, group and channel entry/returns and explicit feed Refresh. Loading does not reappear on ordinary video-to-video swipes after entry. Opening/closing Spaces or Launch without a feed change preserves the current owner and existing80% chooser treatment.
8. Preserve selected publication, restored position, manual pause, mute/CC preferences, creator/date/story behavior, fresh per-feed pools and the shared maximum of3 players. This is the user's “channel that waits for you” behavior.

## Proposed Implementation

Use the existing absolute-fill entry wrapper as the full-stage black surface, or an equivalently small shared cover component if inspection shows multiple affected paths. Give that outer surface its own opaque black background. Keep `paddingTop: headerHeight` for the loading/error content inside it. Padding must not create a transparent portion of the cover. Avoid adding a second readiness owner, header copy, timer or native modal.

Audit the initial-data-loading, preparation, failed-preparation, Retry and access-mask branches. Initial data-loading already sits over a black feed root with no incoming media; preserve that result. Authorization masks already have an outer black background; do not weaken them during consolidation. Confirm empty/unplayable feeds still reach their existing feedback/actions rather than waiting for impossible native evidence.

The floating header remains outside/above the stage cover so Space/Menu can escape a slow or failed load. Keep feedback clear of measured header bounds under narrow widths, larger text, safe insets and orientation/viewport changes. Verify input and accessibility layering: covered media/story/actions stay unavailable while header navigation and retry actions remain reachable. Do not extend modal accessibility scope so far that it hides the escape controls.

Retain the existing `covered`/readiness/presentation ordering unless a focused regression demonstrates a real exposure between readiness and successful layout-commit presentation. The normal implementation should be a surface/stacking correction. If that test exposes a presentation-order defect, keep the same-frame reveal, authority recheck and audio-after-presentation contract explicit; do not replace it with “wait until playing.” Native composition cannot be proven by a test renderer, so qualify the final signed phone result separately.

## Phase Status

- A: Complete for host implementation — Outer entry surface paints the whole stage black; feedback/header/presentation layering retained.
- B: Complete —234 unit/84 rendered/typecheck and8 focused cover cases pass; regression fails all4 cases before the surface fix.
- C: Complete for the recorded build32 milestone — Host/artifact gates and user-confirmed unified cover/reveal, visible Space/Menu, saved position, paused/playing return, clear audio/silent loading and smooth within-feed swipes pass. Untested physical cases remain scoped below.

Implementation is explicitly authorized. A/B host work passes:234 unit/84 rendered/typecheck and8 focused cover cases. Four new poster/pre-seek paused/playing regressions fail before the fix and pass afterward. Frozen signed build32 and the focused physical checks also pass, with the coverage limits recorded below.

## Phase A — Cover the entire incoming picture

- Goal: Eliminate the transparent top strip while preserving header navigation and current presentation behavior.
- Steps:
  - [x] Give the stage-entry cover an opaque background at its outer absolute-fill boundary; retain measured inset only for loading/error contents.
  - [x] Audit initial loading, preparation, failure/Retry, empty/unavailable and authority-mask paths for the same whole-stage result.
  - [x] Preserve header scrim/controls above the cover, black footer, source/view identity, checkpoints and existing presentation/audio ordering.
- Test gate: Mobile typecheck plus focused actual-feed/Launch rendered cases. Verify full-stage bounds/background independent of header padding and loading-child background; verify existing authority masks remain opaque.
- Acceptance: Both poster and decoded frame stay concealed behind the whole-stage surface until the existing entry presentation is allowed. Feedback and navigation are reachable without changing video geometry or restoration.

## Phase B — Prove the split reveal cannot recur in host structure

- Goal: Cover the reported gap and protect the accepted channel-return behavior.
- Steps:
  - [x] Supply a visible poster, delay source readiness/view-frame/native target independently, and assert the outer black cover spans `top: 0` through the full stage with nonzero top safe inset/header height. Test an early frame at the wrong pre-seek time while target restoration remains pending.
  - [x] Verify the cover remains on entry failure/timeout/Retry and access denial; abandoning preparation ignores late completion. Header Space/Menu remain usable; content/actions remain blocked.
  - [x] Complete readiness and verify the entire cover is removed together over the same VideoView/player, at the saved position, for paused and playing intent. Preserve silence until permitted presentation and no extra allocation/replace/seek due to the cover.
  - [x] Exercise menu feed changes/returns, Launch entry, initial Global and Refresh; retain same-feed selection/chooser Close and ordinary forward/reverse swipes without a new entry splash. Preserve accepted creator/date/story/caption behavior.
- Test gate: `npm --prefix mobile test`, `npm --prefix mobile run test:ui`, `npm --prefix mobile run typecheck`. Extend existing readiness/navigation/geometry cases with meaningful cover-bound assertions; run any newly failing targeted case after correction. No backend suite or deployment is expected for unchanged backend inputs.
- Acceptance: New tests fail for the current transparent padded wrapper and pass with the corrected surface. Existing player/checkpoint/authority and ordinary-paging contracts remain intact. Record host tests as structural evidence, not native pixel proof.

## Phase C — Verify the signed phone presentation

- Goal: Confirm a uniform cover/reveal on the delivered artifact without losing saved-place continuity.
- Steps:
  - [x] Prepare the next available numbered internal preview using the established source stamp/archive/export/downloaded artifact/signing checks. Verify public source/API/native module/accepted phone set, no private inputs and OTA disabled. Preserve accepted build31; freeze source after submission.
  - [x] Record user-confirmed Global → another space → Global whole-picture black loading cover, including behind the header, unified reveal at the saved position, preserved paused/playing state, clear return audio and silence under the loading cover.
  - [x] Record user-confirmed Space/Menu visibility during loading and smooth within-feed video swipes. Leaving a pending feed, exact scrim/geometry/footer values and larger-text/accessibility behavior retain host evidence; no separate physical result for those cases was supplied.
  - [x] Use host evidence for bounded failure/Retry/late-callback paths where a physical repro is unavailable. Record untested device/font/orientation/accessibility cases explicitly; keep predecessor coverage/cleanup limits and phone sign-in/fixtures.
  - [x] Update plan/index/roadmap/mobile docs with actual source/artifact and observed host and user-confirmed physical results, with untested cases explicitly scoped. Commit/push only when requested for this increment.
- Test gate: Matching final public source/export/archive/signed artifact, focused physical cover/reveal/saved-position observations, documentation check with zero new findings and valid local links.
- Acceptance: No separate top-image preview during entry, one full-picture reveal, original checkpoint/manual intent preserved and normal paging unaffected. Native view-frame/decoded evidence remains distinct from physical screen/audio confirmation.

## Implementation and release record

- The product change is the outer entry wrapper's `backgroundColor: '#000'` in FeedScreen. Its absolute-fill bounds include the top padding; header-height padding still positions loading/error content safely. Floating header, normal35% scrim, root black fallback, footer and authority masks retain their existing structure. No readiness state, player, source, seek, checkpoint, audio or poster code changed.
- Native test ports now model real absolute-fill bounds instead of an empty object. The regression supplies posters and manually delays view frames/native target evidence. All4 paused/playing × ordinary/internal cases fail on the former transparent wrapper, specifically at the outer black-surface assertion; all pass after the fix. Assertions cover initial Global, full-stage offsets with nonzero header padding, mounted poster then a pre-seek frame, silence/hidden content, available header navigation, restored7s position, preserved paused/playing intent, unchanged player/view/source-load count and normal scrim after reveal.
- Existing pending-entry departure and failure tests now assert full-stage opacity; the bounded timeout/Retry and explicit Refresh cases do too. Leaving a pending feed through Space selection cancels its work; late completion cannot revive it. Existing chooser Close/current-feed selection, forward/reverse preloading, creator/date/story and caption regressions pass in the full suite. No evidence required a change to presentation ordering.
- Host gates:234 mobile unit tests,84 rendered tests and typecheck pass;8 focused cover cases pass. Evidence: `tests/runs/build/plan_180/host-gates-build32.json` and corresponding logs, with the expected pre-fix failure in `cover-regression-red-build31.txt`. These are structural/state/native-port results, not native pixel or phone audio observations.
- Backend/API/schema/web inputs are unchanged from the accepted local baseline; no backend deployment/suite rerun or fixture/session operation was performed. Prior backend58/live timestamp evidence remains scoped to unchanged inputs.
- Frozen build32 source `639412a0705a9833b6b5e8430009ea76fbffd0d24204686215e90579bb57608a`:148 public inputs/149 archive files,4 local native module files, no unexpected/private input. Workspace/archive/source/API match; Hermes export2282689 bytes. Evidence: `tests/runs/build/plan_180/{source-manifest-build32.json,archive-export-build32.json}`. Build31 is preserved. EAS `c2fff865-8404-4e5c-a5b6-b1fd6d29723a` finished2026-10-26T22:18:42.009Z; downloaded artifact verified22:19:58Z. IPA8354090 bytes, SHA256 `d0c1d324ce8f7c1956369f798f9597e5aa181cfde26dd881c0e5fe6bbc17afd0`, embedded Hermes2282781 bytes. Source/API/internal-preview/native module match; accepted single-phone set/signing namespace match build26, get-task-allow=false, OTA=false. Artifact records: `tests/runs/build/plan_180/{artifact-build32.json,build32-meta.json}`. [Install build32](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/c2fff865-8404-4e5c-a5b6-b1fd6d29723a) over the existing app. The user subsequently confirms unified-cover/reveal, saved position, paused/playing state, clear return audio/silent loading and smooth swipes as recorded below; source is unchanged after submission.

## Build32 phone acceptance

The user answered **“Yes, those checks pass”** to both explicit build32 questions. On Global → another space → Global, the whole picture stays black during loading, including behind the header; Space/Menu stay visible; the picture reveals together at the saved position. On paused and playing returns, pause state and clear audio are preserved, no sound plays under the loading cover, and within-feed video swipes remain smooth. These are accepted observations on signed build32/source `639412a0705a9833b6b5e8430009ea76fbffd0d24204686215e90579bb57608a`.

Evidence: `tests/runs/device/plan_180/build32-acceptance.json`. No separate numerical performance/resource report, short-phone/large-text/orientation/VoiceOver, physical failure/Retry/pending-departure, or exact scrim/video/footer measurement was supplied. Host coverage and predecessor limits remain explicit. The historical static cause remains unproven; this reply does establish clear audio for the checked build32 return paths. No rebuild, source edit, session/fixture operation or commit/push is needed to process acceptance.

## Change Log

- 2026-10-26 — User explicitly requests a local commit after accepting both build32 check sets. Product source still matches the accepted signed artifact; commit checks cover source identity, documentation and whitespace. Push remains unrequested.

- 2026-10-26 — User confirms both build32 physical check sets: whole-stage black loading/unified saved-position reveal with visible navigation, paused/playing state, clear return audio/silent loading and smooth swipes. A–C Complete for this internal milestone with recorded limits. Commit/push not requested.

- 2026-10-26 — User explicitly authorizes Plan180 implementation. A/B host gates pass with a one-line opaque-surface product fix, realistic absolute-fill test ports and expanded cover regressions; C host/artifact work passes for frozen signed build32; focused phone acceptance remains pending. No backend/session/fixture change or commit/push.

- 2026-10-26 — Planning only after the user approved a full black/loading cover and unified reveal. Source confirms a transparent header-padding gap and both poster/video candidates beneath it; the exact previously seen pixels remain unconfirmed. Baseline local implementation `adeed1e`, continuity `7f6f083`; neither pushed.

## Validation

- Environment: `/home/ubuntu/aws`, `main` clean at start,2 commits ahead of `origin/main`. No AGENTS.md found in the repository or inspected workspace ancestors.
- Planning inspected current feed/card/surface/splash/header, readiness state machine and relevant actual-component/unit tests without changing product files. Existing test titles asserting held pixels did not check outer-surface opacity across the padded header.
- Planning checks: before/after `npm run check:agents:docs` retains the same16 existing status findings and zero new findings. All63 local links across the four changed planning/continuity documents resolve. New-plan whitespace, A–C Pending statuses and `git diff --check` pass. Public product inputs still exactly match accepted build31.
- Implementation checks now run: mobile234 unit/84 rendered/typecheck,8 focused cover cases, a four-case expected pre-fix regression failure, stamped preview export and archive inspection. Prior build31/backend evidence is preserved with its original scope; downloaded signed build32/source/API/native module/accepted-phone checks also pass; the subsequent user-confirmed visual/audio observations pass as recorded above; other physical cases remain unverified.
- Planning evidence: `/dev/shm/plan180-docs-before.log` and `/dev/shm/plan180-docs-after.log`. Current implementation docs check in `/dev/shm/plan180-docs-implementation.log` retains16 baseline findings/zero new;80 local links resolve and whitespace passes. Public source remains unchanged after build32 submission. Implementation changes and evidence are recorded above.

## Open Risks / Deferred

- A poster is plausible from source, but the phone observation does not establish poster versus decoded frame. The cover must conceal both; no extra diagnostic/fixture campaign is necessary merely to identify that image.
- The signed-phone unified-cover/reveal observation is now accepted. Host renderer assertions remain structural evidence rather than a general native pixel API or exhaustive frame-by-frame composition measurement.
- Safe-area/header padding must position feedback without changing opaque bounds. Larger names/text/viewport changes must not expose a seam or make header/Retry actions unreachable.
- Frozen previews and fades remain deferred. Existing media readiness, first-frame versus physical display limitations, native static cause and predecessor quantitative/short-phone/VoiceOver/offline/nested/sign-out/cleanup gaps remain scoped.
- Local accepted build31 implementation/records remain unpushed. Implementation, build32 and a local commit are explicitly authorized; push and fixture/session mutation are not requested for this increment.

## Resume Here

- A–C are Complete for the accepted build32 milestone: whole-picture black loading and unified saved-position reveal, visible Space/Menu, paused/playing continuity, clear audio/silent loading and smooth swipes. Public source still matches the verified signed artifact. No rebuild or repeat phone campaign is needed merely to record acceptance.
- The user requests a local commit of the accepted implementation; push is not requested for this increment. Preserve build31 comparison, phone sign-in/fixtures, predecessor evidence and the explicitly untested physical cases above.
