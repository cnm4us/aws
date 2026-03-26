# Plan 145: CTA Outcome Canonicalization + Completion Architecture

Status: Active

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - Completion semantics are currently mixed across message/journey logic.
  - We need a scalable model where CTA execution outcomes are canonical, and message/journey completion is derived.
- In scope:
  - Canonical CTA outcome event model.
  - Message and journey progression derived from CTA outcomes via explicit policy.
  - Observability and analytics slices for standalone vs journey delivery.
- Out of scope:
  - New payment provider integrations beyond current executors.
  - AI authoring or advanced optimization logic.
- Constraints:
  - Dev-only environment (no backward-compat requirement).
  - Keep decision latency bounded and behavior explainable in Jaeger/Pino.

## Locked Decisions
- Completion source of truth is CTA outcome events (not message render events).
- Keep standalone and journey delivery paths; do not force all messages into journeys.
- Journey-selected messages use journey-step policy/ruleset; standalone uses message policy/ruleset.
- Keep CTA `executor` generic (no intent-specific executors like `subscribe_executor`).
- Add CTA `completion_contract` to define completion semantics:
  - `on_click`
  - `on_return`
  - `on_verified`
  - `none`
- Persist three layers:
  - CTA outcomes (immutable fact stream)
  - Message progress (derived state)
  - Journey step progress (derived state)

## Phase Status
- A: Completed
- B: Completed
- C: Pending
- D: Pending
- E: Pending
- F: Pending

## Phase A — Data Model + Contracts
- Goal:
  - Define durable schema/contracts for canonical CTA outcomes and derived progress state linkage.
- Steps:
  - [ ] Add `feed_message_cta_outcomes` (append-only fact table).
  - [ ] Add `completion_contract` to CTA definitions schema + service DTOs.
  - [ ] Add source pointers on progress rows (e.g., `completed_by_outcome_id`).
  - [ ] Define normalized outcome taxonomy:
    - `outcome_type`: `click`, `return`, `verified_complete`, `webhook_complete`, `failed`, `abandoned`
    - `outcome_status`: `pending`, `success`, `failure`
  - [ ] Capture context fields:
    - `delivery_context` (`standalone|journey`)
    - `journey_id`, `journey_step_id`
    - `cta_slot`, `cta_definition_id`, `intent`, `executor`
    - `message_campaign_key` (+ optional CTA campaign key if present)
- Test gate:
  - Run migration + verify table/index creation.
  - Insert synthetic outcome and verify referential joins.
- Acceptance:
  - Canonical outcome row can represent all current CTA flows (auth/support/link).

## Phase B — Outcome Ingestion Service
- Goal:
  - Centralize CTA outcome writes behind one service API.
- Steps:
  - [ ] Add `recordCtaOutcome(...)` service used by all CTA execution paths.
  - [ ] Add completion evaluator:
    - input: CTA definition + outcome event
    - output: CTA completed (`true|false`)
  - [ ] Apply evaluator contract:
    - `on_click`: complete on click outcome
    - `on_return`: complete on return outcome
    - `on_verified`: complete on verified/webhook-confirmed outcome
    - `none`: never auto-complete
  - [ ] Map current flows:
    - message click endpoints
    - internal_link return handling
    - provider checkout return/webhook completion
  - [ ] Ensure idempotency keys for webhook retries and return races.
- Test gate:
  - Simulate duplicate webhook + return sequence and confirm single canonical completion outcome.
- Acceptance:
  - All completion-capable flows produce consistent canonical outcome records.

## Phase C — Policy-Driven Progression
- Goal:
  - Derive message/journey state transitions from CTA outcomes using explicit policy.
- Steps:
  - [ ] Add message completion policy (default: any completion-eligible CTA success).
  - [ ] Add journey step progression policy:
    - `on_any_click`
    - `on_any_completion`
    - `on_cta_slot_completion`
    - `on_intent_completion`
  - [ ] Evaluate policy in one reducer service that updates progress tables.
