# Plan 129: Multi-Type Prompt Programs (Audience Targeting + Prompt-Pool Delivery)

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
- Prompt type taxonomy and prompt-pool filtering.
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
- Decision ordering (updated for prompt-pool):
  1. filter prompts by `surface + audience_segment + prompt_type + schedule + enabled`,
  2. sort by `priority` ascending,
  3. apply suppression/cooldown/global pacing checks,
  4. tie-break within same priority (`round_robin` for v1; `weighted_random` optional),
  5. if no candidate remains, return `reason_code=no_candidate`.
- Audience-state matching rule:
  - exact match only (no hierarchical fallback),
  - `authenticated_subscriber` does not match `authenticated`,
  - cohort overlap must be configured explicitly via separate prompts (clone workflow).

### 3) Pass-through semantics + suppression
- Pass-through trigger:
  - prompt became active,
  - no CTA click,
  - user advanced away (forward or backward slide change),
  - prompt was visible for at least `800ms` (anti-accidental swipe guard).
- Analytics policy:
  - record `pass_through` as a prompt outcome for reporting and funnel analysis,
  - do not suppress on `pass_through`.
- Conversion handling:
  - CTA click is tracked but does not suppress by itself,
  - `flow_complete` / `auth_complete` marks prompt as converted in-session,
  - converted prompt is suppressed for remainder of session,
  - optional future impression caps remain separate from conversion suppression.

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
  - `PROMPT_PASS_THROUGH_MIN_VISIBLE_MS`
- Decisioning applies these global gates after rule/candidate selection and before insertion.

### 7) Rule-to-prompt matching simplification
- Delivery uses prompt-level matching (`prompt_type`, `surface`, `audience_segment`) directly.
- `category` remains prompt metadata for reporting/editorial grouping only.
- No category-based gating in decisioning for v1.

### 8) Audience UI model
- Use single-select `audience_segment` (no checkbox combinations).
- Audience matching remains exact-match only.
- If same creative is needed across cohorts, use clone workflow with separate prompt rows.

### 9) Suppression scope
- First-pass suppression key: `prompt_id` in-session.
- Suppress only on `flow_complete` / `auth_complete`.
- Do not suppress on `pass_through`.
- Do not suppress on CTA click alone.
- Optional future escalation: suppress by `(audience_segment, prompt_type)` only if prompt-level suppression is insufficient.

### 10) Prompt-pool pivot (C.2)
- Pivot decision engine from rule-pool selection to prompt-pool selection.
- `prompt_rules` are decommissioned as part of C.2 (no long-lived fallback layer).
- Cutover order:
  1. prompt-pool selection path as primary,
  2. complete parity verification in dev,
  3. remove legacy rule selection path + rule admin endpoints/UI in same C.2 stream.

## Prompt Program Model (v1 for multi-type)
Use `feed_prompts` as the primary delivery unit with explicit program dimensions:

1. Prompt Type
- Examples:
  - `register_login`
  - `fund_drive`
  - `subscription_upgrade`
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
- Prompt pool chooses *which* prompt applies; global pacing controls *when* insertion is allowed.

## Data/Contract Changes
## Prompt Content
- Add/normalize `prompt_type` on prompts (default mapped for existing prompts).
- Add/normalize prompt-level delivery fields:
  - `applies_to_surface`
  - `audience_segment`
  - `priority`
  - `tie_break_strategy` (default `round_robin`)
- Keep `category` as business label; use `prompt_type` for delivery mechanics.

## Rules
- `prompt_rules` are deprecated and removed in C.2.
- No new feature development on rule-based selection.
- Any temporary migration shim is short-lived and removed before entering Phase D.

## Decision Session State
- Keep session counters and `last_prompt_shown_at`.
- Add lightweight pass-through counters:
  - per `prompt_id` impressions shown in session,
  - per `prompt_id` pass-through count,
  - optional per `prompt_type` suppression counter.

## API Contract
- Decision request includes resolved viewer context from server session.
- Decision response includes selected prompt metadata needed by feed insertion.
- Add debug metadata indicating selected engine path:
  - `selection_engine=prompt_pool|rule_fallback`
  - `candidate_count`
  - `selection_cursor` (when available)

## Audience Resolution
Create server-side resolver for viewer state:
- `anonymous` when no user session.
- `authenticated_non_subscriber` / `authenticated_subscriber` based on subscription status source of truth.

No client trust for audience-state claims.

## Suppression Policy (first pass)
Treat scroll-past as pass-through signal (no dismiss action required).

Default suppression behavior:
- `pass_through` is analytics-only and does not suppress that prompt,
- CTA click is analytics-only and does not suppress that prompt,
- suppress exact `prompt_id` only after `flow_complete` / `auth_complete`,
- allow other eligible prompt types to continue,
- suppression resets per session.

Initial recommended defaults:
- no pass-through-based suppression,
- suppression duration for completed prompts is session-scoped.
- optional future extension:
  - prompt-level `max_impressions_per_session`
  - prompt-level `max_impressions_per_user`

