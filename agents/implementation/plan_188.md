# Plan 188: Discoverable spaces, independent saved shortcuts and subscription-aware entry

Status: Complete

## Feature Reference

- Accepted destinations, saved Groups/Channels, Following, Your Creations and publication identity: [Plan187](plan_187.md).
- Discovery Home, curated genres, explicit saved ledger, rules entry and Continue: [Plan184](plan_184.md).
- Cards, independent checkbox/About/launch controls and responsive geometry: [Plan185](plan_185.md).
- Shared menu and workflow returns: [Plan186](plan_186.md).
- Contextual creator Follow and unmet-entry requirements: [Plan175](plan_175.md).
- Existing payment foundations/lifecycle: [Plan139](plan_139.md), [Plan140](plan_140.md), [Plan141](plan_141.md).
- Sequence: [native viewing roadmap](../roadmaps/roadmap_native_viewing.md).

## Context and Scope

After unchecking three saved channels, the user could rediscover two but could not find Test Channel on Home. Read-only investigation found Test Channel is members-only, unlisted and uncategorized, with Admin still permitted to enter. The removed saved row and recent-history row both remained. Test Channel 2 is also unlisted; Launch test channel is publicly listed in Cooking/Technology. Home genres are curated listings, while Continue is a bounded recent-history projection. Neither is a reliable directory of every space the viewer can discover or already has a relationship with.

The user clarifies that the checkbox controls only placement on Your Groups/Your Channels. It does not join a group, subscribe to a channel, buy access, acknowledge rules or follow a creator. A paid channel can be saved before buying access; an active paid subscription can remain unchecked. This supersedes the intermediate discussion suggesting those pages should become joined/subscribed directories or acquire Saved/Subscriptions tabs.

Plan the complete path: finding spaces before access, saving gated cards, reading their introductions/rules, fulfilling supported free/paid requirements, and managing subscriptions independently through Account. Native iOS is the primary UI; shared services and affected web discovery/entry/payment consumers require compatible behavior. Existing web navigation redesign, creator studio, moderation, private messages and new age-assurance/adult-distribution systems are separate.

**Implementation authorized 2026-10-29:** the user approved this plan and explicitly deferred actual purchases. Implement A–E and G–H for discovery, independent shortcuts, truthful gates, supported free enrollment and existing subscription management. Phase F (new purchases, checkout, StoreKit/provider-to-channel fulfillment and new paid grants) is deferred. Paid gates show published informational pricing when configured and explain that purchases are unavailable. No user saves, memberships, provider configuration or public space listings are changed automatically. Commit/push remain separate.

Baseline: clean main `b9ec2f6`, with accepted Plan186/187 implementation `3a3f32b`; signed build46 source `e48138e0cf580d43436e55e3bb84bf26cbc3da0ef038cad076fb03077153e3ba`. Accepted evidence includes 125 rendered/typecheck, retained261 unit/20 service/66 isolated SQL/API checks, signed-artifact verification and qualitative iPhone acceptance. Preserve those records; they are not newly run tests for this plan.

## Locked Decisions

1. Your Groups and Your Channels remain user-chosen saved shortcuts, filtered by type. No automatic replacement with membership or subscription lists and no new Joined/Subscriptions tabs there.
2. Checking adds only a shortcut; unchecking removes only that shortcut. Joining, subscribing, paying, canceling, leaving, rules acknowledgment and creator Follow never implicitly change saved state. No new automatic migration or re-seeding of removals.
3. Home enables discovery regardless of whether the viewer has joined/subscribed. Public discovery still respects explicit listing and visibility; an authenticated viewer can also find unlisted spaces they are legitimately associated with. Knowing a name/ID, saving it or having paid historically is not unrestricted discovery authority.
4. A publicly discoverable paid channel can show its teaser, rules and permitted pricing before subscription. Media remains protected. Hidden/invitation-only spaces are not made public by adding a Browse button.
5. A saved discoverable space stays on its saved page when access requires joining, subscribing, payment or renewed rules acknowledgment. Selecting it opens the appropriate introduction/gate; access loss does not silently uncheck it.
6. Free channels can enter immediately when existing requirements are satisfied, or show required rules first. Paid channels stay gated until the server confirms a valid entitlement and applicable rules are acknowledged. Pending payment is not viewing authority.
7. Separate status indicators describe membership/access/subscription. A green checkbox indicates only a saved shortcut. Owner/admin/public access must not be mislabeled Paid subscriber or Joined.
8. Account → Subscriptions is independent of saved pages and contains the viewer's subscriptions whether checked or unchecked. Management is explicit and remains available when a channel becomes unavailable or the viewer is banned.
9. Preserve Global as its own publication space, personal-space semantics, per-publication reports/interactions, aggregate source authority and accepted scalar playback restoration. No feed access proof is created from a catalog card or checkout redirect.

## Source Audit (accepted build46 baseline)

