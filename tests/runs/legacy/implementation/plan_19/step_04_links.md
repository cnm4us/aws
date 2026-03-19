# Plan 19 — Step 4 Jump modal links (?pin=production_ulid)

Date: 2025-12-29

## Notes

- `frontend/src/app/Feed.tsx` now passes the current item’s `productionUlid` into `JumpToSpaceModal` as `pinProductionUlid`.
- `frontend/src/app/JumpToSpaceModal.tsx` appends `?pin=<production_ulid>` to Group/Channel links when `pinProductionUlid` is present.

## Manual verification checklist

- Open Global Feed, click Jump on a video with a `production_ulid`.
- Confirm the modal links look like:
  - `/groups/<slug>?pin=<production_ulid>`
  - `/channels/<slug>?pin=<production_ulid>`

