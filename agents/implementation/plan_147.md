# Plan 147: Multi-Surface Targeting for Messages and Journeys

Status: Complete

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - Messages/Journeys currently target a single surface, which is not enough for group/channel rollout.
  - We need explicit targeting controls for `Global Feed`, `Groups`, and `Channels`.
  - Targeting behavior must be unambiguous and safe (no implicit “all groups/channels” due to empty selection).
- In scope:
  - Add multi-surface targeting model for Messages and Journeys.
  - Add per-surface targeting mode: `all` vs `selected`.
  - Add group/channel target selection UI (multi-select).
  - Apply targeting filter in decision engine before eligibility/progression checks.
  - Keep suppression/progress scope global across surfaces.
- Out of scope:
  - Group/channel admin delegated authoring.
  - Per-surface suppression/progress semantics.
  - Migration tooling for production compatibility (DEV-only environment).
- Constraints:
  - Existing global feed behavior must remain stable.
  - Decision latency should remain low with indexed target lookups.

## Locked Decisions
- Surfaces are explicit and multi-select:
  - `global_feed`
  - `group_feed`
  - `channel_feed`
- For `group_feed` and `channel_feed`, targeting mode is explicit:
  - `all`
  - `selected`
- `selected` requires at least one target.
- Suppression scope remains global (not per-surface/per-target).
- Journey progress remains global to `user + journey`.

## Phase Status
- A: Complete
- B: Complete
- C: Complete
- D: Complete
- E: Complete
- F: Complete

## Phase A — Data Model + Repository Layer
- Goal:
  - Add storage model for multi-surface + selected targets for both messages and journeys.
- Steps:
  - [x] Add `feed_message_surfaces`:
    - `message_id`, `surface`, `targeting_mode`
  - [x] Add `feed_message_targets`:
    - `message_id`, `surface`, `target_id`
  - [x] Add `feed_message_journey_surfaces`:
    - `journey_id`, `surface`, `targeting_mode`
  - [x] Add `feed_message_journey_targets`:
    - `journey_id`, `surface`, `target_id`
  - [x] Add indexes/uniques for fast matching and dedupe.
  - [x] Implement repo read/write mapping for the new structures.
- Test gate:
  - Create/update/read message/journey with:
    - global only
    - groups all
    - channels selected
    - mixed surfaces
- Acceptance:
  - Canonical surface/target state persists and round-trips.

## Phase B — Admin UI Contracts (Message/Journey Editors)
- Goal:
  - Provide safe, explicit surface targeting controls in admin forms.
- Steps:
  - [ ] Add surface checkboxes:
    - `Global Feed`, `Groups`, `Channels`
  - [ ] For checked `Groups`/`Channels`, add mode selector:
    - `All`
    - `Selected only`
  - [ ] Add modal picker for groups/channels with search + multi-select.
  - [ ] Show selected count badges (`Groups: 3 selected`).
  - [ ] Validation:
    - at least one surface checked
    - `selected only` requires selections
- Test gate:
  - Cannot save invalid combos.
  - Save succeeds for all valid combinations.
- Acceptance:
  - UI makes targeting intent explicit; no accidental broad blasts.

## Phase C — Decision Engine Target Matching
- Goal:
  - Enforce surface/target matching before candidate eligibility/progression checks.
- Steps:
  - [x] Add context input to decision calls:
    - `surface_context` (`global_feed|group_feed|channel_feed`)
    - optional `group_id` / `channel_id`
  - [x] Message candidate prefilter:
    - surface present
    - if mode `all`, pass
    - if mode `selected`, require target match
  - [x] Journey candidate prefilter with same rules.
  - [x] Keep existing ruleset/progression checks after targeting prefilter.
- Test gate:
  - Group-targeted message does not appear in unrelated groups/channels/global.
  - Channel-targeted journey appears only in targeted channels.
- Acceptance:
  - Delivery respects surface + target selection deterministically.

## Phase D — Observability + Debugging
- Goal:
  - Make targeting decisions auditable in Jaeger/Pino/debug bundle.
