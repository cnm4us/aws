# Plan 140: Support Us + My Support (Donations & Subscriptions)

Status: Planned

## Context
- We currently have separate `donate` and `subscribe` CTA flows.
- We want a unified `support` flow from messages that lets users choose:
  - recurring subscription tier(s)
  - one-time donation amount (preset or custom)
- We also want a user-facing account surface to review and manage support over time.

## Goals
- Introduce a single `Support Us` conversion surface.
- Add `My Support` account management surface.
- Keep provider webhooks as source-of-truth for financial state.
- Preserve current working donate/subscribe flow while migrating.

## Locked Decisions
- `support` is a CTA intent/routing construct, not a new global analytics taxonomy dimension.
- Custom donation bounds (v1):
  - minimum: `100` cents (`$1.00`)
  - maximum: `50000` cents (`$500.00`)
  - step: `100` cents (`$1.00`)
  - currency: `USD` only
- Subscription semantics (v1):
  - one active subscription per user
  - tier changes are plan-change actions (upgrade/downgrade), not parallel subscriptions
- Cancellation policy (v1):
  - end-of-period cancellation
  - states: `active` -> `cancel_scheduled` -> `canceled`
- Refund/chargeback policy (v1):
  - record payment reversals
  - do not auto-unsuppress message campaigns
  - manual admin reset can be added later
- Privacy/visibility (v1):
  - users see only their own support data
  - admin gets campaign aggregates + restricted user-level views
  - redact sensitive payment details from standard logs
- Reporting scope (v1):
  - include campaign-level support reporting before advanced finance exports
- Suppression architecture for multi-CTA messages:
  - use two layers:
    - eligibility suppression (pre-insert, rule-based) keyed to campaign purpose
    - completion suppression (post-action) keyed to campaign/message scope
  - suppression is never keyed to CTA slot
  - CTA slot/intent remain analytics attribution dimensions only

## Out of Scope (for this plan)
- Full tax documents / jurisdictional tax logic.
- Payout and accounting ledger export pipelines.
- Multi-currency exchange-rate handling.

## Target UX
- Message CTA intent `support` routes to `/support`.
- `/support` shows:
  - active subscription tiers (`subscribe_plan`)
  - donation presets + custom amount
  - provider options (PayPal first, extensible)
- Authenticated users get `/my/support`:
  - donation history
  - active/past subscriptions
  - upgrade/downgrade/cancel/resume actions

## Data Model Direction
- Continue using `payment_checkout_sessions` as initiation/session store.
- Add durable transaction/subscription state tables:
  - `payment_transactions`
    - one row per completed/failed financial attempt
    - includes provider ids, amount, currency, user, campaign, timestamps
  - `payment_subscriptions`
    - one row per provider subscription
    - provider subscription id, user, plan key/catalog item, status, period dates
  - `payment_subscription_events` (optional in phase 1, can be phase 2)
    - status timeline for audits/debugging
- Keep `payment_webhook_events` idempotent ingest log; reconciliation derives final state.

## Phase Status
- A: Pending
- B: Pending
- C: Pending
- D: Pending
- E: Pending
- F: Pending
- G: Pending

## Phase A — CTA + Routing Foundation
- Goal:
  - Add `support` intent in CTA definitions and route it cleanly.
- Steps:
  - [ ] Add `support` to message CTA intent enum/domain validation.
  - [ ] Update message CTA admin UI to allow `support`.
  - [ ] Route `support` CTA to `/support` with message context and analytics tags.
  - [ ] Preserve existing `donate`/`subscribe` behavior.
- Acceptance:
  - A message can use CTA intent `support` and reaches `/support`.

## Phase B — Support Us Page (Read + Selection)
- Goal:
  - Build `/support` page with tier and donation options.
- Steps:
  - [ ] Add server-rendered `/support` page (initially) with mobile-first layout.
  - [ ] Query active catalog items (`subscribe_plan`, `donate_campaign`).
  - [ ] Add donation custom amount input with validation bounds.
  - [ ] Add selection action that posts to checkout-start endpoint.
