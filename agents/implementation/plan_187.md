# Plan 187: Viewer destinations, Your Groups/Channels and personalized feeds

Status: Complete

## Feature Reference

- Accepted viewer/menu baseline: [Plan186](plan_186.md), signed build43.
- Home, saved spaces, rules entry and durable Continue: [Plan184](plan_184.md).
- Cards, artwork, sizing and independent save/launch/About controls: [Plan185](plan_185.md).
- Existing contextual creator follows: [Plan175](plan_175.md).
- Publication boundaries: [personal space and Global guidance](../features/feature_02_personal-space-global-feed-context-integrity.md).
- Sequence: [native viewing roadmap](../roadmaps/roadmap_native_viewing.md).

## Context and Outcome

The user agrees to these viewer destinations, in this order:

1. Home
2. Following
3. Global
4. Your Creations
5. Your Groups
6. Your Channels
7. Account
8. Settings
9. Sign out when available
10. Playback Diagnostics in internal previews

Your Groups and Your Channels replace the public-facing Your Spaces directory. They contain saved groups and saved channels respectively; Global and the user's own creations have separate destinations. Home remains the discovery landing page and can provide shortcuts to these feeds alongside Continue and genre sections. Groups should read as community centered; channels as creator centered. Shared card behavior remains familiar, with an explicit type label and icon wherever either appears.

This is a native viewer increment plus the shared backend services required for the new aggregate feeds. Following and Your Creations are substantive feed work, not two renamed links. Completion means a functional full menu, correctly filtered saved directories, distinct cards, real aggregate feeds and accepted playback/navigation behavior. An intermediate UI preview does not establish that the aggregate feeds are complete.

Implementation and final build46 acceptance are complete. The user now requests commit and publication to the repository, including accepted Plan186 work carried forward in this milestone. Preserve the verified build/source and recorded qualification limits.

## Source Audit

| Area | Evidence and implication |
| --- | --- |
| [ViewerMenu](../../mobile/src/navigation/ViewerMenu.tsx), [navigator](../../mobile/src/navigation/ViewerNavigator.tsx), [menu helpers](../../mobile/src/navigation/menuNavigation.ts) | Build43 provides a shared menu, current-page state, origin/generation/feed-key guards, transient workflow cleanup and safe Menu Close. Its primary destinations are Home/Your Spaces/Account. Reuse these contracts while expanding destination identity. A single Feed route currently cannot distinguish Global from an aggregate or the owner's creations for menu selection. |
| [DiscoveryScreen](../../mobile/src/discovery/DiscoveryScreen.tsx), [discovery API adapter](../../mobile/src/discovery/api.ts) | Saved mode fetches one combined directory, then renders fixed Global/personal cards and saved items. Its More handler currently assumes a genre-directory request. Add typed saved modes and correct endpoint-specific pagination; changing headings or filtering one downloaded page is insufficient. |
| [discovery service](../../src/features/discovery/service.ts), [router](../../src/features/discovery/router.ts), [schema](../../src/features/discovery/schema.ts) | `saved()` migrates legacy saves once, keeps explicit removals, reads at most200 saved rows before access filtering, and returns fixed Global/personal cards separately. `directory()` already has a group/channel filter, but that is the public catalog, not the user's saved list. Add typed saved queries without replacing them with membership/catalog queries or breaking existing clients. |
| [SpaceCard](../../mobile/src/discovery/SpaceCard.tsx), [card layout](../../mobile/src/discovery/cardLayout.ts), [feed header](../../mobile/src/ui/FeedHeader.tsx) | Cards already have Group/Channel text, independent launch/About/save controls and accepted widths. Existing group/channel/personal icon assets are available. Add consistent type identity using this family; preserve themed artwork and green saved-state meaning. |
| [creator-follow repository](../../src/features/follows/repo.ts), [follow access](../../src/features/follows/access.ts), [Global recognition](../../src/features/follows/globalRecognition.ts) | Follows are `(follower, creator, space)` tuples, limited by the native flow to ordinary groups/channels. Global yellow recognition means the viewer follows that creator somewhere; it does not define a creator-wide subscription. No combined Following feed/ranking service was found in the inspected native/web feed paths. |
| [space service](../../src/features/spaces/service.ts), [profile projection](../../src/features/profiles/viewer.ts), [publication repository](../../src/features/publications/repo.ts) | The existing personal space is an actual publication space owned by a user. A video published only in Group A need not appear there. Relabeling `/personal` as all Your Creations would omit legitimate creations. Current viewer creator attribution comes from the upload's user; use the canonical attribution rather than space ownership or moderation permissions. |
| [feed selection](../../src/features/feeds/repo.ts), [viewer serialization](../../src/features/feeds/viewer.ts), [viewer router](../../src/routes/viewer.ts) | Feed queries and actions assume Global or one concrete space. Publication IDs, stories, reports and interaction state belong to those actual publications. Global requires its own explicit publication. Aggregate selection must reapply existing publication visibility/access and serialize a safe projection. |
| [native feed context](../../mobile/src/feed/context.ts), [feed API](../../mobile/src/api/feed.ts), [feed loading](../../mobile/src/feed/useViewerFeed.ts), [FeedScreen](../../mobile/src/feed/FeedScreen.tsx) | Feed context is currently Global or one space. Text, reporting, engagement, Follow, eligibility and control geometry branch on that context. Aggregate playback needs separate destination identity and per-item source identity throughout these paths. |
| [access proofs](../../mobile/src/auth/accessProof.ts), [access manager](../../mobile/src/auth/accessManager.ts), [server confirmations](../../src/features/native-sessions/access.ts) | Existing page proofs describe one space or public Global. A mixed page cannot safely be stamped as public or assigned one space lease. Add bounded, per-source confirmations and independent aggregate eligibility checks. |
| [checkpoints](../../mobile/src/navigation/feedCheckpoints.ts), [durable writer](../../mobile/src/discovery/resumeWriter.ts), [discovery schema](../../src/features/discovery/schema.ts) | In-memory keys are Global/space IDs; durable Continue is keyed by user/space with90-day retention and revision checks. Following/Your Creations need their own keys and durable records, not fake spaces or overwriting a source space's checkpoint. |

