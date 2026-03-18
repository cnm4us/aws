# Dimension Catalog

Canonical field definitions for analytics events.

## Core Identity
| field | type | required | allowed values / format | privacy class | notes |
| --- | --- | --- | --- | --- | --- |
| `event_id` | string | yes | unique id (ulid/uuid) | internal | idempotency + dedupe |
| `event_name` | string | yes | enum from event matrix | internal | strict enum |
| `event_at` | datetime | yes | ISO8601 UTC | internal | event occurrence time |
| `schema_version` | int | yes | positive int | internal | contract evolution |
| `session_id` | string | yes | app session id | internal | analytics session key |
| `viewer_state` | string | yes | `anon`, `auth` | internal | segmentation |

## Surface / Space
| field | type | required | allowed values / format | privacy class | notes |
| --- | --- | --- | --- | --- | --- |
| `surface` | string | yes | `global_feed`, `group_feed`, `channel_feed`, `my_feed` | internal | report primary cut |
| `space_id` | int | no | positive int | internal | nullable on global |
| `space_type` | string | no | `group`, `channel`, `personal` | internal | nullable on global |
| `space_slug` | string | no | normalized slug | internal | nullable |
| `space_name` | string | no | short display name | internal | optional convenience |

## Content / Message
| field | type | required | allowed values / format | privacy class | notes |
| --- | --- | --- | --- | --- | --- |
| `content_id` | int | event-dependent | positive int | internal | publication/content id |
| `creator_id` | int | no | positive int | internal | content owner |
| `slide_type` | string | event-dependent | `content`, `message`, `sponsor`, `fund_drive` | internal | future-safe enum; legacy rows may still use `prompt` |
| `prompt_id` | int | message events | positive int | internal | legacy internal storage key for in-feed message id |
| `prompt_category` | string | no | bounded enum/set | internal | legacy internal segmentation key; campaign-key successor |
| `cta_kind` | string | no | `primary`, `secondary` | internal | click events only |
| `milestone_pct` | int | milestone only | `25`, `50`, `75`, `95` | internal | watch milestone |
| `watch_seconds` | int | some events | >=0 | internal | rounded seconds |

## Device
| field | type | required | allowed values / format | privacy class | notes |
| --- | --- | --- | --- | --- | --- |
| `device_family` | string | no | `mobile`, `tablet`, `desktop`, `unknown` | internal | bounded |
| `os_family` | string | no | bounded enum | internal | ex: ios/android/windows |
| `browser_family` | string | no | bounded enum | internal | ex: safari/chrome/firefox |
| `app_version` | string | no | semantic/build string | internal | release comparisons |

## Trust / Verification
| field | type | required | allowed values / format | privacy class | notes |
| --- | --- | --- | --- | --- | --- |
| `verification_level_at_event` | int | no | `0..N` | internal | event-time snapshot of trust level |
| `required_verification_level` | int | no | `0..N` | internal | level required for attempted action |
| `verification_method` | string | method events | `email`, `phone`, `idv`, `other` | internal | verification pathway |
| `verification_state` | string | method events | `none`, `pending`, `verified`, `failed`, `revoked` | internal | lifecycle status |
| `verification_provider` | string | no | bounded enum | internal | ex: provider slug, no secrets |
| `verification_failure_code` | string | no | bounded enum/code | internal | normalized reason code |
| `permission_action` | string | permission events | `join`, `publish`, `comment`, `report` | internal | guarded action being evaluated |
| `permission_decision` | string | permission events | `allow`, `deny` | internal | authorization outcome |
| `permission_reason_code` | string | no | bounded enum | internal | why allow/deny happened |
| `reach_tier_at_publish` | string | publish events | bounded enum | internal | distribution tier at event time |
| `reach_cap` | int | no | >=0 | internal | configured max reach for tier |

## Moderation
| field | type | required | allowed values / format | privacy class | notes |
| --- | --- | --- | --- | --- | --- |
| `report_id` | int | moderation events | positive int | internal | moderation lifecycle key |
| `report_reason` | string | some moderation events | bounded enum | internal | ex: harassment/spam |
| `report_severity` | string | no | bounded enum | internal | ex: low/med/high |
| `reporter_role` | string | no | `user`, `creator`, `group_admin`, `channel_admin`, `platform_admin` | internal | role segmentation |
| `target_type` | string | moderation events | `content`, `comment`, `user`, `space` | internal | moderated entity type |
| `target_id` | int | moderation events | positive int | internal | moderated entity id |
| `moderator_id` | int | no | positive int | restricted | staffing/audit use |
| `policy_layer` | string | some moderation events | `global_floor`, `space_culture` | internal | enforcement basis |
| `policy_id` | string | no | stable policy key | internal | links to guideline set |
| `policy_version` | int | no | positive int | internal | policy evolution |
| `culture_package_id` | string | no | stable package key | internal | space moderation package |
| `enforcement_scope` | string | no | `space_only`, `sitewide` | internal | action reach |
| `moderation_action` | string | no | bounded enum | internal | ex: warn/hide/suspend/no_action |
| `moderation_outcome` | string | no | `action_taken`, `no_action`, `overturned` | internal | resolution classification |
| `time_to_triage_sec` | int | no | >=0 | internal | latency metric |
| `time_to_resolution_sec` | int | no | >=0 | internal | latency metric |

## Governance
- Do not store email, phone, or freeform PII in event rows.
- Do not store raw verification artifacts (email/phone values, ID docs, document numbers, selfies, OCR payloads) in analytics events.
- Add new fields only with:
  - update to this catalog,
  - schema validator change,
  - report mapping justification.
