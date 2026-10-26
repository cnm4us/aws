# Plan 179: Unified creator, publishing time and optional story panel

Status: Complete

## Feature Reference

- Contract: [Personal Space, Global Feed, and Context Integrity](../features/feature_02_personal-space-global-feed-context-integrity.md).
- Predecessor: [Plan178](plan_178.md), implemented and pushed as `71aab2af88116d110e8da043e976bfbbc087f4b2`; build30 is the accepted layout comparison.
- Existing text behavior: [Plan170](plan_170.md), [StoryPanel](../../mobile/src/content/StoryPanel.tsx) and [TextResources](../../mobile/src/content/resources.ts).
- Roadmap: [Native viewing](../roadmaps/roadmap_native_viewing.md).

## Context

The native feed currently shows the creator name separately above an optional story panel. The user wants one compact panel at the bottom left that always contains the creator name and publication date/time. Only publications with additional story text offer expansion. The arrow belongs in the upper-right corner; expansion grows the panel upward. The separate creator name above the panel is removed.

The user accepted the discussed behavior, including creator-profile navigation, the viewer's local time zone, an up arrow while collapsed/down arrow while expanded, VoiceOver labels, capped scrolling for long stories and fixed video/footer geometry. The plan was requested and reviewed; the user now explicitly authorizes implementation. Proceed with phases A–D and the signed preview; the user now explicitly requests a local commit; push is not requested.

In scope: native Global, personal, group and channel feeds; an additive publication timestamp in the native viewer API; mobile adaptation/formatting; shared panel composition; focused regression and signed-device validation when implemented. Out of scope: web UI redesign, story authoring, publication scheduling/republishing semantics, schema changes, bottom-tab destinations, player/audio/readiness changes and closing predecessor performance/accessibility/cleanup gaps.

## Investigation Findings

| Source | Finding and planned consequence |
| --- | --- |
| [FeedCard](../../mobile/src/feed/FeedCard.tsx) | Creator/profile action is rendered above StoryPanel. StoryPanel exists only when `hasStory` and resource callbacks are available; otherwise upload description can appear. Replace this split with an always-present metadata panel. The agreed metadata-only state replaces the visible upload-description fallback; do not treat upload description as a publication story. |
| [StoryPanel](../../mobile/src/content/StoryPanel.tsx) | Has accessible text toggle, collapsed two-line preview, lazy expanded fetch and a scroll body capped at45% of page height. Preserve resource lifecycle but replace the text toggle with an upper-right chevron; collapsed contents become creator/date only, with no story preview or “Read the story” prompt. |
| [Feed types](../../mobile/src/feed/types.ts), [adapters](../../mobile/src/feed/adaptFeed.ts), [viewer serializer](../../src/features/feeds/viewer.ts) | No publication timestamp reaches FeedVideoItem. Feed services already carry `publication.published_at`; add only `publishedAt` to the native serializer allowlist and mobile model. All ordinary/anchored/prepared feeds must use that same projection. |
| [Feed service](../../src/features/feeds/service.ts), [publication repository](../../src/features/publications/repo.ts), [DB pool](../../src/db.ts) | Current publication writers serialize UTC instants as SQL date strings; the pool returns date strings. A bare SQL timestamp must not be interpreted in the phone's time zone. Confirm relevant writer paths, then normalize server-side to an explicit UTC ISO instant; invalid/missing values become null. Do not change stored values or feed cursors. |
| Feed repository and TextResources | `hasStory` comes from nonblank publication story text; full text is fetched from an exact context/publication endpoint, validated and bounded to2000 characters. Keep this flag as the initial presence signal and retain protected verification/cache deadlines. A null preview does not prove absence. |
| [FeedScreen](../../mobile/src/feed/FeedScreen.tsx), [CaptionLayer](../../mobile/src/content/CaptionLayer.tsx) | Caption position uses measured card-text height; expansion temporarily suppresses captions. `textEligible` gates active text and clears resources on cover/background/scroll. Integrate the new panel with these owners; expanding must not resize the feed page or change playback intent. |
| Rendered [feed](../../mobile/tests/rendered/feed.test.cjs) and [text renewal](../../mobile/tests/rendered/textRenewal.test.cjs) tests | Existing actual-component coverage checks pause/captions/story interaction and protected renewal/expiry/Retry. Extend it around the new panel and retain lifecycle assertions. Host structure alone cannot prove iOS touch/scroll/text geometry. |

