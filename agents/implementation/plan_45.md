# Implementation Plan 45: Persist Captions + Custom Overlay (Linger Style)

## Goal (MVP)
- Persist **WebVTT** captions per **production** (AssemblyAI output).
- Expose captions to viewers via a **publication-scoped** endpoint (same access as watching that video).
- Add a **custom captions overlay** in the feed (linger style), with a simple user toggle **ON/OFF** and a single initial style.

Non-goals (this plan)
- Word-by-word / “punchy” captions (requires word timestamps).
- Multi-language support.
- Advanced editor/cleanup UI for captions.

## Decisions
- Captions data is **per production** (one transcript per rendered video).
- Access is **per publication**: if you can view the feed item, you can fetch its captions.
- Captions are **off by default**, user can toggle on; state stored in `localStorage` (for now).
- Rendering is a custom overlay synced to `video.currentTime`, not `<track>`.

## Open Questions (confirm before coding)
1) Toggle placement: should the CC toggle live:
   - A) per-slide control (right-side action column), or
   - B) a global setting in the main drawer (applies to all videos)?
   Decision: **A** for MVP.
2) Styling MVP: OK with **white text** + **subtle dark shadow** + **semi-transparent black pill background** (for readability)?
   Decision: **Yes**.

## Step 0) Finish Plan 44 (if not already)
- Ensure the `assemblyai_transcript_v1` job is working reliably (VTT produced).
- Commit Plan 44 changes once verified (keeps Plan 45 focused).

## Step 1) Data model: production_captions table
- Add table (idempotent in `src/db.ts`):
  - `production_captions`:
    - `id` PK
    - `production_id` (unique)
    - `provider` (`assemblyai`)
    - `transcript_id` (string)
    - `format` (`vtt`)
    - `language` (`en`)
    - `s3_bucket`, `s3_key`
    - `status` (`ready` / `failed`)
    - `created_at`, `updated_at`
- Add indexes:
  - unique on `production_id`
  - index on `status`

## Step 2) Persist VTT from Plan 44 into a stable S3 prefix + DB row
- Change the transcript job result handling so that on completion:
  - write VTT to a stable location, e.g.:
    - `UPLOAD_BUCKET` (or a dedicated captions bucket)
    - key: `captions/vtt/production_<productionId>.vtt`
  - upsert `production_captions` row for `production_id` pointing at that bucket/key
- Keep the existing debug log copy in `media_jobs` logs (optional).

## Step 3) API: fetch captions by publication (auth + space visibility)
- Add endpoint:
  - `GET /api/publications/:id/captions.vtt`
    - `requireAuth`
    - Access check: same as viewing that publication:
      - validate publication exists
      - assert can view the publication’s space feed (and not banned)
    - Resolve `production_id` from publication
    - Load `production_captions` row; if missing return `404 { error: 'captions_not_found' }`
    - Fetch the VTT object from S3 and return it:
      - `Content-Type: text/vtt; charset=utf-8`
      - `Cache-Control: private, max-age=300` (safe short caching)

## Step 4) Feed payload: expose `hasCaptions` (no VTT in feed payload)
- Add `has_captions` boolean to feed query projection:
  - computed via `LEFT JOIN production_captions pc ON pc.production_id = sp.production_id AND pc.status='ready'`
  - `has_captions = pc.id IS NOT NULL`
- Client feed item includes `hasCaptions`.

## Step 5) Frontend: captions overlay (custom, linger)
- Add a small VTT parser module (no dependencies):
  - parse header + cues into `{ startMs, endMs, text }[]`
  - ignore WEBVTT styling blocks for now
- Add a captions controller for the active slide:
  - When captions enabled and slide becomes active:
    - fetch `/api/publications/:id/captions.vtt`
    - parse cues
    - on a timer (e.g. `requestAnimationFrame` or 250ms interval), read `video.currentTime` and display matching cue text
  - Cache parsed cues by `publicationId` to avoid refetching when revisiting.
- UI:
  - Add a CC icon button (only when `hasCaptions=true` or always and show “not available” when missing).
  - Toggle persisted in `localStorage`:
    - `captions:enabled = 0|1`
    - `captions:style = 'default'` (future-proof)
- Styling:
  - One default style for now:
    - bottom-centered, above Story panel
    - max width ~80%
    - pill background with padding
    - `white-space: pre-wrap` (supports line breaks)

## Step 6) Manual test checklist
1) Create a short production and confirm VTT persisted (DB row + S3 object).
2) Open the same production in:
   - Global feed
   - A group/channel feed
3) Toggle captions on:
   - Captions show and follow speech timing.
4) Toggle off:
   - Captions disappear and do not fetch again on next slide until enabled.
