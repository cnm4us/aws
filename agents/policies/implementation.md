# Implementation Policy

## Source of truth
- Active work state lives in `agents/implementation/plan_NN.md`.

## Required plan sections
- Context
- Locked Decisions
- Phase Status
- Change Log (commit SHAs)
- Validation
- Open Risks / Deferred
- Resume Here

## Execution behavior
- Implement one small phase at a time.
- Keep the system runnable after each phase.
- Update plan status before moving to the next phase.
- Record real test evidence in `agents/tests/plan_NN/` when applicable.