| Area | Current evidence and implication |
| --- | --- |
| [Discovery service](../../src/features/discovery/service.ts) | `directory()` selects explicitly listed spaces; `home()` renders genre subsets plus recent history. Unlisted/uncategorized spaces lack a dependable browse path. `saved()` and `savedDirectory()` filter through `canViewSpaceFeed`, hiding a legitimately saved paid/gated space. `save()` is already independent of enrollment; removal currently resolves the space first, preventing removal if even metadata access disappeared. |
| [Discovery schema](../../src/features/discovery/schema.ts) | Saved rows, explicit removals, one-time migration ledger, listings, genres and acknowledgments already exist. Preserve these instead of changing saves into memberships. Catalog visibility and feed visibility are separate today. |
| [Recent projection](../../src/features/discovery/service.ts) | `recent()` does not join current saved state before calling the card mapper, so Continue can show an unchecked box for an already saved space. Centralize current saved-state projection across all card surfaces. |
| [Discovery router](../../src/features/discovery/router.ts) | Authenticated save/read routes, strict query contracts and entry/accept/resume/visit paths exist. New search/catalog/relationship versions must be explicit; build46 and older web clients cannot be assumed to understand locked cards or new query parameters. |
| [Space view policy](../../src/features/spaces/service.ts), [repository](../../src/features/spaces/repo.ts) | Existing view decisions allow legitimate public/owner/admin/member/subscriber paths, with bans first and subscription deadlines bounding proofs. Viewability alone does not identify a subscription. Joining policy must preserve existing public/member access rather than infer that all spaces require a new subscription. |
| [Membership service](../../src/services/spaceMembership.ts), [space service](../../src/features/spaces/service.ts), [defaults](../../src/features/spaces/util.ts) | Invitation acceptance assigns real roles. Default groups/channels use invitation-based membership. No audited generic native self-join/free-subscribe flow exists. Add explicit configured actions; do not silently turn private spaces into open enrollment. |
| [Native adapters](../../mobile/src/discovery/api.ts), [cards](../../mobile/src/discovery/SpaceCard.tsx), [discovery UI](../../mobile/src/discovery/DiscoveryScreen.tsx) | Card DTO exposes saved/sign-in state but no structured membership, entitlement, price or next action. UI has Home/genre/saved/recent modes, no universal search/Browse Groups/Browse Channels. Reuse accepted sizing, checkbox, type cues and focus/cancellation behavior. |
| [EntryScreen](../../mobile/src/discovery/EntryScreen.tsx), [navigator](../../mobile/src/navigation/ViewerNavigator.tsx) | Entry handles sign-in, rules and one generic denial. New requirements need real server-derived actions while preserving About-only reading, exact-video intents, original-feed state and deliberate entry after fulfillment. |
| [Native account](../../mobile/src/auth/AccountScreen.tsx) | Account is currently sign-in/status/sign-out, with shared Menu and Done handling. Add a separate Subscriptions child screen, retaining account fields and menu-origin semantics. |
| [Payment service](../../src/features/payments/service.ts), [repository](../../src/features/payments/repo.ts), [types](../../src/features/payments/types.ts) | PayPal checkout, provider verification, subscription records and pending management actions exist. The audited payment records have no first-class channel binding or verified channel-entitlement projection; `space_subscriptions` is a separate user/space access table. No production writer linking these was found in the audited source. A support subscription is not automatically a subscription to a particular channel. |
| [Web payment routes](../../src/routes/feed-messages.ts), [web account/support](../../src/routes/pages.ts) | `/checkout/:intent`, PayPal return/webhook and subscription actions exist around browser account/message flows. They use browser `req.user`; they are not drop-in bearer-auth native channel APIs. Existing mock completion and seeded test-provider shortcuts must never grant production channel access. |
| [Web discovery](../../frontend/src/discovery/Discovery.tsx), [web card](../../frontend/src/discovery/SpaceCard.tsx), [saved panel](../../frontend/src/discovery/SavedSpacesPanel.tsx) | Shared projections affect two frontends. Qualify existing web entry/saves and expose new discovery paths deliberately; do not deploy a native-only DTO that breaks browser consumers or change `/`, `/global`, group/channel or publication links. |

## Product and Visibility Contract

### Independent state matrix

| Saved checkbox | Valid viewing entitlement | Saved-page behavior | Opening behavior |
| --- | --- | --- | --- |
| Checked | Yes | Card appears | Enter or request current rules acknowledgment |
| Checked | No | Card appears if its teaser is discoverable | Introduction, rules and supported join/subscription options |
| Unchecked | Yes | Card absent | Remains discoverable through Home/appropriate account relationships; access continues |
| Unchecked | No | Card absent | Home may show its permitted teaser; fulfillment required before viewing |

Rules acknowledgment, sign-in and bans are additional independent requirements. Paying does not override a ban or acknowledge rules. Subscribe/Join success does not check the shortcut box; Unsubscribe/Leave does not uncheck it. A refund/expiry can change access without changing saved placement.

### Home and recovery

