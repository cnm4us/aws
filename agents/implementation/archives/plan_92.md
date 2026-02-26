# Plan 92 — Configurable Library Sources (Add Glenn Kirschner)

## 1. Overview
Goal: Add “Glenn Kirschner” as a selectable original source and make source options configurable from a single file, used by both backend validation and frontend dropdowns.

In scope:
- Central config file for allowed `source_org` values + labels.
- Backend validation uses config list.
- New API endpoint to expose the list for frontend.
- Update Library and Upload New dropdowns to use the API list (with fallback).
- Update admin video library filter options to use the config list.

Out of scope:
- Database schema changes (not needed; `uploads.source_org` already `VARCHAR(64)`).
- Search behavior changes.

## 2. Step-by-Step Plan

1. Add a single source-of-truth config for library sources
   Status: Completed
   Implementation:
   - Create `src/config/librarySources.ts` exporting a list like:
     - `{ value: 'cspan', label: 'CSPAN' }`
     - `{ value: 'glenn kirschner', label: 'Glenn Kirschner' }`
     - `{ value: 'other', label: 'Other' }`
   - Export helper(s) to fetch `values` and `labels`.
   Testing:
   - Canonical (expected): `node -e "const m=require('./dist/config/librarySources'); console.log(m.librarySources.length)"` → count > 0 (after build) OR inspect file locally.
   - Record actual output: `agents/implementation/tests/plan_92/step_01_config.md`.
   Checkpoint: Wait for developer approval before proceeding.

2. Backend: validate and expose sources
   Status: Completed
   Implementation:
   - Replace hard-coded `['cspan','other']` validation in `src/features/uploads/service.ts` with config list.
   - Add `GET /api/library/source-orgs` (auth-required) returning `{ items: [{ value, label }] }`.
   - Update admin video library filter select in `src/routes/pages.ts` to use config list.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /api/library/source-orgs` → `HTTP 200` with `items[]` and `glenn kirschner` present.
   - Record actual output: `agents/implementation/tests/plan_92/step_02_api.md`.
   Checkpoint: Wait for developer approval before proceeding.

3. Frontend: use configurable sources in dropdowns
   Status: Completed
   Implementation:
   - Update `frontend/src/app/Library.tsx` and `frontend/src/app/UploadNew.tsx` to fetch `/api/library/source-orgs` and populate the select; fallback to a local list if fetch fails.
   - Default selection to `cspan` if available.
   Testing:
   - Manual: `/library` filter shows “Glenn Kirschner”; `/uploads/new?kind=video&library=1` shows new option; selecting it filters as expected.
   - Record actual notes: `agents/implementation/tests/plan_92/step_03_ui.md`.
   Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes
- Step 1 — Status: Completed
- Step 2 — Status: Completed
- Step 3 — Status: Completed
