# Plan 132: Message Wire Contract and Residual Naming Cleanup

Status: Draft

## Goal
Clean up the remaining `prompt_*` naming residue that still exists after the completed UI, route, module, table, telemetry, and API-path renames.

Primary outcomes:
- public API request/response payloads become message-first
- first-party callers stop sending `prompt_*` keys
- analytics/admin query params become message-first
- browser debug/session payload fields become message-first
- remaining internal naming residue is reduced in a controlled order

## Why This Is A New Plan
`plan_130.md` and `plan_131.md` are complete.

What remains is not route cleanup anymore. It is a wire-contract and naming cleanup problem with different tradeoffs:
- request/response keys are part of compatibility contracts
- analytics query params affect admin tools and bookmarks
- DB column renames are higher-risk than path renames
- some `prompt_*` names are now only internal implementation details

This should be treated as a separate plan so we can decide where to stop.

## Current Remaining Naming Residue
### Public / wire-facing residue
Examples still present in active runtime contracts:
- `prompt_id`
- `prompt_campaign_key`
- `prompt_session_id`
- `prompt_type`
- `prompt_category`
- `prompts_shown_this_session`
- `slides_since_last_prompt`
- `last_prompt_id`
- `last_prompt_shown_at`

Current locations include:
- `frontend/src/app/Feed.tsx`
- `src/routes/feed-messages.ts`
- `src/app.ts`
- `src/routes/admin-message-analytics.ts`
- `src/routes/debug-browser.ts`

### Internal / storage residue
Examples still present in code and schema:
- `prompt_type` column in `feed_messages`
- `prompt_id` / `prompt_campaign_key` columns in analytics tables
- `last_prompt_shown_at`
- `slides_since_last_prompt`
- `prompts_shown_this_session`
- `invalid_prompt_*` error codes
- `prompt_*` analytics dimension docs

Current locations include:
- `src/db.ts`
- `src/features/message-decision/*`
- `src/features/message-analytics/*`
- `src/features/messages/*`
- `agents/analytics/*`

## Scope
- message-first request/response payload keys
- message-first analytics/admin query params
- message-first browser debug payload fields
- first-party caller migration to new keys
- bounded cleanup of internal non-schema names where low-risk
- optional schema/column rename phase if still justified

## Out Of Scope
- changing product behavior
- changing analytics event semantics
- changing retention or reporting logic
- deep DB column rename in the same pass as public wire cleanup unless explicitly approved phase-by-phase

## Recommended Naming Contract
### Feed decision payloads
Replace:
- `prompts_shown_this_session` -> `messages_shown_this_session`
- `slides_since_last_prompt` -> `slides_since_last_message`
- `last_prompt_id` -> `last_message_id`
- `last_prompt_shown_at` -> `last_message_shown_at`

### Feed decision response
Replace:
- `prompt_id` -> `message_id`

### Feed message fetch payload
Replace:
- top-level `prompt` object -> `message`
- `prompt_type` -> `message_type` or simply `type`

Recommendation:
- use `message` and `type`
- keep `campaign_key` as-is

### Feed event ingestion payload
Replace:
- `prompt_id` -> `message_id`
- `prompt_campaign_key` -> `message_campaign_key`
- `prompt_session_id` -> `message_session_id`
- `prompt_category` -> remove legacy alias

### Admin analytics query params
Replace:
- `prompt_id` -> `message_id`
- `prompt_type` -> `message_type`
- `prompt_campaign_key` -> `message_campaign_key`
- `prompt_category` -> remove legacy alias

### Browser debug payloads
Replace:
- `prompt_session_id` -> `message_session_id`
- residual `prompt_*` event payload fields -> `message_*`

## Implementation Strategy
### Phase A — Contract Lock
- confirm the message-first key set above
- decide whether fetch payload should expose `message.type` or `message.message_type`
- confirm legacy `prompt_*` keys remain as temporary aliases during migration
- decide whether internal DB column rename is in scope for this plan or explicitly deferred

Recommendation:
- API payloads should use `message_id`, `message_campaign_key`, `message_session_id`
- fetch payload should use `message` with `type`
- DB column rename should be a later optional phase, not bundled into the first contract migration

Acceptance:
- signed wire-contract decision with explicit compatibility policy

### Phase B — Add Message-First Wire Aliases
- make feed decision accept both prompt and message counter keys
- make feed decision response include `message_id` while optionally preserving `prompt_id`
- make feed fetch return `message` payload while optionally preserving `prompt`
- make feed event ingestion accept both prompt and message event keys
- make admin analytics accept both prompt and message query params
- make auth-complete callback accept both prompt and message keys
- make browser debug ingest accept both prompt and message session keys

