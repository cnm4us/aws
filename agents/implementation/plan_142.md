# Plan 142: Message Eligibility Rulesets (Inclusion + Exclusion)

Status: In Progress

## Context
- Message decision currently filters by:
  - active/schedule/surface/audience (`messagesSvc.listActiveForFeed`)
  - user-level suppression (`messageAttributionSvc.isUserSuppressed`)
  - session thresholds/cooldowns/caps
- There is no reusable eligibility layer for support-state targeting (subscriber status, donation recency, tier, etc.).

## Goal
- Add reusable **Eligibility Rulesets** and connect them to message decision.
- Support both:
  - inclusion rules (who can be targeted)
  - exclusion rules (hard block)
- Preserve existing decision behavior when no ruleset is attached.

## Non-Goals
- End-user rules builder UX (advanced visual editor).
- Arbitrary expression language or user-authored scripts.
- Multi-provider-specific payment semantics in rules (use normalized support profile only).

## Design Summary
- Hard-code a finite rule primitive catalog in backend.
- Persist rulesets as structured JSON criteria.
- Attach one optional ruleset to each message.
- Evaluate rulesets in decision engine after baseline candidate collection and before selection tie-break.

## Proposed Schema

### 1) `feed_message_eligibility_rulesets`
- `id` bigint pk
- `name` varchar(120) not null
- `status` enum('draft','active','archived') not null default 'draft'
- `description` varchar(500) null
- `criteria_json` json not null
- `created_by` bigint not null
- `updated_by` bigint not null
- `created_at`, `updated_at`

`criteria_json` shape (v1):
```json
{
  "version": 1,
  "inclusion": [
    { "op": "user.is_authenticated", "value": true },
    { "op": "support.is_subscriber", "value": false }
  ],
  "exclusion": [
    { "op": "support.donated_within_days", "value": 30 }
  ]
}
```

### 2) `feed_messages` extension
- add nullable column: `eligibility_ruleset_id` bigint null
- add index on `eligibility_ruleset_id`

No FK hard requirement in v1 (dev speed), but recommended logical integrity checks in service layer.

## Rule Primitive Catalog (v1)
Only backend-implemented operations; unknown ops fail validation.

### Inclusion/Exclusion ops
- `user.is_authenticated` (bool)
- `support.is_subscriber` (bool)
- `support.subscription_tier_in` (string[])
- `support.donated_within_days` (int)
- `support.donated_amount_last_days_gte` (`{ days: int, cents: int }`)
- `support.completed_intent_in` (string[]: donate|subscribe|upgrade)

### Evaluation semantics
- Inclusion array: AND across all rules (empty => pass)
- Exclusion array: any true => reject
- Final eligibility: `inclusionPass && !exclusionHit`

## Decision Engine Insertion Point
Primary insertion in:
- `src/features/message-decision/service.ts`

Current flow:
1. baseline candidates built from active messages
2. user suppression check
3. tie-break selection

New flow:
1. baseline candidates
2. user suppression check
3. **eligibility ruleset evaluation** (new)
4. tie-break selection

Implementation detail:
- batch-fetch rulesets for candidate message ids
- batch-build support profile for user once per decision
- evaluate candidate-by-candidate with deterministic reasons

## Support Profile Source
Create normalized profile in service layer (single per decision call):
- `isAuthenticated`
- `isSubscriber` (derived from active subscription in `payment_subscriptions`)
- `activeSubscriptionTier` (from linked catalog item key/label)
- `donatedAmountLast30DaysCents` (from normalized payment tables)
- `lastDonationAt`
- `completedIntents` (recent)

Note: profile builder should use local normalized tables, not direct provider API calls.

## Observability
Add decision debug/telemetry fields:
- `app.message_ruleset_id`
- `app.message_ruleset_result` = pass|reject
- `app.message_ruleset_reason` (short code)
- decision debug payload:
  - candidate count pre/post ruleset
  - per-candidate drop reason (optional limited list)

## Admin UI (Phase 2)
- New route group:
  - `/admin/message-rulesets`
  - `/admin/message-rulesets/new`
  - `/admin/message-rulesets/:id`
- Message editor:
  - optional select `Eligibility Ruleset`
- Keep ruleset editor minimal JSON-assisted form for v1.

## Rollout Phases

### Phase A — Data + Contracts
- add table + column + repo primitives
- add types + validation for `criteria_json`
- migration-safe defaults (null ruleset on existing messages)
 - Status: Completed (2026-03-25)

### Phase B — Ruleset Service
- CRUD service for rulesets
- strict op/value validation
- DTO + list filters (status)

### Phase C — Decision Engine Integration
- load ruleset per candidate
- build support profile once
- evaluate inclusion/exclusion
- return deterministic drop reasons in debug

### Phase D — Admin Wiring
- ruleset admin pages
- message editor select for ruleset
- save/read path for `eligibility_ruleset_id`

### Phase E — Observability + Smoke
- add Jaeger/Pino decision tags for ruleset pass/reject
- smoke scenarios:
  - non-subscriber sees donate prompt
  - recent donor excluded
  - subscriber excluded from upgrade (or inverse tier-targeted upgrade)

## Acceptance Criteria
- Messages without ruleset behave exactly as before.
- With ruleset attached, decision respects inclusion/exclusion deterministically.
- `/admin/messages` supports assigning/removing rulesets.
- Debug payload clearly shows why candidate was rejected.

## Open Questions (resolved defaults)
- Inclusion/exclusion: **both** (this plan).
- One ruleset per message: **yes** (v1).
- Ruleset status enforcement: only `active` rulesets are evaluable; `draft/archived` treated as not attached.

## Risks & Mitigations
- Risk: over-complex rule semantics.
  - Mitigation: fixed primitive catalog, no expression language.
- Risk: decision latency.
  - Mitigation: one support profile fetch per decision + batched ruleset load.
- Risk: ambiguous drop behavior.
  - Mitigation: explicit reason codes in debug + telemetry.

## Resume Here
- Next implementation step: Phase A (schema + types + repo scaffolding).
