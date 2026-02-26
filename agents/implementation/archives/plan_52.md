# Plan 52: License Source + User Rights Attestation

## Goal
Add metadata to support (1) tracking where **system audio** was licensed from and (2) capturing a **user attestation** when users upload their own content, without overloading a single “source” concept.

This plan introduces:
- **License Source** (vendor/platform) for system-provided assets (initially: system audio).
- **Rights Attestation** for user uploads (initially: user video uploads), including terms version + acceptance timestamp.

## Why not “user provided” as a License Source?
“User provided” answers *who uploaded it* (origin), not *what license/vendor governs it*. For clarity:
- Origin is inferred (`uploads.is_system` / `uploads.user_id`).
- License source tracks external vendor/platform for system assets.
- User uploads store an attestation record instead of pretending they came from a vendor.

## Scope (MVP)
### System audio
- Add `License Source` selection at upload time and edit time for system audio.
- Show license source in admin UI; optionally expose it to creator-facing picker later.

### User uploads (videos)
- Add a required “I have rights to upload this content” checkbox on `/uploads/new` when `kind=video`.
- Persist an immutable acceptance record for the upload (terms version, accepted_at, ip, user_agent).

## Out of scope (future)
- Per-space publishing terms, takedown workflows, and DMCA tooling.
- User-uploaded audio (currently site_admin-only).
- Full-text search across artist/genre/mood/source (can be added later if needed).

## Data model
### A) License sources
Create a new table to avoid enums and allow easy growth:
- `license_sources`
  - `id` BIGINT PK
  - `kind` ENUM('audio') (or VARCHAR with allowlist)
  - `name` VARCHAR(120)
  - `slug` VARCHAR(140) UNIQUE (per kind)
  - `archived_at` TIMESTAMP NULL
  - `created_at`, `updated_at`

Add to `uploads`:
- `license_source_id` BIGINT NULL
  - Only meaningful for `kind='audio' AND is_system=1` in MVP.

### B) User rights attestations
Create a dedicated table (keeps uploads table clean; supports future re-acceptance/versioning):
- `upload_rights_attestations`
  - `id` BIGINT PK
  - `upload_id` BIGINT UNIQUE
  - `user_id` BIGINT
  - `terms_key` VARCHAR(64) (e.g. 'ugc_upload')
  - `terms_version` VARCHAR(32) (e.g. '2026-01-10')
  - `accepted_at` TIMESTAMP
  - `accepted_ip` VARCHAR(64) NULL
  - `user_agent` VARCHAR(512) NULL

## Backend changes
1. DB bootstrap/migrations in `src/db.ts`
   - Create `license_sources` + `upload_rights_attestations`
   - Add `uploads.license_source_id` (nullable) + indexes

2. Admin routes (server-rendered)
   - `/admin/license-sources?kind=audio`
     - Create, rename, archive/unarchive sources (like `/admin/audio-tags`)
   - `/admin/audio/:id`
     - Add dropdown for `License Source`
   - `/uploads/new?kind=audio`
     - Add dropdown for `License Source` (plus existing Artist/Tags)

3. Upload signing flow
   - Extend `/api/sign-upload` to accept:
     - `licenseSourceId` (for system audio only)
     - `rightsAttested` boolean + `termsVersion` (for video uploads)
   - Enforce:
     - If `kind=video`, `rightsAttested` must be true (MVP requirement).
     - If `kind=audio AND is_system`, allow `licenseSourceId` and persist it.

## Frontend changes
1. `/uploads/new` (UploadNew)
   - For `kind=video`: show required checkbox + link to terms page; block submit if unchecked.
   - For `kind=audio` (site_admin): show `License Source` dropdown above tags.

2. Optional (MVP+):
   - Creator audio picker: add a “Source” line or filter (defer unless requested).

## Terms content (clarification)
This is **not** a PDF upload workflow. The idea is:
- We host the terms as a normal web page (recommended: server-rendered `/terms/upload`) so users can read it.
- The upload UI links to that page next to the checkbox.
- We store a `terms_version` string in code or env so we can intentionally bump it later and re-prompt users.

If you prefer a PDF later, we can add a link to a PDF (stored in S3/CloudFront), but the MVP doesn’t require PDF handling.

## Recommended structure for “one-time checkbox” + “audio is stricter”
To match your preference:

1) **One-time acceptance (any asset, first time)**
- Add `user_terms_acceptances` table keyed by `(user_id, terms_key, terms_version)` so we can:
  - prompt once per version
  - avoid writing a new attestation row for every upload

2) **Per-upload attestation (audio only, when/if we allow user audio uploads)**
- Keep `upload_rights_attestations` for `kind='audio' AND is_system=0` so each audio upload can carry its own explicit assertion record.
- This can be deferred until user-audio uploads are enabled (currently audio uploads are site_admin-only).

## Manual test checklist
1. Create a few audio license sources in `/admin/license-sources`.
2. Upload new system audio and set Source + Tags; verify it persists and shows in `/admin/audio/:id`.
3. Upload a new video:
   - Cannot proceed until checkbox is checked.
   - Attestation row created (verify in DB).

## Open questions
1. Terms text + route: confirm `/terms/upload` is OK, and what is the initial `terms_version` string (e.g. `2026-01-10`)?
2. One-time vs per-upload: confirm the intended behavior:
   - one-time acceptance for all uploads (any kind) ✅
   - plus a stricter per-upload attestation for **user audio uploads** once that feature exists
3. License source enforcement: should `License Source` be required for system audio uploads, or optional with a default like “Unknown/TBD”?