Test gate:
- old and new wire keys both work
- Jaeger/Pino still show correct message operations
- feed and analytics flows remain stable

Acceptance:
- message-first wire keys exist without breaking compatibility

### Phase C — Migrate First-Party Callers
- switch frontend feed caller payloads to `message_*`
- switch auth return/callback payloads to `message_*`
- switch admin analytics links/forms/query builders to `message_*`
- switch browser debug context payload to message-first only
- update active docs/examples to message-first payloads

Test gate:
- normal feed traffic emits only message-first payload keys from first-party clients
- admin analytics page still loads and exports correctly
- browser debug still works

Acceptance:
- first-party traffic is message-first at the wire level

### Phase D — Remove Legacy Prompt Wire Aliases
- remove prompt-key aliases from request parsing where first-party migration is complete
- remove prompt-key aliases from response payloads
- remove prompt-key aliases from active docs/examples
- keep a short changelog note documenting the wire cutoff

Test gate:
- old prompt-key requests fail or are rejected as expected
- new message-key requests succeed
- feed, admin analytics, and auth-complete flows remain stable

Acceptance:
- public wire contracts are message-first

### Phase E — Low-Risk Internal Naming Cleanup
- rename local variables, helper names, and validation errors from prompt-first to message-first where this does not require schema changes
- examples:
  - `promptId` -> `messageId`
  - `promptCampaignKey` -> `messageCampaignKey`
  - `invalid_prompt_*` -> `invalid_message_*`
- update analytics/docs terminology accordingly

Test gate:
- builds pass
- no behavior change

Acceptance:
- internal code no longer drifts toward prompt-first naming unnecessarily

### Phase F — Optional Schema / Column Rename
This is the highest-risk phase and should only proceed if the remaining DB naming is still creating real confusion.

Potential targets:
- `feed_messages.prompt_type` -> `type`
- `feed_message_events.prompt_id` -> `message_id`
- `feed_message_events.prompt_campaign_key` -> `message_campaign_key`
- `feed_message_daily_stats.prompt_id` -> `message_id`
- `feed_message_daily_stats.prompt_campaign_key` -> `message_campaign_key`
- `message_decision_sessions.last_prompt_shown_at` -> `last_message_shown_at`
- `message_decision_sessions.slides_since_last_prompt` -> `slides_since_last_message`
- `message_decision_sessions.prompts_shown_this_session` -> `messages_shown_this_session`

Recommendation:
- do not start Phase F until Phases A-E are complete and stable
- use explicit migration/backfill/rename steps, not ad hoc dual-write drift

Test gate:
- startup migration passes
- direct DB sanity queries pass
- feed/admin/analytics behavior is unchanged

Acceptance:
- storage schema is message-first

## Risks
1. Wire-compatibility breakage
- stale clients or bookmarked URLs may keep sending `prompt_*` keys

2. Partial dual-contract drift
- supporting both old and new keys too long can create confusion

3. Schema migration risk
- DB column renames are more brittle than route/path aliases

4. Analytics/reporting mismatch
- renamed query params can diverge from underlying storage names if not documented clearly

5. Hidden callback dependencies
- auth-complete or CTA-return paths may still depend on prompt-key payloads

## Mitigations
- introduce message-first keys before removing prompt-key aliases
- migrate first-party callers before alias removal
- keep schema rename as a separate optional later phase
- verify auth-complete and analytics flows explicitly
- document payload cutoff clearly when aliases are removed

## QA Checklist
- feed decision accepts and returns message-first keys
- feed fetch returns message-first payload shape
- feed events accept message-first keys
- first-party feed traffic uses message-first keys only
- `/admin/message-analytics` works with message-first query params
- auth-complete tracking works with message-first keys
- browser debug output uses `message_session_id`
- old prompt-key wire contracts still work during transition and fail after cutoff

## Acceptance Criteria
1. First-party clients use message-first payload and query keys.
2. Public API examples and active docs are message-first.
3. Legacy prompt-key aliases are temporary and removable.
4. Schema rename, if pursued, happens only in a later explicit phase.

## Recommendation
Proceed in two bounded layers:
1. complete Phases A-D for public wire contracts
2. then decide whether Phases E-F are worth the remaining churn

Default recommendation:
- complete A-D
- treat E as opportunistic cleanup
- defer F unless DB naming is causing real engineering cost
