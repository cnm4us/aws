# Plan 183: Explore reporting rules, then submit from a dedicated rule view

Status: Active

## Feature Reference

- Delivered reporting, authority and playback contract: [Plan182](plan_182.md).
- Explicit destination publication identities: [Context integrity](../features/feature_02_personal-space-global-feed-context-integrity.md).
- Existing reporting groups and mappings: [Plan166](plan_166.md).
- Sequence: [Native viewing roadmap](../roadmaps/roadmap_native_viewing.md).

## Context

The user finds Report video busy and requests a detailed implementation plan after agreeing on a simpler flow: time controls, “Explore reasons to report”, title/short-description/More cards, then a dedicated rule view with an upper-right Back control, a description/example selection menu and one bottom Submit report button. Confirmed submission returns directly to the video. Back preserves the time edits and list position within the existing draft/access lifetime.

The user subsequently authorized implementation, verification and delivery of the proposed iPhone preview. Preserve prior implementation/evidence/sign-in and avoid unrelated API/database/configuration changes. Commit/push require an explicit request.

Baseline: Plan182 reporting accepted on build35; compact time controls, keyboard/scroll/Close and playback accepted on build36. Build37 delivers the requested centered “Current video time” wording, with matching source/export/archive/downloaded artifact; no separate build37 phone observations are claimed. Comparison source is `84f4b17e4f490977d92a6c7500efecc806f0afd24f1619d5f25f09f6db2d8591`, signed build `09bb9ecd-1cdb-42e8-aad5-28e540a52270`. Plan182 and its refinements remain uncommitted in the shared working tree; preserve those edits and their evidence. Main is not a clean starting checkout.

In scope: native report list/detail presentation, explicit mapped-rule selection, one compact section menu, fixed rule footer, local Back/scroll/focus state and the associated store guards/tests/documentation/preview qualification. Preserve independent Global/space Sent, report normalization, existing review integration, account/access guards and silent retained-feed behavior.

Out of scope: changing browser reporting, moderation policy/catalog/mappings, default-rule resolution on the server, schemas, new reporting categories, free-text notes, report editing/withdrawal, public report counts, new navigation/player architecture, discovery, store release and broad host-capacity/service-management work.

## Investigation and Analysis

| Existing source | Finding and planning consequence |
| --- | --- |
| [ReportScreen](../../mobile/src/reporting/ReportScreen.tsx) | Current list renders time controls, expandable reporting groups, group-default Submit, rule titles/descriptions, explanation buttons and per-rule Submit. Detail replaces the body but retains Report video heading/Close, three prominent Long/Allowed/Disallowed buttons and a scrolling Submit. Simplification should remove the native group accordion and list-level submissions, give detail its own header and move its sole Submit outside the explanation scroll area. |
| [Reporting API adapter](../../mobile/src/reporting/api.ts), [shared options service](../../src/features/reports/service.ts) | Options contain ordered user-facing groups with mapped canonical rules, not a flat rule catalog. A group has its own label/description and can map several rules; each rule has its own title/shortDescription and isDefault flag. Existing initialGroupIds select destination-curated groups; all active groups are already included. Show all can remain a local reveal without another catalog request. |
| [Native reporting authority](../../src/features/reports/viewer.ts) | Detail and submit are bound to exact publication/context plus groupId/ruleId. Submission requires userFacingRuleId even when ruleId is explicit. Flattening the UI must preserve the original mapping; a rule ID alone cannot replace the group/rule pair. The current API already supports the proposed explicit-rule submission. |
| [ReportStore](../../mobile/src/reporting/reportStore.ts) | Owns options/detail freshness, sending, cancellation and uncertain-response reconciliation. Current detail/loading are payload flags, not a full view state: initial detail loading/errors/expiry can fall back to the list. New rule view needs a selected pair independent of the detail response so loading/failure cannot accidentally switch screens or enable an unrelated Submit. |
| [ReportMemory](../../mobile/src/reporting/reportMemory.ts) | Times/showAll/group expansion share an in-memory draft with the original60s deadline and20-entry bound at the investigated baseline; the user-requested revision below extends draft retention to15 minutes. Replacing group expansion must not reset or extend draft age. View/scroll/menu state can stay local to one report visit; it does not need persistence across accounts, background or feed replacement. |
| [ViewerNavigator](../../mobile/src/navigation/ViewerNavigator.tsx) | One transparent Report route owns one ReportStore and retains the paused feed; its guarded onClose removes that route. A dedicated rule screen can be a full local view inside this route. A second transparent navigation modal would complicate focus/lifetime and multiply the scrim; it is unnecessary. |
| [Comment order selector](../../mobile/src/engagement/CommentOrderSelector.tsx), [shared actions](../../mobile/src/ui/Message.tsx) | Native Pressable, chevron, selected radio choices and44-point controls already exist. Reuse their visual/accessibility conventions for a compact section menu without adding a picker dependency or WebView. The rule menu can expand in the existing view instead of introducing another darkened modal. |
| [Reporting unit tests](../../mobile/tests/reporting.test.ts), [rendered reporting tests](../../mobile/tests/rendered/reporting.test.cjs) | Existing gates cover independent Sent, exact routes, editable times, rule documents/links, pending/late writes, cancellation, anonymous prompts, background and independent detail expiry. Update actual flow assertions and add only the state/mapping/focus regressions needed by this structural change. |