## Locked Decisions

1. One bottom-left panel in every existing native feed. Default contents are creator name, then publishing date/time. A publication with no story has neither arrow nor expand/collapse action.
2. When `hasStory` is true, show the arrow in the upper-right. Collapsed points up and has accessibility label `Expand story`; expanded points down and has label `Collapse story`. Expose button role and expanded state; hide the decorative image from VoiceOver. These labels are spoken accessibility metadata, not extra visible button text.
3. Creator name inside the panel opens the same creator profile. Remove only the duplicate bottom-left name above it; retain the right-side avatar, Follow/recognition and other controls. Missing creator identity stays plain fallback text, without a broken profile action.
4. Collapsed metadata layout and styling are the same with or without a story, apart from the arrow. Reserve its header area so long names never run behind the arrow. Creator and arrow are separate touch targets of at least44 logical points; the whole panel is not a single nested button.
5. Show the current feed publication's `published_at`, not upload creation, production update, story edit, launch origin or a different space's publication time. Use absolute localized date and minute-level time, including year, in the viewer's local time zone and12/24-hour preference. No relative-time ticking or seconds. Missing/invalid data displays `Publishing time unavailable`; never substitute now or a different timestamp.
6. Expansion reveals the full authorized story below persistent metadata and grows only upward. Collapse returns to creator/date. Long text scrolls within a bounded panel; arrow stays reachable. Keep selectable story text and scaling for content text. Use the existing chevron asset and native styles; no new icon library, native module or animation dependency.
7. The panel remains above the existing black footer and clear of the action lane/header. It never changes video dimensions, crop, FlatList page length, selection, seek, pause, mute or player allocations. Retain the current translucent dark panel treatment; the80% Spaces-screen opacity is a separate contract.
8. Fetch full story only for the selected, eligible, expanded publication. Preserve VerifiedRefresh, original cache age, quiet renewal, cancellation, denial masking and stale-result rejection. Do not preload full stories to determine whether an arrow is needed.
9. Preserve caption preference. Temporarily hide captions while expanded as today, then resample the selected player's current cue when collapsed. Caption placement follows actual collapsed-panel height without rebuilding video geometry.
10. Any new selection/feed visit starts collapsed. Cover, background, access failure or resource/context replacement closes the story and prevents late results from reopening it. General acceptance of build30 does not qualify this revision's physical behavior.

## Proposed Implementation

### Publication timestamp

Add `publishedAt: string | null` to FeedVideoItem and the native viewer response. Normalize known UTC SQL values at the server boundary into explicit ISO8601 UTC timestamps; validate calendar fields rather than letting date parsing silently normalize impossible dates. Preserve legitimate offset-bearing inputs if normalization accepts them, convert to UTC and return null for unsupported/ambiguous values. Check repository writer semantics before choosing accepted SQL forms. Do not alter feed ordering or cursor parsing.

Mobile accepts an explicit-zone valid instant or null, and tolerates an absent new field during rollout as unavailable. Keep legacy `adaptFeedPage` compatible with its existing publication shape using a deliberate UTC conversion where that path remains supported. Never rely on platform parsing of `YYYY-MM-DD HH:mm:ss`. A small formatter uses the runtime locale/time zone and handles invalid input/formatting failure without breaking feed playback. Test fixed instants across date boundaries, offsets and daylight-saving transitions. Reformat when rendering/resuming after locale/time-zone changes; no recurring timer is needed. Verify formatting on the actual bundled Hermes runtime.

The same production can have distinct publication timestamps across spaces. Preserve publication identity in all data paths, including Launch prepared entry, anchored restore, public Global memory and Refresh. An additive field is compatible with build30, which ignores it. API deployment must be verified before the new phone preview is claimed to show real dates. No database migration is expected.

