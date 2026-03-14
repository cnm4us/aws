# Plan 129: Multi-Type Prompt Programs (Audience Targeting + Rules-Based Delivery)

## Goal
Extend prompt orchestration from a single anonymous register/login use case into a reusable program that supports multiple prompt types and audience states, while preserving feed stability and sequence integrity.

Primary outcomes:
- support multiple prompt programs concurrently (example: anonymous registration, authenticated non-subscriber fund drive),
- target prompts by audience state instead of hard-blocking authenticated users,
- keep prompt insertion non-destructive in feed sequence,
- preserve predictable pacing and anti-spam behavior.

## Why Now
- Feed sequencing is now key-based and stable (`plan_128`), so we can safely expand prompt variety.
- Current implementation has a hard authenticated block in decisioning/client behavior.
- Product direction needs prompt programs beyond auth onboarding.

## Scope
- Prompt audience targeting (anonymous + authenticated variants).
- Prompt type taxonomy and rule filtering.
- Decision service updates for multi-state eligibility.
- Admin UI updates for prompt/rule configuration.
- Feed client updates to allow targeted authenticated prompts.
- Suppression policy based on repeated impressions/pass-through.

## Out Of Scope (This Plan)
- Full analytics redesign (covered by `plan_118`/`plan_119`).
- Advanced ML personalization.
- Multi-surface rollout beyond currently supported feed surfaces unless explicitly added in phase output.

## Pre-Implementation Checklist (Decisions To Lock)
1. Audience-state source of truth
- Final logic for `authenticated_non_subscriber` vs `authenticated_subscriber`.
- Fallback behavior when subscription state is unknown.

2. Rule precedence contract
- Confirm deterministic ordering when multiple rules match:
  - `priority`
  - tie-break
  - prompt-type matching interactions.

3. Pass-through semantics
- Exact trigger condition (active prompt then scroll away without CTA click).
- Suppression defaults (`N` pass-throughs, suppression window duration).

4. Compatibility strategy
- Keep legacy aliases during rollout:
  - `cooldown_seconds_after_dismiss` -> `cooldown_seconds_after_prompt`
  - `prompt_dismiss` event -> `pass_through` semantics.
- Define cutoff point for final cleanup.

5. Client gating policy
- Remove authenticated hard-stop in feed client.
- Treat server decision service as source of truth for all audience states.

6. Admin UX scope
- Final first-release `prompt_type` option list.
- Confirm whether rules use single `prompt_type` or multi-select.

7. Observability label contract
- Finalize standard outcome labels (`shown|blocked|pass_through|cta_click|flow_start|flow_complete`).
- Confirm dashboard label mapping for existing data.

8. Rollout controls
- Feature flag name/final default.
- Initial cohort and rollback criteria.

## Locked Decisions (Confirmed)
### 1) Audience-state source of truth
- Adopt hybrid resolver strategy:
  - short term: resolve subscriber state from active subscription to the global feed space/channel,
  - long term: swap resolver to site-level entitlement source without changing prompt-rule contracts.
- Implement a single server-side resolver function used by prompt decisioning.

### 2) Rule precedence contract
- Decision ordering:
  1. filter rules by `surface + audience_segment + enabled`,
  2. sort by `priority` ascending,
  3. tie-break within same priority (`random` for v1),
  4. filter prompt candidates by active/status + exact `prompt_type` match,
  5. apply suppression/cooldown checks,
  6. if no candidate remains, return `reason_code=no_candidate`.
- Audience-state matching rule:
  - exact match only (no hierarchical fallback),
  - `authenticated_subscriber` does not match `authenticated`,
  - cohort overlap must be configured explicitly via separate rules (or explicit multi-select in future schema).

### 3) Pass-through semantics + suppression
- Pass-through trigger:
  - prompt became active,
  - no CTA click,
  - user advanced away (forward or backward slide change),
  - prompt was visible for at least `800ms` (anti-accidental swipe guard).
- Suppression policy:
  - suppress same `prompt_id` after `N=2` pass-throughs in-session,
- suppression duration uses existing cooldown window,
- suppression is scoped to that prompt (does not suppress other prompt types).
- Conversion handling:
  - CTA click marks prompt as converted in-session,
  - converted prompt is suppressed for remainder of session (or extended conversion cooldown),
  - conversion does not reset pass-through counters in a way that would increase re-show frequency.

