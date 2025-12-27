# Implementation Plan: Split Rule Guidance (Moderators vs AI Agents)

## 1. Overview

Goal: Split the existing Rules “Guidance” field into two separate fields across admin UI, drafts, versions, and rule viewing surfaces:
- **Guidance for Moderators** (`*_guidance_moderators_markdown/html`)
- **Guidance for AI Agents** (`*_guidance_agents_markdown/html`)

In scope:
- DB schema changes for `rule_versions` and `rule_drafts`.
- Admin edit UIs (`/admin/rules/:id/edit` draft editor and the “New version” form) to view/edit/save/publish both fields.
- Data migration: move existing `guidance_markdown/html` into the new “Guidance for Moderators” columns.
- Rule viewing surfaces:
  - SPA `/rules/:slug` via `GET /api/rules/:slug`
  - Historical `/rules/:slug/v:n` server-rendered view

Out of scope:
- Changing who can view guidance (unless explicitly approved as part of this plan).
- Dropping legacy DB columns (`guidance_markdown/html`) (optional follow-up only, requires explicit approval per `agents/db_access.md`).

References:
- `src/db.ts` — schema evolution for `rule_versions`/`rule_drafts`.
- `src/routes/pages.ts` — admin rules editor, save/publish, rule APIs, historical rule rendering.
- `frontend/src/app/RuleView.tsx` — SPA rule viewer that currently consumes `guidanceHtml`.
- `scripts/backfill-rule-drafts.ts` — optional script that populates missing drafts from current published versions.
- `agents/db_access.md` — destructive DB ops require explicit approval.

Test harness conventions:
- Use `scripts/auth_curl.sh` for authenticated checks and store real outputs in `agents/implementation/tests/plan_11/`.

---

## 2. Step-by-Step Plan

1. Add new guidance columns + backfill moderators guidance  
   Status: Completed (2025-12-26)  
   Implementation:
   - In `src/db.ts`, add the following columns (idempotent) to both tables:
     - `rule_versions`:
       - `guidance_moderators_markdown`, `guidance_moderators_html`
       - `guidance_agents_markdown`, `guidance_agents_html`
     - `rule_drafts`:
       - `guidance_moderators_markdown`, `guidance_moderators_html`
       - `guidance_agents_markdown`, `guidance_agents_html`
   - Backfill (idempotent, non-destructive):
     - Copy existing legacy `guidance_markdown/html` into the new moderators columns where the new columns are NULL.
     - Do this for both `rule_versions` and `rule_drafts`.
   Testing:
   - Canonical (expected): `BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /admin/rules` → `HTTP 200`.  
   - Record actual output: `agents/implementation/tests/plan_11/step_01_schema.md`  
   Checkpoint: Wait for developer approval before proceeding.

2. Update admin “Edit Draft” UI to show two guidance fields  
   Status: Completed (2025-12-26)  
   Implementation:
   - In `src/routes/pages.ts` (`renderRuleDraftEditPage`), replace “Guidance” with:
     - “Guidance for Moderators”
     - “Guidance for AI Agents”
   - Ensure both fields use the same WYSIWYG-backed markdown pattern (`data-md-wysiwyg=1`, `data-md-initial-html=...`) as the existing markdown fields.
   - Loading behavior:
     - Prefer new columns on `rule_drafts`.
     - Fallback for moderators field only: if `guidance_moderators_*` is empty/NULL and legacy `guidance_*` exists (older DB), treat legacy as moderators guidance.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get "/admin/rules/:id/edit" | rg -n "Guidance for Moderators|Guidance for AI Agents"` → matches both labels.  
   - Record actual output: `agents/implementation/tests/plan_11/step_02_admin_ui.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Update Save + Publish to persist both guidance fields (drafts + versions)  
   Status: Completed (2025-12-26)  
   Implementation:
   - In `POST /admin/rules/:id/edit`:
     - Accept two inputs (e.g., `guidanceModerators` and `guidanceAgents`).
     - Render markdown to HTML server-side for each and store both markdown + html on `rule_drafts`.
     - On Publish, insert both sets into `rule_versions` and update `rules.current_version_id` as today.
   - In draft creation code (`getOrCreateRuleDraft` and the in-transaction “ensure draft exists” copy), copy:
     - new `guidance_moderators_*` and `guidance_agents_*` when present
     - fallback: legacy `guidance_*` → moderators guidance
   Testing:
   - Canonical (expected):
     - Save: `./scripts/auth_curl.sh --profile super post "/admin/rules/:id/edit" -d "action=save&guidanceModerators=...&guidanceAgents=..."` → `HTTP 302` redirect.  
     - Publish: same with `action=publish` → `HTTP 302` and notice “Published vN.”  
   - Record actual output: `agents/implementation/tests/plan_11/step_03_save_publish.md`  
   Checkpoint: Wait for developer approval before proceeding.