- Keep Global, Following/Your Creations shortcuts, genre rows and Continue. Add visible Browse Groups, Browse Channels and search; saved-page empty states link to the corresponding browse route.
- Browse includes all eligible discoverable spaces, including uncategorized ones, not just the first genre page. Filters: type, genre and a trustworthy Free/Paid classification when configured; never infer Free merely from missing price data.
- Public catalog comes from explicit listing/discoverability settings, regardless of subscription. For authenticated viewers, union in authorized owned/joined/subscribed/invited relationships with narrowly permitted metadata; deduplicate by space ID. Personal spaces and Global retain separate destinations.
- Do not expand a site administrator's broad moderation privilege into an automatic public/private catalog dump. Ordinary relationship discovery should use explicit user/space relationships and policy; management-wide search is a separate administrative feature.
- Thus Admin can recover the known Test Channel through a real authorized relationship, without publicly listing it or relying on recent history. If that particular access is only an administrative override, expose a clearly private management/available-space route rather than changing its public listing.
- Owners still control public discoverability. No bulk listing of all database spaces, no automatic genre assignment and no changes to the user's chosen preview catalog. Publicly listed invite-only spaces can advertise a safe introduction when configured; an undiscoverable invitation-only space stays hidden from strangers.
- Search and pagination apply metadata authorization before result/count/cursor generation. Bound and normalize queries, use parameterized SQL, escape LIKE wildcards, bind opaque cursors to filters/scope/account, and handle empty/denied scan windows honestly. Defaults:20 results, max50; retain bounded scans and explicit More.

### Saved lists and cards

- Query explicit saved rows, then decide whether metadata can be shown; do not require feed permission to include a permitted teaser. Keep group/channel type filtering before pagination and explicit Global/personal exclusion.
- Newly inaccessible media remains gated, while a still-discoverable saved card stays checked. If the space is deleted or no longer even discoverable, preserve the user's save internally and offer a neutral removable Unavailable space row, without stale private names/artwork or permission details. Do not silently delete the row or grant metadata through it.
- Removing one's saved row must work even if the source is unavailable; a removal request cannot be used to enumerate other users' saves. Adding requires current discoverability/save permission and sign-in.
- Keep one checkbox, in the accepted lower-right position. Use labels such as Save [name] to Your Channels and feedback Removed shortcut; never Subscribed for a save. Do not place subscription cancellation on that checkbox.
- Show a compact independent status: Joined, Subscribed, Subscription required, Invitation required or Pending, only when the server can assert it. Owner/admin/complimentary/legacy access can have accurate distinct labels. Unknown/offline state is not rendered as Free or Subscribed.
- Keep artwork/title/launch, About & Rules and checkbox independent, with44-point targets, text scaling, responsive widths and keyboard/scroll/focus support. Badge color must not reuse the green checkbox as proof of membership or payment.
- Centralize saved-state lookup for Home/genres/search/Continue/saved pages/chooser/entry and web cards. Reconcile confirmed desired state after lost responses and refocus. Preserve existing pending-More, tab-switch, account/API-generation and removal-race protections.

## Entry and Fulfillment

### Server-derived next actions

Extend the entry projection with independent discoverability, saved state, relationship, access requirements and supported actions. Suggested requirements: sign-in, rules, join, free subscription, paid subscription, invitation/approval, unsupported age verification, or unavailable. Return only reasons/actions the server actually knows; a generic403 must not become a fabricated payment request.

- Already eligible with current acknowledgment: enter directly and restore the exact saved video/time/pause. An explicit About action always opens the document, even after acknowledgment.
- Required rules: show current published culture/rules, record the exact revision, then independently revalidate access before entry. Do not enable Plan184's staged mandatory enforcement globally without its existing editorial/compatibility work.
- Free self-service action: only for a space configured to allow it. Join group creates the actual approved membership; Subscribe free creates a distinguishable free channel grant. Neither writes provider payment records, saves, follows or acknowledgments implicitly.
- Invitation/approval: honor existing policy. A pending request does not grant a role or feed authority. Implement only the actions supported by real backend workflows; show an honest explanation otherwise. No owner/admin role assignment through viewer endpoints.
- Paid: show authorized plan options, price/currency/billing interval and renewal/trial details actually configured for the supported purchase route. An absent/archived/misconfigured plan produces a truthful unavailable state, never an arbitrary-price checkout.
- Purchase pending/canceled/failed: remain on a silent gate with retry/status reconciliation. A provider return/deep link or client-side success flag is only a prompt to recheck. Unlock only after verified entitlement projection and fresh rules/access confirmation.
- Keep bounded exact-publication/space intent through supported fulfillment. After account changes, background expiry or another selected destination, discard stale intents. Do not replay a Join/charge automatically after sign-in. Return from an external purchase flow requires current identity and a deliberate Continue; rules/payment pages never mount or preload protected feed media.
- Existing owner/admin/complimentary access remains a legitimate separate authorization path. Do not label it a paid subscription or accidentally revoke it when one billing source expires.

## Subscription Authority and Account UI

### Billing records versus channel access

Introduce explicit, auditable channel-plan/provider-product mapping; never infer a channel from a message title, Global recognition or unvalidated client metadata. The server selects price/plan/channel and binds each purchase to the authenticated viewer, channel, provider, environment and unique purchase intent.

Recommended storage responsibilities, finalized in Phase A:

