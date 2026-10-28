# Plan 181: Stable creator avatar spacing, silent Follow checks and stronger relationship borders

Status: Complete

## Feature Reference

- Contract: [Personal Space, Global Feed, and Context Integrity](../features/feature_02_personal-space-global-feed-context-integrity.md).
- Predecessors: [Plan175](plan_175.md) for contextual Follow and Global recognition; [Plan180](plan_180.md) for the accepted whole-picture loading cover.
- Roadmap: [Native viewing](../roadmaps/roadmap_native_viewing.md).

## Context

The user reports that, when swiping to a video inside a space, the creator avatar jumps farther from Like while a dark badge with three dots briefly appears beneath it. They agree to fixed spacing and silent initial Follow verification, with a plus only when following is available. They also request doubling the green and yellow border widths. The user reviewed this plan and explicitly authorized implementation, including its signed preview and validation. The user now explicitly requests commit and push of the accepted increment. Fixture/session mutation remains unrequested.

Planning starts from clean, synchronized `main` at `905695b60249236b7d370680b7d23b5c59ce25fe`. Plan179 implementation `adeed1e` and Plan180 implementation `243086e`, plus their delivery records, were pushed and the remote head verified. Signed build32/source `639412a0705a9833b6b5e8430009ea76fbffd0d24204686215e90579bb57608a` remains the accepted comparison. Its source and phone evidence do not qualify this proposed change.

In scope: the native group/channel feed avatar and Follow slot, initial checking presentation, pending-write/retry presentation within that slot, and shared green/yellow avatar border thickness, including Global yellow recognition. Preserve existing contextual relationship meanings and playback behavior.

Out of scope: adding Follow to Global or personal feeds, changing profile Follow/Unfollow flows, API/backend/schema/web changes, new caching/preloading/polling, optimistic relationship claims, video geometry/readiness/pool changes, and unrelated predecessor performance/sign-out/cleanup work.

## Investigation Findings

| Source | Finding and implementation consequence |
| --- | --- |
| [FeedFollow](../../mobile/src/follows/FeedFollow.tsx) | The avatar is always present, but a conditional44-point-high button is added when the summary is unknown or a Follow is available. Unknown status displays `…` in a dark24-point badge. Already-following/self results remove the button, changing the group's intrinsic height. This supports a layout-shift path, but exact physical motion still needs qualification. |
| [FeedScreen](../../mobile/src/feed/FeedScreen.tsx) | Follow applies to authenticated group/channel contexts. The right control lane is bottom anchored, scrollable, and already budgets an additional44 points whenever Follow is applicable, independent of the returned summary. Keep its height budget consistent with a permanently reserved Follow slot; inspect content offsets/scroll state when testing the reported jump. |
| [CreatorButton](../../mobile/src/ui/CreatorButton.tsx) | Outer avatar/tap bounds are44×44, image40×40, radius22. Base border is1 point; green/yellow currently change only the color. Set width2 in the colored variants, preserving gray1, outer/image bounds and hit area. The40-point image fits the40-point interior of a44-point box with2-point borders. |
| [GlobalCreatorRecognition](../../mobile/src/follows/GlobalCreatorRecognition.tsx) | Uses the same CreatorButton and yellow variant for read-only recognition. The thicker yellow ring should apply here too, without introducing a Follow slot/action. Personal/anonymous avatar layout remains as today. |
| [FollowStore](../../mobile/src/follows/followStore.ts) | Existing selected-proof authorization, bounded renewal, write guards, uncertain-write reconciliation and cancellation must remain authoritative. Silent checking changes presentation, not when a plus is safe to offer. |
| [Rendered Follow tests](../../mobile/tests/rendered/follow.test.cjs) | Cover gray/yellow/green, self, group/channel independence, Global recognition, expiry/background/denial, delayed reads/writes, stale callbacks and profile returns. Extend these scenarios with stable-slot/no-initial-badge and border-size assertions rather than building a parallel state machine. |

## Locked Decisions