Home's current server response contains Global, recent spaces and genres. A fixed Your Creations/Following shortcut on Home requires an explicit destination projection; do not assume that a personal shortcut already exists in that response.

## Agreed UX and Proposed Data Semantics

### Agreed

- Labels/order above; Home continues as discovery, Global remains its own explicit publication feed.
- Your Groups/Your Channels replace the combined saved directory and exclude fixed Global/personal shortcuts.
- Keep Global/own-content access available from Home as well as the menu; add Following when functional.
- Use separate directories plus clear Group/Channel design cues on mixed Home/Continue/genre cards.
- Your Creations means the user's work; Following means content from followed creators combined into a personalized feed.
- Preserve build43's menu behavior, form/reader returns and accepted media behavior.

### Confirmed data scope

The user answered both scope questions during planning. These decisions are now part of the implementation contract:

1. **Your Creations:** all currently published creations by the signed-in user across accessible publication contexts. The first viewer version excludes drafts, rejected/scheduled/unpublished work and upload/edit/delete/publish controls. The existing personal-space URL and creator-profile personal-space entry retain their original meaning.
2. **Following:** combine the existing space-specific follow streams. Following a creator in Group A includes that creator's eligible Group A publications, not their Group B publications or personal space. Global recognition alone adds nothing to Following. Do not reinterpret or bulk-promote contextual follows into creator-wide subscriptions.

The user's request mentions prioritization along several axes but does not specify them. Recommend an explainable first ranking version based on freshness and creator variety, with stable pagination. Interest profiles, behavioral scoring, unseen/re-watch weighting, explicit creator priorities and user-adjustable controls are later extensions unless separately chosen. Do not claim those signals exist or collect new behavioral data implicitly.

No blocking data-scope question remains. Phase A translates these confirmed choices into compatible contracts. The ranking-v1 proposal remains visible for review; routine implementation details can follow the accepted plan without another blanket approval step.

## Destination and Interaction Contract

| Destination/control | Behavior |
| --- | --- |
| Home | Discovery landing page. Preserve featured Global, themed cards, Continue/genres and About & Rules. Add distinct shortcuts for ready Following/Your Creations, with sign-in handling where required. Aggregate shortcuts are destinations, not synthetic `SpaceCard` publications. |
| Following | Authenticated aggregate viewing. Start/resume its own selected video/time/pause. Empty state explains following creators within groups/channels and links to Home. Do not silently substitute Global. |
| Global | Direct feed destination through the same current entry/rules/resume path used by Home. Selecting it while already in Global closes Menu and preserves the selected video/time/pause. Opening Global from elsewhere restores Global's checkpoint. |
| Your Creations | Authenticated own-published-video viewing under the resolved scope. Give an accurate empty state. Selecting it again preserves its own place. No creator studio/editing controls in this viewer increment. |
| Your Groups | Saved, currently accessible ordinary groups only. Empty state: “Save groups for quick access,” with a Home discovery action. No Global, personal, Following or channel cards. |
| Your Channels | Saved, currently accessible ordinary channels only, explicitly excluding Global even though its stored type is channel. Equivalent channel-specific empty state. |
| Account/Settings/Sign out | Retain build43 behavior, account status/busy/error handling and cancellation. Settings remains navigator owned. Sign out clears private feed/directory/session/checkpoint state. |
| Contextual actions | About & Rules and Refresh remain available for relevant sources. An aggregate menu offers “About & Rules for [source]” only for the actual selected, verified publication; Refresh refreshes the aggregate destination. Public Home/directory menus cannot operate on a hidden prior feed. |
| Diagnostics | Keep Playback Diagnostics and applicable readiness tools internal-preview-only. Readiness remains attached to supported Global probes; no invented aggregate readiness qualification. |
| Feed space selector | Keep a single coherent chooser entry point, reusing destination selection. Its collection portion becomes Groups/Channels sections or tabs; retain a unified in-feed chooser rather than leaving a second, contradictory Your Spaces directory. Include direct destinations only when their services are ready. |

Keep one vertically scrollable menu with visually separated viewing, saved collections and account/settings sections. Use existing44-point controls, current selection semantics and safe insets. Workflow Back/Close/Done remain distinct from global navigation. The Menu itself has Close and no recursive hamburger.

## Cards, Saved State and Naming

- Keep one card component and accepted width rules: equal featured Global margins, consistent carousel widths/peek, responsive directory grids and aligned controls. Reuse current themed artwork.
- Group cards: existing people/community icon plus the visible word Group. Channel cards: existing channel/broadcast icon plus Channel. Apply on Home, Continue, genre results and saved directories, including mixed sections.
- The type indicator is informational; artwork/title/launch open the space, About & Rules opens its document even after acknowledgment, and the checkbox only saves/removes. Preserve44-point targets and text scaling. Do not introduce a second meaning for green/yellow Follow or saved-state colors.
- Use type-specific accessibility labels and feedback, e.g. “Save Launch test group to Your Groups,” “Removed Launch test channel from Your Channels.” Report confirmed state only; keep duplicate cards synchronized, pending writes disabled and failure/retry behavior explicit.
- Saving/removing is independent of joining/leaving, subscribing, following/unfollowing a creator and visiting a feed. Existing tombstones and one-time migration remain authoritative.
- Internal route/type identifiers can retain compatible legacy names where needed. Public navigation and feedback use the new agreed labels. Other creators' personal spaces retain their actual names; do not label another creator's space Your Creations.

