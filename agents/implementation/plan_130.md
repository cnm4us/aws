# Plan 130: Rename Prompts to Messages

## Goal
Rename the feature concept from `Prompts` to `Messages` so the system language matches current reality:
- the feature is no longer only a login/register prompt,
- it now supports multiple injected in-feed units,
- future use cases include fundraising, sponsor messages, announcements, and other typed CTA units.

Primary outcomes:
- admin/product language uses `Messages` instead of `Prompts`,
- current delivery behavior remains unchanged,
- internal churn is controlled by separating user-facing rename from deep schema/code rename.

## Why Now
- `plan_129` expanded the system beyond a single prompt use case.
- Current terminology is now misleading in the UI and documentation.
- This is a naming/mental-model cleanup that will affect future features and team communication.

## Core Naming Model
Use these terms consistently:

1. Product/Admin term
- `Message`
- Example UI labels:
  - `/admin/messages`
  - `New Message`
  - `Message Analytics`

2. Delivery term
- `In-Feed Message`
- Use when describing how the unit behaves in the feed.

3. Structured subtype
- `Type`
- Existing values remain valid:
  - `register_login`
  - `fund_drive`
  - `subscription_upgrade`
  - `sponsor_message`
  - `feature_announcement`

4. Editorial / analytics grouping
- `Campaign Key`

## Key Decision
Do not do a full deep rename in one pass.

Rename layers in this order:
1. user-facing labels and routes,
2. docs and observability labels where they are user-meaningful,
3. optional internal/service/schema rename later if still worth the churn.

Rationale:
- `feed_prompts`, `prompt_decision_sessions`, and `feed_prompt_events` are stable and already working.
- Immediate schema renames would add cost and migration risk with little product value.
- The biggest value now is conceptual clarity in admin UX and documentation.

## Scope
- Admin UI label changes from `Prompt` -> `Message`
- Route strategy for admin pages (`/admin/messages`)
- Documentation updates
- Analytics/admin page relabeling where useful
- Terminology cleanup in user-facing copy

## Out Of Scope (This Plan)
- Deep DB table renames
- Deep TypeScript module/directory rename across all backend/frontend files
- Analytics event name migration
- Runtime behavior changes to pacing, targeting, or sequence insertion

## Current-State Recommendation
Short term:
- Keep internal tables and event names as-is:
  - `feed_prompts`
  - `prompt_decision_sessions`
  - `feed_prompt_events`
  - `feed_prompt_daily_stats`
- Rename the admin/product layer to `Messages`

Long term:
- Only rename internals if:
  - prompt/message vocabulary becomes a persistent source of engineering confusion,
  - or a broader multi-surface message platform justifies the migration cost.

## Implementation Strategy

### Phase A — Terminology Contract
Status: Complete

Locked decisions:
- `Message` = top-level admin/product term
- `In-Feed Message` = delivery-specific distinction when needed
- `Direct Messages` = reserved for future private user-to-user messaging
- `Type` = structured subtype
- `Campaign Key` = editorial/analytics grouping
- Primary admin routes:
  - `/admin/messages`
  - `/admin/messages/:id`
  - `/admin/message-analytics`
- Legacy prompt routes remain temporary redirects during transition.
- Internal `prompt_*` naming remains in place until later phases.

Implementation note:
- Inventory all remaining user-facing `Prompt` references during Phase B/E cleanup.

Acceptance:
- Signed-off terminology contract and rename inventory.

### Phase B — Admin UX Rename
Status: Complete

- Rename user-facing admin labels:
  - `Prompts` -> `Messages`
  - `Prompt Analytics` -> `Message Analytics` or `In-Feed Message Analytics`
  - `New Prompt` -> `New Message`
  - `Edit Prompt` -> `Edit Message`
- Keep `Type` and `Campaign Key` as-is.
- Preserve existing functionality and forms.

Acceptance:
- No user-facing admin copy still uses `Prompt` unless intentionally technical.

### Phase C — Admin Route Strategy
Status: Complete

- Add `/admin/messages` as the primary route.
- Decide whether `/admin/prompts` should:
  - redirect to `/admin/messages`, or
  - remain as a legacy alias.

Recommended:
- `/admin/messages` primary
- `/admin/prompts` temporary redirect for compatibility

Acceptance:
- Admin can manage messages from `/admin/messages`.

### Phase D — Analytics/UI Copy Alignment
Status: Complete

- Rename analytics page labels:
  - `Prompt` column/header -> `Message`
  - `Prompt ID` -> `Message ID`
  - `Prompt Analytics` -> `Message Analytics`
- Keep underlying query/storage fields unchanged in this phase unless necessary.

Acceptance:
- Reporting language matches the new admin vocabulary.

### Phase E — Documentation Cleanup
Status: Complete

