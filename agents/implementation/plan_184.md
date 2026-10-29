# Plan 184: Discovery Home, canonical Global, Your Spaces and culture-aware entry

Status: Active

## Feature Reference

- Shared-client sequence: [Native viewing roadmap](../roadmaps/roadmap_native_viewing.md).
- Explicit destination/publication identity: [Context integrity](../features/feature_02_personal-space-global-feed-context-integrity.md).
- Existing culture definitions: [Structured culture editor](../features/feature_15_json_for_moderation.md), [Moderation v2](../features/feature_16_moderation_v2.md), [Signals registry](../features/feature_17_moderation_signals_rules.md).
- Predecessor discovery/entry requirements: [Plan175](plan_175.md), section “Sequenced follow-on”.
- Accepted fresh-feed loading and geometry: [Plan177](plan_177.md), [Plan178](plan_178.md), [Plan180](plan_180.md).
- Reporting/reader baseline: [Plan182](plan_182.md), [Plan183](plan_183.md).

## Context

The user proposes a site Home with genre/category rows of group/channel tiles and See all, a deliberately curated Space Changer (“Your Spaces”), Continue/Recently Visited, comment/reply Activity and separate private Messages. Each space has a culture and should introduce its purpose, expected behavior and moderation rules before the viewer confirms entry. The user asks where Global should live when the current root becomes Home, and asks for investigation and a detailed implementation plan. Existing web culture work must be reused.

The user subsequently authorizes implementation. Proceed with the proposed phased implementation, checks and signed preview; preserve existing app/sign-in and use an isolated checkout until host gates pass. Commit/push require a separate request.

In scope for the proposed first delivery: shared discovery/entry policy, canonical `/global` and old-link compatibility, explicit saved spaces, curated genre browsing, readable versioned space entry, Home/Your Spaces/Continue on web and iPhone, safe entry/resume and the minimum admin tools/data needed to populate those surfaces. Implementation is phased; root cutover is last, after both routes and clients qualify.

Later milestones: an aggregated Following feed, Activity inbox/native reply completion, private conversations, broader creator-column discovery, invitation/approval/age/payment fulfillment and universal links. These receive contracts and their own plans before implementation; they are not inert navigation buttons or implied existing capabilities.

Baseline: clean synchronized main at `e56e811a83b9c1b083ff2f00a9a5b36f13b5131e`. Build39 product source is `463a806dadd9915430650a61b7a00c03afcd421dd06f3ecdc75d068877d365b6`; reporting phone qualification/Plan183 cleanup remain open. Preserve its app/sign-in, current reports/fixtures, shared media and predecessor evidence. Operational root-volume expansion/monitoring reset is complete for its recorded checks and is not product-feature work.

## Investigation and Analysis

| Existing source/evidence | Finding and consequence |
| --- | --- |
| [Web entry](../../frontend/src/main.tsx), [server pages](../../src/routes/pages.ts) | `/` mounts Feed. Group/channel slug routes already serve the SPA. `/global` is not currently registered: read-only HTTPS checks return root200 and `/global`404. Add the new canonical route before changing `/`. |
| [Feed](../../frontend/src/app/Feed.tsx), [Layout](../../frontend/src/ui/Layout.tsx), [route loaders](../../frontend/src/ui/routes.ts) | Global switching writes `/` into history; group/channel selection writes canonical slugs. Feed reads `pin`, `publication_id`, `t`, `t_end`. Layout’s Go to Feed points to `/`; the PWA bootstrap in main preserves only group/channel paths. These are migration work, not just a new Home component. |
| [Existing HomePage](../../frontend/src/app/HomePage.tsx), [GroupsBrowse](../../frontend/src/app/GroupsBrowse.tsx), [ChannelsBrowse](../../frontend/src/app/ChannelsBrowse.tsx) | HomePage is a CMS HTML reader, not the root discovery implementation. Group/channel browse pages are placeholders. Preserve CMS content and give the new discovery page an explicit component/contract; do not assume the gallery already exists. |
| [Spaces service](../../src/features/spaces/service.ts), [spaces repo](../../src/features/spaces/repo.ts), [SpacesScreen](../../mobile/src/spaces/SpacesScreen.tsx), [viewer routes](../../src/routes/viewer.ts) | Current space lists derive from ownership, memberships and active channel subscriptions, with native access filtering. They are not explicit saved bookmarks. Preserve access relationships while adding independent save/remove state and a migration that does not resurrect removed entries. |
| [Culture repo](../../src/features/cultures/repo.ts), [types](../../src/features/cultures/types.ts), [schema](../../src/db.ts), [admin service](../../src/features/admin/service.ts), [AdminSpaceDetail](../../frontend/src/app/AdminSpaceDetail.tsx) | Structured definitions, culture editor and many-to-many space assignments already exist. The definition includes public-facing summary/tone fields and internal notes/AI guidance. Cultures are mutable; their current version labels are not proven immutable document revisions. Do not create a competing culture system or use the label alone as acknowledgment identity. |
| Read-only aggregate SQL audit | Nine cultures, all with stored definitions; one has a definition summary and one a legacy description. Five spaces have culture assignments; three have multiple cultures. Global is the explicit `global-feed` destination (currently29), with one assigned culture. Treat IDs as observed data, never constants. An introduction settings key is present on only one group and one channel; this audit alone does not establish editorial readiness. Content preparation is a real launch prerequisite. |
| [SpaceSettings](../../frontend/src/app/SpaceSettings.tsx), [description projection](../../src/features/spaces/discoveryDescription.ts), [Launch service](../../src/features/publications/viewerLaunch.ts) | The existing owner/admin introduction is plain text, bounded to500 characters, and is already shown in exact-video Launch. Reuse it for purpose/teaser; add any longer welcome document separately with explicit version/publish behavior. |
| [Reporting repo](../../src/features/reports/repo.ts), [reporting API](../../src/features/reports/viewer.ts), [moderation service](../../src/features/moderation-v2/service.ts) | Culture-curated initial reporting groups and the broader Show all catalog are reporting entry points. They are not automatically the authoritative list of that space’s conduct rules. Moderation also has global-safety logic and older category mappings. Derive a reader projection from the actual applicable policy; do not label every Show all reason a space rule or reuse moderation categories as genres. |
| [Native checkpoints](../../mobile/src/navigation/feedCheckpoints.ts), [navigator](../../mobile/src/navigation/ViewerNavigator.tsx) | Exact position/manual-pause checkpoints are scalar, bounded to16 and scoped to API/account generation. There is no durable cross-device Continue contract. Preserve this behavior; explicitly add bounded recent/resume persistence rather than treating analytics as resume state. |
| [Feed activity](../../src/features/feed-activity/service.ts), [engagement repo](../../src/features/engagement/repo.ts), [schema](../../src/db.ts), [Layout](../../frontend/src/ui/Layout.tsx) | Feed activity is analytics, including anonymous sessions, not a personal unread inbox. Comment rows support parent IDs but the accepted native UI is top-level comments. Existing `feed_messages` are platform messaging/journey features, not private user conversations. No dedicated saved-space, entry-acknowledgment, discovery, recent-space, notification or conversation table was found in the inspected schema/audit; generic user terms acceptance exists and must not be repurposed blindly. |
| [Mobile configuration](../../mobile/app.json) | No associated-domain/universal-link configuration is present. Internal native navigation and canonical browser URLs can ship first; do not claim app-opening shared links without a separately qualified association/route implementation. |