## Backend and Data Design

### Typed saved directories

Extend the existing authenticated `GET /api/viewer/v1/discovery/saved` contract with optional `type=group|channel`, bounded `limit` and cursor parameters. Preserve the legacy unfiltered response, including fixed fields, for build43 and web callers that send no new parameters.

For typed requests:

- Filter user save state, concrete type, Global exclusion and current access before determining the returned page. Filtering only the existing first200 rows on the client can incorrectly produce an empty group/channel page.
- Use stable saved-update-time/ID ordering, bounded queries and a cursor scoped to the requested type. Validate all parameters and reject mismatched/malformed cursors.
- Scan denied/removed rows in bounded batches so they do not create a false end-of-list; return the next scan cursor when more candidates remain. Never expose denied names/artwork just to fill a page.
- Return the saved-directory envelope with `items` and `nextCursor`; omit fixed destinations from typed lists. Existing unfiltered semantics stay compatible.
- Reuse explicit saves/migration; no group/channel conversion or save migration is necessary for splitting the UI. Add an index only if the measured query plan warrants it.

### Aggregate feeds are viewing destinations

Introduce a destination model covering Global, a concrete space, Following and Your Creations. Separately model each video's **source publication context** as Global or a concrete personal/group/channel space. Do not add Following/Your Creations rows to `spaces`, fake space IDs, or copy publications.

An aggregate item contains the existing safe video projection plus verified source metadata sufficient for source name/type, exact publication identity and routing. Server-side identity/eligibility records must bind user, feed kind, source context, publication, creator and production. Do not return raw publication database rows, owner email, private moderation data or unauthorized alternate contexts.

Suggested additive routes, finalized with existing route conventions in A:

- `GET /api/viewer/v1/feed/creations`
- `GET /api/viewer/v1/feed/following`
- Authenticated aggregate selection/eligibility renewal using the same destination, source/publication and session identity.
- `GET /api/viewer/v1/me/feed-checkpoints/:kind` and a desired-state checkpoint write for `creations|following`, with revision checks.

Existing story/caption/report/engagement/Follow routes continue receiving the **real source context and publication ID**. Following is not a reporting/moderation space. A Group A report stays attributed to Group A; the same production's Global report stays separate. Global items retain Global's existing interaction restrictions.

### Your Creations selection

Under the confirmed all-published scope:

- Query canonical creator identity matching the signed-in user, published/visible completed media and real accessible publication contexts. Owning a group, requesting publication or holding moderator permissions does not make somebody else's video a creation by this user.
- Apply the same source visibility, bans, membership/subscription and current availability checks as normal viewer feeds. Ownership does not grant implicit distribution or expose hidden media through this route.
- Group multiple eligible publications of the same production into one creation in the viewer, with a deterministic default source and an explicit “Published in”/source action to enter other eligible publication contexts. Recommend the user's personal publication when available, otherwise the most recently published eligible context, with ID tie-breaking.
- Group by canonical production identity; when unavailable, retain separate publication rows. Do not deduplicate by URL, title or upload ID without a guaranteed identity relationship.
- Show only eligible alternate contexts; never hint at a hidden space by its name/count. Opening an alternate uses ordinary source entry and the exact publication. Reports/story/interaction state always come from the currently chosen publication.
- Sort creations by their most recent eligible publication timestamp and a stable creation/publication tie-breaker. Resume pins the same chosen publication, not a newly preferred context.

### Following eligibility and ranking v1

Under the confirmed contextual-follow scope:

1. Select publications only where a matching creator/space follow tuple exists for the current viewer.
2. Reuse normal source access and publication eligibility. A follow, save, feed snapshot or known media URL is not access authority.
3. Omit deleted/unpublished/inaccessible publications and gated sources whose currently required introduction/rules have not been acknowledged. Provide an authorized “Review space rules” route for those sources; never auto-acknowledge them or autoplay gated media. After deliberate acknowledgment, return to Following and refresh eligibility without rewriting its checkpoint as the source space's checkpoint.
4. Deduplicate eligible productions with deterministic source selection, retaining one exact chosen publication and its source. If the chosen source later disappears, do not silently replace its story/report/interaction context with a different publication.
5. Rank using an explicit versioned policy. Proposed v1: recent24-hour, recent7-day and older buckets; within each bucket interleave creator streams ordered by publication time/ID, with stable creator tie-breaking. This combines freshness and creator variety using available data. Bucket definitions are tunable implementation policy, not claimed user preferences.
6. Freeze the ordered IDs for a bounded authenticated feed session. New posts/re-ranking appear on deliberate Refresh or a new session; scrolling does not reshuffle already selected items. Cursor/session identity is user/feed/rank-version bound and opaque or integrity protected. Define bounded candidate scanning, session size, TTL, expiry/restart behavior and server-side cleanup before implementation; initial targets are20 items/page, at most500 queued candidates and a24-hour session lifetime, verified against actual query plans.
7. Recheck access, source rules and follow eligibility on page serialization and selected-item renewal. Session membership is never a permission lease. Backfill filtered page gaps within explicit scan limits and preserve honest cursor/end state.
8. An unfollow performed in this app invalidates the corresponding Following candidates immediately. Cross-device changes are discovered through bounded renewal/Refresh. Stop/mask a selected item that becomes ineligible; offer an eligible next item or empty state without replaying stale media.

This version deliberately has no fabricated interest/quality score. Further axes require a specified signal, an owned storage/lifetime model, ranking tests and a clear product explanation. Creator-wide following would be a separate future relationship change, outside this plan.

### Access confirmations and context-sensitive actions

Do not simply widen the current FeedContext union and reuse the old one-space proof parser unchanged. Introduce a mixed-page confirmation envelope or per-source confirmations that legacy clients cannot misinterpret. Bind each video proof to its real source and media identity, the authenticated request start/epoch, existing identity bounds and source/publication expiry. Bound the number of sources/publications and reject duplicate/conflicting proof rows.