These are source findings, not a new live catalog audit, API test, device measurement or proof of new behavior. No report or configuration was changed during planning.

## Locked Decisions

1. The main screen keeps Report video and its upper-right Close. Preserve “Current video time”, independent Start/End fields with stopwatch buttons, manual editing, blank/one-sided/zero bounds and Clear times — whole video. Immediately after Clear, show the exact heading **Explore reasons to report**, larger than individual reason titles (22 versus18 points, both scaling with system text).
2. Cards represent individual canonical rules from the current allowed group/rule mappings. Each shows the rule title, its own short description when supplied and a visually quiet, lower-left **More** control. Omit a missing short description rather than fetching long text for previews or substituting an unrelated group's description. Do not add numbered rules unless the authored title contains a number. No Submit, group expansion buttons, tabs or full descriptions on this list.
3. Keep the source groupId/ruleId pair on every card and selected view. Preserve server group/rule ordering and initialGroupIds filtering. Do not auto-pick a default rule for a card. If the same canonical rule is mapped into multiple eligible groups, retain the separate mapping cards and add a small reason-group label only where needed to distinguish them; More/accessibility labels include that context. Never silently deduplicate by ruleId and choose an arbitrary reporting group. Phase A verifies this behavior with a multi-mapping fixture.
4. **Show all reasons** appears below the initial cards only when additional rule cards exist. It reveals all remaining allowed mapped rules inline, retains entered times/list state and does not fetch detail or submit. Existing destination-curation/all-active fallback remains authoritative. Groups with no mapped reporter-visible rules do not create selectable rule cards; explain an empty list and retain Close/Retry where appropriate.
5. More dismisses the keyboard, captures the list offset/focus target and opens a full rule view inside the same Report route/store. The main time controls/cards are absent from the rule view and accessibility tree. Show the selected rule title at the top, an upper-right **Back** control, the section menu below the title, scrollable explanatory content and a fixed safe-area footer. The underlying feed stays paused/silent with one80% scrim and no extra player or feed allocation.
6. Back returns to the report list, preserving valid time edits, Show all state and the previous scroll position. Restore focus to the originating More control if still present; clamp the scroll/focus destination when refreshed cards disappear. Do not dismiss the Report route or resume playback. Main Close exits reporting and preserves the original authorized playback intent. Keep Back available during loading/errors and pending submission so the user can return to the list and reach Close.
7. Use one collapsed section selector with full labels **Long Description**, **Allowed Examples**, **Disallowed Examples**; default to Long Description when opening a different rule. Activating it expands three selected/radio choices plus dismissal within the same reporting surface. Selection closes the menu, updates the content and scrolls the explanation to its start; cancellation retains the prior choice. Quiet renewal of the same rule does not reset the selection or unnecessarily jump scroll. New rule versions remain current and bounded; any content change that requires a scroll reset must be deliberate and tested.
8. The detail footer has one **Submit report** button and a small wrapping read-only segment summary: Whole video, or the specified Start/End values. This helps the viewer verify the range while its fields are on the previous screen. Back is the route to edit times. The footer remains visible above the home indicator while content scrolls, including empty example sections; it is not a floating overlay covering the last paragraph.
9. Submission always specifies the selected group's userFacingRuleId and the selected canonical ruleId. This deliberately replaces Plan182's native group-default/list-level Submit controls. The existing backend/browser group-default capability remains unchanged. Submit exists only on an unreported rule view, and is disabled until options, mapping, detail and time-review state are fresh and valid; no action is available on mere loading or an optional explanation error. Enforce selected-pair guards in the store as well as the UI.
10. A deliberate Submit starts exactly one request, disables further submits/edits/menu changes and shows Sending report. Back may reveal the list, but all list actions that would change the pending request remain disabled; main Close stays usable. Keep the submitted pair/range immutable for feedback until completion. Only confirmed201, or an owned read confirming an already-existing report after duplicate/uncertain delivery, closes the entire reporting experience and marks that publication Sent. One route removal returns directly to the video; do not unwind unrelated navigation entries.
11. A definite failure keeps the selected rule/range with a visible error near the footer. Invalid times explain that Back opens the fields for correction; do not hide the only error on the list. Uncertain delivery disables submission and offers existing status reconciliation, without automatic resend or false success. Closing/background/account replacement still aborts local work, preserves the appropriate uncertainty marker and ignores late callbacks. Optional reporting failure must not deny playable media.
12. Preserve the existing45s quiet renewal/60s hard expiry for options and independently for detail, exact destination/account/feed-visit ownership, and a15-minute draft lifetime from the first edit. Ordinary More/Back/menu changes never extend those deadlines. Background/identity/access loss clears private local view/menu/scroll state as appropriate. Hard expiry or draft expiry must not silently convert an entered range into a Whole video submission from an open rule view: hide/disable stale action, explain the expiry and require returning to freshly verified time controls before another submission. In-flight input remains a snapshot; expiry/cancellation follows existing uncertain-write rules.
13. Sent reopens recorded reason/times read-only. Read reported rule may use the same full rule view/menu with an upper-right Back to the Sent summary, but has no Submit. Old/unmapped reasons remain visible through their stored summary even if current explanatory content is unavailable. Global, Group and Channel publications of the same video retain separate Sent, drafts, reason context and report attribution.
14. Keep native text/links only, current reporter-visible content and explicit empty-section messages. Preserve authored document limits and safe-link validation; no WebView, remote images, moderator guidance or rule history. An external link can background the app and therefore invokes the existing draft-clear policy; do not promise draft preservation across that boundary.
15. All interactive targets are at least44 points. More looks like a small link but has a generous hit area and an accessible name identifying its rule/context. Header/footer labels wrap at larger text sizes, Back does not overlap the title, and the menu announces current/expanded/selected state. Hidden list/detail/menu content cannot retain accessibility focus. Source/rendered assertions do not replace phone geometry or VoiceOver observation.