- Reuse `viewer_saved_spaces` unchanged for placement, removals and migration history.
- Reuse actual membership/invitation records for groups and existing authorized roles; add only missing explicit self-service policy/configuration.
- Add a validated channel-plan mapping alongside the existing payment catalog, with free versus paid mode, currency/cadence and provider identifiers. Restrict publishing plans to authorized owners/managers.
- Add provider-neutral entitlement grants keyed by their real source, with user/channel, status, valid-from/until and verified event identity. Distinguish free, paid, complimentary and preserved legacy grants. The existing single user/space subscription row cannot safely express multiple overlapping providers by itself; define a transactional compatibility projection rather than overwriting unrelated access.
- Verified provider callbacks/server lookups update the matching billing/grant source idempotently. Compute effective access across valid grants; duplicate/out-of-order callbacks, renewals, refunds, expiry, cancellation and plan changes must not extend access incorrectly. Cancellation may leave a verified paid-through period; follow provider-derived effective dates rather than treating a button tap as immediate expiry.
- Payment state transitions must never write saved shortcuts, creator follows or rules acknowledgments. Legacy site-support/donation subscriptions remain separately labeled; do not retroactively attach them to arbitrary channels.

### Account → Subscriptions

A paginated authenticated child page shows the viewer's free and paid channel subscriptions whether checked or unchecked, with channel/plan, verified status, applicable price/cadence, current access end and supported management actions. Existing general support subscriptions can be a separately labeled section; do not silently omit them or call them channel access.

Show pending/canceled/expired status accurately. Provider IDs, credentials, raw webhook payloads and other viewers' billing information never enter the native DTO. Reading this page must not create a checkout. Status refresh is bounded and canceled on background/account/API changes.

For each subscription offer View channel and the existing independent Save checkbox when metadata is permitted. Manage/cancel/change-plan/restore follow the actual provider's supported flow, require deliberate user action and display pending until confirmed. Billing management remains accessible for the viewer's own subscription even if channel discovery/feed access is revoked. Never require a new payment to reach cancellation controls. Preserve Account form values, shared Menu Close/Back/Done and original feed time/pause.

### iOS purchase-path decision

As checked on 2026-10-29, Apple's rules distinguish in-app purchases, storefront-specific external purchase options and reader-app entitlements. The US storefront exception does not establish a universal external-checkout path. Reader eligibility is not automatic for a community/video app; Apple explicitly distinguishes social-networking apps. Verify the actual distribution/storefront/app classification before implementing native purchase links. Sources: [App Review Guidelines §3.1](https://developer.apple.com/app-store/review/guidelines/), [reader-app requirements](https://developer.apple.com/support/reader-apps/).

Recommend provider-neutral entitlement/billing contracts first. Phase A must select and document a production-capable iOS route for the intended storefronts: configured StoreKit products/verification or a permitted external flow with its actual requirements. Validate per-channel catalog scalability, merchant ownership and account binding. Do not assume existing PayPal browser checkout, browser cookies, a WebView, device User-Agent or a client-supplied platform string solves native purchasing. Existing web purchases may be recognized only through independently verified entitlements and applicable distribution rules. Recheck current official rules before implementation/release.

This decision affects paid purchasing, not whether independent saved shortcuts and discovery can be built. A catalog/free-entry preview may ship first, but cannot be called completion of paid fulfillment. If merchant/product/entitlement setup is not available, record that phase's dependency explicitly; do not expose a nonfunctional Buy button or silently drop the paid portion of this plan.

## API, Compatibility and Ownership

| Boundary | Planned contract |
| --- | --- |
| Catalog | Add a versioned discovery catalog/search endpoint for public listings plus the viewer's permitted relationship spaces. Keep legacy genre directory behavior compatible. Explicit query/type/genre/payment filters, bounded keyset cursor and safe teaser only. |
| Card | Add versioned saved/relationship/access-summary/price-summary fields. A summary is display data, never an access proof. New native adapters validate enums, IDs, sizes, timestamps, amounts and actions strictly. |
| Saved | Version the richer locked-card/unavailable projection so build46 and browser consumers are not silently changed. Preserve current unfiltered/typed v1 response shape, migration ledger and removals. Save remains a desired-state, authenticated, CSRF-safe operation; removal is authorized by saved-row ownership. |
| Entry/actions | Extend or version entry with actual requirements and capabilities, retaining existing policy document/revision and concrete publication context. New bearer-auth viewer Join/free-subscribe/fulfillment-status routes reuse domain services; web routes keep cookie/CSRF discipline. |
| Subscriptions | New authenticated viewer list/detail/action/status adapters resolve the principal via native session services, bind every action to that user's exact subscription and expose no provider secret. Pending management is not confirmed provider success. |
| Content | Feed/media/text/report/comment/follow routes continue independent authorization and required-entry checks. A saved card, visible price or active-looking UI never bypasses grants, bans or publication restrictions. Renewed expiry masks selected media in ordinary and aggregate feeds. |
| Cache/navigation | Personal cards and actions are account/API-generation scoped, no shared private-response caching. Request-start age bounds confirmations. Preserve64-point/safe-inset reserve, opaque full-picture loading, fresh pools on destination changes and bounded3-player within-feed preloading. |
| Web | Reuse the domain projection and safe new contracts in affected discovery/cards/entry/account consumers; preserve canonical links and unrelated checkout/support behavior. No broad web menu redesign in this increment. |

Use additive default-off capabilities and explicit compatible versions. No bulk backfill, catalog publication, membership policy change, source-rule enforcement rollout or paid grant migration is authorized simply by installing the new client. If an editorial change to Test Channel/public listings is proposed, prepare its exact effect separately; a public listing is unnecessary to fix the private recovery path.

