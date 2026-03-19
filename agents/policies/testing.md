# Testing Policy

- Tests must be executed, not assumed.
- Prefer small contract tests per phase.
- Separate evidence by harness:
- API/curl evidence in `tests/runs/api-curl/<run_id>/`.
- Browser/playwright evidence in `tests/runs/playwright/<run_id>/` (plus tool-managed `latest` and `report` folders).
- Record commands and observed outcomes in plan-linked artifacts.
- If a test cannot run, state exactly why and what remains unverified.
