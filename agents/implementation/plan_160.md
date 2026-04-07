# Plan 160: Start/End Time-Range Reports + Admin Preview Deep Links

Status: Active

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - Report triage currently lacks direct, timestamp-aware jump points into the reported video moment.
  - Admin report cards/modals have no dedicated preview deep link for fast evidence review.
- In scope:
  - Optional timestamp capture at report submission time.
  - Persist timestamp on report rows.
  - Add preview deep links in admin report card and inspect/timeline modal.
  - Keep report submission backward-compatible (timestamp optional).
- Out of scope:
  - Full timeline range editing UX (start+end) in this iteration.
  - Rich media annotation/drawing/region selection.
  - Player architecture changes beyond URL-time seek support.
- Constraints:
  - Reporting flow must remain low-friction.
  - Existing report API should continue working without timestamp.

## Locked Decisions
- Timestamp is optional, not required.
- Capture model is optional range:
  - `reported_start_seconds`
  - `reported_end_seconds`
- Report modal includes explicit `Start` and `End` capture controls:
  - each captures current playhead time on click
  - values persist while user remains on the same slide/publication
- Submit behavior:
  - neither set => no time payload
  - one set => send that one only
  - both set => send both
- Validation rule:
  - if both set and `end < start`, reject submit with inline validation message.
- Admin preview links include time parameters when present.
- Deep-link param shape:
  - start: `t=<seconds>`
  - end: `t_end=<seconds>` (optional, ignored where unsupported)

## Phase Status
- A: Completed
- B: Completed
- C: Completed
- D: Pending

## Phase A — Contract + Data Model
- Goal:
  - Lock payload and schema contract.
- Steps:
  - [x] Add nullable `reported_start_seconds` and `reported_end_seconds` columns to `space_publication_reports`.
  - [x] Define valid range and normalization:
    - non-negative integer seconds
    - clamp to duration if available
    - reject when both present and `end < start`
  - [x] Extend report API contract to accept optional `reported_start_seconds` and `reported_end_seconds`.
  - [x] Define player deep-link param shape:
    - preferred start param (`t=<seconds>` or existing equivalent)
    - optional end param if player supports segment range.
- Test gate:
  - migration applies cleanly; existing report inserts still pass.
- Acceptance:
  - Optional timestamp persisted and queryable with no regressions.

## Phase B — User Reporting UX
- Goal:
  - Capture optional start/end timestamps in report modal.
- Steps:
  - [ ] Update `frontend/src/app/ReportModal.tsx` to include a time-capture strip under modal header/instructions:
    - `Start` control + displayed captured start time
    - `End` control + displayed captured end time
  - [ ] Capture current playhead for Start/End on click.
  - [ ] Keep captured values in per-slide/publication local state while user remains on that slide.
  - [ ] Add clear/unset affordance for each value.
  - [ ] Show inline validation message if `end < start`.
  - [ ] Include optional start/end fields in `POST /api/publications/:id/report` payload.
- Test gate:
  - manual submit with and without timestamp.
- Acceptance:
  - Reports can be filed both ways; timestamp included only when provided.

## Phase C — Backend Wiring + Validation
- Goal:
  - Persist and expose start/end timestamps through report services.
- Steps:
  - [ ] Extend report intake validation/service/repo to accept optional start/end fields.
  - [ ] Persist `reported_start_seconds` and `reported_end_seconds` in report insert.
  - [ ] Include start/end fields in admin list/detail responses.
  - [ ] Add defensive validation and normalization.
- Test gate:
  - `npm run build`
  - API smoke for report create/list/detail.
- Acceptance:
  - Start/end times are visible in admin responses and DB.

## Phase D — Admin Preview Links
- Goal:
  - Speed up triage by one-click preview to exact report moment.
- Steps:
  - [ ] Add `Preview` action to report cards.
  - [ ] Add `Preview` link in inspect modal and timeline modal headers/sections.
  - [ ] Build preview URL to publication target:
    - include start param when `reported_start_seconds` exists
    - include end param when supported and `reported_end_seconds` exists
  - [ ] Confirm links work for reports without time range (open at default start).
- Test gate:
  - `npm run build`
  - manual click-through from card and both modals.
- Acceptance:
  - Admin can jump directly to reported moment where available.

## Change Log
- 2026-04-07:
  - Added `reported_start_seconds` and `reported_end_seconds` to report schema bootstrap in `src/db.ts`.
  - Added API request acceptance for optional start/end fields in `src/routes/publications.ts` (both publication and moderation report endpoints).
  - Added backend normalization/validation in `src/features/reports/service.ts`:
    - normalize to integer seconds
    - clamp to publication upload duration when available
    - reject invalid range (`end < start`)
  - Persisted fields in report inserts via `src/features/reports/repo.ts`.
  - Exposed start/end fields in report reads (`myReport`, admin list/detail query rows) for downstream Phase C/D usage.
  - Phase B:
    - Added `Start`/`End` capture controls with local per-slide persistence in `frontend/src/app/ReportModal.tsx` + `frontend/src/app/Feed.tsx`.
    - Added inline validation for invalid range (`end < start`) and submit-block in the modal.
    - Added optional payload forwarding of `reported_start_seconds` / `reported_end_seconds` on report submit.
  - Phase C:
    - Exposed captured range in admin reports page cards and selected report/timeline modals in `src/routes/pages.ts`.

## Validation
- Environment: development
- Commands run:
  - `npm run build`
  - `npm run web:build`
- Evidence files:
  - `src/db.ts`
  - `src/features/reports/*`
  - `frontend/src/app/ReportModal.tsx`
  - `src/routes/pages.ts`
- Known gaps: none yet

## Open Risks / Deferred
- Risk:
  - Player time-seek query param mismatch across feed/player entry points.
- Risk:
  - Reported timestamp can be stale if publication version changes.
- Deferred:
  - Timeline mini-preview waveform in report modal.
  - Moderator-side timestamp editing.

## Resume Here
- Next action:
  - Start Phase A and lock deep-link param format.
- Blocking question (if any):
  - none