Audit evidence: `tests/runs/planning/plan_184/read-only-audit.json` (ignored). Counts are an aggregate snapshot, not a complete live policy/content audit or a statement that every space is ready for discovery. No private culture internals or account credentials were exported. The web tool could not open the host; direct read-only host HTTP checks established the statuses above.

## Locked User Requirements

1. Home is the site discovery destination; Global remains a directly accessible, distinct feed/publication space.
2. Existing group/channel URLs and explicit destination publication identities remain intact. No publication migration, cross-posting or Global/source-space merging.
3. Your Spaces is the frequently used set the user chooses to keep in the Space Changer. Membership, subscriptions, creator Follow, saving and recently visiting are separate concepts.
4. Culture and moderation work already done for web is reused. Space introductions explain purpose and expected behavior and require a deliberate read acknowledgment before first entry.
5. Accepted within-feed swiping and exact-position/manual-pause returns remain core behavior. Entry must stay silent until acknowledgment, source readiness and restoration are complete.

## Recommended Implementation Defaults

The user approved implementation of these defaults. They subsequently confirmed Travel, Cooking, Technology and Arts as the initial genres, and explicitly chose the existing Launch test group/channel for the preview catalog.

- `/` becomes Home; `/global` is canonical Global. Home has a prominent Watch Global tile/link, and the changer retains Global as a fixed utility entry. Global has its own About/rules introduction and acknowledgment context.
- Primary first-delivery destinations are Home and Your Spaces. Continue is a Home row with a full list if needed. Add Activity and Messages only when their actual workflows ship; keep Profile/account available through the existing menu. The existing bottom reserve can acquire only working controls.
- Use **My Space** for the user’s existing personal publication space. Reserve **Following** for the future aggregate feed of followed creators. Do not rename the existing personal space into a Following feed: current personal viewing and Follow semantics differ.
- Show the welcome on first entry and again for a materially changed reader-facing policy. Ordinary returns with a current acknowledgment go straight through the existing named loading splash and saved-position restoration. About / Rules is always available. The readable welcome and automatic loading cover are distinct screens/states.
- Keep anonymous discovery and anonymous Global viewing. Global acknowledgment cannot silently require an account. Other space feeds preserve their existing sign-in/access requirements. Saving and synchronized recents require sign-in.
- Initial discovery is curated and opt-in. A new listing setting defaults hidden; existing private/public-feed flags do not automatically publish every space into a directory. Authorized users can still reach their own/membership spaces. A discoverable introduction is not a grant to view protected content.
- Preserve existing changer entries with a one-time, explicit migration of eligible relationships into saved records, labeled legacy-origin internally. Later membership/subscription changes do not silently save a space, and removing a save never leaves a group, cancels payment or unfollows a creator. A migration ledger/tombstone prevents re-seeding removals. Review this migration in Phase A before writing data.
- Genres are site-curated browse labels with many-to-many space assignment and ordering. A space may appear in several genres. They are independent of cultures, retired moderation categories and audio genres. Do not manufacture a genre list from existing culture names.
- Exact resume is bounded, best effort across restart/device changes, and revalidated. Explicit shared-video targets override an ordinary resume checkpoint. Within-session checkpoint behavior keeps its existing precision; no promise of frame-exact recovery after a crash or last-write race.

## Proposed Browser Routes and Compatibility

| Route | Meaning / implementation |
| --- | --- |
| `/` | Discovery Home after the final cutover; never silently redirect a plain Home visit into the last feed. |
| `/global` | Explicit Global feed; resolves Global regardless of last-selected space. No change to existing Global feed API identities. |
| `/your-spaces` | Signed-in saved-space manager and launch surface. |
| `/genres/:slug` | Paginated See all spaces for one public genre; unknown/unpublished slugs return a real404/empty state as appropriate. |
| `/recent` | Signed-in full Continue list if the initial bounded row needs expansion. |
| `/groups`, `/channels` | Existing browse routes become functional type-filtered directory views. |
| `/groups/:slug`, `/channels/:slug` | Existing feed URLs resolve entry/acknowledgment before any player is opened; preserve direct exact-video query parameters. |
| `/groups/:slug/about`, `/channels/:slug/about`, `/global/about` | Always-readable permitted introductions/rules; accepting enters the intended feed, and Back returns to its origin. Register before generic/admin route patterns. |
| `/personal` | Proposed explicit signed-in link to the current user’s existing personal space; no broad creator-private-space access. Existing `/users/:slug` remains the public profile. |
| `/following`, `/activity`, `/messages` | Reserved design destinations; no public route/button implying delivered functionality in this milestone. |

Compatibility requirements:

