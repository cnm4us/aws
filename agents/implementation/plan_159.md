# Plan 159: Admin Reports Mobile-First Card Inbox

Status: Phase A Complete (2026-04-07) · Phase B Complete (2026-04-07) · Phase C In Progress · Phase D Pending

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - `/admin/reports` is table-first and not mobile friendly.
  - Current inspect/actions are inline sections, which increases page density and scrolling cost on small screens.
- In scope:
  - Keep `SEARCH INDEX` filter controls at top.
  - Replace report table with card list.
  - Add modal-based inspect and action timeline views from card actions.
  - Preserve existing report workflow (`/admin/reports/:id/decision`) and filter/query behavior.
- Out of scope:
  - New moderation semantics, workflow rules, permissions model.
  - API contract changes beyond what is needed for card/modal rendering.
  - Space-scoped moderation UI redesign.
- Constraints:
  - Single layout system (no table-vs-cards split by breakpoint).
  - Must remain fully server-rendered in `src/routes/pages.ts`.
  - Existing CSRF/session model remains unchanged.

## Locked Decisions
- One layout only: cards across all breakpoints.
- Card actions:
  - `Inspect` opens selected report modal.
  - `Action Timeline` opens timeline modal.
- Keep current filter URL parameters and preserve them on modal open/close.
- Keep current backend endpoints; this plan is primarily page composition + interaction model.

## Phase Status
- A: Complete
- B: Complete
- C: In Progress
- D: Pending

## Phase A — Contract + Interaction Model
- Goal:
  - Lock card fields, modal model, and URL-state behavior before page refactor.
- Steps:
  - [x] Define card field order and labels:
    - Space
    - Created
    - Reason
    - Rule
    - Assignee
    - Reporter
    - Status
  - [x] Define action row behavior:
    - `Inspect` => details modal
    - `Action Timeline` => timeline modal
  - [x] Define URL params for modal state (example):
    - `report_id=<id>`
    - `view=inspect|timeline`
  - [x] Define close behavior:
    - remove modal params
    - retain search/filter params
- Test gate:
  - Manual review of plan and rendered HTML structure draft.
- Acceptance:
  - No unresolved UX ambiguity for card/modal behavior.

## Phase A Output (Locked 2026-04-07)
- List layout:
  - Table is removed entirely from `/admin/reports`.
  - `REPORT ROWS` renders card-only at all breakpoints.
- Card field order (top to bottom):
  - Space
  - Created
  - Reason
  - Rule
  - Assignee
  - Reporter
  - Status
- Card actions:
  - `Inspect` button opens **Selected Report** modal.
  - `Action Timeline` button opens **Action Timeline** modal.
- Modal routing/query contract:
  - `report_id=<id>` identifies selected report.
  - `view=inspect|timeline` identifies which modal opens.
  - Existing search/filter query params remain unchanged and are preserved.
- Modal close contract:
  - Close removes only `report_id` and `view`.
  - All active filters remain in URL and are reapplied on return.
- Workflow contract:
  - Decision workflow remains in inspect modal and continues to submit via existing `/admin/reports/:id/decision` handler.
  - No API contract changes required for Phase B.

## Phase B — Card List Refactor
- Goal:
  - Replace table under `REPORT ROWS` with cards.
- Steps:
  - [x] Refactor list rendering in `/admin/reports` route to emit cards.
  - [x] Keep `SEARCH INDEX` controls and existing server-side filtering.
  - [x] Add card actions (`Inspect`, `Action Timeline`) as links preserving filter params.
  - [x] Add clear empty-state card when no rows match filters.
- Test gate:
  - `npm run build`
  - `npm run web:build`
- Acceptance:
  - No table markup for report rows.
  - Cards render consistently on mobile width and desktop width.

## Phase B Output (Completed 2026-04-07)
- `/admin/reports` list rendering replaced from table rows to card list.
- Card includes:
  - Space
  - Created
  - Reason
  - Rule
  - Assignee
  - Reporter
  - Status
- Card action buttons added:
  - `Inspect` links with `report_id=<id>&view=inspect`
  - `Action Timeline` links with `report_id=<id>&view=timeline`
- Existing filter/query params are preserved on both action links.
- Empty-state now renders as card-style section.
- Build verification passed:
  - `npm run build`
  - `npm run web:build`

## Phase C — Modal Views (Inspect + Timeline)
- Goal:
  - Move selected-report detail and action timeline into modal overlays.
- Steps:
  - [x] Add modal container styles and open/close controls on `/admin/reports`.
  - [x] Wire inspect modal to selected report payload.
  - [x] Wire timeline modal to selected report actions.
  - [x] Keep decision workflow in inspect modal (status/assignee/decision/note + submit).
  - [x] Ensure modal close returns user to filtered card list state.
- Test gate:
  - `npm run build`
  - Manual: open/close each modal from multiple cards with active filters.
- Acceptance:
  - Both modal types function without page-layout regressions.
  - Decision form submits continue to work with CSRF and redirect back to selected report.

## Phase C Progress (2026-04-07)
- Implemented modal routing and rendering:
  - `report_id=<id>&view=inspect|timeline`
  - overlay modal with close control that removes modal params and preserves filter params.
- Moved selected report details and decision workflow into inspect modal.
- Moved action timeline into timeline modal.
- Decision form now carries `return_to` and redirects back into inspect modal with notice/error.
- Added notice/error banner rendering on `/admin/reports`.
- Build gates passed:
  - `npm run build`
  - `npm run web:build`
- Pending:
  - Manual smoke verification of modal open/close and action flow.

## Phase D — Polish + Smoke Matrix
- Goal:
  - Stabilize for day-to-day moderation use.
- Steps:
  - [ ] Improve mobile spacing/typography for scan speed.
  - [ ] Confirm button hit targets and modal scroll behavior.
  - [ ] Verify error/notice banners still visible after actions.
  - [ ] Add/update brief docs note for `/admin/reports` UX model.
- Test gate:
  - Smoke matrix:
    - filter -> inspect -> assign -> status -> decision apply
    - filter -> timeline open/close
    - back/refresh with modal params
  - `npm run build`
- Acceptance:
  - Moderation flow fully operable from mobile viewport without horizontal scroll.

## Change Log
- 2026-04-07 — Phase A locked for card-only inbox + modal routing contract
- 2026-04-07 — Phase B card-list refactor completed in `src/routes/pages.ts`
- 2026-04-07 — Phase C modal implementation completed in code; awaiting manual smoke

## Validation
- Environment: development
- Commands run: (pending)
- Evidence files: `src/routes/pages.ts`
- Known gaps: none yet

## Open Risks / Deferred
- Risk:
  - Large action timelines may need pagination/virtualization in modal.
- Risk:
  - URL-param modal state can conflict with future client-side navigation if not normalized.
- Deferred:
  - Unify inspect and timeline into a single tabbed modal if usage shows constant switching.

## Resume Here
- Next action:
  - Start Phase C modal views for inspect and action timeline.
- Blocking question (if any):
  - none
