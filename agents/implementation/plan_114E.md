# Plan 114E: Prompt Analytics + Reporting (`/admin/prompt-analytics`)

## Goal
Measure prompt effectiveness and safety so prompt strategy can be tuned with evidence.

## Scope
- Event schema for prompt funnel
- Aggregation tables/materialized queries
- Admin reporting page focused on prompt metrics

Out of scope:
- Full user analytics platform
- Experimentation framework (future phase)

## Event Schema (V1)
- `prompt_impression`
- `prompt_click_primary`
- `prompt_click_secondary`
- `prompt_dismiss`
- `auth_start_from_prompt`
- `auth_complete_from_prompt`

Common fields:
- `session_id`
- `viewer_state`
- `surface`
- `prompt_id`
- `prompt_kind`
- `prompt_category`
- timestamp

## Dashboard
- `/admin/prompt-analytics`
- Filters:
  - date range
  - surface
  - prompt/category
- KPIs:
  - impressions
  - CTR
  - dismiss rate
  - auth start rate
  - auth completion rate
  - completion per impression (topline conversion)

Bundle requirement:
- `/admin/prompt-analytics` must be admin-only lazy bundle.
- Public/global-feed bundle must not include analytics dashboard code.

## Acceptance Criteria
1. Prompt funnel metrics available for active prompts.
2. Metrics can be segmented by prompt and date range.
3. Admin can identify overexposure (high dismiss, low conversion).
4. Event volume and ingestion are observable (drop detection).
5. Analytics UI code is isolated from public bundle.

## Observability
- `app.operation=prompt.analytics.ingest`
- `app.operation=prompt.analytics.query`
- Track ingestion lag and query latency.