- Root links carrying actual legacy feed intent (`pin` or `publication_id`, or standalone recognized `t`/`t_end`) receive a same-origin temporary redirect to `/global`, preserving the feed parameters and fragment. Preserve valid diagnostic/campaign parameters as data without treating every root query as feed intent; list supported keys and validate bounds. A plain old `/` bookmark now intentionally opens Home.
- Normalize `/global/` and historical `/channels/global` / `/channels/global-feed` aliases to `/global` with query/fragment preserved. Do not accidentally create an ordinary channel copy of Global. Avoid permanent redirect caching during qualification.
- Audit both SPA/server URLs, native/web/admin shared-video generators, report-review jump links, login/logout/support returns, menu links, public navigation scripts, prefetch loaders, PWA startup allowlists, manifest/start_url and service-worker caches. Old `/?pin=...&publication_id=...&t=...&t_end=...` must reach the same eligible publication and range.
- Update history/popstate handling for Home ↔ Global ↔ group/channel, direct reload and Back/Forward; an unknown route must not silently mount Feed. Preserve admin/help/CMS routes and their existing authorization.
- Keep website paths separate from `/api/feed/global` and `/api/viewer/v1/feed/global`. Renaming a browser path does not rename a database space, alter publishing destinations or change engagement policy.

## Space Introduction and Acknowledgment Contract

1. Entry shows name/type, authorized cover/icon, existing community purpose text, human-readable culture summary, concise expectations and links to full applicable rules/examples. Handle several cultures deterministically, preserving attribution; never select the first culture and discard others or invent a stricter/looser policy merge. Conflicting/missing source data requires editorial resolution, not a new moderation rule.
2. Use an explicit public allowlist of culture fields. Names, authored summaries and approved human-readable expectations may be projected; internal_notes, AI hints, scoring/agent guidance and non-viewer rule bodies stay out of the response. Invalid/missing definitions do not present generated defaults as owner-approved culture.
3. The longer introduction is an authored draft/published document referencing existing cultures/rules. Preview and Publish use existing site/space management permissions; changing discovery placement is a separate site-curator capability. No automatic culture reassignment or creation of new moderation rules while authoring a splash.
4. The server computes an opaque reader-facing revision from the published introduction plus stable ordered public culture/rule references and applicable current content versions. A mutable `v1` label or generic updated_at is insufficient. Preserve the canonical source manifest with each acknowledgment; material reader-facing changes produce a new revision, internal-note/metrics/format-only changes do not needlessly prompt again. Phase A specifies normalization and the complete writer invalidation inventory, including culture saves, assignments, rule-version publication and welcome publication.
5. GET returns a safe current entry document and separate `canView`, `requiresSignIn`, `requiresAcknowledgment`, `saved` and supported requirement states. No playable URLs/protected publication previews are returned before view authority and acknowledgment. A permitted metadata preview can explain a restricted space without exposing its feed.
6. The explicit action is “I’ve read the space rules” followed by Enter space (or one equivalently explicit action). It is not joining, subscribing, following, agreeing to a legal contract or proof the text was actually read. No reading timer, forced scroll-to-bottom or acknowledgment expiry while a person reads normally. Back/Close remains available.
7. Signed-in receipts are bound to server-derived user, space and reader revision, shared between web/iPhone. Accept under current authority and revision in a transaction; stale document returns `space_entry_changed` and fresh information, not success for a new revision the viewer never saw. A lost write response is reconciled by reading state; never auto-enter on uncertain acknowledgment.
8. Anonymous Global uses a bounded server-issued signed receipt, not an account or client boolean: same-origin secure cookie for browser, a dedicated explicit receipt field/header for anonymous native requests. Do not overload bearer authorization, mix cookie/bearer identities or permit credentials in URLs. Clear/rebind anonymous state appropriately after account change; never copy one signed-in user’s receipts to another.
9. Enforce enabled acknowledgment at shared viewer entry/content authorization for new web/native requests, including direct feed/playback and relevant publication reads/actions; a client-side modal alone is bypassable. Preserve independent existing membership/ban/subscription and publication checks. Document already-issued CDN URL lifetime separately; this feature does not retroactively revoke downloaded video.
10. During a material revision/access change, existing bounded verification expires normally; hide/pause protected content, preserve a scalar checkpoint and resolve current entry policy before reveal. No logout, account reset or automatic report/Follow/membership mutation. A routine feed return with a current receipt should not add redundant blocking preflight round trips; combine entry status with the existing authorized bootstrap where practical.
11. Acknowledgment is enabled per space only after its authored introduction/current policy projection is ready and both clients support the contract. Global needs the anonymous path before enforcement. Existing unconfigured spaces keep their prior behavior until configured; newly directory-listed spaces require a published introduction. Do not gate all existing accounts with empty or fabricated text.

## Proposed Shared Data and API Shape

Implement through shared services, with thin native bearer/cookie-CSRF wrappers. The exact SQL/API naming is finalized in Phase A; these responsibilities must remain separate.

| Data | Required behavior |
| --- | --- |
| `discovery_genres` and `discovery_genre_spaces` | Unique stable slug; label/description/artwork; published state/order; many-to-many ordered membership. Query indexes for genre+sort+space. |
| `user_saved_spaces` | Unique user+space; explicit saved/removed state, order, legacy migration provenance. Server derives identity; add/remove idempotent; authorized personal/Global utility entries are not duplicated. |
| Published space-entry document/revision | Space-authored purpose/welcome plus approved public culture/rule source manifest and revision. Keep canonical culture/rule ownership; no copy of hidden moderation configuration in public JSON. Draft/publish and rollback do not overwrite the acknowledgment history. |
| `space_entry_acknowledgements` | Exact user+space+readerRevision, timestamp and source-manifest reference. Bounded history/retention and indexes; no payment/age/identity evidence. Anonymous Global uses signed receipts instead of manufacturing users. |
| `user_space_visits` / resume state | Bounded recent list (initially30 visible spaces/90-day retention) with server last-opened time. Optional publication/media identity, playhead, manual-pause and server revision for validated resume; no media URLs or credentials. |

Suggested resources: directory Home, genre listing and type-filtered directory; saved-spaces GET/PUT/DELETE; space entry GET/acknowledge POST; recent/resume GET and idempotent bounded state writes. Follow existing `/api/viewer/v1` native transport and cookie/CSRF conventions; retain `/me/spaces` compatibility for old clients instead of changing its meaning underneath them. Existing admin routes may receive additive genre/listing/welcome fields or a focused discovery-admin resource.

