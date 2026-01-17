# Plan 64 — Create Video: Freeze Frames v1 (as `freeze_frame` image segments)

## Goal
Replace clip-level “freeze start/end” logic with a simpler, editor-friendly model:
- **Freeze first frame** ⇒ generate a freeze-frame image, insert it **before the clip** (to the left), and **shift the clip right** by `N` seconds.
- **Freeze last frame** ⇒ generate a freeze-frame image, insert it **after the clip** (to the right), and shift any later base-track items right as needed.

Key properties:
- Freeze frames are generated from the **edit proxy** using ffmpeg fast seek.
- Freeze frames are stored as an `uploads` row with `kind='image'` and `image_role='freeze_frame'`.
- Export uses ffmpeg to compose the base MP4; MediaConvert remains HLS-only.
- Preview behavior remains pragmatic: the editor may require user play taps at boundary transitions on mobile browsers.

## Scope
- Create Video: add “Insert freeze first/last frame” actions in the **video clip properties modal**
- Create Video timeline: represent freeze frames as explicit base-track segments (not as `tpad`)
- Backend: add a media job to generate freeze-frame PNGs from edit proxies and cache them in S3
- Export: treat freeze-frame segments as base segments (still-image MP4 segments), not overlays

Non-goals:
- Perfect autoplay/pause-free preview through freeze regions on iOS
- Arbitrary per-frame freeze selection UI (we only support first/last frame of the clip’s selected source range)
- Overlapping freeze frames on the base track

---

## Step 1 — Data model (timeline + uploads)

### Timeline JSON changes
Replace `freezeStartSeconds` / `freezeEndSeconds` on clips with explicit base-track items:
- `clips[]`: video clip segments (as today), no freeze fields
- `stills[]` (new): freeze-frame segments that participate in base-track timing

Proposed still item shape:
- `id: string`
- `uploadId: number` (image upload id with `image_role='freeze_frame'`)
- `startSeconds: number`
- `endSeconds: number`
- `sourceClipId: string` (optional, for debugging/UX)

Validation rules:
- Base track is: `clips + stills` (combined + time-sorted)
- Enforce **no overlaps** on the combined base track
- Still segments require:
  - `uploads.kind='image'`
  - `uploads.image_role='freeze_frame'`
  - owner = user or system

### Upload image role
Add support for `image_role='freeze_frame'` in:
- Create Video validators (so Create Video can reference freeze-frame uploads)
- Internal-derived upload creation (server-side only)

Explicitly **do not**:
- Allow end-users to upload `image_role='freeze_frame'` via presigned upload creation
- Surface `freeze_frame` as a tab/filter in `/uploads` UI (internal-only for now)

S3 storage convention (cache-friendly):
- `images/freeze-frames/uploads/<uploadId>/t_<timeMs>_le<cap>.png`
  - deterministic key, enables idempotent generation via `HeadObject`

---

## Step 2 — Media job: generate freeze frame image

Add a new media job type:
- `upload_freeze_frame_v1`

Input fields:
- `uploadId`, `userId`
- `proxy: { bucket, key }` (edit proxy pointer)
- `atSeconds: number` (source time within the proxy)
- `longEdgePx: number` (default 1080 cap; reuse existing sizing conventions)
- `outputBucket`, `outputKey`

Job behavior:
- Idempotent: if `outputKey` exists in S3, skip ffmpeg and return `skipped:true`.
- Run ffmpeg:
  - `-ss <atSeconds> -i <proxy> -frames:v 1 -vf scale=<longEdge cap preserve aspect> -f image2 <out.png>`
- Upload result to `outputBucket/outputKey` (content-type `image/png`)

Upload row creation:
- Create or reuse an `uploads` row representing this derived image:
  - `kind='image'`, `image_role='freeze_frame'`, `status='queued'|'processing'|'completed'`
  - `s3_bucket/outputKey` set to the deterministic cache key
  - `original_filename='freeze_frame.png'`, `modified_filename` optional
  - `user_id` = owner of the source upload (or system if the source is system-owned)
- When job completes, set upload row `status='completed'` and `uploaded_at`.

API endpoint (authenticated):
- `POST /api/uploads/:uploadId/freeze-frame`
  - body: `{ atSeconds, longEdgePx? }`
  - returns `{ freezeUploadId, status }`
- Frontend polls `GET /api/uploads/:freezeUploadId` until `status==='completed'`.

---

## Step 3 — Create Video UI (clip modal)

In the **video clip properties modal**:
- Add dropdown for freeze duration:
  - `0, 0.1..1.0 step 0.1, 2, 3, 4, 5`
- Add actions:
  - `Insert Freeze First Frame`
  - `Insert Freeze Last Frame`

Insert behavior:
- Determine the frame time to capture (in proxy time):
  - first: `sourceStartSeconds`
  - last: `max(sourceStartSeconds, sourceEndSeconds - 0.05)` (avoid end-of-stream seek quirks)
- Call the freeze-frame API to ensure an image exists (enqueue job if needed).
- Once ready, insert a still segment onto the base track:
- First frame: still at `[clipStart, clipStart+N]`, then **ripple-insert** `N` seconds for all later base-track items (including the clip itself).
- Last frame: still at `[clipEnd, clipEnd+N]`, then **ripple-insert** `N` seconds for all later base-track items.

Collision semantics:
- Since base track disallows overlaps, ripple-insert avoids collisions by shifting later base-track items right.

Visual presentation:
- Still segments render on the base track with a distinct style (e.g., different color + label `Freeze 2.0s`).
- Selecting a still segment opens a simple modal:
  - duration (editable)
  - delete segment

---

## Step 4 — Export pipeline changes (ffmpeg)

Update `create_video_export_v1`:
- Remove `freezeStartSeconds`/`freezeEndSeconds` usage (no `tpad` for freezes).
- Build the base track as a sequence of segments:
  - Video segments: `renderSegmentMp4` (trim + scale/pad)
  - Freeze segments: `renderStillSegmentMp4` (loop PNG into MP4 for duration, silent audio)
  - Black gaps remain as today (`renderBlackBaseMp4`) when needed.
- Concat segments into `baseOut`.
- Apply full-frame graphics overlays and the (optional) system audio track as today.

---

## Step 5 — Back-compat / migration

Since we previously shipped clip-level freeze fields:
- Add a one-time migration helper:
  - When loading/saving a project, if any clip has `freezeStartSeconds`/`freezeEndSeconds`:
    - Convert them into still segments (first/last) using the new freeze-frame job mechanism
    - Clear the deprecated fields
  - If a freeze frame image isn’t ready yet, keep the project valid but show a “Generating freeze frame…” placeholder and block export until ready (or auto-poll).

If we prefer to keep the first implementation simpler:
- Provide a manual cleanup note: “Existing projects with clip-freeze must be re-saved to convert them.”

## Step 6 — Retention
- Keep freeze-frame uploads indefinitely for now (no GC/purge policy in this plan).

---

## Step 7 — Manual test checklist
- Insert freeze-first (0.5s, 2s) on a clip; confirm base track length increases and later base items shift right.
- Insert freeze-last; confirm segment appears after clip and later items shift right.
- Export: freeze segments render as still video frames, **clip audio silent during freeze**, background music continues.
- Ensure freeze frames are generated from the **edit proxy** and cached by deterministic S3 key.
- Confirm `uploads.kind='image' image_role='freeze_frame'` rows exist and are owned correctly.
