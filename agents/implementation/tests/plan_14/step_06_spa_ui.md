# Step 06 — SPA UI: flag + lazy report modal

Date: 2025-12-27

Goal:
- Add a flag icon to each published video slide.
- Open a dismissible, lazy-loaded modal that:
  - loads categories + rules via `GET /api/publications/:id/reporting/options`
  - allows single-rule selection
  - loads full rule detail via `GET /api/rules/:slug` (Long/Allowed/Disallowed)
  - submits via `POST /api/publications/:id/report`
- Mark the flag icon for the current user after reporting.

Notes:
- Verified build via `npm run web:build` (chunk `ReportModal-*.js` emitted).
- Manual browser verification still needed:
  - Load feed, click “Flag”, pick a rule, submit.
  - Confirm button changes to “Sent” and persists after refresh (via feed’s `reported_by_me`).