- Steps:
  - [x] Emit tags/log fields:
    - `app.surface_context`
    - `app.targeting_mode`
    - `app.target_type`
    - `app.target_id`
    - `app.target_match`
  - [x] Emit reject reason for targeting miss (`target_miss`).
  - [x] Add/extend Jaeger preset(s) for target match diagnostics.
- Test gate:
  - Targeted/non-targeted decisions are distinguishable from traces/logs alone.
- Acceptance:
  - Debugging can explain “why not shown” for surface targeting cases.

## Phase E — Surface-Safe Defaults + Backfill
- Goal:
  - Preserve current global behavior while migrating existing data.
- Steps:
  - [x] Backfill existing messages/journeys to `global_feed + all`.
  - [x] Keep old single-surface fields as read-only fallback during transition.
  - [x] Ensure runtime prioritizes new tables; fallback only when new rows missing.
  - [x] Add cleanup TODO for legacy fields post-validation.
- Test gate:
  - Existing content still appears in global feed after deploy.
- Acceptance:
  - No regression for current global-only usage.

## Phase F — Smoke Matrix + Docs
- Goal:
  - Validate complete behavior and document operator workflow.
- Steps:
  - [ ] Smoke matrix:
    - message: global only / groups all / groups selected / channels selected / mixed
    - journey: same matrix
  - [ ] Verify suppression/progress global behavior across surfaces:
    - completion in one surface applies to others
  - [ ] Document authoring guidance in agents docs:
    - when to use `all` vs `selected`
    - how to troubleshoot targeting misses
- Test gate:
  - Matrix passes for both authenticated and anonymous where applicable.
- Acceptance:
  - Feature is operationally usable and debuggable.

### Smoke Matrix (Manual)

Use a single test user/session with `npm run db:clear:suppression` before each case.

| Case | Artifact | Targeting Setup | Test Surface Context | Expected |
|---|---|---|---|---|
| M1 | Message | `global_feed` = `all` | Global feed (`surface=global_feed`) | Inserts |
| M2 | Message | `group_feed` = `all` | Any group feed (`surface=group_feed`, `group_id=<any>`) | Inserts |
| M3 | Message | `group_feed` = `selected` with `group_id=A` | Group A feed | Inserts |
| M4 | Message | `group_feed` = `selected` with `group_id=A` | Group B feed | No candidate (`target_miss`) |
| M5 | Message | `channel_feed` = `selected` with `channel_id=X` | Channel X feed | Inserts |
| M6 | Message | `channel_feed` = `selected` with `channel_id=X` | Channel Y feed | No candidate (`target_miss`) |
| M7 | Message | Mixed: `global_feed=all` + `group_feed=selected(A)` | Global + Group A + Group B | Inserts on Global + Group A only |
| J1 | Journey | `global_feed` = `all` | Global feed | Journey step eligible/inserted |
| J2 | Journey | `group_feed` = `all` | Any group feed | Journey step eligible/inserted |
| J3 | Journey | `group_feed` = `selected` with `group_id=A` | Group A then Group B | Eligible in A, `target_miss` in B |
| J4 | Journey | `channel_feed` = `selected` with `channel_id=X` | Channel X then Channel Y | Eligible in X, `target_miss` in Y |
| J5 | Journey | Mixed: `group_feed=selected(A)` + `channel_feed=selected(X)` | Group A + Channel X + Channel Y | Eligible in A + X only |
| G1 | Suppression Scope | Complete/suppress message in Group A | Visit Global/Group B/Channel X | Suppressed everywhere (global scope) |
| G2 | Journey Progress Scope | Progress journey step in Channel X | Visit Group A / Global | Next step preserved across surfaces |
| O1 | Observability | Any target miss case | Jaeger `POST /api/feed/message-decision` | `app.target_match=false`, `app.target_reject_reason=target_miss` |
| O2 | Observability | Any target match case | Jaeger `POST /api/feed/message-decision` | `app.target_match=true`, tags include context/mode/type/id |