## Proposed Screen Composition

| Main report screen | Dedicated rule view |
| --- | --- |
| Report video; Close at upper right | Rule title; Back at upper right |
| Current video time; Start/End stopwatch rows | Compact selector showing Long Description initially |
| Clear times — whole video | Selected explanation/examples, independently scrollable |
| Explore reasons to report | Visible loading/retry/empty/error state for this selected rule |
| Rule title / short description / lower-left More, repeated | Fixed footer with segment summary and Submit report |
| Show all reasons when additional mapped cards exist | No Submit for Sent/read-only review |

The detail header/footer are siblings of a flexible scroll body, all within the existing safe-area root. No fixed pixel card heights, nested explanation scroll regions or new full-screen scrim. On very short/large-text screens, keep header/footer bounded and body scrollable; verify real reachability before accepting the preview.

## State and Data Approach

- Add a small pure card projection (for example `reportPresentation.ts`) that maps verified options into ordered `{groupId, ruleId, title, shortDescription, groupLabel, duplicateContext}` cards. Use stable pair keys. Compute Show all from hidden selectable cards, not merely hidden group count. Do not cache or fetch rule bodies for every card.
- Expose selected rule identity independently from `ReportDetail` in ReportStore. Model list, rule loading, rule ready, rule unavailable, sending and uncertain result explicitly; Sent and authorization/background masks remain authoritative outer states. A late response cannot replace another selected pair or reopen detail after Back/Close.
- Keep one active store per existing target/visit. Prefer local full-view components such as ReportReasonList, ReportRuleView and RuleSectionMenu; share the existing safe RuleDocument renderer. Navigator should keep its current single Report route and close guard unless a focused test establishes a small required adjustment.
- Keep list offset, More focus reference and section/menu choice scoped to the current active report view. Existing in-memory draft retains Start/End and Show all with its original bounds; obsolete group-expansion state can be removed from native draft/tests because it is not persisted. Do not introduce a second persistent draft store or unbounded rule/detail cache.
- Add a selected-rule submission entry point that reads the current selected pair, proof deadlines, mapping, draft/review state and caller-owned Sent. Delegate to existing validated time parsing/POST/reconciliation. No handler may submit an old card captured before refreshed options removed its mapping.
- Keep the selected rule view during a slow/failed detail read with Back and Retry available and Submit disabled. If the rule becomes unmapped/hidden, discard its body/authorization, show unavailable and allow Back; never auto-switch to a default/neighboring rule.
- Dismiss the menu on Back, Report Close, background, access loss, rule replacement and send. Same-rule quiet renewal preserves view selection while actual detail authorization still expires independently. Preserve the original playhead/manual-pause capture throughout local list/detail transitions.
- No DTO, route, schema, backend moderation or browser change is expected. If Phase A establishes a missing contract, document the smallest additive prerequisite and update the plan before introducing it; do not silently change reporting semantics.

