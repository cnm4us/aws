# Plan 68 — Step 7 (/uploads source-only) Test Log

## Build
- `npm run web:build`

## Manual
- Open `/uploads`
- Confirm video list excludes exported videos (`video_role='export'` / `s3_key` under `renders/`).
- Confirm the old per-video cogwheel overlay is gone.
- Confirm rename/description edit still works.