Aggregate eligibility (authorship or follow membership) is separate from source playback authority. The selected item must satisfy both before reveal/playback; expiry, background, account/API change and denial retain current mask/mute behavior. Reuse the current short renewal/expiry discipline rather than keeping authority alive for the session TTL.

Audit header labels, story/captions, Report, Likes/Comments, creator profile, Follow/recognition, Launch, About & Rules, refresh and playback-access calls. Every action derives from the actual selected item's source. A mixed feed's current source must not be inferred from the last visited space or a stale preloaded neighbor.

### Checkpoints, Continue and media ownership

- Keep bounded in-memory destination keys for `following` and `creations`, owned by API/account generation. Add separate authenticated durable checkpoint storage keyed by user/feed kind. Store only source context, publication/production identity, position, paused state and revision/timestamps; follow existing90-day retention, sparse writes and conflict handling.
- Resume the same chosen publication and pause/time before revealing. If the ranked session expired, revalidate that anchor and build a fresh continuation around it. A deleted/unfollowed/denied anchor produces an honest unavailable result and a deliberate fresh-start action. Do not report exact restore after substituting another publication.
- Keep normal source-space checkpoints separate. Viewing Group A through Following does not overwrite where the user left the actual Group A channel. Entering Group A explicitly uses ordinary source checkpoint/entry behavior, with an exact-video action explicitly taking precedence when requested.
- Extend Home Continue with typed aggregate destination records/cards if included in this milestone. Keep legacy space records and API consumers compatible; do not insert aggregate rows into the existing user/space recent table. Clearing viewing history clears both kinds in the new client's operation while preserving its current privacy contract.
- Crossing destinations uses scalar checkpoints, releases the old player pool and shows the accepted opaque full-picture loading cover. Within either aggregate, reuse the bounded3-player window across source contexts; each preloaded item must have its own valid authority and no hidden audio. Source-context changes within an aggregate do not create an accumulating pool per space.
- Retain accepted width/crop, floating header,64-point plus safe-inset black reserve and control spacing. Following keeps a compact visible source-space label/action so its current culture/reporting context is legible. Your Creations uses Published in, with separate video and About & Rules actions for each actual publication place; it has no separate Source pill. Internal selected-publication identity remains explicit.

## Delivery Sequence and Phase Status

- A: Complete — confirmed semantics, compatible contracts and accepted working-tree baseline preserved.
- B: Complete — typed saved directories, card identity and source-aware navigation.
- C: Complete — independent aggregate/source authority, bounded sessions and durable checkpoints.
- D: Complete — published own creations with real publication-context selection.
- E: Complete — contextual follows, freshness/creator variety and eligibility renewal.
- F: Complete — host/native integration, isolated SQL/API and regressions pass; focused phone behavior accepted with the recorded limits.
- G: Complete — build46 source/export/archive/downloaded signing and guarded promotion verified; build45 menu/directory bundle and all three final build46 phone bundles accepted. Recorded coverage limits remain explicit.

B is the smaller UI/backend increment. C–E are the larger feed work. A limited B preview may be useful, but the complete agreed menu is released only when its corresponding services are functional. Use explicit additive capabilities/default-off rollout controls for new clients; build43 and web retain their existing unfiltered saved lists and feed contracts. Do not expose a nonfunctional Following link or map it to Personal/Global.

### Phase A — Resolve contracts and protect the accepted baseline

- [x] Carry forward the confirmed all-published-creations and combined space-specific-follows decisions. Finalize deterministic Your Creations source selection and the documented ranking-v1 policy in the implementation contract; do not expand to creator-wide follows.
- [x] Define destination versus source identity, menu current-page/no-op rules and authenticated/anonymous/unavailable behavior. Required private destinations keep their labels and lead to a sign-in explanation; sign-in never replays a report/write or enters an old-account private feed automatically.
- [x] Specify typed saved query/cursor, aggregate response/proof/version, selected renewal, session expiry, checkpoint/recent contracts and empty/revoked/error UI. Define rules-review return from an aggregate and alternate-publication navigation.
- [x] Capture accepted build43 source `df73de7b253024e3bb8e19771c6d950fbe048f533d43a6d05834ae4abc121834` and current primary bytes. Git HEAD is `29c9764`; the accepted26-file build43 implementation is still uncommitted. An implementation worktree must include that accepted working-tree baseline, not start from bare HEAD and lose it. Keep guarded promotion and preserve prior artifacts.
- [x] Identify supporting indexes/schema/capabilities and fixture isolation. Use additive changes, defaults off and old-client compatibility; do not broaden public catalog listing or mandatory entry rollout.
- Test gate: table-driven concrete examples for Group A-only follow, same creator in Group B, own work outside personal, multi-publication Global/local production, removed save, source denial, rules revision and expired resume.
- Acceptance: no ambiguity between a user's work, their personal publication space and the followed aggregate; contracts preserve explicit publication boundaries.

### Phase B — Saved collections, card identity and menu routing

- [x] Implement compatible server-side saved type filtering/pagination, including Global exclusion and current access.
- [x] Add YourGroups/YourChannels native routes/modes, correct pagination loaders, separate scroll/focus state, type-specific save labels and empty states.
- [x] Update shared menu grouping/order and current destination identity; route Global through existing entry/resume. Preserve Close/current-page no-op, stale-origin checks, modal cleanup and Account/report/comment draft behavior.
- [x] Update the feed chooser's collection sections and all user-facing references that actually mean the saved directory; retain legacy internal routes/fallbacks where required. Replace the old Your Spaces public destination without leaving a dead navigation path.
- [x] Add consistent existing-family Group/Channel icons plus visible type labels on all cards, maintaining accepted artwork/widths/control layout and independent checkbox/About actions.
- Test gate: server tests for invalid type/cursor/auth and old unfiltered callers; type filtering before pagination/scan caps; mixed/tombstoned/denied rows; group/channel save/remove synchronization; no fixed cards; route/current-page/return behavior across Home/Account/Settings/Feed/forms.
- Acceptance: separate accurate saved directories and clear mixed-card types, with no relationship migration, hidden-space leaks or playback regression.

