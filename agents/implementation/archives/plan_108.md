# Plan 108: Visualizer Starter Presets (Non-Delete + Reset + Clone)

## Goal
Ship a **Starter Preset** system for `/assets/visualizers` so every new member gets the same curated visualizer presets by default, while still being able to clone and customize.

## Product Decisions (Confirmed)
- Starter presets appear in every user account.
- Starter presets are **not deletable**.
- Starter presets are editable.
- Starter presets have **Reset** (restore to canonical starter config).
- User-created presets and clones:
  - are deletable,
  - have no Reset button.

## UX Proposal
- Split list into two sections:
  - `Starter Presets`
  - `My Presets`
- On each card:
  - Starter: `Edit`, `Clone`, `Reset`
  - My preset: `Edit`, `Clone`, `Delete`
- Add `Starter` badge to starter cards.
- Keep clone flow unchanged (`Clone` creates a user-owned editable/deletable copy).

## Scope
### In scope
- Data model for canonical starter templates + per-user starter copies.
- Auto-provision starter copies for users.
- Reset API and UI action.
- Delete guardrails.
- Visualizer list grouping and action visibility.

### Out of scope
- Versioned migration of existing user-customized starter copies.
- Cross-user sharing of custom presets.

## Data Model

### 1) New table: `visualizer_preset_templates`
Stores canonical starter presets (global).

Fields:
- `id` (PK)
- `template_key` (unique stable key, e.g. `starter_voice_clean_gold`)
- `name`
- `description`
- `bg_color`
- `instances_json`
- `created_at`, `updated_at`, `archived_at`

### 2) Extend user table `visualizer_presets`
Add metadata columns:
- `source_template_key VARCHAR(120) NULL`
- `is_starter TINYINT(1) NOT NULL DEFAULT 0`

Rules:
- Starter copy row: `is_starter=1`, `source_template_key=<template_key>`, `owner_user_id=<user>`
- User clone/new row: `is_starter=0`, `source_template_key=NULL`

### 3) Uniqueness
Add per-user uniqueness for starter copies:
- Unique index on `(owner_user_id, source_template_key)` where `source_template_key IS NOT NULL`

## Backend/API Changes

## A. Provisioning
Add idempotent function:
- `ensureStarterVisualizerPresetsForUser(userId)`

Behavior:
- Read active templates.
- For each template, upsert a user-owned starter copy if missing.
- Do not overwrite existing starter copies here.

Call points:
- On visualizer list endpoint.
- Optionally on user signup/login bootstrap.

## B. List endpoint
For `/api/visualizer-presets`:
- Ensure starter provisioning first.
- Return `isStarter` and `sourceTemplateKey` on each preset DTO.

## C. Delete endpoint
For `/api/visualizer-presets/:id DELETE`:
- If `is_starter=1`: reject with `409 cannot_delete_starter_preset`.

## D. Reset endpoint
New endpoint:
- `POST /api/visualizer-presets/:id/reset`

Behavior:
- Validate row belongs to user and `is_starter=1`.
- Load canonical template by `source_template_key`.
- Overwrite editable preset fields from template (`name`, `description`, `bg`, `instances_json`, legacy top-level mirrors).
- Preserve row identity (`id`, owner, metadata).

## E. Clone behavior
Existing clone/create logic should produce:
- `is_starter=0`, `source_template_key=NULL`

## Seed Strategy (Your existing 9 presets)
- Export your curated 9 presets into template JSON seed source.
- Add a one-time seed migration/script to populate `visualizer_preset_templates`.
- Assign stable `template_key` values for future reset compatibility.

## Frontend Changes (`frontend/src/app/VisualizerPresets.tsx`)
1. Extend type with `isStarter?: boolean`, `sourceTemplateKey?: string | null`.
2. Group list into Starter/My sections.
3. Action visibility:
   - Starter: hide Delete, show Reset.
   - My: show Delete, hide Reset.
4. Add Reset button handler:
   - `POST /api/visualizer-presets/:id/reset`
   - refresh list after success.
5. Preserve Edit/Clone behavior unchanged.

## Migration Plan

### Phase A — Schema + Types
- Add template table.
- Add starter metadata columns to `visualizer_presets`.
- Add indexes.
- Update backend DTO types.

### Phase B — Template Seeding
- Seed canonical 9 templates from curated data.
- Validate seed script is rerunnable/idempotent.

### Phase C — Provision + Guardrails
- Implement `ensureStarterVisualizerPresetsForUser`.
- Wire list endpoint provisioning.
- Implement delete guard.

### Phase D — Reset Endpoint
- Implement reset API + service logic.
- Ensure reset copies canonical template values exactly.

### Phase E — UI
- Group sections.
- Add Starter badge.
- Add Reset action.
- Hide Delete for starter presets.

## QA Checklist
- New user sees all 9 starter presets.
- Starter presets cannot be deleted (API + UI).
- Starter preset can be edited and saved.
- Reset restores starter to canonical values.
- Clone from starter creates deletable non-starter preset.
- New custom preset behaves as non-starter.
- Existing users get starters once (no duplicates).

## Risks / Tradeoffs
- If canonical template changes later, existing user starter copies won’t auto-update (by design).
- Need strict idempotency in provisioning to avoid duplicate rows.
- Reset should restore all effective fields, including legacy top-level mirrors, to avoid preview drift.

## Future Enhancements
- `Apply starter updates` admin task for untouched starter copies.
- `Reset all starters` user action.
- Starter template preview gallery metadata (tags/category).
