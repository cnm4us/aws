# Implementation Plan: Draft Editing + Publish for Rules (Phase 3)

## 1. Overview

Goal: Let site admins iteratively edit the “head” of a rule without creating new versions, then publish a new immutable `rule_versions` snapshot when ready. Title and category changes apply immediately on Save.

In scope:
- Add a per-rule “draft” record that is editable and can be published into a new `rule_versions` row.
- Admin UI for editing drafts with two actions: **Save** (updates draft + rule metadata) and **Publish Version** (creates new version + updates `current_version_id`).
- Keep published versions immutable and keep `/rules/:slug/v:n` as a stable historical permalink.
- Real-environment tests after each step using `scripts/auth_curl.sh`, with results logged under `agents/implementation/tests/plan_10/`.

Out of scope (for this plan):
- Moderation workflows and reporting UI (flagging, sanctions, per-space rule sets).
- Multi-author concurrency controls, review/approval states, or rich diffing.
- Public draft previews in the user-facing UI (drafts remain admin-only).

References:
- `src/db.ts` — schema creation/upgrade.
- `src/routes/pages.ts` — `/admin/rules*` and `/rules*` routes.
- `public/admin/ckeditor_markdown.js` — WYSIWYG editor integration for admin-only markdown fields.
- `scripts/auth_curl.sh` — authenticated curl wrapper for step-by-step testing.
- `agents/implementation_planning.md` — testing + logging conventions.

Test harness conventions:
- Use `BASE_URL="https://aws.bawebtech.com"` for the real environment when available.
- Store real command outputs in `agents/implementation/tests/plan_10/step_XX_*.md`.
- Never log credentials or cookies; rely on `scripts/auth_curl.sh` profiles.

---

## 2. Step-by-Step Plan

1. Add `rule_drafts` table (schema only)  
   Status: Completed  
   Implementation:
   - Add a `rule_drafts` table with 1 row per rule:
     - `rule_id` (PK, FK to `rules.id`)
     - `markdown`, `html`
     - `short_description`
     - `allowed_examples_markdown/html`
     - `disallowed_examples_markdown/html`
     - `guidance_markdown/html`
     - `updated_by`, `updated_at`
   - Add idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` upgrades for the above columns (to match the repo’s schema pattern).
   Testing (canonical, expected):
   - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super get /admin/rules` → `HTTP 200` (still loads).
   - Record actual output: `agents/implementation/tests/plan_10/step_01_schema.md`  
   Checkpoint: Wait for developer approval before proceeding.

2. Add draft creation/load helper (copy from current published)  
   Status: Completed  
   Implementation:
   - Implement `getOrCreateRuleDraft(ruleId)` in `src/routes/pages.ts`:
     - If draft exists: return it.
     - Else: create draft by copying fields from the current published version (`rules.current_version_id`).
   - Ensure the draft always has `markdown/html` and the auxiliary fields; missing columns default to empty/null.
   Testing (canonical, expected):
   - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super get /admin/rules/:id/edit` → `HTTP 200` and contains “Save” + “Publish Version”.
   - Record actual output: `agents/implementation/tests/plan_10/step_02_draft_load.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Build admin “Edit Draft” UI with Save + Publish buttons  
   Status: Completed  
   Implementation:
   - Add `GET /admin/rules/:id/edit` that renders the draft editing form:
     - Title (text), Category (select), Visibility (optional if we keep it here), Short Description (plain textarea), and the WYSIWYG-backed markdown fields.
     - Two submit buttons:
       - **Save** → updates draft + `rules.title` + `rules.category_id` (and optionally `rules.visibility` if included).
       - **Publish Version** → publishes the draft into a new immutable version (Step 5).
   - Add “Edit Draft” links:
     - On `/admin/rules` list page row actions.
     - On `/admin/rules/:id` detail page.
   Testing (canonical, expected):
   - `BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super get /admin/rules/:id/edit` → `HTTP 200` and contains the fields + two buttons.
   - Record actual output: `agents/implementation/tests/plan_10/step_03_edit_links.md`  
   Checkpoint: Wait for developer approval before proceeding.