### Phase C — Aggregate feed infrastructure

- [x] Add additive destination/item-source contracts, strict adapters, bounded session/cursor and per-source confirmation parsing/renewal.
- [x] Add independent eligibility checks and authorization-composed candidate selection. Reuse the existing serializer and source services; validate at both selection and renewed playback boundaries.
- [x] Add bounded scalar aggregate checkpoint/recent storage, CAS writes, retention/cleanup and account isolation. Keep existing source-space resume untouched.
- [x] Generalize player/data ownership and action routing around destination plus selected source, preserving the3-player maximum across mixed sources.
- [x] Add feature capabilities that old native/web clients ignore safely. Keep new services unavailable until qualified; no change to current session/login semantics or platform/age rollout policy.
- Test gate: malicious source/proof mismatches, old identity/epoch, duplicate rows, expired/denied source, rules change, cursor replay across users/kinds, cleanup, stale renewal, account replacement, destination/source checkpoint separation and aggregate session expiry.
- Acceptance: safe mixed-source playback is possible without synthetic spaces or inherited permissions.

### Phase D — Your Creations

- [x] Implement the confirmed all-published-creations aggregate: select canonical own published work, apply source authorization, deduplicate canonical productions and return deterministic source/alternate-publication metadata.
- [x] Add real native viewing, empty/error/sign-in states, source identity, exact-context actions and independent restore. Keep creator-profile personal-space navigation unchanged.
- [x] Show Home/menu shortcut only when the corresponding implementation is available. Add accurate page text explaining the published-work scope.
- Test gate: own group-only work appears; somebody else's work in an owned group does not; drafts/unpublished/denied items do not leak; multiple publications yield one creation with correct context; source-specific reports/metadata and unavailable-anchor behavior.
- Acceptance: Your Creations faithfully represents its agreed scope and preserves each publication's rules/interaction identity.

### Phase E — Following

- [x] Combine existing space-specific follows: select only matching creator/space streams and eligible acknowledged source publications.
- [x] Add versioned freshness/creator-variety ranking, deterministic deduplication, stable bounded sessions/pagination and explicit Refresh behavior.
- [x] Add immediate local unfollow invalidation, cross-device renewal, gated-source review, honest no-follows/no-eligible-items/loading/offline/expired-session states and no automatic Global fallback.
- [x] Add selected-item source actions and source-specific interaction controls; preserve same-publication report/Sent identity.
- Test gate: creator followed in A but not B, same creator in multiple followed spaces, unfollow while covered, stale snapshot, denied/expired subscription, changed rules, no eligible data, multi-page no duplicates/reshuffle, same timestamps, prolific creator diversity and removed resume anchor. Verify bounded query counts/query plans at realistic follow/candidate sizes.
- Acceptance: a genuinely combined, ranked Following feed with explainable ordering, accurate current source and current eligibility.

### Phase F — Full native integration and compatibility qualification

- [x] Integrate the exact final menu, Home shortcuts, typed Continue if included, feed chooser and return stack across all real destinations. Check anonymous, unavailable saved session and account replacement.
- [x] Extend actual-component tests for edited Account/report/comment state through Menu, source-specific About/Refresh, current Global/Following/Your Creations no-op and route reuse without abandoned modals.
- [x] Verify host near7s paused/playing aggregate returns, session/anchor behavior and exact-publication entry; retain baseline captions/story/Follow/report/comment regressions. Final phone answers confirm position and pause/playing restoration including reopening, source rules/report navigation, clear audio, silent covers/readers/menu and smooth swipes. Physical numeric position error, session-expiry exercise, new report submission and every baseline control were not separately reported in this phone bundle.
- [x] Run appropriate backend/API, native unit/rendered/typecheck, SQL/index/schema compatibility and old-client response checks. Current accepted native baseline is255 unit/115 rendered; new counts depend on meaningful added cases. Backend build must pass. Do not rebuild/deploy web solely for native UI changes; validate representative unchanged web API contracts.
- [x] Run controlled narrow/wide/enlarged-text layouts and keyboard/scroll/focus checks. Distinguish host structural evidence from native pixels, audio and VoiceOver observations.
- [x] Use isolated fixtures/database for mutating qualification. Existing discovery isolation scripts must not run against the live development API/database beside port3300. Preserve user sessions, accepted test publications, cultures and preview listings; record any separately authorized fixture changes.
- [x] Compare docs/local links/whitespace with the existing16-finding baseline and audit product diff/source identity before promotion.
- Acceptance: complete functional menu and aggregate feeds, bounded media/resources, backward-compatible APIs and no regression to accepted build43 flows.

### Phase G — Signed delivery and focused device acceptance