### Component and state boundaries

Compose creator/date and optional story in one publication panel, either by extending StoryPanel or using a small wrapper with its existing body. Keep resource hooks in a story-capable child so metadata-only cards do not create renewal owners. FeedCard remains responsible for its bottom anchor, measured text height and unavailable-media notice. Keep unavailable-media feedback outside story presence logic; removing description must not remove that notice.

Use a publication/resource-scoped expansion owner and reset on inactive/context/identity changes. `hasStory=false` immediately removes expansion and cancels pending work. If a successful story response or renewal is null/whitespace, collapse to metadata-only, remove the arrow and cancel the active renewal owner; do not leave an expandable “No story” panel. Keep that confirmed absence scoped to this visit/resource and allow refreshed feed metadata/new visits to discover a newly added story. Distinguish absence from network failure: loading/error/Retry stay inside the expanded body and retain the collapse arrow. Denial still delegates to the existing feed access owner and masks protected content.

Story scroll and creator/arrow presses must not trigger video pause or feed paging. The story region consumes its own vertical gesture while still allowing a normal swipe outside it to advance the feed. Preserve existing within-feed preload capacity and fresh pools on actual feed changes. State changes must update caption suppression even when a fetch fails, a story disappears or the selected card unmounts.

### Bounded layout

Keep the existing bottom anchor above the footer and width clear of `CONTROL_LANE`. Pass measured unobscured stage/header bounds to the panel rather than using device-model guesses. Cap the entire panel below the floating header, accounting for bottom gap and measured metadata/arrow height. Prefer the existing45%-of-stage limit for the story body, further reduced by remaining available height; do not retain an unconditional minimum that can overflow a short viewport. Metadata stays at the top and the body scrolls. If extreme text scaling leaves too little room, provide bounded scroll access to the contents while keeping collapse reachable; do not shrink text or resize the video to manufacture room.

Use wrapping creator/date text and verify narrow widths, long names, large fonts and both cropped/tall feed stages. Expansion requires no new animation contract; it changes panel height with a stable bottom edge. Physical validation must confirm gesture arbitration and target reachability, beyond arithmetic and rendered-style assertions.

## Phase Status

- A: Complete — Additive UTC timestamp, adapters and localized formatter;58 backend tests/build/typecheck and focused date contracts pass.
- B: Complete for host implementation — Unified creator/date panel, optional directional chevron and bounded upward expansion.
- C: Complete for host implementation — Renewal/absence/cancellation, gesture ownership and caption/playback integration pass.
- D: Complete for the recorded build31 milestone — Host/API/artifact gates pass and the user confirms the focused Global/other-feed panel checks. Short-phone/large-text/VoiceOver and additional playback/performance cases remain unverified as recorded below.

Implementation is explicitly authorized. A–C host work passes.234 unit/81 rendered/58 backend tests, backend build and mobile typecheck pass; the latest absence-cache correction additionally passes9 focused rendered cases. Final stamped-source234 unit/81 rendered/typecheck, backend build and matching iOS export/archive pass; signed artifact and focused physical panel acceptance also pass, with coverage limits below.

## Phase A — Carry the correct publishing instant

- Goal: Deliver an unambiguous publication timestamp without changing existing feed semantics.
- Steps:
  - [x] Confirm relevant publication writer/time-zone conventions and response paths; implement nullable native `publishedAt` normalization.
  - [x] Update serializer allowlist assertions, mobile types/adapters and formatter; tolerate old responses safely.
  - [x] Cover valid UTC/offset values, SQL conversion, missing/invalid dates, local day/year boundaries and different timestamps for one production published into two spaces.
- Test gate: `npm run test:viewer`, `npm run build`; `npm --prefix mobile test` and `npm --prefix mobile run typecheck`. Add focused serializer/adapter/formatter contracts; do not infer new results from build30.
- Acceptance: Native responses identify the correct publication instant; mobile never interprets a bare database string as phone-local time. Old clients remain compatible and old responses show a truthful fallback.

