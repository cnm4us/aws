# Plan 185: Consistent space cards, compact saving and direct rules access

Status: Complete

## Feature Reference

- Foundation and accepted build41: [Plan184](plan_184.md).
- Shared-client sequence: [Native viewing roadmap](../roadmaps/roadmap_native_viewing.md).
- Feed/publication identity: [Context integrity](../features/feature_02_personal-space-global-feed-context-integrity.md).
- Accepted playback and loading cover: [Plan177](plan_177.md), [Plan180](plan_180.md).
- Existing artwork and prompts: [Discovery artwork](../../assets/discovery/README.md).

## Context

The user reports inconsistent widths on iPhone Home: Global nearly fills the screen but leaves an uneven right margin; cards without descriptions are narrower than cards with descriptions; genre headings/See all controls extend past the card below them. The title/launch and Save buttons also occupy too much space. The user approved the proposed design and requests a detailed implementation plan. The user subsequently authorizes implementation; proceed through host qualification and a signed preview. The user subsequently requests commit and push; see delivery authorization below.

The agreed direction is a deliberate featured Global card, consistently sized browsing cards, a launch icon beside the Group/Channel label, a compact saved-state checkbox at the lower right, and an always-available About & Rules action. Opening a space continues to show its introduction when acknowledgment is required. Both web and native should follow the same interaction model.

Baseline: build41's Home/entry/saving/restart Continue/playback/reporting checks are accepted. Root Home and native Home are enabled; Global is `/global`. Navy/teal/gold artwork is live through shared card DTOs. Plan184 remains open for editorial/old-client rollout of mandatory server entry enforcement. Preserve its uncommitted source, accepted build/source identity, live flags, owned fixtures and pending predecessor work.

## Investigation

| Source | Finding and planned consequence |
| --- | --- |
| [Native discovery](../../mobile/src/discovery/DiscoveryScreen.tsx) | One inline tile renderer serves Home, Your Spaces, Continue and genre pages. Tiles have `minWidth:220,maxWidth:380` without an explicit contextual width. Standalone tiles stretch differently from children of horizontal ScrollViews. Text therefore influences width, and the maximum leaves extra right space on wider phones. Replace these constraints with measured layout variants. |
| [Native discovery](../../mobile/src/discovery/DiscoveryScreen.tsx), [Action](../../mobile/src/ui/Message.tsx) | Content uses20-point horizontal padding; the header uses18. The title and Save are generic pill buttons. Extract a discovery card rather than changing the shared Action component used by other screens. Standardize the discovery content/header margins. |
| [Native icon control](../../mobile/src/ui/IconButton.tsx), [launch asset](../../mobile/assets/icons/launch.svg) | Existing launch artwork and a44-point control are available. Reuse the visual language with a card-specific treatment as needed; preserve feed controls. |
| [Native navigator](../../mobile/src/navigation/ViewerNavigator.tsx), [EntryScreen](../../mobile/src/discovery/EntryScreen.tsx) | `SpaceEntry` already accepts `about:true`, which prevents automatic entry after a successful document load. Feed About uses it, but discovery cards only receive `onSelect`. Add a separate card callback for About, using the same destination key. |
| [Web discovery](../../frontend/src/discovery/Discovery.tsx), [CSS](../../frontend/src/discovery/discovery.css) | The web has separate grid/carousel sizing, a tile-wide artwork/title link and a large Save button. It already understands group/channel/Global About routes. Extract a reusable web card with separate launch, About and save controls and explicit layout variants. |
| [Web routing](../../frontend/src/discovery/api.ts), [SPA entry](../../frontend/src/main.tsx), [server pages](../../src/routes/pages.ts) | `/personal` exists, but `/personal/about` is missing from the discovery path parser and explicit SPA route allowlists. Complete that route so the My Space card's About action also works on direct reload. |
| [Native save handler](../../mobile/src/discovery/DiscoveryScreen.tsx), [web save handler](../../frontend/src/discovery/Discovery.tsx) | Native disables every save control with one shared busy flag and reloads data after each mutation. Web patches items/genres but not Home's recent cards. Track pending state per space and update all visible copies by ID, preserving scroll and identity guards. |
| [SavedSpacesPanel](../../frontend/src/discovery/SavedSpacesPanel.tsx) | The web feed's compact changer is currently a button list, not a card gallery. Preserve its compact layout; ensure it receives fresh saved membership after changes. The native changer reuses DiscoveryScreen and should receive the revised cards while keeping its80% scrim. |

