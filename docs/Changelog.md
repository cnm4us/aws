# Changelog

- 2026-04-04: Refactored Pages/Docs hierarchy to section/document parent-child model, added `/api/pages` root listing, parent-chain path resolution for `/api/pages/:path`, and hierarchical admin page management with reparent + move up/down controls.
- 2026-04-02: Create Video asset picker now supports `Exports` as a first-class video source group (alongside Uploads/My Clips/Shared Videos), export favorites/filtering, unified source cards, and timeline insertion diagnostics (`assets.videos.used`, `app.timeline_asset_origin`, `app.timeline_asset_role`).
- 2025-10-17: Added session table & cookie auth, `/api/me`, CSRF double-submit protection, RBAC helper (`can()`), UI fetching `/api/me`, and secured upload/publish/delete routes.
- 2025-10-10: Modular routes/services; profiles API; docs scaffold; consistent video naming; DATE → YYYY-MM/DD paths.
