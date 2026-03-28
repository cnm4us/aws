# Plan 147: Multi-Surface Targeting for Messages and Journeys

Status: Active

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
- A: Pending
- B: Pending
- C: Pending
- D: Pending
- E: Pending
- F: Pending

## Phase A — Data Model + Repository Layer
- Goal:
  - Add storage model for multi-surface + selected targets for both messages and journeys.
- Steps:
  - [ ] Add `feed_message_surfaces`:
    - `message_id`, `surface`, `targeting_mode`
  - [ ] Add `feed_message_targets`:
    - `message_id`, `surface`, `target_id`
  - [ ] Add `feed_message_journey_surfaces`:
    - `journey_id`, `surface`, `targeting_mode`
  - [ ] Add `feed_message_journey_targets`:
    - `journey_id`, `surface`, `target_id`
  - [ ] Add indexes/uniques for fast matching and dedupe.
  - [ ] Implement repo read/write mapping for the new structures.
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
  - [ ] Add context input to decision calls:
    - `surface_context` (`global_feed|group_feed|channel_feed`)
    - optional `group_id` / `channel_id`
  - [ ] Message candidate prefilter:
    - surface present
    - if mode `all`, pass
    - if mode `selected`, require target match
  - [ ] Journey candidate prefilter with same rules.
  - [ ] Keep existing ruleset/progression checks after targeting prefilter.
- Test gate:
  - Group-targeted message does not appear in unrelated groups/channels/global.
  - Channel-targeted journey appears only in targeted channels.
- Acceptance:
  - Delivery respects surface + target selection deterministically.

## Phase D — Observability + Debugging
- Goal:
  - Make targeting decisions auditable in Jaeger/Pino/debug bundle.
- Steps:
  - [ ] Emit tags/log fields:
    - `app.surface_context`
    - `app.targeting_mode`
    - `app.target_type`
    - `app.target_id`
    - `app.target_match`
  - [ ] Emit reject reason for targeting miss (`target_miss`).
  - [ ] Add/extend Jaeger preset(s) for target match diagnostics.
- Test gate:
  - Targeted/non-targeted decisions are distinguishable from traces/logs alone.
- Acceptance:
  - Debugging can explain “why not shown” for surface targeting cases.

## Phase E — Surface-Safe Defaults + Backfill
- Goal:
  - Preserve current global behavior while migrating existing data.
- Steps:
  - [ ] Backfill existing messages/journeys to `global_feed + all`.
  - [ ] Keep old single-surface fields as read-only fallback during transition.
  - [ ] Ensure runtime prioritizes new tables; fallback only when new rows missing.
  - [ ] Add cleanup TODO for legacy fields post-validation.
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

## Change Log
- (pending)

## Validation
- Environment:
  - DEV local/staging
- Commands run:
  - (pending implementation)
- Evidence files:
  - debug bundle artifacts under `tests/runs/api-curl/`
- Known gaps:
  - None yet.

## Open Risks / Deferred
- Risk:
  - Query complexity/regressions if target matching is not indexed correctly.
- Risk:
  - UI complexity for large group/channel counts without search/pagination.
- Deferred item:
  - Per-surface suppression/progress scope (future, if needed).

## Resume Here
- Next action:
  - Start Phase A with new `*_surfaces` and `*_targets` tables + repo mapping.
- Blocking question (if any):
  - None.
