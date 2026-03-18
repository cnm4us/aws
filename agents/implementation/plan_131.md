# Plan 131: Message-First API Path Cleanup

Status: Draft

## Goal
Reduce remaining `prompt` terminology in runtime HTTP span names and API usage by introducing message-first API paths, migrating first-party callers to them, and then removing legacy prompt-path aliases after verification.

Primary outcomes:
- Jaeger operation search becomes message-first for new traces.
- First-party frontend/admin callers use `/message-*` API paths instead of `/prompt-*` paths.
- Legacy prompt API paths remain available during transition, then are removed in a controlled follow-up step.

## Why This Is Separate From Plan 130
`plan_130` is complete.

This work is a new compatibility and API-surface cleanup with its own risks:
- HTTP route names directly affect Jaeger operation names.
- Partial path migration can break feed reads/writes, admin actions, CSV export, and analytics ingestion.
- A staged alias strategy is safer than folding more work into a closed rename plan.

Recommendation:
- treat this as `plan_131.md`, not `Phase F7` of `plan_130.md`
- keep `plan_130.md` closed as the completed message rename program

## Current State
Message-first terminology is already complete in:
- admin/product UI
- frontend/backend module names
- storage table names
- most telemetry tags and log events

Remaining prompt-era artifacts are concentrated in API paths and some request payload keys.

Examples still visible in current runtime paths:
- `/api/feed/prompt-decision`
- `/api/feed/prompts/:id`
- `/api/feed/prompt-events`
- `/api/admin/prompts`
- `/api/admin/prompts/:id`
- `/api/admin/prompt-analytics`

Important note:
- old Jaeger traces will continue to show legacy prompt-named operations until trace retention ages them out
- this plan only affects new traces after rollout

## Scope
- add message-first API paths
- switch first-party callers to message-first API paths
- preserve prompt-path compatibility aliases during transition
- verify Jaeger/Pino/browser-debug behavior after cutover
- remove legacy prompt-path aliases after a bounded verification window

## Out Of Scope
- request payload key rename such as `prompt_id`, `prompt_campaign_key`, `prompt_session_id`
- analytics event name migration in payload/database rows
- further message feature behavior changes

## Route Contract
### Feed API
Primary routes:
- `POST /api/feed/message-decision`
- `GET /api/feed/message-decision`
- `GET /api/feed/messages/:id`
- `POST /api/feed/message-events`

Legacy aliases during transition:
- `POST /api/feed/prompt-decision`
- `GET /api/feed/prompt-decision`
- `GET /api/feed/prompts/:id`
- `POST /api/feed/prompt-events`

### Admin API
Primary routes:
- `GET /api/admin/messages`
- `POST /api/admin/messages`
- `GET /api/admin/messages/:id`
- `PATCH /api/admin/messages/:id`
- `DELETE /api/admin/messages/:id`
- `POST /api/admin/messages/:id/clone`
- `POST /api/admin/messages/:id/status`
- `GET /api/admin/message-analytics`
- `GET /api/admin/message-analytics.csv`

Legacy aliases during transition:
- `GET /api/admin/prompts`
- `POST /api/admin/prompts`
- `GET /api/admin/prompts/:id`
- `PATCH /api/admin/prompts/:id`
- `DELETE /api/admin/prompts/:id`
- `POST /api/admin/prompts/:id/clone`
- `POST /api/admin/prompts/:id/status`
- `POST /api/admin/prompts/:id/delete`
- `GET /api/admin/prompt-analytics`
- `GET /api/admin/prompt-analytics.csv`

## Implementation Strategy
### Phase A — Contract Lock
- confirm the message-first API route set above
- explicitly keep legacy prompt API aliases during migration
- confirm this is not a payload-key rename plan

Acceptance:
- signed route contract for primary vs compatibility paths

### Phase B — Add Message-First Route Aliases
Status: Complete

- expose message-first feed API paths alongside existing prompt paths
- expose message-first admin API paths alongside existing prompt paths
- ensure auth/CSRF/middleware behavior is identical for both path sets
- update route-level observability mapping in `src/lib/observability.ts`

Test gate:
- both old and new endpoints return the same behavior
- Jaeger shows message-first HTTP operations when new paths are hit

Acceptance:
- message-first API paths exist without breaking existing callers

### Phase C — Migrate First-Party Callers
Status: Complete

- switch frontend feed code to message-first paths
- switch admin pages/forms/XHR/CSV links to message-first paths
- update docs and debugging guidance to show message-first API paths first

Test gate:
- feed message delivery works end-to-end
- admin create/edit/clone/delete/status works
- admin analytics page and CSV export work
- browser debug still works

Acceptance:
- first-party traffic primarily uses message-first API paths

### Phase D — Verification Window
Status: Complete

- keep prompt-path aliases in place temporarily
- use Jaeger and Pino to confirm traffic is landing on message-first paths
- spot-check that no important first-party flows still depend on prompt paths

Test gate:
- repeated smoke tests show expected message-first HTTP paths in Jaeger
- no unexplained 404/405/CSRF regressions

Acceptance:
- safe to remove prompt-path aliases

### Phase E — Remove Legacy Prompt API Aliases
- remove prompt-path aliases after verification
- update observability docs to drop alias language where appropriate
- keep a short changelog note documenting the cutoff

Test gate:
- no prompt-path routes remain active
- Jaeger new traces are message-first except for retained historical traces

Acceptance:
- runtime API surface is message-first

## Risks
1. Partial alias coverage
- one missed secondary route can break clone/status/delete/CSV/feed event ingestion

2. Client-path mismatch
- feed or admin code may continue posting to removed prompt routes

3. Middleware drift
- auth/CSRF/session behavior can diverge if aliases are not wired symmetrically

4. Jaeger confusion during transition
- both prompt and message HTTP operations will appear until old traces age out

5. Hidden external callers
- bookmarks/scripts/manual tools may still hit prompt paths

## Mitigations
- add new message-first paths before removing old paths
- migrate first-party callers before alias removal
- verify every secondary route explicitly
- keep alias removal as a separate final phase
- document that Jaeger historical prompt operations will persist until retention expiry

## QA Checklist
- `/api/feed/message-decision` works for anonymous and authenticated viewers
- `/api/feed/messages/:id` returns message payload correctly
- `/api/feed/message-events` records impressions, pass-through, and clicks
- `/api/admin/messages` CRUD works via API and page flows
- `/api/admin/message-analytics` loads
- `/api/admin/message-analytics.csv` downloads with expected filename
- Jaeger shows:
  - `POST /api/feed/message-decision`
  - `GET /api/feed/messages/:id`
  - `POST /api/feed/message-events`
  - `GET /api/admin/message-analytics`
- prompt-path aliases still work during transition
- prompt-path aliases are removed only after message-first paths are proven stable

## Acceptance Criteria
1. First-party callers use message-first API paths.
2. Jaeger operation search becomes message-first for newly generated traffic.
3. Prompt-path aliases are kept only during the transition window.
4. Alias removal happens only after explicit verification.
5. Historical Jaeger prompt operations are understood as retained old traces, not active regressions.

## Recommendation
Proceed as a new plan.

This is a compatibility and API-surface migration, not an extension of the completed rename plan. `plan_130.md` should remain closed.
