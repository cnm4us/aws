Agent Operating Guide

Purpose
- Define what you (the agent) may do in this repository, how to use Git history for context, and how to format commit messages and handoffs so humans can scan and machines can parse.

Quick Triggers
- New thread: read `docs/agents/README.md`, `docs/agents/AGENTS.md`, `docs/agents/Handoff.md`; locate latest `Handoff_N`; create `Handoff_{N+1}`.
- "Ready to commit": refresh commit policy; output one pasteable `git commit` with multiple `-m` blocks; no `git add` unless asked.
- "Commit made": append commit hash (and timestamp) to the active handoff entry (Meta: Affects/Routes/DB/Flags).
- Editing `docs/agents/*`: re-check AGENTS.md scope/style and keep changes minimal and scoped.
- Before destructive or broad refactors: re-check Permission Model and Safety & Scope.

Permission Model
- History reads: You may read local Git history as needed to do the task.
  - Allowed: git log, git show, git diff, git blame (local only).
  - Limit to files relevant to the current change.
- Prohibited without explicit approval:
  - Destructive ops (git reset, rebase, force‑push).
  - Network ops (git fetch/pull/push) and branch creation.
  - Editing files outside the scope of the current task.
- Credentials & secrets: Never add secrets to Git. Honor .gitignore and keep env values out of commits.

Default Git Workflow
- By default, do not commit.
- Only provide a pasteable git commit when the user explicitly says they are ready to commit.
- Provide exactly one pasteable `git commit ...` command using multiple `-m` blocks (Subject, Context, Approach, Impact, Tests, Meta).
- Use real newlines inside each `-m` block; do not include literal `\n` escapes. Avoid here‑docs unless the user asks for them.
- Do not duplicate the commit message as plain text in the reply.
- Omit `git add`/staging commands unless the user asks for them.
- If the user authorizes auto‑commits in a thread, restrict commits to the paths they specify.
 - Plans: for multi-step or non-trivial work, use the plan tool to outline steps (keep exactly one step `in_progress`); update the plan only when step state changes.

Commit Message Policy (Conventional Commits + Meta)
- Subject (first line, ≤50 chars):
  - Format: type(scope): concise summary
  - Types: feat, fix, docs, test, refactor, chore, ci
  - Examples: 
    - feat(spaces): add settings page
    - fix(publications): allow owner republish
    - test(e2e): add UI login flow
- Blank line.
- Body (wrap ~72 cols). Explain:
  - Context (why)
  - Approach (how)
  - Impact (behavior/perf/compat)
  - Tests (what & where)
  - References (issues/links)
- Meta block (machine‑readable hints; 1 per line):
  - Meta:
    - Affects: <file paths>
    - Routes: <api routes>
    - DB: <schema change? none>
    - Flags: <feature flags? none>

Example Commit Message
```
feat(spaces): add require review toggle

Context:
- Split space admin into Settings/Members/Moderation and expose a per‑space
  requireApproval setting (site policy still takes precedence).

Approach:
- GET/PUT /api/spaces/:id/settings with guards; UI under /spaces/:id/admin/settings.
- Respect site settings; disable toggle when enforced.

Impact:
- New page; no breaking API. New posts follow the updated policy immediately.

Tests:
- E2E smoke + UI login; to add settings flow test.

References:
- docs/Handoff_06.md decisions

Meta:
- Affects: src/routes/spaces.ts; src/routes/pages.ts; public/space-settings.html
- Routes: GET/PUT /api/spaces/:id/settings
- DB: none
- Flags: none
```

Staging & Partial Commits
- Stage only the intended paths (common cases):
  - e2e/** for tests
  - docs/** for documentation
- Useful commands:
  - git status
  - git add e2e docs .gitignore
  - git diff --staged
  - git commit (paste the prepared message)

Plan Tool (quick example)
- When: use for multi-step or non-trivial work where sequencing matters or you want intermediate checkpoints.
- Structure: 4–6 concise steps (≤7 words each); exactly one step `in_progress`, others `pending`/`completed`.
- Update: mark a step `completed` before starting the next; only update the plan when step state changes.
- Example steps:
  1) Parse args — in_progress
  2) Implement service — pending
  3) Wire route — pending
  4) Prepare commit message — pending


Use of Git History
- Proactively use history to:
  - Understand rationale before altering behavior.
  - Avoid regressions and align with prior decisions.
  - Pinpoint earlier versions for comparisons.
- Prefer targeted reads:
  - git log --oneline -- <paths>
  - git show <commit>:<path>
  - git diff <old>..<new> -- <paths>
  - git blame <path>
 - Post‑commit traceability: after the user commits, record the latest commit hash (and optional timestamp) in the active handoff entry.

Testing Practices
- E2E (Playwright):
  - Tests live under e2e/ (tracked in Git).
  - Prefer stable selectors: data-e2e="…" (avoid brittle XPath).
  - Capture artifacts (screenshots/videos/traces) as configured.
  - Do not commit artifacts (playwright-report/, test-results/, e2e/.auth/ are ignored).
- API/Integration tests: keep them focused; do not rely on private DB schema where avoidable.

Safety & Scope
- Keep changes minimal and task‑focused; do not refactor broadly unless asked.
- Call out unrelated issues you notice, but don’t fix them unless requested.
- Agent docs live under `docs/agents/` only; do not duplicate handoffs/instructions elsewhere.

What to Produce in Handoffs by Default
- A short summary of what changed.
- When requested by the user: include only the pasteable `git commit` command.
- After the user commits: record the commit hash (and optional timestamp) alongside Meta (Affects/Routes/DB/Flags) for traceability.
- Any follow‑ups or risks discovered while working.

Preferred Pasteable Commit Command (example)
```
git commit -m "feat(example): concise subject" -m "Context:
- Why the change is needed." -m "Approach:
- How implemented." -m "Impact:
- Behavior and compatibility." -m "Tests:
- What was verified." -m "Meta:
- Affects: path/one; path/two
- Routes: /api/foo; /bar
- DB: none
- Flags: none"
```

Quoting tip
- When quoting inside an `-m "..."` block, use single quotes for the inner quote to avoid breaking the shell, e.g. `-m "another 'important' comment section"`. Avoid nested double quotes unless you escape them.
