Handoff Summary (Session: 2025-10-22)

Overview
- Added a dedicated forbidden page and enforced page-level RBAC for all admin UI routes to prevent non-admin users from viewing admin shells.
- Removed legacy `/admin` page and its unused HTML file.
- Added guards to block direct access to `admin-*.html` files, including via the `/exp/:tag` pinned assets path.
- Implemented initial space-level admin and moderation UI with unified routes and a moderation queue API.

Changes
- public/forbidden.html
  - New page that displays: “You don't have permission to access this page.”
  - Shows the originally requested URL using `?from=` query param (fallback: `document.referrer`).
  - Provides quick links to Home and Login.

- src/middleware/auth.ts
  - New `requireSiteAdminPage` middleware. If unauthenticated or not site admin, redirects to `/forbidden?from=<originalUrl>`.
  - Uses the same site-admin check as APIs (`can(userId, 'video:delete_any')`).
  - New `requireSpaceAdminPage` guard: allows site_admin or users with any of `space:manage`, `space:manage_members`, `space:assign_roles` in the target space. Redirects to `/forbidden` otherwise.
  - New `requireSpaceModeratorPage` guard: allows site_admin or users with `video:approve_space` or `video:publish_space` in the target space. Redirects to `/forbidden` otherwise.

- src/routes/pages.ts
  - Added `GET /forbidden` route to serve the forbidden page.
  - Applied `pagesRouter.use('/admin', requireSiteAdminPage)` to protect all admin UI routes:
    - `/admin/settings`, `/admin/users`, `/admin/groups`, `/admin/channels`, and detail pages.
  - Added space-level pages:
    - `GET /spaces/:id/admin` (guarded by `requireSpaceAdminPage`) → serves `public/space-admin.html`.
    - `GET /spaces/:id/moderation` (guarded by `requireSpaceModeratorPage`) → serves `public/space-moderation.html`.
    - Aliases for readability (same pages/guards): `/groups/:id/admin`, `/channels/:id/admin`, `/groups/:id/moderation`, `/channels/:id/moderation`.

- src/app.ts
  - Removed legacy `GET /admin` route and deleted `public/admin.html`.
  - Added pre-static guards for direct HTML access:
    - `^/admin-.*\.html$` and `^/exp/[^/]+/admin-.*\.html$` redirect to `/forbidden?from=<originalUrl>` when not site admin.
  - No change needed for the new space pages (they are served via `pagesRouter`).

- src/routes/spaces.ts
  - Added `GET /api/spaces/:id/moderation/queue` (auth required). Permission: site_admin, or `video:approve_space`/`video:publish_space` in that space.
  - Returns items with publication (pending), upload (basic fields), and requester display info.

Removed
- public/admin.html (legacy dev-only shell; superseded by the split admin pages)

Validation Notes
- Access as non-admin (or logged-out):
  - Visiting `/admin/users` (or any `/admin/*`) redirects to `/forbidden?from=/admin/users`.
  - Direct file access like `/admin-users.html` or `/exp/<tag>/admin-users.html` also redirects to `/forbidden?...`.
- Access as site admin: All admin pages render as before.
- Space moderation:
  - Visit `/spaces/:id/moderation` (or `/groups/:id/moderation`, `/channels/:id/moderation`) as space moderator/admin or site_admin → see pending queue; approve/reject works and removes the item.
  - Non-authorized users are redirected to `/forbidden?from=...`.
  - CSRF: moderation actions send `x-csrf-token` from the `csrf` cookie; ensure you are logged in so the cookie exists.

Operational
- The RBAC seeding now includes canonical `space_*` roles. Restarting the server triggers `seedRbac()` to add any missing `role_permissions` (idempotent), e.g., `space_admin` now includes `video:approve_space`.

Follow-ups / Options
- Later, we can change the guard for unauthenticated visitors to redirect to `/login?next=<originalUrl>` before showing forbidden (per your preference).
- If we add new admin pages, the `/admin` path guard in pagesRouter will automatically protect them.
- Build out `space-admin.html` for membership/invites/settings using existing space APIs under `/api/spaces/*`. Add endpoints as needed for space-level settings (currently the detailed settings API is under `/api/admin`, which requires site_admin).

References
- RBAC context: docs/RBAC_Implementation_Plan.md, docs/RolesPermissions.md
- Previous handoff: docs/Handoff_04.md
