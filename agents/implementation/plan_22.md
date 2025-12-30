# Implementation Plan 22: Upload Tabs + Logo/Audio Assets (Storage + Listing Only)

## 1. Goal

Add first-class support for **Logo** and **Audio** assets alongside existing **Video** uploads:
- `/uploads` becomes a tabbed view with:
  - **Videos** (default)
  - **Logos**
  - **Audio**
- Users can upload/list Logos and Audio assets.
- New uploads are stored under typed S3 prefixes:
  - `videos/YYYY-MM/DD/<uuid>/<filename>` (new uploads only; existing video keys remain supported)
  - `logos/YYYY-MM/DD/<uuid>/<filename>`
  - `audio/YYYY-MM/DD/<uuid>/<filename>`

Out of scope (explicitly deferred to a later plan):
- Selecting a logo/audio in the production builder.
- MediaConvert watermarking/opacity settings.
- MediaConvert audio overlay/mix/fade implementation.

---

## 2. Data Model / Storage

### 2.1 Add `uploads.kind`

Add a column to `uploads`:
- `kind ENUM('video','logo','audio') NOT NULL DEFAULT 'video'`

Backfill:
- Existing rows default to `video`.

### 2.2 S3 Key Structure

Use typed prefixes for **new uploads**:
- Videos: `videos/YYYY-MM/DD/<uuid>/<filename>`
- Logos: `logos/YYYY-MM/DD/<uuid>/<filename>`
- Audio: `audio/YYYY-MM/DD/<uuid>/<filename>`

Backward compatibility:
- Continue to support existing video keys that do not start with `videos/`.
- No migration of existing objects in this plan.

---

## 3. Backend Changes

### 3.1 Upload create/init accepts `kind`

Wherever we currently create upload records / presigned POSTs:
- Add optional input: `kind` (defaults to `video`).
- Persist to DB on upload record creation.
- Use `kind` to choose the prefix when generating the S3 key.

Validation:
- Only allow `video | logo | audio`.

### 3.2 Upload listing supports filtering by kind

Add/extend query parameter:
- `GET /api/uploads?kind=video|logo|audio`

Default behavior:
- If `kind` omitted, return `video` uploads (keeps existing UI behavior).

### 3.3 Upload detail endpoint includes kind

Ensure `GET /api/uploads/:id` returns `kind` so the UI can render appropriately.

---

## 4. Frontend Changes

### 4.1 `/uploads` tabs

On `frontend/src/app/Uploads.tsx`:
- Add tabs at the top:
  - Videos → `/uploads?kind=video` (or omit query to preserve current default)
  - Logos → `/uploads?kind=logo`
  - Audio → `/uploads?kind=audio`
- Tabs should not prefetch admin bundles; keep as normal SPA navigation.

### 4.2 Tab-specific UI text and actions

**Videos tab**
- Change heading/button text:
  - “Upload Files” → “Upload Video”
- Keep “View Productions”.

**Logos tab**
- List logo uploads (same list component, filtered).
- Add “Upload Logo” CTA linking to `/uploads/new?kind=logo` (recommended) or `/uploads/new` with internal selection.

**Audio tab**
- List audio uploads (same list component, filtered).
- Add “Upload Audio” CTA linking to `/uploads/new?kind=audio`.

### 4.3 `/uploads/new` supports kind

On `frontend/src/app/UploadNew.tsx`:
- Read `kind` from query (`video|logo|audio`) default `video`.
- Update UI copy accordingly:
  - “Upload Video” / “Upload Logo” / “Upload Audio”
- Pass `kind` through to the upload-init endpoint so it stores the correct `uploads.kind` and S3 prefix.

File-type constraints (optional, but recommended in this plan):
- For logos: accept `image/png`, `image/jpeg`, `image/svg+xml` (confirm).
- For audio: accept `audio/mpeg`, `audio/wav`, `audio/aac`, `audio/mp4` (confirm).
- For videos: unchanged.

---

## 5. Migration / Schema

- Add `uploads.kind` column + index (optional):
  - `INDEX(kind, created_at)` to support tab listing efficiently.

---

## 6. Testing / Verification

- `npm run web:build` succeeds.
- Manual smoke:
  - `/uploads` defaults to Videos.
  - Clicking Logos shows only logo uploads and “Upload Logo”.
  - Clicking Audio shows only audio uploads and “Upload Audio”.
  - Creating a Logo upload stores S3 key under `logos/...` and `uploads.kind='logo'`.
  - Creating an Audio upload stores S3 key under `audio/...` and `uploads.kind='audio'`.
  - Creating a Video upload stores S3 key under `videos/...` (new uploads only) and `uploads.kind='video'`.
  - Existing videos with old key format remain visible/playable.

---

## 7. Open Questions

1. File types:
   - Logos: which formats do you want to allow (PNG only vs PNG/JPG/SVG)?
   - Audio: which formats (MP3/WAV/AAC/M4A)?

2. Size limits:
   - Keep the same MB limit as video uploads, or set smaller limits for logos/audio?

3. UI routing:
   - Confirm using `?kind=` for tabs (`/uploads?kind=logo`) rather than separate routes (`/uploads/logos`).

