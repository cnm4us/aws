# Plan 166: Retire Moderation Categories and Move Reporting Entry to User Groups

Status: Active

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - The current moderation/reporting stack still treats `rule_categories` and `culture_categories` as the reachability layer between cultures and canonical rules.
  - That category taxonomy no longer matches the intended product model, and the admin surface under `/admin/moderation/categories` should be retired.
- The current user-facing reporting layer already exists under `/admin/user-facing-rules`, but it sits outside the moderation admin IA and is still filtered through the old culture -> category -> rule chain.
- The next step is to rename that layer to `user_facing_groups`, move its admin surface under `/admin/moderation/user-groups`, let cultures configure the initial user groups shown in report UI, and add a deliberate “show all” path so users can still reach any user-group / user-rule in the moderation system.
- In scope:
  - Define canonical moderation-admin routes and navigation for `/admin/moderation/user-groups`.
  - Retire `/admin/moderation/categories` from the active moderation admin IA.
  - Move culture configuration away from category assignment and toward initial user-group assignment.
  - Replace the current category-based report-entry visibility logic with a user-group-based model that supports:
    - initial culture-curated groups
    - a “show all” escape hatch
    - drill-down into user-facing reasons and canonical rules
  - Update docs, smoke coverage, and migration notes for the new moderation IA and report-entry model.
- Out of scope:
- Full deletion of legacy category tables/columns from the database in the first pass unless the migration becomes trivial after rollout.
- Reworking moderation-v2 rule evaluation logic beyond the visibility/configuration changes required by this migration.
- Broader UX redesign of reporting flows beyond the new initial-group and show-all behavior.
- Constraints:
  - The app must remain runnable after each phase.
  - Legacy links and forms should keep working through redirects or compatibility routes during the transition.
  - Report submission must remain rule-authoritative even if the report UI entry model changes.
  - Culture edits must remain deterministic and auditable during the migration from categories to user groups.
  - We should prefer additive compatibility layers before removing legacy category-dependent logic.

## Locked Decisions
- `/admin/user-facing-rules` should move into moderation IA as canonical `/admin/moderation/user-groups`.
- `/admin/moderation/categories` is being retired from the active admin model.
- Cultures should configure which user groups are shown first when a user taps the report flag icon.
- Reporting UI must include a “show all” escape hatch so users can still navigate to any user-group / user-rule in the moderation system.
- Canonical moderation rules remain the authoritative submitted moderation object; the user-group layer is a reporting-entry and organization layer.
- `user_facing_rules` should be renamed to `user_facing_groups`; this is a new name for the same functional layer, not a new entity above it.
- The report UI should start with user groups only, with expandable drill-down into the reasons within those groups.
- `show all` should expose every active user group in the moderation system, not only the currently culture-curated subset.
- This plan should fully remove category ownership from canonical rules rather than leaving `rules.category_id` as a long-term compatibility dependency.
- Cultures should link to specific `user_facing_group` rows directly.
- `user_facing_group` should retain first-class `label` and `short_description`.
- `group_key` and `group_label` are not part of the target model and should be removed rather than carried forward.
- Rule admin should organize canonical rules by linked `user_facing_groups` instead of categories.
- A canonical rule may belong to multiple user-facing groups.
- Rules with no linked user-facing groups should surface explicitly as `Ungrouped` until fixed.
- `Show All` in the reporting UI should expand inline to reveal all active user-facing groups.

## Working Assumptions
- The migration should rename the current `user_facing_rules` storage/model to `user_facing_groups` rather than keeping the old internal names indefinitely.
- The target user-facing-group model is flatter than the current one: direct group rows with label/description/order/activity, not rule rows decorated with `group_key` / `group_label` metadata.
- Category retirement should still be staged for safety, but the target architecture is full removal of category ownership from rules and active reporting/configuration flows, not indefinite compatibility storage.

## Open Questions
- none

## Phase Status
- A: Complete
- B: Complete
- C: Pending
- D: Pending
- E: Pending
- F: Pending

## Phase A — Route and IA Foundation for User Groups
- Goal:
  - Establish the canonical moderation-admin home for user groups and isolate category retirement from the higher-risk reporting-model migration.
- Steps:
  - [ ] Add canonical moderation route helpers and nav wiring for `/admin/moderation/user-groups*`.
  - [ ] Move the current `/admin/user-facing-rules*` admin pages behind canonical moderation routes while keeping legacy redirects or compatibility routes.
  - [ ] Update the moderation hub and left navigation so `User Groups` is part of the moderation subsystem and `Categories` is no longer presented as an active surface.
  - [ ] Decide whether `/admin/moderation/categories` becomes an immediate redirect, a retirement notice page, or a temporary compatibility tombstone.