This is a source investigation; it does not establish revised layout geometry or phone behavior. The findings below guided implementation; execution results are recorded at the end of this plan.

## Locked Decisions

1. Card width is set by its layout context, independent of name or description length.
2. Watch Global remains a featured, full-width card on phones. Genre and Home Continue rows use a consistent carousel width with a visible next-card hint when there is another item.
3. Both small and large phones in portrait use one main carousel card. Two complete columns are reserved for tablet/wider window layouts. Larger text can use a roomier single-card presentation.
4. Artwork and title open the space. The launch icon on the right of the type row performs the same action. Remove the separate large title/launch pill.
5. The footer contains visible About & Rules on the left and the saved checkbox on the right. The saved state uses a green checkmark, with an outlined unchecked state.
6. Global and the viewer's own My Space remain fixed utilities; omit their save checkbox. About remains available on both.
7. About is a deliberate reading destination before or after acknowledgment. Viewing it or pressing Back does not acknowledge rules or enter a feed. An explicit Enter action can proceed through the existing acknowledgment path.
8. Save/Remove changes only Your Spaces. It does not change membership, subscription, contextual creator Follow, acknowledgment or Continue history.
9. Keep generated artwork and custom-artwork precedence. Card labels remain separate from images.
10. Preserve account/lifecycle guards, current authority checks, saved position/manual pause, silent covers and fresh player pools. Home and rules reading allocate no new video players.

## Proposed Layout Specification

### Shared margins and responsive widths

Measure the actual safe content container, including iPhone side insets and any web scrollbar. Use container width rather than device-name detection or a cached initial screen width. Recalculate on rotation, resizing and split-window changes.

Starting tokens:20 logical pixels of horizontal page padding,16 between cards,14 inside cards. Let `C` be the usable width after safe insets/page padding; let `G=16`. Existing wide-web page bounds may remain, but each heading and its row must use the same measured section container.

| Context | Starting width rule | Behavior |
| --- | --- | --- |
| Watch Global, phone | `C` | Equal outside margins; remove the old380 maximum. Deliberately larger than browsing cards. |
| Home Continue and genre rows, `C<600` | `0.84 × C` | All browsing cards have the same width, including cards with no description. Natural horizontal scrolling; no model-specific two-column switch. |
| Your Spaces, full Continue and full genre pages, `C<600` | `C` | A vertically scrolling list of full-width cards. No unnecessary empty horizontal strip on list pages. |
| Wider rows/list pages, `600≤C<920` | `(C−G)/2` | Home rows remain horizontal; full pages use two-column grids. |
| Wider rows/list pages, `C≥920` | `(C−2G)/3` | Three columns/cards across, within the existing bounded page container. |

The600/920 thresholds are implementation defaults based on readable available card widths, subject to the geometry review. They are measured content widths, not physical pixel counts or phone model categories. Watch Global continues to follow its featured section width on wider layouts; review image sizing so it remains a useful feature rather than an oversized poster.

At a320-point viewport with no side inset, `C=280`: the carousel card is235.2, followed by16 gap and roughly28.8 points of the next card. At440 points, `C=400`: the card is336 with48 points of the next card visible. These are design calculations, not measured phone results. One-item genre rows keep the same card width; do not fabricate a second card or imply more items exist.

Use proportional2:1 artwork sizing for normal cards, explicit cover cropping, rounded corners and stable dimensions before image load. Review the featured variant separately on wide screens. Failed/missing artwork retains the same dimensions and the existing fallback, without jumping the footer.

### Card structure

```text
┌────────────────────────────────┐
│             Artwork            │
│                                │
│ Space name                     │
│ Group / Channel             ↗  │
│                                │
│ Optional short description     │
│                                │
│ About & Rules               ☑  │
└────────────────────────────────┘
```

The type row uses the actual label: Group, Channel, Public feed or My Space. Preserve sign-in/access information without squeezing the launch icon offscreen; restriction text may wrap onto its own line.

