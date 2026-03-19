# Plan 118: First-Party Product Analytics (Internal Source of Truth)

## Goal
Build a first-party analytics system for feed, creator, and prompt/product metrics where our own database is the system of record.  
PostHog remains optional as a secondary sink for ad-hoc exploration, not primary truth.

## Why Now
- Prompt/feed behavior is getting more complex (`plan_117`), and product decisions need stable metrics.
- We need analytics that are explainable, queryable, and controlled by our own data model.
- We need role-based reporting for:
  - platform admins,
  - group/channel admins,
  - creators.

## Product Questions This Must Answer
1. **Audience quality:** Are users watching or just swiping?
2. **Prompt effectiveness:** Which prompt categories and creatives convert?
3. **Creator performance:** Which creators/content drive completion and retention?
4. **Surface performance:** How do global/group/channel feeds differ?
5. **Conversion funnel:** Anonymous viewer -> auth start -> registered/logged in.

## KPI Framework (v1)
### Slide-level
- impressions (slide entered active viewport)
- play starts (tap/play intent)
- watch milestones (`25%`, `50%`, `75%`, `95%`)
- complete (>=95%)
- fast-skip (`<2s` dwell)

### Session/user-level
- sessions started/ended
- session duration
- feed watch seconds
- slides viewed per session
- completion rate per session
- prompt exposure count per session
- verification funnel progress by method/level

### Creator/content-level
- videos created
- videos published by surface (`global`, `group`, `channel`)
- impressions, plays, completion rate per content
- retention proxies (watch seconds per view)
- reach-tier impact by creator verification level

### Prompt/conversion-level
- prompt impression
- prompt pass-through
- prompt CTA click
- auth start/completion
- conversion rate by category/creative/surface

### Trust/permission-level
- verification started/completed/failed/revoked
- permission allow/deny by action (`join`, `publish`, `comment`, `report`)
- reach throttling distribution by verification level

## Event Model (Canonical)
Use append-only event names with bounded dimensions:

- `feed_session_start`
- `feed_session_end`
- `slide_impression`
- `slide_play_start`
- `slide_watch_milestone`
- `slide_complete`
- `slide_fast_skip`
- `prompt_impression`
- `prompt_pass_through`
- `prompt_click`
- `prompt_auth_start`
- `prompt_auth_complete`
- `verification_started`
- `verification_completed`
- `verification_failed`
- `verification_revoked`
- `permission_check`
- `reach_throttle_applied`

Required dimensions on most events:
- `event_at`
- `session_id`
- `viewer_state` (`anon|auth`)
- `surface` (`global_feed|group_feed|channel_feed|my_feed`)
- `space_id`, `space_type`, `space_slug`, `space_name` (nullable)
- `content_id` (nullable for session/prompt-only events)
- `creator_id` (nullable)
- `slide_type` (`content|prompt|sponsor|fund_drive`)
- `prompt_id`, `prompt_category` (prompt events)
- `verification_level_at_event` (snapshot where relevant)
- `required_verification_level`, `permission_action`, `permission_decision` (permission events)
- `reach_tier_at_publish`, `reach_cap` (publish distribution events)
- `device_family`, `os_family`, `browser_family` (bounded)

## Storage Strategy (v1)
### Primary store: MariaDB
- `analytics_events` (append-only raw)
- `analytics_rollup_hourly`
- `analytics_rollup_daily`

### Ingestion pattern
- Batch events client-side (small bundles) + `sendBeacon` on unload.
- Validate and normalize server-side.
- Insert in batches, not one row per HTTP call where possible.

### Query pattern
- Admin UI reads rollups by default.
- Raw events used for debugging and occasional deep analysis.

### Retention
- Keep raw events for a bounded window (e.g., 30–90 days).
- Keep daily rollups long-term.

## API and Service Boundaries
### Ingest API
- `POST /api/analytics/ingest`
- accepts array payloads, validates schema, writes normalized events.

### Internal aggregation jobs
- hourly rollup job
- daily rollup job
- backfill/rebuild job from raw events

