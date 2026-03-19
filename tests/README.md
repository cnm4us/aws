# Test Runs and Evidence

This directory is the canonical home for test execution evidence.

## Structure
- `tests/runs/<run_id>/summary.md` - human summary of scope, commands, outcomes, and gaps.
- `tests/runs/<run_id>/artifacts/*` - heavy files (raw logs, traces, exports, screenshots).
- `tests/runs/playwright/latest/*` - Playwright run output directory.
- `tests/runs/playwright/report/*` - Playwright HTML report output directory.

## Run ID convention
- Use either a plan-scoped id or a timestamped id:
- `plan_133`
- `2026-03-19_message-injection-smoke`

## Required summary fields
- Scope
- Environment (base URL, branch/commit if relevant)
- Commands executed
- Expected vs observed results
- Known gaps / follow-up
- Links to artifact files

## Legacy locations
- `tests/runs/legacy/implementation/*` is legacy historical evidence referenced by archived plans.
- Do not add new evidence there.
