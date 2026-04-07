# Plan 158: Reporting Inbox + Triage Architecture

Status: Phase A Complete (2026-04-06) · Phase B Complete · Phase C In Progress · Phase D In Progress

## Goal
Build a reporting system that supports:
1. Site-admin/global-moderator visibility across all complaints.
2. Site-admin action handling for global-rule violations.
3. Visibility into how group/channel teams handle local culture complaints.
4. Later extension to scoped moderator workspaces without reworking ingestion.

## Current State Inventory (Verified)
- User reporting intake exists and is live:
  - UI: `frontend/src/app/ReportModal.tsx`
  - Endpoints: `GET /api/publications/:id/reporting/options`, `POST /api/publications/:id/report`
  - Persistence: `space_publication_reports`
- User-facing reason mapping exists:
  - Admin UI + APIs for `user_facing_rules` and mappings
  - Snapshot fields persisted at submit time (`user_facing_*_at_submit`)
- Feed already tracks `reported_by_me` from report rows.
- Existing moderation UIs are for **publication approval queue**, not report triage:
  - `SpaceModeration` + `/api/admin/moderation/groups|channels`
- Missing today:
  - Dedicated report inbox/triage UI
  - Report lifecycle state and assignment
  - Action timeline tied to each report
  - Site-admin view of local moderator handling quality/SLA

## Investigation Order (Recommended)
1. **Data-path audit first**: validate report ingestion fields and joins (`space_publication_reports`, rules, spaces, publications, users).
2. **Moderation-action model audit**: decide reuse vs new report-action table (evaluate `moderation_actions` fitness).
3. **Permissions matrix**: define site-admin/global-moderator vs group/channel admin/moderator capabilities.
4. **Inbox query design**: define list filters/sorts and required indexes before UI.
5. **Lifecycle contract**: define statuses, transitions, assignment semantics, and resolution codes.
6. **Admin UI flows**: build site-wide inbox + detail first.
7. **Scoped UI flows**: add group/channel focused inboxes after global inbox is stable.

This order minimizes rework: schema + query + permissions are locked before UI.

## Product Decisions (Locked)
- Site-admin/global moderation inbox ships first.
- Group/channel moderator reporting views ship second.
- User report submission remains unchanged (fast submit + drill-down).
- Snapshot fields remain immutable once report is created.
- Backward compatibility shims are not required for this environment.

## Phase A Output (Locked 2026-04-06)

## Discovery Findings
- Intake path is stable and already production-shaped:
  - `ReportModal` -> `GET /api/publications/:id/reporting/options`
  - `ReportModal` -> `POST /api/publications/:id/report`
  - Persisted in `space_publication_reports` with immutable reason snapshots.
- Existing moderation pages are approval-queue focused, not report-triage focused.
- `moderation_actions` exists, but is a mixed action log for broad moderation concerns; it is not a clean per-report timeline.

## Contract Decisions
1. Unit of triage in V1 is **one report row**, not aggregated case objects.
2. Global triage authority in V1:
   - Site admin (`PERM.VIDEO_DELETE_ANY`) always.
   - Users with global moderation permissions:
     - `PERM.FEED_MODERATE_GLOBAL`
     - `PERM.FEED_PUBLISH_GLOBAL`
3. Space-local triage authority in V1:
   - Space admins/moderators for their own space.
4. SLA fields are deferred to V2.
5. Compatibility migration shims are not required (dev-only environment).

## Permissions Matrix (V1)
| Actor | Scope Visibility | Can Assign | Can Resolve/Dismiss | Can Reopen |
|---|---|---|---|---|
| Site Admin / Global Moderator | All reports | Yes | Yes | Yes |
| Space Admin/Moderator | Own `space_id` reports only | Optional (self/space users only) | Yes (own space only) | Yes (own space only) |
| Regular User | None | No | No | No |

## Lifecycle Contract (V1)
- Statuses: `open`, `in_review`, `resolved`, `dismissed`.
- Allowed transitions:
  - `open` -> `in_review|resolved|dismissed`
  - `in_review` -> `open|resolved|dismissed`
  - `resolved` -> `open` (reopen)
  - `dismissed` -> `open` (reopen)
- Assignment is orthogonal to status.
- Every status/assignment mutation must append immutable action rows.

## Rule Scope Contract (V1)
- Add `rule_scope_at_submit` to each report row:
  - `global` when report target space is Global Feed channel (`spaces.slug='global-feed'`).
  - `space_culture` for all other spaces.
  - `unknown` fallback only if classification is unavailable.
- This is operational routing scope; canonical `rule_id` remains unchanged.