- Directory metadata must pass a dedicated discoverability policy; private names, membership counts, posters and unread/resume data cannot leak through public search, pagination or cached responses. Members/admins may access permitted unlisted introductions via their own contexts. Saving an undiscoverable ID cannot enumerate it.
- Start with capped Home data (at most6 genre rows/12 cards each), explicit20-item See all pages (max50) and stable validated cursors. No eager rule-body, media or per-card relationship N+1 calls. Cache only truly public metadata; account-specific sections are private/no-store and separated from public payloads.
- Use placeholders for missing artwork; no automatic media extraction/processing job. Existing asset references require explicit safe-public-derivative validation before serving them as discovery art.
- Saving does not acknowledge rules. Acknowledging does not save or grant access. Mark a space visited only after successful entry/reveal, not a tile impression, canceled welcome or failed check. Unauthorized/deleted spaces are filtered and stale recents are pruned without exposing old metadata.
- Resume writes are sparse (leave/pause/background and a bounded playback interval), best effort and account/space/publication validated. Use server ordering/revision to avoid a late device overwriting newer state; conflicts reconcile without interrupting playback or retrying arbitrary writes. State failure never blocks already authorized viewing.
- Resolve saved publication/media identity afresh before seek. If removed, changed, shortened or inaccessible, show an explicit restoration outcome and offer the current eligible start; do not silently substitute another publication as an exact match. Direct pin/time/range intents take precedence.

## Phase Status

- A: Complete — contracts, migration and staged compatibility resolved below
- B: Complete — canonical Global and legacy routes verified in isolated API/browser checks
- C: Complete — additive schema, shared services and curator/author tools implemented; enforcement is staged off
- D: Complete — web Home live at `/`; browser and cutover checks pass
- E: Complete — build41 signed/source qualification and focused user phone checks accepted; recorded limits retained
- F: Complete — bounded durable model and client resume implemented; user confirms restart/Continue restoration
- G: In Progress — phone acceptance and root/startup cutover complete; mandatory enforcement remains an editorial/old-client rollout gate
- H: Deferred — Activity, private Messages, Following and broader entry fulfillment

## Phase A — Freeze contracts and migration behavior

- Goal: turn the proposed defaults into one consistent web/native contract before altering startup.
- Steps:
  - [x] Confirm `/global`, route/legacy query mapping and staged Home cutover; inventory every root-feed URL writer and PWA/history path.
  - [x] Audit actual space settings, culture assignments, public summaries, effective rule resolution and every relevant editor/writer. Record how multiple cultures/current rules become a public reader projection; distinguish the reporting catalog from policy.
  - [x] Finalize directory visibility, curator/space-admin capabilities, anonymous Global receipt, revision materiality, new acknowledgment enforcement points and old-client rollout.
  - [x] Finalize saved-list migration, explicit removal semantics, personal/Following naming, bounded recent/resume consistency and failure behavior.
  - [x] Define versioned DTOs/errors and an explicit baseline-to-new-route compatibility matrix. No fabricated age/payment/approval buttons.
- Test gate: contract/design review against source and safe read-only fixtures; local documentation/link/whitespace checks. No new product test is needed merely to write the plan.
- Acceptance: no unresolved ambiguity about Global identity, permission versus save/ack, anonymous entry, current culture source, exact legacy targets or the timing of root cutover.

## Phase B — Establish canonical Global before moving Home

- Goal: make `/global` usable independently while the current root still works.
- Steps:
  - [x] Add explicit server/SPA `/global` and alias normalization; centralize viewer route construction/parsing and use it in Global selection, navigation, return links, prefetch and generators.
  - [x] Add legacy feed-intent root handling preserving publication/range/query/fragment and history behavior; keep plain root behavior unchanged until G.
  - [x] Update installed-PWA startup allowlists/manifest/cache handling; preserve explicit `/global` and group/channel deep links. Keep native universal-link setup separate.
  - [x] Inventory admin report-review links, support/login returns and public navigation scripts. Replace only destinations that mean Global; true Home links remain `/`.
- Test gate: browser/server route tests for anonymous/signed-in `/global`, old pins/ranges, aliases, direct reload, PWA startup, Back/Forward, denied/removed exact targets and unaffected admin/help/group/channel paths; existing backend/web build.
- Acceptance: one real Global publication/range resolves identically through old and new URLs, with no database publication changes or hard redirects that discard intent.

## Phase C — Shared policy/data and editorial readiness

- Goal: provide safe catalog, saved list and culture-entry contracts for both clients.
- Steps:
  - [x] Add idempotent additive schema/migrations/indexes and shared services; inspect current migration conventions before choosing deployment scripts. Preserve existing space/culture/report tables and old `/me/spaces` semantics.
  - [x] Implement curator genre/listing/artwork tools and space-author welcome Preview/Publish, reusing existing summaries/assignments/full rule sources. Allow Global configuration through its actual destination record, not a numeric constant.
  - [x] Implement saved-space CRUD and one-time relationship migration with explicit provenance/tombstones. No enrollment/cancellation/Follow side effects.
  - [x] Implement safe current entry projection, composite reader revisions, signed-in acknowledgment and anonymous Global receipts. Exercise every editor that can materially invalidate a revision, and stale-read/accept races.
  - [x] Add shared enforcement behind a default-off/per-space rollout switch. Make status/check/bootstrap errors actionable; stale acknowledgment must not be misreported as a generic space ban.
- Test gate: backend unit/real SQL/API tests for anonymous/auth/owner/member/subscriber/banned/expired identities, private/unlisted discovery, multi-culture/missing summary, hidden/internal fields, current versus stale acknowledgment, conditional writes/lost responses, duplicate Save/Remove, migration rerun and cookie-CSRF/bearer isolation. Fixture changes must be exact-owned and restored.
- Acceptance: listing/acknowledgment/save never grants protected access; stale documents cannot be accepted accidentally; published reader-facing text matches canonical current policy, including Global’s own context.

## Phase D — Web discovery and entry experience

- Goal: deliver the gallery and readable entry using the existing web viewer.
- Steps:
  - [x] Build a separate lazy discovery Home bundle, initially on a qualified preview route/flag; retain CMS Home data rather than replacing it accidentally.
  - [x] Implement genre rows/See all, functional group/channel browse, prominent Watch Global, Your Spaces and explicit Save/Remove. Keep tile content concise, label restrictions and support empty/missing-artwork/error states.
  - [x] Implement About/welcome pages and read acknowledgment before mounting the feed; existing direct feed URLs retain their intended target through sign-in/acknowledgment. Back returns to the real origin and its list scroll/focus.
  - [x] Update shared navigation/layout/history to distinguish Home from Global. Leaving a feed saves state and stops audio; Home does not mount a hidden Feed or preload HLS for tiles.
  - [x] Reuse safe rule-reading components without exposing reporting Submit/time controls in the welcome. Keyboard/large-text/long-rule reading stays usable without the previous report draft timeout issue.
