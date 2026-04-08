# Plan 161: Schema-Constrained Culture Definition Editor (JSON v1)

Status: Active

## Feature Reference
- Feature doc: `agents/features/feature_15_json_for_moderation.md`

## Context
- Problem statement:
  - `/admin/cultures/:id` currently stores free-text `description`.
  - Moderation AI needs deterministic, structured culture context rather than prose.
  - We need a constrained JSON culture definition as canonical source for AI payloads.
- In scope:
  - Add canonical culture JSON storage for Culture Definition Schema v1.
  - Add server-side schema validation + normalization.
  - Replace free-text culture description editing with structured UI sections/cards.
  - Add optional advanced raw JSON mode (not primary UX).
  - Add slim AI payload mapper derived from canonical culture JSON.
- Out of scope:
  - Rewriting broader moderation inbox/workflow.
  - Rule schema redesign.
  - AI prompt redesign beyond adding culture payload field.
  - Multi-schema version migration tooling beyond v1 bootstrap.
- Constraints:
  - Primary edit UX must be form/card-based (not raw JSON textarea).
  - Schema validation required client + server.
  - Stored object must be constrained by explicit JSON Schema v1.
  - System is still development-only; no production compatibility constraint.

## Locked Decisions
- Canonical field:
  - Add `cultures.definition_json` (JSON) as canonical culture definition object.
- Existing field behavior:
  - Keep legacy `cultures.description` temporarily, but no longer use it as AI source.
- Schema authority:
  - Culture Definition Schema v1 from feature doc is the validation baseline.
- Edit UX:
  - Structured cards/fields are default editor.
  - Raw JSON editor is advanced mode only.
- Guardrails:
  - No arbitrary keys/properties beyond schema (`additionalProperties: false`).
  - Arrays/enums constrained to approved values only.
- AI payload:
  - Generated via explicit mapper, not pass-through.
  - Include only: `id`, `name`, `version`, `interaction_style`, `tone_expectations`, `disruption_signals`, `tolerance`, optional `ai_hint`.

## Phase Status
- A: Completed
- B: Completed
- C: Pending
- D: Pending
- E: Pending
- F: Pending

## Phase A — Schema + Domain Contract
- Goal:
  - Introduce culture definition schema contract in backend domain layer.
- Steps:
  - [x] Add `src/features/cultures/schema-v1.ts` (or equivalent) with JSON Schema v1.
  - [x] Add domain types for canonical object + slim AI payload shape.
  - [x] Add normalize helpers:
    - trim strings
    - null/empty handling
    - dedupe arrays
    - deterministic ordering (optional but recommended)
  - [x] Add AJV validator wrapper with normalized error output for UI.
  - [x] Decide and encode field ownership policy:
    - `id` sync from culture slug/key
    - `name` sync from culture name
    - `version` explicit (`v1` default)
- Test gate:
  - `npm run build`
  - unit-style validation checks via a local script or service tests:
    - valid baseline object passes
    - unknown key fails
    - invalid enum fails
    - `end < start` not applicable here (ensure no irrelevant constraints introduced)
- Acceptance:
  - Backend can validate/normalize Culture Definition v1 deterministically.

## Phase B — Database + Repository Wiring
- Goal:
  - Persist/retrieve canonical culture definition JSON.
- Steps:
  - [x] Add DB column to `cultures`:
    - `definition_json` JSON NULL (or LONGTEXT + JSON_VALID in MySQL mode if needed).
  - [x] Extend culture queries/repo methods to read/write `definition_json`.
  - [x] On culture read, provide normalized object to routes/service.
  - [x] On culture write, validate + normalize before persistence.
  - [x] Add bootstrap fallback behavior for old rows:
    - if `definition_json` null, build default v1 object from culture metadata.
- Test gate:
  - `npm run build`
  - DB sanity:
    - create culture with valid definition
    - update culture with invalid definition rejected
    - legacy row (null definition) receives default on first save
- Acceptance:
  - Canonical culture JSON persists safely and is retrievable end-to-end.

## Phase C — Structured Admin Editor (Primary UX)
- Goal:
  - Replace free-text description editing with schema-constrained cards/sections.
- Steps:
  - [ ] Refactor `/admin/cultures/:id` form renderer in `src/routes/pages.ts`:
    - remove primary free-text description editor
    - render sections:
      - Metadata (`id`, `name`, `version`, optional `summary`)
      - Interaction style
      - Tone expectations (multi-select)
      - Disruption signals (multi-select)
      - Tolerance object (enum selects)
      - AI hint
      - Internal notes
  - [ ] Enforce pick-list controls for enum arrays (no arbitrary values).
  - [ ] Keep categories assignment block unchanged in this phase.
  - [ ] Post handler parses structured form into object and validates via Phase A validator.
  - [ ] Return field-level error hints in admin page for invalid input.
- Test gate:
  - `npm run build`
  - Manual admin smoke:
    - create/update valid object
    - invalid enum blocked with visible error
    - unknown key cannot be produced from UI
- Acceptance:
  - Admin can edit Culture Definition v1 without touching raw JSON.

