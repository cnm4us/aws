# Implementation Plan 40: System Lower Third Templates + User-Configurable Presets

## 1. Overview
Goal: Add a system-managed, SVG-based Lower Thirds feature where users can select a template, customize text/colors via a schema-driven UI with a live preview, and attach the configured lower third to a production for later ffmpeg rendering (rendering/overlay is out of scope for this plan).

In scope:
- System Lower Third Template storage (SVG markup + JSON descriptor + versioning).
- User-owned “Lower Third Presets” (template + parameter values) with create/edit/list/archive.
- Backend validation + deterministic “resolve SVG” endpoint.
- Frontend: schema-driven editor with live preview.
- `/produce` integration: select/clear preset; store snapshot/pointers in `productions.config`.

Out of scope:
- Applying the lower third to the video in ffmpeg/MediaConvert (overlay pipeline).
- Animations/timing UI beyond storing metadata placeholders.
- User-uploaded templates (templates remain system-provided).

## 2. Confirmed Decisions
- System-managed templates are administered via server-rendered site_admin UI under `/admin/*`.
- Live preview uses a backend `/resolve` endpoint (debounced) so preview === render.
- Placement: treat templates as a full-width lower-third strip anchored to the bottom of the frame, authored at `viewBox="0 0 1920 200"` (we can add a “bottom inset” later if desired).

## 3. Open Questions (Need Your Answers)
1) **Preset naming:** required `name` (confirmed).

## 4. Step-by-Step Plan

1. Add DB tables for templates + presets
   Status: Completed
   - Add `lower_third_templates`:
     - `template_key` (stable string id like `lt_modern_gradient_01`)
     - `version` (int, immutable once used)
     - `label`, `category`
     - `svg_markup` (TEXT/LONGTEXT)
     - `descriptor_json` (JSON or TEXT; match existing DB JSON usage)
     - `created_at`, optional `archived_at`
     - Unique `(template_key, version)`
   - Add `lower_third_configurations` (user-owned presets):
     - `owner_user_id`, `name`
     - `template_key`, `template_version`
     - `params_json` (resolved values for descriptor fields/colors)
     - `created_at`, `updated_at`, optional `archived_at`
   - Add indexes:
     - `idx_lt_tpl_key_archived` on `(template_key, archived_at, version)`
     - `idx_lt_cfg_owner_archived` on `(owner_user_id, archived_at, id)`
   Testing:
   - `npm run build` and server boots; `SHOW TABLES` includes both (or verify via existing admin DB tooling).
   - Record actual output: `agents/implementation/tests/plan_40/step_01_db.md`
   Checkpoint: Wait for developer approval before proceeding.

2. Implement backend: list templates + CRUD presets + resolve endpoint
   Status: Completed
   - Add services/repos:
     - List templates for any logged-in user.
     - CRUD presets with RBAC: owner or site_admin.
   - Add a deterministic resolver:
     - Input: `{ template_key, template_version, params }` or `{ preset_id }`
     - Validate against descriptor: maxLength, required ids, hex colors, etc.
     - Apply params into the SVG by element IDs (text content + fills/stops).
     - Output: finalized SVG string (and optionally a “sanitized” version).
   - Add SVG safety validation (server-side):
     - Reject `<script>`, `<foreignObject>`, event handler attrs (`on*`), and external refs (`href`, `xlink:href`, `url(http...)`).
     - Reject templates that don’t contain the required IDs referenced by the descriptor.
   - Add endpoints (names can be adjusted to match repo conventions):
     - `GET /api/lower-third-templates`
     - `GET /api/lower-third-configs`
     - `POST /api/lower-third-configs`
     - `PATCH /api/lower-third-configs/:id`
     - `DELETE /api/lower-third-configs/:id` (archive)
     - `POST /api/lower-third-templates/resolve` (or `/api/lower-thirds/resolve`)
   Testing:
   - Auth curl: `GET /api/lower-third-templates` returns `200` (may be empty until Step 3/4).
   - Auth curl: `GET /api/lower-third-configs` returns `200`.
   - Auth curl: `POST /api/lower-third-templates/resolve` returns `404 template_not_found` until a template exists (Step 3/4).
   - Record actual output: `agents/implementation/tests/plan_40/step_02_api.md`
   Checkpoint: Wait for developer approval before proceeding.

3. Admin UI: manage templates + create new versions
   Status: Completed
   - Add server-rendered site_admin routes:
     - `GET /admin/lower-thirds` (list templates by key+version; show archived)
     - `GET /admin/lower-thirds/new` (create a new template key + v1, or create a new version for an existing key)
     - `POST /admin/lower-thirds` (create)
     - Optional: archive/unarchive actions (no in-place edits of existing versions to preserve immutability).
   - UI fields:
     - Template key, label, category, version (auto-increment per key recommended).
     - SVG markup textarea, descriptor JSON textarea.
     - Server validates using the same safety/descriptor checks as `/resolve`.
   Testing:
   - Auth curl: `GET /admin/lower-thirds` → `HTTP 200` and HTML title `Lower Thirds`.
   - Auth curl: `GET /admin/lower-thirds/new` → `HTTP 200` and contains `New Lower Third Template`.
   - Record actual output: `agents/implementation/tests/plan_40/step_03_admin_ui.md`
   Checkpoint: Wait for developer approval before proceeding.

4. Seed the first system template (Modern Gradient v1)
   Status: Completed
   - Create one initial template (seeded in `ensureSchema()`; site_admin can manage via `/admin/lower-thirds`):
     - `viewBox="0 0 1920 200"`
     - Stable IDs: `primaryText`, `secondaryText`, `baseBg`, `accentColor`.
     - Descriptor matching `agents/features/feature_10.md` example (text + colors + defaults).
   Testing:
   - Resolve endpoint returns a finalized SVG for the seeded template.
   Checkpoint: Wait for developer approval before proceeding.

5. Frontend: presets list + editor with schema-driven form + live preview
   Status: Completed
   - Add `/lower-thirds` page:
     - List user presets (name + template label + quick preview).
     - Create/Edit flows.
   - Editor behavior:
     - Choose template (from API), then generate inputs from descriptor.
     - Debounce “resolve” calls to backend and render returned SVG via `dangerouslySetInnerHTML`.
     - Preview container simulates a 16:9 video frame with the SVG anchored at bottom.
   Testing:
   - Manual: create a preset, change text/colors, preview updates immediately, refresh keeps values.
   Checkpoint: Wait for developer approval before proceeding.

6. `/produce` integration: select/clear lower third preset and store snapshot
   Status: Completed
   - Add a “Lower Third (optional)” card similar to Audio Config / Logo Config:
     - Choose (route-based picker) + Clear + Manage presets link to `/lower-thirds`.
     - Persist selection in URL (e.g. `lowerThirdConfigId=123`).
   - On “Produce” submit:
     - Store `lowerThirdConfigId` + a `lowerThirdSnapshot` in `productions.config`:
       - `template_key`, `template_version`, `params` (and optionally resolved SVG S3 pointer).
     - (Optional, recommended) Upload the resolved SVG to S3 (private bucket) and store pointer in config for future ffmpeg overlay plan.
   Testing:
   - Manual: pick preset → create production → production settings JSON includes snapshot fields.
   Checkpoint: Wait for developer approval before proceeding.

7. Menu wiring (optional)
   Status: Completed
   - Add “Lower Thirds” entry under “My Assets” linking to `/lower-thirds`.
   Testing:
   - Manual: menu entry appears and loads page.
   Checkpoint: Wait for developer approval before proceeding.