## Phase B — Render one compact panel

- Goal: Always show creator/date and offer expansion only for a story.
- Steps:
  - [x] Consolidate metadata into the panel, remove the duplicate creator and visible upload-description fallback, retain profile action and unavailable-video feedback.
  - [x] Replace the visible text toggle/preview with the upper-right directional chevron,44-point target and VoiceOver label/state.
  - [x] Implement upward expansion, bounded body scrolling and measured safe bounds; keep the bottom anchor/video/footer fixed.
  - [x] Cover metadata-only, short/long story, missing identity/date, long name and narrow/large-text layouts in actual-component tests.
- Test gate: `npm --prefix mobile run test:ui` and typecheck; assert no arrow/expanded semantics/request for metadata-only cards, one creator name in the panel and correct profile target.
- Acceptance: Collapsed content is creator/date only. A story adds the arrow and expands beneath that metadata, without shifting or remounting the video.

## Phase C — Preserve text, access and playback behavior

- Goal: Integrate expansion without stale text, hidden work or altered playback intent.
- Steps:
  - [x] Preserve lazy fetch, loading/error/Retry, original-age renewal and cancellation; handle confirmed empty story separately from failed fetch.
  - [x] Reset on selection, cover/background, authority/resource changes and unmount; ignore old publication responses and callbacks.
  - [x] Retain caption preference and correct cue/position on collapse; ensure panel actions/scroll do not trigger video pause or unintended paging.
  - [x] Exercise Global and protected spaces, creator detour return, Spaces Close/current selection and actual feed switches with manual pause/playing intent.
- Test gate: Mobile unit/rendered/typecheck suites, including existing feed, captions, textRenewal, Launch and geometry cases. Assert same selected player/source/time/pause on expand/collapse and no extra native allocation, replace or seek; verify expired/denied and late-response behavior.
- Acceptance: Only eligible expanded stories own full-text work. Collapsing/restoring captions and feed transitions preserve the established player and access contracts.

## Phase D — Qualify and deliver the increment

- Goal: Verify the additive API and final bundled iPhone panel with explicit coverage limits.
- Steps:
  - [x] Run final backend build/viewer tests and mobile unit/rendered/typecheck gates; record commands, counts and source scope. Perform focused API checks for authorized Global/space and anchored/prepared entries plus denial, using existing read-only fixtures where possible.
  - [x] Deploy the additive server change through the existing workflow and verify live response dates before phone validation; avoid fixture or session resets merely to test presentation.
  - [x] Prepare the next internal preview using the established stamped-source/archive/export/signing/downloaded-artifact verification process. Preserve accepted build30; freeze source and keep OTA disabled. Do not choose a build number until release preparation checks current allocation.
  - [x] Record the user-confirmed signed build31 checks in Global and another feed: creator/local publishing time, no arrow without a story, upward expansion and scrolling with a story, creator-profile navigation, and captions returning after collapse. Separate manual pause/playing continuity, exact video/footer geometry and seamless-swipe observations were not supplied in this reply.
  - [x] Record the physical coverage limit: no separate short-viewport, large-text or VoiceOver name/order/expanded-state result was supplied. Keep existing host structure/geometry tests separate from physical evidence; do not infer these cases from the focused acceptance.
  - [x] Update plan/index/roadmap/mobile docs with delivered behavior and recorded acceptance. Carry forward predecessor limits. The user now requests a local commit; push is not requested.
- Test gate: Above suites, verified live additive API, frozen signed artifact and focused physical observations. Run `npm run check:agents:docs`, compare existing findings and validate new local links; introduce no new documentation findings.
- Acceptance: The agreed panel behavior is confirmed on the delivered source/artifact, with untested layout/media/accessibility cases stated. No claim that earlier acceptance proves this revision or closes broader predecessor gates.

## Implementation and release record

