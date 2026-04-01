# Plan 152: Admin Journey Inspector

Status: Draft

## Context
- Journey lifecycle is now run-scoped and largely deterministic.
- Debugging still requires jumping between Jaeger, ad-hoc SQL, analytics pages, and dev tools.
- We need a dedicated, read-only admin inspector to quickly answer:
  - Which run is active/completed for this identity?
  - Why did it stop?
  - What step states exist for this run?

## Goals
- Add `/admin/journey-inspector` as a focused diagnostics page.
- Support lookup by authenticated identity and anonymous identity.
- Show journey instances and run-scoped step progress with minimal friction.
- Keep this page read-only; operational actions remain in `/admin/dev-tools`.

## Non-Goals
- No journey mutation actions from inspector.
- No broad analytics aggregation dashboard replacement.
- No cross-surface replay/simulation in this phase.

## Functional Requirements

### Inputs
- `user_email` (optional)
- `user_id` (optional)
- `anon_key` (optional)
- `journey_key` (optional)
- `journey_id` (optional)
- Optional `limit` (default 50)

### Resolution Rules
1. If `user_email` present, resolve to `user_id`.
2. If both user and anon inputs are present, show both result sets (separate sections).
3. If no identity input, return empty state with usage hint.
4. `journey_key` resolves to `journey_id` when possible; if both provided and mismatch, show validation error.

### Outputs
1. **Journey Instances table** (newest first)
- `instance_id`
- `journey_id`, `journey_key`, `journey_name`
- `identity_type`, `identity_key`
- `state`, `current_step_id`
- `completed_reason`, `completed_event_key`
- `first_seen_at`, `last_seen_at`, `completed_at`
- `metadata_json` preview + expand

2. **Step Progress table** (scoped to selected instance)
- `journey_instance_id`
- `step_id`, `step_key`, `step_order`
- `message_id`
- `state`
- `completed_at`
- `updated_at`

3. **Computed Summary panel**
- active vs terminal
- current step
- terminal reason/event (if terminal)
- last seen and completion timestamps

## Data/Query Notes
- Primary source: `feed_message_journey_instances`
- Progress source: run-scoped progress (join both user/anon progress paths as needed, filtered by `journey_instance_id` where available).
- Join to:
  - `feed_message_journeys` for key/name/status/surface
  - `feed_message_journey_steps` for step metadata
  - `feed_messages` for message id/title (optional enhancement)
- Ensure indexes used:
  - `identity_type, identity_key, state, updated_at`
  - `journey_id, state, updated_at`
  - progress lookup by `journey_instance_id`

## Phases

## Phase A — Read Path + Route
- Add service/repo read functions for:
  - identity resolution
  - instance lookup
  - run-scoped progress lookup
- Add page route:
  - `GET /admin/journey-inspector`
- Add nav link in admin sidebar.

### Acceptance
- Page loads and returns consistent results for known user/anon identities.

## Phase B — UI (Read-Only Inspector)
- Build page sections:
  - filter form
  - summary panel
  - instances table
  - step-progress table
- Add compact JSON preview with expand/collapse.
- Add clear empty-state and validation error messages.

### Acceptance
- Admin can inspect run lifecycle without SQL for standard debug cases.

## Phase C — Observability Cross-Links
- Add convenience links:
  - to `/admin/message-journeys/:id`
  - to `/admin/messages/:id`
  - optional link helper text for Jaeger query tags (`app.journey_instance_id=...`)
- Include quick “copy keys” affordance for `journey_key`, `anon_key`, `instance_id`.

### Acceptance
- Inspector supports fast pivot between admin UIs and traces.

## Phase D — Smoke Matrix + Docs
- Add smoke checklist:
  - anon start -> auth merge -> terminal completion
  - cooldown re-entry creates new run
  - instance and progress tables reflect expected transitions
- Update docs:
  - `docs/OBSERVABILITY.md` (journey inspector usage)
  - `docs/DEBUG.md` or admin debug section

### Acceptance
- Single-page inspector can validate lifecycle transitions used in Plan 151 smoke.

## Risks
1. Mixed legacy/new progress rows in old environments.
- Mitigation: prefer run-scoped rows; show fallback marker when inferred.

2. Large metadata blobs harming table readability.
- Mitigation: preview/truncate with explicit expand.

3. Ambiguous identity lookup (email not found, stale anon key).
- Mitigation: explicit validation messages and no-op empty result states.

## Open Decisions
1. Should this page allow exporting rows to CSV? (default: no, defer)
2. Should inspector include direct reset buttons? (default: no; keep actions in `/admin/dev-tools`)
3. Should we auto-load latest instance when only journey key is provided? (default: yes, but only after identity resolved)

## Definition of Done
- `/admin/journey-inspector` exists, read-only, and usable for both user and anon identities.
- Run-level instance and step state are visible in one page.
- Common lifecycle debugging no longer requires ad-hoc SQL.