- Test gate:
  - `npm run build`
  - Manual verify `/admin`, `/admin/moderation`, `/admin/moderation/user-groups`, and legacy `/admin/user-facing-rules` redirects.
- Acceptance:
  - User groups have a canonical moderation-admin home, and categories are no longer presented as a primary moderation configuration surface.

## Phase B — Culture Configuration Migration from Categories to User Groups
- Goal:
  - Replace culture-owned category assignment with culture-owned initial user-group assignment.
- Steps:
  - [ ] Add relational storage for culture-to-user-group configuration.
  - [ ] Update the culture admin page so it configures “initially shown user groups” instead of categories.
  - [ ] Define and implement a backfill path from current culture/category assignments to initial user-group assignments.
  - [ ] Remove category-focused copy, controls, and validation from the culture editor while preserving compatibility for older rows during rollout.
  - [ ] Decide whether culture JSON / payload projection should expose the selected user-group IDs explicitly.
- Test gate:
  - `npm run build`
  - Manual verify `/admin/moderation/cultures/:id` save/reload behavior and migration/backfill behavior on an existing culture.
- Acceptance:
  - Cultures now control the initial reporting-entry user groups directly, without requiring category assignment in the active admin workflow.

## Phase C — Reporting Visibility Model Replacement
- Goal:
  - Replace the old culture -> category -> rule visibility chain with the new user-group-centric report-entry model.
- Steps:
  - [ ] Update reporting queries/services so “initially shown” reporting options derive from culture-linked user groups rather than culture-linked categories.
  - [ ] Design and implement the “show all” escape hatch behavior in the reporting options payload so it exposes every active user group in the moderation system.
  - [ ] Keep user-facing drill-down coherent: initial collapsed user groups -> expandable mapped canonical rules/reasons, with default-rule resolution still working where allowed.
  - [ ] Decide how to handle spaces or cultures with no configured initial user groups.
  - [ ] Ensure report submission still records canonical rule selection and captures user-group/user-facing metadata at submit time.
- Test gate:
  - `npm run build`
  - Add or update a focused reporting smoke/manual checklist covering initial groups, show-all expansion, and report submission.
- Acceptance:
  - The reporting entry flow no longer depends on categories for what users see first, while still giving users a path to all reportable moderation reasons/rules.

## Phase D — Category Retirement and Compatibility Cleanup
- Goal:
  - Remove active category dependence from moderation admin/reporting flows while keeping rollback and compatibility options explicit.
- Steps:
  - [ ] Audit remaining category-dependent queries and admin links in rules, reports, and moderation pages.
  - [ ] Convert `/admin/moderation/categories*` and legacy category flows into redirects or retirement notices once the replacement model is live.
  - [ ] Remove category ownership from canonical rules and migrate rule admin organization to linked `user_facing_groups`, including an explicit `Ungrouped` bucket for orphaned rules.
  - [ ] Identify which DB relations (`culture_categories`, `rule_categories`, `rules.category_id`) are deleted in this rollout versus retained only long enough to support transactional migration safety.
- Test gate:
  - `npm run build`
  - Manual verify there is no active operator workflow that still requires categories for moderation/reporting setup.
- Acceptance:
  - Categories are retired from active moderation operations, and any remaining category artifacts are explicitly compatibility-only rather than silently authoritative.

## Phase E — User-Group Admin Terminology and Export / API Alignment
- Goal:
  - Make the admin, API, and storage surface coherent around the renamed `user_facing_groups` model without unnecessary drift.
- Steps:
  - [ ] Decide which layers should be renamed now versus later:
    - route/UI labels
    - API paths
    - service/repo module names
    - DB table names
  - [ ] Update admin page language from “User-Facing Rules” / “Reporting Reasons” to the approved user-group terminology.
  - [ ] Rename the underlying storage/API/service shapes from `user_facing_rules*` to `user_facing_groups*`, including compatibility shims where needed.
  - [ ] Remove `group_key` / `group_label` from the active model and UI, replacing them with direct user-group rows plus ordering fields.
  - [ ] Align JSON export/admin diagnostics so user-group data is inspectable under the new IA.
- Test gate:
  - `npm run build`
  - Manual verify `/admin/moderation/user-groups` terminology, exports, and linked rule visibility.
- Acceptance:
  - Operators can reason about the system using consistent user-group language, even if some internal storage names remain legacy for safety.

