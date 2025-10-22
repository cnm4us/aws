Handoff Summary (Session: 2025-10-22)

Overview
- Added a dedicated forbidden page and enforced page-level RBAC for all admin UI routes to prevent non-admin users from viewing admin shells.
- Removed legacy `/admin` page and its unused HTML file.
- Added guards to block direct access to `admin-*.html` files, including via the `/exp/:tag` pinned assets path.

Changes
- public/forbidden.html
  - New page that displays: “You don't have permission to access this page.”
  - Shows the originally requested URL using `?from=` query param (fallback: `document.referrer`).
  - Provides quick links to Home and Login.

- src/middleware/auth.ts
  - New `requireSiteAdminPage` middleware. If unauthenticated or not site admin, redirects to `/forbidden?from=<originalUrl>`.
  - Uses the same site-admin check as APIs (`can(userId, 'video:delete_any')`).

- src/routes/pages.ts
  - Added `GET /forbidden` route to serve the forbidden page.
  - Applied `pagesRouter.use('/admin', requireSiteAdminPage)` to protect all admin UI routes:
    - `/admin/settings`, `/admin/users`, `/admin/groups`, `/admin/channels`, and detail pages.

- src/app.ts
  - Removed legacy `GET /admin` route and deleted `public/admin.html`.
  - Added pre-static guards for direct HTML access:
    - `^/admin-.*\.html$` and `^/exp/[^/]+/admin-.*\.html$` redirect to `/forbidden?from=<originalUrl>` when not site admin.

Removed
- public/admin.html (legacy dev-only shell; superseded by the split admin pages)

Validation Notes
- Access as non-admin (or logged-out):
  - Visiting `/admin/users` (or any `/admin/*`) redirects to `/forbidden?from=/admin/users`.
  - Direct file access like `/admin-users.html` or `/exp/<tag>/admin-users.html` also redirects to `/forbidden?...`.
- Access as site admin: All admin pages render as before.

Follow-ups / Options
- Later, we can change the guard for unauthenticated visitors to redirect to `/login?next=<originalUrl>` before showing forbidden (per your preference).
- If we add new admin pages, the `/admin` path guard in pagesRouter will automatically protect them.

References
- RBAC context: docs/RBAC_Implementation_Plan.md, docs/RolesPermissions.md
- Previous handoff: docs/Handoff_04.md

