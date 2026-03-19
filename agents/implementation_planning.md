# Implementation Planning Guide

This guide defines how to create and maintain `agents/implementation/plan_NN.md` files.

## Core Principle
- `plan_NN.md` is the canonical continuity artifact.

## When to Create or Revise a Plan
- User asks for a new implementation plan.
- Existing requirements changed and active plan must be updated.
- Execution uncovered new dependencies that require a phase rewrite.

## Required Structure for Every Plan

1. `Status`
- `Active` or `Complete`.

2. `Context`
- Problem statement, in-scope, out-of-scope, constraints.

3. `Locked Decisions`
- Durable contract choices that should not drift during execution.

4. `Phase Status`
- Explicit phase list with `Pending | In Progress | Complete`.
- At most one phase `In Progress` at a time.

5. `Phase Sections`
For each phase include:
- goal
- concrete steps
- test gate
- acceptance criteria

6. `Change Log`
- Commit SHA + concise summary per landed change.

7. `Validation`
- Commands executed
- outcomes observed
- evidence file paths when relevant
- known test gaps

8. `Open Risks / Deferred`
- Explicitly track non-completed but acknowledged scope.

9. `Resume Here`
- Next concrete action and any blocker.

Use `agents/implementation/PLAN_TEMPLATE.md` as the default scaffold.

## Execution and Status Hygiene
- Before work on a phase: mark it `In Progress`.
- After implementation and successful test gate: mark it `Complete`.
- Update `Change Log`, `Validation`, and `Resume Here` before moving on.

## Testing Requirements
- Tests must be run, not inferred.
- Prefer phase-sized contract tests that keep the app runnable.
- If a test cannot run, record exact blocker and residual risk.

## Evidence Location
- Keep canonical test gates in the plan.
- Store heavier outputs in `tests/runs/<run_id>/` when needed.
- Keep legacy evidence under `tests/runs/legacy/implementation/` unchanged unless explicitly migrating old plans.

## Commit Coordination
After each commit:
- update the active `plan_NN.md`
- then evaluate `/README.md` updates using `agents/readme_maintenance.md`