4. Update “New version” form to edit both guidance fields  
   Status: Completed (2025-12-26)  
   Implementation:
   - In `src/routes/pages.ts`:
     - Update `renderRuleForm` (used by `/admin/rules/new` and `/admin/rules/:id/versions/new`) to include the two guidance fields using the established markdown editor pattern.
     - Update `GET /admin/rules/:id/versions/new` to preload both guidance fields from `rules.current_version_id` (with legacy fallback → moderators guidance).
     - Update `POST /admin/rules/:id/versions/new` to persist both guidance fields into `rule_versions`.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get "/admin/rules/:id/versions/new" | rg -n "Guidance for Moderators|Guidance for AI Agents"` → matches.  
   - Record actual output: `agents/implementation/tests/plan_11/step_04_new_version_form.md`  
   Checkpoint: Wait for developer approval before proceeding.

5. Update rule viewing surfaces (API + SPA + historical HTML)  
   Status: Completed (2025-12-26)  
   Implementation:
   - In `GET /api/rules/:slug`:
     - Replace `guidanceHtml` with two optional fields:
       - `guidanceModeratorsHtml`
       - `guidanceAgentsHtml`
     - Apply the existing guidance visibility guard (`canViewGuidance`) to both fields.
   - In `frontend/src/app/RuleView.tsx`:
     - Update types + rendering to support both guidance sections (separately and clearly labeled).
   - In historical HTML route `/rules/:slug/v:n`:
     - Render “Guidance for Moderators” and “Guidance for AI Agents” sections when the viewer can see guidance.
   Testing:
   - Canonical (expected):
     - Unauth: `curl -sS "$BASE_URL/api/rules/<slug>" | rg -n "guidance"` → no guidance fields present.
     - Admin: `./scripts/auth_curl.sh --profile super get "/api/rules/<slug>" | rg -n "guidanceModeratorsHtml|guidanceAgentsHtml"` → present when set.  
   - Record actual output: `agents/implementation/tests/plan_11/step_05_rule_viewing.md`  
   Checkpoint: Wait for developer approval before proceeding.

6. Update maintenance/backfill scripts to include new columns  
   Status: Completed (2025-12-26)  
   Implementation:
   - Update `scripts/backfill-rule-drafts.ts` to copy:
     - `guidance_moderators_*` and `guidance_agents_*` from current `rule_versions` into missing `rule_drafts` rows.
     - fallback: legacy `guidance_*` → moderators guidance (for older databases).
   Testing:
   - Canonical (expected): `node ./scripts/backfill-rule-drafts.ts` → prints “Inserted N missing rule_drafts rows.”  
   - Record actual output: `agents/implementation/tests/plan_11/step_06_backfill_script.md`  
   Checkpoint: Wait for developer approval before proceeding.

7. Deferred cleanup: drop legacy `guidance_*` columns (explicit approval required)  
   Status: Deferred  
   Preconditions:
   - Verify production/staging has been migrated and all rules retain moderators guidance in `guidance_moderators_*`.
   - Verify code no longer needs legacy fallback and no DB environments depend on legacy columns.
   Implementation:
   - Remove legacy fallback logic (treat legacy `guidance_*` as moderators guidance) from:
     - draft creation/copy paths
     - admin forms (preload + save/publish)
     - rule APIs and historical renderers
     - `scripts/backfill-rule-drafts.ts`
   - Apply destructive schema change (requires explicit “yes, run this now”):
     - `ALTER TABLE rule_versions DROP COLUMN guidance_markdown, DROP COLUMN guidance_html;`
     - `ALTER TABLE rule_drafts DROP COLUMN guidance_markdown, DROP COLUMN guidance_html;`
   Testing:
   - Canonical (expected): `BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super get "/admin/rules/:id/edit"` → `HTTP 200` and both guidance editors render.  
   - Record actual output: `agents/implementation/tests/plan_11/step_07_drop_legacy.md`  
   Checkpoint: Wait for developer approval before proceeding.

---

## 3. Risks / Edge Cases

- Backwards compatibility: older DBs may still have only legacy `guidance_*` columns; code should treat legacy as moderators guidance until migrations run.
- Partial migration: ensure backfill does not overwrite existing `guidance_moderators_*` content.
- API contract change: `/api/rules/:slug` currently returns `guidanceHtml`; the SPA must be updated in the same step to avoid a broken `/rules/:slug` page.

## 4. Decisions (confirmed)

- Access control: gate `guidance_agents_*` exactly the same as moderators guidance (`canViewGuidance`).
- UI surfaces: show “Guidance for AI Agents” in `/rules/:slug` (SPA) for moderators/admin (same gating as above).
- Cleanup: plan a later explicit drop step for legacy `guidance_markdown/html` columns after verification (see Step 7).