- [x] Prepare the next available internal preview only after relevant gates. Build44 was superseded before phone sharing; build45 contains the final bounded review footer, access masks and saved-pagination cancellation fixes.
- [x] Verify exact public source manifest, export/upload archive, downloaded IPA/API/native modules, accepted-device provisioning/signing and OTA policy before sharing the install link. Preserve build43 evidence.
- [x] Phone bundle1: menu order/current-state/no-op/Back; Your Groups/Channels contents; type cues, Home controls, independent saving and rules/About.
- [x] Phone bundle2: user confirms build46 Your Creations has Published in without Source, each place has its own About & Rules, Back returns to the list and its title opens that exact video. User also confirms Following combines existing contextual follows, has the correct source label and opens that place’s rules and selected video’s Report. Scope/dedup/ranking, local unfollow, denial and report attribution also retain host/API evidence; no new report submission or empty-feed phone observation was requested/reported.
- [x] Phone bundle3: user confirms position and pause/playing state after rules/Published in visits, destination switches and app reopening, with clear playing audio, silent rules/menu/loading and smooth within-feed swipes. Host near7s restoration and prior accepted geometry/forms/Settings coverage remain separate evidence; no new numerical performance or physical geometry measurement is inferred.
- [x] Record observed accessibility/text-size/device/performance limits explicitly. Do not infer VoiceOver, other-device coverage or numerical performance from a qualitative “all good.”
- [x] Update plan/index/roadmap and leave implementation reviewable. Commit/push only when requested.
- Acceptance: explicit user acceptance of the full agreed increment, with partial previews and deferred ranking axes clearly separated.

## Files and Ownership

- Native navigation: [ViewerMenu](../../mobile/src/navigation/ViewerMenu.tsx), [ViewerNavigator](../../mobile/src/navigation/ViewerNavigator.tsx), [menu destination helpers](../../mobile/src/navigation/menuNavigation.ts), [ViewerHeader](../../mobile/src/ui/ViewerHeader.tsx).
- Collections/cards: [DiscoveryScreen](../../mobile/src/discovery/DiscoveryScreen.tsx), [SpaceCard](../../mobile/src/discovery/SpaceCard.tsx), [discovery adapters](../../mobile/src/discovery/api.ts), [card sizing](../../mobile/src/discovery/cardLayout.ts), [legacy chooser](../../mobile/src/spaces/SpacesScreen.tsx).
- Aggregate/native boundary: [feed context](../../mobile/src/feed/context.ts), [feed types](../../mobile/src/feed/types.ts), [API selection](../../mobile/src/api/feed.ts), [adaptation](../../mobile/src/feed/adaptFeed.ts), [feed loading](../../mobile/src/feed/useViewerFeed.ts), [FeedScreen](../../mobile/src/feed/FeedScreen.tsx), [FeedCard](../../mobile/src/feed/FeedCard.tsx), [access parser](../../mobile/src/auth/accessProof.ts), [access manager](../../mobile/src/auth/accessManager.ts), [checkpoints](../../mobile/src/navigation/feedCheckpoints.ts), [resume writer](../../mobile/src/discovery/resumeWriter.ts). Add focused aggregate modules beside these; keep selection/ranking logic out of the navigator.
- Backend: [viewer router](../../src/routes/viewer.ts), [discovery router](../../src/features/discovery/router.ts), [discovery service](../../src/features/discovery/service.ts), [discovery schema](../../src/features/discovery/schema.ts), [feed repository](../../src/features/feeds/repo.ts), [serialization](../../src/features/feeds/viewer.ts), [access confirmations](../../src/features/native-sessions/access.ts), [contextual follows](../../src/features/follows/repo.ts), [follow access](../../src/features/follows/access.ts). Add dedicated aggregate selection/ranking/checkpoint modules with explicit dependencies.
- Verification: [native test commands](../../mobile/package.json), [actual menu navigation tests](../../mobile/tests/rendered/menu-navigation.test.cjs), [discovery tests](../../mobile/tests/rendered/discovery.test.cjs), [card tests](../../mobile/tests/rendered/spaceCards.test.cjs), [reporting tests](../../mobile/tests/rendered/reporting.test.cjs), [Follow tests](../../mobile/tests/rendered/follow.test.cjs), [Launch/geometry tests](../../mobile/tests/rendered/launch.test.cjs), [discovery server checks](../../scripts/check-discovery.ts). Add meaningful aggregate-service/contract/access/ranking cases and actual mixed-feed navigator cases.
- Records: this plan, [index](INDEX.md), [roadmap](../roadmaps/roadmap_native_viewing.md). Do not rewrite accepted prior milestone evidence.

## Open Risks / Deferred

- Data scope is confirmed: all published creations across eligible contexts, and existing space-specific follow streams. Preserve that boundary throughout selection, source labeling and resume; personal-space publishing semantics are unchanged.
- Ranking axes beyond proposed freshness/creator variety require separate signal/product choices. No new behavioral tracking, learned ranking, notification system or recommendation expansion is assumed.
- Source-context visibility, mixed authority, per-context rules and cursor stability are the main technical risks. Publication grouping must never merge reports or silently change the selected context on resume.
- Your Creations is viewer access to published work; a creation library containing drafts and publishing/editing/moderation tools remains separate.
- Web menu/page redesign, new browser `/following`/creations URLs, native moderation, age assurance/adult distribution, membership/payment changes, inbox/private messages and notification aggregation remain separate work. Keep `/`, `/global`, `/personal` and existing group/channel URLs intact.
- The prior Plan184 mandatory-enforcement editorial/compatibility gates stay open; this plan does not authorize enabling them globally.
- Retain build43's uncommitted accepted implementation; no commit/push is implied by planning or future implementation authorization.

## Implementation Record — 2026-10-29 (Pacific)

