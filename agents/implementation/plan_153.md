# Plan 153: Journey Subject Normalization + Sliding Anon Expiry

Status: Draft

## Context
- Journey logic currently spans:
  - `feed_message_journey_instances`
  - `feed_user_message_journey_progress`
  - `feed_anon_message_journey_progress`
- Anonymous and authenticated identities can churn across login/logout boundaries.
- Merge behavior works, but repeated auth cycles can still create avoidable complexity.
- Current anon cookie TTL is fixed; no sliding refresh.

## Goals
1. Introduce a normalized journey identity abstraction (`journey_subject_id`) for continuity.
2. Reduce anon/user churn without losing audit history.
3. Add sliding anon cookie expiry to reduce unnecessary anon key turnover.
4. Preserve current product behavior while improving internal consistency.

## Non-Goals
- Immediate hard migration to one unified progress table.
- Removing identity_type from existing journey records.
- Rewriting decision engine from scratch.

## Design Direction

### Identity model
- Keep canonical identity types (`user`, `anon`) in DB.
- Introduce normalized subject key at service level:
  - `journey_subject_id = user:<user_id>` when authenticated
  - `journey_subject_id = anon:<anon_key>` when anonymous
- On auth merge, current anon subject is linked to user subject and user subject becomes canonical for new writes.

### Storage strategy
- Phase-in subject fields (additive), not destructive:
  - add nullable `journey_subject_id` to:
    - `feed_message_journey_instances`
    - `feed_user_message_journey_progress`
    - `feed_anon_message_journey_progress`
- Backfill from existing identity columns.
- Keep existing identity columns for compatibility/audit.

### Sliding anon expiry
- Refresh anon cookie TTL on anonymous decision requests (sliding window).
- Keep same cookie name and TTL value, but update expiration on activity.

---

## Phase A — Subject Key Contract + Utility Layer
- Define shared helpers:
  - `toJourneySubjectId({ userId, anonKey })`
  - parse/validate helpers
- Add tracing fields:
  - `app.journey_subject_id`
  - `app.journey_subject_type` (`user|anon`)
- Acceptance:
  - Decision traces include subject tags for anon and auth sessions.

## Phase B — Additive Schema + Backfill
- Add nullable `journey_subject_id` columns to journey instance/progress tables.
- Backfill:
  - user rows -> `user:<id>`
  - anon rows -> `anon:<key>`
- Add indexes:
  - `(journey_id, journey_subject_id, state, updated_at)`
  - progress lookup by `(journey_instance_id, journey_subject_id)` where useful.
- Acceptance:
  - No runtime regressions; backfill covers existing rows.

## Phase C — Service Write Path Migration
- Decision + progression + merge paths write `journey_subject_id`.
- Read path prefers subject-aware lookup, with fallback to legacy identity columns.
- Ensure one active run per `journey_id + journey_subject_id` in service logic.
- Acceptance:
  - Logout/login cycles do not create avoidable run churn for unchanged state.

## Phase D — Sliding Anon Cookie Expiry
- Update `/api/feed/message-decision` anon cookie behavior:
  - refresh cookie maxAge/expiry when anonymous and cookie present.
  - keep secure/samesite/httpOnly semantics unchanged.
- Optional config:
  - `ANON_SESSION_SLIDING=1` (default on in dev, explicit in prod).
- Acceptance:
  - Active anon browsing extends cookie expiry without rotating key.

## Phase E — Inspector + Dev Tool Alignment
- Journey inspector:
  - display `journey_subject_id`
  - filter by subject id
- Dev tools:
  - reset by subject (future-safe for anon/auth continuity)
- Acceptance:
  - Admin can debug by subject directly, not just by split identity fields.

## Phase F — Optional Unification Decision
- Evaluate if user/anon progress tables should be unified after subject migration stabilizes.
- Decision gate:
  - keep split tables if operationally clear + performant
  - unify only if there is clear maintenance benefit
- Acceptance:
  - documented go/no-go with migration cost estimate.

---

## Smoke Matrix
1. Fresh anon session -> step shown -> auth complete -> merge to user subject.
2. Logout/login without new anon activity -> no duplicate churn.
3. Cooldown re-entry -> new run under same user subject.
4. Anonymous browsing over time with sliding expiry -> cookie retained/extended.
5. Inspector shows consistent subject across runs/progress.

## Risks
1. Mixed legacy + subject reads during migration.
  - Mitigation: dual-read with explicit precedence and temporary diagnostics tags.
2. Subject key format drift.
  - Mitigation: strict helper-only construction; no ad-hoc string concat.
3. Cookie policy regressions.
  - Mitigation: preserve secure/httpOnly/sameSite defaults and add focused smoke checks.

## Open Decisions
1. Subject key storage format:
  - string `user:8` / `anon:<uuid>` (recommended now) vs separate typed columns.
2. Sliding expiry toggle:
  - always-on vs feature flag.
3. Future table unification:
  - defer until subject migration is stable (recommended).

## Definition of Done
- Journey lifecycle can be reasoned about per normalized subject.
- anon/auth churn is reduced in normal usage.
- Sliding anon expiry decreases unnecessary anon-key rotation.
- Existing flows remain backward compatible during rollout.