## Phase Status

- A: Complete for the revised scope — accepted source protected; purchases explicitly deferred.
- B: Implemented and host-qualified — bounded catalog/search, typed saved metadata, current saved-state projection.
- C: Implemented and host-qualified — native/web browsing, status badges and independent checkbox.
- D: Implemented and host-qualified — server-configured free join/subscription and invitation acceptance; no new paid fulfillment.
- E: Implemented and host-qualified — independent channel records and separately labeled existing support billing/cancellation.
- F: Deferred by the user — actual purchases and provider-to-channel paid entitlement mapping.
- G: Host qualification, guarded primary promotion and live API/browser smoke passed. Focused physical playback checks passed.
- H: Final signed build48 source/export/archive/downloaded artifact verified; all three focused iPhone acceptance bundles passed.

The detailed checklists below retain the full original design/test envelope. Unchecked items include deferred paid work and broader device/load scenarios, and are not claims of completed qualification. The implementation record and evidence below define what shipped.
### Phase A — Contracts and accepted-baseline protection

- [ ] Capture clean `b9ec2f6`, accepted build46 fingerprint/artifact references and current schema/index/provider capabilities. Preserve Plan184 rollout gates.
- [ ] Lock the four save/access combinations and all independent relationship/rules/Follow states. Record safe public/relationship/hidden discovery predicates, including owner/admin/legacy/ban cases and Test Channel recovery.
- [ ] Define explicit compatible DTO/query/cursor/action versions, policy source and status/expiry mapping. Specify what an unconfigured space displays; do not invent Free/paid requirements from missing configuration.
- [ ] Resolve intended iOS storefronts, actual purchase route, channel-plan/provider mapping, merchant/product ownership and effective subscription periods before dependent purchasing implementation. Choose the supported free join/subscription policy without altering invitation-only defaults.
- [ ] Specify additive schema/indexes/capabilities, retention and rollback; no new mass saved-list migration. Prepare disposable fixtures for all state combinations.
- Test gate: contract tables cover checked/unentitled and unchecked/paid-active, uncategorized/relationship-only space discovery, bans, deleted spaces, unknown status and old clients.
- Acceptance: placement, relationship, billing, rules and viewing authority have separate sources and truthful UI states.

### Phase B — Catalog, search and persistent gated shortcuts

- [ ] Add bounded search/Browse Groups/Browse Channels across eligible listed and viewer-relationship spaces, including uncategorized entries; deduplicate before paging and authorize counts/cursors.
- [ ] Centralize batched card/saved/relationship projection; fix Continue's missing current saved state. Avoid per-card membership/provider requests and qualify query plans at realistic relationship sizes.
- [ ] Add rich saved-card queries based on metadata discoverability rather than feed access, with neutral removable unavailable rows and stable typed paging. Preserve v1 callers and explicit removals.
- [ ] Permit saving a discoverable gated space; allow removal of one's own unavailable shortcut without source-media access. Assert no membership/subscription/Follow/acknowledgment writes.
- Test gate: isolated SQL/API cases for listed paid stranger, unlisted legitimate relationship, hidden unrelated viewer, both channel fixtures, uncategorized search, >200 rows, removal/re-save, missing source and cross-account cursor reuse.
- Acceptance: unchecking does not make an otherwise discoverable/associated channel unrecoverable; gated checked cards remain visible without granting media.

### Phase C — Browse UI, status badges and independent checkbox

- [ ] Add Home browse/search routes and matching saved-page empty-state recovery actions, retaining genre/Continue layout and menu order. Integrate new rows without imposing a first50/first-genre ceiling.
- [ ] Add separate trustworthy status/price labels while retaining existing artwork, type cues, widths and checkbox geometry. Card title/launch, About and checkbox remain independent.
- [ ] Reconcile the same saved ID across every visible section/page and on refocus/cross-device refresh. Retain explicit desired-state writes and cancellation/late-response guards.
- [ ] Update affected web discovery/cards/saved UI for parity without redesigning the site menu. Native-only capability does not turn on unsupported web purchasing.
- Test gate: actual components at narrow/wide/large-text sizes; keyboard search, filter changes during More, failed/uncertain save, removal during page load, unavailable-row removal, Account replacement, browser parity and no hidden feed input/audio.
- Acceptance: saved placement and membership/subscription status are visually and behaviorally distinct.

### Phase D — Requirements and free entry

- [ ] Extend entry with server-derived next actions, preserving About-only reading, rules revision and direct entry when already eligible.
- [ ] Implement idempotent Join/Subscribe free only for explicitly supported self-service policies, using real relationship/grant storage. Invitation/approval remains enforced; no viewer privilege escalation.
- [ ] Keep saves, follows, billing and acknowledgments untouched by enrollment except the user's separately explicit actions. Surface pending/unavailable/unknown outcomes honestly.
- [ ] Revalidate independently after fulfillment; preserve bounded exact-video/return intent and require deliberate retry after uncertain completion/account change.
- Test gate: public existing access, rules-first, open self-join, free-subscribe, invitation-only, approval pending, combined requirements, changed rules during enrollment, duplicate request, lost response and direct API bypass attempts.
- Acceptance: supported free entry works end to end, and unsupported requirements never fabricate successful enrollment.

