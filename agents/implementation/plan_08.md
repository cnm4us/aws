# Implementation Plan: Editable Pages & Versioned Rules (Phase 1)

## 1. Overview

Goal: Introduce a Markdown-based content system for editable pages and versioned rules, with stable URLs, strict rendering, and first-class moderation linkage, while keeping the main video SPA lean and using plain, server-rendered admin UIs.

In scope (Phase 1):
- Shared Markdown → HTML pipeline implementing the `agents/requirements/markdown.md` feature contract.
- Editable Pages system:
  - DB schema for pages (including a special `home` page).
  - Public routes for `/` and `/pages/:slug` (up to 4-segment hierarchical slugs).
  - Visibility controls (public, authenticated, “any space moderator”, “any space admin”).
  - Simple, server-rendered admin pages under `/admin/pages` for listing and editing.
- Versioned Rules system:
  - DB schema for `rules` and `rule_versions` with immutable versions and optional change summary.
  - Public routes `/rules/:slug` and `/rules/:slug/v:version`.
  - Server-rendered admin pages under `/admin/rules` for creating rules, adding versions, and viewing history.
  - A dedicated moderation actions table with a single `rule_version_id` reference per action.

Out of scope (Phase 1):
- SPA-embed layouts and complex multi-layout templates (beyond a single shared layout).
- Per-space rules or per-document editor roles (site-wide editors only for now).
- Multiple rule-version references per moderation action (one reference per action only).
- Rich WYSIWYG editing or Markdown extensions beyond `agents/requirements/markdown.md`.

References:
- `agents/features/features_03.md` — High-level Pages & Rules feature description.
- `agents/requirements/markdown.md` — Markdown feature contract.
- `agents/requirements/reserved_slug_names.md` — Reserved names (for consistency with other slug systems).
- `src/db.ts` — Current schema and `ensureSchema` patterns.
- `src/routes/pages.ts` — Existing SPA shell routing patterns.
- `src/core/errors.ts`, `src/core/http.ts` — Domain error and HTTP mapping conventions.

---

## 2. Step-by-Step Plan

### Phase A — Shared Markdown & Editable Pages

1. Design and add DB schema for pages and moderation actions (DDL only)  
   Status: Pending  
   Testing:  
   - In `src/db.ts` `ensureSchema`, add tables such as:  
     - `pages` (id, slug, title, markdown, html, visibility enum, layout enum, created_at, updated_at, created_by, updated_by).  
     - `moderation_actions` (id, actor_user_id, target_type, target_id, action_type, reason, rule_version_id NULL, detail JSON, created_at).  
   - Enforce constraints:  
     - `pages.slug` supports up to 4 segments with allowed characters (a–z, 0–9, `-`, `/`), stored lowercase.  
     - Unique index on `pages.slug`, with a reserved identity for the `home` page (e.g., `slug = 'home'`).  
     - Foreign key from `moderation_actions.rule_version_id` will be added in Phase B once `rule_versions` exists (or kept as an integer with a clear TODO).  
   - Apply `ensureSchema` locally and verify via `DESCRIBE pages` / `DESCRIBE moderation_actions` that columns and indexes match the intended design, and that repeated runs are idempotent.

2. Implement shared Markdown → HTML rendering utility (strict, contract-based)  
   Status: Pending  
   Testing:  
   - Create a server-side utility (e.g., `src/utils/markdown.ts`) that:  
     - Accepts raw Markdown input and returns sanitized HTML plus any derived metadata (e.g., heading anchors).  
     - Enforces the allowed Markdown feature set from `agents/requirements/markdown.md` (H1–H3, lists, emphasis, links with `rel` attributes, blockquotes, fenced code blocks, horizontal rules, optional tables).  
     - Strips or rejects raw HTML and any disallowed constructs.  
     - Optionally uses a sanitizer like `sanitize-html` as a defensive backstop, but not as the primary guard.  
   - Add focused unit tests for the renderer (headings → anchors, link safety, stripping raw HTML, fenced code blocks, disallowed features).  
   - Verify determinism by rendering the same Markdown multiple times and confirming identical HTML output.

3. Add public page rendering routes for `/` and `/pages/:slug`  
   Status: Pending  
   Testing:  
   - Extend `src/routes/pages.ts` (or add a dedicated router) to:  
     - Handle GET `/` by loading the `home` page record and rendering its HTML inside the shared layout; show a clear “Home page not configured” placeholder if missing.  
     - Handle GET `/pages/:slug(*)` where the slug may contain up to 3 `/` characters (4 segments total), look up the `pages` row by slug, enforce visibility (public/auth/role) based on the current user, and render the stored HTML inside the same layout.  
   - Ensure reserved slugs (e.g., `global-feed`, `channels`, `groups`, `users`, `admin`, `api`, `auth`, `login`, `logout`, `assets`, `static`) are rejected at page creation time, not at request time.  
   - Manually verify:  
     - Public pages load for logged-out users when visibility is public.  
     - Auth-only and role-based pages return 403/redirect appropriately when the user lacks access.  
     - Hitting `/` and a few `/pages/...` URLs renders the expected content with no SPA bloat.

