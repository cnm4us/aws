# Plan 162: Moderation V2 Two-Stage Pipeline (Contract Hardening + Rollout)

Status: Active

## Feature Reference
- Feature doc: `agents/features/feature_16_moderation_v2.md`

## Context
- Problem statement:
  - Current moderation supports report intake + moderator workflow, but does not persist a two-stage AI pipeline (measurement -> judgment) with immutable audit snapshots and canonical review linkage.
  - Proposed v2 contract is directionally strong but needs trust-boundary hardening and rollout-safe sequencing.
- In scope:
  - Harden API contracts for `/api/moderation/measure`, `/api/moderation/judge`, `/api/moderation/review`.
  - Add canonical `evaluation_id` lifecycle and immutable stage snapshots.
  - Add server-side policy profile resolution (replace client-sent maps).
  - Integrate human accept/override review with rationale and auditable final disposition.
  - Expose admin visibility for stage artifacts and final disposition.
- Out of scope:
  - Full ML retraining pipeline implementation.
  - Model-prompt experimentation framework.
  - Large-scale moderation UI redesign beyond required v2 hooks.
  - Legacy backward-compatibility shims (dev-only system; we can migrate directly).
- Constraints:
  - Structured outputs only (no essay-only AI outputs).
  - Human accountability remains final authority.
  - Global safety rules are non-overridable by culture.
  - System must remain runnable and testable after each phase.

## Locked Decisions
- Canonical correlation key: `evaluation_id` (server-generated ULID).
- `request_id` is client correlation only, not authoritative for joins.
- Stage 2 cannot accept client-provided canonical maps; it uses `policy_profile_id` server-resolved to versioned maps.
- Review endpoint never trusts client-supplied `ai_output` as source of truth; review references stored `evaluation_id` artifacts.
- Override requires rationale.
- Final case disposition is derived from latest review event and is fully auditable.

## Phase Status
- A: Completed
- B: Completed
- C: Pending
- D: Pending
- E: Pending
- F: Pending
- G: Pending

## Phase A — Contract Freeze and Enum Registry
- Goal:
  - Lock precise request/response contracts and canonical enums before schema/table work.
- Steps:
  - [ ] Add shared types for v2 moderation contracts (`measure`, `judge`, `review`) under a new feature module.
  - [ ] Freeze enums: severity, confidence_band, outcome, action_type, review_decision.
  - [ ] Define idempotency keys per stage.
  - [ ] Add validation schemas (zod/json-schema) for all three endpoints.
- Test gate:
  - `npm run build`
  - Contract schema smoke (new script) validates valid/invalid fixtures.
- Acceptance:
  - Single source-of-truth contract + enums exists and compiles.

## Phase B — Persistence Schema for Evaluations
- Goal:
  - Add immutable stage storage with explicit linkage to existing reports.
- Steps:
  - [ ] Add table: `moderation_evaluations` (`evaluation_id`, `report_id`, `content_id`, lifecycle timestamps, status).
  - [ ] Add table: `moderation_measurements` (stage-1 request snapshot + normalized assessments + meta).
  - [ ] Add table: `moderation_judgments` (stage-2 inputs resolved server-side + reasoning + ai_judgment + meta).
  - [ ] Add table: `moderation_reviews` (append-only accept/override events + rationale + reviewer id).
  - [ ] Add required indexes (`report_id`, `evaluation_id`, `created_at`, state columns).
- Test gate:
  - `npm run build`
  - DB migration sanity (`SHOW CREATE TABLE ...`) for all new tables.
- Acceptance:
  - New schema exists and is queryable in dev.

## Phase C — Stage 1 Measure Endpoint
- Goal:
  - Implement `/api/moderation/measure` with immutable stage-1 persistence.
- Steps:
  - [ ] Add route + service + repo methods for measure.
  - [ ] Generate `evaluation_id` server-side.
  - [ ] Persist full measurement snapshot (request normalization + assessments + meta).
  - [ ] Enforce structured output rules (evidence limits, confidence bounds).
- Test gate:
  - Endpoint smoke with valid payload returns `evaluation_id` + assessments.
  - Invalid payload rejects with stable error code.
- Acceptance:
  - Stage 1 works independently and persists immutable artifact.

## Phase D — Stage 2 Judge Endpoint (Server-Resolved Policy)
- Goal:
  - Implement `/api/moderation/judge` using stored stage-1 and server-resolved policy/culture.
