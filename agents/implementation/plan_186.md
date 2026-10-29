# Plan 186: Shared viewer menu and removal of bottom navigation

Status: Complete

## Feature Reference

- Accepted Home/cards and build42: [Plan185](plan_185.md), [Plan184](plan_184.md).
- Native viewing sequence: [Roadmap](../roadmaps/roadmap_native_viewing.md).
- Feed geometry/loading baseline: [Plan178](plan_178.md), [Plan180](plan_180.md).
- Reporting and draft behavior: [Plan182](plan_182.md), [Plan183](plan_183.md).
- Destination identity: [Context integrity](../features/feature_02_personal-space-global-feed-context-integrity.md).

## Context and Scope

The user wants the same upper-right hamburger menu throughout the viewer and removal of the bottom Home/Your Spaces/Account navigation. They approve a consistent Home → Your Spaces → Account order, current-page indication, context-specific actions below the shared entries, separate Back/Close controls and preservation of playback, feed geometry and reporting drafts. This request authorizes a detailed plan; implementation is not yet authorized.

This plan targets the native iPhone viewer. Source inspection locates the reported Home/Your Spaces footer in native DiscoveryScreen; the web discovery pages already use header links. Full web/CMS/admin navigation redesign is outside this increment. The web feed's own floating links and web Account remain unchanged. Keep that scope explicit in implementation and delivery notes.

Baseline is clean main `29c97648f0d1d920d7c0f0d9eda2ea7248752a38`, which is committed/pushed. Signed build42, source `bbb144a74d9359a283b8a3239793220ef6e70a3e15fc136e0a00189e0d5e453f`, has accepted phone observations for cards, launch/rules/saving and preserved playback/reporting. Existing results:255 native unit tests,111 rendered tests,113 isolated browser assertions and32 actual HTTPS checks. Preserve sign-in, current data, artwork, scalar checkpoints and previous evidence.

Age assurance, web/native API separation, adult-content distribution and new moderation tools were discussion topics only. They receive separate plans and are not implemented here. Plan184's editorial/old-client enforcement gates and Plan183's outstanding observations remain separate.

## Investigation

| Existing source | Finding and consequence |
| --- | --- |
| [DiscoveryScreen](../../mobile/src/discovery/DiscoveryScreen.tsx) | Home, Your Spaces, Continue, genre pages and the native changer share this screen and its bottom Home/Your Spaces/Account buttons. Remove the shared footer and provide a top-right menu callback. Preserve measured card width, page/row offsets, focus restoration and the80% changer scrim. |
| [AccountScreen](../../mobile/src/auth/AccountScreen.tsx), [navigator](../../mobile/src/navigation/ViewerNavigator.tsx) | Account uses the native-stack header and has no menu callback. Its form owns local email/password state and cancels sign-in on unmount. Add menu access without unmounting Account just to read/close the menu; deliberate navigation away retains cancellation safeguards. Avoid duplicate headers/titles. |
| [ViewerMenu](../../mobile/src/navigation/ViewerMenu.tsx) | Account currently comes before Home/Your Spaces and its label changes to Sign in/Retry. Reorganize a fixed three-entry primary group, with account status in secondary text and management actions below. Preserve busy/sign-out/retry and diagnostic controls. |
| [Menu route](../../mobile/src/navigation/ViewerNavigator.tsx) | Menu origin is limited to feed/profile. About always uses the retained feed context, even when the opening page is not that feed. Model the actual source route and its capabilities so a Home/Account menu cannot act on an unrelated last feed. |
| [FeedScreen](../../mobile/src/feed/FeedScreen.tsx), [feedGeometry](../../mobile/src/feed/feedGeometry.ts) | Feed also has bottom Home/Your Spaces/About controls. Their container reserves at least64 points plus the bottom safe inset; its height depends on callbacks and button wrapping. Remove controls while explicitly retaining the accepted black reserve and video-stage geometry. Keep the existing floating FeedHeader and full-picture loading cover. |
| [FeedHeader](../../mobile/src/ui/FeedHeader.tsx), [IconButton](../../mobile/src/ui/IconButton.tsx) | The accepted hamburger glyph and44-point control already exist. Reuse them rather than introducing a new icon/visual family. Header placement must account for safe insets, Back/Close and larger text. |
| [EntryScreen](../../mobile/src/discovery/EntryScreen.tsx), [creator profile](../../mobile/src/profiles/CreatorProfileScreen.tsx) | About/introduction has custom headers; creator profile already has stack header menu access. Wire both to the same menu behavior. Keep rules-reader Back separate from global navigation and preserve the current document/reader position on menu Close. |
| [PlaybackSettings](../../mobile/src/preferences/PlaybackSettings.tsx) | Settings renders an unconditional React Native Modal inside a stack route. Pushing a new menu route alone can leave it behind that modal. Give the navigator ownership of settings presentation, retaining the existing panel, instead of stacking a hidden menu beneath it. |
| [ReportScreen](../../mobile/src/reporting/ReportScreen.tsx), [ReportStore](../../mobile/src/reporting/reportStore.ts), [ReportMemory](../../mobile/src/reporting/reportMemory.ts) | Reporting deactivates and masks on lost focus. Existing memory retains Start/End/Show all for15 minutes, while selected rule/detail/list restoration can reset. Opening and closing the global menu must preserve the reading/editing session while refreshing authority before reuse. Do not extend draft/access lifetimes or weaken background/account clearing. |
| [Comments](../../mobile/src/engagement/CommentsScreen.tsx), [Launch chooser](../../mobile/src/spaces/LaunchSpacesScreen.tsx) | These are modal workflows with dedicated Close and scoped state. Add consistent menu access while preserving their return destination, pending input and actual permission checks. Global navigation away closes the workflow normally. |

