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
- Initial enum:
  - `anonymous`
  - `authenticated`
  - `authenticated_non_subscriber`
  - `authenticated_subscriber`

3. Delivery Controls
- Existing pacing controls remain:
  - min slides viewed
  - min watch seconds
  - max prompts per session
  - min slides between prompts
  - cooldown seconds between prompts
- Add repeated pass-through suppression per prompt/program in-session.

## Data/Contract Changes
## Prompt Content
- Add/normalize `prompt_type` on prompts (default mapped for existing prompts).
- Keep `category` as business label; use `prompt_type` for delivery mechanics.

## Rules
- Expand `auth_state` enum in rules to include authenticated segments.
- Add optional `prompt_type_allowlist` (parallel to category allowlist).

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
- if same `prompt_id` has `N` pass-through events in-session without click/auth_start, temporarily suppress that `prompt_id`,
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
- `app.viewer_state`
- `app.rule_id`
- `app.rule_reason`
- `app.outcome` (`shown|blocked|clicked|pass_through|auth_start|auth_complete`)

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
  - `prompt_rules.prompt_type_allowlist_json` (or equivalent)
  - expanded `prompt_rules.auth_state` enum
- Add migrations/backfill for existing rows.
- Update type definitions and repo/service mappings.

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
- Rule editor: add expanded `Auth State` + `Prompt Type Allowlist`.
- Update labels/help text to clarify audience targeting.

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
5. Prompt clicks clear suppression for that prompt (or mark as converted).
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