### Phase E — Account subscriptions and management

- [ ] Add authenticated paginated channel subscription/own-billing projections independent of saved state, with accurate free/paid/legacy/support distinctions and effective dates.
- [ ] Add Account → Subscriptions, shared Menu/Back/Done behavior and provider-supported explicit management/status/restore actions. Cancellation remains reachable when source discovery is denied.
- [ ] Adapt existing billing services through verified native principals; enforce user/subscription/provider/environment ownership and pending-action reconciliation. Never invoke browser `req.user` routes as if they accepted native bearer sessions.
- [ ] Preserve ordinary Account drafts, original feed state and background/account privacy clearing.
- Test gate: unchecked active paid subscription still listed/manageable, checked unentitled channel absent from active subscriptions, pending/expired/canceled variants, subscription belonging to another user, denied channel but allowed own cancellation, duplicate management and false callback success.
- Acceptance: subscription management is authoritative and reachable independently of the space changer.

### Phase F — Verified paid channel access (deferred by user)

- [ ] Implement the Phase A selected iOS purchase route and required product/account configuration, plus compatible web purchase-to-channel binding. Keep providers behind domain adapters, not UI state.
- [ ] Add channel-plan mapping and source-specific grants/effective-access projection; preserve legitimate legacy/owner/admin/complimentary access and unrelated support billing.
- [ ] Verify purchase/provider events server-side with account/channel/plan/environment binding, idempotency and ordering. Keep sandbox/test/mock events isolated from production grants.
- [ ] Handle pending/failed/canceled checkout, renewals, end-of-term cancellation, expiry, refund, restore and plan change; synchronize access deadlines with the existing confirmation manager and aggregate source renewal.
- [ ] Never auto-save/Follow/join or acknowledge rules on payment. After verified access, recheck current rules and offer deliberate Continue to the intended space/publication.
- Test gate: sandbox full purchase and management lifecycle for checked and unchecked channels; forged returns, price/plan/channel/account tampering, duplicate/out-of-order callbacks, concurrent purchases, wrong environment, entitlement projection failure and access loss during playing/paused/covered feeds.
- Acceptance: valid paid access unlocks only its intended scope after server confirmation; no payment/management UI is inert or falsely successful. Real-money transactions are not required for automated qualification.

### Phase G — Integration and compatibility

- [ ] Run appropriate backend build/API tests, native unit/rendered/typecheck and affected isolated web checks. Do not substitute existing build46 counts for new coverage.
- [ ] Use disposable database/provider-sandbox fixtures, never mutation scripts against the live API beside3300. Preserve user saves/subscriptions, cultures, listings, sessions and fixture publications; document any separately authorized preview data changes.
- [ ] Qualify old-client/version/rollout behavior and shared server enforcement, including direct media/text/report/comment/Follow paths, ordinary and aggregate expiry, and catalog-card proof rejection.
- [ ] Reproduce Test Channel unsave → Home browse/search → save without changing membership or public listing; verify saved-unpaid and unchecked-paid cases end to end.
- [ ] Verify menu/forms/Account/entry/rule-view returns, exact publication/position/pause, opaque silent loading/readers/purchase screens, fresh destination pools, smooth within-feed paging and pending-request cancellation.
- [ ] Check docs/links/whitespace against the16-finding baseline and guard primary promotion against captured accepted bytes. Scope web builds/deployments to actual web changes.
- Acceptance: complete independent placement/access behavior and working supported fulfillment/management with no regression to accepted46.

### Phase H — Delivery and focused phone acceptance

- [ ] Use the next available preview number (47 is not reserved). Verify source manifest, export/archive whitelist, downloaded IPA/source/API/native modules/provisioning and OTA policy before sharing.
- [ ] Phone1: discovery/search/type/status/price layout, all three channel recovery paths, gated-card saving and independent checkbox behavior in Home/saved/Continue/chooser.
- [ ] Phone2: free/rules/paid-sandbox entry, pending/canceled/success states, no checkbox changes from enrollment/payment, unchecked subscription present in Account and explicit supported management.
- [ ] Phone3: paused/playing/reopen restoration, clear audio, silent Home/rules/account/purchase/loading, smooth swipes, correct source Report/About and shared Menu/form returns.
- [ ] Record qualitative versus numeric/VoiceOver/other-device/payment-environment limits. A discovery-only preview is a partial phase, not full paid-feature completion; any deferred scope requires an explicit recorded user decision.
- [ ] Reconcile feedback, scoped cleanup and final plan/index/roadmap. Commit/push only when requested; this planning request does not authorize implementation or publication.
- Acceptance: explicit focused acceptance of the delivered scope with preserved build46 comparison and no unexplained omitted paid/account phase.

## Files and Ownership

