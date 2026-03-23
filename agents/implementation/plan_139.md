# Plan 139: PayPal-First Payments With Multi-PSP Architecture

Status: In Progress

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - We need real payment completion signals for message CTA flows (`donate`, `subscribe`) so suppression is based on verified completion, not click.
  - We want PayPal first, but design for future PSPs (Stripe/Square/etc.) without reworking message CTA architecture.
- In scope:
  - Internal checkout page with provider choice.
  - Payment provider abstraction and PayPal adapter.
  - Admin payment configuration (sandbox/live) and product/plan mapping.
  - Webhook-verified completion pipeline integrated with message suppression.
- Out of scope:
  - Full accounting/payout ledger.
  - Tax/VAT automation.
  - Provider-specific advanced features beyond initial checkout + completion.

## Locked Decisions
- First provider: PayPal.
- Checkout flow is internal page first (`/checkout/:intent`), then provider redirect.
- Completion source of truth is provider webhook verification (not just browser return).
- Keep slot-based CTA model; payment plumbing consumes slot intent/executor context.
- Environment split required: `sandbox` and `live`.

## Target Architecture
- `Payment Intent`:
  - Business action (`donate`, `subscribe`), linked to message context.
- `Payment Provider Adapter`:
  - Interface methods: `createCheckoutSession`, `verifyWebhook`, `parseCompletion`.
- `Checkout Session`:
  - Internal record tracks payment lifecycle and correlation to message intent/suppression.
- `Webhook Event Store`:
  - Idempotent storage + processing status.
- `Suppression Bridge`:
  - On verified completion, call message attribution suppression with campaign/message scope.

## Proposed Data Model (Draft)
- `payment_provider_configs`
  - `provider` (`paypal`), `mode` (`sandbox|live`), encrypted credentials, enabled flags by intent.
- `payment_catalog_items`
  - `kind` (`donate_campaign|subscribe_plan`), label, amount/currency (if applicable), provider mapping ids.
- `payment_checkout_sessions`
  - `id`, `provider`, `intent`, `status`, `user_id`, `message_id`, `message_campaign_key`, `message_intent_id`, `amount/currency`, `provider_session_id`, `return_url`, timestamps.
- `payment_webhook_events`
  - `provider`, `provider_event_id` (unique), payload, signature status, processed status, processed_at.

## Phase Status
- A: Complete
- B: Complete
- C: Pending
- D: Pending
- E: Pending
- F: Pending

## Phase A — Provider Abstraction + Schema
- Goal:
  - Add provider-neutral payment domain and persistence.
- Steps:
  - [x] Add payment tables (configs, catalog, sessions, webhook events).
  - [x] Add provider adapter interface + registry.
  - [x] Add base payment service contracts (create session, mark complete, fail/cancel).
  - [x] Add strict idempotency strategy for webhook events.
- Acceptance:
  - Core payment domain compiles and stores sessions/events independently of PayPal SDK details.

## Phase B — Admin Payments UI
- Goal:
  - Let admin manage PayPal credentials and mode safely.
- Steps:
  - [x] `/admin/payments/providers` for provider config.
  - [x] Sandbox/live mode selector + enabled toggles.
  - [x] Credential input with masked display and update audit logging.
  - [x] `/admin/payments/catalog` for donate campaigns and subscribe plans.
- Acceptance:
  - Admin can configure PayPal sandbox/live and maintain catalog mappings.

## Phase C — Internal Checkout Surface
- Goal:
  - Route CTA payment clicks to internal checkout page with PSP options.
- Steps:
  - [ ] Add `/checkout/:intent` page.
  - [ ] Carry message context (`message_id`, `campaign_key`, `message_intent_id`, `return`).
  - [ ] Show available providers for this intent (PayPal first).
  - [ ] Create checkout session and redirect to provider.
- Acceptance:
  - User can start checkout from message CTA through internal page.

## Phase D — PayPal Adapter + Webhooks
- Goal:
  - Implement PayPal checkout + verified completion.
- Steps:
  - [ ] Implement PayPal session creation (sandbox/live endpoints).
  - [ ] Add PayPal webhook endpoint + signature verification.
  - [ ] Process completion/failure events idempotently.
  - [ ] Update checkout session states from webhook processing.
- Acceptance:
  - Verified PayPal events transition sessions to completion reliably.

## Phase E — Message Completion + Suppression Integration
- Goal:
  - Connect verified payment completion to message analytics and suppression.
- Steps:
  - [ ] On verified completion, emit `donation_complete_from_message` / `subscription_complete_from_message`.
  - [ ] Apply suppression scope via existing attribution service (`campaign` when key present, else `message`).
  - [ ] Ensure no suppression on click-only or abandoned checkout.
- Acceptance:
  - Suppression occurs only after verified payment completion.

## Phase F — Observability + Test Harness
- Goal:
  - Make payment debugging first-class.
- Steps:
  - [ ] Add Jaeger/Pino tags for payment lifecycle (`provider`, `intent`, `session_id`, `status`).
  - [ ] Add debug bundle presets for payment operations.
  - [ ] Add smoke scripts for sandbox checkout success/failure and webhook replay idempotency.
- Acceptance:
  - We can quickly diagnose checkout start/complete/failure across browser, terminal, and traces.

## Risks / Open Questions
- Secret storage strategy:
  - env-only vs encrypted DB-backed secrets.
- Subscription model:
  - one-time setup for plans vs dynamic per-message setup.
- Async timing:
  - user returns before webhook arrives (pending state UX needed).
- Refund/chargeback handling:
  - future policy for suppression reversal or entitlement changes.

## Validation Strategy
- Unit:
  - provider contract tests + webhook signature verification logic.
- Integration:
  - checkout session creation, webhook ingestion, idempotent completion.
- Runtime smoke:
  - message CTA -> checkout page -> PayPal sandbox -> completion -> suppression observed.
- Observability:
  - Jaeger and terminal logs include full payment correlation chain.

## Resume Here
- Next action:
  - Start Phase C (internal checkout surface).
- Blocking question (if any):
  - confirm secret storage preference (`env-only` now vs encrypted DB config).