Allow up to two title lines and three teaser lines at usual text size, with the full name available to assistive technology. About shows the full existing purpose/welcome. Cards stretch to the tallest natural card within a horizontal row or grid row; a flexible body pushes the footer to the bottom. Avoid one hard height for every device or reserving a large empty description block. Larger text may grow the card and use full-width phone carousel cards when needed; do not shrink the user's font to preserve geometry.

Section headings and See all share the page boundaries. Long controls such as See all Technology spaces wrap below the heading on narrow screens instead of pushing beyond the right margin. The carousel's shorter first-card edge is an intentional next-card hint; the heading follows the section edge. Global and full-list cards follow the full section edge.

### Independent controls

Use a non-interactive card container. Artwork/title form a primary launch area; the metadata-row launch icon is a separate equivalent control. About and the checkbox are siblings, avoiding nested buttons/links and accidental launches when saving or reading rules.

Each small icon/checkbox keeps at least a44×44 logical-pixel touch target. Use the existing launch icon. The visual checkbox can be smaller within that target. Green plus a checkmark conveys saved status; color alone is insufficient. Keyboard focus remains visible. Example spoken labels: Open Launch test group, About and rules for Launch test group, and Save Launch test group to Your Spaces with checked/unchecked state. Avoid encoding state only in a glyph or exposing duplicate decorative image labels.

## Interaction Contracts

| Action/state | Result |
| --- | --- |
| Open a space with an outstanding current acknowledgment | Readable introduction/rules, deliberate checkbox and Enter. Preserve the intended space and any existing exact-video Launch intent. |
| Open an already acknowledged/unconfigured space | Existing authorized resume/entry flow; no extra introduction stop solely because the card UI changed. |
| About & Rules, before or after acknowledgment | Always show the current document, with no automatic entry or acknowledgment. Back returns to the originating page/row and its prior position. |
| Explicit Enter from About | Use current authority/reader revision. If acknowledgment is required, retain the existing deliberate checkbox; otherwise enter/resume only after the user's action. |
| Anonymous viewer opens a listed protected space | Existing sign-in entry state; preserve the selected space across sign-in. About uses the existing safe public reader projection. |
| Anonymous viewer presses Save | Existing sign-in path, without showing a green checked state or automatically saving as a side effect. |
| Save succeeds | Mark all visible copies checked by space ID; include it in Your Spaces. A saved item stays visible in public Home/genre/Continue rows. |
| Remove succeeds on Your Spaces | Remove the non-fixed item from that list; move keyboard/reader focus to a nearby item or section/empty state. |
| Remove succeeds elsewhere | Uncheck every visible copy; keep public catalog and Continue entries. |
| Save/Remove fails or its result is uncertain | Keep the last confirmed state, show a useful retry message and reconcile on a fresh read. Do not invent a successful state or change relationships. |
| Rules or access changes while reading | Existing stale-revision/authority response; refresh the document and require a fresh deliberate decision. No read timer or new expiry. |

Use server-confirmed checkbox state for the initial implementation. While a request is pending, disable only that space's checkbox, keep its geometry stable and prevent duplicate toggles. A pending save must not disable unrelated cards or navigate into a feed. Ignore late responses after account/origin replacement, background/closed screens as appropriate; revalidate on return. Refresh chooser/Your Spaces views without resetting every carousel to its first item.

Preserve vertical page scroll, horizontal offsets per Home section and return focus by space ID/control. Prefer mounted-list state and targeted data patches; use the existing web scroll-memory mechanism and add section offsets where needed. Clamp offsets when item removal or resizing makes an old offset invalid. This navigation state remains separate from video checkpoints and durable Continue writes. Opening/closing a rules document from a gallery must not overwrite a video's saved place.

## Phase Status

- A: Complete — reusable cards and measured responsive geometry
- B: Complete — independent launch/About routing including My Space
- C: Complete — server-confirmed per-space saving and duplicate updates
- D: Complete — local/actual-host qualification passes; physical geometry remains in E
- E: Complete — signed build42 and all three focused user phone checks accepted; coverage limits recorded below

## Phase A — Build reusable cards and responsive containers