- Shared discovery: [service](../../src/features/discovery/service.ts), [router](../../src/features/discovery/router.ts), [schema](../../src/features/discovery/schema.ts), [viewer boundary](../../src/routes/viewer.ts).
- Native: [DiscoveryScreen](../../mobile/src/discovery/DiscoveryScreen.tsx), [card](../../mobile/src/discovery/SpaceCard.tsx), [adapters](../../mobile/src/discovery/api.ts), [entry](../../mobile/src/discovery/EntryScreen.tsx), [Account](../../mobile/src/auth/AccountScreen.tsx), [navigator](../../mobile/src/navigation/ViewerNavigator.tsx), [menu origins](../../mobile/src/navigation/menuNavigation.ts). Add focused browse/subscription screens and stores beside these; avoid embedding provider logic in the navigator.
- Domain: [space policy](../../src/features/spaces/service.ts), [space repository](../../src/features/spaces/repo.ts), [membership](../../src/services/spaceMembership.ts), [payment service](../../src/features/payments/service.ts), [payment repository](../../src/features/payments/repo.ts), [provider boundary](../../src/features/payments/provider.ts), [existing browser payment routes](../../src/routes/feed-messages.ts). Add dedicated channel-plan/grant and native subscription adapters with explicit ownership.
- Playback: preserve [access manager](../../mobile/src/auth/accessManager.ts), [aggregate renewal](../../mobile/src/auth/useAggregateAccess.ts), [FeedScreen](../../mobile/src/feed/FeedScreen.tsx), [aggregate service](../../src/features/aggregate-feeds/service.ts), [source confirmation](../../src/features/native-sessions/access.ts) and [space view policy](../../src/features/spaces/service.ts). Catalog summaries never seed playback grants.
- Web: [Discovery](../../frontend/src/discovery/Discovery.tsx), [SpaceCard](../../frontend/src/discovery/SpaceCard.tsx), [saved panel](../../frontend/src/discovery/SavedSpacesPanel.tsx), [pages/support](../../src/routes/pages.ts).
- Qualification: [discovery checks](../../scripts/check-discovery.ts), [isolated SQL pattern](../../scripts/check-aggregate-sql.ts), [actual discovery tests](../../mobile/tests/rendered/discovery.test.cjs), [destination tests](../../mobile/tests/rendered/destinations.test.cjs), [card tests](../../mobile/tests/rendered/spaceCards.test.cjs), [payment smoke](../../scripts/smoke-payments.sh). Add meaningful discovery/entry/grant/subscription cases; do not replay live mutation scripts as generic smoke.

## Open Risks / Decisions / Deferred

- Purchase-route/storefront, per-channel product catalog and merchant setup must be decided before paid checkout implementation. The plan includes paid fulfillment, but does not assume this community app qualifies for reader-app exceptions or authorize live charges.
- Distinguish metadata discoverability from view authority, and real relationships from broad admin access. “All spaces” means all spaces eligible for that viewer/surface; no blanket private-space disclosure or automatic public catalog publication.
- Existing active channel access may come from roles, public policy or legacy grants. It is not reliable evidence of a free/paid subscription. Preserve access during compatible migration and label unknown origin honestly.
- Mixed billing sources, paid-through dates, legacy access and safe cancellation while banned require a source-based entitlement model, not one overwritten boolean. Expiry must propagate to ordinary and aggregate viewing.
- Search result counts, stale cards, shared caches and unavailable saves can leak private metadata unless visibility is applied consistently. A user must still be able to remove an unavailable shortcut and manage their own billing.
- New native adult/age-verification distribution, Android, moderation tools, creator payouts/tax handling, learned discovery ranking, private messages, universal links and a broad web navigation overhaul remain separate. Do not import web-only spaces into iOS search as a side effect; apply the existing surface policy without claiming the future age system is implemented.
- Plan184's editorial/mandatory-entry compatibility gates remain separate; no globally enabled rule enforcement or mass space/policy edits are part of merely adding this UI.

## Implementation Record and Validation

