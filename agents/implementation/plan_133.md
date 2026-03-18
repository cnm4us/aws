# Plan 133: Clean Message Conversion Finish Pass

Status: Active — Phases A-D Complete

## Goal
Finish the prompt-to-message conversion so active runtime code, canonical analytics, debug tooling, and asset naming all use message-first terminology.

This plan assumes:
- development environment only
- no permanent analytics/reporting history must be preserved
- breaking old prompt-era contracts is acceptable if done coherently in one controlled pass

## Why This Is A New Plan
`plan_130.md`, `plan_131.md`, and `plan_132.md` completed the major conversion:
- UI is message-first
- routes and API paths are message-first
- tables and columns are message-first

What remains is the final cleanup layer:
- prompt-named internal types and DTOs
- prompt-named admin JSON response keys
- prompt-named canonical analytics event names and fields
- prompt-era debug compatibility shims
- prompt-era asset usage names such as `prompt_bg`

These remaining items touch different systems and should be tracked explicitly rather than folded into a finished plan.

## Current Remaining Residue
### Runtime code
- prompt-named TS types and interfaces:
  - `PromptRow`, `PromptDto`
  - `PromptDecision*`
  - `PromptAnalytics*`
- prompt-named local variables and params still flowing through service boundaries
- admin API JSON response bodies that still return `{ prompt: ... }`

Current locations include:
- `src/features/messages/types.ts`
- `src/features/messages/service.ts`
- `src/features/message-decision/types.ts`
- `src/features/message-decision/service.ts`
- `src/features/message-analytics/types.ts`
- `src/features/message-analytics/service.ts`
- `src/routes/admin-messages.ts`

### Debug compatibility
- legacy debug toggle:
  - `prompt:debug`
- legacy DOM event:
  - `feed:prompt-debug`
- legacy sequence hook event:
  - `sequence_prompt_inserted`

Current locations include:
- `frontend/src/app/Feed.tsx`
- `agents/tools/debugging.md`

### Canonical analytics
- canonical event names still use prompt-era names:
  - `prompt_impression`
  - `prompt_click_primary`
  - `prompt_click_secondary`
  - `prompt_dismiss`
  - `auth_start_from_prompt`
  - `auth_complete_from_prompt`
- canonical analytics field names still use prompt-era names:
  - `prompt_id`
  - `prompt_campaign_key`
  - prompt-era report field names in analytics services/types/docs

Current locations include:
- `src/features/analytics-events/contract.ts`
- `src/features/analytics-sink/service.ts`
- `src/features/message-analytics/types.ts`
- `src/features/message-analytics/repo.ts`
- `src/features/message-analytics/service.ts`
- `agents/analytics/*`

### Asset and derivative naming
- `prompt_bg`
- prompt-era derivative keys:
  - `prompt_bg_p_1x`
  - `prompt_bg_p_2x`
  - `prompt_bg_l_1x`
  - `prompt_bg_l_2x`
- route:
  - `/api/uploads/:id/prompt-bg`

Current locations include:
- `src/config.ts`
- `src/routes/uploads.ts`
- `src/features/uploads/service.ts`
- `src/features/upload-image-variants/service.ts`
- `src/media/jobs/uploadImageDerivativesV1.ts`
- `src/routes/pages.ts`
- `frontend/src/app/CreateVideo.tsx`

## Scope
- rename remaining prompt-first runtime types and JSON payload names to message-first
- remove prompt-era debug compatibility shims
- rename canonical analytics event names and canonical message analytics fields
- rename prompt-era asset derivative usage and upload helper naming
- update active docs to match the final message-first contract

## Out Of Scope
- historical archived plans unless they are actively misleading
- changing message product behavior
- introducing new analytics semantics beyond renaming
- changing non-message features that merely reference old historical plans

## Phase A Locked Decisions
- Canonical analytics event names will become:
  - `message_impression`
  - `message_click_primary`
  - `message_click_secondary`
  - `message_dismiss`
  - `auth_start_from_message`
  - `auth_complete_from_message`
- Canonical analytics field names will become:
  - `message_id`
  - `message_campaign_key`
- Asset background usage name will become:
  - `message_bg`
- Asset derivative preset keys will become:
  - `message_bg_p_1x`
  - `message_bg_p_2x`
  - `message_bg_l_1x`
  - `message_bg_l_2x`
- Admin message API JSON responses should use `{ message: ... }`, not `{ prompt: ... }`.
- Runtime TypeScript types should be message-first as the primary names. Prompt-named aliases should be removed unless they are still required within the same phase.
- This plan uses a hard cut where practical. Do not preserve prompt-era compatibility shims unless a same-phase migration step still needs them temporarily.

## Phase A — Contract Lock (Complete)
- decide the final canonical analytics event names
- decide final canonical analytics field names
- decide final asset usage name replacing `prompt_bg`
- decide whether any temporary aliases remain during this plan or whether this is a hard cut