- Shared native viewer serializer now adds validated nullable UTC `publishedAt` to ordinary, anchored and prepared entries; mobile adapts the correct publication timestamp and formats an absolute localized date/year/minute time. Calendar/offset validation rejects malformed dates; older responses degrade to the explicit unavailable label. Server publication writers and the live DB clock confirm the existing UTC convention; no stored date, cursor or schema was changed.
- FeedCard always composes one creator/date panel. The visible upload-description fallback and separate creator name are removed. Profile action and unavailable-media notice remain, with measured notice space reserved in the bounds. Story-only hooks retain the existing resource/verification owner. The upper-right44-point chevron has directional image, accessible label and expanded state; no new asset/library/native module.
- Panel height is bounded below the measured floating header and above the existing footer. Normal stories scroll below metadata; oversized metadata switches to one capped content scroller while collapse stays fixed. During panel touches parent paging is suspended; touch end/cancel/cover/unmount restores it. The existing video rectangle/page length/selected player are unchanged. Native text/gesture geometry remains a phone gate.
- Empty successful text collapses/removes the arrow. Fresh positive metadata can bypass the previous empty cache. Failure keeps Retry/collapse. Resource/publication/revision and active guards reject old results/actions; cover/background resets text/expansion and interaction. Existing captions suppress during expansion, resume at the current cue and keep their preference. No audio/player configuration change.
- Host gates:234 unit,81 rendered,58 backend viewer tests pass; typecheck/backend build pass. The strengthened source-load-count assertion additionally passes both actual-feed variants. Logs and machine-readable summary: `tests/runs/build/plan_179/host-gates-build31.json` and corresponding harness logs. Tests are controlled native-port evidence; no native touch/VoiceOver/sound claim follows from them.
- Live source was picked up by the running development backend. Loopback/HTTPS health and public dates pass. HTTPS checks compare10 returned rows to exact DB publication dates across Global, space, anchored and prepared Launch entry; invalid identity401 is preserved, responses no-store. The test's own host session was revoked and preexisting phone sessions were unchanged; no fixture permission/content changes. Evidence: `tests/runs/api-curl/plan_179/publishing-time.json`.
- Build31 frozen source `c4621b6ac97f38b74546e28672e2d4107296ca163a5da31c818dcb929e25f5c8`:148 public inputs/149 archive files, including4 native module files; no unexpected/private input. Source/workspace/archive/export source and API match; Hermes export2282701 bytes contains panel/story/date markers. Evidence: `tests/runs/build/plan_179/{source-manifest-build31.json,archive-export-build31.json}`. Build30 is preserved. EAS `607f1a49-0428-4728-a256-2eaa71ea45f9` finished2026-10-26T20:59:36.108Z; downloaded artifact verified2026-10-26T21:01:37Z. IPA8354201 bytes, SHA256 `92df4e9d6140d5df26a9b2243453d418fba8ae5e4528845dd75e72c32867875a`, embedded Hermes2282793 bytes. Bundle/source/API/panel markers/native module match; the accepted one-phone set/signing namespace match build26, get-task-allow=false and OTA=false. Records: `artifact-build31.json` / `build31-meta.json` in the same build harness. [Install build31](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/607f1a49-0428-4728-a256-2eaa71ea45f9) over the existing app. The user subsequently confirms the focused panel/date/scroll/profile/caption checks below. Short-phone/large-text/VoiceOver and additional playback observations remain unverified; public source is unchanged after submission.

## Build31 phone acceptance

The user replied **“Yes, those checks pass”** to the explicit build31 question covering Global and another feed: creator/local publishing time, no arrow without a story, upward expansion and scrolling with a story, creator-profile navigation, and captions returning after collapse. These named functional checks are accepted on the delivered build31 source. Evidence is recorded in `tests/runs/device/plan_179/build31-acceptance.json`.

No separate short-phone/large-text/VoiceOver, manual pause/playing continuity, fixed video/footer geometry, seamless-swipe/audio or numerical performance result was supplied in this reply. Existing host evidence and all predecessor limits remain scoped. A–D are Complete for this accepted internal panel milestone with those explicit limits. No source change, new artifact, fixture/session operation or commit/push is needed to process the acceptance.

## Change Log

