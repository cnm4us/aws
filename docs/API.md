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

UploadRow (selected fields)
- id, s3_bucket, s3_key, original_filename, content_type, size_bytes
- width, height, duration_seconds
- status, etag, mediaconvert_job_id, output_prefix, profile, asset_uuid, date_ymd
- cdn_prefix, cdn_master, s3_master (computed)