### Suggested Execution Order
1. Run all message cases (`M1`..`M7`) with all journeys paused.
2. Run all journey cases (`J1`..`J5`) with standalone messages paused.
3. Run global-scope behavior checks (`G1`, `G2`).
4. Validate observability tags (`O1`, `O2`) via Jaeger presets.

### Jaeger Checks (Quick)
- Decision volume:
  - `npm run jaeger:query -- preset message_decide --lookback 30m --summary`
- Targeting misses:
  - `npm run jaeger:query -- preset message_targeting --lookback 30m --summary`

## Change Log
- 2026-03-28:
  - Added new targeting tables and indexes:
    - `feed_message_surfaces`
    - `feed_message_targets`
    - `feed_message_journey_surfaces`
    - `feed_message_journey_targets`
  - Added DB backfill inserts from legacy `applies_to_surface` into new surfaces tables.
  - Added message/journey repo helpers to persist and load surface targeting.
  - Extended message/journey DTO contracts with `surfaceTargeting`.
  - Preserved existing `applies_to_surface` behavior as fallback for compatibility.
  - Phase B completed:
    - Message and Journey admin forms now support multi-surface targeting inputs.
    - Added per-surface targeting mode (`all` / `selected`) and selected target lists.
    - Added payload parsing from admin forms to `surfaceTargeting`.
    - Added validation: `selected` mode for groups/channels requires non-empty target set.
  - Phase C completed:
    - Decision input now accepts multi-surface context:
      - `surface` = `global_feed|group_feed|channel_feed`
      - optional `group_id` / `channel_id` (plus camelCase aliases).
    - Message candidate selection now prefilters by `surfaceTargeting` before suppression/ruleset/journey gating.
    - Journey gating now prefilters by journey `surfaceTargeting` (with legacy `applies_to_surface` fallback).
    - Decision session schema now supports all three surfaces in `message_decision_sessions.surface`.
  - Phase D completed:
    - Added targeting diagnostics into message decision debug selection payload:
      - `surfaceContext`, `targetingMode`, `targetType`, `targetId`, `targetMatch`, `targetRejectedCount`
    - Added structured `target_miss` drop reason enrichment for debugging.
    - Added decision observability tags/log fields:
      - `app.surface_context`, `app.targeting_mode`, `app.target_type`, `app.target_id`, `app.target_match`
      - `app.target_rejected_count`, `app.target_reject_reason`
    - Added Jaeger preset `message_targeting` to query target-miss decisions quickly.
  - Phase E completed:
    - Confirmed DB startup migration backfills legacy rows into canonical targeting tables:
      - `feed_message_surfaces`
      - `feed_message_journey_surfaces`
    - Confirmed runtime prioritizes canonical `surfaceTargeting`; legacy `applies_to_surface` is used only as fallback when canonical rows are missing.
    - Added verification utility:
      - `npm run db:verify:surface-targeting`
      - optional auto-fix mode: `npm run db:verify:surface-targeting -- --fix`
      - `--fix` prunes orphaned targeting rows and backfills missing canonical surface rows.
    - Added explicit legacy cleanup TODO:
      - Remove legacy `applies_to_surface` fallback once verifier reports zero missing rows consistently.

## Validation
- Environment:
  - DEV local/staging
- Commands run:
  - `npm run jaeger:query -- preset message_decide --lookback 30m --summary`
  - `npm run jaeger:query -- preset message_targeting --lookback 30m --summary`
- Evidence files:
  - debug bundle artifacts under `tests/runs/api-curl/`
- Known gaps:
  - None.
  - Phase F completed:
    - Message matrix `M1..M7` passed.
    - Journey matrix `J1..J5` passed.
    - Cross-surface checks `G1`, `G2` passed.
    - Jaeger presets confirmed decision + targeting observability in lookback window.

## Open Risks / Deferred
- Risk:
  - Query complexity/regressions if target matching is not indexed correctly.
- Risk:
  - UI complexity for large group/channel counts without search/pagination.
- Deferred item:
  - Per-surface suppression/progress scope (future, if needed).

## Resume Here
- Next action:
  - Plan complete.
- Blocking question (if any):
  - None.