### Reporting APIs
- admin summary + trend endpoints
- scope-aware endpoints for group/channel admins and creators

## Admin/Role Reporting
### `/admin/analytics` (platform)
- KPI cards + trends by surface/viewer state
- prompt funnel (impression -> click -> auth start -> auth complete)
- top creators/content by watch quality

### Group/channel analytics (future phase)
- scoped to owned spaces
- impressions, plays, completion, watch time, prompt impact

### Creator analytics (future phase)
- per-publication metrics
- aggregate creator performance trends

## Relationship to Plan 117
`plan_117` must emit stable prompt lifecycle events without destructive slide removal.  
This plan depends on that behavior to avoid index-driven metric distortion.

Integration requirements:
- include `prompt_pass_through` as first-class event
- include stable sequence/content identifiers in prompt and slide events
- mark prompt slides as `slide_type=prompt` so content metrics stay clean

## Privacy and Governance
- No raw PII in analytics payloads.
- Store user ids only where needed for scoped reporting; no email in event rows.
- Add data retention/deletion policy hooks.
- Add event schema versioning for safe evolution.

## Phases
### Phase A — Canonical Event Contract
- finalize event names, required fields, enums, and validation rules
- document schema and examples

Acceptance:
- single source of truth document for event contract
- validator rejects malformed/out-of-bound events

### Phase B — Ingest Hardening
- implement/standardize batched ingest endpoint
- add dedupe/idempotency guard (short TTL hash or event_id)
- add ingest observability metrics and error counters

Acceptance:
- ingest handles expected client load without noisy DB writes
- invalid events are dropped with reason counters

### Phase C — Raw Storage + Rollup Tables
- create/adjust `analytics_events` and rollup tables
- build hourly/daily rollup jobs with re-runnable windows

Acceptance:
- rollups reproducible from raw data
- dashboard queries run against rollups

### Phase D — Feed + Prompt Instrumentation Alignment
- align feed and prompt emitters to canonical events
- ensure `plan_117` pass-through and prompt lifecycle are captured
- ensure milestone events emitted once per content/session threshold
- capture trust snapshots on prompt/feed events where relevant

Acceptance:
- end-to-end event flow covers feed and prompt KPIs
- no duplicate milestone spikes from index shifts

### Phase E — Verification + Permission Instrumentation
- instrument verification lifecycle events
- instrument guarded-action permission checks (`join|publish|comment|report`)
- instrument publish reach-tier decisions

Acceptance:
- can measure verification funnel and deny rates by action/surface
- reach decisions are attributable to event-time verification level

### Phase F — Admin Reporting v1
- build platform admin KPI/trend/funnel views from rollups
- add filters: date range, surface, viewer state, space

Acceptance:
- admins can answer core product questions without external tools

### Phase G — Role-Scoped Analytics
- add group/channel admin analytics endpoints and views
- add creator-facing content metrics endpoint/view

Acceptance:
- each role sees only authorized scoped analytics

### Phase H — External Sink as Secondary
- keep PostHog sink optional (`enabled/provider/sample_rate`)
- map canonical events to external sink payloads
- document parity gaps

Acceptance:
- internal DB remains source of truth
- external sink can be turned on/off without data model changes

## Risks and Mitigations
- **Risk:** high ingest write volume on MariaDB.
  - **Mitigation:** client batching, server batch insert, rollup-first querying.
- **Risk:** metric drift from event name/field changes.
  - **Mitigation:** schema versioning + strict validators + compatibility tests.
- **Risk:** duplicate counts from retries.
  - **Mitigation:** idempotency key/event hash for short-window dedupe.
- **Risk:** over-collection.
  - **Mitigation:** bounded enums + explicit non-goals for PII.

## Test Plan
1. Feed session emits start/end and slide events (anon + auth).
2. Prompt flow emits impression/pass-through/click/auth events.
3. Rollup jobs produce expected hourly/daily totals from known fixtures.
4. Admin report API matches rollup totals for selected ranges.
5. Retry/replay payloads do not double count beyond dedupe policy.