- Steps:
  - [ ] Endpoint accepts `evaluation_id`, `culture_id`, `policy_profile_id`, options.
  - [ ] Resolve measurement snapshot from DB (not client copy).
  - [ ] Resolve policy maps by `policy_profile_id` + version on server.
  - [ ] Resolve culture payload from canonical culture definition mapper.
  - [ ] Persist structured `decision_reasoning` + `ai_judgment` + judgment meta.
  - [ ] Enforce non-overridable global safety policy in server logic.
- Test gate:
  - Judge call with valid refs succeeds and stores judgment row.
  - Missing/invalid refs fail with deterministic codes.
- Acceptance:
  - Stage 2 produces auditable structured reasoning + judgment from canonical inputs.

## Phase E — Human Review Endpoint and Disposition Engine
- Goal:
  - Implement `/api/moderation/review` as append-only human decision events.
- Steps:
  - [ ] Endpoint accepts `evaluation_id` + review decision payload.
  - [ ] Reviewer identity sourced from auth session, not body.
  - [ ] Enforce rationale requirement on override.
  - [ ] Persist review event.
  - [ ] Compute/store effective final disposition (latest-event semantics).
  - [ ] Link disposition updates into existing report lifecycle fields where needed.
- Test gate:
  - Accept flow stores review + disposition.
  - Override without rationale rejects.
  - Override with rationale stores and supersedes prior accepted disposition.
- Acceptance:
  - Human accountability path is complete and auditable.

## Phase F — Admin Surface + Traceability
- Goal:
  - Add admin visibility into v2 chain without full redesign.
- Steps:
  - [ ] Extend report inspect UI to show `evaluation_id` and stage status.
  - [ ] Add compact sections: latest measurement summary, latest judgment summary, review timeline.
  - [ ] Add Jaeger tags on stage boundaries (`evaluation_id`, policy profile/version, culture id/version).
- Test gate:
  - `/admin/reports` inspect shows v2 artifacts when present.
  - Jaeger trace includes v2 correlation fields.
- Acceptance:
  - Moderators/admins can inspect the full reasoning chain.

## Phase G — Stabilization, Seeds, and Docs
- Goal:
  - Prepare v2 for iterative rollout and policy tuning.
- Steps:
  - [ ] Seed initial `policy_profile` records + versioned maps in dev.
  - [ ] Add ops scripts for replay/debug by `evaluation_id`.
  - [ ] Document contracts, transition rules, and audit model.
  - [ ] Add smoke script covering measure -> judge -> review happy path.
- Test gate:
  - End-to-end smoke passes in dev.
  - Docs complete and linked from implementation index.
- Acceptance:
  - v2 pipeline is operationally usable and ready for incremental tuning.

## Change Log
- 2026-04-09 — Plan drafted from feature_16 analysis and contract hardening checklist.
- 2026-04-09 — Phase A completed: added moderation-v2 contract module, frozen enums, zod schemas, idempotency helpers, and contract smoke script.
- 2026-04-09 — Phase B completed: added moderation evaluation, measurement, judgment, and review tables with indexes and foreign keys.

## Validation
- Environment: development
- Commands run:
  - `npm run build`
  - `npm run moderation:v2:contracts:smoke`
  - `SHOW CREATE TABLE moderation_evaluations`
  - `SHOW CREATE TABLE moderation_measurements`
  - `SHOW CREATE TABLE moderation_judgments`
  - `SHOW CREATE TABLE moderation_reviews`
- Evidence files:
  - `agents/features/feature_16_moderation_v2.md`
  - `src/features/moderation-v2/enums.ts`
  - `src/features/moderation-v2/types.ts`
  - `src/features/moderation-v2/schemas.ts`
  - `src/features/moderation-v2/idempotency.ts`
  - `scripts/moderation-v2-contract-smoke.ts`
- Known gaps:
  - No v2 endpoint code yet (Phase C+).

## Open Risks / Deferred
- Risk:
  - Policy profile churn can create non-comparable outcomes unless profile/version is strictly stamped.
- Risk:
  - Evidence payload size and transcript handling may increase latency/cost sharply.
- Risk:
  - Reviewer UX complexity if stage artifacts are too verbose without summarization.
- Deferred item:
  - Automated model refinement/training pipeline from accepted/overridden cases.

## Resume Here
- Next action:
  - Start Phase C (measure endpoint + immutable stage-1 persistence).
- Blocking question (if any):
  - none
