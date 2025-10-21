Production ULID Outputs • Implementation Plan
Last updated: 2025-10-21

Goal
- Support multiple Productions per Upload without S3 collisions by writing HLS outputs to a per‑production path nested under the upload UUID. Prefer production‑centric feeds using the production’s output_prefix.

Path Schema
- Public output bucket: `s3://bacs-mc-public-stream`
- Destination prefix: `YYYY-MM/DD/{UPLOAD_UUID}/{PRODUCTION_ULID}/(portrait|landscape)/`
  - UPLOAD_UUID comes from the upload’s S3 key path (already extracted).
  - PRODUCTION_ULID is a 26‑char ULID generated per production.
  - Filenames remain unchanged (e.g., `video.m3u8`, `*_poster.0000000.jpg`).

DB Changes (minimal)
- productions
  - Add `ulid CHAR(26) NOT NULL UNIQUE` (application generates ULID).
  - Continue storing per‑production `output_prefix` (now includes `{PRODUCTION_ULID}/`).
- space_publications
  - No schema change required; we already added `production_id`. Feeds can join to `productions` for the output_prefix.

MediaConvert Profile & Token Changes
- Add support for a new token in transformSettings: `PRODUCTION_ULID`.
  - Update `src/jobs.ts` transform to replace `PRODUCTION_ULID` strings with the runtime value.
- Update MC profiles (JSON) to add `PRODUCTION_ULID` in HLS destinations:
  - Example: `s3://OUTPUT_BUCKET/DATE_YYYY_MM_DD/ASSET_ID/PRODUCTION_ULID/portrait/`
  - Posters FILE_GROUP destinations mirror the same prefix.

Server Flow Changes
- productionRunner.ts
  1) Insert a Production row first (status `queued`) to allocate `id` and generate `ulid`.
     - Columns: `(upload_id, user_id, status='queued', config, ulid)`
  2) Build MC settings with tokens:
     - `ASSET_ID = upload_uuid`, `DATE_YYYY_MM_DD = upload.date`, `PRODUCTION_ULID = production.ulid`.
  3) Create MC job; compute `outPrefix` from settings (now includes `{PRODUCTION_ULID}/`).
  4) Update Production with `mediaconvert_job_id` and `output_prefix`.
  5) Optionally update Upload status; stop updating `uploads.output_prefix` (legacy only).

Publishing & Feeds
- Creation (already supported): POST `/api/productions/:id/publications` persists `production_id` into `space_publications`.
- Feeds (space & global): prefer production output over upload output
  - LEFT JOIN `productions p ON p.id = sp.production_id`
  - Select `COALESCE(p.output_prefix, u.output_prefix) AS output_prefix` so legacy rows still work.
  - Keep current joins to `uploads` and `users` for metadata and owner info.

Deletion
- Deleting an entire upload should delete `.../{UPLOAD_UUID}/` recursively (removes all contained productions).
- To delete a single production only, target `.../{UPLOAD_UUID}/{PRODUCTION_ULID}/`.

Frontend
- No changes to URL building logic; it already derives URLs from `output_prefix` + base file name.
- Feeds will automatically reference the per‑production outputs once the API returns the production’s `output_prefix`.

Backfill / Migration Strategy
- Dev‑only: for existing Productions missing `ulid`, generate and backfill (optional).
- No re‑encoding migration needed; older outputs remain at the legacy path and continue to work (feeds will still use `uploads.output_prefix` when `production_id` is absent).

Testing
- Unit: token replacement for `PRODUCTION_ULID`; runner inserts production first and writes MC settings correctly.
- Integration: run a render → verify S3 emits in nested prefix, verify production.output_prefix stored.
- Feed: verify space/global feeds pick up production.output_prefix via JOIN.

Rollout Steps
1) Add DB column: `productions.ulid CHAR(26) UNIQUE`.
2) Add ULID generator (e.g., `ulid` npm) and persist on Production create (runner).
3) Add `PRODUCTION_ULID` handling to `src/jobs.ts` transform.
4) Update MC profiles to include `PRODUCTION_ULID` in destinations.
5) Modify `startProductionRender` to insert production first, then build settings, then update record post‑job.
6) Update space/global feed SQL to join `productions` and select `COALESCE(p.output_prefix, u.output_prefix) AS output_prefix`.
7) Manual test: multi‑production from a single upload → distinct paths; feeds display the expected variant.

Notes & Considerations
- Prefer ULID over numeric production.id for privacy, portability, and sortability.
- Keep per‑production path under upload UUID for easy grouping and cleanup.
- Avoid denormalizing media links into `space_publications`; continue joining on indexed PKs for clarity and small rows.