1. In each group/channel feed with the existing Follow affordance, reserve a permanent44-point-high slot immediately below the44-point avatar. Keep the group's88-point outer height and the lane's existing8-point gap to Like consistent whether the slot contains a plus, write feedback, retry or nothing. No further gap increase is planned unless physical inspection demonstrates overlap or clipping.
2. During initial or otherwise unverified status checking, the slot is transparent and empty: no dots, dark badge, spinner, invisible press target or focusable placeholder. The avatar stays usable under existing eligibility rules; status checks do not block video playback.
3. Show `+` only with a current authorized summary permitting Follow and confirming the viewer does not already follow that creator in that exact space. Already-following and self/cannot-follow states keep the reserved slot empty. Unknown status never means not-following.
4. After an actual Follow tap, retain brief busy feedback in the same slot and disable repeat taps. On confirmed success, remove the button, retain the empty slot and show the green border. Keep the current read-only retry/reconciliation action for failure or uncertain writes in the same slot; do not resend an uncertain write automatically. No initial-check badge is used for these silent reads.
5. Preserve semantics: gray means no verified following indication, yellow means following elsewhere (or read-only recognition in Global), green means following in this space. A valid quiet renewal can retain its confirmed state until existing expiry; background/expiry/account/selection changes still mask state and disallow stale writes. The fixed slot persists while its contextual group is mounted.
6. Green `#4ade80` and yellow `#facc15` borders become2 React Native layout points, exactly double the current1. Gray `#777` remains1. Preserve44-point avatar bounds/tap target,40-point image, round shape and fallback icon size. No scaling animation or change to neighboring icon outlines.
7. Global receives the shared thicker yellow ring only; its avatar/Launch spacing and absence of Follow remain intact. Personal feeds retain their existing avatar behavior and no contextual Follow action.
8. Empty slots are absent from accessibility focus. Existing descriptive avatar hints remain truthful; Follow/write/retry labels and busy/disabled state remain available when those controls exist. Preserve profile navigation and larger-text/short-screen control-lane scrolling.
9. Keep saved publication/time/manual pause, clear audio/silent entry, whole-picture loading cover, fresh pools and smooth within-feed swipes. No extra request, timer, player, seek or media wait is introduced for this visual refinement.

## Phase Status

- A: Complete — fixed88-point group/44-point transparent slot, silent checking and2-point colored rings;19 focused rendered Follow cases and typecheck pass.
- B: Complete —234 unit/92 rendered/typecheck pass;19 focused Follow cases and8 expected pre-fix failures recorded.
- C: Complete for the recorded build33 milestone — signed artifact verified; user confirms stable spacing/no initial dots, correct plus, thicker green/yellow rings including Global without avatar resize, Follow/profile Unfollow and preserved swipes/position/pause/audio/silent loading. Untested cases remain scoped below.

## Phase A — Stabilize the Follow group and strengthen relationship rings

- Goal: Make status resolution change only slot contents and ring appearance.
- Steps:
  - [x] Give FeedFollow a constant avatar-plus-slot layout; keep the existing lane height budget in agreement. Check measured and constrained lane behavior, not only declared styles.
  - [x] Render no badge/button during initial checking. Retain verified plus eligibility, write feedback and retry/reconciliation within the fixed slot.
  - [x] Set green/yellow CreatorButton variants to borderWidth2, preserving gray1 and all outer/image/hit bounds; cover Global's shared yellow use.
  - [x] Audit accessibility hints and focus order for empty, checking, available, pending, followed, self and retry states. Preserve existing proof, expiry, lifecycle and stale-handler guards.
- Test gate: Native typecheck and focused actual-component Follow/recognition regressions from Phase B.
- Acceptance: Follow summary resolution does not add/remove group height; no initial dots/badge appears; plus is offered only for verified eligible actions; rings thicken without resizing the avatar or lane.

## Phase B — Verify state transitions and control-lane stability

