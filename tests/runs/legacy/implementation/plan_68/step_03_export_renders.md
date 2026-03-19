# Plan 68 — Step 3 (Export to `renders/` + stamp upload metadata)

Date: 2026-01-25

## Summary
- Create Video export MP4s now write to `renders/...` via `buildExportKey(...)`.
- Export uploads are inserted with:
  - `uploads.video_role='export'`
  - `uploads.create_video_project_id=<projectId>`
- Added `scripts/backfill-create-video-exports.ts` for historical exports.

## Manual Verification

### Export job completion
Project 1 export status:
```bash
BASE_URL=http://localhost:3300 ./scripts/auth_curl.sh --profile super get /api/create-video/projects/1/export-status
```
Result: `status=completed`, `resultUploadId=516`

### Upload record
```bash
BASE_URL=http://localhost:3300 ./scripts/auth_curl.sh --profile super get /api/uploads/516
```
Observed:
- `s3_key` begins with `renders/`
- `video_role` = `export`
- `create_video_project_id` = `1`

