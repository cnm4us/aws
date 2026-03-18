# Event Matrix

Use this matrix to map each event to:
- trigger semantics,
- required dimensions,
- downstream reports.

## Columns
- `event_name`
- `trigger`
- `required_fields`
- `optional_fields`
- `report_consumers`
- `notes`

## Seed Rows
| event_name | trigger | required_fields | optional_fields | report_consumers | notes |
| --- | --- | --- | --- | --- | --- |
| `feed_session_start` | first eligible feed interaction/session open | `event_at`, `session_id`, `viewer_state`, `surface` | `space_id`, `space_type`, `space_slug`, `space_name`, device fields | Session KPIs, DAU/WAU proxy | One per session per surface |
| `feed_session_end` | page hide/unload/session close | `event_at`, `session_id`, `surface`, `watch_seconds` | space + device fields | Session duration, avg watch/session | Best effort on unload |
| `slide_impression` | slide becomes active in viewport | `event_at`, `session_id`, `surface`, `content_id`, `slide_type` | `creator_id`, `space_*`, device fields | Impressions, funnel denominator | Emit once per session/content |
| `slide_play_start` | user tap/play starts playback | `event_at`, `session_id`, `content_id`, `slide_type` | `surface`, `space_*`, device fields | Plays, play-through metrics | User intent event |
| `slide_watch_milestone` | watch threshold crossed | `event_at`, `session_id`, `content_id`, `milestone_pct` | `surface`, `space_*`, device fields | Completion funnel | Expected milestones: 25/50/75/95 |
| `slide_complete` | >=95% watched | `event_at`, `session_id`, `content_id` | `surface`, `space_*`, device fields | Completion rate | One per session/content |
| `prompt_impression` | in-feed message shown | `event_at`, `session_id`, `prompt_id`, `prompt_category`, `surface` | `space_*`, device fields | Message funnel | Canonical event name remains legacy `prompt_*`; for `slide_type=message` |
| `prompt_pass_through` | user scrolls past in-feed message | `event_at`, `session_id`, `prompt_id`, `surface` | `prompt_category`, device fields | Message dismissal proxy | Canonical event name remains legacy `prompt_*` |
| `prompt_click` | in-feed message CTA clicked | `event_at`, `session_id`, `prompt_id`, `cta_kind` | `prompt_category`, device fields | Message conversion | Canonical event name remains legacy `prompt_*`; `cta_kind=primary|secondary` |
| `prompt_auth_start` | register/login flow started from in-feed message | `event_at`, `session_id`, `prompt_id` | `prompt_category`, device fields | Auth funnel | Canonical event name remains legacy `prompt_*` |
| `prompt_auth_complete` | auth completed and return observed from in-feed message | `event_at`, `session_id`, `prompt_id` | `prompt_category`, device fields | Message ROI | Canonical event name remains legacy `prompt_*`; optional depending on callback flow |

## TODO
- Add creator workflow events (`create_video_export_started/completed`).
- Add interaction events (`like`, `comment`, `follow`) if used in product reporting.

## Verification / Trust Seed Rows
| event_name | trigger | required_fields | optional_fields | report_consumers | notes |
| --- | --- | --- | --- | --- | --- |
| `verification_started` | user starts a verification flow | `event_at`, `session_id`, `verification_method`, `verification_state` | `verification_provider`, device fields | Trust & Safety, Growth | usually `verification_state=pending` |
| `verification_completed` | verification success | `event_at`, `session_id`, `verification_method`, `verification_state`, `verification_level_at_event` | `verification_provider` | Trust & Safety, Product | `verification_state=verified` |
| `verification_failed` | verification failed | `event_at`, `session_id`, `verification_method`, `verification_state` | `verification_provider`, `verification_failure_code` | Trust & Safety, Product | `verification_state=failed` |
| `verification_revoked` | prior verification removed/revoked | `event_at`, `session_id`, `verification_method`, `verification_state`, `verification_level_at_event` | `verification_failure_code` | Trust & Safety | `verification_state=revoked` |
| `permission_check` | guarded action evaluated | `event_at`, `session_id`, `permission_action`, `permission_decision` | `required_verification_level`, `verification_level_at_event`, `permission_reason_code`, `surface`, `space_*` | Product, Trust & Safety | applies to join/publish/comment/report |
| `reach_throttle_applied` | publish distribution constrained by trust tier | `event_at`, `session_id`, `content_id`, `creator_id`, `reach_tier_at_publish` | `reach_cap`, `verification_level_at_event`, `surface`, `space_*` | Product, Creator Ops | event-time snapshot required |

## Moderation Seed Rows
| event_name | trigger | required_fields | optional_fields | report_consumers | notes |
| --- | --- | --- | --- | --- | --- |
| `content_report_submitted` | user submits report | `event_at`, `report_id`, `target_type`, `target_id`, `report_reason`, `viewer_state` | `surface`, `space_*`, `policy_layer`, `policy_id`, device fields | Moderation Ops | lifecycle start |
| `content_report_triaged` | moderator triages report | `event_at`, `report_id`, `moderator_id` | `time_to_triage_sec`, `report_severity`, `policy_layer`, `policy_id` | Moderation Ops | staffing/SLA |
| `content_report_resolved` | report closed | `event_at`, `report_id`, `moderation_outcome` | `moderation_action`, `enforcement_scope`, `policy_layer`, `policy_id`, `time_to_resolution_sec` | Moderation Ops, Trust & Safety | lifecycle close |
| `space_ban_applied` | user banned in a specific group/channel | `event_at`, `target_type`, `target_id`, `space_id`, `enforcement_scope` | `report_id`, `policy_layer`, `policy_id`, `moderation_action` | Moderation Ops | scope must be `space_only` |
| `site_suspension_applied` | platform-wide suspension applied | `event_at`, `target_type`, `target_id`, `enforcement_scope` | `report_id`, `policy_layer`, `policy_id`, `moderation_action` | Trust & Safety | scope must be `sitewide` |
| `moderation_appeal_submitted` | appeal created | `event_at`, `report_id`, `target_type`, `target_id` | `space_*` | Moderation Ops | optional branch |
| `moderation_appeal_resolved` | appeal closed | `event_at`, `report_id`, `moderation_outcome` | `moderation_action`, `enforcement_scope`, `policy_layer`, `policy_id`, `time_to_resolution_sec` | Moderation Ops | overturn tracking |