## ERD (V1 Target)
```text
users (reporter, assignee, resolver)
  |
  | 1:N (reporter_user_id / assigned_to_user_id / resolved_by_user_id)
  v
space_publication_reports
  - immutable submit snapshot fields
  - lifecycle fields (status, assignment, resolution)
  - rule_scope_at_submit
  |
  | 1:N (report_id)
  v
space_publication_report_actions
  - immutable timeline of triage actions

space_publication_reports -> space_publications (space_publication_id)
space_publication_reports -> spaces (space_id)
space_publication_reports -> rules (rule_id)
space_publication_reports -> rule_versions (rule_version_id)
```

## API Contract (V1)

## Admin (Global) APIs
- `GET /api/admin/reports`
  - Query: `status?`, `scope?`, `space_id?`, `rule_id?`, `reporter_user_id?`, `assigned_to_user_id?`, `from?`, `to?`, `limit?`, `cursor?`, `sort?`
  - Returns: paged rows with summary fields and cursor.
- `GET /api/admin/reports/:id`
  - Returns: report row + joined context + action timeline.
- `POST /api/admin/reports/:id/assign`
  - Body: `{ assigned_to_user_id: number | null, note?: string }`
  - Effect: update assignment + append action.
- `POST /api/admin/reports/:id/status`
  - Body: `{ status: 'open' | 'in_review' | 'resolved' | 'dismissed', note?: string }`
  - Effect: validated transition + append action.
- `POST /api/admin/reports/:id/resolve`
  - Body: `{ resolution_code: string, resolution_note?: string }`
  - Effect: sets `resolved` + metadata + append action.
- `POST /api/admin/reports/:id/dismiss`
  - Body: `{ resolution_code?: string, resolution_note?: string }`
  - Effect: sets `dismissed` + metadata + append action.

## Space-Scoped APIs
- `GET /api/space/moderation/reports?space_id=...`
- `GET /api/space/moderation/reports/:id`
- `POST /api/space/moderation/reports/:id/status`
- `POST /api/space/moderation/reports/:id/resolve`
- Same response model as admin, but role-scoped to the requested space.

## Data Model Proposal

## Keep (No change)
- `space_publication_reports` remains the immutable submission record.

## Additions (Phase B)
1. `space_publication_reports` lifecycle columns:
- `status` ENUM('open','in_review','resolved','dismissed') NOT NULL DEFAULT 'open'
- `assigned_to_user_id` BIGINT UNSIGNED NULL
- `last_action_at` DATETIME NULL
- `resolved_by_user_id` BIGINT UNSIGNED NULL
- `resolved_at` DATETIME NULL
- `resolution_code` VARCHAR(64) NULL
- `resolution_note` VARCHAR(500) NULL
- `rule_scope_at_submit` ENUM('global','space_culture','unknown') NOT NULL DEFAULT 'unknown'

2. `space_publication_report_actions` (immutable timeline):
- `id` BIGINT PK
- `report_id` BIGINT UNSIGNED NOT NULL
- `actor_user_id` BIGINT UNSIGNED NOT NULL
- `action_type` VARCHAR(64) NOT NULL
- `from_status` VARCHAR(32) NULL
- `to_status` VARCHAR(32) NULL
- `note` VARCHAR(500) NULL
- `detail_json` JSON NULL
- `created_at`, `updated_at`
- Indexes:
  - `(report_id, created_at, id)`
  - `(actor_user_id, created_at, id)`
  - `(action_type, created_at, id)`

3. Indexes for inbox performance:
- `space_publication_reports(status, last_action_at, id)`
- `space_publication_reports(rule_scope_at_submit, status, created_at, id)`
- `space_publication_reports(space_id, status, created_at, id)`
- `space_publication_reports(rule_id, created_at, id)`

## API Surface

## Site Admin APIs (Phase C)
- `GET /api/admin/reports`
  - Filters: `status`, `scope`, `space_id`, `rule_id`, `reporter_user_id`, date range
  - Sort: `created_at|last_action_at|resolved_at`
- `GET /api/admin/reports/:id`
  - Full context: report, publication, space, rule, reporter, assignment, action timeline
- `POST /api/admin/reports/:id/assign`
- `POST /api/admin/reports/:id/status`
- `POST /api/admin/reports/:id/resolve`
- `POST /api/admin/reports/:id/dismiss`
- All mutating endpoints append `space_publication_report_actions` rows.

## Space-Scoped APIs (Phase D)
- `GET /api/space/moderation/reports?space_id=...`
- `GET /api/space/moderation/reports/:id`
- `POST /api/space/moderation/reports/:id/status`
- `POST /api/space/moderation/reports/:id/resolve`
- Authorization constrained to moderators/admins of that specific space.

## UI Plan

## Phase C — Site Admin Inbox
- New page: `/admin/reports`
- Views:
  - Open/In review/Resolved/Dismissed tabs
  - Filters (scope, space, rule, assignee, date)
  - Row summary with publication link, reporter, reason snapshot, status, assignee, age
