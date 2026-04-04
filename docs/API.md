# API

Auth: cookie session in development (httpOnly `sid` + `csrf` cookie). `x-admin-token` still allowed for automation.

- GET /health → { ok: true }
- GET /api/me → `{ userId, email, displayName, roles, spaceRoles, personalSpace }`
- POST /api/login { email, password } → `{ ok, userId }` (+ sets `sid`/`csrf` cookies)
- GET /logout → HTML (revokes session, clears cookies)
- POST /api/register { email, password, displayName?, phone? } → `{ ok, userId, space }`
- POST /api/sign-upload { filename, contentType?, sizeBytes?, width?, height?, durationSeconds? }
  - → { id, key, bucket, post: { url, fields } }
- POST /api/mark-complete { id, etag?, sizeBytes? } → { ok: true }
- GET /api/uploads?limit=50[&status=uploaded] → UploadRow[]
- GET /api/uploads/:id → UploadRow with cdn_master/s3_master
- GET /api/profiles → { profiles: string[] }
- POST /api/publish { id, profile?, quality?, sound? }
  - profile: name under jobs/profiles (omit to auto-select by orientation)
  - quality: "standard" | "hq"
  - sound: "original" | "normalize"

Pages / Docs APIs
- GET /api/pages
  - Returns root page tree listing (visible nodes only), with section/document metadata.
- GET /api/pages/:path
  - Resolves a page node by hierarchical path traversal (`parent_id` + slug segments).
  - Returns node content + child listing when children exist.
- Visibility filtering for both endpoints:
  - `public`
  - `authenticated`
  - `space_moderator`
  - `space_admin`
  - Response is filtered by current user/session permissions.

Admin Pages (Site Admin)
- GET /admin/pages
  - Hierarchical manager view (root + nested cards), including sibling ordering controls.
- GET /admin/pages/new
  - Create node with:
    - `type` (`section` or `document`)
    - optional `parentId`
    - `sortOrder`
    - `slug` (segment)
- POST /admin/pages
  - Creates node; enforces parent/type/slug constraints.
- GET /admin/pages/:id
  - Edit node.
- POST /admin/pages/:id
  - Updates node and allows reparenting with cycle checks.
- POST /admin/pages/:id/move-up
- POST /admin/pages/:id/move-down
  - Swaps `sort_order` with adjacent sibling.

UploadRow (selected fields)
- id, s3_bucket, s3_key, original_filename, content_type, size_bytes
- width, height, duration_seconds
- status, etag, mediaconvert_job_id, output_prefix, profile, asset_uuid, date_ymd
- cdn_prefix, cdn_master, s3_master (computed)