- Goal: remove content-dependent widths and provide consistent card structure across discovery screens.
- Steps:
  - [x] Extract focused native/web space-card components, with featured/carousel/list variants and explicit open/About/save callbacks. Keep platform rendering separate and share the design/behavior contract.
  - [x] Measure safe container width; apply the sizing table, shared section margins, wrapping headings/See all and the larger-text exception.
  - [x] Replace the title pill with a readable title; add the existing launch icon to the type row and a flexible footer.
  - [x] Preserve generated/custom images, stable image geometry, current descriptions and restriction states.
  - [x] Apply the card to Home, Your Spaces, full Continue, genre pages and the existing native chooser. Preserve the web chooser's compact list and native80% overlay.
- Test gate: rendered/component cases establish fixed width variants and action structure; real browser bounds at narrow/wide phone and tablet/desktop sizes establish equal margins, no content-dependent widths or overflow. Controlled native styles alone are not physical layout proof.
- Acceptance: Global and full lists fill their section; browsing cards have equal widths whether or not they have descriptions. A second real card visibly peeks in phone rows. Within each row, the footer baseline is consistent and text remains usable.

## Phase B — Wire launch and rules review separately

- Goal: provide a direct rules-reading route without changing first-entry or resume semantics.
- Steps:
  - [x] Add native `onAbout(space)` to each discovery route and open `SpaceEntry` with `about:true` using the existing context entry key. Prevent stale route parameters from a previous About or exact-video Launch from affecting a later ordinary open.
  - [x] Web About links use the existing destination's `/about` path. Add `/personal/about` to path parsing, frontend dispatch and server SPA routes; verify direct reload and authenticated owner resolution.
  - [x] Keep primary artwork/title/icon opens on the normal entry path. Reuse server acknowledgment and authority state; do not create a local rules-seen flag.
  - [x] Preserve gallery scroll/focus and current feed checkpoints on Back. Keep rules reading free of player allocations and acceptance writes.
- Test gate: actual native components and browser navigation for before/after acknowledgment, explicit Enter, Back, Global/My Space/group/channel, sign-in return, expired access, stale revision and exact Launch intent preservation. Assert About performs no acceptance/visit mutation just by opening it.
- Acceptance: rules can always be revisited, already acknowledged spaces still resume directly, and saving/reading never triggers launch accidentally.

## Phase C — Replace Save pills with reliable checkboxes

- Goal: make saving compact while keeping one trustworthy saved state across duplicate cards and routes.
- Steps:
  - [x] Implement a controlled semantic checkbox at the footer's lower right; omit it for Global and own My Space.
  - [x] Track per-space pending operations; update all matching card instances including Home recent and every genre. Leave unrelated controls usable.
  - [x] Remove confirmed unsaved items from Your Spaces with sensible focus/empty-state behavior. In other rows, change only the checked state.
  - [x] Refresh data when returning to Your Spaces/changer; retain scroll while applying results. Keep last confirmed state on failure and reconcile uncertain responses.
  - [x] Retain authentication generation and lifecycle checks; keep errors local enough that they do not masquerade as failure to load the entire catalog.
- Test gate: user-facing save/remove success/failure, duplicate instances, rapid presses, delayed responses, account changes and returning chooser state. Use isolated fixtures for API mutations; do not run the Plan184 mutating qualification scripts beside the live discovery API.
- Acceptance: checkbox state matches Your Spaces, every instance of a space agrees, and membership/subscription/Follow/acknowledgment/history do not change.

## Phase D — Integrate and qualify web/native behavior

- Goal: establish layout, navigation and regression evidence before distributing a new build.
- Steps:
  - [x] Extend focused discovery component/rendered tests for the behavior above; avoid implementation-mirroring snapshots or unrelated test expansion.
  - [x] Capture actual web layouts at320/375/390/440 CSS-pixel widths plus tablet/desktop widths, including both sides of column thresholds. Include no/long description, long title, one/multiple cards, empty row, pending/failed save and image failure.
  - [x] Verify native container recalculation in the rendered harness. Physical checks on small/larger phones remain in Phase E; record device limits and do not label a browser viewport as a second phone.
  - [x] Check larger text, wrapped headings, keyboard navigation and checkbox/launch/About labels. Record actual VoiceOver observations separately.
  - [x] Run native unit/rendered suites and typecheck. Build the web bundle; compare frontend typecheck against its existing119-diagnostic baseline with zero new. Run backend build and focused route checks if `/personal/about` server registration changes.
  - [x] Qualify canonical `/`, `/global`, legacy exact-video links, About deep links and saved-state behavior. Verify zero new docs findings against the existing16 baseline, valid local links and whitespace.