## Phase Status

- A: Complete — pair projection and selected-rule guards;16 focused unit/typecheck pass
- B: Complete — simplified list/rule/menu/footer implemented;9 focused rendered/typecheck pass
- C: Complete —250 unit/102 rendered, latest16 reporting unit/10 UI/typecheck pass
- D: In Progress — build38 UI feedback received; revise draft lifetime/heading and deliver updated signed preview; submission/playback phone observations pending
- E: Pending — evidence, exact cleanup and delivery records

## Phase A — Preserve mapping and lifecycle semantics

- Goal: Define a deterministic native presentation without losing report attribution or time/access safety.
- Steps:
  - [x] Inspect representative existing catalog shapes with safe read-only/injected fixtures: several rules in one group, a rule in several groups, destination curation/fallback, empty groups, missing short descriptions and refreshed mappings. Record findings; no live configuration mutation.
  - [x] Implement the ordered pair-keyed card projection, initial/all visibility and duplicate-context labeling. Keep Global destination identity/independent space publication behavior unchanged.
  - [x] Separate selected rule/view state from the loaded detail payload; define cancellable transitions, list offset/focus ownership, same-rule renewal and invalidated-selection behavior.
  - [x] Add selected-rule submit guards and explicit draft-expiry review handling; preserve existing fresh options/detail proof deadlines and immutable pending input.
  - [x] Update draft typing only for removal of obsolete group-expansion state; retain existing bounds and no persistence.
- Test gate: Focused meaningful unit cases for projection, stale/late targets, expiry, exact pair submission and immutable request ownership; mobile typecheck. Do not write tests that merely mirror card JSX/style objects.
- Acceptance: Every displayed card resolves to its real mapped group/rule, no hidden or stale rule is actionable, no arbitrary mapping substitution occurs, and Back/view changes cannot prolong draft lifetime or silently change the report range.

## Phase B — Build the simpler native flow

- Goal: Make browsing lightweight and the final reporting decision focused.
- Steps:
  - [x] Replace the group accordion/list Submit controls with Explore reasons to report and title/short-description/More cards; keep accepted Current video time/stopwatch/Clear controls and main Close.
  - [x] Implement the full rule view with its title/upper-right Back, fresh detail loading/error/retry states and shared safe document rendering. Dismiss keyboard on entry and restore list scroll/focus on Back.
  - [x] Add the compact full-label section menu, selected-state announcements, cancellation and rule/version-aware scroll behavior; no additional native package, WebView or navigation route.
  - [x] Add the fixed safe footer/segment summary/sole Submit, visible validation/uncertain feedback and request-wide pending guards. Ensure the last document paragraph is reachable.
  - [x] Reuse detail/menu for read-only Sent review without Submit; preserve recorded reason/times even when current detail is unavailable.
- Test gate: Focused rendered Report route flow tests, then existing rendered suite and typecheck. Verify local list/detail transitions retain one paused feed/one Report route and do not issue writes or unselected detail preloads.
- Acceptance: List contains no reporting Submit; More always opens its own rule; Back returns to the correct list position/edits; menu selects the requested content; one deliberate footer Submit can return directly to the original video after confirmation.

## Phase C — Verify integrated behavior and unchanged contracts

- Goal: Prove the simplified UI preserves authority, truthfulness and viewing continuity.
- Steps:
  - [x] Update existing reporting unit/rendered fixtures for explicit rule submission and add only missing structural/lifecycle cases. Cover the acceptance matrix below, including duplicate-mapping context and error/expiry paths that remain on the selected view.
  - [x] Run full native unit/rendered/typecheck after relevant changes. Retain backend/API/browser evidence only for unchanged inputs; if API code changes, run the affected backend/reporting builds/tests and isolated real API/browser checks as required by that change.
  - [x] Verify one actual native explicit-rule request still contains the original userFacingRuleId/ruleId/times using the controlled harness. If a live report/review check is warranted, use newly owned fixture publications; never ask for a report against ordinary content just to test layout.
  - [x] Verify no options/detail polling on ordinary swipes, no added player/route, no duplicate POST after a delayed result, and correct account/publication isolation.
  - [x] Update native README/rendered-test scope to describe implemented behavior; keep API docs unchanged when the contract is unchanged.
