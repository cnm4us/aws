# Plan 148: Journey Objective Completion and Identity Merge

Status: Superseded by `agents/implementation/plan_151.md` (2026-04-01)

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - Journey progression is currently step-driven, but there is no explicit objective-level completion.
  - If a user completes the journey objective mid-journey (for example registers on step 3 of 4), remaining steps are only indirectly blocked by rules/suppression.
  - Anonymous and authenticated states can diverge, causing re-entry or inconsistent behavior after login/logout.
- In scope:
  - Add journey-level terminal completion model.
  - Add journey goal rules (event-based completion) independent of step order.
  - Merge anonymous journey state into user journey state on auth.
  - Add explicit re-entry policy and timeout controls.
  - Add minimal admin observability for per-user journey state.
- Out of scope:
  - Full branching journey graph editor.
  - A/B/n experimentation framework.
  - Group/channel-admin delegated journey authoring.
- Constraints:
  - Preserve existing step progression policies.
  - Keep decision path efficient and index-backed.
  - Maintain deterministic behavior across anonymous and authenticated transitions.

## Locked Decisions
- Journey terminal state is first-class:
  - `active | completed | abandoned | expired`
- Journey goal completion is journey-level and can end a journey before final step.
- Goal completion and step completion are distinct signals.
- Identity merge is required on auth:
  - anonymous progress can be promoted to authenticated user progress.
- Re-entry is policy-driven (not implicit):
  - default `never_reenter`

## Superseded Note (2026-04-01)
- This plan was superseded by `agents/implementation/plan_151.md` after implementation moved to run-scoped journey lifecycle work.
- Core outcomes originally targeted here were delivered through Plan 151 and related commits.
- Keep this document for historical intent and scope framing only.

## Detailed Delta (Plan 148 -> Delivered State)

### Completed (implemented via Plan 151 and follow-on fixes)
1. Journey instance lifecycle as first-class state
- `feed_message_journey_instances` in use with terminal and active states.
- Journey decisioning now keys off instance/run state rather than inferred step-only state.

2. Goal-rule terminal completion
- Journey completion on goal events (for example `auth.login_complete`) is implemented and terminal for that run.
- Goal completion behavior is idempotent and recorded on instance metadata/state fields.

3. Anonymous -> authenticated merge semantics
- Auth merge promotes active anon run into user identity context.
- Source anon run is closed/abandoned with merge metadata.
- Completed-by-goal run remains terminal after merge.

4. Re-entry policy behavior
- Re-entry controls are operational (`never_reenter`, cooldown-based re-entry where configured).
- Re-entry creates a new run rather than mutating prior completed run.

5. Observability for run lifecycle
- Journey decision traces include run-level tags (including `app.journey_instance_id` and re-entry indicators).
- Delivery context and suppression-bypass reasoning for journey path are traceable.

6. Dev tooling for deterministic testing
- `/admin/dev-tools` now includes targeted journey reset/re-entry actions used for repeatable smoke tests.
- Journey re-entry smoke script exists for Jaeger+manual verification.

### Changed from original Plan 148 approach
1. Coupling cleanup was done in Plan 151 terms
- Plan 148 described objective completion + merge + re-entry goals.
- Plan 151 formalized and delivered the decisive fix: journey delivery bypasses standalone campaign suppression.
- Result: journey re-entry no longer depends on manual suppression clearing.

2. Run-scoped progress hardening became explicit
- Plan 151 introduced/finished run-scoped progression details (`journey_instance_id` usage) as a concrete implementation pivot.
- This is stronger than the earlier “keep existing step tables for now” framing in Plan 148.

### Remaining delta (not fully delivered from original Plan 148 text)
1. Dedicated admin journey inspector page
- Original Plan 148 Phase E called for a simple inspector page to query by user email/anon key and show instances + step progress.
- Not implemented as a dedicated inspector page in this phase set.
- Current coverage relies on:
  - Jaeger tags/trace inspection
  - existing analytics/admin pages
  - `/admin/dev-tools` operational reset/re-entry controls

2. Plan document metadata
- Phase checkboxes in this file were never updated during execution because implementation shifted to Plan 151.
- This superseded note now acts as canonical closure for Plan 148.

## Phase Status (Historical)
- A: Superseded (implemented via Plan 151)
- B: Superseded (implemented via Plan 151)
- C: Superseded (implemented via Plan 151)
- D: Superseded (implemented via Plan 151)
- E: Superseded (partially implemented; dedicated inspector page deferred)
- F: Superseded (implemented via Plan 151 and follow-on cleanup)

## Phase A — Data Model for Journey Instance State
- Goal:
  - Add explicit per-identity journey instance lifecycle state.
