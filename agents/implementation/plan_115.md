# Plan 115: Hybrid Analytics Foundation (Canonical + Optional Product Analytics Sink)

## Status
- Phase A: completed (canonical contract + prompt event mapping + validation)
- Phase B: completed (baseline feed session/impression/complete telemetry + rollups + admin query endpoint)
- Phase C: completed (optional analytics sink adapter + PostHog provider path + sink health counters)
- Phase D: completed (admin cross-metric dashboard + CSV export + anonymous/authenticated split)

## Goal
Build a reliable analytics foundation that supports:
- site admin decisions,
- future creator/group/channel reporting,
- prompt-system validation,
while keeping the app as the source of truth and using external analytics tooling only as optional acceleration.

## Decision Summary
- **Canonical system of record stays internal** (DB + rollups + admin APIs).
- **External module/sink is optional and secondary** (for fast funnels/cohorts/UX analysis).
- **All critical metrics (billing, compliance, policy, payouts, moderation)** must be computable from internal data only.

## Scope (V1)
- Standardize event contract across feed + prompt + auth conversion touchpoints.
- Add low-cardinality baseline engagement metrics for anonymous and authenticated sessions.
- Add a sink adapter interface and one provider adapter (PostHog-first, feature-flagged).
- Preserve existing prompt analytics and make it cross-checkable against broader engagement metrics.

Out of scope:
- Final creator monetization math
- Ad-serving decision engine
- Full experimentation platform

## Architecture
1. Event Contract Layer
- Canonical event envelope:
  - `event_name`
  - `occurred_at`
  - `surface`
  - `viewer_state` (`anonymous|authenticated`)
  - `session_id`
  - `user_id` (nullable)
  - `content_id` / `prompt_id` (nullable)
  - `meta` (strict allowlist)
- Event names (V1):
  - `feed_session_start`
  - `feed_slide_impression`
  - `feed_slide_complete`
  - `feed_session_end`
  - plus existing prompt funnel events.

2. Internal Persistence + Rollups
- Keep raw event table with dedupe + retention.
- Daily rollups by:
  - date
  - surface
  - viewer_state
  - content/prompt dimensions where relevant.
- Query endpoints for:
  - admin summary KPIs
  - prompt cross-metric validation.

3. External Sink Adapter (Optional)
- Interface: `track(event)` with non-blocking fire-and-forget path.
- Provider adapters:
  - `none` (default)
  - `posthog` (first implementation)
- Config flags:
  - `ANALYTICS_SINK_ENABLED`
  - `ANALYTICS_SINK_PROVIDER`
  - `ANALYTICS_SINK_SAMPLE_RATE`
- Failures in sink path must not fail user requests.

## Phases

### Phase A — Canonical Event Contract + Validation
- Add shared analytics event types + validators.
- Normalize naming and required fields.
- Enforce low-cardinality tags and safe metadata allowlist.
- Acceptance:
  - invalid payloads rejected with clear reason codes
  - existing prompt events mapped to canonical envelope.

### Phase B — Baseline Feed Engagement Events
- Instrument global feed/session events for anonymous + authenticated users.
- Add dedupe strategy to avoid inflation from rapid re-renders.
- Rollup table + query endpoint for:
  - sessions
  - impressions
  - completes
  - avg watch seconds/session.
- Acceptance:
  - anonymous traffic appears in rollups
  - prompt analytics can be cross-checked against session/impression totals.

### Phase C — Optional Sink Adapter (PostHog-First)
- Implement adapter abstraction.
- Add PostHog adapter behind flags.
- Add drop/failure counters for sink health.
- Acceptance:
  - turning sink on/off requires env/config only
  - no request-path regressions when sink is unavailable.

### Phase D — Admin Reporting (Cross-Metric)
- Add `/admin/analytics` summary page:
  - sessions, impressions, completes, completion rate
  - prompt impressions/clicks/completions overlay
  - anonymous vs authenticated split.
- Add CSV export.
- Keep bundle admin-only/lazy.
- Acceptance:
  - prompt funnel can be validated against feed baseline metrics in one screen.

### Phase E — Observability + Guardrails
- OTel/Pino tags:
  - `app.operation=analytics.ingest`
  - `app.operation=analytics.rollup`
  - `app.operation=analytics.query`
  - `app.operation=analytics.sink.dispatch`
- Prometheus metrics:
  - ingest RPS/error rate
  - sink dispatch success/failure/drop
  - rollup lag.
- Add alerts for ingestion failure spikes and rollup staleness.

### Phase F — Hardening + Privacy Controls
- Retention and purge jobs for raw events.
- Minimize/avoid PII in event payloads.
- Add DSAR-friendly deletion hooks for user-linked analytics rows.
- Document data dictionary and metric definitions.

## Metric Definitions (V1)
- `Impression`: slide visible past threshold (existing rule or 1+ sec rule).
- `Complete`: playback reaches completion threshold.
- `Session`: starts at first eligible feed interaction; ends on inactivity timeout.
- `Prompt Conversion`: `auth_complete_from_prompt / prompt_impression`.
- `Eligibility Coverage`: `prompt_eligible_sessions / total_sessions` (anonymous only).

## Risk Controls
- Double-write period before relying on any new KPI.
- Idempotency keys to reduce duplicate events.
- Strict caps on cardinality (`meta` keys + values).
- Feature flags for each instrumentation block.

## Rollout Plan
1. Enable contract + internal ingestion first.
2. Verify dashboards/queries from internal data only.
3. Enable external sink at low sample rate (e.g., 10%).
4. Compare internal vs external counts for drift.
5. Raise sample rate only after parity confidence.

## Acceptance Criteria
1. Anonymous and authenticated feed activity is measurable internally.
2. Prompt analytics can be cross-validated with baseline feed metrics.
3. External sink can be enabled/disabled without code changes or user-impact failures.
4. Admin has one dashboard for baseline + prompt KPI sanity checks.
5. Observability detects ingest/sink/rollup failures early.