## Phase D — Advanced JSON Inspector Mode
- Goal:
  - Provide optional raw JSON view/edit for power users without making it primary path.
- Steps:
  - [ ] Add collapsible "Advanced JSON" card to `/admin/cultures/:id`.
  - [ ] Show current canonical JSON pretty-printed.
  - [ ] Add optional raw edit textarea + `Validate JSON` and `Apply` actions.
  - [ ] Guard advanced editing with `site_admin` check (read-only otherwise).
  - [ ] Reuse same validator/error formatter as structured editor.
- Test gate:
  - `npm run build`
  - Manual checks:
    - valid raw edit applies
    - invalid raw edit rejected with schema errors
    - non-admin cannot mutate through advanced mode
- Acceptance:
  - Advanced mode exists, safe, and does not bypass schema constraints.

## Phase E — AI Payload Builder + Integration Hooks
- Goal:
  - Generate deterministic slim payload for moderation assessments.
- Steps:
  - [ ] Add mapper: `cultureDefinition -> aiCulturePayload`.
  - [ ] Exclude non-AI fields (`summary`, `internal_notes`) from payload.
  - [ ] Add lightweight trace/debug tags for payload metadata:
    - culture id/name/version
    - schema version
  - [ ] Wire payload builder to moderation-assessment path(s) without changing decision logic.
- Test gate:
  - `npm run build`
  - Smoke path where moderation request logs include mapped payload metadata.
- Acceptance:
  - Moderation path consumes slim structured culture payload from canonical JSON.

## Phase F — Migration Cleanup + Docs
- Goal:
  - Stabilize rollout and document operational model.
- Steps:
  - [ ] Add one-time backfill script for existing cultures:
    - derive minimal v1 objects
    - allow manual admin refinement afterward
  - [ ] Add dev/admin checklist for culture validation failures and repair flow.
  - [ ] Document schema contract and payload contract in docs.
  - [ ] Decide deprecation path for legacy `cultures.description` (keep/read-only/remove).
- Test gate:
  - `npm run build`
  - backfill dry-run + apply in dev DB
  - manual verify `/admin/cultures` and `/admin/cultures/:id` remain stable
- Acceptance:
  - Existing data is migrated; editor + payload path documented and stable.

## Change Log
- 2026-04-08:
  - Added new `src/features/cultures/` module for Culture Definition v1 domain contract:
    - `types.ts` (schema enums/unions, canonical object type, AI payload type, validation result types)
    - `schema-v1.ts` (JSON Schema v1 baseline)
    - `normalize.ts` (metadata policy + normalization helpers)
    - `validator.ts` (AJV 2020 validator wrapper + normalized validation errors)
    - `payload.ts` (slim AI payload mapper)
    - `defaults.ts` (default object generator for bootstrap/backfill)
    - `index.ts` (exports)
  - Added AJV dependency (`ajv`) and a Phase A smoke script:
    - `scripts/culture-definition-v1-smoke.ts`
    - `package.json` script: `cultures:smoke:v1`
  - Locked metadata ownership policy in code:
    - `id` derived/synced from culture key (fallback to name)
    - `name` synced from culture name when provided
    - `version` defaults to `v1` unless valid explicit value present
- 2026-04-08:
  - Completed Phase B persistence wiring:
    - Added `cultures.definition_json` to schema bootstrap + idempotent ALTER in `src/db.ts`.
    - Added `src/features/cultures/repo.ts` with:
      - culture row read (`getCultureById`)
      - normalized + validated hydration (`getCultureWithDefinition`)
      - create/save methods enforcing validator contract (`createCulture`, `saveCulture`)
      - default bootstrap fallback when stored `definition_json` is null or invalid.
    - Explicit write path now rejects invalid provided `definition_json` payloads.
  - Added DB-integrated smoke script:
    - `scripts/culture-definition-v1-db-smoke.ts`
    - npm script: `cultures:smoke:v1:db`

## Validation
- Environment: development
- Commands run:
  - `npm run cultures:smoke:v1`
  - `npm run cultures:smoke:v1:db`
  - `npm run build`
- Evidence files:
  - `agents/features/feature_15_json_for_moderation.md`
  - `src/features/cultures/types.ts`
  - `src/features/cultures/schema-v1.ts`
  - `src/features/cultures/normalize.ts`
  - `src/features/cultures/validator.ts`
  - `src/features/cultures/payload.ts`
  - `src/features/cultures/defaults.ts`
  - `src/features/cultures/repo.ts`
  - `scripts/culture-definition-v1-smoke.ts`
  - `scripts/culture-definition-v1-db-smoke.ts`
- Known gaps:
  - `cultureKey` currently assumes caller-provided key; DB-level culture key/slug field not yet introduced.

## Open Risks / Deferred
- Risk:
  - Divergence between top-level culture fields and JSON metadata if sync policy is unclear.
- Risk:
  - Schema v2 introduction without versioned migration path.
- Deferred:
  - Per-culture version history/diff viewer.
  - Auto-generated migration assistant for schema upgrades.

## Resume Here
- Next action:
  - Start Phase C.
- Blocking question (if any):
  - none