- Goal: Protect the reported swipe experience and exact-space Follow behavior.
- Steps:
  - [x] Delay initial Follow reads and swipe between selected publications/creators. Assert the same group/slot bounds before and after unavailable, available, following-here, following-elsewhere and self results, with no initial-check badge or focus target. Verify avatar-to-Like spacing and lane height budget through the actual feed composition.
  - [x] Hold a Follow write: busy feedback stays in the slot, duplicate/stale taps cannot issue another write, success leaves the same empty slot and green ring. Verify profile Unfollow/revisit restores the plus without moving the avatar.
  - [x] Retain existing error/uncertain-write read-only retry, quiet renewal, expiry, background/foreground, denial, sign-out and late-result tests. Assert slot stability and absence of unauthorized actionable plus during these transitions.
  - [x] Assert green/yellow2 versus gray1 with unchanged44×44 avatar/40×40 image and fallback bounds; exercise Global yellow without Follow and personal/anonymous absence of Follow.
  - [x] Exercise a constrained-height control lane and different caption availability. Separate legitimate changes in the whole control set from movement caused by Follow resolution; preserve scroll access to controls and profile navigation.
  - [x] Check selected playback/time/pause, source loads and player allocations do not change merely because Follow state resolves. Run existing navigation/entry/paging regressions with the full mobile suites.
- Test gate: `npm --prefix mobile test`, `npm --prefix mobile run test:ui`, `npm --prefix mobile run typecheck`. Focused Follow cases must expose the current conditional-height/initial-badge defect before the fix. Host tests establish structure/state, not physical iPhone positions or smoothness.
- Acceptance: New regressions protect fixed spacing and silent verification; existing contextual Follow, Global recognition, playback and authority tests pass. No backend suite/deploy is necessary if backend inputs remain unchanged.

## Phase C — Qualify the signed phone presentation and record delivery

- Goal: Confirm the reported jump is gone on a matching signed preview.
- Steps:
  - [x] After implementation authorization and passing host gates, prepare the next available internal build using established source-stamp/archive/export/downloaded-artifact/signing checks. Preserve build32 comparison; freeze product source after submission; verify no private inputs and OTA disabled.
  - [x] Record user-confirmed group/channel swipe stability, no initial dots, correct plus availability, Follow turning green/removing plus without movement and profile Unfollow restoring it. Pending-write busy feedback and uncertain-write retry retain host coverage; no separate physical observation supplied.
  - [x] Record user-confirmed visibly thicker green/yellow rings including Global yellow without avatar resize. Exact shape/geometry measurements, constrained viewport/larger text, orientation and VoiceOver remain unverified physically.
  - [x] Record user-confirmed Follow/profile Unfollow, smooth swipes, saved position/pause, clear return audio and silent loading. Whole-picture cover retains accepted build32 comparison and current host coverage; no separate repeat visual observation supplied. Preserve signed-in phone state and fixtures; no host mutation performed.
  - [x] Update plan/index/roadmap/mobile documentation with actual host/artifact/phone results and remaining gaps. Commit/push only on a new explicit request for this increment.
- Test gate: Matching final source/archive/export/signed artifact and focused user-confirmed phone observations; agent docs retain zero new findings and all changed-document local links resolve.
- Acceptance: The reported Follow-related jump and initial dots badge are absent on the qualified phone; plus eligibility/behavior and visibly stronger rings meet the agreed design. No claim of exhaustive device/accessibility/performance qualification without separate evidence.

## Build33 phone acceptance

On2026-10-27 the user confirms: **“Yes, Avatar stays steady, no initial dots, + sign only when Follow is available, and green/yellow rings visibly thicker including Global's yellow ring. All good.”** This answers the explicit group/channel swipe and no-avatar-resize question. The second reply, **“Yes, all good”**, confirms Follow turning green/removing the plus without movement, profile Unfollow restoring it, smooth swipes, saved position/pause, clear return audio and silent loading.

Evidence: `tests/runs/device/plan_181/build33-acceptance.json`. A–C are Complete for this recorded internal milestone. No separate numerical performance/resource report, short-phone/larger-text/orientation/VoiceOver, physical busy/uncertain-write Retry or exact geometry measurements were supplied. The whole-picture visual cover retains build32 acceptance and current host coverage; this reply separately confirms silent loading. Source remains identical to the verified signed build33 artifact. No rebuild, product edit or repeated phone campaign is needed to record this acceptance. No commit/push had been requested when acceptance was recorded.