4. Implement server-rendered admin pages for listing and editing `pages` under `/admin/pages`  
   Status: Pending  
   Testing:  
   - Add plain server-rendered admin routes (e.g., in `src/routes/pages.ts` or a new `adminPages` router) that require appropriate site-level editor permission (e.g., a dedicated `page_editor` role or permission):  
     - `GET /admin/pages` → list of pages (slug, title, visibility, updated_at).  
     - `GET /admin/pages/new` → simple form for creating a page (slug, title, visibility, markdown).  
     - `POST /admin/pages` → create page: validate slug syntax/length, ensure uniqueness and reserved word rules, render Markdown → HTML via the shared utility, and insert into `pages`.  
     - `GET /admin/pages/:id` → edit form for an existing page (overwrite markdown/html and metadata in place; pages are not versioned in Phase 1).  
     - `POST /admin/pages/:id` → update existing page and re-render HTML.  
   - Keep UI as simple HTML forms with minimal JS (if any).  
   - Manually verify:  
     - Only authorized users can access `/admin/pages*`.  
     - Creating and editing pages reflects immediately at `/` and `/pages/:slug`.  
     - Validation errors (bad slug, duplicate slug, invalid visibility) are surfaced clearly on the form.

### Phase B — Versioned Rules & Moderation Linkage

5. Add DB schema for `rules` and `rule_versions` and link to moderation actions  
   Status: Pending  
   Testing:  
   - In `src/db.ts` `ensureSchema`, add:  
     - `rules` (id, slug, title, visibility enum, current_version_id NULL, created_at, updated_at, created_by, updated_by).  
     - `rule_versions` (id, rule_id, version INT, markdown, html, change_summary NULL, created_at, created_by).  
   - Enforce:  
     - Unique `(rule_id, version)` and unique `rules.slug`.  
     - Slug rules match pages (lowercase, a–z / 0–9 / `-` and `/`, up to 4 segments).  
   - Add a nullable foreign key (or documented integer reference) from `moderation_actions.rule_version_id` to `rule_versions.id`.  
   - Run `ensureSchema` and verify via `DESCRIBE rules`, `DESCRIBE rule_versions`, and that repeated runs remain idempotent.

6. Implement public routes for `/rules/:slug` and `/rules/:slug/v:version`  
   Status: Pending  
   Testing:  
   - Add GET routes that:  
     - Resolve `/rules/:slug` to the `rules` record by slug and then to its `current_version_id`, loading the latest `rule_version`.  
     - Resolve `/rules/:slug/v:version` to the specific `rule_version` row for that rule slug and version.  
     - Enforce visibility (public, authenticated, “any space moderator”, “any space admin”) using the same logic as pages.  
   - Render the stored HTML inside the shared layout with clear title and version metadata (e.g., “v3 — updated 2025-01-01”).  
   - Manually verify that:  
     - Latest and version-specific URLs work as intended and respect visibility.  
     - Nonexistent slugs or versions return 404 (not 500).

7. Build server-rendered admin UI for rules and version history under `/admin/rules`  
   Status: Pending  
   Testing:  
   - Add admin routes (server-rendered, minimal JS) that require a site-level `rule_editor` capability:  
     - `GET /admin/rules` → list all rules (slug, title, current version).  
     - `GET /admin/rules/new` → create a new rule (slug, title, visibility, initial Markdown, optional change summary); on submit, create a `rules` row and an initial `rule_versions` row with `version = 1`, rendered HTML, and set `rules.current_version_id`.  
     - `GET /admin/rules/:id` → overview of a single rule, showing current version and version history list (version, created_at, created_by, change_summary).  
     - `GET /admin/rules/:id/versions/new` → form to create a new version: Markdown + optional change summary; on submit, auto-increment version, render HTML, insert a new `rule_versions` row, and update `rules.current_version_id`.  
     - `GET /admin/rules/:id/versions/:version` → read-only view of a historical version (no edit in place).  
   - Manually verify:  
     - Every save creates a new `rule_versions` row; no updates in place.  
     - Version numbers are sequential and stable.  
     - Historical versions remain accessible even after newer versions are added.

8. Integrate moderation actions with rule_version references and optional logging  
   Status: Pending  
   Testing:  
   - Identify key moderation flows (e.g., suspensions or bans) where sanctions should reference a rule version and update the relevant services/routes to:  
     - Accept a `ruleVersionId` (or `ruleSlug + version`) parameter when recording a new moderation action.  
     - Insert a row into `moderation_actions` with `rule_version_id` set to the chosen version (or NULL when no rule is specified).  
     - Optionally emit a corresponding entry into `action_log` for observability, but treat `moderation_actions` as the source of truth.  
   - Add a simple read-only admin view (e.g., `GET /admin/moderation/actions`) listing recent moderation actions with links to the associated `/rules/:slug/v:version` when present.  
   - Manually verify:  
     - Creating a moderation action with a rule reference persists a valid `rule_version_id`.  
     - The admin list shows the linked rule version and that the URL resolves correctly.  
     - Moderation actions without rule references behave as before.

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