### 4) Compatibility strategy
- Adopt big-bang rename/cutover for this phase:
  - migrate to canonical naming in schema/contracts/events immediately,
  - remove legacy aliases in code path (no dual-read/write),
  - update admin/report labels and decision payloads in the same release.
- Rationale: single-developer test environment; prioritize conceptual clarity over migration shims.

### 5) Rollout control
- Use a single feature flag:
  - `PROMPT_AUDIENCE_TARGETING_V1=0|1`
- Default `0` (off), explicit enable in dev when ready.
- Rollback path:
  - set flag back to `0` and restart service.

### 6) Pacing model simplification
- Remove pacing controls from `prompt_rules` entirely.
- Use global `.env` controls as single source of truth:
  - `PROMPT_MAX_PROMPTS_PER_SESSION`
  - `PROMPT_MIN_SLIDES_BETWEEN_PROMPTS`
  - `PROMPT_COOLDOWN_SECONDS_AFTER_PROMPT`
  - `PROMPT_PASS_THROUGH_SUPPRESS_N`
  - `PROMPT_PASS_THROUGH_MIN_VISIBLE_MS`
- Decisioning applies these global gates after rule/candidate selection and before insertion.

### 7) Rule-to-prompt matching simplification
- Rules use a single `prompt_type` selector for delivery matching (exact match).
- `category` remains prompt metadata for reporting/editorial grouping only.
- No category-based gating in decisioning for v1.

### 8) Audience UI model
- Use single-select `audience_segment` (no checkbox combinations).
- Audience matching remains exact-match only.
- If same creative is needed across cohorts, use clone workflow with separate prompt/rule rows.

### 9) Suppression scope
- First-pass suppression key: `prompt_id` in-session.
- Optional future escalation: suppress by `(audience_segment, prompt_type)` only if prompt-level suppression is insufficient.

## Prompt Program Model (v1 for multi-type)
Use existing `feed_prompts` + `prompt_rules` foundation with explicit program dimensions:

1. Prompt Type
- Examples:
  - `register_login`
  - `fund_drive`
  - `subscription_offer`
  - `sponsor_message`
  - `feature_announcement`

2. Audience State
- Initial enum (`audience_segment`):
  - `anonymous`
  - `authenticated_non_subscriber`
  - `authenticated_subscriber`

3. Delivery Controls
- Pacing is global and environment-driven (not per-rule):
  - max prompts per session
  - min slides between prompts
  - cooldown seconds between prompts
  - pass-through suppression threshold
  - minimum visible milliseconds for pass-through counting
- Rules choose *which* prompt program applies; global pacing controls *when* insertion is allowed.

## Data/Contract Changes
## Prompt Content
- Add/normalize `prompt_type` on prompts (default mapped for existing prompts).
- Keep `category` as business label; use `prompt_type` for delivery mechanics.

## Rules
- Replace `auth_state` with single-select `audience_segment` in rules.
- Add `prompt_type` selector on rules (single value match).
- Remove per-rule pacing fields (`min_*`, `max_*`, cooldown) from rule schema/UI/service.

## Decision Session State
- Keep session counters and `last_prompt_shown_at`.
- Add lightweight pass-through counters:
  - per `prompt_id` impressions shown in session,
  - per `prompt_id` pass-through count,
  - optional per `prompt_type` suppression counter.

## API Contract
- Decision request includes resolved viewer context from server session.
- Decision response includes selected prompt metadata needed by feed insertion.

## Audience Resolution
Create server-side resolver for viewer state:
- `anonymous` when no user session.
- `authenticated` base fallback.
- `authenticated_non_subscriber` / `authenticated_subscriber` based on subscription status source of truth.

No client trust for audience-state claims.

## Suppression Policy (first pass)
Treat scroll-past as pass-through signal (no dismiss action required).

Default suppression behavior:
- if same `prompt_id` has `N` pass-through events in-session without `cta_click`/`flow_start`, temporarily suppress that `prompt_id`,
- allow other eligible prompt types to continue,
- suppression resets per session.

Initial recommended defaults:
- `N = 2` pass-throughs for same prompt before temporary suppression.
- suppression duration tied to cooldown window.

## Feed Behavior Requirements
- Prompt slides remain first-class sequence items.
- No prompt removal mutation during gesture flow.
- Prompt insertion follows existing key-based sequence path.
- Authenticated users can receive prompts when eligible by rule (remove hard-block behavior).

## Admin UX Requirements
## `/admin/prompts`
- Add `Prompt Type` selector.
- Keep category selector.
- Keep creative editor unchanged unless type-specific fields are needed.