## Change Log

- 2026-10-27 — Accepted implementation committed and pushed to `origin/main` as `430f96bce5083e27f95082d20147aab2058cc55e`; remote implementation head verified. A–C remain Complete with recorded limits; this delivery record follows separately. All148 staged public inputs match accepted build33,75 local links resolve, documentation retains16 baseline findings/zero new and staged whitespace passes. Root README evaluated after commit: no developer operational workflow/API/build/start/environment/schema change; mobile README already documents this visual correction. No root README update needed.

- 2026-10-27 — User explicitly requests commit and push of accepted build33. Source still exactly matches the verified signed artifact; review and stage only this increment and its related tests/build/continuity records. No product rebuild or fixture/session operation needed.

- 2026-10-27 — User confirms both build33 check sets: stable avatar/Like spacing, no initial dots, correct plus availability, thicker green/yellow including Global without resizing, Follow/profile Unfollow and preserved swipes/position/pause/clear audio/silent loading. A–C Complete for this internal milestone with explicit limits. No commit/push requested.

- 2026-10-26 — Signed [build33](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/aeef06b5-54d1-4dbf-85cb-fdb934eeb0f6) source/archive/export/downloaded artifact/API/native module/accepted-phone signing checks pass. OTA disabled. A/B Complete, C In Progress pending focused phone spacing/ring/Follow/playback observations. No source changes after submission, fixture/session operation or commit/push.

- 2026-10-26 — B Complete:234 unit/92 rendered/typecheck pass, including19 focused Follow cases and8 expected failures before the fix. Build33 public source stamped;148 public inputs/149 archive files match, export/source/API checks pass with no private inputs. C In Progress for signed preview and focused physical qualification. Backend/API/schema/web and phone sign-in/fixtures remain unchanged; no commit/push requested.

- 2026-10-26 — A Complete: FeedFollow reserves a permanent slot, renders no checking button/badge, and keeps verified plus/write/retry behavior; CreatorButton green/yellow borders are2 points within existing bounds. All8 new focused regressions fail on build32 source (height, initial dots or border width), and all19 Follow cases pass after correction; typecheck passes. B In Progress for full mobile gates.

- 2026-10-26 — User explicitly authorizes implementation of Plan181. A In Progress; start with focused regressions for silent checking, fixed layout and ring widths. No commit/push requested.

- 2026-10-26 — Planning only after user agreement to fixed Follow spacing/silent checking and doubled green/yellow borders. Source review identifies conditional Follow-group height and the explicit initial ellipsis badge; shared CreatorButton controls contextual and Global recognition borders. A–C Pending; no implementation/build/commit/push authorized by this request.

## Validation

- Implementation host gates:234 unit/92 rendered tests and typecheck pass on revised product source;19 focused Follow cases pass. All8 new cases fail against old product source for the intended missing fixed height, visible initial dots or1-point colored border. Logs and summary: `tests/runs/build/plan_181/` (host-gates-build33.json and unit/ui/typecheck/follow evidence). Final review corrected a test-fixture options shadow so the constrained captioned case genuinely includes CC; the19 focused Follow cases pass again, including a delayed swipe between different creators and rejected late publication results. Submitted product source is unchanged. Actual components/stores/coordinator run with controlled native ports; geometry assertions establish stable declared group/slot/lane composition, not native measured pixels.
- Frozen build33 source `60c8232b321684cc704e6bd2018ae1c37605ffda7b7a06d7dc5cc56e0e63ed71`:148 public inputs/149 archive files, zero unexpected/private inputs, workspace/archive manifest equality and Hermes/source/API export checks pass (2282862-byte export). Evidence: `tests/runs/build/plan_181/source-manifest-build33.json` and `archive-export-build33.json`. EAS build33 `aeef06b5-54d1-4dbf-85cb-fdb934eeb0f6` finished2026-10-26T23:03:56.032Z; downloaded signed artifact verified2026-10-26T23:05:09Z. Product source is frozen after submission; subsequent focused phone acceptance is recorded above.

