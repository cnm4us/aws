# Plan 114B: Prompt Rules (`/admin/prompt-rules`)

## Goal
Provide configurable, safe prompt delivery controls with sensible defaults.

## Scope
- Rule schema and persistence
- Global defaults
- Admin rules UI
- Rule validation and precedence

Out of scope:
- Rendering implementation
- Analytics dashboard implementation

## Rule Model (V1)
- `id`
- `name`
- `enabled`
- `applies_to_surface` (`global_feed` for V1)
- `auth_state` (`anonymous` for V1)
- Thresholds:
  - `min_slides_viewed`
  - `min_watch_seconds`
- Caps:
  - `max_prompts_per_session`
  - `min_slides_between_prompts`
  - `cooldown_seconds_after_dismiss`
- Selection filters:
  - `prompt_category_allowlist` (e.g. `register_prompt`)
- Priority and tie-break fields

Default V1 profile:
- `min_slides_viewed=6`
- `min_watch_seconds=45`
- `max_prompts_per_session=2`
- `min_slides_between_prompts=15`
- `cooldown_seconds_after_dismiss=900`
- selection tie-break: random among highest-priority eligible prompts.

## Rule Evaluation Approach
- Deterministic, top-down precedence:
  1. hard safety caps
  2. eligibility thresholds
  3. candidate prompt filtering
  4. final selection strategy (priority, recency, random tie-break)

## Admin UI
- `/admin/prompt-rules`
- Start with one global rule profile, then allow multiple.
- Inline warnings for unsafe configs (e.g. too-frequent prompts).

Bundle requirement:
- `/admin/prompt-rules` must be an admin-only lazy bundle.
- Public/global-feed bundle must not include rule editor UI code.

## Acceptance Criteria
1. Admin can configure thresholds/caps without deploy.
2. Invalid/unsafe configs are blocked or warned.
3. Rule engine can produce stable decision input for feed runtime.
4. Defaults protect user experience when no custom rules exist.
5. Rule-admin UI is isolated from public bundle.

## Observability
- Tag decision logs with `rule_id` and `rule_name`.
- Track `rule_match` and `rule_block_reason`.