## `/admin/prompt-rules`
- Expand `Auth State` selector options.
- Add `Prompt Type Allowlist` control.
- Keep pacing controls and rename consistency (`cooldownSecondsAfterPrompt`).

## `/admin/prompt-analytics` (minimal alignment)
- Show type dimension where available (filter + table column).
- Continue using existing rollups; no full analytics refactor in this plan.

## Observability Minimum
Add/ensure tags on decision + render + click + pass-through:
- `app.surface`
- `app.operation`
- `app.prompt_id`
- `app.prompt_type`
- `app.prompt_category`
- `app.audience_segment`
- `app.rule_id`
- `app.rule_reason`
- `app.outcome` (`shown|blocked|pass_through|cta_click|flow_start|flow_complete`)

Conversion semantics note:
- Treat CTA click as intent signal, not final conversion.
- For prompt behavior and suppression, use:
  - `impression`,
  - `cta_click`,
  - optional `flow_start`,
  - backend-confirmed `flow_complete` for conversion.
- Detailed funnel contract and attribution windows are defined in analytics plans (`plan_118` / `plan_119`).

## Phases
### Phase A — Spec + Enums + Migration Map
- Finalize prompt type taxonomy and audience-state enum list.
- Define mapping for existing prompts/rules to new defaults.
- Define suppression thresholds/defaults.

Acceptance:
- Signed-off enum/spec doc with backward-compat behavior.

### Phase B — Schema + Service Contracts
- Add schema fields:
  - `feed_prompts.prompt_type`
  - `prompt_rules.prompt_type`
  - `prompt_rules.audience_segment`
- Remove rule-level pacing columns from `prompt_rules` (big-bang cutover).
- Add migrations/backfill for existing rows.
- Update type definitions and repo/service mappings.
- Add/validate new global env settings for prompt pacing.

Acceptance:
- Existing prompts/rules continue to function unchanged after migration.

### Phase C — Decision Engine Upgrade
- Replace authenticated hard-block with rule-based audience matching.
- Add prompt-type filtering in candidate selection.
- Implement pass-through suppression checks in eligibility.
- Persist/update session counters needed for suppression.

Acceptance:
- Anonymous and authenticated scenarios both produce deterministic decisions.

### Phase D — Feed Client Integration
- Remove client-side authenticated short-circuit for prompt decision.
- Keep sequence insertion path unchanged (non-destructive).
- Emit `pass_through` prompt events when prompt is viewed then bypassed.

Acceptance:
- Authenticated eligible users can receive prompts without sequence regressions.

### Phase E — Admin UI
- Prompt editor: add `Prompt Type`.
- Rule editor: add `Audience Segment` + `Prompt Type` only.
- Remove pacing inputs from rule editor and list tables.
- Update labels/help text to clarify audience targeting + global pacing model.

Acceptance:
- Admin can configure:
  - anonymous register prompt rules,
  - authenticated non-subscriber fund-drive rules.

### Phase F — QA Matrix + Rollout
- Test matrix:
  - anonymous session,
  - authenticated subscriber,
  - authenticated non-subscriber,
  - repeated pass-through suppression behavior,
  - feed switching/snapshot restore with prompts present.
- Rollout with feature flag:
  - `PROMPT_AUDIENCE_TARGETING_V1=1`.

Acceptance:
- No prompt sequence regressions.
- Correct audience-targeted prompt delivery verified in all scenarios.

## Test Cases (Must Pass)
1. Anonymous + register rule eligible -> prompt inserted.
2. Authenticated non-subscriber + fund-drive rule eligible -> prompt inserted.
3. Authenticated subscriber + non-subscriber rule -> blocked with rule reason.
4. Repeated pass-through on same prompt suppresses that prompt in-session.
5. Prompt CTA click marks prompt converted and suppresses re-show of that prompt in-session.
6. Switching feeds and returning preserves stable sequence behavior.

## Risks
- Rule complexity can create hard-to-debug selection outcomes.
- Segment source of truth (subscription state) may be incomplete at first.
- Pass-through suppression tuning can over-suppress or under-suppress.

Mitigations:
- deterministic decision debug payload for admins,
- explicit `reason_code` coverage,
- conservative defaults with rapid tuning via rules.

## Rollout Plan
1. Dark-launch schema + decision changes behind flag.
2. Enable for internal admin accounts first.
3. Enable for a small % of authenticated sessions.
4. Promote to default after stability window.
