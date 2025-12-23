# Implementation Plan: SPA-Embedded Pages & Rules (Phase 2)

## 1. Overview

Goal: Move the latest versions of CMS pages and rules into the existing SPA shell so all app surfaces (feed, pages, rules) share a unified menu and layout, while reusing the server-side Markdown pipeline and keeping editor UIs server-rendered.

In scope (Phase 2):
- SPA ownership of the *latest* versions of:
  - Home (`/`) as a CMS-backed page.
  - `/pages/:slug` pages (latest content).
  - `/rules/:slug` rules (latest version) and navigation affordances to historical versions.
- Backend JSON APIs for pages and rules that return pre-rendered HTML + metadata (no client-side Markdown parsing).
- SPA route entries and viewer components that:
  - Fetch content via the new APIs.
  - Render HTML inside the existing SPA layout (with SharedNav/menu).
  - Provide simple “version navigation” affordances for rules.
- Static menu integration:
  - Add a small number of curated entries (e.g., Home, key pages, key rules) into the SPA menu.
- A simple pattern for using a page as a TOC over its own subtree (e.g., `/pages/docs` acting as an index for `/pages/docs/getting-started`, `/pages/docs/faq`, etc.).

Out of scope (Phase 2):
- Client-side Markdown rendering or rich WYSIWYG editors.
- Converting `/admin/pages` and `/admin/rules` to SPA editors (they remain server-rendered forms).
- SEO-focused SSR or Open Graph metadata for pages/rules.
- Dynamic, CMS-driven menus (no `show_in_nav` metadata yet; menu additions are static in code).

References:
- `agents/features/features_03.md` — High-level Pages & Rules feature description.
- `agents/implementation/plan_08.md` — Current server-rendered Pages & Rules implementation.
- `agents/requirements/markdown.md` — Markdown feature contract.
- `frontend/src/main.tsx` — SPA route switching.
- `frontend/src/ui` / `frontend/src/menu` — Existing layout and navigation patterns (to be discovered).
- `src/routes/pages.ts` — Existing HTML routes for `/`, `/pages/:slug`, `/rules/:slug`, `/rules/:slug/v:version`.

---

## 2. Step-by-Step Plan

1. Discover current SPA navigation and layout integration points  
   Status: Pending  
   Testing:  
   - Inspect `frontend/src/main.tsx`, `frontend/src/ui/Layout.tsx` (or equivalent), and any menu-related modules under `frontend/src/menu` to identify:  
     - How routes are currently selected (path-based branching, components).  
     - Where the main navigation/menu is defined and how items are added.  
   - Document (in this plan or handoff notes) the minimal set of components and modules that will need changes to add new SPA routes for pages and rules, and where static menu entries live.

2. Design backend JSON APIs for pages and rules (latest + historical)  
   Status: Pending  
   Testing:  
   - Define the API shapes (no implementation yet) for:  
     - `GET /api/pages/:slug` → `{ slug, title, html, visibility, breadcrumbs?, children?: Array<{ slug, title }> }`.  
     - `GET /api/rules/:slug` → `{ slug, title, html, visibility, currentVersion, createdAt, changeSummary, versions?: Array<{ version, url }> }`.  
     - `GET /api/rules/:slug/v:version` (optional for SPA; may reuse existing HTML route for deep links).  
   - Ensure the design:  
     - Returns pre-rendered HTML from the existing Markdown pipeline (no raw Markdown to the client).  
     - Preserves visibility semantics from `plan_08` (public, authenticated, space_moderator, space_admin).  
     - Includes enough metadata to build simple TOC-like navigation (e.g., for `/pages/docs` to enumerate `/pages/docs/*` children) without changing the core page/rule schema.

3. Implement backend APIs for pages and rules (JSON, pre-rendered HTML)  
   Status: Pending  
   Testing:  
   - Extend `src/routes/pages.ts` or add a small `src/routes/content.ts` router to implement:  
     - `GET /api/pages/:slug` resolving slugs in the same way as HTML pages, enforcing visibility, and returning JSON `{ slug, title, html, visibility, children… }`.  
     - `GET /api/rules/:slug` resolving the latest version from `rules` + `rule_versions`, enforcing visibility, and returning JSON `{ slug, title, html, visibility, currentVersion, changeSummary, versions? }`.  
   - Add focused tests or manual checks:  
     - Hitting `/api/pages/home` returns the same content as the HTML home route.  
     - Hitting `/api/pages/docs` returns HTML plus a list of child pages where `slug` starts with `docs/` (TOC seed).  
     - Hitting `/api/rules/community-guidelines` returns current rule HTML and a list of versions with their version numbers and canonical URLs.