4. Implement “Save” (draft updates only; no new version)  
   Status: Completed  
   Implementation:
   - Add `POST /admin/rules/:id/edit` (or `.../draft/save`) that:
     - Updates `rules.title` and `rules.category_id` immediately.
     - Updates `rule_drafts.*` fields from the submitted form.
     - Renders markdown to HTML server-side (reusing `renderMarkdown`) for each markdown-backed field and stores both markdown + html.
   - Ensure it does **not** insert into `rule_versions` and does **not** update `rules.current_version_id`.
   Testing (canonical, expected):
   - Create a fresh rule for testing (unique slug).
   - Save a draft change, then confirm published view is unchanged:
     - `./scripts/auth_curl.sh get /api/rules/<slug>` → still returns the old published `html` (no change after Save).
   - Record actual output: `agents/implementation/tests/plan_10/step_04_save.md`  
   Checkpoint: Wait for developer approval before proceeding.

5. Implement “Publish Version” (draft → new immutable version)  
   Status: Completed  
   Implementation:
   - Add publish handler that:
     - Reads draft fields.
     - Inserts a new `rule_versions` row with `version = MAX(version)+1` for the rule.
     - Updates `rules.current_version_id` to the new version id.
     - Optionally refreshes the draft by copying the just-published version back into `rule_drafts` (so draft stays aligned after publishing).
   - Keep `rule_versions` immutable (no edit route).
   Testing (canonical, expected):
   - After Step 4’s saved draft change:
     - Publish, then confirm public latest shows new content:
       - `./scripts/auth_curl.sh get /api/rules/<slug>` → new `html` now visible.
       - `curl -sS "$BASE_URL/rules/<slug>/v:1"` → old content still visible.
       - `curl -sS "$BASE_URL/rules/<slug>/v:2"` → new content visible.
   - Record actual output: `agents/implementation/tests/plan_10/step_05_publish.md`  
   Checkpoint: Wait for developer approval before proceeding.

6. UX polish: indicate “unpublished draft changes” in admin list/detail  
   Status: Completed  
   Implementation:
   - On `/admin/rules`, add a small “Draft” indicator when a draft exists and `draft.updated_at` is newer than the current published version’s `created_at`.
   - On `/admin/rules/:id`, show:
     - “Edit Draft” link
     - “Current published version vN”
     - “Draft last saved …”
   Testing (canonical, expected):
   - Save draft without publishing; `/admin/rules` shows indicator.
   - Publish; indicator clears (if draft refreshed).
   - Record actual output: `agents/implementation/tests/plan_10/step_06_draft_indicator.md`  
   Checkpoint: Wait for developer approval before proceeding.

7. Optional backfill: create drafts for all existing rules (script)  
   Status: Completed  
   Implementation:
   - Add a dedicated script (one-off) to populate `rule_drafts` for existing rules by copying from `current_version_id`.
   - Keep the system functional without it (drafts can be created lazily on first edit).
   Testing (canonical, expected):
   - Run script; verify `GET /admin/rules/:id/edit` works without creating draft on-demand.
   - Record actual output: `agents/implementation/tests/plan_10/step_07_backfill.md`  
   Checkpoint: Wait for developer approval before proceeding.

---

## 3. Risks / Edge Cases

- Draft vs published divergence: ensure Save never mutates published `rule_versions` and published routes continue to use `rules.current_version_id`.
- WYSIWYG conversion: HTML→Markdown conversion can normalize formatting; keep `renderMarkdown` as the only HTML source of truth for stored `*_html` columns.
- Title/category immediate-save: published permalinks for older versions will display the *current* rule title (unless we later version title/category); acceptable for now per decision.
- “Publish” race conditions: if multiple admins publish concurrently, use a transaction and `SELECT MAX(version)` + insert to avoid duplicate version numbers.

## 4. Open Questions (max 3)

1. Should **visibility** be editable on the draft page (applies immediately), or only on the rule metadata page?
2. After “Publish Version”, should we auto-clear/refresh the draft to the published content, or keep the draft as-is?
3. Should “Save” require a change summary, or keep change summary publish-only (recommended: publish-only)?