- Planning environment: `/home/ubuntu/aws`; clean synchronized `main` at `905695b` before planning. That plan-only request made no product source edits or tests/builds; implementation and artifact gates followed after explicit authorization as recorded above.
- Inspected FeedFollow, FeedScreen control lane, CreatorButton, GlobalCreatorRecognition, FollowStore and existing rendered Follow scenarios; reviewed repository planning/routing and contextual Follow contracts.
- Documentation baseline: `npm run check:agents:docs` output at `/dev/shm/plan181-docs-before.log`; known preexisting findings remain separate from new-plan validation. Post-edit output `/dev/shm/plan181-docs-after.log` retains the same16 preexisting findings and zero new findings. All57 local links across the four changed plan/continuity documents resolve; whitespace and `git diff --check` pass.
- The source-identity script confirms all public product inputs still exactly match the accepted build32 manifest during planning. Existing build32 tests/phone observations remain historical comparison evidence, not proof of this proposal.

- Implementation documentation check `/dev/shm/plan181-docs-implementation.log` retains16 existing findings/zero new;75 local links across six changed documentation files resolve, whitespace passes. Backend/API/schema/web inputs unchanged; no deployment or fixture/session mutation performed.

- Downloaded build33 IPA8354293 bytes, SHA256 `f42d0c7fe18e88121d277c320cce833afba5f9676a7f616345306ad6522e4530`, embedded Hermes2282953 bytes. Source/API/internal-preview/native module match; one accepted phone and signing namespace match build26, get-task-allow=false, profile valid, OTA=false. Evidence: `tests/runs/build/plan_181/artifact-build33.json` and `build33-meta.json`. [Install build33](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/aeef06b5-54d1-4dbf-85cb-fdb934eeb0f6) over the existing app. User subsequently confirms steady motion and thicker rings without avatar resizing as recorded above; exact measurements, expanded device/text ranges and screen-reader behavior remain unverified.
- Root README evaluation: no API/build/start/environment/schema/operational workflow changed; no root update needed for this visual refinement. Mobile README and rendered-test scope are updated. No backend suite/deploy was rerun for unchanged backend inputs.

- Acceptance-record checks2026-10-27: public source still exactly matches the signed build33 manifest; docs check `/dev/shm/plan181-docs-acceptance.log` retains16 baseline findings/zero new,62 local links across four acceptance documents resolve and whitespace passes. No product suite rerun, rebuild, fixture/session operation or commit/push was needed for documentation-only acceptance.

- Commit/push verification2026-10-27: accepted implementation `430f96bce5083e27f95082d20147aab2058cc55e` is on `origin/main`, confirmed by remote branch read. Product suites were not repeated for this commit-only request because the accepted source is unchanged. The75-link/docs/whitespace and148-input staged checks pass as recorded above; root README remains current.

## Open Risks / Deferred

- The user now confirms the reported jump and initial dots are gone on build33. Host structural assertions and qualitative phone acceptance do not measure every native frame or all possible control-lane scroll offsets.
- Stable empty space is intentional when Follow is unavailable; it must not become an invisible button or accessibility stop.
- The user confirms thicker colored borders without avatar resizing on the checked phone. Exact geometry, other screen densities, larger text/orientation and VoiceOver remain unqualified.
- No wider relationship cache/preload or new status freshness policy. Global broadcast Follow, personal access, broader discovery and predecessor phone/performance/sign-out/cleanup limits remain separate.

## Resume Here

- Successor reporting implementation and build39 refinement are tracked in [Plan182](plan_182.md) and [Plan183](plan_183.md). The user authorized committing and pushing the outstanding implementation on2026-10-28; preserve accepted build33 and the recorded successor qualification limits.

- A–C Complete for accepted build33/source `60c8232b321684cc704e6bd2018ae1c37605ffda7b7a06d7dc5cc56e0e63ed71`, with recorded physical limits. No further product edit/rebuild/repeat phone campaign is needed for this accepted scope. Implementation is committed/pushed as `430f96bce5083e27f95082d20147aab2058cc55e`; remote implementation SHA verified, with this delivery record following separately. No further product work is required for the accepted scope. Preserve build32 comparison, phone sign-in/fixtures and predecessor coverage/cleanup limits.