- Detail drawer/page:
  - Full report payload
  - Evidence panel (fast context review):
    - target quick-open link
    - space quick-open link
    - publication/owner identifiers
    - created/published timestamps
    - optional API JSON quick-open for exact payload
  - Publication preview link
  - Rule and reason snapshot
  - Action timeline
  - Assignment and status controls

## Phase D — Group/Channel Reporting Views
- New pages:
  - `/space/moderation/reports`
  - `/admin/moderation/groups/:id/reports` (optional alias)
  - `/admin/moderation/channels/:id/reports` (optional alias)
- Same core list/detail model, but filtered to `space_id` and role-scoped actions.
- Site-admin pages can always see these reports and all actions.

## Observability + Analytics (Phase E)
- Jaeger tags on ingest + triage actions:
  - `app.report_id`
  - `app.report_status`
  - `app.report_scope`
  - `app.report_space_id`
  - `app.report_rule_id`
  - `app.report_action_type`
- Admin analytics slices:
  - Open volume by scope/space
  - Mean time to first action
  - Mean time to resolution
  - Resolution code distribution
  - Local moderator action counts vs site-admin overrides

## Phases

## Phase A — Discovery + Contract Lock
- Complete investigation order steps 1–5.
- Freeze lifecycle statuses, transition rules, and permissions matrix.
- Deliver ERD + endpoint contract doc in this plan file.
- Acceptance:
  - No unresolved contract questions for schema/API.

## Phase B — Schema + Service Foundations
- Add lifecycle columns + action timeline table + indexes.
- Add service methods for list/detail/assignment/status transitions/action append.
- Add transition guardrails in service layer.
- Acceptance:
  - Migrations apply cleanly.
  - Service tests pass for valid/invalid transitions.

### Phase B Progress Notes
- Added schema evolution for report lifecycle fields on `space_publication_reports`:
  - `status`, `assigned_to_user_id`, `last_action_at`, `resolved_by_user_id`, `resolved_at`, `resolution_code`, `resolution_note`, `rule_scope_at_submit`.
- Added `space_publication_report_actions` table for immutable triage timeline with actor/report/action indexes.
- Added FK attempts for assignee/resolver/action actor/report links (best effort, consistent with existing schema style).
- Updated report ingest path to persist `rule_scope_at_submit` (`global` for `global-feed`, else `space_culture`).
- Added repo/service foundations for Phase C endpoints:
  - admin list/detail query methods
  - row-lock read (`FOR UPDATE`)
  - lifecycle updater
  - immutable action inserts
  - guarded transition matrix + global moderation permission checks.

## Phase C — Site Admin Inbox (First Ship)
- Implement `/api/admin/reports*` endpoints.
- Implement `/admin/reports` list + detail + action flows.
- Acceptance:
  - Site admin can triage and resolve global-rule complaints.
  - Site admin can view local-culture complaints and action history.

### Phase C Progress Notes
- Added API router `src/routes/admin-reports.ts` with:
  - `GET /api/admin/reports`
  - `GET /api/admin/reports/:id`
  - `POST /api/admin/reports/:id/assign`
  - `POST /api/admin/reports/:id/status`
  - `POST /api/admin/reports/:id/resolve`
  - `POST /api/admin/reports/:id/dismiss`
- Mounted router in `src/app.ts`.
- Added admin page route `GET /admin/reports` with:
  - inbox filters
  - report list table
  - selected report summary
  - action timeline
  - assign/status/resolve/dismiss forms
- Added page POST handlers:
  - `/admin/reports/:id/assign`
  - `/admin/reports/:id/status`
  - `/admin/reports/:id/resolve`
  - `/admin/reports/:id/dismiss`
- Added global moderation page guard for this page (`requireGlobalModerationPage`).

## Phase D — Space-Scoped Moderator Views
- Implement `/api/space/moderation/reports*` endpoints.
- Add space-level report inbox/detail with role checks.
- Acceptance:
  - Group/channel moderators can process only their own space reports.
  - Site admin sees all resulting actions in global inbox.

### Phase D Progress Notes
- Added space-scoped moderation APIs:
  - `GET /api/space/moderation/reports`
  - `GET /api/space/moderation/reports/:id`
  - `POST /api/space/moderation/reports/:id/status`
  - `POST /api/space/moderation/reports/:id/resolve`
- Added service-layer space moderation permission checks (`video:approve_space` / `video:publish_space` with `spaceId` context).
- Added space-scoped lifecycle mutation paths with row-level lock and space ownership guard.

## Phase E — Analytics + QA + Hardening
- Add trace tags and admin reporting queries.
- Add smoke scripts for report lifecycle and role boundaries.
- Acceptance:
  - Metrics and traces verify end-to-end flow.
  - Permission boundary tests pass.