## Locked Decisions

1. Use the same upper-right hamburger glyph, touch target and Open menu label on user-facing viewer pages. The Menu itself has Close menu instead of another hamburger.
2. The primary entries are always ordered Home, Your Spaces, Account when those destinations are enabled. Account keeps its label; sign-in/saved-session information can appear beneath it. Mark the opening page as current, rather than marking the Menu route as current.
3. Selecting the current destination closes the menu without creating another copy of the page or resetting its state.
4. Secondary actions follow the shared entries. About & Rules and Refresh require an actual relevant source; a retained hidden feed is insufficient. Existing settings/account/preview diagnostic behavior remains available where appropriate.
5. Remove the bottom global navigation from discovery and feeds. Keep the feed's black64-point reserve plus bottom safe inset as the explicit geometry baseline; retain system safe-area padding on other pages. Reclaim only the space used by discovery navigation controls.
6. Back, Close, Done, rule-section choices and submission footers remain workflow controls. They are not removed as part of global-navigation cleanup.
7. Menu Close/Back restores the source page, scroll/focus and same-account edits. Intentional navigation away follows that workflow's normal close/cancel behavior. Sign-out/account replacement and real background events keep their existing privacy rules.
8. Home, menus and readers do not start hidden media. Existing feed checkpoint, manual-pause, eligibility, fresh-pool and loading-cover behavior remains authoritative.
9. No new moderation destinations, age-verification controls, API scopes or rollout changes. Do not add placeholders for those discussed future features.

## Screen and Menu Contract

| Source page | Header/menu treatment | Context-specific behavior |
| --- | --- | --- |
| Feed: Global, group, channel, personal | Keep floating header/space selector and existing upper-right icon. Remove bottom links; keep video reserve. | About & Rules for this feed; Refresh only for its current live feed key; readiness only for an eligible Global preview session. |
| Home | Title and upper-right menu; no bottom navigation. | Shared destinations/settings/account actions, with no actions for a hidden prior feed. |
| Your Spaces, full Continue, genre | Back where currently appropriate, title, upper-right menu; no bottom navigation. | Preserve page/card/row state. Mark Your Spaces current only for its actual page/changer context. |
| Account | One header with Back when meaningful and upper-right menu. | Account is current. Preserve form when the menu closes; retain sign-in cancellation/generation checks when leaving intentionally. |
| Creator profile | Reuse existing menu location and Back. | Shared destinations; no unrelated feed Refresh/About. Preserve profile journey unless deliberately leaving it. |
| Space introduction/About and its rule reader | Add top-right menu; keep reader Back/Close as separate controls. | Use this document's space for contextual actions; opening/closing Menu does not acknowledge rules or enter a feed. |
| Reporting and rule explanation | Top-right shared menu, retaining Close report and Back to reasons. Use two header rows if needed. | Preserve time edits/Show all/selected rule/section and reading position on menu Close, within the existing identity and draft deadline. No automatic submission. |
| Comments and Launch chooser | Menu alongside the existing Close behavior, without overlapping controls. | Retain same-context input/selection on menu Close; no implicit comment send or Launch. |
| Settings | Navigator-owned presentation with the existing settings panel, Done and menu. | Selecting Settings again closes Menu. Existing sound/caption saving continues normally. |
| Loading, empty, access-error states | Keep the containing page's menu reachable. | Capabilities still depend on current verified context; an error is not an authorization bypass. |