- Test gate: `npm --prefix mobile test`, `npm --prefix mobile run test:ui`, `npm --prefix mobile run typecheck`; conditional backend gates only if their inputs change. Save actual counts/results under `tests/runs/build/plan_183/` and any isolated live integration evidence under harness-labeled directories.
- Acceptance: All affected gates pass with actual run evidence; no blanket numerical/device/accessibility claim from host tests or reused predecessor results.

## Phase D — Signed preview and focused phone checks

- Goal: Verify the new full rule view, menu, fixed footer and playback behavior on the real iPhone.
- Steps:
  - [x] Confirm public API availability and adequate export/build space before release work. The2026-10-28 outage had a full root disk and absent API child; it was restored in Plan182. Use tmpfs for regenerable build/cache/log output and preserve source, dependencies, evidence and sessions. Broad disk/service architecture changes remain separate.
  - [x] Confirmed38 was next available and selected it. Freeze/stamp public inputs, verify iOS export/archive allowlist, then inspect the downloaded signed app's source/API/native module/bundle identity/accepted-phone provisioning/OTA off. Preserve build37 comparison evidence.
  - [ ] Ask for focused list/More/Back/scroll/times checks in Global and another eligible feed; confirm menu labels/content/cancel, long/missing examples, read-only Sent, footer reachability and keyboard dismissal/return.
  - [ ] Confirm Close/cancel/confirmed success returns to the original position/pause or playing state with clear audio, silent covers and smooth swipes. Use owned disposable publication(s) only if an actual submission is needed; existing ordinary video browsing needs no report submission.
  - [ ] Check short-stage/larger-text/VoiceOver behavior where available and record exactly what was observed and what remains untested. Do not inherit new layout acceptance from build36.
- Test gate: Matching source/archive/export/downloaded artifact plus explicit focused phone observations. No completion merely because signing succeeded.
- Acceptance: The user can explore a rule, switch explanation sections, return without losing valid edits/list position, deliberately submit the exact reason and return to accepted playback; footer/menu/header remain usable on the tested phone/settings.

## Phase E — Finish evidence and exact cleanup

- Goal: Leave accurate continuity and no new disposable report state behind.
- Steps:
  - [ ] Record host/artifact/phone observations separately, including failures, corrections and limits; update plan/index/roadmap and evaluate developer README changes only for implemented behavior.
  - [ ] If new fixtures/reports/sessions were created, snapshot safe attribution/range evidence and clean up exactly owned rows and downstream records. Preserve shared media, predecessor fixtures and the user's existing phone sessions; no cleanup is required if none were created. Do not reuse deleted Plan182 fixture IDs.
  - [ ] Run docs checker with zero new findings versus baseline, local link checks, whitespace and final public-source identity check. Complete only satisfied phases with explicit deferred limits.
  - [ ] Commit/push only on explicit user request; preserve the existing uncommitted Plan182 implementation throughout.
- Test gate: Accurate evidence/cleanup accounting and docs/source gates; no unnecessary rerun of unchanged product suites for documentation-only updates.
- Acceptance: Reviewable delivery, current continuity, owned test-data residuals accounted for and prior sessions/content intact.

## Acceptance Matrix

| Area | Required evidence |
| --- | --- |
| List simplicity | Exact Explore reasons to report heading; rule title/optional short text/More; no group accordion or Submit on list; initial ordering and Show all preserved. |
| Mapping correctness | Multiple rules/group and multiple groups/rule; duplicate context visible only when needed; exact selected pair sent; no default/neighbor substitution; Global/space independence. |
| Detail navigation | Correct title, upper-right Back, loading/error states stay on selected view, Back preserves valid edits/Show all/scroll/focus; rapid More/Back/late reads cannot reopen the wrong rule. |
| Section menu | Full three labels, default Long Description, correct content, selected-state/cancel behavior, empty sections, long text/links and same-rule quiet renewal. |
| Footer and times | Footer stays above safe area without covering content; correct range summary; manual/stopwatch/Clear/zero/one-sided/range validation preserved; hidden invalid fields have an actionable visible error. |
| Deliberate submission | Exactly one POST from a verified selected rule; all duplicate-changing controls disabled while pending; Back/Close reachable; confirmed success closes reporting directly to the same video. |
| Failure/uncertainty | Definite failure retains view/edits; uncertain/409 read reconciliation without resend/false Sent; Close/account change/background ignores late success. |
| Freshness/privacy | Independent options/detail45/60s gates, original draft TTL, expired edits never silently become Whole video; removed/hidden mappings revoke Submit; account/visit/background guards hold. |
| Existing Sent | Own stored reason/times read-only; current rule review optional; no Submit, editing or cross-publication/account bleed. |
| Playback/accessibility | One Report route/scrim/retained paused feed, no hidden audio/new allocation, original position/pause restored;44-point controls, focus order, keyboard/large-text/short-screen and VoiceOver observed separately. |