- Acceptance:
  - User can choose tier or donation amount and start checkout.

## Phase C — Checkout Session Expansion
- Goal:
  - Support dynamic amount/plan metadata from `/support`.
- Steps:
  - [ ] Extend checkout start payload with selected catalog item and optional custom amount.
  - [ ] Persist selected option metadata to `payment_checkout_sessions.metadata_json`.
  - [ ] Ensure amount shown to provider matches persisted amount.
  - [ ] Ensure return flow and suppression metadata still propagate.
- Acceptance:
  - Selection from `/support` results in consistent session/provider amount metadata.

## Phase D — Transaction & Subscription Persistence
- Goal:
  - Normalize completed payments/subscriptions for account views.
- Steps:
  - [ ] Add `payment_transactions` table + migration.
  - [ ] Add `payment_subscriptions` table + migration.
  - [ ] On verified completion/capture/webhook, upsert transaction record.
  - [ ] On subscription events, upsert subscription record/status.
- Acceptance:
  - Completed support actions are queryable without parsing raw sessions/webhooks.

## Phase E — My Support (Read-Only)
- Goal:
  - Deliver user-facing support history dashboard.
- Steps:
  - [ ] Add `/my/support` route + page shell.
  - [ ] Show totals (lifetime, last 30 days) and recent donations.
  - [ ] Show current subscription(s) and status.
  - [ ] Add “Support again” shortcuts to `/support`.
- Acceptance:
  - Authenticated user can view personal support history and current status.

## Phase F — Subscription Lifecycle Actions
- Goal:
  - Allow upgrade/downgrade/cancel/resume from `/my/support`.
- Steps:
  - [ ] Add action endpoints (`/api/payments/subscriptions/...`) with auth checks.
  - [ ] Implement provider adapter methods for subscription management (PayPal first).
  - [ ] Mark changes as pending until webhook confirmation.
  - [ ] Surface status + error states clearly in UI.
- Acceptance:
  - Subscription lifecycle actions work and converge on webhook-confirmed state.

## Phase G — Observability, Reconciliation, and Tooling
- Goal:
  - Make support flows debuggable and recoverable.
- Steps:
  - [ ] Add Jaeger/Pino tags for support path (`support_option`, `catalog_item_id`, `custom_amount`).
  - [ ] Add debug bundle payment/support presets and summary checks.
  - [ ] Add reconciliation script:
    - detect sessions with no transaction rows
    - detect stale pending subscriptions
  - [ ] Add operator CLI queries:
    - donations by user/date/amount
    - active subscriptions by tier/status
- Acceptance:
  - We can diagnose and reconcile support data without manual DB spelunking.

## Open Issues (To Discuss)
- Product taxonomy:
  - Is `support` a new CTA intent only, or also a campaign/category dimension?
- Custom donation bounds:
  - min/max amounts and allowed increment rules.
- Subscription semantics:
  - one active subscription per user vs multiple concurrent subscriptions.
- Cancellation policy:
  - immediate cancel vs end-of-period.
- Refund/chargeback policy:
  - how to reflect in `My Support` and suppression decisions.
- Data privacy:
  - what donor/subscription data is visible to admins vs users.
- Reporting scope:
  - do we need per-campaign donor totals in admin before user self-service actions?

## Validation Strategy
- Unit:
  - support option selection -> checkout payload mapping.
  - donation amount validation and normalization.
- Integration:
  - `/support` selection -> checkout start -> completion -> transaction record.
  - subscription webhook -> subscription status update.
- Runtime smoke:
  - message CTA `support` conversion path.
  - `/my/support` history reflects latest successful actions.
- Observability:
  - Jaeger traces include route + provider + support option + status transitions.

## Resume Here
- Next action:
  - Discuss open issues and lock decisions for Phases A/B (especially taxonomy + bounds).
