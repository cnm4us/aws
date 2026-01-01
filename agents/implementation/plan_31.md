# Implementation Plan 31: System Audio Library (site_admin-managed, user-selectable)

## Goal

- Users can **choose** from a **system-provided** audio library when building productions.
- Users **cannot upload/manage** audio (copyright risk).
- `/uploads?kind=audio` becomes **site_admin-only** and is moved into **server-rendered** `/admin/*` pages.
- `/produce` continues to work for all users, but removes the “Manage audio” link for non-admins.

## Key Decisions

- Use a **system-scoped flag** on uploads instead of tying “system audio” to a human admin account.
  - Add `uploads.is_system TINYINT(1) NOT NULL DEFAULT 0`.
  - System audio rows: `kind='audio' AND is_system=1`.
  - Admin actions will record the acting admin in app logs (future: add `created_by_user_id` if we need in-DB audit).
- System audio is selectable by **any logged-in user** (not anonymous).
- Deleting system audio is a **hard delete** from S3 (no soft-delete / `source_deleted_at` for system audio).
- Audio picker will display a small **“System Audio”** badge for these items.

## Step-by-step

### 1) Schema: mark system uploads

- Add `uploads.is_system TINYINT(1) NOT NULL DEFAULT 0` in `src/db.ts` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- Optional (if helpful for queries): `CREATE INDEX idx_uploads_kind_system_status (kind, is_system, status, id)` guarded in try/catch.

Testing:
- `npm run build`
- Verify: `DESCRIBE uploads;` or `SHOW COLUMNS FROM uploads LIKE 'is_system';`

### 2) Server/API: system audio list + file access rules

- Add a dedicated read-only endpoint for the **system audio library**, e.g.:
  - `GET /api/system-audio` (or `GET /api/uploads?kind=audio&scope=system`)
  - Returns only: `kind='audio' AND is_system=1 AND status='completed'` (and not `source_deleted_at` if applicable).
- Require authentication for this endpoint (any logged-in user can read).
- Ensure `GET /api/uploads/:id/file` (or equivalent download/stream route) allows access to:
  - system audio (`is_system=1`) for authenticated users (or public if desired later),
  - while keeping user-owned uploads protected as they are today.

Testing:
- As a normal user, open `/produce?upload=…`, open audio picker, confirm list loads and audio playback works.

### 3) Admin-only management: move audio management under `/admin/*` (server-rendered)

- Add server-rendered routes (site_admin-only):
  - `GET /admin/audio` → list system audio uploads + “Upload” button
  - `GET /admin/audio/new` → upload form/workflow for audio
  - `POST /admin/audio` (or use existing upload endpoints) → creates an upload row with `is_system=1` and initiates upload
  - `DELETE /admin/audio/:uploadId` → hard-deletes the S3 object(s) and removes the upload row
- Add a warning on delete: existing productions/publications keep working (audio is baked into outputs), but users can’t re-produce with that audio after deletion.
- Update routing:
  - `/uploads?kind=audio`:
    - for site_admin: redirect to `/admin/audio`
    - for non-admin: redirect to `/uploads` (videos) or return 403

Testing:
- As site_admin: confirm you can upload/delete system audio from `/admin/audio`.
- As non-admin: confirm you cannot access `/admin/audio` and `/uploads?kind=audio`.

### 4) Frontend: remove “Manage audio” link for normal users; keep selection

- On `frontend/src/app/Produce.tsx`:
  - keep the audio picker UI (selection + playback),
  - load from the new system-audio endpoint (or updated uploads query),
  - remove/hide the “Manage audio” link unless `me` is site_admin (or remove entirely).
- In the picker list UI, add a small “System Audio” badge per row.
- On the main assets menu (`frontend/src/menu/contexts/MyAssets.tsx`):
  - hide “Audio” for non-admins (since it’s now `/admin/audio`), or change it to a safe destination.

Testing:
- Normal user: no audio management links visible; selection still works.
- Site admin: sees admin navigation to `/admin/audio`.

### 5) Data migration: reclassify existing audio rows as system audio

- One-time SQL (tightly scoped) to set `is_system=1` for existing audio uploads that should be in the library.
  - Example criterion: `kind='audio'` (and optionally `user_id IS NOT NULL` → move to system).
- Decide whether to keep/delete any user-uploaded audio content; default: **keep** but mark as system so it stays usable.

Testing:
- Confirm `/api/system-audio` returns expected items.
- Confirm users can still pick the reclassified audio.

### 6) Document and commit

- Update any admin navigation docs if needed.
- Build:
  - `npm run build`
  - `npm run web:build:scoped`
- Commit with message like: `System audio library (admin-managed)`.

## Open Questions (confirm before implementation)

All confirmed:
- Any logged-in user can select system audio.
- Hard-delete for system audio.
- Show “System Audio” badge in the picker.
