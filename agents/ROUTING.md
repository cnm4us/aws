# Routing Guide

Use this file to decide what to read for a given request. Keep this list flat and high-signal.

## Rules
- Read only what the request needs.
- Prefer one primary doc plus up to two secondary docs.
- `agents/implementation/plan_NN.md` is canonical for ongoing implementation continuity.
- If execution standards are unclear, read `agents/policies/implementation.md` and `agents/policies/testing.md`.

## Trigger Table

### 1. Commit or Git history change
- Read first: `agents/git.md`
- Also read: `agents/readme_maintenance.md`

### 2. New multi-step implementation plan
- Read first: `agents/implementation_planning.md`
- Also read: `agents/implementation/PLAN_TEMPLATE.md`, `agents/implementation/INDEX.md`

### 3. Continue existing implementation
- Read first: active `agents/implementation/plan_NN.md`
- Also read: `agents/implementation/INDEX.md`

### 4. DB schema change, bulk SQL, migration work
- Read first: `agents/db_access.md`
- Also read: active `agents/implementation/plan_NN.md`

### 5. Developer docs update in root `README.md`
- Read first: `agents/readme_maintenance.md`
- Also read: active `agents/implementation/plan_NN.md`

### 6. Debugging and instrumentation workflow
- Read first: `agents/tools/debugging.md`
- Also read: active `agents/implementation/plan_NN.md`

### 7. Feature/domain context lookup
- Read first: relevant `agents/features/feature_NN_slug.md`
- Also read: active `agents/implementation/plan_NN.md`, `agents/implementation/INDEX.md`

### 8. Cross-feature constraints or naming/compliance rules
- Read first: relevant `agents/requirements/*.md`
- Also read: active `agents/implementation/plan_NN.md`
