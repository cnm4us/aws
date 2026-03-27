# Plan 146: Journey-Level Eligibility Rulesets

Status: Active

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - Eligibility can currently be configured in multiple places (`Message`, `Journey Step`), which creates overlap and ambiguity.
  - For journey-driven delivery, progression policy should control step movement, while eligibility should be evaluated once at journey entry.
- In scope:
  - Add journey-level eligibility ruleset.
  - Remove step-level ruleset from journey authoring and runtime gating.
  - Keep message-level ruleset behavior for standalone delivery.
  - Clarify observability tags for journey-level eligibility decisions.
- Out of scope:
  - Advanced journey branching per-step based on eligibility.
  - Migration tooling for production-scale backwards compatibility (DEV-only environment).
- Constraints:
  - Existing journey progression behavior must remain intact.
  - Standalone message targeting must continue to work.

## Locked Decisions
- Journey steps will no longer own eligibility rulesets.
- Journey-level ruleset applies to all steps in that journey.
- Message-level ruleset remains valid only for standalone message selection; journey delivery ignores message-level ruleset.

## Phase Status
- A: Pending
- B: Pending
- C: Pending
- D: Pending
- E: Pending

## Phase A — Data Model + Service Contract
- Goal:
  - Introduce journey-level ruleset on the journey entity and wire service types/contracts.
- Steps:
  - [ ] Add `eligibility_ruleset_id` to `message_journeys` schema (migration + repo mapping).
  - [ ] Update journey DTO/types/service payload normalization.
  - [ ] Validate ruleset existence when assigning journey-level ruleset.
- Test gate:
  - Create/update journey with and without ruleset succeeds.
  - Invalid ruleset ID is rejected with clear error.
- Acceptance:
  - Journey record stores a single optional ruleset reference.

## Phase B — Admin UI (Journey Form)
- Goal:
  - Move ruleset selection to journey-level and remove it from step forms.
- Steps:
  - [ ] Add `Eligibility Ruleset (optional)` field in journey card.
  - [ ] Remove step-level ruleset controls from existing and new step forms.
  - [ ] Ensure save flows persist journey ruleset correctly.
- Test gate:
  - `/admin/message-journeys/:id` shows journey ruleset selector.
  - Step cards no longer expose ruleset.
- Acceptance:
  - Authoring model is visually and behaviorally “journey eligibility + step progression.”

## Phase C — Decision Engine Runtime
- Goal:
  - Apply journey-level eligibility in candidate evaluation; stop applying step-level ruleset.
- Steps:
  - [ ] Evaluate journey ruleset before selecting current step candidate.
  - [ ] Remove runtime dependency on step ruleset checks.
  - [ ] Ensure journey step selection/progression remains unchanged.
- Test gate:
  - Auth-required journey ruleset blocks anonymous users.
  - Same journey allows authenticated users when rules pass.
- Acceptance:
  - Journey candidate acceptance/rejection is driven by journey ruleset only.

## Phase D — Message Standalone Semantics
- Goal:
  - Preserve standalone message-level ruleset behavior and explicitly ignore message ruleset in journey context.
- Steps:
  - [ ] Confirm standalone path still checks message ruleset.
  - [ ] Confirm journey path does not check message-level ruleset.
  - [ ] Add/refresh inline help text in admin editor to reflect this.
- Test gate:
  - Same message behaves differently by context:
    - standalone: gated by message ruleset
    - journey: gated by journey ruleset
- Acceptance:
  - Context-dependent behavior is stable and documented in UI hints.

## Phase E — Observability + Cleanup
- Goal:
  - Keep tracing/debugging clear after model simplification and remove obsolete step-ruleset artifacts.
- Steps:
  - [ ] Emit/verify tags for journey ruleset ID/result/reason on decision spans.
  - [ ] Remove obsolete step-ruleset serialization/validation code paths.
  - [ ] Update docs (`plan_144.md`/`plan_145.md` references as needed).
- Test gate:
  - Jaeger decision traces show journey-level ruleset tags when journey is evaluated.
- Acceptance:
  - No remaining runtime dependence on step ruleset.
  - Diagnostics clearly show journey-level eligibility outcomes.

## Change Log
- (pending)

## Validation
- Environment:
  - DEV local/staging
- Commands run:
  - (pending implementation)
- Evidence files:
  - (optional) debug bundle artifacts under `tests/runs/api-curl/`
- Known gaps:
  - None yet.

## Open Risks / Deferred
- Risk:
  - Existing journey rows that relied on step-level rulesets will need manual reconfiguration at journey level.
- Deferred item:
  - Optional future: branch/variant steps with explicit conditional transitions.

## Resume Here
- Next action:
  - Start Phase A by adding `eligibility_ruleset_id` to journey schema + repo/service mapping.
- Blocking question (if any):
  - None.