## Smoke Matrix (Initial)
1. User submits report in global-feed channel; row created with reason snapshots.
2. Report appears in `/admin/reports` as `open`.
3. Site admin assigns report to moderator; action logged.
4. Site admin resolves report; status + resolution metadata persisted.
5. Group moderator can view/action only reports for their space.
6. Group moderator cannot action unrelated space reports.
7. Site admin can view both global and space-local actions/timelines.
8. Jaeger tags include report id/status/action on submit and triage actions.

## Open Questions (Post-Phase A)
1. Do we allow space moderators to assign reports to other space moderators in V1, or keep assignment global-admin only for first ship?
2. Should we expose a “bulk action” endpoint in V1, or defer until inbox UX stabilizes?

## Concrete Extension: Reporter Credibility (V1.1)

## Rationale
- Status alone (`resolved`/`dismissed`) is not enough to model reporter quality.
- We need an explicit outcome signal per terminal decision to:
  - detect high-signal reporters,
  - detect noisy/malicious reporting patterns,
  - support anti-brigading triage.

## Data Contract
- Keep workflow status unchanged.
- Keep report targeting generic/extensible:
  - `target_type` (`publication|comment|account`) — V1 defaults to `publication`.
  - `target_id` (numeric target id).
  - `target_snapshot_json` (optional immutable context snapshot at submit).
- Add separate terminal outcome fields on `space_publication_reports`:
  - `outcome_class` ENUM(
    `'substantiated'`,
    `'partially_substantiated'`,
    `'context_mismatch'`,
    `'unsubstantiated'`,
    `'abusive_report'`
    ) NULL
  - `outcome_confidence_pct` TINYINT UNSIGNED NULL  // 0..100
  - `outcome_set_by_user_id` BIGINT UNSIGNED NULL
  - `outcome_set_at` DATETIME NULL
- Add index:
  - `(reporter_user_id, outcome_class, created_at, id)`

Notes:
- UI shows confidence as percent (`0–100%`).
- Internal scoring also uses `0–100` scale for consistency.

## Action Timeline
- When terminal action occurs (`resolve` / `dismiss`), append action detail including:
  - `outcome_class`
  - `outcome_confidence_pct`
- Changes to outcome after terminal state must append a new action row (audit-safe).

## Reporter Rollups
- Add table `reporter_credibility_rollups`:
  - `id` BIGINT PK
  - `reporter_user_id` BIGINT UNSIGNED NOT NULL
  - `window_key` VARCHAR(16) NOT NULL  // `lifetime|30d|90d`
  - `total_reports` INT UNSIGNED NOT NULL
  - `substantiated_count` INT UNSIGNED NOT NULL
  - `partially_substantiated_count` INT UNSIGNED NOT NULL
  - `context_mismatch_count` INT UNSIGNED NOT NULL
  - `unsubstantiated_count` INT UNSIGNED NOT NULL
  - `abusive_report_count` INT UNSIGNED NOT NULL
  - `weighted_score_pct` DECIMAL(5,2) NOT NULL  // 0..100
  - `updated_at` DATETIME NOT NULL
  - unique `(reporter_user_id, window_key)`

Scoring (initial):
- `substantiated`: +1.00
- `partially_substantiated`: +0.60
- `context_mismatch`: +0.40
- `unsubstantiated`: +0.10
- `abusive_report`: 0.00
- Score = weighted mean * 100, with Bayesian smoothing:
  - `score = ((n * observed_mean) + (k * prior_mean)) / (n + k) * 100`
  - initial defaults: `prior_mean=0.50`, `k=20`.

## API Additions
- `GET /api/admin/reporter-credibility`
  - filters: `reporter_user_id`, `window_key`, `min_reports`, date range
- `GET /api/admin/reporter-credibility/:userId`
  - returns rollups + raw outcome distribution by scope/space
- `GET /api/admin/reports`
  - optional filters: `outcome_class`, `min_confidence_pct`, `max_confidence_pct`
- terminal mutation endpoints (`resolve`/`dismiss`) accept:
  - `outcome_class`
  - `outcome_confidence_pct`

## UI Additions
- In report detail:
  - terminal panel includes outcome class selector + confidence percent input.
- New admin page `/admin/reporter-credibility`:
  - table by reporter:
    - total reports
    - substantiated %
    - unsubstantiated %
    - abusive %
    - weighted credibility score (0–100)
  - drill-down by scope:
    - Global Feed
    - Group
    - Channel

## Rollout Order (after Phase E)
1. Schema + endpoint support for outcome fields.
2. Update resolve/dismiss UI to capture outcomes.
3. Backfill script for old rows (nullable outcomes remain allowed).
4. Rollup job + admin reporter insights page.
