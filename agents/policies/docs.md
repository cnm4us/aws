# Documentation Policy

- `agents/README.md` is stable entrypoint and doc map.
- `agents/ROUTING.md` owns semantic trigger routing.
- `agents/features/*` stores durable feature intent and contract rules.
- `agents/requirements/INDEX.md` is the requirements entrypoint.
- `agents/requirements/*` stores global constraints and invariants that span features.
- `agents/requirements/ui/*` stores reusable UI styling/layout requirements.
- `agents/analytics/*` stores analytics contracts and report definitions.
- `agents/roadmaps/*` stores long-horizon sequencing/milestone plans.
- `agents/implementation/plan_NN.md` is execution and continuity artifact.
- `agents/reports/metrics/*` stores measurement snapshots and observability inventories.
- `tests/suites/*` stores reusable test harness code by tool.
- `tests/runs/*` stores per-run summaries and heavy runtime artifacts.
- When execution requires trial-and-error to find reliable debug/query commands, record newly validated commands in `agents/tools/debugging.md` (cookbook section) in the same change set or immediately after.