Internal readiness probes/covers retain their existing testing controls while an attempt is active. They are diagnostic tools rather than additional public navigation destinations; preserve their cancellation and silent-cover behavior.

## Navigation and State Design

### Source-aware menu commands

Add a typed menu-origin descriptor covering actual route name/key, auth generation and optional contextual space/live feed key. Store only scalar navigation identity, never credentials, report access proofs or media players. Resolve actions from the actual mounted source and current state.

Use a focused helper/controller for opening, closing and selecting destinations so the navigator does not acquire separate ad hoc branches for every screen. Recheck focus, route existence, identity generation and context before executing any command. Retain the current discovery configuration fallback: normal enabled builds expose the three primary destinations, and legacy/unavailable configurations must not dispatch to an unregistered route.

Keep one Menu presentation. Present it through the native stack above ordinary and modal viewer routes; give Settings presentation to the same navigator to avoid its current nested-Modal obstruction. Retain the existing dark menu appearance and use correct top/bottom safe-area handling when replacing the current native menu header.

Close menu, system Back and supported dismissal return to the exact source route. Opening/closing must not replace it with a fresh instance. On destination selection, remove Menu from the stack, reuse an existing matching primary destination when possible, and close transient workflows being deliberately left. Back from the resulting page must not reopen a stale Menu or abandoned reporting/Launch modal. Do not indiscriminately reset the entire navigator: preserve the existing return-to-feed/profile contract where applicable.

### Current page, contextual options and access

Keep Home/Your Spaces/Account visually ordered and consistently labeled. Use visible emphasis and accessible selected state for the actual current destination; secondary account text can explain Sign in or Retry. A genre/About page does not need a falsely selected primary entry.

Use an explicit capability mapping. For example, Menu opened from Home may offer Settings, but cannot refresh the last Global feed. A menu from an About reader can identify that reader's space without consulting a different retained feed. Feed commands must additionally match the current live feed key. Existing server checks continue to determine whether a selected space/document/action is allowed.

No stale command survives identity/origin replacement. A sign-out or permission change clears private state using existing mechanisms and removes invalid source routes. Menu Close remains available while account validation is busy. Preserve development-only visibility for diagnostics; ordinary release builds gain no diagnostic controls.

### Forms and temporary menu suspension

Treat opening Menu as a temporary presentation change, with private content masked and network authority refreshed on return. Keep scalar form/reader state under its existing owner; restore it only for the same account, report target and current rule mapping. Do not put sensitive form contents in navigation parameters, logs or persistent storage.

For reporting, preserve Start/End/Show all through existing ReportMemory and preserve selected reason identifiers, description/example section and scroll/focus separately. Re-fetch/revalidate detail before rendering or submitting; if the rule disappears, return to the available reasons with the existing explanatory state. Menu suspension cannot turn a stored draft into an access proof. Keep the15-minute time-edit deadline, short access/detail proofs, background clearing, denial handling, uncertain-send reconciliation and account-generation boundaries.

Disable opening global navigation during an active report submission rather than interrupting a write simply to show Menu. The existing submission outcome and uncertainty mechanisms remain in force. Opening/closing Menu never submits or retries a report automatically. Deliberately leaving the reporting workflow uses its ordinary close semantics; this does not promise persistence across sign-out, backgrounding or a different feed visit.

Keep Account mounted while the menu is merely covering it, so partially entered fields survive Close. Dismiss the keyboard while Menu is visible and preserve usable focus on return. Navigating away deliberately cancels any in-flight sign-in and ignores late completion from the departed route. No password is copied into shared menu state.

## Phase Status

- A: Complete — source route/generation/feed-key guards and destination cleanup
- B: Complete — shared menu/header, removed bottom links, explicit unchanged feed reserve
- C: Complete for host qualification — Account/report/comment editing, fresh authority, navigator-owned Settings
- D: Complete for host qualification — automated regression and controlled geometry; physical/accessibility limits below
- E: Complete — user accepts all three focused build43 iPhone bundles, with coverage limits retained

## Phase A — Establish source-aware navigation

