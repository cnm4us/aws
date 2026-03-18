# QA Invariants

Use these checks to validate analytics quality after instrumentation or schema changes.

## Structural Checks
- Unknown `event_name` count must be zero.
- Missing required fields must be zero.
- Enum out-of-range values must be zero.
- Event timestamps must parse and be UTC-normalizable.

## Logical Invariants
- `slide_complete <= slide_impression` (same filter scope).
- `slide_play_start <= slide_impression`.
- `message_click_primary + message_click_secondary <= message_impression`.
- `auth_start_from_message <= message_click_primary + message_click_secondary` (or document exceptions).
- `message_dismiss <= message_impression`.
- `feed_session_end <= feed_session_start` (allow some drop due to unload).
- `verification_completed <= verification_started` (same method/window).
- `verification_failed <= verification_started` (same method/window).
- `permission_check` must include both `permission_action` and `permission_decision`.
- For `permission_check` with `decision=deny`, `required_verification_level` should be >= `verification_level_at_event` unless an explicit alternate `permission_reason_code` is present.
- `reach_throttle_applied` should only appear with `permission_action=publish` paths and include `reach_tier_at_publish`.
- `content_report_resolved <= content_report_submitted`.
- `moderation_appeal_resolved <= moderation_appeal_submitted`.
- `time_to_resolution_sec >= time_to_triage_sec` when both present.
- `space_ban_applied` must have `enforcement_scope=space_only`.
- `site_suspension_applied` must have `enforcement_scope=sitewide`.
- `policy_layer` must be present on moderation resolutions/actions.

## Drift Checks
- Sudden day-over-day swings > configured threshold trigger warning.
- Event mix by browser/device should not abruptly collapse to one family.
- Surface distribution should remain plausible (`global` non-zero unless feature disabled).

## Dedupe Checks
- Duplicate `event_id` over dedupe window should be low and explainable.
- Retry paths should not increase KPI totals beyond accepted tolerance.

## Operational Checks
- Ingest success ratio within target band.
- Ingest error rates below threshold.
- Rollup lag within SLA.

## Incident Playbook (Short)
1. Confirm ingestion health (errors, throughput).
2. Validate schema changes deployed with catalog updates.
3. Run invariants on raw events.
4. Recompute rollups for impacted window.
5. Annotate dashboard/report with data quality note if needed.