- Test gate: actual browser tests for Home/direct URLs, genre paging/scroll, saved-list mutation, acknowledgment/update/decline, paused/playing welcome/Back/Global/group/channel returns, keyboard/focus, reload/PWA and exact old pin/range links. Preserve accepted publishing/admin/moderation workflows.
- Acceptance: real Home/Your Spaces and entry work behind the rollout switch, with no autoplay before Enter and no broken Global or space link.

## Phase E — Native discovery and entry

- Goal: adopt the same semantics while preserving accepted iPhone playback.
- Steps:
  - [x] Add Home and Your Spaces within the existing identity-owned navigator; retain account/settings/profile controls and only functional bottom navigation. Anonymous Home still offers Global.
  - [x] Preserve the checkpoint owner above Home/Feed transitions. Home is opaque with zero active feed players; leave captures/releases the feed, and actual entry creates the accepted fresh pool of at most3 players. Closing About/chooser for an unchanged retained feed preserves its existing intent.
  - [x] Add genre tile/See all and safe native culture/rule reading, read acknowledgment, explicit Save/Remove and initial list migration. Keep one cover/entry owner; do not stack several80% scrims or add another player to show an introduction.
  - [x] Combine current entry status with existing access/bootstrap work where possible. Loading stays silent/black across the entire picture until source readiness and saved seek/manual-pause restoration complete; within-feed swipes remain smooth.
  - [x] Ignore late reads/writes after Close/background/space/account replacement; clear private card/receipt/checkpoint state at existing identity boundaries. Do not reset sign-in to recover a transient entry error.
- Test gate: focused native unit/rendered tests for identity/lifecycle/entry/receipt/saved-state transitions, then the existing full suites/typecheck. Verify source/export/archive/downloaded signed build, provisioning/OTA and private-input exclusion before focused phone checks.
- Acceptance: Home/Your Spaces/rules/first-entry/re-entry work on the signed iPhone preview, with preserved position/manual pause, clear audio, silent covers and the existing within-feed paging behavior. Larger text/VoiceOver/numerical claims require their actual observations.

## Phase F — Continue and validated resume

- Goal: make Continue a trustworthy return path distinct from unread activity.
- Steps:
  - [x] Record successful visits and bounded sparse resume checkpoints through the shared model. Keep analytics independent and do not reconstruct personal history from anonymous telemetry.
  - [x] Implement Continue row/full list, current authority filtering and fresh resolution/seek before reveal. State clearly when exact restoration is unavailable.
  - [x] Preserve within-session precision, define cross-device last-write conflicts, sign-out/clear-history behavior,90-day expiry and30-space visible cap. Persisted manual-pause behavior must be consistent between web and iPhone.
- Test gate: actual lifecycle/SQL/API/browser/native cases for normal return, restart, another device/revision conflict, lost write, explicit deep-link override, changed/removed media, revoked access, expired history, account replacement and unavailable state service.
- Acceptance: Continue does not expose stale private metadata, pretend a fallback is exact or block current playback because a history write failed.

## Phase G — Qualify and cut over root/startup

- Goal: make Home the actual entry point without stranding old clients or empty spaces.
- Steps:
  - [ ] Prepare a small real, owner-approved starter catalog and introductions, including Global; document unconfigured/excluded spaces. No bulk AI-generated culture text or automatic listing of private fixtures.
  - [ ] Run the compatibility/authority/acknowledgment/playback matrix end to end. Preserve Plan183 fixtures and pending acceptance; new discovery fixtures use their own ownership namespace and reuse media without republishing normal content.
  - [ ] Deploy additive shared APIs first, qualify web/new signed iPhone clients, communicate/update old clients, then enable acknowledgment for configured spaces. Do not enable a server-wide gate that build39 cannot satisfy.
  - [ ] After `/global`, old links and both clients qualify, switch web `/` and native normal startup to Home. Preserve explicit incoming feed intents. Observe real errors, latency and playback separately from local diagnostics.
  - [ ] Record matching source/build, exact observed phone ranges, host/API/browser results and cleanup of only owned temporary metadata/reports/sessions. Commit/push/deployment require execution authorization when requested, not inferred from this plan.
- Test gate: backend build/viewer tests, web builds and actual browser checks; native unit/rendered/typecheck/export/archive/signed artifact; focused physical Home/genre/save/welcome/Continue and paused/playing/audio/within-feed checks; zero new docs findings and valid links.
- Acceptance: Home is useful and populated; Global and existing shared space/publication links still work; both entry paths enforce the same current policy with no hidden media playback or access shortcut. Remaining physical/numerical limits are explicit.
- Rollback: disable Home/startup feature switch while preserving `/global` and legacy redirects; disable new entry enforcement before reverting to clients that cannot acknowledge. Retain saved lists/acknowledgments/genre metadata and existing content. No destructive schema rollback or publication migration. Re-run root/feed/link/access smoke checks.

## Phase H — Separate subsequent product milestones

- Activity: define replies/mentions/own-post events, recipient privacy, per-event or per-thread read state, counts, deletion/moderation handling and exact-publication/thread navigation. Use real unread state; a recent visit is not an unread event. Complete native replies where required.
- Private Messages: define conversations, participants/permissions, blocking/reporting, delivery/read states and notification settings. Existing feed campaign/journey messages remain a separate product system.
- Following: specify an aggregate of contextual creator follows with exact destination eligibility, duplicate cross-post handling and Global/personal distinctions. Do not implement it by renaming My Space or changing Global selection.
- Broader discovery/entry fulfillment: complete Plan175’s real invitation/approval, age and membership/payment requirements through functioning providers and server capabilities. Acknowledging rules is only one prerequisite and cannot fulfill any other one.
- Universal links: associated-domain/AASA/installed-app routing and browser fallback need their own qualified implementation; canonical web routes introduced here are the foundation.

## Files and Ownership

Expected edits, subject to implementation findings:

