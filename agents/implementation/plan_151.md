# Plan 151 — Journey Re-Entry With Run-Scoped State

## Problem
Journey re-entry currently depends on message-level campaign suppression behavior. After cooldown, users may still be blocked unless suppressions are manually cleared. That is not acceptable for production behavior and makes smoke testing misleading.

## Goal
Make journey progression and re-entry fully controlled by journey instance state (run-scoped), not by standalone message suppressions.

## Non-Goals
- Rebuild message analytics UI in this phase.
- Change existing standalone suppression semantics.
- Introduce branching journey logic.

## Principles
- Journey and standalone delivery are separate control planes.
- Re-entry creates a new run (new journey instance), not reuse of previous run state.
- Step progress is run-scoped.
- Suppression remains for standalone messages unless explicitly expanded later.

---

## Target Model

### Entities
- `feed_message_journey_instances` = journey runs (one row per run per identity over time).
- `feed_*_message_journey_progress` (or unified progress table) = step progress records tied to a specific run.
- `feed_message_user_suppressions` = standalone suppression only.

### Runtime Behavior
1. Candidate selected in `delivery_context=journey` ignores message campaign suppression.
2. Active run determines current step.
3. Step completion updates run-scoped step progress.
4. Goal-rule completion marks current run terminal.
5. Re-entry policy (`allow_restart` / `reenter_after_days`) creates a new active run at step 1.

---

## Phase A — Immediate Functional Fix (No Schema Change)
1. Decision engine: when `delivery_context=journey`, bypass campaign suppression checks.
2. Keep suppression logic for standalone candidates unchanged.
3. Add trace tags:
- `app.delivery_context`
- `app.suppression_applied` (`true|false`)
- `app.suppression_bypass_reason` (`journey_delivery`)

### Exit Criteria
- After journey completion + cooldown, journey step 1 reappears without clearing suppressions.
- Standalone campaign suppression still works.

---

## Phase B — Run-Scoped Step Progress (Schema Hardening)
1. Add `journey_instance_id` to step progress storage.
2. Backfill existing progress rows to latest matching instance (best-effort migration).
3. Update progression reads/writes to scope by active instance id.
4. Ensure merge anon→user rebinds/creates instance-scoped progress correctly.

### Exit Criteria
- Two runs of same journey for same user maintain separate step histories.
- Current step for new run starts at step 1 regardless of previous run completions.

---

## Phase C — Re-Entry Lifecycle
1. On terminal run + eligible re-entry, create a new run row (`state=active`).
2. Preserve old run terminal row for analytics/audit.
3. Ensure only one active run per journey+identity at a time.
4. Add optional admin/dev action: "restart journey run now" (creates new run).

### Exit Criteria
- Multiple completed runs visible in DB history.
- New run appears without manual DB edits.

---

## Phase D — Observability + Analytics Consistency
1. Add/run tags:
- `app.journey_instance_id`
- `app.journey_reentry_triggered`
- `app.journey_reentry_policy`
- `app.journey_run_state`
2. Analytics aggregation updates:
- run-level counts (starts, completes, abandons)
- step funnel per run sequence

### Exit Criteria
- Can distinguish run #1 vs run #2 in traces and analytics.

---

## Phase E — Tooling + Smoke Coverage
1. Dev tools:
- `Clear Journey State (All)` remains.
- Add `Clear Journey State (Journey + User)` targeted reset.
- Add `Force Re-entry (create new run)` for journey/user.
2. Smoke matrix:
- anon start -> login goal complete -> cooldown -> re-entry step 1 (no suppression clear)
- standalone suppression unaffected
- journey in group/channel surfaces behaves same as global

### Exit Criteria
- Re-entry smoke is deterministic and requires no manual suppression clearing.

---

## Data Migration Notes
- Migration should be additive and reversible.
- Backfill logs unmatched rows; do not hard-fail startup for partial backfill.
- Guardrail query after migration should report orphaned progress rows.

---

## Risks
1. Mixed old/new progress reads during rollout.
- Mitigation: feature flag read path until migration verified.
2. Duplicate active runs.
- Mitigation: transactional creation + unique active-run constraint strategy.
3. Merge anon→user edge cases.
- Mitigation: integration tests for merge before/after terminal state.

---

## Open Decisions (Recommend Defaults)
1. Progress storage strategy:
- Option A: add `journey_instance_id` to current progress tables (recommended for speed).
- Option B: new unified progress table.
2. Active run uniqueness:
- Enforce with DB constraint vs service-level lock.
3. Re-entry trigger timing:
- On decision read path (recommended now) vs scheduled background job.

## Locked Decisions (2026-03-31)
1. Progress storage:
- Use Option A now: add `journey_instance_id` to existing progress tables.

2. Active run uniqueness:
- Enforce in service logic first during development.
- Defer DB uniqueness constraints/foreign keys to pre-production hardening.

3. Suppression semantics:
- Campaign suppression applies only to standalone delivery.
- Journey delivery ignores campaign suppression entirely.

4. Merge semantics (anon -> user):
- Merge carries the active run forward to user identity.
- Source anon instance is marked `abandoned`.
- `auth.login_complete` goal completion remains terminal for that run.

5. Observability and analytics:
- Include `journey_instance_id` in traces and analytics before phase completion.

---

## Suggested Execution Order
1. Phase A (quick correctness).
2. Phase B + C together (state model completion).
3. Phase D.
4. Phase E.

---

## Definition of Done
- Journey re-entry works for normal users without developer-only suppression reset.
- Journey runs are independently represented and queryable.
- Standalone suppression behavior remains unchanged.
- Smoke matrix passes across anon/auth and surface types.