- Goal: one menu behavior that safely works from every supported viewer source.
- Steps:
  - [x] Define the origin descriptor/capability mapping and extract focused command helpers around the existing navigator.
  - [x] Establish primary destination selection/current-page behavior, route reuse and Menu/transient-route cleanup without duplicate stacks.
  - [x] Retain feed-key, auth-generation, sign-out, missing-discovery and stale-command checks.
  - [x] Confirm topmost stack presentation for Report/Comments/Launch and navigator ownership of Settings; avoid another independent global modal system.
- Test gate: actual navigator cases for Home → Menu → Account/Your Spaces, current-page selection, Menu Close and repeated transitions; stale origin/generation/feed key and fallback route absence.
- Acceptance: one menu, correct primary order, no duplicate primary pages, unrelated feed actions or stale Menu on Back.

## Phase B — Apply shared headers and remove bottom links

- Goal: consistent top-right access without changing accepted feed geometry.
- Steps:
  - [x] Reuse IconButton and add a small shared viewer-header/control arrangement where custom headers are required. Preserve FeedHeader positioning and creator-profile navigation.
  - [x] Add menu callbacks to discovery, Account, entry/rules and remaining user-facing screens; keep Back/Close/Done reachable and avoid duplicate titles/safe-area padding.
  - [x] Reorder ViewerMenu's shared entries, expose current-page state and retain contextual/account/settings/diagnostic actions according to Phase A.
  - [x] Remove discovery bottom Home/Your Spaces/Account and feed bottom Home/Your Spaces/About controls. Retain in-card About & Rules and card save/launch controls.
  - [x] Decouple feed reserve height from the removed callbacks and text buttons. Keep the64-point plus bottom-inset budget, stage sizing/crop, full-picture cover and floating header intact. Audit shared styles before deleting them: EntryScreen also imports DiscoveryScreen styles.
- Test gate: rendered header/menu presence across the source matrix; no bottom navigation duplicates; safe top-right44-point targets and larger-text wrapping; before/after feed stage/reserve bounds at recorded sizes/insets.
- Acceptance: each supported page has the same menu access; discovery gains content space; feeds retain the accepted picture geometry and current space selector.

## Phase C — Preserve forms and modal workflows

- Goal: reading the global menu does not discard an in-progress workflow or expose unauthorized hidden data.
- Steps:
  - [x] Present Menu above Report/Comments/Launch and the navigator-owned settings panel; preserve Close/Back/Done, modal focus and the existing scrims.
  - [x] Preserve/reconcile report scalar draft and reader state across Menu Close without extending existing lifetimes or keeping stale proofs. Disable menu entry during submission and retain uncertain-send handling.
  - [x] Preserve Account fields on temporary Menu presentation; retain deliberate-leave cancellation, saved-session retry, busy/sign-out behavior and late-response guards.
  - [x] Preserve gallery vertical/horizontal offsets, current card focus, About reader position and profile/Launch return state on Close. Global destination navigation intentionally closes the workflow being left.
  - [x] Verify background, account replacement, expired access and revoked permissions still mask/clear state appropriately.
- Test gate: actual report/components and navigator flow for edited times → rule section → Menu → Close; failed/stale refresh; send-in-flight; Account keyboard/sign-in cancellation; modal Settings → Menu → Close; comments/Launch closure and input behavior. Assertions cover actions and state, not implementation snapshots.
- Acceptance: no accidental submission/launch, no loss of valid same-session edits solely from opening Menu, and no old-account or stale-proof restoration.

## Phase D — Qualify the integrated viewer

- Goal: establish host evidence before distributing a native preview.
- Steps:
  - [x] Extend existing menu/discovery/layout/reporting/navigator tests with focused cases from A–C. Retain tests for previously available footer destinations by exercising their new menu path.
  - [x] Run native unit/rendered suites and typecheck. Existing baseline is255 unit/111 rendered; new counts depend on meaningful additional cases.
  - [x] Check ordinary and larger text on narrow/wide controlled layouts, keyboard-visible Account/report screens, accessible menu selected state, reading/focus order and Close access. Record actual VoiceOver observations separately.
  - [x] Verify paused/playing menu detours and Home/Your Spaces/Account transitions preserve scalar checkpoints, fresh pools and silent covers. Confirm within-feed swipes/reporting, exact-video Launch and creator-profile return retain their existing contracts.
  - [x] Run documentation/local-link/whitespace checks with zero new findings over the current16-finding docs baseline. Verify build42 source/evidence remains preserved.
