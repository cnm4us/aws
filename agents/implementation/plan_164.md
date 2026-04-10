# Plan 164: Global Moderation Signals Registry and Signal Linkage

Status: Active

## Feature Reference
- Feature doc: `agents/features/feature_17_moderation_signals_rules.md`

## Context
- Problem statement:
  - Signals are currently split across hardcoded culture enums, embedded culture definition arrays, and freeform rule `ai_spec` content, which creates naming drift and blocks consistent reuse across rules, cultures, and moderation-v2 measurement.
  - There is no global signals registry UI, no authoritative usage model for rules and cultures, and no safe admin workflow for evolving the moderation signal vocabulary over time.
  - The next stage of moderation work needs one reusable signal layer so measurement can reference canonical signal IDs, cultures can curate positive/disruptive signals from that registry, and future judgment mapping can build on stable identifiers.
- In scope:
  - Add a global moderation signals registry with canonical admin routes under `/admin/moderation/signals`.
  - Add persistence for global signals plus many-to-many rule and culture relationships.
  - Move cultures so positive/disruption signal membership is stored relationally and projected back into the editor/payload view.
  - Update rules so saved rule contracts reference global signal IDs directly instead of relying on ad hoc freeform signal strings.
  - Add migration/backfill paths from current culture arrays and current rule signal content into the new signal registry.
  - Keep moderation-v2 measurement/judgment compatibility intact while the signal model is normalized.
  - Add operator docs and smoke coverage for the new signals surface and linkage flows.
- Out of scope:
  - Full signal-to-dimension mapping UI or policy logic.
  - Reworking the full measurement/judgment pipeline beyond the compatibility needed to consume canonical signal IDs.
  - Rewriting historical moderation records to retrofit canonical signal IDs.
  - General rule or culture UX redesign outside the signal-linkage changes required by this feature.
- Constraints:
  - The app must remain runnable after each phase.
  - Signals are global moderation vocabulary, not culture-owned definitions.
  - Cultures must stop accepting arbitrary custom signal strings in v1.
  - Rule and culture signal references must not drift between storage layers.
  - Existing moderation-v2 smoke coverage should remain usable during the migration.

## Locked Decisions
- Signals are defined globally and reused by rules and cultures; they are not culture-owned definitions.
- Rules will reference global signal IDs directly in the saved rule contract.
- Cultures will store positive/disruption signal membership relationally; editor JSON and AI payloads will project those relationships back into array form.
- Signal hard deletion is not part of v1 for in-use records; admins should use status/deactivation/archive semantics instead of unsafe delete.
- Full signal-to-dimension mapping is deferred, but the schema and admin model must not block a future `signal_dimension_map` layer.

## Phase Status
- A: Pending
- B: Pending
- C: Pending
- D: Pending
- E: Pending
- F: Pending

## Phase A — Signal Domain and Persistence Foundation
- Goal:
  - Establish the global signal model, storage, and route/nav contract before touching rule and culture editors.
- Steps:
  - [ ] Add moderation signal route helpers/nav wiring for `/admin/moderation/signals` in `src/routes/pages.ts`.
  - [ ] Add `moderation_signals` storage with stable ID, label, descriptions, status, and future-safe metadata fields.
  - [ ] Add many-to-many join tables for `rule_signals`, `culture_positive_signals`, and `culture_disruption_signals` with FK/index/uniqueness rules.
  - [ ] Add repo/service helpers for signal CRUD, usage counts, and relationship reads/writes.
  - [ ] Add a baseline seed/backfill source for the current culture signal vocabulary and any known moderation-v2 signal IDs already used by rules/contracts.
- Test gate:
  - `npm run build`
  - Expected result: schema/bootstrap and signal repo code compile cleanly without changing admin behavior yet.
- Acceptance:
  - There is one authoritative persistence model for signals and their rule/culture relationships, and the moderation admin route contract has a clear home for signals.

## Phase B — Global Signals Registry Admin UI
- Goal:
  - Ship `/admin/moderation/signals` as the operator surface for managing the global signal vocabulary.
- Steps:
  - [ ] Add signal list, new, and detail/edit pages under `/admin/moderation/signals`.
  - [ ] Support search/filter by ID, label, and status.
  - [ ] Show usage indicators for rules, cultures, and reserved future mapping usage.
  - [ ] Support create/edit/deactivate/archive workflows with unsafe delete blocked for in-use signals.
  - [ ] Add linked-usage sections so admins can see which rules and cultures currently reference a signal.
- Test gate:
  - `npm run build`
  - Manual verify `/admin/moderation/signals`, create/edit/deactivate flows, and usage displays.
- Acceptance:
  - Operators can manage global signals from a dedicated moderation admin page without inventing ad hoc strings elsewhere.

## Phase C — Culture Signal Relationalization and Projection
- Goal:
  - Make culture signal membership relational while preserving the existing structured editor and AI payload shape.
- Steps:
  - [ ] Backfill current `positive_signals` and `disruption_signals` arrays from culture definitions into the new join tables.
  - [ ] Update culture load/save flows so signal relationships are read from and written to relational tables as the canonical source.
  - [ ] Project relational signals back into the culture editor and advanced JSON view so operators still see `positive_signals` and `disruption_signals` arrays in the rendered definition.
  - [ ] Replace culture signal inputs with registry-backed selection controls and reject arbitrary freeform signal IDs in v1.
  - [ ] Update culture AI payload generation so it derives signal arrays from the relational source rather than embedded stored arrays.