4. Add SPA viewer routes for Home, Pages, and Rules (latest only)  
   Status: Pending  
   Testing:  
   - In `frontend/src/main.tsx`, add branches that:  
     - For `/`, render a new `HomePage` component inside `Layout` that:  
       - Fetches `/api/pages/home` on mount, shows a loading state, then injects `html` via `dangerouslySetInnerHTML` into a `<div>` scoped with a CSS class.  
     - For `/pages/:slug`, render a `PageView` component that:  
       - Parses the path to a slug, calls `/api/pages/:slug`, and renders the returned HTML similarly.  
     - For `/rules/:slug`, render a `RuleView` component that:  
       - Calls `/api/rules/:slug` to show the current version’s HTML, plus a small “Version vN — see versions” header with static links to `/rules/:slug/v:version`.  
   - Ensure these components:  
     - Handle 404s and permission errors by showing a simple in-app error message (e.g., “Page not found” / “You do not have access to this content”) rather than redirecting.  
     - Do not introduce any client-side Markdown parsing; they only display pre-rendered HTML from the API.  
   - Manually verify:  
     - Navigating to `/` and `/pages/...` routes from within the SPA shows content inside the shared menu/layout.  
     - Clicking existing SPA links (e.g., to `/uploads`, `/profile`) still works as before.

5. Align server HTML routes with SPA ownership for latest versions  
   Status: Pending  
   Testing:  
   - Update `src/routes/pages.ts` HTML routes so that:  
     - `/` serves the SPA shell (`public/app/index.html`) instead of the server-rendered home page, or conditionally does so behind a feature flag.  
     - `/pages/:slug` and `/rules/:slug` similarly serve the SPA shell for latest views, while keeping `/rules/:slug/v:version` as a purely server-rendered historical permalink (for now).  
   - Ensure deep links to `/rules/:slug/v:version` still work as plain HTML pages.  
   - Manually verify that:  
     - Navigating directly to `/`, `/pages/...`, `/rules/...` loads the SPA and then shows content via the new viewer components.  
     - Navigating to `/rules/:slug/v:version` still shows the HTML-only view independent of SPA.

6. Add static menu entries for key Pages and Rules  
   Status: Pending  
   Testing:  
   - Locate the SPA menu configuration (under `frontend/src/ui` or `frontend/src/menu`) and add a small number of static entries for:  
     - Home (if not already present), pointing to `/`.  
     - A “Docs” or “Pages” entry pointing to a curated CMS page such as `/pages/docs`.  
     - A “Rules” entry pointing to a key rule, e.g., `/rules/community-guidelines` or to a rules index page (if desired).  
   - Manually verify that:  
     - These entries appear in the shared navigation.  
     - Clicking them from anywhere in the SPA retains the existing layout and shows the embedded page/rule content.

7. Implement TOC-style behavior for selected pages (e.g., `/pages/docs`)  
   Status: Pending  
   Testing:  
   - Extend the `/api/pages/:slug` implementation so that, for configured “index” pages (e.g., `docs`, `help`), it also returns a list of children based on slug prefix (e.g., all pages where `slug` starts with `docs/`).  
   - Update `PageView` to detect when the current slug is an index/TOC page (by a flag in the API response or by convention) and render a simple list of links to its children beneath the main HTML content.  
   - Manually verify:  
     - `/pages/docs` shows both the doc page content and a TOC listing of `/pages/docs/...` children.  
     - Child pages continue to render normally when visited directly.

8. Add a JSON moderation view for rule-linked actions (optional polish)  
   Status: Pending  
   Testing:  
   - Extend `GET /api/admin/moderation/actions` (or add a new endpoint) to:  
     - Include canonical rule URLs for any action with a `rule_version_id` (`/rules/:slug/v:version`).  
     - Optionally filter actions by `rule_slug` or `rule_version_id`.  
   - (Optional SPA integration) Decide whether a future iteration should show a minimal moderation activity list linked from a Rules view; for this phase, confirm only that the JSON response exposes the necessary rule linkage.  
   - Manually verify via curl/Postman that moderation actions referencing rules expose correct rule URLs and versions for later use.

---

## 3. Progress Tracking Notes

- Step 1 — Status: Pending.  
- Step 2 — Status: Pending.  
- Step 3 — Status: Pending.  
- Step 4 — Status: Pending.  
- Step 5 — Status: Pending.  
- Step 6 — Status: Pending.  
- Step 7 — Status: Pending.  
- Step 8 — Status: Pending.  

