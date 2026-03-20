# Test Runs and Evidence

This directory is the canonical home for test execution evidence.

## Harnesses
- `tests/suites/api-curl/*` - reusable API contract checks and helpers.
- `tests/suites/playwright/*` - browser/UI specs and helpers.

## Structure
- `tests/runs/api-curl/<run_id>/summary.md` - API run summary.
- `tests/runs/api-curl/<run_id>/artifacts/*` - API run artifacts.
- `tests/runs/playwright/<run_id>/summary.md` - browser run summary.
- `tests/runs/playwright/<run_id>/artifacts/*` - browser run artifacts.
- `tests/runs/playwright/latest/*` - current Playwright output directory (tool-managed).
- `tests/runs/playwright/report/*` - current Playwright HTML report (tool-managed).

Jaeger query artifacts from `npm run jaeger:query -- ... --out <file>` should also be stored under the appropriate `tests/runs/*/<run_id>/artifacts/` directory.
The debug bundle helper `npm run debug:bundle` writes a complete capture to `tests/runs/api-curl/<run_id>/`.

## Run ID convention
- Prefix by harness:
- `api-curl/plan_134_phase_b`
- `playwright/2026-03-19_message-injection-smoke`

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
