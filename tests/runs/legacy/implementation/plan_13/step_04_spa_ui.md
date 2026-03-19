# Step 04 — SPA UI: cultures checkboxes on admin space detail

Date: 2025-12-27

Goal:
- Add a “Cultures” checkbox section to:
  - `/admin/groups/:id`
  - `/admin/channels/:id`
- Persist via `PUT /api/admin/spaces/:id` with `cultureIds`.

Notes:
- Build verified via `npm run web:build` (includes `tsc` + `vite build`).
- Manual browser verification still needed:
  - Load a group/channel admin detail page, toggle cultures, click “Save Settings”, refresh and confirm persistence.