- Web routing/viewer: [main](../../frontend/src/main.tsx), [Feed](../../frontend/src/app/Feed.tsx), [SharedNav](../../frontend/src/ui/SharedNav.tsx), [Layout](../../frontend/src/ui/Layout.tsx), [loaders](../../frontend/src/ui/routes.ts), [server pages](../../src/routes/pages.ts), [public navigation](../../public/js/universal-nav.js), [PWA manifest](../../public/app/manifest.webmanifest). New discovery/list/tile/entry components should be separate from the large Feed component.
- Shared domain/API: [spaces](../../src/features/spaces/service.ts), [admin service](../../src/features/admin/service.ts), [admin repo](../../src/features/admin/repo.ts), [culture repo](../../src/features/cultures/repo.ts), [schema](../../src/db.ts), [viewer routes](../../src/routes/viewer.ts), [web space routes](../../src/routes/spaces.ts), [admin routes](../../src/routes/admin.ts). Add focused discovery/saved/entry/recents modules rather than placing all logic in routes/pages.
- Native: [navigator](../../mobile/src/navigation/ViewerNavigator.tsx), [SpacesScreen](../../mobile/src/spaces/SpacesScreen.tsx), [checkpoints](../../mobile/src/navigation/feedCheckpoints.ts), [FeedScreen](../../mobile/src/feed/FeedScreen.tsx), [client](../../mobile/src/api/client.ts), and new Home/directory/entry stores/screens with strict adapters. Preserve [ReportScreen](../../mobile/src/reporting/ReportScreen.tsx) and the accepted playback coordinator unless a measured integration issue requires a focused change.
- Editorial UI: [AdminSpaceDetail](../../frontend/src/app/AdminSpaceDetail.tsx), [SpaceSettings](../../frontend/src/app/SpaceSettings.tsx), existing culture editor in server pages, plus focused genre/placement tools.
- Documentation: this plan/index/roadmap, API/native/web guidance when the corresponding feature is actually implemented. Next preview version/source stamp only during authorized build work.

## Validation

- Research environment: clean main `e56e811`; no applicable repository/ancestor AGENTS.md found. No delegation used.
- Read-only source inspection and aggregate SQL described above. Direct host HTTP root200 and `/global`404; no login/report/fixture operation. Public web-tool access failed and is not claimed as UI/browser qualification.
- Planning docs baseline: `/dev/shm/plan184-docs-before.log`,16 preexisting findings. After writing the plan/index/roadmap, the checker retains the exact16 preexisting findings with zero new (`/dev/shm/plan184-docs-after.log`);105 local links resolve, whitespace and git diff --check pass. Build39 source/archive identity still matches167 public inputs/168 files. Only this plan/index/roadmap changed.
- All product/build/API/browser/phone tests in phase gates are future implementation requirements. Planning does not establish their success. No new product tests or build are needed for these documentation edits.

## Open Risks / Decisions to Review

- Accept the proposed Global route, naming and initial Home/Your Spaces scope; Activity/private Messages remain separately deliverable features.
- Confirm preserving existing changer relationships by one-time saved-list migration rather than starting an empty saved list. Either choice must leave membership/subscription/Follow untouched.
- Anonymous Global acknowledgment and staged old-client compatibility are prerequisites for enabling its entry gate; do not trade anonymous Global away accidentally.
- Multi-culture presentation and true applicable rules must match existing moderation semantics. The read-only audit found gaps in public summaries and assignments; public text requires author review before listing/enforcement.
- Define material revision normalization and invalidate every relevant writer. A schema-style version label or current reporting group list cannot stand in for a coherent acknowledged policy.
- Persistent checkpoints introduce privacy/concurrency/freshness work. If omitted from an initial slice, explicitly label Continue as within-session/recent navigation and do not promise cross-device exact resume.
- Directory scale/query costs and artwork rights/access need real data measurement. Start bounded, avoid media preloading and defer ranking/personalization.
- Existing native Follow/discovery/entry-provider and reporting phone gates remain open; this plan does not complete or clean predecessor work.

## Change Log

- 2026-10-28 — Planning only at the user’s request. Investigated root/Global/group/channel routing, PWA/history/pin compatibility, existing culture/editor/assignment/reporting semantics, changer relationships, discovery descriptions, checkpoints/analytics and missing inbox/DM foundations. Read-only aggregate audit confirms the existing culture model and limited public introduction coverage. All A–G Pending; H Deferred. No implementation, mutation, build, deployment, commit or push.

## Resume Here

Build41’s focused phone checks are accepted. Web Home is live at `/`, canonical Global at `/global`, with native Home enabled. Mandatory server entry enforcement remains staged off until authored Global culture/welcome review and old-client compatibility rollout are ready. New clients already show the published Launch introductions and acknowledgment. Preserve existing sign-in, Plan183 fixtures/reporting UAT and previous build evidence. Theme-matched artwork is delivered; Plan185 card refinements are accepted on build42. The user now authorizes committing and pushing the outstanding Plan184/185 implementation and records. Mandatory enforcement/editorial work remains open.

## Implementation Contracts and Execution Record

2026-10-28 — Source implementation in isolated `/home/ubuntu/aws-plan184` (`feat/discovery-home`); qualified API/web source was promoted to `/home/ubuntu/aws` at 23:52 UTC; the final channel-alias guard correction was synced on October29. No subagents, commit or push. User confirmed the four initial genres and existing Launch test group/channel. Only new discovery metadata/placements are published on those two explicitly approved spaces; existing cultures, relationships, publications, reports and shared media are preserved.

### Shared contracts

