# Plan 114A: Prompt Content Registry (`/admin/prompts`)

## Goal
Create a managed prompt catalog that admins can edit without code deploys.

## Scope
- Prompt model + storage
- Admin CRUD UI
- Prompt preview
- Prompt lifecycle (`draft`, `active`, `paused`, `archived`)

Out of scope:
- Rule logic (handled in `plan_114B`)
- Feed insertion logic (handled in `plan_114D`)

## Data Model (V1)
- `id`
- `name` (internal admin label)
- `kind` (`prompt_full` | `prompt_overlay`)
- `headline`
- `body`
- `cta_primary_label`, `cta_primary_href`
- `cta_secondary_label`, `cta_secondary_href` (optional)
- `media_upload_id` (optional for overlay/video-backed prompt)
- `category` (e.g. `register_prompt`)
- `priority` (integer)
- `status`
- `starts_at`, `ends_at` (optional)
- `created_by`, `updated_by`, timestamps

## API (V1)
- `GET /api/admin/prompts`
- `POST /api/admin/prompts`
- `PATCH /api/admin/prompts/:id`
- `POST /api/admin/prompts/:id/clone`
- `POST /api/admin/prompts/:id/status`

## UI
- New admin surface: `/admin/prompts`
- List view: status, category, type, priority, active window
- Edit form: copy, CTAs, type, media, schedule, status
- Preview pane:
  - full-slide preview
  - overlay preview

## Acceptance Criteria
1. Admin can create/edit/activate/deactivate prompts.
2. Prompt content validates CTA links and required fields.
3. Prompt records are version-safe and auditable.
4. Feed service can fetch active prompts by category/type.

## Observability
- Audit log event on create/update/status-change.
- Trace tag: `app.operation=admin.prompts.write`.