- `adeed1ecb502695e9aa61960258c0884800b261b` — Committed accepted build31 creator/date/optional-story implementation, additive native timestamp API, regressions and delivery docs locally at the user’s explicit request. Push was not requested/performed.

- 2026-10-26 — User confirms the named build31 Global/other-feed panel/date/story/profile/caption checks. A–D Complete for this internal milestone with explicit untested physical cases; commit/push not requested.
- 2026-10-26 — User subsequently authorized implementation. A–C host gates and D live API/export/archive gates pass for frozen build31; downloaded signed build31/source/API/signing verification passes, while physical acceptance remains open. No commit/push.
- 2026-10-26 — Planning only, following user agreement on the unified creator/date/optional-story panel. Baseline `71aab2af88116d110e8da043e976bfbbc087f4b2` is pushed. No implementation commit for this plan.

## Validation

- Environment: `/home/ubuntu/aws`, clean `main` at planning start, matching `origin/main`. No AGENTS.md found in the repository or inspected workspace ancestors.
- Inspected current feed/card/story/caption/resource owners, serializer/feed/publication date writers, adapters and actual-component/backend contract tests. Current timestamp omission and upload-description fallback are source findings, not device measurements.
- Planning commands: read-only `git status`, `rg` and file inspection. Before/after `npm run check:agents:docs` reports the same16 existing status findings and zero new findings. All77 local links across the changed continuity documents resolve; `git diff --check`, new-plan whitespace and A–D Pending status checks pass.
- Implementation commands now run: `npm run test:viewer` (58 pass), `npm run build`, `npm --prefix mobile test` (234 pass), `npm --prefix mobile run test:ui` (81 pass), mobile typecheck,2 focused actual-feed cases, live HTTPS/DB date comparison, preview export and archive inspection. Build30 remains predecessor evidence; the final signed artifact also passes its recorded checks; the subsequent focused phone observations are accepted as recorded above; other physical cases remain unverified.
- Planning evidence: `/dev/shm/plan179-docs-before.log` and `/dev/shm/plan179-docs-after.log`; that earlier planning turn changed documentation only. Implementation documentation check in `/dev/shm/plan179-docs-implementation.log` retains the same16 findings/zero new. All96 local links across changed docs resolve; whitespace passes. Implementation changes are described above; implementation is committed locally as `adeed1ecb502695e9aa61960258c0884800b261b`; push was not requested/performed. Root README was evaluated under its maintenance guide and updated for the confirmed panel/API behavior. Commit checks retain16 baseline documentation findings/zero new,112 valid local links, clean whitespace and all148 staged public inputs matching accepted build31.

## Open Risks / Deferred

- Timestamp format must be explicit across SQL/UTC/native boundaries. Historical malformed values get a truthful fallback, not guessed time or a data rewrite.
- Feed story presence can change between page load and expansion. Reconcile confirmed absence without treating network failure as no story or fetching hidden full text.
- Focused story scrolling is user-confirmed on build31. Short-phone/large-text bounds and VoiceOver behavior remain physically unverified; the test renderer does not calculate iOS glyph layout or native gesture arbitration.
- Removing the visible upload-description fallback is intentional under the agreed creator/date/optional-publication-story design; authoring/data remain unchanged.
- Build30’s unreported specific short-phone/audio/accessibility cases, Plans175–178 performance/overnight/offline/nested/sign-out/cleanup and unresolved historical native-static cause remain separate. Preserve phone sign-in and fixtures.
- Future Home/Friends/Inbox/Profile/Search destinations and web panel changes remain outside this increment.

## Resume Here

- Build31 is accepted for the named Global/other-feed creator/date/optional-story/profile/caption checks. A–D are Complete for this recorded milestone with explicit coverage limits. Public source remains identical to the verified signed artifact; no rebuild or repeated phone campaign is needed merely to record acceptance.
- Accepted implementation is committed locally as `adeed1ecb502695e9aa61960258c0884800b261b`; this delivery record follows separately. No further product change is needed for this accepted scope. Push only when explicitly requested. Preserve phone sign-in, fixtures, build30 comparison and all predecessor/untested-case limits.