- Test gate: targeted behavior/geometry checks first, then the appropriate existing suites once. Preserve Plan184's safe live-smoke/QA-isolation distinction. No rollout-flag or mandatory-enforcement changes are needed.
- Acceptance: no accidental launch/save/acknowledgment; responsive alignment matches this contract; accepted native playback and sign-in behavior remain intact.

## Phase E — Signed preview and phone acceptance

- Goal: review actual iPhone geometry and touch behavior on an installable build.
- Steps:
  - [x] Prepare the next available preview build after implementation gates pass: build42 is produced and verified.
  - [x] Verify matching source/export/archive/downloaded IPA, API URL, signing/device eligibility and OTA policy before sharing the install link. Preserve build41 as the accepted comparison.
  - [x] Check Global margins, consistent Continue/genre widths and next-card hint, aligned footers and comfortable headings/See all on the user's iPhone. Larger text and additional physical devices remain unobserved.
  - [x] Check artwork/title/icon launch, About after acknowledgment, Back restoring browsing position and checkbox saving/removal without launch. First-entry and fixed-utility edge cases retain the controlled test evidence; no broader phone claim.
  - [x] Confirm saved position/manual pause on return, clear playing audio, silent Home/rules/loading covers, smooth within-feed swipes and reporting open/close. Restart Continue remains the accepted build41 observation; no new build42 restart or numeric performance sample is claimed.
  - [x] Record exact observations and remaining device/accessibility limits. Preserve existing fixtures and sign-in; no new content or culture changes are required.
- Acceptance: user confirms the revised card presentation and interactions on the verified signed preview. Host tests and emulated layouts remain distinct from physical phone evidence.

## Files and Ownership

- Native: [DiscoveryScreen](../../mobile/src/discovery/DiscoveryScreen.tsx), [navigator](../../mobile/src/navigation/ViewerNavigator.tsx), [EntryScreen](../../mobile/src/discovery/EntryScreen.tsx), [IconButton](../../mobile/src/ui/IconButton.tsx), [discovery adapter](../../mobile/src/discovery/api.ts). Add focused card/layout helpers beside the discovery screens; avoid growing the navigator or changing global Action styling unnecessarily.
- Web: [Discovery](../../frontend/src/discovery/Discovery.tsx), [CSS](../../frontend/src/discovery/discovery.css), [navigation API](../../frontend/src/discovery/api.ts), [SPA dispatch](../../frontend/src/main.tsx), [saved changer](../../frontend/src/discovery/SavedSpacesPanel.tsx), [server pages](../../src/routes/pages.ts). Add a focused web card component; keep destination and authority logic in the existing discovery layer.
- Verification: [native discovery UI tests](../../mobile/tests/rendered/discovery.test.cjs), [native discovery tests](../../mobile/tests/discovery.test.ts), [browser qualification](../../scripts/check-discovery-web.ts), [live read-only smoke](../../scripts/smoke-discovery-live.ts), plus focused geometry/action checks where needed. Test fixture mutations must remain isolated.
- Documentation: this plan, [implementation index](INDEX.md) and [native roadmap](../roadmaps/roadmap_native_viewing.md). Keep Plan184 acceptance/artwork evidence and its remaining rollout gates intact.

## Open Risks / Deferred

- 84% is a concrete starting point within the agreed80–85% range. Adjust it only if actual review shows insufficient next-card visibility or cramped controls; keep width independent of content.
- A one-item genre row naturally has no next-card hint. It keeps the same sizing rather than pretending additional cards exist.
- Row-height alignment must tolerate text scaling and translated/long names. Readability takes precedence over a rigid card height.
- Mandatory server acknowledgment rollout and authored Global culture/welcome remain Plan184 work. This UI does not enable enforcement or invent culture text.
- Activity, private Messages, Following, real invitation/payment/age fulfillment, universal links and catalog expansion remain separate milestones.
- Plan184 implementation/artwork are still uncommitted. Preserve that working state. The subsequent implementation request authorizes the scoped preview work/build; the user subsequently authorizes commit/push below.