## Phase F — Docs, Smoke Coverage, and Deletion Follow-up
- Goal:
  - Finish the migration with explicit operator guidance and a clear path for any deeper storage cleanup.
- Steps:
  - [ ] Update active docs and moderation IA docs to treat `/admin/moderation/user-groups` as canonical and categories as retired.
  - [ ] Add a focused smoke/checklist for culture-linked initial user groups, show-all behavior, and legacy-route redirects.
  - [ ] Document any remaining legacy category storage/columns as deferred cleanup work rather than active architecture.
  - [ ] Record the follow-up decision point for full category table/column deletion once the new reporting model is stable in production.
- Test gate:
  - `npm run build`
  - `npm run check:agents:docs`
- Acceptance:
  - The migration is documented, testable, and explicit about what is already retired versus what remains as temporary compatibility storage.

## Change Log
- 2026-04-12 — Plan drafted to retire moderation categories from the active admin/report-entry model, move user-facing reporting management into canonical `/admin/moderation/user-groups` routes, let cultures configure initial report-entry user groups, and add a show-all escape hatch so users can still reach any moderation user-group / user-rule.
- 2026-04-12 — Locked product decisions: “user group” is the promoted name for the existing user-facing-rule layer, report UI starts with expandable user groups, `show all` exposes every active user group, and canonical rules should fully lose category ownership during this migration.
- 2026-04-12 — Clarified data model: `user_facing_rules` should become `user_facing_groups`, cultures link directly to specific user-facing-group rows, and the old `group_key` / `group_label` fields should be removed rather than preserved.
- 2026-04-12 — Locked rule-admin organization: canonical rules should be organized by linked user-facing groups rather than categories, with an explicit `Ungrouped` bucket for rules that have not been linked yet.
- 2026-04-12 — Locked reporting interaction: `Show All` should expand inline and reveal all active user-facing groups rather than switching to a separate browsing state.
- 2026-04-12 — Phase A completed: added canonical `/admin/moderation/user-groups*` route wiring, moved the current user-facing-rules admin pages under moderation-local navigation, converted legacy `/admin/user-facing-rules` GET pages to compatibility redirects, removed categories from the active moderation hub/subnav, and removed the standalone top-level admin nav entry for user-facing rules. Manual verification of `/admin`, `/admin/moderation`, `/admin/moderation/user-groups`, and the legacy redirect paths passed.
- 2026-04-12 — Phase B completed: added `culture_user_facing_groups` persistence, lazy backfill from legacy culture/category reachability into initial user-group linkage, switched the culture list/detail/update flows to use initial user groups instead of categories, and updated culture delete behavior to clear compatibility joins before deleting. Manual verification of `/admin/moderation/cultures` and culture save/reload/backfill behavior passed.

## Validation
- Environment:
  - development
- Commands run:
  - `rg -n "user-facing-rules|user_facing_rules|groupKey|groupLabel|culture_categories|rule_categories" src agents`
  - `sed -n '1,240p' agents/features/feature_14_moderation_updates.md`
  - `sed -n '1,260p' src/features/user-facing-rules/service.ts`
  - `sed -n '1,260p' src/features/user-facing-rules/repo.ts`
  - `sed -n '1,260p' src/features/reports/service.ts`
  - `sed -n '120,380p' src/features/reports/repo.ts`
  - `sed -n '10280,10490p' src/routes/pages.ts`
  - `npm run build`
  - `npm run build` (after Phase B culture linkage changes)
- Evidence files:
  - `agents/features/feature_14_moderation_updates.md`
  - `src/features/user-facing-rules/service.ts`
  - `src/features/user-facing-rules/repo.ts`
  - `src/features/reports/service.ts`
  - `src/features/reports/repo.ts`
  - `src/routes/pages.ts`
- Known gaps:
  - none beyond normal implementation detail.

## Open Risks / Deferred
- Risk:
  - Replacing category reachability with “initial groups + show all” changes reporting semantics; if not defined carefully, it can widen or narrow what users can report in unexpected ways.
- Risk:
  - Removing categories from culture config before report-query migration is complete can create hidden reachability drift.
- Risk:
  - Full deletion of category tables/columns in the same rollout raises migration complexity and rollback risk, so the rollout needs explicit cutover and safety checks.
- Deferred item:
  - Compatibility redirects or adapter code while old `/admin/user-facing-rules*` paths and `user_facing_rules*` references are phased out.

## Resume Here
- Next action:
  - Start Phase C: replace the report-entry visibility model so initial reporting options derive from culture-linked user groups and `Show All` expands every active user group.
- Blocking question (if any):
  - none