## Expected File Impact

- Primary native UI: `mobile/src/reporting/ReportScreen.tsx`, optional `ReportReasonList.tsx`, `ReportRuleView.tsx`, `RuleSectionMenu.tsx` and shared `RuleDocument.tsx` extraction.
- Presentation/state: new `mobile/src/reporting/reportPresentation.ts` if useful, `reportStore.ts`, `reportMemory.ts`; minimal API typing change only if justified, no expected transport/server contract change.
- Existing navigation: preserve `ViewerNavigator.tsx`'s single Report route; adjust only a proven close/focus integration need.
- Tests: `mobile/tests/reporting.test.ts`, `mobile/tests/rendered/reporting.test.cjs` and controlled native harness only for required selector/focus ports. Update existing assumptions about group Submit/accordion/detail labels; no broad test rewrite.
- Docs: native README/rendered README, this plan/index/roadmap and a Plan182 continuity note. Root README/API docs only if implemented developer behavior/contracts actually need correction.
- Build identity/configuration: next available iOS build number and public source stamp when a preview is actually authorized and host gates pass.

## Change Log

- 2026-10-28 — [Build38](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/0685a57e-64f4-4cdf-bbf0-e2c7d40b5a41) downloaded and verified: source/API/new report explore/menu/footer, native module, all stopwatch rasters, accepted-phone device set/signing namespace and current Release provisioning; OTA off. Source `0c6f99c0fdf0ce14793aa33d904a752d1bbd8106b44d68f29691bd9d87f83542`,167 inputs/168 archive files; IPA SHA256 `9bf50ecb459f04fc3bab00f6c6fc8295eaa849c51be4e01e774357675d509255`. D awaits actual phone checks; E fixture/report cleanup and completion follow those observations. No commit/push.

- 2026-10-28 — Build38 submitted as `0685a57e-64f4-4cdf-bbf0-e2c7d40b5a41`, source `0c6f99c0fdf0ce14793aa33d904a752d1bbd8106b44d68f29691bd9d87f83542`;167 public inputs/168 archive files, export/archive/source/API verified. New owned production216/publications730–733 share upload1406;10 predecessor publication identities and106 native/373 browser session rows preserved, no reports or sessions created. Phone fixtures retained until actual qualification/cleanup. Signing/downloaded artifact/phone checks pending. No commit/push.

- 2026-10-28 — A–C host qualification complete. Implemented pair-keyed cards, persistent selected rule loading/error states, Back/scroll/focus restoration, inline section menu, bounded title/footer information areas, one explicit-rule Submit, visible range-expiry/review and read-only Sent. Navigator/API/server unchanged. Plan-scoped fixture helper can prepare new Plan183 metadata without reusing deleted Plan182 IDs; existing media/accounts/sessions remain. D prepares build38. No commit/push.

- 2026-10-28 — User authorized implementation. A In Progress; preserve existing dirty Plan182 working tree and accepted build37 comparison. No backend/schema/catalog change anticipated.

- 2026-10-28 — Planning only after the user agrees on explore cards, dedicated rule view, section selection menu and bottom Submit. Inspected native list/detail/store/memory/adapter/navigation/tests and shared options/mapping authority. All A–E Pending; no product/API/database/build/session/commit/push work.

## Validation

- Final delivery docs/source gate: `/dev/shm/plan183-docs-delivery38.log` retains the exact16 preexisting findings with zero new;80 local planning links resolve, trailing whitespace and `git diff --check` pass. Final public inputs still exactly match build38 manifest. Three focused phone questions sent; D/E remain open until observations and exact owned-fixture cleanup.

- Delivered artifact: `tests/runs/build/plan_183/{source-manifest-build38,archive-export-build38,artifact-build38,build38-meta,host-summary-build38}.json`; checklist `tests/runs/device/plan_183/build38-pending.json`. Finished2026-10-28T06:19:12.063Z; IPA8392040 bytes, SHA256 `9bf50ecb459f04fc3bab00f6c6fc8295eaa849c51be4e01e774357675d509255`; matching new UI strings/API/native module and24/48/72px stopwatch assets, same bundle ID/device set/signing namespace, Release get-task-allow false, provisioning current, OTA off. Source remains frozen. New physical layout/audio/VoiceOver/text-range observations are pending.