## Validation

- Source inspected in `/home/ubuntu/aws` at HEAD `e56e811`, with uncommitted Plan184 implementation and generated artwork preserved. No applicable ancestor or scoped AGENTS.md was found. No delegation used.
- Planning baseline: `/dev/shm/plan185-docs-before.log` records16 existing documentation findings. Final `/dev/shm/plan185-docs-after.log` retains exactly those16 with zero new; all38 local plan links resolve and `git diff --check` passes. A before/after file-hash comparison confirms only this plan/index/roadmap changed during this planning task; prior product/artwork changes are preserved.
- Planning-only validation ran no product tests. Subsequent execution results are recorded below; build41 establishes predecessor behavior, and build42 focused phone observation is accepted below with limits.

## Change Log

- 2026-10-28 (Pacific) — User approves the card/navigation design and requests a detailed plan. Investigated current web/native sizing, controls, About routes, save synchronization and test infrastructure. Planning only; no product, data, artwork, rollout or build changes.

## Resume Here

The build42 card refinement is complete for the focused internal iPhone milestone. User confirms all three phone-check bundles; A–E Complete with recorded limits. Keep this recent plan through the delivery handoff. No further test/build or product change is needed for these accepted checks. The user authorizes committing and pushing the accumulated Plan184/185 implementation and records. Preserve build41 comparison, earlier fixtures and separate Plan184 editorial/compatibility and Plan183 gates.

## Implementation Record

2026-10-28 (Pacific) — Implementation authorized. Work is isolated in `/home/ubuntu/aws-plan185`, based on the entire current uncommitted primary workspace; initial file hashes protect the accepted Plan184/artwork baseline. No delegation, commit or push.

- Native adds focused `SpaceCard.tsx` and `cardLayout.ts`: explicit safe-container widths,2:1 images, full-width featured/list cards and84% phone carousels; wider-window2/3-column layout and full-width larger-text fallback. Section/header padding is20, gap16. Separate artwork/title, launch, About and semantic save-checkbox controls keep44-point targets. Native chooser retains its80% scrim.
- Discovery retains per-section horizontal and page vertical offsets while privacy masking unmounts hidden content. About return restores reader focus by row plus space identity, including duplicate cards. Save status is announced without adding a shifting row; errors stay with their card. Server-confirmed changes update every visible instance, remove only saved-list membership and keep unrelated checkboxes usable. Late/background responses are reconciled on focus; old identity responses cannot patch current state.
- Web extracts `SpaceCard.tsx`, adds container-query widths and independent semantic controls, targeted duplicate-state updates and removal focus. Layout-effect restoration runs before paint, retains carousel offsets and scopes focus to the actual source row. About uses existing readers; `/personal/about` is added to parsing, SPA dispatch and server pages. No new API/domain/schema, artwork, culture or rollout-flag changes.
- Local verification:255 native unit tests,111 rendered tests, native typecheck and backend build pass; four backend discovery tests pass. Five new card cases cover sizing/action separation, pending/duplicate saves, failure/removal, accepted-document About and background reconciliation. Four focused navigator/entry tests additionally verify card About before/after acknowledgment without player allocation or repeated acceptance, then exact7-second manual-pause return.
- Actual browser checks pass113 assertions over320/375/390/440/639/640/959/960/1024/1280 widths, including breakpoint neighbors, equal margins/widths/footer alignment, no horizontal page overflow, next-card hint,44-pixel targets, server-confirmed checkbox behavior/failure, duplicate updates, About/Back scroll and focus, My Space About reload and first-entry gate. The transport is in-memory and isolated: this is real DOM/layout evidence, not a new API authority test or physical iPhone claim. Evidence: `tests/runs/playwright/plan_185/{cards.json,home-cards.png}`.
- Vite build passes; frontend typecheck retains exactly119 existing diagnostics with zero new after normalized comparison. Build41 remains the physical/audio baseline until new phone observations. Previous Plan183 editorial/expiry UAT remains separate.
- Build42: `d2d31460-8c6b-459c-aabb-afa9c2c55cd0`, source `bbb144a74d9359a283b8a3239793220ef6e70a3e15fc136e0a00189e0d5e453f`;174 public source inputs/175 archive files, matching export/archive, Hermes2,412,147bytes, correct API and zero private inputs. Cloud build finished; downloaded artifact/signing checks pass as recorded below. Focused physical qualification is accepted below; broader device/accessibility limits remain. Source/export evidence is under `tests/runs/build/plan_185/`.


