# Plan 88 — Admin Video Library + Clips

## Goals
- Create an **admin‑curated library of source videos** where staff upload long‑form content.
- Allow users to **create clips (5s–3m)** from those library videos.
- Expose **Clips** as a selectable asset type in Create Video (filter by System / Mine / Other Users).
- Reuse existing processing pipeline: edit proxy, waveform, transcript.

---

## Decisions
- **Source Org** is a fixed enum: `CSPAN`, `Other`.
- **User clips are private by default** (not shared).
- **No moderation** for user clips (when sharing is later enabled).
- **Transcript provider** remains AssemblyAI.
- **Separate bundle**: Library/clip UI lives in its own React route/bundle (lazy‑loaded).

---

## Data Model
### Option A (recommended): reuse `uploads` + new tables
- **uploads**: add flags for **library source videos**
  - `is_system_library` (bool)
  - `source_org` (enum/string) — stored **only on uploads**, joined when listing clips
- **library_clips** (new)
  - `id`
  - `upload_id` (library video)
  - `start_seconds`
  - `end_seconds`
  - `title` (user editable)
  - `description` (user editable)
  - `owner_user_id` (nullable; admins still have user id)
  - `created_at`, `updated_at`
  - `is_system` (bool) — admin‑curated clip
  - `is_shared` (bool) — user created, default false

---

## Admin UI: `/admin/video-library`
- **List** of library source videos with:
  - name, description, source org
  - duration, size
  - status chips: proxy / waveform / transcript
- **New video** modal:
  - Name
  - Description
  - Source Org (select: CSPAN, Other)
  - Upload file
- After upload:
  - enqueue `upload_edit_proxy_v1`, `upload_audio_envelope_v1`, `assemblyai_transcript_v1`

---

## User UI: `/library` (read-only)
- **Separate bundle** (lazy route import) to keep Create Video bundle lean.
- **Browse library source videos** with filters:
  - name, description, source org
- **Transcript search**:
  - query returns hit list with timecode + snippet
  - clicking a hit jumps player to that time
- **Clip creation**:
  - Set In / Set Out
  - enforce 5s min / 180s max
  - save clip (title/description)

---

## Create Video: Add → Video
- Add **tab/filter**: `System Clips | My Clips | Other Users`
- Clip insertion uses stored `upload_id`, `start_seconds`, `end_seconds` into clip object

---

## Processing
- On library video upload, immediately run:
  - `upload_edit_proxy_v1`
  - `upload_audio_envelope_v1`
  - `assemblyai_transcript_v1`
- Clip creation does **not** generate new media files; it is metadata only.

---

## API endpoints (draft)
- `POST /api/admin/video-library/upload` (admin only)
- `GET /api/library/videos?search=&source=`
- `GET /api/library/videos/:id/transcript?query=`
- `POST /api/library/clips`
- `GET /api/library/clips?filter=system|mine|others`

---

## Open Questions
- Later: should user clips become shareable by default or only after explicit share toggle?

---

## Rollback Plan
- Feature‑flag the library UI; keep uploads untouched.
- No migrations on existing data unless `library_clips` table introduced.
