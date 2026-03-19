Step 01 (DB)

- Added `lower_third_configurations.timing_rule` + `lower_third_configurations.timing_seconds` (via `src/db.ts`).
- Backfill: existing rows default to `timing_rule='first_only'` and `timing_seconds=10` when null.