- Added [aggregate selection and source validation](../../src/features/aggregate-feeds/service.ts), [ranking/session model](../../src/features/aggregate-feeds/model.ts) and [authenticated feed/checkpoint routes](../../src/features/aggregate-feeds/router.ts). Existing concrete Global/space feeds, `/personal`, web URLs and unfiltered saved-list responses remain compatible. Source publication IDs are now passed through both feed service layers to their repository filters.
- Saved directories filter type and Global before pagination, use timestamp/ID keysets, honor removals, and scan denied rows in bounded batches. The native chooser cancels pending More reads across tab/focus/account changes and merges responses against current saved state; tests cover removal during More and Group results arriving after switching to Channels.
- Following uses exact existing creator/space tuples; Your Creations uses canonical uploader identity and published completed media. Production dedup retains a chosen publication, with an independent Published in action for eligible alternatives. Source story, reports, engagement, Follow and rules derive from that chosen publication.
- Native destination identity is separate from selected source identity. Strict source proofs and aggregate membership must both be valid. [Aggregate renewal](../../mobile/src/auth/useAggregateAccess.ts) verifies a selected/neighbor window of at most3; expiry, local unfollow, covered returns and account/API replacement mask playback. No aggregate masquerades as a public Global proof or one space lease.
- Added independent Following/Creations scalar checkpoints, source identity, revision-conflict checks and90-day logical retention, with Home Continue and history clearing. Fresh destination entries release the old player pool; source changes within one aggregate reuse the bounded3-player window. Backgrounded entry requests cannot navigate on a late response. Unavailable anchors require an explicit fresh start.
- Added native Home destination tiles, split Your Groups/Your Channels, chooser tabs, type icons/labels, source About & Rules and Published in. Existing menu workflow restoration, feed framing and bottom reserve are retained. Long rules-review queues use bounded scroll areas in both empty and end-of-feed states.
- Qualification mutates only a disposable loopback MariaDB copy. No live fixture membership, follows, reports, publications, cultures, catalog listing or sessions were changed. The only intended live rollout mutation is the additive `native_destinations` capability after qualified source promotion; it defaults off. Plan184's separate mandatory entry/editorial rollout gates remain unchanged.

### Your Creations UI revision — build46

- The user accepts build45's menu/saved-directory bundle. The Your Creations observation confirms the existing Source pill shows the selected personal publication space named Admin; it is not a creator-wide rules document. The user approves simplifying that UI. Following and playback acceptance was initially outstanding; both are now confirmed in the final build46 replies below.
- Removed only the separate Source pill from Your Creations. Following retains its selected publishing-space/About & Rules control. Your Creations keeps Published in, with each actual publication place grouped alongside its own About & Rules action.
- The place title still opens the exact video there. About & Rules opens the same existing space document without auto-entering; Back returns to Published in. Deliberate Enter space from that document retains the exact publication target. Navigation explicitly supplies the current About/entry mode and target, clearing stale Launch/profile/aggregate-review parameters.
- Reading rules keeps the underlying video covered and silent, preserving its playback intent/time. No backend selection, publication attribution, access policy, rules, fixtures, flags or database records changed for this revision.
- Actual navigator coverage reads personal/group/Global rules, returns through Menu/Back without allocating players, opens the exact alternate Global publication and restores the playing creation at7s. Existing paused returns and Following's source/report checks remain in the suite. Build46 native typecheck, targeted9-case destination suite and full125-case rendered suite pass. Source/export/archive qualification passes:180 public inputs,181 archive files,2458781-byte Hermes export, source `e48138e0cf580d43436e55e3bb84bf26cbc3da0ef038cad076fb03077153e3ba`. Guarded promotion of10 native/test/record files preserves the1304-file primary baseline outside this revision, and primary public source matches46. No backend/database/rollout change; config/Global HTTPS reads still return200. Downloaded [build46](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/5b87b4ca-293f-4c61-bf60-b138d1ba143d) verified:8447270-byte IPA,2458861-byte embedded bundle, exact46 source/API/new UI markers, existing native readiness/presentation module, same accepted single-device/team provisioning, `get-task-allow=false` and OTA disabled. IPA SHA256 `c5181c1ee4150148719b55bc93d10302d3b80d0acc55dff641040bd401046a83`. All three focused build46 phone bundles are accepted as recorded below. Unchanged unit261/service20/SQL66 results are retained from build45; backend qualification was not rerun for this native-only revision.

### Explicit implementation bounds

- Ranking is `freshness-variety-v1`:24-hour/7-day/older buckets with creator interleaving. No interest/quality/behavioral score is inferred. Candidate scans use500-row windows,4 source groups concurrently,100 IDs per concrete-source query, at most10000 seen productions and100 rules-review sources per session.
- Sessions are process-local, capped at256 with24-hour TTL. A restart/eviction or a cursor older than the retained current/previous500-candidate windows returns an expiry; deliberate Refresh/entry reconstructs the feed and revalidates its saved anchor. This is a single-server preview implementation, not shared multi-server session storage.
- Source preference/dedup is deterministic within the bounded eligible candidate window; an older personal publication outside that window is not fetched solely to replace the chosen source. Published in independently looks up authorized alternative contexts. No inaccessible context names/counts are returned.
- Sparse pages caused by fresh revocation advance their bounded cursor; the native store retains its existing repeated/empty-page pause and explicit Continue behavior. Access/rules/follow checks are reapplied for page serialization and selected renewal; session snapshots are not permission leases.
- Real SQL/API and controlled native components qualify contracts and ownership. Large-production query-plan/load measurements, physical iPhone pixels/audio, VoiceOver and other devices are not established by host tests. No numerical playback threshold is newly claimed.

## Validation

