# Plan 39 – Step 5: Productions upload preview modal

Date: 2026-01-04

## Typecheck

```bash
npm run build
```

Result: success.

## Manual test
- Open `/productions?upload=<id>`.
- Tap the upload thumbnail → modal opens.
- Video plays from `/api/uploads/<id>/file` (Range-supported), with Close button.
