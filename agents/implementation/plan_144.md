# Plan 144: Stateful Message Journeys + UX Pattern Catalog

Status: Active

## Context
- Message targeting now supports eligibility rulesets and ruleset-based suppression.
- We want to move from one-off message delivery to stateful, multi-step journeys.
- Goal is better UX sequencing (onboarding, support, reactivation, safety guidance) with deterministic behavior.

## Goals
- Add a stateful journey model for messages.
- Allow ordered step progression per user/session state.
- Keep rule semantics explicit and deterministic.
- Build reusable UX pattern templates on top of journeys.

## Non-Goals
- AI-generated journey authoring.
- Complex visual rule expression builders in v1.
- Full optimization/automation engine in v1.

## Design Summary
- Keep rulesets as eligibility layer.
- Add journey domain model as sequencing layer.
- Track user journey progress from canonical message events.
- Decision engine evaluates: baseline candidates -> suppression -> rulesets -> journey step gating -> selection.

## Core Concepts
- **Journey**: named campaign sequence (e.g., `onboarding_v1`).
- **Step**: ordered milestone in a journey; maps to one message.
- **Progress**: per-user state for each journey step (seen/clicked/completed/skipped/expired).
- **Pattern**: reusable journey template + default rulesets + measurement intent.

## Proposed Schema (v1)

### 1) `message_journeys`
- `id` bigint pk
- `journey_key` varchar(64) unique
- `name` varchar(120)
- `status` enum('draft','active','archived')
- `description` varchar(500) null
- `created_by`, `updated_by`, `created_at`, `updated_at`

### 2) `message_journey_steps`
- `id` bigint pk
- `journey_id` bigint
- `step_key` varchar(64)
- `step_order` int
- `message_id` bigint
- `ruleset_id` bigint null (optional override/step-local)
- `status` enum('draft','active','archived')
- `config_json` json (timing gates, cooldown hints, optional expiry)
- unique `(journey_id, step_key)`
- unique `(journey_id, step_order)`

### 3) `user_message_journey_progress`
- `id` bigint pk
- `user_id` bigint
- `journey_id` bigint
- `step_id` bigint
- `state` enum('eligible','shown','clicked','completed','skipped','expired','suppressed')
- `first_seen_at`, `last_seen_at`, `completed_at`, `updated_at`
- `session_id` varchar(120) null
- `metadata_json` json null
- unique `(user_id, step_id)`

## Rule Primitive Additions (v1)
- `user.days_since_signup_gte` (int)
- `journey.step_state_is` (`{ journey_key, step_key, state }`)
- `journey.step_completed` (`{ journey_key, step_key }`)
- `journey.session_count_gte` (int)

## Event Contract (Journey Signals)
Canonical event mapping from existing message events:
- `message_impression` -> `shown`
- `message_click` -> `clicked`
- `*_complete_from_message` -> `completed`
- pass-through/dismiss -> `skipped` (policy-configurable)

Requirements:
- idempotent updates
- monotonic state transitions
- timestamp/source preservation

## Decision Engine Insertion Points
Current decision order becomes:
1. baseline message list (status/surface/schedule)
2. user suppression
3. ruleset evaluation
4. **journey step eligibility + progression gate**
5. tie-break selection

Behavior defaults:
- Messages not attached to a journey remain eligible (existing behavior).
- Journey-attached messages require active journey + eligible step.

## Admin UX (v1)

### `/admin/message-journeys`
- list/create/edit/archive journeys

### `/admin/message-journeys/:id`
- ordered steps table
- add/remove/reorder steps
- assign message + optional ruleset

### Message editor
- optional link to journey step (or read-only back-reference if step-owned)

## Observability
Add telemetry for decision traces/logs:
- `app.journey_key`
- `app.journey_step_key`
- `app.journey_step_order`
- `app.journey_state`
- `app.journey_drop_reason`

Debug payload additions:
- candidate counts before/after journey gating
- per-candidate journey rejection reasons

## UX Pattern Catalog (Initial)
- `onboarding_v1`
  - welcome -> moderation basics -> groups/channels discovery
- `support_v1`
  - value reminder -> donation/subscription prompt -> thank-you follow-up
- `upgrade_v1`
  - feature ceiling -> plan benefits -> upgrade action
- `reactivation_v1`
  - dormant return -> quick win -> deeper engagement

Each pattern includes:
- default journey steps
- default rulesets
- expected completion events
- suggested success metrics

## Rollout Phases

### Phase A — Foundation Cleanup
- Ensure plan_143 final sweep complete.
- Confirm ruleset-only targeting baseline.
- Acceptance: clean baseline and telemetry naming consistency.
- Status: Completed (2026-03-26)

### Phase B — Journey Data Model
- Add new journey/progress tables + indexes.
- Add repo primitives.
- Acceptance: CRUD-ready persistence with integrity checks.
- Status: Completed (2026-03-26)

### Phase C — State Transitions
- Implement journey progress service.
- Wire canonical event-to-state mapping.
- Add idempotency + transition guards.
- Acceptance: repeat events do not corrupt progression.
- Status: Completed (2026-03-26)

### Phase D — Decision Integration
- Add journey gating in decision engine.
- Enforce ordered step progression.
- Keep non-journey messages unaffected.
- Acceptance: deterministic selection for attached journeys.
- Status: Completed (2026-03-26)

### Phase E — Admin Pages (v1)
- Add journey list/detail pages and step management.
- Link steps to messages + rulesets.
- Acceptance: admin can define and activate simple journeys.
- Status: Completed (2026-03-26)

### Phase F — Observability + Smoke
- Add journey telemetry tags and debug fields.
- Smoke matrix:
  - onboarding 3-step progression
  - completion-based suppression interaction
  - fallback behavior for non-journey messages
- Acceptance: Jaeger/Pino/debug bundle clearly explain journey decisions.
- Status: Completed (2026-03-26)

### Phase G — UX Pattern Catalog Bootstrap
- Document and seed 2-4 starter patterns.
- Provide copy and measurement checklist per pattern.
- Acceptance: reusable templates available in docs/admin seed tooling.

## Risks
- Journey logic complexity grows quickly.
  - Mitigation: strict finite state machine + limited v1 ops.
- Decision latency from extra lookups.
  - Mitigation: batch reads, cache step/ruleset metadata.
- Authoring errors (broken sequences).
  - Mitigation: admin validations + dry-run diagnostics.

## Open Decisions
- Step ownership model:
  - A) Step references existing message (recommended)
  - B) Step owns message snapshot
- Pass-through semantics:
  - A) mark as skipped by default (recommended)
  - B) no state update until explicit action

## Resume Here
- Start Phase G — UX Pattern Catalog Bootstrap.