- Test gate: focused actual-component tests first, then appropriate full native suites. No server/schema/fixture mutation, web deployment, frontend build or API qualification is needed for a native-only change unless implementation introduces a justified shared change.
- Acceptance: all normal viewer routes have functional menu navigation, regression checks pass and emulated geometry claims are distinguished from physical observations.

## Phase E — Signed preview and phone acceptance

- Goal: verify the actual iPhone presentation and navigation behavior.
- Steps:
  - [x] Prepare signed internal build43 after host checks.
  - [x] Verify exact public source/export/archive/downloaded IPA, expected API, provisioning/device/signing, native modules and OTA policy before sharing the install link. Preserve build42 as comparison.
  - [x] Check Home/Your Spaces/Account/feed menu placement, fixed primary order/current page, absence of bottom buttons, meaningful Back/Close/Done and repeated navigation without stack loops.
  - [x] Check Account keyboard/edit → Menu → Close and report time edits/rule reading → Menu → Close. Verify settings presentation and current source-specific actions.
  - [x] Confirm unchanged feed framing/crop/reserve, paused/playing position on returns, clear audio, silent covers, smooth swipes and reporting open/close. Repeat long timing samples only if a regression warrants it.
  - [x] Record exact user responses and remaining device/accessibility limits; preserve previous fixtures, sign-in and other plan gates.
- Acceptance: user confirms the global navigation increment on the verified signed preview, with limits explicitly attributed.

## Files and Ownership

- Primary: [ViewerNavigator](../../mobile/src/navigation/ViewerNavigator.tsx), [ViewerMenu](../../mobile/src/navigation/ViewerMenu.tsx), [DiscoveryScreen](../../mobile/src/discovery/DiscoveryScreen.tsx), [AccountScreen](../../mobile/src/auth/AccountScreen.tsx), [FeedScreen](../../mobile/src/feed/FeedScreen.tsx), [FeedHeader](../../mobile/src/ui/FeedHeader.tsx), [IconButton](../../mobile/src/ui/IconButton.tsx), [feed geometry](../../mobile/src/feed/feedGeometry.ts). Add focused header/menu helpers beside existing UI/navigation code.
- Modal/readers as needed: [EntryScreen](../../mobile/src/discovery/EntryScreen.tsx), [PlaybackSettings](../../mobile/src/preferences/PlaybackSettings.tsx), [ReportScreen](../../mobile/src/reporting/ReportScreen.tsx), [ReportStore](../../mobile/src/reporting/reportStore.ts), [ReportMemory](../../mobile/src/reporting/reportMemory.ts), [CommentsScreen](../../mobile/src/engagement/CommentsScreen.tsx), [LaunchSpacesScreen](../../mobile/src/spaces/LaunchSpacesScreen.tsx), [creator profile](../../mobile/src/profiles/CreatorProfileScreen.tsx).
- Verification: [menu tests](../../mobile/tests/rendered/menu.test.cjs), [discovery tests](../../mobile/tests/rendered/discovery.test.cjs), [layout tests](../../mobile/tests/rendered/layout.test.cjs), [reporting UI tests](../../mobile/tests/rendered/reporting.test.cjs), [navigation harness](../../mobile/tests/rendered/navigation.cjs) and focused new actual-navigation cases. Improve harness capability only to model real stack behavior required by the tests.
- Records: this plan, [implementation index](INDEX.md) and [native roadmap](../roadmaps/roadmap_native_viewing.md). Preserve Plan184/185 acceptance and commit `29c9764`.

## Open Risks / Deferred

- Nested native modal presentation and form focus are the main implementation risks; do not silently ship a menu hidden behind Settings or replace a source screen just to show it.
- Existing report privacy clearing must remain distinct from temporary menu suspension. Menu access cannot extend a draft deadline, suppress real background clearing or reuse expired permission.
- Same-menu consistency does not mean every page receives every contextual action. In particular, gallery/Account menus must not expose the last feed's actions.
- The black feed reserve remains deliberately empty after removing its buttons. Filling it or expanding the video is a separate layout decision.
- Web/CMS/admin menu unification, native moderation, age assurance and mature-content distribution/API work remain separate increments.
- Maximum text size, VoiceOver, another physical device, store distribution and new numerical playback measurements require their own observed evidence; the plan does not assume them from existing qualitative acceptance.