- Original planning source audit against primary `/home/ubuntu/aws` with accepted build43 working tree preserved. No applicable ancestor/scoped AGENTS.md found; no subagents or skills invoked.
- Baseline:255 native unit/115 rendered cases and typecheck passed for accepted build43. They are previous implementation evidence, not newly run product tests for this documentation-only task.
- Fresh documentation baseline `/dev/shm/plan187-docs-before.log`:16 existing findings. Final `/dev/shm/plan187-docs-after.log` retains exactly those16, zero new. All75 local Markdown links resolve and `git diff --check` passes. A1292-file before/after hash comparison confirms that only this plan/index/roadmap changed and preserves all accepted build43 working-tree changes.
- Planning-only evidence above belongs to the prior plan-writing turn. Current implementation: backend build/native typecheck pass;261 unit,124 rendered,20 aggregate service-contract and66 isolated real SQL/API checks pass. SQL cases include actual strict native parser/access-manager roundtrips, creation contexts, exact contextual follows, source bans/rules, saved pagination beyond200 rows, tombstones, strict cursors and concurrent/stale checkpoint writes. See [service checks](../../scripts/check-aggregate-feeds.ts), [SQL checks](../../scripts/check-aggregate-sql.ts), [native contracts](../../mobile/tests/aggregate.test.ts) and [actual destination flows](../../mobile/tests/rendered/destinations.test.cjs).
- Guarded promotion of44 changed/new files preserved all1293 captured primary baseline files and the accepted43 implementation. Primary source identity matches qualified45; primary backend build/native typecheck pass. Only `native_destinations` changed0→1; `root_home`/`native_home` stay1.18 read-only local/HTTPS checks pass for Home/config/Global, web `/`/`/global` and unauthenticated private-endpoint rejection. The disposable MariaDB instance was stopped and its unique temporary datadir removed.
- Documentation qualification retains exactly16 existing findings with zero new; all129 local Markdown links resolve and whitespace passes. Host counts and limits are recorded in ignored `tests/runs/build/plan_187/host-checks.json`.
- Build45 source `71b067b47325a64d819446d504964a6224b87510acacbccfa88736ecab9a4884`:180 public inputs,181 exact archive files,2457201-byte Hermes export. Source stamp and public API are verified against the actual archive. Build44 is superseded and was not shared for phone acceptance. Downloaded [build45](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/f5a7d92b-31fd-4729-9d1b-c0c6009fc9f0) is verified:8446630-byte IPA, source/API markers, native presentation/readiness module, accepted single-device provisioning/team namespace, `get-task-allow=false` and OTA disabled. Embedded bundle2457281 bytes, IPA SHA256 `df7814cde82b2f198aa8f00adecf4cf343c9d4d2a40e1ba06cacdc495c6b9dd2`. Build45 menu/directory acceptance is recorded; the final UI/Following/playback observations are from build46 below. No additional build45 physical/VoiceOver result is inferred.

## Final Phone Acceptance — 2026-10-29 (Pacific)

The user answers “Yes”/“yes” to all three build46 bundles: Your Creations/Published in per-place rules and exact-video navigation; Following’s contextual streams, source label, rules and Report; preserved position/pause/playing state through rules, destination changes and app reopening, clear audio, silent rules/menu/loading and smooth swipes. Combined with build45’s accepted menu/saved-directory bundle and existing host/artifact evidence, A–G are complete for this internal milestone.

These are qualitative observations on the registered iPhone. They do not establish numeric performance/position error, VoiceOver, other-device coverage, large-production load behavior, fresh report submissions or additional physical checks beyond the questions answered. Existing implementation bounds and deferred milestones remain unchanged. No product, backend, database or build change was needed to record acceptance; no commit/push requested.

## Repository Delivery — 2026-10-29 (Pacific)

- User-requested commit/publication is complete for the accepted Plan186/187 implementation: [`3a3f32b`](https://github.com/cnm4us/aws/commit/3a3f32b06492f54e303b1792bafe645c74ef7f62) (`feat: add unified viewer navigation and personalized feeds`). Remote `main` was checked against full implementation SHA `3a3f32b06492f54e303b1792bafe645c74ef7f62` after the successful push.
- The committed public source still matches accepted build46 `e48138e0cf580d43436e55e3bb84bf26cbc3da0ef038cad076fb03077153e3ba`. No rebuild, product/backend/database mutation or new phone check was needed for publication. Existing typecheck/125 rendered and retained261 unit/20 service/66 SQL/API evidence remain unchanged.
- Repository delivery records follow in a separate documentation commit. Private credentials, fixture files and ignored build artifacts are excluded. Existing16 documentation findings remain unchanged, with zero new; local links and whitespace pass.

## Change Log

- 2026-10-29 (Pacific) — Accepted combined Plan186/187 implementation committed/pushed as `3a3f32b` and exact remote main verified; delivery records follow separately.

- 2026-10-29 (Pacific) — User requests “Please commit and publish.” Preparing one implementation commit for accepted Plan186/187 and repository publication; no new product or build changes.

- 2026-10-29 (Pacific) — User accepts all three final build46 phone bundles. A–G marked Complete for the internal milestone with explicit host/device limits. Implementation remains uncommitted; no push.

- 2026-10-29 (Pacific) — Build45 menu/directory phone bundle accepted. User approves removing Your Creations Source pill and adding per-place About & Rules under Published in; implemented and delivered as verified build46;125 rendered cases/typecheck/export/archive/downloaded signing pass. Following/playback phone results were outstanding at delivery and are resolved by the final acceptance entry below.

- 2026-10-29 (Pacific) — User authorizes implementation. Added compatible aggregate services, source-aware native feeds, separate saved collections and checkpoints; host suites pass. Signed build45 source/artifact/live rollout verified; phone checks were requested and final acceptance is recorded below. Build44 superseded before phone sharing.

- 2026-10-29 (Pacific) — User accepts the destination labels and requests a detailed implementation plan. Audited current saved directories, contextual follows, personal/publication semantics, feed/access/resume ownership and accepted build43. Proposed staged delivery with explicit aggregate-feed work. The user confirms “All published creations across spaces” and “Combine existing space-specific follows”; those choices are locked above.

## Resume Here

Plan187 is Complete for the accepted build46 internal milestone. All three final phone bundles and the build45 menu/directory bundle pass; host/source/archive/downloaded signing and guarded promotion evidence are preserved. No required acceptance check remains. Retain recorded implementation/accessibility/performance limits and Plan184’s separate rollout gates. Accepted Plan186/187 implementation committed and pushed as `3a3f32b`; remote main verified. Delivery documentation follows separately; preserve the verified build46 source and recorded limits.
