# Plan 165: Moderation Signal Classification Evolution

Status: Active

## Feature Reference
- Feature doc: `agents/features/feature_18_signals_evolution.md`

## Context
- Problem statement:
  - The current moderation signal registry successfully centralizes signals and keeps the admin UI grouped as positive vs disruptive, but that polarity split is still doing too much semantic work.
  - Very different disruptive signal types such as credibility problems, privacy/identity harms, aggression, and discourse-quality failures all sit in one flat disruptive bucket, which will make filtering, mapping, and future policy work harder.
  - The next stage of moderation architecture needs a stronger normalized classification layer while preserving the simple operator-facing positive/disruptive mental model.
- In scope:
  - Add required `polarity` and `signal_family` fields to the moderation signal model.
  - Backfill existing signals into the new classification model using the feature-provided mapping plus the approved temporary assignments for current measurement-oriented signals.
  - Update `/admin/moderation/signals` list/detail/new/edit flows so polarity is the top-level UI grouping and signal family is the normalized internal classification surfaced in forms, badges, and filtering.
  - Constrain signal-family choices by polarity in the admin UI and persistence layer.
  - Keep existing rule/culture signal relationships intact while the signal classification model evolves.
- Out of scope:
  - Signal-to-dimension mapping storage or UI.
  - Rule auto-classification from signal family.
  - Changes to moderation-v2 judgment logic beyond preserving compatibility with the new signal model.
  - User-facing moderation UI changes.
- Constraints:
  - The app must remain runnable after each phase.
  - Positive vs disruptive remains a UI grouping convenience, not the only semantic classification.
  - `polarity` and `signal_family` are required on all signals after rollout.
  - Existing signal IDs must not be silently broken by normalization work.
  - Existing rule/culture references must keep working during and after the migration.

## Locked Decisions
- `polarity` is required and limited to `positive` or `disruptive`.
- `signal_family` is required and uses a controlled vocabulary constrained by `polarity`.
- The admin UI should continue presenting top-level `Positive Signals` and `Disruptive Signals`, but filtering, organization, and future architecture should treat `signal_family` as the normalized internal classification.
- Existing measurement-oriented signals should use the approved temporary assignments until the signal catalog is curated further:
  - `qualified_language` -> `positive / clarity`
  - `assertive_language` -> `disruptive / credibility`
  - `direct_identifiers` -> `disruptive / privacy_identity`
  - `indirect_identifiers` -> `disruptive / privacy_identity`
  - `factual_assertion` -> `positive / reasoning`
- Signal-ID singularization is desirable where safe, but v1 should not silently rename IDs if that creates reference risk; ambiguous rename work should be deferred and documented instead of forced through.

## Controlled Vocabulary
- `polarity`
  - `positive`
  - `disruptive`
- `signal_family`
  - For `positive`
    - `clarity`
    - `engagement`
    - `reasoning`
    - `tone_positive`
  - For `disruptive`
    - `discourse_tone`
    - `discourse_quality`
    - `targeting`
    - `aggression`
    - `safety_harm`
    - `privacy_identity`
    - `sexual_exploitation`
    - `credibility`

## Phase Status
- A: Pending
- B: Pending
- C: Pending
- D: Pending
- E: Pending

## Phase A — Signal Classification Schema Foundation
- Goal:
  - Add the new required classification fields and controlled-vocabulary helpers before changing the UI.
- Steps:
  - [ ] Add required `polarity` and `signal_family` columns/fields to the moderation signal storage model.
  - [ ] Define controlled vocabulary constants/types/helpers for polarity and signal families in the moderation-signals feature module.
  - [ ] Enforce polarity/family validity in repo/service save paths, including family-by-polarity constraints.
  - [ ] Add normalization helpers so registry reads always expose the new fields in a consistent shape.
- Test gate:
  - `npm run build`
  - `node <<'EOF' ... ensureSchema(db) ... EOF`
- Acceptance:
  - Signals have a durable, validated classification model in code and storage, even before the admin UI is updated.

## Phase B — Backfill and Classification Migration
- Goal:
  - Populate the existing signal catalog with required polarity/family assignments without breaking references.
- Steps:
  - [ ] Backfill current seeded and operator-created signals using the feature-provided mapping.
  - [ ] Apply the approved temporary assignments for currently neutral/measurement-oriented signals (`factual_assertion`, `qualified_language`, `assertive_language`, `direct_identifiers`, `indirect_identifiers`).
  - [ ] Record ambiguous or unclassified signals explicitly if any existing rows do not match the planned mapping.
  - [ ] Review singularization candidates and document which IDs are deferred rather than renaming them silently.
- Test gate:
  - `npm run build`
  - Run a DB-backed verification script or query that confirms there are no signals missing `polarity` or `signal_family`.