- [Service](../../src/features/discovery/service.ts), [router](../../src/features/discovery/router.ts), [schema](../../src/features/discovery/schema.ts), [policy](../../src/features/discovery/policy.ts), [content guard](../../src/features/discovery/guard.ts), [browser paths](../../src/features/discovery/paths.ts).
- `/api/viewer/v1/discovery`: public `GET config`, `GET home`, `GET directory?genre=&type=&cursor=&limit=`; authenticated `GET saved`, `GET recent`, `DELETE recent`. Directory pages default20/max50; Home shows the first6 published genres, up to12 cards each. Public listing is opt-in and publishes only a teaser/artwork, never playable URLs. New genres are independent of culture/moderation categories. Personal spaces cannot be publicly listed.
- `GET spaces/:key/entry`, `POST spaces/:key/accept {revision}`; keys `global`, `personal`, positive space ID, `group:slug` or `channel:slug`. Entry explicitly separates current viewing authority, sign-in, saved state, reader revision, acknowledgment and enforcement. `GET/POST spaces/:key/editor` supports draft, publish and placement; `POST genres` and `POST config` require the existing site-curator permission. Space authors reuse the existing manage permission. [Web editor](../../frontend/src/discovery/DiscoveryEditor.tsx) is linked from admin/space settings; `/admin/discovery` edits Global and the catalog/rollout controls.
- Published welcome text prompts acknowledgment in the new preview clients. `enforced`/`entry_enabled` is a separate, initially false rollout switch for shared API content enforcement. This staging lets the new clients qualify without blocking build39. Qualification temporarily enabled it on the isolated API and restored it afterward. Mutating qualification scripts now refuse to run beside the live discovery API; use an isolated host/database for further mutation-based checks. The read-only `smoke-discovery-live.ts` is safe for the live host. Neither a Save nor an acknowledgment grants viewing, membership, subscription or creator Follow.
- Policy projection reads all assigned cultures and their actual category-linked public/authenticated rules plus explicitly classified site-safety rules. It deliberately excludes the reporting Show all catalog, private/moderator rules, internal notes and AI guidance. Invalid culture definitions are marked unconfigured. Reader revisions hash deterministic public text; whitespace/Markdown-only formatting and invisible internal changes do not cause re-acknowledgment. An immutable public document manifest and signed-in receipt record the source at acceptance. Existing culture/rule/assignment/description writers are observed at read time, so a material change invalidates without an editor-specific callback.
- Accept runs under a serializable transaction and rejects a stale revision with409 `space_entry_changed`. Lost/late responses are reconciled without auto-entry. Anonymous Global uses a90-day HMAC receipt backed by a persistent, private database secret: secure/HttpOnly/SameSite=Strict browser cookie or dedicated `X-Space-Entry-Receipt` native header. It never substitutes for bearer identity or another space’s authority. No reading timer or welcome-form expiry.
- Saved records preserve an explicit removal tombstone. A transactional per-user ledger seeds eligible old changer relationships once, on initial Home/Your Spaces/Save use; subsequent changes do not auto-save. Global and own My Space stay fixed utilities. Existing `/me/spaces` behavior remains intact for old clients.
- `GET spaces/:key/resume` and `POST spaces/:key/visit {revision,checkpoint}` use sparse, serialized compare-and-swap writes. Checkpoints contain publication ID, production ULID, seconds and manual pause only. Server validation resolves the eligible publication/production afresh; missing/changed/shortened targets report `unavailable`. A user without a valid in-session checkpoint receives an explicit Start from current feed choice. Explicit URL/Launch targets take precedence. Continue is bounded to30 spaces/90days, uses server visit ordering with millisecond precision, and filters current authority. History failure does not block otherwise authorized playback. Clear history removes only the caller’s rows.
- [Web shell](../../frontend/src/discovery/Discovery.tsx) is lazy, mounts no hidden Feed on Home, and owns route/history, entry, saved state and scalar resume. [Native navigator](../../mobile/src/navigation/ViewerNavigator.tsx) retains its account-scoped checkpoint owner above Home/Feed; leaving Home releases the entire pool, while actual entry uses the existing fresh pool/readiness cover. Saved-space chooser keeps its80% scrim. Account-unavailable/background screens hide private discovery data. The working bottom reserve offers Home, Your Spaces and About.
- A measured integration test found that the previous checkpoint accessor called the deliberate pause/capture path. [Coordinator](../../mobile/src/playback/coordinator.ts) now has a non-mutating scalar checkpoint method; capture still pauses for detours. Tests prove that periodic persistence leaves playback running. Player lifecycle/readiness and within-feed paging otherwise retain the accepted implementation.

### Content and rollout

- Genres: Travel, Cooking, Technology, Arts (user-confirmed). Preview placements: Launch test group66 in Travel/Arts; Launch test channel67 in Cooking/Technology. IDs are fixture observations, not product constants.
- The two Launch spaces have **no existing culture assignments**. Their published preview welcome accurately identifies them as temporary test spaces and says no culture-specific rules are assigned. No culture was invented or reassigned, and existing reporting/Plan183 behavior is unchanged. Entry enforcement remains off until supported clients qualify.
- Global keeps its actual existing destination and culture. An accurate purpose draft is prepared, unpublished: creators explicitly choose to publish in Global independently of groups/channels. Its missing authored culture summary remains an editorial prerequisite for mandatory Global enforcement. No Global publication or rule was changed.
- `/discover` is the web preview. `/global` is canonical Global, with temporary alias/root feed-intent redirects preserving query and fragment. `/` remains the existing feed until G’s phone gate. The manifest still starts at `/`; explicit PWA routes, including help/admin/CMS, are preserved. No universal-link association is claimed.
- Build40 (`743b0426-4e64-4b20-bdf9-45a33c7acbf6`, source `eb6a3902f030a5ce8aa32e58ac51adba797c9ccabab91b07ac021b44d3f040c8`) finished before cancellation could apply and is superseded, not distributed for acceptance. The subsequent Continue fresh-start/privacy fixes belong to build41. Do not confuse its source/archive with the final signed preview.

### Qualification to date