- Steps:
  - [ ] Add `feed_message_journey_instances` with fields:
    - `id`
    - `journey_id`
    - `identity_type` (`user` | `anon`)
    - `identity_key` (user id or anon visitor key)
    - `state` (`active|completed|abandoned|expired`)
    - `current_step_id` nullable
    - `completed_reason` nullable
    - `completed_event_key` nullable
    - `first_seen_at`, `last_seen_at`, `completed_at`
    - `metadata_json`
  - [ ] Add unique/indexes for fast lookup by `(journey_id, identity_type, identity_key)`.
  - [ ] Keep existing step progress tables; do not remove yet.
- Test gate:
  - Insert/update/select journey instance by both user and anon identities.
- Acceptance:
  - Runtime can read/write terminal journey state without overloading step-progress rows.

## Phase B — Goal Rules and Terminal Completion Engine
- Goal:
  - Allow journey completion from canonical events regardless of current step.
- Steps:
  - [ ] Add journey config schema for objective completion:
    - `goal_rules` with support for `any_of` (initial scope)
    - initial keys: `auth.register_complete`, `auth.login_complete`, `support.subscribe_complete`, `support.donate_complete`
  - [ ] Implement `evaluateJourneyGoalCompletion(...)` in journey service.
  - [ ] On matching goal event:
    - set instance state to `completed`
    - set completion reason/event/time
    - stop further journey delivery.
  - [ ] Ensure idempotency for repeated completion events.
- Test gate:
  - Trigger objective event at step 1/2/3 and confirm journey ends immediately.
- Acceptance:
  - Mid-journey objective completion becomes deterministic and explicit.

## Phase C — Anonymous to Authenticated Identity Merge
- Goal:
  - Prevent split-brain state between anon and user journey histories.
- Steps:
  - [ ] Add merge function executed on auth success:
    - source: anon identity key (`anon_session_id` / visitor key)
    - destination: authenticated user id
  - [ ] Merge rules:
    - if destination has no instance: copy source instance + progress
    - if both exist: keep furthest terminal state precedence:
      - `completed` > `expired` > `abandoned` > `active`
    - merge step progress to max progressed state per step.
  - [ ] Mark source anon instance as merged/closed in metadata.
- Test gate:
  - Start journey anon, complete auth on step 3, verify authenticated state is completed and anon continuation no longer advances independently.
- Acceptance:
  - Auth transition creates one coherent journey state.

## Phase D — Re-entry, Timeouts, and Repeat Controls
- Goal:
  - Make repeat behavior explicit and predictable.
- Steps:
  - [ ] Add journey-level policy config:
    - `reentry_policy`: `never_reenter` (default) | `reenter_after_days` | `allow_restart`
    - `reentry_cooldown_days` (when applicable)
  - [ ] Add optional expiry controls:
    - `journey_expires_after_days`
    - `step_expires_after_days`
  - [ ] Apply policy checks before journey candidate admission.
- Test gate:
  - Verify completed journey does not re-enter by default.
  - Verify cooldown-based re-entry when configured.
- Acceptance:
  - Journey recurrence behavior is explicit and admin-controlled.

## Phase E — Observability and Admin Debug Inspector
- Goal:
  - Make journey state and decisions transparent for debugging.
- Steps:
  - [ ] Add Jaeger/Pino tags:
    - `app.journey_instance_state`
    - `app.journey_completion_event`
    - `app.journey_completion_reason`
    - `app.journey_reentry_policy`
    - `app.journey_identity_type`
  - [ ] Add simple admin inspector page:
    - query by user email or anon key
    - show journey instances + step progress + terminal state
  - [ ] Add dev-tools button (optional) to clear journey instance state.
- Test gate:
  - One session can explain “why shown/not shown” with tags + inspector.
- Acceptance:
  - Debug flow for journey lifecycle is fast and reliable.

## Phase F — Migration, Rollout, and Cleanup
- Goal:
  - Ship safely with clear transition from legacy behavior.
- Steps:
  - [ ] Dual-read period:
    - prefer instance state when present
    - fallback to existing progress tables when absent
  - [ ] Backfill script to initialize instances from existing journey progress.
  - [ ] Remove legacy inference paths once validated.
  - [ ] Update docs and smoke matrix for:
    - mid-journey completion
    - anon→auth merge
    - re-entry policies.
- Test gate:
  - Existing journeys continue working throughout migration.
- Acceptance:
  - New model is active; legacy fallback can be retired.

## Validation
- Environment:
  - DEV
- Commands run:
  - (pending implementation)
- Evidence files:
  - `debug/console/*`
  - `debug/terminal/*`
  - `tests/runs/api-curl/*`
- Known gaps:
  - Pending implementation.

## Open Risks / Deferred
- Risk:
  - Merge conflicts between anon/user state if auth callback timing races with decision requests.
- Risk:
  - Over-completion if goal keys are too broad.
- Deferred item:
  - Branching and weighted journey graphs.

## Resume Here
- Next action:
  - Start Phase A (journey instance table + repo/service accessors).
- Blocking question (if any):
  - None.