- Release preflight: public API `/health`200; root183MiB free, tmpfs2.9GiB free at check, export/archive/cache output uses tmpfs. Exact Plan183 fixture setup verified (`tests/runs/device/plan_183/fixtures.json`), using new IDs and existing shared media; no production processing job, catalog/role change or auth session mutation. Build38 source/export/archive/API match167 public inputs/168 files. Docs host gate `/dev/shm/plan183-docs-host.log` retains the same16 preexisting findings, zero new; whitespace passes.

- Phase C: full native unit250/250, rendered102/102 and typecheck pass. Final range validation now disables Submit and exposes Back-to-edit errors on entering detail; latest focused16 unit/10 actual UI/typecheck all pass after that guard and the empty-initial-list copy refinement. Logs saved in `tests/runs/build/plan_183/`. Unchanged backend/API/browser qualification is retained from Plan182; no server/schema/catalog policy changes or new live report needed for host qualification.

- Phase B:9 focused actual Report route/UI cases and mobile typecheck pass (`/dev/shm/plan183-b-rendered.log`, `/dev/shm/plan183-b-typecheck.log`). New native handle/scroll ports verify Back restores edits/Show all/offset and originating More focus with one route/retained player. Loading/optional failure/late reads/invalid times/expiry/footer ownership covered. Final review adds bounded title/footer-info scroll areas and unavailable-mapping Retry removal; full regression rerun in C. Obsolete group expansion draft field removed with the UI. No backend/schema/navigation-route changes.

- Phase A: reporting unit16/16 and mobile typecheck pass (`/dev/shm/plan183-a-unit.log`, `/dev/shm/plan183-a-typecheck.log`). Injected fixtures cover multiple rules/group, one rule/multiple groups, empty/missing descriptions, exact mapping guards, selected loading/error/late Back, independent detail revocation and range-expiry/pending snapshot. Initial pending-range test advanced fake time across an options hard deadline; corrected pacing to renew options before its independent deadline. Typecheck caught fixture null-only inference, fixed by adapting typed options. Obsolete groupId remains temporarily only to keep the previous screen buildable until B removes its accordion. No backend/live catalog mutations.

- Environment: `/home/ubuntu/aws`, main with existing uncommitted Plan182 implementation and delivery/docs changes; no clean-tree claim. No applicable AGENTS.md found in repository search.
- Read-only source investigation establishes group/rule projection, current single Report route, safe document API and freshness/draft constraints. It does not establish live duplicate frequency or new UI correctness.
- Planning-only baseline before implementation: `/dev/shm/plan183-docs-before.log` and `/dev/shm/plan183-docs-after.log` contain the exact same16 preexisting findings, zero new. All80 local links across this plan, Plan182, implementation index and native roadmap resolve; trailing whitespace and `git diff --check` pass. At that planning checkpoint, public product inputs matched `tests/runs/build/plan_182/source-manifest-build37.json`; later authorized implementation changes are qualified separately above. No product tests were run for planning-only edits.
- No product tests, live database queries/reports, API deployments/restarts, EAS requests or device checks for this planning task. Build37 inputs must still match their frozen manifest after documentation edits.

## Open Risks / Deferred

- Flattening must preserve mappings; deduplicating solely by ruleId can silently change the reporter-facing reason snapshot. This plan deliberately retains pair cards with limited duplicate context.
- A long explanation can outlive the existing draft window. The user requested a longer window after build38 expired times during reading. The revision gives drafts15 minutes from first edit while retaining independent60s access/detail proofs and explicit expiration/review.
- A visually fixed footer can crowd short/larger-text screens; render tests cannot establish native touch/keyboard/focus geometry. Physical qualification remains required.
- Current active catalog limits can yield a long flattened list. Preserve stable ordering and avoid detail preloads; evaluate measured rendering before introducing virtualization or pagination beyond this scope.
- Server-side report normalization remains authoritative when upload and edited playback duration differ. Show stored normalized times in Sent; do not change duration policy in this presentation plan.
- The user expanded the root EBS volume to100 GiB and the host extended ext4 online. The corrupted monitoring WAL/head reset is verified for fresh startup/scrapes; long-term retention remains unobserved. Continue keeping generated artifacts out of Git and maintaining capacity headroom.
- Existing broader discovery, entry requirements, moderator tools, appeals/blocking and predecessor numerical/offline/accessibility limits remain separate.

