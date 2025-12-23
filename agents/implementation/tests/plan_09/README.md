# plan_09 test logs

Keep `agents/implementation/plan_09.md` focused on *what* we’re building and the canonical test commands.

Keep this directory focused on *real executed outputs* so new threads can quickly see:
- which exact commands were run
- what the environment returned
- what changed step-to-step

Suggested convention:
- One file per step: `step_XX_<name>.md`
- Each file includes:
  - date/time
  - BASE_URL
  - commands run (as code blocks)
  - captured output (redacting secrets; `scripts/auth_curl.sh` already redacts `Set-Cookie` headers when `--include` is used)

Recommended workflow:
- Use `AUTH_LOG_FILE` to automatically append results for each request:
  - `AUTH_LOG_FILE="agents/implementation/tests/plan_09/step_03_api.md" BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super get /api/pages/home`
- Keep “expected” outcomes in `agents/implementation/plan_09.md`; keep “actual” outputs in these step files.