- Acceptance:
  - The existing registry has complete polarity/family assignments, and no referenced signal is left without the new required classification.

## Phase C — Signals Admin UI Evolution
- Goal:
  - Update `/admin/moderation/signals` to expose the new classification model while preserving the simple top-level grouping.
- Steps:
  - [ ] Update the signals list page to keep top-level `Positive Signals` and `Disruptive Signals`.
  - [ ] Within each polarity grouping, surface `signal_family` via badge, column, or visual labeling.
  - [ ] Add signal-family filtering on the list page, constrained by polarity where helpful.
  - [ ] Update signal detail/new/edit forms so `polarity` is required and `signal_family` is required.
  - [ ] Constrain `signal_family` choices dynamically based on the selected polarity in the form.
  - [ ] Remove any leftover metadata-based role inference paths that are superseded by first-class polarity storage.
- Test gate:
  - `npm run build`
  - Manual verify `/admin/moderation/signals`, create/edit flows, polarity/family validation, and list-page grouping/filter behavior.
- Acceptance:
  - Operators still browse by positive vs disruptive, but the admin UI now clearly exposes the stronger internal classification structure.

## Phase D — Rule/Culture Compatibility and Classification Projection
- Goal:
  - Keep the current rule and culture linkage UX coherent while switching role grouping to first-class signal classification.
- Steps:
  - [ ] Update culture signal option loading to derive positive/disruptive grouping from persisted polarity rather than metadata heuristics.
  - [ ] Update rule signal grouping in create/edit/detail views to use persisted polarity.
  - [ ] Decide how mixed/unclassified fallback behavior should work once polarity is required everywhere; remove no-longer-needed fallback code when safe.
  - [ ] Ensure signal usage pages and linked-signal views continue to work correctly with the new fields.
- Test gate:
  - `npm run build`
  - Manual verify `/admin/moderation/cultures/:id`, `/admin/moderation/rules/:id/edit`, and rule detail pages for correct positive/disruptive grouping after the migration.
- Acceptance:
  - Rule and culture signal linkage remains stable, but the grouping logic is now backed by first-class signal classification rather than metadata inference.

## Phase E — Docs, Migration Notes, and Follow-up Hooks
- Goal:
  - Finish the classification rollout with clear operator guidance and explicit deferred work.
- Steps:
  - [ ] Update the active feature/ops docs to explain `polarity` vs `signal_family`.
  - [ ] Document the temporary family assignments for currently neutral/measurement-oriented signals.
  - [ ] Document the deferred signal-ID singularization follow-up for any aliases or rename candidates left in place.
  - [ ] Add a focused smoke/checklist for signal classification and admin filtering behavior.
- Test gate:
  - `npm run build`
  - `npm run check:agents:docs`
- Acceptance:
  - The signal-classification model is documented well enough for future curation, dimension mapping, and vocabulary cleanup work.

## Change Log
- 2026-04-11 — Plan drafted to evolve moderation signals from metadata-inferred positive/disruptive grouping to first-class required `polarity` + `signal_family` classification, while preserving the current top-level admin grouping and existing rule/culture references.

## Validation
- Environment:
  - development
- Commands run:
  - none yet
- Evidence files:
  - `agents/features/feature_18_signals_evolution.md`
  - `src/features/moderation-signals/types.ts`
  - `src/features/moderation-signals/repo.ts`
  - `src/features/moderation-signals/service.ts`
  - `src/routes/pages.ts`
  - `src/db.ts`
- Known gaps:
  - Existing plan 164 still carries a pending manual verification note for rule Phase D flows, but the follow-on classification work in this plan assumes the current committed registry/rule/culture linkage baseline as the new starting point.
  - A few signals currently behave more like neutral measurement vocabulary than clearly positive/disruptive behavior signals; this plan uses the approved temporary assignments and leaves deeper catalog curation for later.

## Open Risks / Deferred
- Risk:
  - Treating some measurement-oriented signals as temporarily positive/disruptive may feel semantically awkward until the signal catalog is curated further.
- Risk:
  - If metadata-inferred role logic and first-class polarity logic overlap for too long, the admin UI can drift or produce confusing edge cases.
- Risk:
  - Singularizing signal IDs too aggressively could break existing references in rules, cultures, or moderation-v2 contracts.
- Deferred item:
  - Signal-ID renames and alias-removal cleanup after the classification structure has stabilized.
- Deferred item:
  - Signal-to-dimension mapping storage and UI.

## Resume Here
- Next action:
  - Begin Phase A by adding required `polarity` and `signal_family` fields plus controlled-vocabulary validation in the moderation-signals storage and service layers.
- Blocking question (if any):
  - none