- Backend build passes. Existing viewer suites plus initial discovery cases:70 tests pass; the final four-test discovery suite also passes, including web resume-stream isolation and typed Global aliases. Real SQL/isolated API checks pass61 cases, including unavailable-resume assertions. Fixture account discovery rows, per-space gates and test sessions are restored; earlier phone/reporting fixtures remain open.
- Native full unit suite255 passes and full rendered suite104 passes before final fallback additions; subsequent focused navigator/Launch/discovery suites pass38, including no players on Home, first acknowledgment, exact7-second manual-pause return, lost response, background completion and unavailable resume. Native typecheck passes. Tests are controlled native surfaces, not physical audio/pixel observations.
- Real browser viewer checks24 pass: Home/genres and no HLS/video before entry, sign-in preserving the intended space, checkbox/entry, Save/Remove, Global/About/Back, root switch, old query/fragment and Help/404. Curator editor checks12 pass: preview, draft/publish, listing, unpublished genre and rollout controls. Loopback test transport strips Origin solely because the existing application CORS allowlist is production-host-only; the promoted actual HTTPS site passes22 read-only checks with its allowed Origin. These cover current/legacy Global APIs, canonical paths, Home without players, private entry requiring sign-in, root history replacement, preserved range/fragment and emulated standalone route bootstrap. An actually installed PWA remains unobserved.
- Standalone frontend typecheck retains the exact119 preexisting diagnostics with zero new (normalized by file/code/message); the new Feed nullability diagnostics were corrected. Vite and backend builds pass. This does not claim a clean legacy frontend typecheck.
- Build41 source `35565bcca3a655230453cf017701ab8712fd6a3853d378fb0e820acc3e1e7f0a`:172 public inputs/173 archive files, exact export/archive match, no private inputs, matching deployed native source. [Install build41](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/ccf250ab-f903-4e86-9958-e47416a661e3). Downloaded IPA SHA256 `2cfed9fc0cd702994fcdf09db91109558a8bd0d6c3a497bf5593f71488d31e54`; build0.1.0/41, correct API/source, native module and new/retained labels, same accepted device/signing namespace, unexpired provisioning, get-task-allow false and OTA disabled. Physical qualification remains pending. Build39 artifacts and its pending Plan183 UAT/cleanup remain preserved.

### Remaining gate

API/web promotion reused the existing runtime environment and preserved old hashed web assets, sign-in and prior fixtures. Public config now reports `homeEnabled:false,nativeHomeEnabled:true`; zero mandatory entry gates are enabled. Complete focused physical checks on signed build41. Keep root Home and mandatory entry enforcement off pending focused phone observation. Then record exact phone feedback, complete the staged root cutover, and enable enforcement only for editorially ready spaces. Global needs its authored welcome/culture review first. Activity, private Messages, Following, invitation/payment/age fulfillment and universal links remain deferred.

### October29 preview handoff

- Build41 and `/discover` are ready for user observation. The only listed spaces are the approved Launch test group/channel. Web `/` remains Global (canonical `/global`); supported native startup now opens Home. No mandatory server acknowledgment gate is enabled. Global purpose remains an unpublished draft pending authored culture/welcome review.
- Original workspace and isolated product source match, including the final guard that recognizes Global aliases only for channel destinations. Existing API environment/sign-in reused; no other service restarted. Additive schema and owned discovery metadata remain in place. No commit or push.
- Test artifacts: `tests/runs/api-curl/plan_184/summary.json`, `tests/runs/playwright/plan_184/{summary.json,live-smoke.json}`, `tests/runs/build/plan_184/{source-manifest-build41.json,artifact-build41.json,build41-meta.json}`. Ignored/private evidence is retained locally.
- Phone checks pending: Home and genre pages; first Launch introduction/read acknowledgment and About; explicit Save/Remove without membership/Follow changes; pause near7seconds, leave to Home, restart and Continue exact publication/time/pause; clear playing return audio, silent full-picture loading, smooth within-feed swipes and preserved reporting. Larger text/VoiceOver and installed-PWA claims remain unobserved.

- Final primary-workspace verification:55 changed/new source files match the qualified checkout; signed native source remains exact. The primary four-test discovery suite and22 live HTTPS checks pass. Docs checker retains exactly16 baseline findings, zero new; whitespace check passes. Build41 phone questions were sent; no physical results received yet.

### October28 Pacific — build41 acceptance, root cutover and tile artwork

- User confirms all three focused build41 bundles: Home’s four genres/Launch spaces, See all, first-entry introduction/read checkbox and About; Save/Remove and restart/Continue restoring the same video/position/manual pause near7seconds; silent Home, clear playing-return audio, silent full-picture loading, smooth within-feed swipes and reporting open/close. This is qualitative phone acceptance, not new numeric playback telemetry, VoiceOver or large-text qualification. Separate Plan183 heading/expiry observations remain pending.
- Completed the planned root cutover after acceptance: `root_home=1,native_home=1`. Actual HTTPS read-only smoke passes25 checks, including player-free root Home, canonical Global and old root publication/range/fragment routing. Mandatory server entry gates remain off; Global authored welcome/culture review and old-client compatibility remain prerequisites. No new app build, reset of sign-in or content/publication mutation.
- At the user’s request, built-in image_gen produced four coordinated navy/teal/gold, text-free landscape artworks: connected globe (Global), community circle (groups), film ribbon (channels), creative desk (personal). Final assets: `public/images/discovery/{global,group,channel,personal}-v1.jpg`, each960x480 and under100KB. Prompts/provenance are in `assets/discovery/prompts.json`; generated originals remain preserved outside the product tree. No third-party stock assets or extra dependency.
- Shared discovery card DTOs supply these fallback artwork paths across Home, Your Spaces and Continue. Explicit curator/space artwork overrides defaults, including fixed Global/My Space cards. No bulk metadata, listing, culture, membership or Follow changes. Native build41 consumes the existing artworkUrl contract; no new install needed. Artwork phone observation remains separate from the already accepted build41 behavior.

- Artwork verification: backend build and four focused discovery unit cases pass; actual HTTPS25-check smoke passes after root cutover and artwork deployment. Browser loads all5 Home images and both available saved-space cards with no letter placeholder, no player and no page errors. Fixture account has no personal space, so its personal card is absent as expected; the personal JPEG endpoint/dimensions/size are verified. All four delivery assets are960x480,81–94KB; screenshots and `artwork.json` retained locally. No sign-in, Save/Remove, membership, culture or enforcement state changed by artwork checks; the temporary browser session was logged out. Native source still matches signed build41.

### 2026-10-28 (Pacific) — implementation delivery authorization

User requests commit and push after accepting all three build42 phone-check bundles. Deliver the accumulated Plan184 Home/Global/saved-spaces/entry/Continue implementation, generated artwork and accepted Plan185 cards together. Current mobile source matches the signed, accepted build42 (`bbb144a74d9359a283b8a3239793220ef6e70a3e15fc136e0a00189e0d5e453f`); build41/42 phone observations and existing automated evidence are retained. This delivery does not close Global editorial/old-client mandatory-enforcement gates or prior Plan183 observations. Private credentials, fixture manifests, downloaded IPA/build logs, generated bundles and ignored test artifacts stay local.
