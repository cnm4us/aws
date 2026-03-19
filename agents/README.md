# Agent Docs Entry Point

This is the stable entrypoint for agent-facing docs in this repo.
Last reviewed: 2026-03-19

## Primary Rule
- `agents/implementation/plan_NN.md` is the canonical continuity artifact.

## Instruction Precedence
- Always follow system and developer instructions first.
- These docs are repo defaults and can be overridden by the host environment.

## Core Workflow
1. Read this file.
2. Use `agents/ROUTING.md` to decide which supporting docs to load.
3. If there is active implementation work, use the relevant `agents/implementation/plan_NN.md` as source of truth.
4. Keep plan status, validation notes, and next steps current in that plan.

## Quick Start
1. Discussion-only request: load `agents/ROUTING.md`, then the minimum referenced docs; do not implement.
2. Implementation request: continue active `agents/implementation/plan_NN.md` or create a new plan from `PLAN_TEMPLATE.md`.
3. Debugging request: load `agents/tools/debugging.md`, `debug/README.md`, and `tests/README.md`.
4. Before commit: run `npm run check:agents:docs` and resolve broken references/status gaps.

## Document Map
- Routing: `agents/ROUTING.md`
- Policy set: `agents/policies/*.md`
- Feature contracts: `agents/features/feature_NN_slug.md`
- Feature index: `agents/features/INDEX.md`
- Global requirements/invariants: `agents/requirements/INDEX.md`, `agents/requirements/*.md`
- UI style requirements: `agents/requirements/ui/*`
- Analytics strategy docs: `agents/analytics/*`
- Roadmaps: `agents/roadmaps/INDEX.md`, `agents/roadmaps/*`
- Git and commit policy: `agents/git.md`
- Plan authoring standards: `agents/implementation_planning.md`
- Plan index: `agents/implementation/INDEX.md`
- Plan template: `agents/implementation/PLAN_TEMPLATE.md`
- Plan archives: `agents/implementation/archives/INDEX.md`
- Reports and metrics artifacts: `agents/reports/metrics/*`
- Test workflow, suites, and run artifacts: `tests/README.md`, `tests/suites/*`, `tests/runs/*`
- Local disposable debug workspace: `debug/README.md`, `debug/terminal/*`, `debug/console/*`
- DB change safety: `agents/db_access.md`
- Developer README updates: `agents/readme_maintenance.md`
- Debug tooling: `agents/tools/debugging.md`
  - Includes Jaeger query CLI: `npm run jaeger:query -- ...`

## Interaction Modes
- `Discussion`: options, tradeoffs, no implementation.
- `Architecture`: design decisions and contracts, no implementation (consult feature docs first when available).
- `Implementation Plan`: create or revise `plan_NN.md`.
- `Execution`: implement the approved plan incrementally with tests.
