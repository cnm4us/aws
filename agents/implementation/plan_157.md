# Plan 157: User-Facing Reporting Rules Layer

Status: Draft

## Context
- Moderation canon already exists and remains unchanged:
  - `Rule -> Category -> Culture -> Space (Group/Channel)`
- Reporting UX needs simpler reasons while still submitting canonical `rule_id`.
- Global Feed is treated as a channel (`/channels/global-feed`) and can carry cultures.
- Personal-space reporting is out-of-scope for this phase (no resolvable rules).

## Product Decisions (Locked)
- Submit contract: user reports must always resolve to a concrete `rule_id`.
- Input UX: no radio-button selection model; users drill down via tappable reason/rule rows and can submit directly.
- Visibility model: loose visibility (show user-facing reason if at least one mapped rule is visible in context).
- Grouping model: sort + section grouping in UI (not behavioral enforcement).
- Mapping metadata:
  - `priority` (int, lower is stronger)
  - `is_default` (bool)
  - no `default_for_context` for now.
- Snapshoting: store immutable user-facing reason snapshot on report event.
- Analytics: report by both user-facing reason and canonical rule.
- Backward compatibility: no special compatibility rollout required (dev-only environment).
- Empty-state copy: `"No moderation rules available for this space."`

## Data Model

## New Tables
1. `user_facing_rules`
- `id` BIGINT PK
- `label` VARCHAR(255) NOT NULL
- `short_description` VARCHAR(500) NULL
- `group_key` VARCHAR(64) NULL
- `group_label` VARCHAR(128) NULL
- `group_order` INT NOT NULL DEFAULT 0
- `display_order` INT NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1
- `created_at`, `updated_at`
- Indexes:
  - `(is_active, group_order, display_order, id)`
  - `(group_key, group_order, display_order, id)`

2. `user_facing_rule_rule_map`
- `id` BIGINT PK
- `user_facing_rule_id` BIGINT NOT NULL
- `rule_id` BIGINT NOT NULL
- `priority` INT NOT NULL DEFAULT 100
- `is_default` TINYINT(1) NOT NULL DEFAULT 0
- `created_at`, `updated_at`
- Constraints/indexes:
  - unique `(user_facing_rule_id, rule_id)`
  - index `(rule_id, user_facing_rule_id)`
  - index `(user_facing_rule_id, is_default, priority, id)`

## Report Event Snapshot Additions
- Extend moderation report record/event payload with:
  - `user_facing_rule_id`
  - `user_facing_rule_label_at_submit`
  - `user_facing_group_key_at_submit`
  - `user_facing_group_label_at_submit`

## Resolution Logic

Given a target space (group/channel):
1. Resolve active cultures for that space.
2. Resolve rule set reachable via culture->category->rule.
3. Resolve active `user_facing_rules` that map to at least one reachable rule.
4. Return grouped + sorted output:
  - sort groups by `group_order`, then `group_label`
  - sort reasons by `display_order`, then `label`
5. For each reason, include visible mapped rules sorted by:
  - `is_default DESC`, `priority ASC`, `rule_id ASC`.

## Default Rule Resolution (when user does not drill down)
For selected user-facing reason within current context:
1. choose mapped visible rule with `is_default=1` (first by `priority`, `rule_id`)
2. else choose mapped visible rule with lowest `priority`
3. else choose first visible mapped rule by `rule_id`
4. if none visible -> reject submit (`400 no_resolvable_rule`)

## API Surface

## Admin APIs
- `GET /api/admin/user-facing-rules`
- `POST /api/admin/user-facing-rules`
- `PATCH /api/admin/user-facing-rules/:id`
- `POST /api/admin/user-facing-rules/:id/mappings` (upsert rule mappings)
- `DELETE /api/admin/user-facing-rules/:id/mappings/:mappingId`

## Reporting APIs
- `GET /api/moderation/reporting-reasons?spaceId=<id>`
  - returns grouped user-facing reasons + mapped visible rules
- `POST /api/moderation/reports`
  - accepts:
    - `target_type`, `target_id`
    - optional `user_facing_rule_id`
    - optional `rule_id` (if user drilled down)
    - optional user note
  - backend always resolves/validates final canonical `rule_id`
  - request must provide at least one of `rule_id` or `user_facing_rule_id`