- Worktree implementation is based on accepted main `b9ec2f6`; primary source protected by a private1305-file hash snapshot including the approved plan. No agents or skills used. Existing build46 source/artifact and acceptance records remain intact.
- Added explicit v2 catalog, Home, saved collections, recent projection, entry, desired-state save, configured enrollment and Account subscriptions endpoints. V1 clients retain their old DTO/routes. Catalog pagination is scoped keyset pagination; it never uses a catalog DTO as media access proof.
- Discovery includes explicitly listed spaces plus actual ownership, scoped role, active subscription or pending invitation relationships. Site-admin status alone does not reveal all unlisted spaces. Unlisted related Test Channel can be found without publicly listing it or rechecking it on the user's behalf.
- `settings.viewerEntry` supports existing/open_group/free_channel/paid_channel/invitation. Owner-authorized editor changes only this configuration. Missing configuration preserves existing access and does not fabricate a free/paid claim. Rules revisions, bans, real membership/subscription writes and post-action revalidation remain server-controlled. Configured gates also constrain direct feed access. No production space options were changed.
- Additive schema: `discovery_state.native_catalog` defaults off; nullable saved `space_type` retains neutral removable rows after future deletion. Existing alive-row type backfill explicitly preserves `updated_at` and `removed`; no saved ordering/placement changes. Already-deleted historic rows with no recoverable type cannot be classified retrospectively.
- V2 marks the existing migration ledger without seeding saves, preventing subscription/join from auto-saving for new v2 viewers. Existing explicit removals remain unchanged; legacy v1 behavior is retained for older clients.
- Native Home and saved pages gain Browse Groups/Channels, bounded search, channel free/paid filters and independent status/price labels. Entry supports explicit free/invitation actions with required rules. Paid entry remains a truthful informational gate. Account → Subscriptions paginates actual channel access records and separately labels PayPal site-support billing. Only confirmed explicit cancellation of the viewer's own existing support billing is supported; UI shows pending provider reconciliation rather than claiming immediate termination. Unknown legacy channel grants are not called verified paid subscriptions.
- Shared web discovery/cards/editor use the same configured gates, searchable catalog, checked state and safe unavailable rows; existing site menu preserved. No web checkout or paid-grant bridge is added.
- Final [build48](https://expo.dev/accounts/mbcollins2/projects/aws-video-feed-poc/builds/79905b7a-a65c-4e45-9d11-973bd1599e15) source `366faaea625e78b04d01681b96c055f0fc8339e055da23cc7d54c781a60c0304` is frozen and matches primary. Export,182-file exact archive/whitelist and downloaded IPA signing/source/API/native-module checks pass. IPA8458570 bytes, SHA256 `ba82230b65c5b1aafec57c6a8f5a7fd8057e18c570bf55d2f5ad2c74fe1d1797`; registered devices match accepted26, OTA disabled. Supersedes47 after whitespace cleanup; no functional native change after host qualification. The user accepted all three focused iPhone bundles on 2026-10-30 UTC.
- Newly run265 native unit and128 rendered tests pass, with native/web/backend type/build checks. Final isolated SQL/API146 and real-browser13 checks pass. Controlled loopback browser qualification strips its loopback Origin header as prior QA does; no product CORS change. Provider cancellation tests use disposable `I-TEST` records and no real provider calls/charges.
- SQL/API uses a separate disposable MariaDB server/database; original database is read only during fixture acquisition. Coverage includes >200 saved rows, cursor scope, no hidden unrelated metadata, save/access independence, no enrollment privilege escalation, required rules, duplicate free enrollment, pending invitations, unavailable removal, no subscription reseeding, support pagination and cross-user cancellation denial. Browser checks use real compiled UI and server, covering save/remove, paid gate without hidden video, related search and Home browse.
- Guarded promotion checked all1305 captured primary files before copying exactly24 authorized source/docs/test files, then verified exact primary native source identity. Qualified web assets were merged with old cached assets retained and the new index replaced atomically. Primary backend build/native typecheck pass.
- Enabled only the additive catalog capability. Before/after read-only hashes match for saves (including ordering/removals), channel subscriptions, space settings, listings/placements, payment rows and old rollout flags. New migration ledger reads may record that v2 deliberately skips legacy auto-seeding; no live enrollments or cancellations were made.
- Actual local/HTTPS34 API/route checks and25 live HTTPS browser checks pass. Test Channel is recoverable through its real owner's relationship without public listing. Its current checked state was preserved, not restored by this implementation. Old and new Global APIs, Home/history/deep-link handling and anonymous/private route boundaries pass. The disposable QA server/data were stopped/removed after qualification.
- Documentation retains the same16 pre-existing findings; all114 local links resolve and whitespace check passes. Original phase checklists remain a broader design envelope; payment and broad device/load cases are explicitly unqualified.
- Paid purchase lifecycle, StoreKit, reader-app eligibility, new age/surface distribution systems, new ranking axes, broad VoiceOver/device/load qualification and broader physical audio/pixel instrumentation remain outside this delivered host evidence. No new public fixture spaces, checkout, purchases, live enrollments or live cancellations are performed.
- Rollback: disable only `discovery_state.native_catalog`; retain additive columns, saved choices and qualified hashed assets. Do not revert user enrollment/configuration made after rollout or alter separate Plan184 enforcement flags.
- Public ignored evidence: source/export/archive/artifact JSON and browser screenshot under `tests/runs/build/plan_188/`. Credentials, fixture identities, raw API/EAS logs and URLs remain private. No commit/push requested.

## Change Log

- 2026-10-30 UTC — User accepts all three build48 phone bundles: related channel recovery and independent saved placement/status; Account subscriptions and Menu/Back; saved position/pause/reopen, clear audio, silent screens, smooth swipes and reporting. Revised milestone complete; purchases remain explicitly deferred and changes uncommitted.
- 2026-10-29 (Pacific) — User authorizes implementation and explicitly defers actual purchases. Implemented revised A–E/G, qualified signed48, and retained pending physical acceptance and separate billing boundaries.
- 2026-10-29 (Pacific) — User clarifies independent checkbox placement versus membership/subscription/access, agrees to discoverable pre-access introductions/pricing and independent Account subscriptions, and requests an implementation plan. Audited saved/catalog/entry/relationship/payment boundaries and prepared A–H with paid-path dependencies explicit.

## Resume Here

All three focused build48 phone bundles passed; the revised non-purchase milestone is complete. Preserve Phase F as deferred and retain broader device/load/payment limits. No commit/push until requested. The user has begun discussion of a progress indicator/scrubber and moving the creator/date panel fully inside the video; no implementation of that next feature is authorized yet.

## Commit delivery

- Implementation committed as `2652677` after explicit user request to commit and push. Includes accepted Plan188 discovery/independent shortcuts/subscription gates and Plan189 scrubber through build52. No new purchase support. Push verification follows; broader physical coverage limits remain as recorded.
