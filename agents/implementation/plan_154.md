# Plan 154: Unified Journey Subject Timeline

Status: Draft

## Context
- Plan 153 introduced `journey_subject_id` and subject-aware lookups.
- Current storage is still split across:
  - `feed_message_journey_instances` (identity-based rows with subject field)
  - `feed_user_message_journey_progress`
  - `feed_anon_message_journey_progress`
- User and anon tracks can still diverge in cooldown/re-entry timing.

## Goal
Create a single canonical journey timeline keyed by `journey_subject_id` so journey lifecycle behavior is consistent regardless of auth state.

## Non-Goals
- Solving cross-device identity certainty beyond current auth merge model.
- Removing all legacy tables immediately in first deploy.
- Changing product-level journey policy semantics.

## Design Summary

### Canonical subject model
- Subject key remains string:
  - `user:<id>`
  - `anon:<key>`
- Add subject-link mapping table for merges:
  - `feed_journey_subject_links`
  - links anon subjects to canonical user subject once auth merge occurs.
- Resolver API:
  - input `{ userId?, anonKey? }`
  - output canonical `journey_subject_id`
  - rules:
    - if authenticated: `user:<id>`
    - if anonymous and link exists: mapped canonical subject
    - else: `anon:<key>`

### Canonical run/progress storage
- Add canonical progress table:
  - `feed_message_journey_progress`
  - keyed by `journey_instance_id` + `step_id` (unique)
  - includes `journey_subject_id`
- Keep `feed_message_journey_instances`, but enforce subject-first behavior:
  - one active run per `journey_id + journey_subject_id`
- During migration:
  - dual-write canonical + legacy
  - read-prefer canonical with legacy fallback

## Phases

## Phase A — Schema Foundations
- Add `feed_journey_subject_links`:
  - `id`, `source_subject_id`, `canonical_subject_id`, `link_reason`, timestamps
  - unique index on `source_subject_id`
  - indexes on `canonical_subject_id`, `updated_at`
- Add canonical progress table `feed_message_journey_progress`:
  - fields matching current normalized progress model
  - unique `(journey_instance_id, step_id)`
  - indexes:
    - `(journey_id, journey_subject_id, state, updated_at, id)`
    - `(journey_subject_id, journey_id, state, updated_at, id)`
    - `(session_id, updated_at, id)`
- Acceptance:
  - schema migration succeeds on existing dev db without data loss.

## Phase B — Subject Resolver + Link Writes
- Implement resolver service:
  - `resolveJourneySubject({ userId, anonKey })`
  - `linkAnonToUserSubject({ anonKey, userId, reason })`
- On auth merge:
  - write link `anon:<key> -> user:<id>`
  - idempotent updates.
- Trace tags:
  - `app.journey_subject_id_resolved`
  - `app.journey_subject_resolution_source` (`auth`, `anon`, `linked_anon`)
- Acceptance:
  - repeated auth cycles resolve to stable canonical subject when link exists.

## Phase C — Canonical Progress Dual-Write
- Route step signal writes to new canonical progress table.
- Continue writing legacy user/anon progress tables temporarily.
- Add consistency diagnostics:
  - counters for canonical-write success/failure
  - optional debug compare mode in dev.
- Acceptance:
  - canonical table contains complete signal stream for active smoke journeys.

## Phase D — Read Cutover (Subject-First)
- Decision/progression reads:
  - instances by canonical subject
  - progress from canonical progress table
  - fallback to legacy only when canonical rows missing (temporary).
- Re-entry/cooldown logic evaluates canonical subject timeline only.
- Acceptance:
  - cooldown/re-entry behavior is identical for logged-in/logged-out paths once linked.

## Phase E — Dev Tools + Inspector Unification
- Journey inspector:
  - canonical subject primary lens
  - display link resolution chain (if any)
  - show canonical progress table rows.
- Dev tools:
  - cooldown/reset by canonical subject only
  - optional “show linked sources” helper.
- Acceptance:
  - one-click cooldown/reset affects single canonical run timeline.

## Phase F — Legacy Decommission
- Remove legacy read dependencies from decision/progression paths.
- Stop legacy dual-writes.
- Keep legacy tables for audit for one phase, then optional archive/drop plan.
- Acceptance:
  - no runtime references to legacy split progress tables in journey engine.

## Smoke Matrix
1. Anonymous start → login complete → continue journey with same canonical subject.
2. Cooldown by user subject unlocks same journey behavior logged-in and logged-out.
3. Repeated logout/login does not create duplicate logical timelines.
4. Inspector shows one canonical active run per journey+subject.
5. Legacy fallback path triggers only when canonical rows absent (during transition).

## Risks
1. Migration drift between canonical and legacy during dual-write.
  - Mitigation: diagnostics counters + targeted compare script.
2. Incorrect link resolution producing wrong canonical subject.
  - Mitigation: strict idempotent link rules and conflict guards.
3. Query performance regressions.
  - Mitigation: add explicit compound indexes and verify with explain plans.

## Open Decisions
1. Should link resolution be one-hop only (`anon -> user`) or support chain compression?
  - Recommend: one-hop now, compress opportunistically.
2. Keep instances table as-is or add dedicated canonical instances table?
  - Recommend: keep current instances table and enforce subject semantics.
3. Legacy retention window before drop/archive.
  - Recommend: keep until one full milestone after cutover.

## Definition of Done
- Journey runtime behavior is driven by one canonical subject timeline.
- Cooldown/re-entry no longer requires dual anon/user updates.
- Inspector/dev-tools operate on canonical subject as default.
- Legacy split storage is no longer required on hot path.