## Admin UI

## New Admin Page
- `/admin/user-facing-rules`
- Card/table hybrid with:
  - Label
  - Active
  - Group label/key
  - Group/display order
  - Mapping count
  - Edit action

## Editor
- Create/edit fields:
  - Label
  - Short description
  - Group key
  - Group label
  - Group order
  - Display order
  - Active
- Mapping manager:
  - multi-select/add rules
  - set `priority`
  - set `is_default`
  - guardrail: allow max one default per user-facing reason in UI (backend also validates)

## Reporting UI (User-Facing Modal)

## Step Flow
1. Open report modal.
2. Fetch visible grouped user-facing reasons for current space.
3. Render grouped reasons.
4. User taps a reason row to expand drill-down (no radios).
5. User submits either:
  - directly from reason row (implicit default resolver path), or
  - from a specific drilled rule row (explicit `rule_id`).
6. Keep a single explicit submit affordance per row/action; no preselection required.

## Empty State
- When no reasons resolve in context:
  - display: `"No moderation rules available for this space."`
  - disable submit.

## Personal Space Handling
- If context is personal-space (or unresolved context with no cultures):
  - return empty reasons list (same empty-state copy).

## Validation Rules
- `user_facing_rule_id` must be active + visible in target context.
- Explicit `rule_id`, if provided, must be in that reason’s visible mapped set.
- Implicit resolution must find one rule or fail.
- Canonical `rule_id` is always persisted on report.
- If only `rule_id` is provided, backend resolves linked `user_facing_rule_id` for snapshot fields.

## Phases

## Phase A — Schema + Service Foundation
- Add new tables + indexes.
- Add report snapshot fields.
- Add seed helper for initial user-facing reasons.
- Acceptance:
  - migrations apply cleanly; app boots.

## Phase B — Admin CRUD + Mapping Management
- Build admin list/editor/mapping management.
- Enforce single default per user-facing reason (backend validation).
- Acceptance:
  - admin can create reasons and map multiple rules with priority/default.

## Phase C — Visibility Resolver + Reporting APIs
- Implement context resolver from space -> cultures -> categories -> rules.
- Implement `GET reporting-reasons`.
- Implement submit path with canonical rule resolution.
- Acceptance:
  - API returns expected grouped reasons and canonical submit behavior.

## Phase D — Reporting Modal Integration
- Replace first-layer reporting choices with user-facing reasons (no radio inputs).
- Add drill-down to specific rules with direct-submit actions.
- Handle no-reasons empty state.
- Acceptance:
  - user can submit without preselecting a radio option; canonical `rule_id` always stored.

## Phase E — Observability + Analytics + QA
- Add trace tags:
  - `app.user_facing_rule_id`
  - `app.user_facing_rule_label`
  - `app.report_rule_resolution=explicit|default|priority|fallback`
  - `app.report_rule_id`
- Extend analytics views/queries for:
  - counts by user-facing reason
  - counts by canonical rule
  - cross-tab reason->rule
- Execute smoke matrix.

## Smoke Matrix
1. Create user-facing reason mapped to 2+ rules; set one default.
2. Verify reason appears in space where at least one mapped rule is visible.
3. Verify reason hidden where none mapped rules are visible.
4. Submit without drill-down; verify canonical `rule_id` resolved via default/priority.
5. Submit with drill-down; verify explicit `rule_id` wins.
6. Verify report record contains user-facing snapshot + canonical rule.
7. Verify analytics can group by both dimensions.
8. Verify empty state message for personal-space context/no cultures.

## Rollback
- Feature-gate reporting modal path (`USE_USER_FACING_REPORTING`).
- If issues arise:
  - disable gate -> revert to existing reporting UI.
  - keep schema/tables in place (non-breaking).

## Definition of Done
- User-facing reporting reasons are managed in admin.
- Visibility is derived by context via existing moderation chain.
- Reporting submit always persists canonical `rule_id`.
- UI supports fast reason-first reporting + optional drill-down.
- Observability and analytics support both user-facing and canonical dimensions.