- Update active implementation docs and feature docs to use `Message` terminology where appropriate.
- Keep historical plans unchanged unless a correction is necessary.
- Add a short note documenting that internal storage still uses `prompt_*` names for now.

Acceptance:
- Active docs no longer create ambiguity between `prompt` and `message`.

### Phase F — Deep Internal Rename (Phased)
Only proceed in bounded increments with a test gate after each phase.

#### Phase F1 — Shared Vocabulary + Low-Risk Alias Layer
Status: Complete

- Introduce `message` terminology in code comments, developer-facing labels, and low-risk type/interface names where possible.
- Add compatibility aliases only where they reduce transition friction.
- Do not rename DB tables or core runtime modules yet.

Test gate:
- `npm run build`
- `npm run web:build`
- admin message CRUD still works
- feed delivery still works

Acceptance:
- engineering-facing language starts converging without runtime churn

#### Phase F2 — Frontend Rename Layer
Status: Complete

- Rename frontend-facing prompt types/functions/modules to message terminology where practical.
- Preserve wire compatibility if needed for one phase.
- Keep backend storage/runtime names stable.

Test gate:
- feed message rendering works
- pass-through/click analytics still fire
- admin edit/save still works

Acceptance:
- frontend code uses message terminology without feed regressions

#### Phase F3 — Backend Service/Module Rename Layer
Status: Complete

- Rename backend service/repo/module names:
  - `prompts` -> `messages`
  - `prompt-analytics` -> `message-analytics`
  - `prompt-decision` -> `message-decision` (if still warranted)
- Keep DB table names unchanged in this phase.

Test gate:
- server build passes
- feed decisioning still works
- admin CRUD still works
- analytics still works

Acceptance:
- service/module naming aligns with product language while schema remains stable

#### Phase F4 — Route Rename + Compatibility Redirects
- Make message routes primary:
  - `/admin/messages`
  - `/admin/message-analytics`
- Keep redirects from legacy prompt routes during transition.

Test gate:
- new routes work directly
- old routes redirect cleanly
- admin navigation uses message routes

Acceptance:
- admin UX is fully message-first while compatibility remains intact

#### Phase F5 — Schema/Table Rename
- Rename core tables only after all upper layers are stable:
  - `feed_prompts` -> `feed_messages`
  - `prompt_decision_sessions` -> `message_decision_sessions`
  - `feed_prompt_events` -> `feed_message_events`
  - `feed_prompt_daily_stats` -> `feed_message_daily_stats`
- Update migrations, repos, analytics queries, and debug tooling accordingly.

Test gate:
- startup migration passes
- direct DB sanity queries pass
- admin CRUD works
- feed delivery works
- analytics pages work

Acceptance:
- internal storage names are aligned and runtime remains stable

#### Phase F6 — Telemetry/Event Rename
- Rename remaining telemetry/event names from `prompt_*` to `message_*` where desired.
- Update dashboards/docs accordingly.

Test gate:
- Jaeger tags still appear as expected
- Pino logs still appear as expected
- analytics ingestion/queries still work

Acceptance:
- observability naming aligns with final model

Recommended default:
- stop after Phases A-E unless there is clear engineering value in continuing
- if proceeding, complete F1-F4 before deciding whether F5/F6 are worth the migration cost

## Route / Naming Guidance

### Recommended user-facing route names
- `/admin/messages`
- `/admin/messages/:id`
- `/admin/message-analytics`

### Recommended compatibility behavior
- `/admin/prompts` -> redirect to `/admin/messages`
- `/admin/prompt-analytics` -> redirect to `/admin/message-analytics`
- These redirects are transitional and should be removed in a later cleanup pass after the new message routes are established.

## Observability Guidance
Use pragmatic split:

1. User-facing/admin labels
- `message`

2. Existing stable telemetry/storage names
- keep current `prompt_*` names in this phase unless they are directly exposed to users

Reason:
- observability churn is expensive and low-value here
- admin label clarity matters more than full telemetry rename right now

## Risks
- Partial rename can create mixed vocabulary (`prompt` in code, `message` in UI).
- Over-renaming internals too early can create migration noise with little value.
- Route aliasing can create temporary duplication if not documented clearly.

## Mitigations
- Explicit terminology contract in docs
- User-facing rename first, internal rename deferred
- Compatibility redirects for old admin routes
- Avoid changing stable analytics/storage names in the same pass

## Acceptance Criteria
1. Admins manage the feature under `Messages`, not `Prompts`.
2. Analytics/admin pages use message-oriented labels.
3. Existing behavior is unchanged.
4. Legacy admin prompt URLs still work via redirect or documented alias.
5. Internal schema and runtime remain stable unless a separate follow-up plan is approved.

## Recommendation
Implement Phases A-E first.  
For deep internal renames, proceed only phase-by-phase with testing after each increment.  
Default recommendation: stop after F4 unless F5/F6 are clearly justified.