### Verified preview handoff

- Promoted18 qualified source/test/doc files to `/home/ubuntu/aws` after matching the initial primary-workspace hashes. Preserved old hashed web assets, API environment/supervisor and existing sign-in. Only the added backend About route triggered the existing watcher reload. Home/native rollout flags remain enabled; mandatory entry enforcement, publications, cultures, listing, relationships and media are unchanged.
- Actual HTTPS read-only smoke passes32 checks, including equal Global margins,84% travel card width, compact checkbox controls, About/Back without media, `/personal/about`, allowed-Origin/current and legacy APIs, canonical routes and old publication/range/fragment behavior. Local in-memory browser qualification was rerun against the final bundle and still passes113 checks; transport scope is explicit.
- Downloaded build42 verified:0.1.0/42, source `bbb144a74d9359a283b8a3239793220ef6e70a3e15fc136e0a00189e0d5e453f`, correct API/new and retained labels/native module, same registered device/signing namespace as the accepted comparison, unexpired provisioning, get-task-allow false, OTA disabled. IPA8,424,557bytes; SHA256 `23257cd69f20d62271fac5a7746c66977dbe73977a0923032990fbbb05cfd71c`. Native source in the primary workspace matches the verified archive; build41 comparison is preserved.
- [Install build42](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/d2d31460-8c6b-459c-aabb-afa9c2c55cd0). Three focused phone questions were sent for card geometry/heading controls, launch/About/Back/checkbox semantics, and saved pause/position/audio/loading/swipe/reporting preservation. The user subsequently confirms all three bundles, as recorded below. Host checks remain distinct from those qualitative phone observations; a second device, VoiceOver and maximum text-size acceptance remain unobserved.
- Evidence retained locally: `tests/runs/build/plan_185/{source-manifest-build42.json,archive-export-build42.json,artifact-build42.json,build42-meta.json}` and `tests/runs/playwright/plan_185/{cards.json,live-smoke.json,home-cards.png}`. Prior Plan183/184 evidence and fixtures remain intact. No commit/push.


### 2026-10-28 (Pacific) — focused build42 acceptance

The user replies “Yes, all good” to each of the three build42 questions:

- Equal Global side margins; consistent Continue/genre card widths; visible next-card hint when present; aligned footers and comfortable headings/See all controls.
- Artwork/title/launch icon opening the space; About & Rules available after acknowledgment; Back preserving browsing position; the lower-right checkbox turning green, updating Your Spaces and removing an unchecked space without launching it.
- Silent Home/rules reading; saved video position/manual pause on return; clear playing audio; silent loading covers; smooth within-feed swipes; reporting flag open/close.

These observations close E and the focused card milestone. They do not establish another physical phone size, maximum text size, VoiceOver, a new restart/Continue test, denied-access edge cases or numeric playback timing. Earlier controlled tests and build41 restart observations remain separately attributed. No product source, data, flags, fixtures or signing changed in this acceptance-recording turn; no new build/tests or commit/push. Retain the recent completed plan through handoff, consistent with the preceding native milestones. Acceptance evidence: `tests/runs/build/plan_185/phone-acceptance-build42.json`.

### 2026-10-28 (Pacific) — delivery authorization

User requests commit and push of the accepted implementation. Include the outstanding Plan184 foundation/artwork and Plan185 card refinement with their records. Pre-delivery review confirms `main` and `origin/main` share `e56e811`, current public mobile inputs exactly match signed/accepted build42, and the existing validation/phone evidence remains applicable. No additional build or mutating qualification is needed for a Git delivery. Plan184 editorial/compatibility and separate Plan183 gates remain open; generated/private artifacts remain ignored.
