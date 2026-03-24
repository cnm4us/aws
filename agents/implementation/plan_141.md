# Plan 141: Provider-Native Subscriptions (PayPal Billing)

Status: In Progress

## Context
- Current `subscribe` checkout is still PayPal Orders/Capture.
- That produces `PAYMENT.CAPTURE.*` events, not true subscription lifecycle events.
- We now have lifecycle action plumbing (`cancel/resume/change_plan`) and durable tables, but need real provider-native subscription IDs/events.

## Goal
- Convert subscription purchase flow to PayPal Billing Subscriptions API so:
  - initial subscribe creates a real provider subscription id
  - webhooks (`BILLING.SUBSCRIPTION.*`) become authoritative lifecycle signal
  - `/my/support` lifecycle actions operate on real subscriptions

## Non-Goals
- Multi-provider expansion (Stripe/Square) in this plan.
- Tax invoice/ledger exports.
- Full finance reconciliation UI (CLI/tools already in place from Plan 140 G).

## Preconditions
- `payment_catalog_items.kind='subscribe_plan'` rows must have:
  - `status='active'`
  - `provider='paypal'`
  - `provider_ref` = PayPal `plan_id` (required)
- PayPal app/webhook configured for subscription events.

## Key Design Decisions
- Keep `donate` on Orders/Capture flow.
- Move only `subscribe` to Billing Subscriptions API.
- Webhook-confirmed state remains source of truth for final subscription status.
- Return route may show pending/accepted, but no final status without webhook.

## Phase Status
- A: Completed
- B: Completed
- C: Completed
- D: Completed
- E: Pending
- F: Pending

## Phase A — Data & Contract Tightening
- Goal:
  - Enforce clean subscription catalog contract.
- Steps:
  - [x] Add validation path for `subscribe_plan` requiring non-empty `provider_ref`.
  - [x] Add diagnostics for invalid subscription catalog rows (CLI/report).
  - [x] Keep backwards compatibility for existing rows (no destructive migration).
- Acceptance:
  - Starting a subscribe checkout fails fast with clear error if plan mapping is invalid.

## Phase B — Provider Adapter: Create Subscription
- Goal:
  - Add PayPal create-subscription API support.
- Steps:
  - [x] Extend provider adapter with `createSubscriptionSession(...)`.
  - [x] Implement PayPal call (`/v1/billing/subscriptions`) using `plan_id=provider_ref`.
  - [x] Return approval URL + provider subscription id (if available at create).
  - [x] Add robust error mapping (`paypal_subscription_create_failed`, etc.).
- Acceptance:
  - Adapter can create a real PayPal subscription approval flow.

## Phase C — Checkout Routing & Session Persistence
- Goal:
  - Route `subscribe` checkout to native subscription path.
- Steps:
  - [x] In `payments.createCheckoutSession`, branch by intent:
    - donate => existing order/capture
    - subscribe => new subscription create path
  - [x] Persist provider subscription/session identifiers on checkout session.
  - [x] Preserve message attribution metadata and support source tags.
  - [x] Keep `/checkout/:intent` UX unchanged for user where possible.
- Acceptance:
  - Subscribe path no longer creates order-capture as primary mechanism.

## Phase D — Webhook Lifecycle Convergence
- Goal:
  - Ensure subscription lifecycle events update durable records end-to-end.
- Steps:
  - [x] Expand webhook handling for:
    - `BILLING.SUBSCRIPTION.CREATED`
    - `...ACTIVATED`
    - `...UPDATED`
    - `...SUSPENDED`
    - `...CANCELLED`
    - `...EXPIRED`
  - [x] Upsert `payment_subscriptions` with user/linking when known.
  - [x] Clear pending action fields on confirming lifecycle events.
  - [x] Ensure `payment_transactions` only captures true transaction events (captures/refunds), not lifecycle-only events unless explicitly desired.
- Acceptance:
  - Lifecycle actions + webhooks converge deterministically in `payment_subscriptions`.

## Phase E — `/my/support` Lifecycle UX Hardening
- Goal:
  - Make account page reflect valid actions by state.
- Steps:
  - [ ] Hide/disable invalid actions based on status:
    - `active`: cancel/change-plan
    - `canceled|suspended`: resume
  - [ ] Show clear pending state text + last webhook event.
  - [ ] Show action errors/notices with user-safe messaging.
- Acceptance:
  - User can only trigger coherent actions from current status.

## Phase F — Observability, Smoke, and Migration Safety
- Goal:
  - Validate production-readiness of native subscription flow.
- Steps:
  - [ ] Add Jaeger tags for subscription create path (`plan_key`, `provider_ref`, `provider_subscription_id`).
  - [ ] Add/adjust Jaeger presets for subscription create + lifecycle events.
  - [ ] Add smoke script for native subscription flow (sandbox).
  - [ ] Add one-time migration guard/report:
    - identify old subscribe checkouts that were capture-based
    - classify as legacy for UI/reporting clarity.
- Acceptance:
  - We can verify native subscription behavior from checkout through webhook settlement with existing debug/reconcile tools.

## Risks & Mitigations
- Risk: Mixed legacy subscribe records (capture-based) and new native subscription records.
  - Mitigation: explicit legacy classification/reporting in Phase F.
- Risk: Missing/incorrect `provider_ref` on plans.
  - Mitigation: strict validation in Phase A + admin diagnostics.
- Risk: Out-of-order or duplicate webhooks.
  - Mitigation: existing dedupe + idempotent upserts; reinforce event ordering logic in Phase D.

## Smoke Validation (High-Level)
1. Start subscribe from `/support` with valid plan.
2. Approve in PayPal sandbox.
3. Confirm webhook events populate/update `payment_subscriptions`.
4. Run `/my/support` action:
  - cancel
  - resume
  - change plan
5. Confirm pending -> final status transitions via webhook.
6. Run:
  - `npm run jaeger:query -- preset support_pipeline --lookback 30m --summary`
  - `npm run payments:reconcile`
  - `npm run db:query:subscriptions`

## Resume Here
- Next action:
  - Start Phase E: `/my/support` lifecycle UX hardening.
