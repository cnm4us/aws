# Plan 114C: Prompt Decision Service (Eligibility + Selection)

## Goal
Build a dedicated runtime service that decides **if** a prompt should be inserted and **which** prompt to insert.

## Scope
- Stateless decision API + session context inputs
- Eligibility checks (thresholds/caps/cooldowns)
- Candidate prompt selection
- Decision explainability payload (for debugging/admin)

Out of scope:
- Feed merge/rendering
- Admin CRUD for prompts/rules

## Input Contract (V1)
- `surface` (`global_feed`)
- `session_id`
- `viewer_state` (`anonymous` | `authenticated`)
- counters:
  - `slides_viewed`
  - `watch_seconds`
  - `prompts_shown_this_session`
  - `slides_since_last_prompt`
  - `last_prompt_dismissed_at`

Session default:
- For anonymous users, `session_id` comes from `anon_session_id` first-party cookie (TTL 30 days).

## Output Contract (V1)
- `should_insert: boolean`
- `prompt_id: number | null`
- `prompt_kind: prompt_full | prompt_overlay | null`
- `insert_after_index: number | null` (optional helper)
- `reason_code` (`eligible`, `below_threshold`, `cap_reached`, etc.)
- `debug` object (gated by env/role)

## Selection Strategy (V1)
- Prefer active prompt with highest priority in allowed category.
- Avoid repeating same prompt back-to-back.
- Deterministic per session where possible.

## Acceptance Criteria
1. Service deterministically returns eligible prompt or explicit no-insert reason.
2. Caps/cooldowns are enforced server-side.
3. Decision response is stable under refresh within same session state.
4. Debug output helps explain why prompt was/wasn’t shown.

## Observability
- Span tag: `app.operation=feed.prompt.decide`
- Attributes: `prompt_decision`, `reason_code`, `prompt_id` (when selected)
