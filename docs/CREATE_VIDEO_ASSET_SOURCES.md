# Create Video Asset Sources

Last updated: 2026-04-02

## Scope
This document describes how video assets are sourced for timeline insertion in `/create-video` via `/assets/video`.

## Source Groups (UI)

Video picker now supports four source groups:

- `Uploads` (raw user source videos)
- `Exports` (Create Video rendered outputs)
- `My Clips` (saved personal clips)
- `Shared Videos` (library/system or shared user videos)

These groups are selection scopes in the same picker UI; they are not separate timeline models.

## Role Semantics

For video uploads (`uploads.kind='video'`):

- `video_role='source'` => source upload
- `video_role='export'` => export output
- Legacy fallback when `video_role IS NULL`:
  - `s3_key` containing `renders/` => treated as export
  - otherwise treated as source

## API Behavior

### `GET /api/assets/videos`
Primary endpoint used by the video picker.

Query parameters:

- `video_role=source|export|all` (default `source`)
- `q`, `sort`, `favorites_only`, `include_recent`, `limit`

### `GET /api/uploads`
General uploads endpoint also supports role filtering for videos:

- `kind=video`
- optional `video_role=source|export`

### `POST /api/assets/videos/:id/favorite`
Favorites are supported for both source and export video assets.

### `POST /api/assets/videos/:id/used`
Used/insert tracking endpoint.

Request body supports:

- `origin=source|export|shared|clip`

Notes:

- Recency persistence (`user_upload_prefs.last_used_at`) is source-only.
- Export/shared/clip origins still emit observability tags for insertion diagnostics.

## Timeline Validation

Create Video timeline validation accepts export-origin videos for:

- base timeline clips
- video overlays

Validation still enforces:

- ownership/access checks
- upload status checks (`uploaded|completed`)
- non-deleted source constraints
- duration/range normalization

## Picker Return Contract

When selecting from assets picker, return parameters include:

- `cvPickType`
- `cvPickUploadId` or `cvPickClipId`
- `cvPickSource=uploads|exports|clips` (shared routed as shared where applicable)

`/create-video` consumes these params and inserts the selected asset, then clears pick params from URL.

## UX Notes

- All four source groups use a unified card layout:
  1. badge + favorite star row (right-aligned)
  2. title row (gold)
  3. meta row
  4. thumbnail/preview row
  5. description row (if present)

- Badge colors:
  - Uploads: blue
  - Exports: purple
  - Shared Videos: green
  - My Clips: orange

- Readiness fallbacks:
  - Thumbnail missing: `Thumbnail not ready`
  - Proxy preview missing: `Preview proxy not ready or unavailable`
  - Missing selected asset on return: explicit timeline message shown