## Feed Behavior Requirements
- Prompt slides remain first-class sequence items.
- No prompt removal mutation during gesture flow.
- Prompt insertion follows existing key-based sequence path.
- Authenticated users can receive prompts when eligible by prompt targeting (remove hard-block behavior).

## Admin UX Requirements
## `/admin/prompts`
- Add `Prompt Type` selector.
- Add prompt-level targeting controls:
  - `Audience Segment`
  - `Surface`
  - `Priority`
  - `Tie-break strategy`
- Keep category selector.
- Keep creative editor unchanged unless type-specific fields are needed.

## `/admin/prompt-rules`
- Removed in C.2.
- No runtime routes, editor, or compatibility UI remain after cleanup.

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
- `app.decision_reason`
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
- Phase A output: `agents/implementation/notes_plan_129_phase_a.md`

Acceptance:
- Signed-off enum/spec doc with big-bang migration map.

### Phase B — Schema + Service Contracts
- Add schema fields:
  - `feed_prompts.prompt_type`
  - `prompt_rules.prompt_type` (compat)
  - `prompt_rules.audience_segment` (compat)
- Add/normalize prompt-level targeting fields on `feed_prompts`:
  - `applies_to_surface`
  - `audience_segment`
  - `priority`
  - `tie_break_strategy`
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

Status note:
- Partially complete; selection architecture is superseded by Phase C.2.

Acceptance:
- Anonymous and authenticated scenarios both produce deterministic decisions.

### Phase C.2 — Prompt-Pool Decision Engine Pivot
- Implement prompt-pool candidate query:
  - `enabled + active status + schedule + surface + audience + prompt_type`.
- Move selection ordering to prompt-level:
  - `priority` -> tie-break (`round_robin` primary).
- Add persistent per-session cursor for stable round-robin across eligible prompts.
- Emit observability/debug fields:
  - `selection_engine`, `candidate_count`, `selected_prompt_id`, `selected_priority`.
- Add admin-safe debug output to inspect why a prompt was selected/blocked.
- Remove prompt-rules runtime dependencies:
  - delete rule-based decision path,
  - remove `/admin/prompt-rules` page/routes,
  - remove rule CRUD API usage in prompt delivery path.

Acceptance:
- Rotation works across multiple prompts of the same `prompt_type` without requiring multiple rules.
- Existing behavior remains stable with rule system removed.

### Phase D — Feed Client Integration
- Remove client-side authenticated short-circuit for prompt decision.
- Keep prompt insertion non-destructive and sequence-stable.
- Emit `pass_through` prompt events when prompt is viewed then bypassed for analytics only.
- Consume decision payload independent of legacy rule ids.

Acceptance:
- Authenticated eligible users can receive prompts without sequence regressions.

### Phase E — Admin UI
- Prompt editor: add `Prompt Type`.
- Prompt editor: expose prompt-level targeting (`surface`, `audience_segment`, `priority`, `tie_break_strategy`).
- Remove rule editor from admin nav/routes/UI.
- Update labels/help text to clarify prompt-pool targeting + global pacing model.

Acceptance:
- Admin can configure:
  - anonymous register prompts,
  - authenticated non-subscriber fund-drive prompts,
  - multiple prompts in same cohort/type rotating without extra rules.

### Phase F — QA Matrix + Rollout
- Test matrix:
  - anonymous session,
  - authenticated subscriber,
  - authenticated non-subscriber,
  - repeated pass-through analytics behavior,
  - CTA click without completion does not suppress,
  - CTA completion suppresses the converting prompt in-session,
  - feed switching/snapshot restore with prompts present,
  - prompt-pool round-robin parity when multiple prompts match same cohort/type.
- Rollout with feature flag:
  - `PROMPT_AUDIENCE_TARGETING_V1=1`.

Acceptance:
- No prompt sequence regressions.
- Correct audience-targeted prompt delivery verified in all scenarios.
- No rule-engine code path remains active.

## Test Cases (Must Pass)
1. Anonymous + register prompt eligible -> prompt inserted.
2. Authenticated non-subscriber + fund-drive prompt eligible -> prompt inserted.
3. Authenticated subscriber + non-subscriber-targeted prompt -> blocked with rule reason.
4. Repeated pass-through on same prompt is recorded analytically and does not suppress that prompt by itself.
5. Prompt CTA click is recorded analytically and does not suppress that prompt by itself.
6. Prompt CTA completion suppresses re-show of that prompt in-session.
7. Switching feeds and returning preserves stable sequence behavior.

## Risks
- Prompt-pool query/selection complexity can create hard-to-debug selection outcomes.
- Segment source of truth (subscription state) may be incomplete at first.
- Completion detection may lag or fail, causing prompts to continue showing longer than intended.

Mitigations:
- deterministic decision debug payload for admins,
- explicit `reason_code` coverage,
- conservative defaults with rapid tuning via prompt targeting + global pacing,
- keep suppression tied only to durable completion events.

## Rollout Plan
1. Dark-launch schema + decision changes behind flag.
2. Enable for internal admin accounts first.
3. Enable for a small % of authenticated sessions.
4. Promote to default after stability window.
