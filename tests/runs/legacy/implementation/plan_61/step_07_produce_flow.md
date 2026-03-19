# Plan 61 — Step 7 (Archive Draft After Produce)

## Change
- `POST /api/productions` accepts optional `draftId`.
- When present, server archives the draft after successfully creating the production (best-effort; production create succeeds even if archive fails).

## Manual checks
- Start a draft on `/produce?upload=<id>` (change any selection so autosave persists).
- Click `Produce`.
- Verify:
  - Production is created.
  - Visiting `/uploads` shows `New Production` for that upload (draft was archived).
  - Visiting `/produce?upload=<id>` starts a new empty draft (previous draft stays archived).

