# Moderation Analytics

Moderation analytics covers safety operations and outcomes, separate from feed engagement KPIs.

## Policy Model (Site Design)
- **Layer 1: Global Floor**  
  Site-wide non-negotiable rules for severe behavior never allowed anywhere.
- **Layer 2: Space Culture**  
  Each group/channel defines its own moderation culture package (community-specific norms).
- Enforcement is **scope-aware**:
  - global-floor violations may result in sitewide action,
  - culture violations are usually space-scoped (user may be banned in one space but active in others).

## Goals
- Measure moderation workload and responsiveness.
- Measure enforcement quality and consistency.
- Detect abuse hotspots (content, spaces, users).
- Track cross-space recurrence so we can identify persistent harmful behavior without removing space autonomy.

## Core Lifecycle
1. Report submitted
2. Report triaged
3. Moderation action taken (or no action)
4. Optional appeal submitted
5. Appeal resolved

## Canonical Moderation Events
- `content_report_submitted`
- `content_report_triaged`
- `content_report_resolved`
- `content_hidden`
- `content_restored`
- `user_warning_issued`
- `space_ban_applied`
- `space_ban_removed`
- `site_suspension_applied`
- `site_suspension_removed`
- `moderation_appeal_submitted`
- `moderation_appeal_resolved`

## Key Moderation Dimensions
- `report_id`
- `report_reason`
- `report_severity`
- `reporter_state` (`anon|auth`)
- `reporter_role` (`user|creator|group_admin|channel_admin|platform_admin`)
- `target_type` (`content|comment|user|space`)
- `target_id`
- `space_id`, `space_type`
- `policy_layer` (`global_floor|space_culture`)
- `policy_id`, `policy_version`
- `culture_package_id` (space-specific moderation package id)
- `enforcement_scope` (`space_only|sitewide`)
- `moderation_action`
- `moderation_outcome` (`action_taken|no_action|overturned`)
- `time_to_triage_sec`
- `time_to_resolution_sec`

## KPI Set (v1)
- Reports submitted/day
- Open reports backlog
- Median and p95 time to triage
- Median and p95 time to resolution
- Action rate (reports resulting in enforcement)
- Appeal rate
- Appeal overturn rate
- Repeat offender rate
- Cross-space offender count (users with incidents in multiple spaces)
- Space-ban to sitewide-escalation rate
- Policy-layer mix (% global-floor vs space-culture actions)

## Notes
- Keep moderation events and engagement events in the same pipeline, but report from dedicated moderation rollups.
- Avoid storing freeform sensitive text in event rows; keep references by IDs.
- Maintain a **cross-site incident ledger** keyed by user id + time window for escalation visibility.
- Capture `verification_level_at_event` on moderation report/action events so trust-level analysis is historically accurate.