- Test gate:
  - Multi-CTA message scenario:
    - slot 1 (`subscribe`) completes via webhook
    - slot 2 (`read_more`) click-only
  - Verify configured policy advances/doesn’t advance as expected.
- Acceptance:
  - No hardcoded “click means completed” behavior outside policy.

## Phase D — Admin UX for Policies
- Goal:
  - Expose completion/progression policy cleanly in admin.
- Steps:
  - [ ] CTA editor: add `Completion Contract` select.
  - [ ] CTA editor: add compatibility warnings (e.g. `intent=subscribe` + `on_click`).
  - [ ] Message editor: completion policy controls (with defaults).
  - [ ] Journey step editor: progression policy controls + validation.
  - [ ] Guardrails/help text for conflicting configs.
- Test gate:
  - Save/edit policy configs and verify persisted JSON + runtime behavior.
- Acceptance:
  - Admin can configure click-based or completion-based progression without code changes.

## Phase E — Observability + Analytics Wiring
- Goal:
  - Make cause/effect traceable from CTA outcome -> message/journey progression.
- Steps:
  - [ ] Jaeger tags:
    - `app.delivery_context`
    - `app.cta_outcome_type`, `app.cta_outcome_status`
    - `app.progression_policy`
    - `app.progressed_by_outcome_id`
  - [ ] Pino structured logs for outcome ingest + reducer decisions.
  - [ ] Analytics rollup path from canonical outcomes (not inferred totals).
- Test gate:
  - Debug bundle should show correlated timeline across:
    - browser emit
    - terminal logs
    - Jaeger traces
- Acceptance:
  - Any “why did step advance?” question is answerable from one trace chain.

## Phase F — Backfill + Smoke Matrix
- Goal:
  - Validate behavior across key real flows and clean test reset ergonomics.
- Steps:
  - [ ] Add reset helpers:
    - clear suppression
    - clear journeys/progress
    - clear payment/support test rows (local + optional provider cleanup)
  - [ ] Run matrix:
    - standalone click-only CTA
    - standalone completion CTA
    - journey step with click policy
    - journey step with completion policy
    - multi-CTA mixed semantics
- Test gate:
  - Record matrix artifacts under `tests/runs/api-curl/...`.
- Acceptance:
  - Deterministic outcomes match configured policy in all matrix cases.

## Change Log
- (none yet)
- (uncommitted) — Phase A schema/contracts:
  - `feed_message_cta_outcomes` table + indexes
  - CTA definition `completion_contract`
  - journey progress `completed_by_outcome_id`
  - CTA/domain type contracts updated
- (uncommitted) — Phase B ingestion/evaluator:
  - Added central `recordCtaOutcome(...)` service + repo.
  - Added completion evaluator by contract (`on_click|on_return|on_verified|none`).
  - Wired ingestion from:
    - `/api/feed/message-events` click/complete events
    - `/api/cta/mock/complete`
    - PayPal return + webhook completion path
  - Added idempotent outcome key usage for intent/checkout completion paths.

## Validation
- Environment:
  - Local dev (`serve:jaeger:log`, otelcol + Jaeger enabled)
- Commands run:
  - (planning only)
- Evidence files:
  - (planning only)
- Known gaps:
  - Existing logic still partially event-hardcoded pending Phase C.

## Open Risks / Deferred
- Risk:
  - Policy flexibility can introduce authoring confusion.
  - Mitigation: constrained policy set + validation + defaults.
- Risk:
  - Webhook/return race conditions causing double progression.
  - Mitigation: idempotency on outcome ingest + reducer dedupe.
- Deferred item:
  - Advanced cohort analytics UI beyond current admin reporting.

## Resume Here
- Next action:
  - Start Phase C (policy-driven progression from canonical outcomes).
- Blocking question (if any):
  - None.
