Handoff Summary (Session: 2025-10-23)

Context
- Goal: Simplify space-level admin UI at `/spaces/:id/admin` by mirroring the site‑admin UX pattern (`/admin/users`) with a left sidebar and per‑member detail page, instead of inline moderation controls on the members list.
- Reference model: `/admin/users` (sidebar: Site Settings, Users, Groups, Channels). New target for spaces: sidebar with Settings, Members (default), Moderation.
- Existing pieces from last session:
  - Guards: `requireSpaceAdminPage`, `requireSpaceModeratorPage` (pages) and granular `can()` checks (APIs).
  - Space pages: `/spaces/:id/admin` → `public/space-admin.html` (currently shows members + subscribers with inline suspend/ban); `/spaces/:id/moderation` → `public/space-moderation.html`.
  - APIs: `/api/spaces/:id/members`, `/api/spaces/:id/subscribers`, `/api/spaces/:id/suspensions` (GET active=1/all, POST create, DELETE marks `ends_at=NOW()`), moderation queue.

Proposed UX/Routes
- Sidebar (space scope):
  - Settings → `/spaces/:id/admin/settings` (new page; scope: space settings the space_admin can modify)
  - Members (default) → `/spaces/:id/admin` (serve Members page) or `/spaces/:id/admin/members` (explicit route; optional redirect from `/spaces/:id/admin`)
  - Moderation → `/spaces/:id/moderation` (existing)
- Members list columns: ID, Display Name (link), Email, Created.
  - Display Name links to per‑member page: `/spaces/:id/admin/users/:userId`.
- Per‑member page sections (space‑scoped):
  - Suspension: radio for 1d/7d/30d, comment, Issue button; log shows current and past suspensions with comments.
  - Lift Suspension: comment (if supported) + Lift button; updates log.
  - Ban: comment + Ban/Lift buttons.
  - Message Member: textarea + Send (stub for later).
  - Credibility Points: “Coming soon”.

Implementation Plan
1) Pages and routing
   - Add `GET /spaces/:id/admin/settings` → `public/space-settings.html` (new).
   - Serve Members as default: update `pagesRouter` to serve `public/space-members.html` for `GET /spaces/:id/admin` (or redirect to `/spaces/:id/admin/members` which serves same page).
   - Add `GET /spaces/:id/admin/users/:userId` → `public/space-admin-user.html` (new per‑member page).
   - Add group/channel aliases for settings and per‑member pages as we do for admin and moderation (optional, for parity).
2) Members list page
   - New `public/space-members.html` + `public/js/space-members.js` using `admin-nav.css` sidebar.
   - Fetch `/api/spaces/:id/members` and render: ID, Display Name (linked), Email, Created.
   - Remove inline moderation actions (suspend/ban) from list.
3) Per‑member page
   - New `public/space-admin-user.html` + `public/js/space-admin-user.js` with sections described.
   - Load member identity via `/api/spaces/:id/members` (filter) or add a dedicated endpoint (see questions).
   - Load suspensions via `/api/spaces/:id/suspensions` and filter by `userId` to render log (active + past).
   - Actions:
     - Suspension Issue: `POST /api/spaces/:id/suspensions` with `{ userId, kind:'posting', degree, reason }`.
     - Lift Suspension: find user’s active posting suspensions and `DELETE /api/spaces/:id/suspensions/:sid` (optionally pass a reason if API supports; see questions).
     - Ban/Lift: `POST` with `{ kind:'ban', reason }` and `DELETE` for active ban suspensions respectively.
     - Message Member: UI only for now; no API call.
   - Permission awareness: if user lacks `moderation:suspend_posting` or `moderation:ban`, disable or hide those sections.
4) Settings page (initial)
   - Create `public/space-settings.html` with sidebar; show basic space info and a “Coming soon” note or minimal toggles if API exists.
5) API tweaks (minimal)
   - Extend `/api/spaces/:id/members` to include `createdAt` (user account creation) to support the Members table, or clarify if “Created” should be membership date (see questions). If membership date is required, add/derive from `user_space_roles` timestamps if available; otherwise add a column.
   - Optional: add `/api/spaces/:id/members/:userId` to fetch one member’s identity without loading all members.
   - Optional (for lift comments): allow DELETE `/api/spaces/:id/suspensions/:sid` to accept `{ reason }` and persist to a new `revoked_reason` column, or add `POST /api/spaces/:id/suspensions/:sid/revoke` with `{ reason }`.
6) QA
   - Verify guards redirect to `/forbidden` when missing permissions.
   - Verify Members list and per‑member actions behave and log updates.
   - Check alias routes for groups/channels if added.

Questions
1) “Created” column: Should this be the user account creation timestamp (`users.created_at`) or the membership join date in the space? If membership date is intended and not currently captured, do you want us to add it?
2) Routes: OK to make `/spaces/:id/admin` the Members default and add explicit `/spaces/:id/admin/members`? And confirm the per‑member route `/spaces/:id/admin/users/:userId`.
3) Lift comment storage: Do you want lift comments captured? If yes, prefer adding a `revoked_reason` column to `suspensions` (and accept `{reason}` on revoke) or create a `suspension_events` audit table?
4) Permissions UX: When the viewer lacks suspend/ban permissions, should we hide those sections or show them disabled with a note?
5) Subscribers: The previous space admin page listed subscribers. Should we keep a “Subscribers” view somewhere (e.g., a link from Settings) or omit for now?
6) Group/Channel aliases: Should we add aliases for settings and per‑member pages under `/groups/:id/admin/...` and `/channels/:id/admin/...` for consistency?

Notes
- Existing inline moderation buttons in `public/space-admin.html` will be deprecated once `space-members.html` becomes the default. We can retain the file for now to avoid breaking links and remove it later.

Decisions (2025-10-23)
- Created column: Omit for now from Members list.
- Routes:
  - `/spaces/:id` → redirect to `/spaces/:id/admin/users/:userId` (current user).
  - Keep Members default at `/spaces/:id/admin` and explicit `/spaces/:id/admin/members`.
  - Per‑member page confirmed: `/spaces/:id/admin/users/:userId`.
- Lift comment: Placeholder UI only (“Coming soon”); no storage yet.
- Permissions UX: Show sections disabled with a note when lacking permissions.
- Subscribers: Keep; included under Settings page.
- Group/Channel aliases: Yes — added for settings, members, per‑member pages.
