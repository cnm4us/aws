# Plan 129 — Phase A Spec (Enums, Defaults, Migration Map)

## Purpose
Lock Phase A implementation inputs for multi-type prompt programs before schema/service work.

This spec reflects the locked decisions captured in `agents/implementation/plan_129.md`.

## Canonical Enums
## `audience_segment` (rule + decision matching)
- `anonymous`
- `authenticated_non_subscriber`
- `authenticated_subscriber`

Matching policy:
- exact match only
- no hierarchical fallback

## `prompt_type` (prompt + rule matching)
- `register_login`
- `fund_drive`
- `subscription_upgrade`
- `sponsor_message`
- `feature_announcement`

Matching policy:
- exact `prompt_type` match between rule and prompt candidates

## Global Pacing Configuration (`.env`)
Single source of truth (not per-rule):
- `PROMPT_MAX_PROMPTS_PER_SESSION`
- `PROMPT_MIN_SLIDES_BETWEEN_PROMPTS`
- `PROMPT_COOLDOWN_SECONDS_AFTER_PROMPT`
- `PROMPT_PASS_THROUGH_SUPPRESS_N`
- `PROMPT_PASS_THROUGH_MIN_VISIBLE_MS`

Default values for first implementation pass:
- `PROMPT_MAX_PROMPTS_PER_SESSION=2`
- `PROMPT_MIN_SLIDES_BETWEEN_PROMPTS=15`
- `PROMPT_COOLDOWN_SECONDS_AFTER_PROMPT=900`
- `PROMPT_PASS_THROUGH_SUPPRESS_N=2`
- `PROMPT_PASS_THROUGH_MIN_VISIBLE_MS=800`

## Pass-through + Conversion Semantics
Pass-through event condition:
- prompt is active
- no CTA click
- user navigates away (forward/backward)
- visible duration `>= PROMPT_PASS_THROUGH_MIN_VISIBLE_MS`

Suppression:
- suppress same `prompt_id` in-session after `PROMPT_PASS_THROUGH_SUPPRESS_N`
- suppression duration tied to cooldown window

Conversion:
- CTA click does not imply conversion completion
- CTA click marks prompt converted for in-session re-show suppression policy
- final conversion is tracked as backend-confirmed `flow_complete` in analytics phase scope

## Observability Canonical Labels
Canonical fields:
- `app.surface`
- `app.operation`
- `app.prompt_id`
- `app.prompt_type`
- `app.prompt_category`
- `app.audience_segment`
- `app.rule_id`
- `app.rule_reason`
- `app.outcome`

Canonical `app.outcome` values:
- `shown`
- `blocked`
- `pass_through`
- `cta_click`
- `flow_start`
- `flow_complete`

## Big-Bang Migration Map
## 1) Rules table migration
From:
- `auth_state`
- per-rule pacing fields (`min_*`, `max_*`, cooldown)
- category allowlist rule gating

To:
- `audience_segment`
- `prompt_type`
- no per-rule pacing controls

Rule backfill:
- existing `auth_state='anonymous'` -> `audience_segment='anonymous'`
- existing rules without explicit mapping -> `prompt_type='register_login'` (safe default for current behavior)

## 2) Prompts table migration
Add `prompt_type` with backfill mapping from existing prompt category:
- `register_prompt` -> `register_login`
- `fund_drive`, `donation_prompt`, `support_prompt` -> `fund_drive`
- `subscription_prompt`, `subscription_offer`, `upgrade_prompt` -> `subscription_upgrade`
- `sponsor`, `sponsor_message` -> `sponsor_message`
- all others -> `feature_announcement`

## 3) Decision/contract migration
- remove authenticated hard-stop path
- resolve viewer to canonical `audience_segment`
- evaluate rules using `surface + audience_segment + enabled`
- candidate selection by exact `prompt_type`

## 4) Event/label migration
- use canonical outcome names in new code path
- remove legacy terminology from new prompt path (`dismiss`, `auth_start`, `auth_complete`) in favor of canonical funnel naming

## Phase A Acceptance
Phase A is complete when:
- enum set is locked,
- global pacing env keys/defaults are locked,
- migration map/backfill behavior is documented,
- canonical observability names are locked for implementation.