- Test gate:
  - `npm run build`
  - Manual verify `/admin/moderation/cultures/:id` editing, save/reload stability, and advanced JSON projection.
- Acceptance:
  - Culture signals are canonical in relational storage, while editor/payload consumers still receive the expected structured arrays.

## Phase D — Rule Signal Linkage and Saved Contract Migration
- Goal:
  - Add rule-to-signal linkage and make saved rule contracts reference canonical signal IDs directly.
- Steps:
  - [ ] Add registry-backed signal selection to the rule create/edit/version UI.
  - [ ] Persist rule-signal many-to-many relationships and surface them on both rule pages and signal usage pages.
  - [ ] Normalize saved rule contract content so rule AI specs store global signal IDs directly rather than relying on freeform signal strings.
  - [ ] Backfill existing rules/drafts/versions to canonical signal IDs where a deterministic mapping exists, and record/flag ambiguous unmapped cases for manual cleanup.
  - [ ] Ensure rule publish/version flows keep signal relationships and saved contract signal IDs in sync.
- Test gate:
  - `npm run build`
  - Manual verify rule create/edit/publish/new-version flows with signal linkage on canonical moderation routes.
- Acceptance:
  - Rules reference canonical signal IDs in saved contracts, and signal usage is queryable through explicit relationships rather than inferred text.

## Phase E — Moderation-v2 Compatibility and Audit Hardening
- Goal:
  - Keep the existing two-stage moderation pipeline coherent while it moves onto the canonical signal model.
- Steps:
  - [ ] Update moderation-v2 request builders/services to consume canonical rule signal IDs without regressing current measurement behavior.
  - [ ] Add validation/error handling for missing, inactive, or unmapped signal IDs so failures are explicit rather than silent.
  - [ ] Decide and implement how inactive-but-still-referenced signals behave in measurement/judgment inputs.
  - [ ] Extend evaluation/debug output where necessary so signal IDs remain auditable in replay/export flows.
- Test gate:
  - `npm run build`
  - `npm run moderation:v2:pipeline:smoke`
  - Expected result: moderation-v2 still completes successfully while consuming the canonical signal model.
- Acceptance:
  - The signal registry improves rule/culture consistency without breaking the current moderation-v2 pipeline or its audit/debug workflow.

## Phase F — Docs, Smoke Coverage, and Follow-up Hooks
- Goal:
  - Finish the rollout with docs, operator checklist coverage, and a clear future hook for signal-to-dimension mapping.
- Steps:
  - [ ] Update active docs and feature notes to treat the global signal registry as canonical.
  - [ ] Add a focused smoke/checklist for `/admin/moderation/signals` plus rule/culture linkage verification.
  - [ ] Document the migration/backfill path and operator expectations for inactive/archived signals.
  - [ ] Record the deferred follow-up for future `signal_dimension_map` work without implementing the full mapping system now.
- Test gate:
  - `npm run build`
  - `npm run check:agents:docs`
  - Manual verify docs/runbook coherence with the shipped admin flows.
- Acceptance:
  - The signal registry and its rule/culture relationships are documented, testable, and ready for later dimension-mapping work.

## Change Log
- 2026-04-10 — Plan drafted for global moderation signals: registry UI under `/admin/moderation/signals`, relational culture signal storage, rule contracts that reference canonical signal IDs directly, moderation-v2 compatibility work, and follow-on hooks for future signal-to-dimension mapping.

## Validation
- Environment:
  - development
- Commands run:
  - none (planning-only change)
- Evidence files:
  - `agents/features/feature_17_moderation_signals_rules.md`
  - `src/features/cultures/types.ts`
  - `src/features/cultures/payload.ts`
  - `src/routes/pages.ts`
  - `src/features/moderation-v2/types.ts`
  - `src/features/moderation-v2/service.ts`
- Known gaps:
  - Exact saved rule contract field shape for canonical signal IDs should be finalized in Phase A before UI and migration work starts.
  - Existing rule signal content may include freeform strings that do not map cleanly to one canonical signal ID; Phase D needs an explicit review path for ambiguous cases.

## Open Risks / Deferred
- Risk:
  - Dual representation for rules (saved contract IDs plus relational usage rows) can drift if save/publish flows are not kept strictly synchronized.
- Risk:
  - Culture editor advanced JSON projection may confuse operators if relationally derived signal arrays appear editable but are not canonical stored fields.
- Risk:
  - Backfilling old rules from freeform signal language to canonical IDs may surface ambiguous or lossy mappings that require manual cleanup.
- Deferred item:
  - Full `signal_dimension_map` storage, admin UI, and judgment-policy usage.
- Deferred item:
  - Rewriting historical moderation records to replace previously emitted freeform signal strings with canonical IDs.

## Resume Here
- Next action:
  - Start Phase A by defining the canonical signal storage model, seed/backfill approach, and `/admin/moderation/signals` route/nav contract.
- Blocking question (if any):
  - none