## Resume Here

A–C host qualification complete; build38 partial UI feedback prompted the revision below. [Install build39](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/5894f115-eade-4b7e-9f9f-a70a2be58208) over the existing app.17 latest reporting unit/10 actual UI/typecheck, matching export/archive/downloaded signed app/API/native module/accepted-phone provisioning; OTA off. D awaits focused heading/long-reading and remaining submission/Sent/playback phone observations. E cleanup follows actual qualification. Preserve Plan183 production216/publications730–733, shared upload1406/production198, predecessor fixtures and sign-in. No backend/player changes or commit/push.

## Build38 feedback revision — longer reading and heading hierarchy

The user likes the improved UI but encountered time-edit expiry while reading a long explanation. The user also requests “Explore reasons to report” larger than individual reason titles. Build38 is not fully accepted: submission/Sent and playback questions remain unanswered.

- Extend drafts to15 minutes from the first edit, not from an earlier authorization read. More/Back, quiet renewal, later edits and Close/reopen do not slide that original deadline. A new edit after expiry starts a new bounded window.
- Keep options/detail freshness at45s renewal/60s hard expiry, Sent freshness at60s,20-draft bound and background/account/access-loss clearing. Expiry still requires explicit time review and cannot silently submit Whole video. Pending input stays immutable.
- Use22-point Explore heading and18-point rule-card titles; retain automatic text scaling/wrapping.
- Qualify retention beyond one minute, original15-minute boundary, Close/reopen, independent access/detail expiry, pending range, background clearing, and actual rendered Back/fields/Submit behavior. Prepare and verify build39; do not create reports or clean retained fixtures before remaining phone checks.

Revision host checks and signed artifact results will be recorded below. No backend/schema/player change, commit or push.

Revision host gate:17 reporting unit/10 actual rendered UI and mobile typecheck pass; prior build38 full250 unit/102 rendered regression retained without rerun. Fake-clock reading spans15 minutes with current independent access/detail renewal; Close/reopen cannot slide expiry, first edit gets full window despite older proof, stalled access/detail still expire independently and pending input remains immutable. Initial fake-clock jumps crossed unrelated access deadlines before async renewal could settle; pacing corrected to15s steps. Export/archive/source match167 public inputs/168 archive files for build39, source `463a806dadd9915430650a61b7a00c03afcd421dd06f3ecdc75d068877d365b6`. EAS submitted `5894f115-eade-4b7e-9f9f-a70a2be58208`; signed artifact/phone qualification pending. Docs retains exact16 preexisting findings, zero new; planning links resolve and whitespace passes.

Build39 delivered: `5894f115-eade-4b7e-9f9f-a70a2be58208`, source `463a806dadd9915430650a61b7a00c03afcd421dd06f3ecdc75d068877d365b6`; IPA8391995 bytes, SHA256 `cdc0339b2ca95afcf8f194e0619fba1dcba136cc59566b617023360374e417a8`. Downloaded bundle/source/new reporting strings/API/native module, stopwatch24/48/72px assets, same bundle ID/device set/signing namespace, Release get-task-allow false, current provisioning and OTA off verified. Evidence: `tests/runs/build/plan_183/{artifact-build39,build39-meta,host-summary-build39}.json` and `tests/runs/device/plan_183/build39-pending.json`. D/E remain open; no fixture/report/session mutation, commit or push.

## Authorized repository delivery —2026-10-28

The user requests committing and pushing all outstanding implementation work. Deliver the existing Plan182 reporting backend/client and Plan183 explore/detail UI, compact controls,15-minute draft lifetime and larger heading as the exact verified build39 product snapshot. Earlier checkpoint statements saying no commit/push describe those earlier turns; this explicit request authorizes repository delivery now. Plan183 remains Active with D/E open: no additional heading/reading/submission/Sent/playback acceptance or fixture cleanup is inferred from this request. Keep current phone sign-in, Plan183 test reports/publications and predecessor media in place.

Operational recovery is recorded in the Plan182 follow-up above: root filesystem expanded online to100 GiB and corrupted Prometheus WAL/head measurements discarded with user authorization; fresh monitoring/API/feed checks pass. No additional product source changes or rebuild are required. Source/archive/build39 identity still matches167 public inputs/168 archive files. Commit review uses the recorded17 reporting unit/10 rendered/typecheck and prior full250 unit/102 rendered, backend/API/browser gates; documentation/whitespace/staged-public-input checks are run for this repository delivery. Private runtime files, fixtures/credentials, downloaded applications and generated evidence remain ignored.
