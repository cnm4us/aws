# Architecture

Modules
- routes/
  - signing.ts — presign uploads, mark complete
  - uploads.ts — list/get uploads
  - publish.ts — create MediaConvert jobs
  - profiles.ts — list available profile names
- services/
  - s3.ts — shared S3 client
- utils/
  - enhance.ts — build cdn/s3 master URLs; parseFromKey
  - requestLog.ts — write final CreateJob payloads
- jobs.ts — composable jobs loader ($extends + mixins, token substitution)
- config.ts — env parsing and defaults
- aws/mediaconvert.ts — endpoint discovery + client

Flows
- Upload
  - Browser → POST /api/sign-upload → presigned POST → S3 → POST /api/mark-complete → DB row updated
- Publish
  - UI → POST /api/publish → settings composed from jobs/profiles + mixins → CreateJob → DB status queued
  - Poller → GetJob → updates status to processing/completed/failed
- Delivery
  - CloudFront (OAC) → S3 public bucket → video.m3u8 + segments

Conventions
- Upload key: uploads/YYYY-MM/DD/<uuid>/video.<ext>
- Output prefix: YYYY-MM/DD/<uuid>/<orientation>/
- Master: video.m3u8

Pages/Docs Hierarchy
- `pages` now uses an explicit node tree model:
  - `type`: `section | document`
  - `parent_id`: nullable parent reference
  - `sort_order`: sibling ordering
  - `slug`: URL segment (unique per parent)
- Public resolution is parent/child-based (not slug-prefix-based):
  - `/pages` -> root nodes
  - `/pages/<segment>/<segment>/...` -> node resolved by traversing parent chain
- Sections can contain sections and documents.
- Documents are leaf nodes (cannot be parents).
