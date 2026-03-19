# Plan 68 — Step 6 (/exports) Test Log

## Build
- `npm run web:build`

## Manual
- Export a Create Video project (wait for completion).
- Verify redirect to `/exports`.
- On `/exports`:
  - “Open Timeline” navigates to `/create-video?project=<id>`.
  - “Send to HLS” creates a new production and navigates to `/productions?id=<id>`.

