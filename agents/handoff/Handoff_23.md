Handoff 23

Priority Backlog (Refactor Objectives)
- Objective:
  - Organize code to facilitate adding new features and extending existing ones quickly.
  - Organize code so it’s optimized for agent work: consistent patterns, thin routes, typed services, standard validation and errors.
- Instructions:
  - Maintain this Priority Backlog at the top of each Handoff_N.md.
  - Copy this section forward to Handoff_{N+1}.md at the start of a new thread and update statuses as items complete or are added.
  - Use P1 for highest-impact foundation items; P2 for high-value follow-ups; P3 for structural polish.

- P1 (foundation, highest impact)
  - [ ] Unify HLS playback across browsers; avoid Chrome native .m3u8
  - [ ] Componentize feed video player (HLSVideo)

- P2 (high‑value follow‑ups)
  - [ ] Warm-up preloading for next slide
  - [ ] Centralize Safari detection utility
  - [ ] Minimal refactor of Feed.tsx to use components

- P3 (structural polish)
  - [ ] Future: pool hls.js instances to reduce GC churn
  - [ ] Future: predictive preloading hooks

Summary
- Implemented upload “kinds” (video/logo/audio) and S3 key prefixes; uploads UI now supports separate tabs and typed validation.
- Added production builder route `/produce?upload=:id` and production settings storage for `musicUploadId`, `logoUploadId`, `logoConfigId` (+ snapshot).
- Implemented MediaConvert watermark + music replacement support (replace-mode) including optional server-side audio looping (ffmpeg pre-job) and logo overlay.
- Implemented user-owned Logo Config presets (`/logo-configs`) with 3×3 position grid + inset size presets (small/medium/large), plus DB normalization for old `center` values.
- Moved audio to a curated, site_admin-managed “system audio” library:
  - site_admin UI at `/admin/audio` (server-rendered) with custom compact player + edit/delete
  - users can select system audio in `/produce`, but cannot upload/manage audio
- Added env-gated audio loudness normalization:
  - `MEDIA_CONVERT_NORMALIZE_AUDIO=1|0` (default enabled when unset)
  - Introduced a transforms seam for future cube LUTs + animated lower thirds.

Decisions (carried + new)
- Authority prefixes: `/admin/*` = site_admin; `/space/*` = space console; user feed remains separate; avoid shipping admin/space code in the main feed bundle.
- “Same video across spaces” identity is always `production_id` (no upload_id fallback).
- User audio uploads are disallowed (copyright risk); system audio is curated by site_admin and selectable by any logged-in user.
- Production audio replacement:
  - if music shorter than video: loop (server-side) then feed MediaConvert
  - if longer: truncate
- Watermark does not apply to poster images.
- Audio normalization: focus on cross-video loudness normalization; skip within-video compression/leveling for now.

Changes Since Last (high level)
- Uploads
  - DB: `uploads.kind` (video/logo/audio) and `uploads.is_system` for system audio.
  - S3 keys: typed roots for new kinds (logos/audio); legacy video keys remain.
  - UI: uploads list now card-based; “Delete source file” for video uploads hard-deletes the input object without touching productions/publications.
- Productions / Publish
  - `/produce` provides audio/logo/logo-config selection (route-based pickers) and persists choices in `productions.config`.
  - Productions list layout updated; publish supports unpublish-all (submit with zero spaces selected).
- Admin
  - `/admin/audio` is server-rendered and includes edit + delete.
- MediaConvert
  - Added `src/services/mediaconvert/transforms.ts` seam for feature-driven job mutations.
  - Audio normalization is controlled solely by env flag, not by production “sound” field.
  - Removed legacy `mixins/audio/normalize-lufs-16` references from `jobs/profiles/*.json` (code is authoritative).

- Upload thumbnails (Plan 39)
  - Source upload thumbnails are generated from the first frame (t=0) via ffmpeg and stored at `thumbs/uploads/<uploadId>/thumb.jpg` in `UPLOAD_BUCKET`.
  - New auth endpoint: `GET /api/uploads/:id/thumb` (falls back to production posters in UI when missing).
  - `media_jobs` type `upload_thumb_v1` generates thumbs asynchronously on upload completion; includes backfill scripts.
  - `/productions?upload=:id` now supports previewing the original uploaded video in a full-screen modal via `/api/uploads/:id/file`.
  - Commit: `33d9e4b`

Commits (since `b68aeaa`)
- `c9b350c` MediaConvert: env-gated audio normalization
- `c8fb3aa` Admin audio: card layout + edit; remove badges
- `ff8b80e` System audio: admin-managed library + user picker
- `e8aef7d` Logo configs: 3x3 position + safe inset presets
- (many intermediate commits: uploads kinds, produce flow, watermark/music support, UI cleanups; see `git log b68aeaa..HEAD`)
- Feed: publication stories (per-space), feed preview + expand, publish-side editor, `/api/publications/:id/story`
- `b78e19a` Publish: always show story list (and add `agents/implementation/plan_44.md`)

Open Questions / Deferred
- Consider removing legacy `mixins/audio/normalize-lufs-16` references from `jobs/profiles/*.json` to eliminate “two sources of truth” (code policy is now authoritative).
- Future: cube LUT support and animated lower thirds via the transforms seam.

Changes Since Last (since `74e1c20`)
- Stories (plain text, per space publication)
  - DB: `space_publications.story_text`, `space_publications.story_updated_at`
  - API: `GET /api/publications/:id/story`, `PATCH /api/publications/:id/story` (owner/site_admin; CSRF required for PATCH)
  - Feed: 1–2 line preview under creator name; chevron expands to scrollable story; transparent background; lazy-load full text on expand
  - Publish: per-space “Story” section on `/publish?production=:id` + editor route `/publish/story?publication=:id&from=...`
- Logo metadata edit + About modals
  - API: `PATCH /api/uploads/:id` updates `modified_filename` and `description` (owner/site_admin; CSRF required)
  - Uploads: `/uploads?kind=logo` supports Edit modal for name/description
  - Produce: Logo “About” modal (selected + picker) shows description (or “No description.”)
  - Commit: `846a705`
