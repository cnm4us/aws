# Report Catalog

Product-facing report definitions and formulas.

## Columns
- `report_name`
- `owner`
- `question`
- `grain` (hourly/daily/weekly)
- `filters`
- `formula`
- `source_events`
- `freshness_sla`

## Seed Reports
| report_name | owner | question | grain | filters | formula | source_events | freshness_sla |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sessions Started | Product | How much traffic did we get? | daily | surface, viewer_state | count(`feed_session_start`) | `feed_session_start` | <=15 min |
| Avg Watch Seconds / Session | Product | Are users staying engaged? | daily | surface, viewer_state, space | sum(`watch_seconds` on session_end) / count(`feed_session_end`) | `feed_session_end` | <=15 min |
| Slide Completion Rate | Content | Are slides being watched to near-end? | daily | surface, space, creator | count(`slide_complete`) / count(`slide_impression`) | `slide_complete`, `slide_impression` | <=15 min |
| Play Rate | Content | Do users initiate playback after impression? | daily | surface, space, creator | count(`slide_play_start`) / count(`slide_impression`) | `slide_play_start`, `slide_impression` | <=15 min |
| Message CTR | Growth | Are in-feed messages driving clicks? | daily | campaign key, campaign category, surface, delivery context | count(`message_click`) / count(`message_impression`) | `message_click`, `message_impression` | <=15 min |
| Message Pass-through Rate | Growth | Are users skipping in-feed messages? | daily | campaign key, surface | count(`message_dismiss`) / count(`message_impression`) | `message_dismiss`, `message_impression` | <=15 min |
| Message Auth Start Rate | Growth | Do message clicks start auth? | daily | campaign key, surface | count(`auth_start_from_message`) / count(`message_impression`) | `auth_start_from_message`, `message_impression` | <=15 min |
| Creator Top Content | Creator Ops | Which videos perform best by quality? | daily | creator, space | rank by completion rate then watch seconds | slide events + rollups | hourly |
| Verification Funnel | Product | How many users complete each trust method/level? | daily | method, provider | starts -> completes -> failures by method | `verification_started`, `verification_completed`, `verification_failed` | <=15 min |
| Permission Deny Rate | Product | How often are join/publish/comment/report actions denied by trust rules? | daily | action, surface, space | count(`permission_check` where decision=`deny`) / count(`permission_check`) | `permission_check` | <=15 min |
| Publish Eligibility by Level | Creator Ops | Which verification levels are allowed to publish per surface/culture? | daily | level, surface, space | allow/deny split for `permission_action=publish` | `permission_check` | hourly |
| Reach Throttle Mix | Product | How much content is distributed under throttled tiers? | daily | reach tier, level, surface | count by `reach_tier_at_publish` (+ avg `reach_cap`) | `reach_throttle_applied` | hourly |
| Reports Submitted | Moderation Ops | How many moderation reports are entering queue? | daily | reason, surface, space | count(`content_report_submitted`) | `content_report_submitted` | <=15 min |
| Time to Resolution (p50/p95) | Moderation Ops | How quickly are reports resolved? | daily | reason, severity | percentile(`time_to_resolution_sec`) | `content_report_resolved` | hourly |
| Action Rate | Trust & Safety | What fraction of reports lead to enforcement? | daily | reason, surface | count(`content_report_resolved` where outcome=`action_taken`) / count(`content_report_submitted`) | moderation lifecycle events | hourly |
| Appeal Overturn Rate | Trust & Safety | How often are actions reversed on appeal? | daily | reason, action | count(`moderation_appeal_resolved` where outcome=`overturned`) / count(`moderation_appeal_resolved`) | appeal events | hourly |
| Policy Layer Mix | Trust & Safety | How much enforcement is global-floor vs space-culture? | daily | surface, space | count by `policy_layer` | moderation lifecycle events | hourly |
| Space Ban Rate | Moderation Ops | How often do cases end in space-only bans? | daily | space, reason | count(`space_ban_applied`) / count(`content_report_submitted`) | report + action events | hourly |
| Sitewide Escalation Rate | Trust & Safety | How often do cases escalate to sitewide actions? | daily | reason, severity | count(actions where `enforcement_scope`=`sitewide`) / count(`content_report_resolved`) | moderation lifecycle events | hourly |
| Cross-Space Recurrence | Trust & Safety | Which users are triggering incidents across multiple spaces? | weekly | policy layer, severity | distinct users with incidents in >=2 spaces in window | report/resolution events | daily |

## TODO
- Add group/channel admin report variants with scoped access.
- Add export/render funnel reports for creator workflows.