Recommendation:
- canonical analytics event names become:
  - `message_impression`
  - `message_click_primary`
  - `message_click_secondary`
  - `message_dismiss`
  - `auth_start_from_message`
  - `auth_complete_from_message`
- canonical analytics field names become:
  - `message_id`
  - `message_campaign_key`
- asset usage name becomes:
  - `message_bg`
- because this is still DEV, use a hard cut where practical instead of carrying extra aliases

Acceptance:
- complete
- naming contract recorded for analytics, asset usages, and runtime/admin response shapes

## Phase B — Runtime Types And Admin JSON Cleanup (Complete)
- rename prompt-first runtime TS types/interfaces to message-first
- examples:
  - `PromptRow` -> `MessageRow`
  - `PromptDto` -> `MessageDto`
  - `PromptDecisionInput` -> `MessageDecisionInput`
  - `PromptAnalyticsReport` -> `MessageAnalyticsReport`
- remove compatibility aliases added during earlier phases where they are no longer useful
- rename admin message API response payloads from:
  - `{ prompt: ... }`
  - to `{ message: ... }`
- rename remaining admin-local JSON/report field names where low risk

Test gate:
- `npm run build`
- `npm run web:build`
- `/admin/messages`
- `/admin/message-analytics`
- feed injection still works

Acceptance:
- active runtime code no longer uses prompt-first type names as the primary contract

## Phase C — Debug Contract Cleanup (Complete)
- remove prompt-era browser debug compatibility shims:
  - `prompt:debug`
  - `feed:prompt-debug`
  - `sequence_prompt_inserted`
- keep only message-first debug terminology:
  - `message:debug`
  - `feed:message-debug`
  - `sequence_message_inserted`
- update debug docs and any helper text accordingly

Test gate:
- message debug still writes to `debug/console/`
- feed/sequence/index debug events still appear with message-first names

Acceptance:
- browser debug and local debugging docs are message-first only

## Phase D — Canonical Analytics Rename (Complete)
- rename canonical analytics event names from prompt-first to message-first
- rename canonical analytics field names from prompt-first to message-first
- update message analytics repo/service/types accordingly
- update external analytics sink payload fields accordingly
- update admin analytics exports/report field names accordingly
- update active analytics docs accordingly

Likely touch points:
- `src/features/analytics-events/contract.ts`
- `src/features/analytics-sink/service.ts`
- `src/features/message-analytics/*`
- `agents/analytics/*`

Test gate:
- message impression/click/pass-through/auth-start/auth-complete still ingest correctly
- `/admin/message-analytics` still reports correctly
- CSV export still matches the new canonical field names
- Jaeger/Pino analytics spans still make sense after rename

Acceptance:
- canonical analytics events and fields are message-first

## Phase E — Asset Naming Cleanup
- rename asset/derivative usage from `prompt_bg` to `message_bg`
- rename derived preset keys from `prompt_bg_*` to `message_bg_*`
- add/update upload helper naming and routes accordingly
- update callers in admin preview/feed/background selection
- remove old prompt-era asset alias paths if not needed

Likely touch points:
- `src/config.ts`
- `src/routes/uploads.ts`
- `src/features/uploads/service.ts`
- `src/features/upload-image-variants/service.ts`
- `src/media/jobs/uploadImageDerivativesV1.ts`
- `src/routes/pages.ts`
- `frontend/src/app/CreateVideo.tsx`

Test gate:
- message backgrounds still render in feed
- admin message preview still renders image/video backgrounds
- upload-derived URLs still resolve correctly

Acceptance:
- asset and derivative naming is message-first

## Phase F — Final Sweep And Changelog
- remove leftover compatibility comments that are no longer true
- prune obsolete migration shims if they only supported prompt-era compatibility inside DEV
- update active docs:
  - `agents/tools/debugging.md`
  - `docs/OBSERVABILITY_MATRIX.md`
  - `agents/features/feature_13.md`
- add a short closeout note summarizing what still intentionally remains prompt-named, if anything

Test gate:
- repo-wide grep for active runtime `prompt_*` residue is reduced to intentionally retained legacy/historical references only
- worktree builds cleanly

Acceptance:
- message conversion is effectively complete for active runtime systems

## Risks
1. Analytics rename breakage
- ingest, rollup, reporting, and sink code must all change together

2. Hidden response-shape dependencies
- admin or feed helpers may still assume prompt-named response bodies

3. Asset alias misses
- preview/feed/background rendering can break if one old `prompt_bg` caller is missed

4. Over-cleaning historical docs
- rewriting historical plans can erase useful context

## Mitigations
- take analytics as a dedicated phase, not scattered edits
- verify each phase with smoke tests before moving on
- keep runtime docs current, leave archived docs mostly untouched
- prefer repo-wide searches before each commit to catch residual prompt-era references

## Exit Criteria
This plan is complete when:
- active runtime code is message-first
- canonical analytics names are message-first
- debug tooling is message-first
- asset naming for message backgrounds is message-first
- remaining `prompt` references are either historical, archival, or intentionally retained with explicit justification