## Validation

- Baseline: accepted build42 / commit `29c9764`. No applicable AGENTS.md, delegation or skill invocation. Implementation is isolated in `/home/ubuntu/aws-plan186`; no web/API/schema/rollout/fixture changes.
- Native255 unit tests and all115 rendered cases pass; the strengthened Account sign-in-cancellation case also passes separately after the full run. Typecheck passes. Tests use the installed StackRouter plus controlled native surfaces; reset actions are rehydrated as in the real navigator.
- New actual navigation coverage: fixed primary order/current state, current-page no-op, source keys, stale callbacks, Account field preservation, navigator-owned Settings with no nested RN Modal, rules checkbox retention/no automatic entry, report Start/End/Show all/section/scroll with fresh authority, missing-rule fallback, submission-disabled Menu, Comments draft return and real-background clearing. Existing paused/playing Home returns, scalar restoration, geometry, silent covers, exact Launch, captions/story/Follow/report regressions pass.
- Controlled layouts cover narrow widths and enlarged text. The existing44-point icon and explicit64-point plus bottom-inset Feed reserve are retained. The user subsequently accepts the focused physical navigation, modal/form-return and playback bundles below. VoiceOver, maximum text size and another physical device remain unexercised; controlled host tests do not prove them.
- Public build43 source `df73de7b253024e3bb8e19771c6d950fbe048f533d43a6d05834ae4abc121834`:176 source inputs; archive exactly177 files including the identity stamp; Hermes export2420232 bytes. Expected source/API and retained features verified; zero private inputs. [Build43](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/f6cc5e3e-da91-485b-ba29-5c1d996b4e4a) finished and downloaded:8429375 bytes, SHA256 `661b9204558d960453190b540d7bd831f599db8662bebcbb5115fb2907aac817`, embedded Hermes2420312 bytes. Expected source/API/native module and signing namespace match; the one provisioned device matches accepted build26, get-task-allow false, OTA disabled. Focused physical qualification accepted by the user. Local evidence is under `tests/runs/build/plan_186/`.
- Documentation checker retains exactly16 preexisting findings, zero new; all48 local plan links resolve and whitespace passes. Guarded native-only primary promotion checks product bytes against `29c9764` and the three planning-document hashes before copying; source is then matched again against the public manifest. Build42 evidence remains untouched. No commit or push requested for this increment.

## Build43 iPhone Acceptance

The user confirms all three requested bundles:

1. Menu placement on Home/Your Spaces/Account/feeds; fixed Home → Your Spaces → Account order/current-page marking; removed bottom buttons; Close/current-page selection without duplicate pages: “Yes. All good.”
2. Account field preservation; Report Start/End, rule section and reading-position return; Settings → Menu → Close and Done: “Yes, all good”.
3. Unchanged feed framing/black reserve; saved position/pause; clear playing audio; silent loading/menu screens; smooth within-feed swipes; reporting/comments/space-changing open/close: “Yes. All good.”

This completes A–E for the build43 internal milestone. No new numerical playback sample, maximum-text/VoiceOver observation, another-device coverage or public-release qualification is implied. The user's subsequent Personal/Global/Your Groups/Your Channels menu proposal is discussion for a separate increment; the accepted build43 implementation is unchanged. No commit/push requested.

## Change Log

- 2026-10-29 (Pacific) — User accepts all three focused build43 phone bundles. A–E complete for the internal milestone, with device/accessibility/performance coverage limits retained. New Groups/Channels menu proposal remains discussion only.

- 2026-10-29 (Pacific) — User authorizes implementation. Add shared menu access across native screens, source-aware destination handling, fixed primary labels/current state, explicit feed reserve, Account/report/comment return state and navigator-owned Settings. Host checks and signed/source/archive/downloaded build43 verification recorded above; phone acceptance remains open.

- 2026-10-29 (Pacific) — User approves the shared-menu direction and requests a plan. Investigated native footer/header ownership, menu origin limitations, feed reserve coupling, Account lifecycle, nested Settings modal and report draft/authority state. Planning only.

## Resume Here

A–E complete for the accepted build43 internal milestone. Preserve verified source/artifacts, build42 comparison and prior Plan184 editorial/compatibility gates. The destination proposal was subsequently implemented and accepted in Plan187/build46. The user has now requested repository commit/publication of the combined accepted Plan186/187 work; preserve this build43 evidence.
