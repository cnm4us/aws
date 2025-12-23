# IMPLEMENTATION PLANNING GUIDE
This document explains how AI agents must create, update, and maintain
implementation plans. Implementation plans define the sequence of steps
required to implement a feature or change safely, in small increments, and
with developer approval at each stage.

This guide applies whenever the agent is in **Implementation Plan Mode**.

---

## TL;DR (For Agents)

- Only create or modify an implementation plan when the user asks for one or an existing plan needs to change.
- Store plans in `agents/implementation/plan_nn.md` and keep exactly one active at a time.
- Break work into small, testable steps that leave the system runnable and include a clear testing instruction.
- Testing must be **actually executed** in the target environment (not hypothetical, not “would pass”).
- Use `Status: Pending`, `Status: In Progress`, and `Status: Completed` per step, with at most one step In Progress at a time.
- Before starting the next step, update statuses in the plan file (and any plan-tracking tool) so future agents can reliably resume across sessions.
- External plan tools (for example, an `update_plan` helper) are optional mirrors; the on-disk `plan_nn.md` file is the source of truth.

---

## PURPOSE OF IMPLEMENTATION PLAN

Implementation plans:
- Break complex work into small, testable steps.
- Ensure each step leaves the system in a runnable state.
- Prevent the agent from coding prematurely.
- Allow the developer to review and approve each stage before execution.
- Provide a durable reference file that can be followed across many user
  requests or even multiple threads.

Plans are stored in:
`agents/implementation/plan_nn.md`

Only one plan is active at a time.

---

## WHEN TO CREATE OR UPDATE A PLAN
**Trigger:**  
- The user requests creation of a new implementation plan, **or**
- A previous implementation plan exists but requires modification due to:
  - developer feedback  
  - architectural changes  
  - discovered dependencies  
  - changes in requirements  

Do **not** create or modify plans during:
- Exploratory discussion
- High-level architectural exploration
- Ideation or brainstorming
- Partial or ambiguous requirements

If uncertain, ask the developer to confirm that you should begin drafting
a plan.

---

## STRUCTURE OF AN IMPLEMENTATION PLAN

Each plan must contain:

### 1. Overview  
- One short paragraph summarizing the goal.
- A clear statement of what is *in scope* and *out of scope*.

---

### 2. Step-by-Step Plan  
A numbered list of steps, where each step:
- Is small and atomic.
- Leaves the system running.
- Includes a testing instruction.
- Includes at least one **canonical test command** (e.g., `curl`/wrapper invocation) plus the expected outcome (status code + minimal shape).
- Ends with a checkpoint: “Wait for developer approval before proceeding.”

### 3. Tracking Progress Through the Plan

Implementation plans must record progress so the agent (and future agents)
know exactly which step is next.

Each step can have one of three statuses:

- `Status: Pending` (default)
- `Status: In Progress`
- `Status: Completed`

Use statuses consistently:
- `Status: Pending` — step is defined but work has not started.
- `Status: In Progress` — step is actively being executed.
  - At any given time, **at most one** step should be marked `Status: In Progress`.
- `Status: Completed` — step has been implemented and its testing instruction has passed.

When updating progress:
- Before starting work on a step, set its status to `Status: In Progress`.
- After completing implementation and tests, change the status to `Status: Completed`.
- Always record status changes in the implementation plan file (and in any active plan-tracking tool) before starting work on the next step; the on-disk plan file is the source of truth for resuming work across sessions.
- Only move on to the next step after the current step is `Status: Completed`.

---

## TESTING REQUIREMENTS (REAL ENVIRONMENT)

Agents must run tests in the **actual environment the user cares about** (local dev box, staging, prod), and record the real outputs.

Practical rules:
- Prefer small “contract tests” after each step:
  - status code
  - minimal required keys (JSON) or key markers (HTML)
  - RBAC checks where relevant (unauth vs regular user vs admin)
- Don’t claim a test passed unless it was executed and the output was observed.
- Avoid leaking secrets into logs. Do not paste session cookies, tokens, or credentials into plan files or tracked docs.

Recommended harness (repo convention):
- Use `scripts/auth_curl.sh` for API calls that require login / CSRF.
- Store credentials locally in a gitignored file:
  - `.codex-local/auth_profiles.env` (see `.codex-local/auth_profiles.env.example`)
- Use profiles for RBAC testing:
  - `./scripts/auth_curl.sh --profile <name> login`
  - `./scripts/auth_curl.sh --profile <name> me`

---

## WHERE TO RECORD TEST RESULTS

Use a two-layer approach:

1) In the plan file (`agents/implementation/plan_nn.md`)
- Under each step, list **canonical tests** (commands) and **expected outcomes** (brief).
- Keep this short so the plan stays readable.

2) In step log files (`agents/implementation/tests/plan_nn/`)
- Store the **actual executed outputs**.
- Suggested structure:
  - `agents/implementation/tests/plan_09/step_00_smoke.md`
  - `agents/implementation/tests/plan_09/step_03_api.md`
  - `agents/implementation/tests/plan_09/step_05_routing.md`
- Each log file should include:
  - date/time
  - `BASE_URL` (the environment)
  - commands run (code blocks)
  - captured output (redacted as needed)

This keeps the plan clean while preserving “ground truth” results for future agents/threads.

Optional convenience:
- When using `scripts/auth_curl.sh`, set `AUTH_LOG_FILE` to append results automatically for requests:
  - `AUTH_LOG_FILE="agents/implementation/tests/plan_09/step_03_api.md" BASE_URL="https://example.com" ./scripts/auth_curl.sh --profile super get /api/me`

---

### 4. Example Implementation Plan File

Plans live in `agents/implementation/plan_nn.md`.  
Below is a minimal example structure:

```markdown
# Implementation Plan: Improve Search Filters

## 1. Overview
Goal: Allow users to filter search results by specialty and date without breaking existing queries.

In scope:
- Backend search query changes to support new filters.
- API parameter handling and validation.
- Minimal UI wiring needed to pass new parameters.

Out of scope:
- Major UI redesign of the search page.
- Changes to authentication or permissions.

## 2. Step-by-Step Plan

1. Add backend support for new filters  
   Status: Pending  
   Testing:
   - Canonical (expected): `curl -sS "http://localhost:3300/api/search?specialty=..."` → `HTTP 200` and JSON includes `results[]`.  
   - Record actual output: `agents/implementation/tests/plan_nn/step_01_backend.md`  
   Checkpoint: Wait for developer approval before proceeding.

2. Wire API layer to accept filter parameters  
   Status: Pending  
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /api/search?...` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_nn/step_02_api.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Connect UI controls to API filters  
   Status: Pending  
   Testing:
   - Canonical (expected): manual browser check: “filters apply; legacy search unchanged”.  
   - Record actual notes: `agents/implementation/tests/plan_nn/step_03_ui.md`  
   Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes

- Step 1 — Status: Completed (2025-01-01) — Backend query updated; new tests added and passing.  
- Step 2 — Status: In Progress — API accepts parameters; final validation in progress.  
- Step 3 — Status: Pending.
```

Use this example as a structural template; adapt the goal, steps, and tests to the specific feature or change you are planning.
