# Plan 119: Nominal-First Analytics Rollout (Incremental Expansion)

## Goal
Deliver a minimal, reliable first pass of first-party analytics, then expand in controlled layers without reworking core plumbing.

This plan is the execution strategy for gradually implementing scope from:
- `agents/implementation/plan_118.md`
- `agents/analytics/*.md` (event/dimension/report/moderation/credibility docs)

## Strategy
- Build once: ingestion + schema + rollup pipeline.
- Start with the smallest event set that answers core product questions.
- Add domains one at a time (feed -> prompt -> verification -> moderation -> credibility).
- Gate each phase with acceptance checks before expanding.

## Scope Boundaries
### In scope
- Incremental event activation by domain.
- Stable schema versioning and backward-compatible additions.
- Rollup-first reporting.
- Minimal admin visibility per phase.

### Out of scope (until later phases)
- Full creator/group/channel dashboards.
- Advanced anomaly detection automation.
- Enforcement logic based on credibility score (shadow mode first).

## Architecture Contract (Locked Early)
1. One canonical ingest endpoint (`/api/analytics/ingest`).
2. One raw event store (`analytics_events`) with versioned schema.
3. One rollup pipeline (`hourly` + `daily`) for reporting.
4. Optional external sink (PostHog/etc.) remains secondary.

## Phases
### Phase A — Foundation Skeleton
- Finalize v1 event envelope and validator.
- Ensure raw table + minimal rollup table exist.
- Ensure ingest metrics/health counters exist.

Minimum event envelope fields:
- `event_id`, `event_name`, `event_at`, `schema_version`, `session_id`

Acceptance:
- Ingest accepts valid payloads and rejects invalid.
- Rollup job runs on empty/small datasets safely.

### Phase B — Feed Core (Nominal Analytics)
Enable only:
- `feed_session_start`
- `feed_session_end`
- `slide_impression`
- `slide_play_start`
- `slide_complete`

Minimum dimensions:
- `viewer_state`, `surface`, `space_id`, `content_id`, `creator_id`

Reports:
- sessions started
- avg watch seconds/session
- play rate
- completion rate

Acceptance:
- Reports populate consistently from live traffic.
- Basic invariants hold (`complete <= impression`, `play <= impression`).

### Phase C — Prompt Essentials
Enable:
- `prompt_impression`
- `prompt_pass_through`
- `prompt_click`
- `prompt_auth_start`

Reports:
- prompt CTR
- prompt pass-through rate
- prompt auth-start rate

Acceptance:
- Metrics are filterable by `prompt_category` and `surface`.
- No duplication spikes under rapid swipe scenarios.

### Phase D — Verification Essentials
Enable:
- `verification_completed`
- `permission_check` (initially only `join` + `publish`)

Dimensions:
- `verification_level_at_event`
- `required_verification_level`
- `permission_action`
- `permission_decision`

Reports:
- verification completion by method
- permission deny rate by action/surface

Acceptance:
- Deny rate is explainable by rule configuration.
- Event-time verification snapshots are present.

### Phase E — Moderation Essentials
Enable:
- `content_report_submitted`
- `content_report_resolved`

Dimensions:
- `policy_layer` (`global_floor|space_culture`)
- `enforcement_scope` (`space_only|sitewide`)

Reports:
- reports submitted
- action rate
- resolution latency (p50/p95)
- policy-layer mix

Acceptance:
- Moderation lifecycle counts reconcile (`resolved <= submitted`).
- Layer/scope dimensions are reliably populated.

### Phase F — Credibility Shadow Mode
Enable internal-only:
- `credibility_changed`
- `credibility_tier_changed` (optional in this phase)

No enforcement changes yet.

Reports:
- credibility tier distribution
- top credibility reason codes
- trend by policy layer

Acceptance:
- Score/tier evolution is auditable and reversible.
- No product behavior depends on credibility score yet.

### Phase G — Hardening and Expansion Gate
- Add retention jobs and archival policy.
- Add idempotency/dedupe tuning.
- Add role-scoped reporting skeleton (admin/group/channel/creator).
- Review readiness for next domain expansion.

Acceptance:
- Stable ingestion with low error rate.
- Rollup lag within SLA.
- Data quality checks green for previous phases.

## Data Quality Gates (Every Phase)
- Required field null rate under target.
- Duplicate `event_id` rate under target.
- Invariants pass for active event set.
- Rollup-to-raw reconciliation sample passes.

## Rollout Controls
- Feature flags per domain (`ANALYTICS_FEED_CORE_ENABLED`, etc.).
- Sampling toggle for non-critical events in early phases.
- Kill switch to disable specific event families without redeploy.

## Documentation Workflow
For each new event family:
1. Update `agents/analytics/EVENT_MATRIX.md`.
2. Update `agents/analytics/DIMENSION_CATALOG.md`.
3. Add/adjust rows in `agents/analytics/REPORT_CATALOG.md`.
4. Add invariants in `agents/analytics/QA_INVARIANTS.md`.
5. Then implement code.

## Risks and Mitigations
- **Risk:** Trying to launch too many events at once.
  - **Mitigation:** domain-flagged phases with strict gates.
- **Risk:** Dashboard churn from schema drift.
  - **Mitigation:** schema versioning + additive fields only.
- **Risk:** DB pressure from event volume.
  - **Mitigation:** client batching, server batch insert, rollup-first queries.

## Exit Criteria
Plan 119 is complete when:
- Phases A–G are implemented or explicitly deferred with rationale,
- active event families are stable,
- product and moderation teams can make weekly decisions from first-party dashboards without relying on external sinks.
