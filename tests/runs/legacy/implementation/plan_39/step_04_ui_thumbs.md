# Plan 39 – Step 4: UI uses upload thumbnails

Date: 2026-01-04

## Typecheck

```bash
npm run build
```

Result: success.

## Notes
- Updated `frontend/src/app/Uploads.tsx` to prefer `/api/uploads/:id/thumb` for video cards (fallback to existing poster URLs).
- Updated `frontend/src/app/Productions.tsx` to prefer `/api/uploads/:id/thumb` in the productions list + upload header preview (fallback to existing poster URLs).
