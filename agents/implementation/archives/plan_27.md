# Implementation Plan 27: “Delete Source Video” (Keep Productions + Publications Working)

## 1. Goal

Allow a user to delete the **original uploaded video file** (the `UPLOAD_BUCKET` object(s)) **without**:
- deleting any **productions** (and their `OUTPUT_BUCKET` renditions), or
- breaking any **existing publications** / feeds that reference the upload.

Key UX note: after deleting the source file, the user will **not** be able to create new productions from that upload anymore.

## 2. Why the Current Delete Can’t Be Used

`DELETE /api/uploads/:id` currently:
- deletes the upload’s S3 prefix in `UPLOAD_BUCKET`
- deletes the upload’s output prefix in `OUTPUT_BUCKET`
- deletes the `uploads` DB row

This would break:
- Feeds (`space_publications JOIN uploads`) if the upload row is removed.
- Playback if output files are removed.

So we need a separate action.

## 3. Data Model Change (Minimal)

Add a marker to uploads so we can:
- block future “Produce” attempts cleanly
- show a “Source deleted” hint in the UI

DB change:
- `uploads.source_deleted_at DATETIME NULL`

Implementation:
- In `src/db.ts` `ensureSchema()`: `ALTER TABLE uploads ADD COLUMN IF NOT EXISTS source_deleted_at DATETIME NULL`

## 4. New API Endpoint

Add a new endpoint (separate from delete upload):
- `POST /api/uploads/:id/delete-source`

Behavior:
- Auth required.
- Permission: same owner/admin check as delete upload (owner with `video:delete_own` or admin).
- Only allowed for `uploads.kind = 'video'` (for now).
- If `source_deleted_at` already set: return `{ ok: true, alreadyDeleted: true }` (idempotent).
- Delete only the upload’s UUID directory prefix in **`UPLOAD_BUCKET`** (best-effort deletePrefix).
- Do **not** delete `OUTPUT_BUCKET` objects.
- Do **not** delete the `uploads` row.
- Set `uploads.source_deleted_at = NOW()`.

Response:
- `{ ok: true }`

## 5. Block Producing From Deleted Source

Where to block:
- In production creation flow (`src/features/productions/service.ts`), after loading the upload:
  - if `upload.source_deleted_at != null` return `409 source_deleted`

This prevents silent MediaConvert failures and makes the UX clear.

## 6. UI Changes

### 6.1 Video cards on `/uploads` (kind=video)
- Add a “Delete Source” button aligned right on the same row as “View Productions”.
- Confirmation text:
  - “Delete source video file? Existing productions and published videos will keep working, but you won’t be able to create new productions from this upload.”
- After success:
  - Optionally show “Source deleted” label on the card (and/or disable the button).

### 6.2 Existing “Delete upload” behavior
Leave the current `DELETE /api/uploads/:id` as-is for cases where users truly want to remove everything (and accept that it removes outputs / breaks feeds).

## 7. Backup Step (Schema + Data, One File)

Before applying the schema change, take a single-file backup of schema + data.

Command (nominal):
- `mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" --single-transaction --routines --triggers "$DB_NAME" > schema_backups/aws_backup_$(date +%Y%m%d_%H%M%S).sql`

Notes:
- Uses credentials from `.env`.
- Produces one `.sql` file containing both schema + data.

## 8. Manual Test Checklist

1) Create a production for a video; publish it to a space; confirm it plays.
2) Hit “Delete Source” on the upload card:
   - Upload source file removed from `UPLOAD_BUCKET`.
   - Publication still appears in feeds and still plays (outputs in `OUTPUT_BUCKET` remain).
3) Try to “Produce” from that upload again:
   - blocked with a clear `source_deleted` error.
4) Unpublish everywhere → delete production still works (unchanged).

## 9. Open Questions (confirm before implementation)

1) Should “Delete Source” be available only once there is at least one completed production, or always (with warning)?
   - Decision: Always available, with a strong warning/confirm step.
2) Do you want an “Undo” path (re-upload source for same upload), or is it strictly one-way?
   - Decision: Strictly one-way (no undo).
