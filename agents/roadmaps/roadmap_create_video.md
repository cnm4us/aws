# Roadmap: Create Video (Timeline Composer)

## Goal
Build a timeline-based “Create Video” experience that lets creators:
- Add one or more video clips to a timeline
- Split/trim/delete and ripple edits
- Add assets (images, audio, PiP video) on additional tracks
- Produce an HLS-ready production via `ffmpeg -> MediaConvert`

This is a separate UX from the existing single-upload editor (`/edit-video?upload=...`), which stays as the fast “trim this upload” tool.

## Core Principles
- **Two-layer planning:** this roadmap stays stable; implementation happens via scoped `agents/implementation/plan_XX.md` files.
- **Small slices:** ship value early (single-track first), then expand.
- **Single source of truth:** timeline + asset selections persist in DB (drafts / project model), not in long query strings.
- **ffmpeg does composition:** MediaConvert is for HLS packaging only.
- **Mobile-first UX:** large targets, minimal gestures required, avoid precision drag where possible.

## Concepts & Vocabulary
- **Project**: a saved “Create Video” composition (timeline + tracks + settings).
- **Track**: a lane on the timeline (e.g. base video, overlay A, audio A).
- **Clip**: an item on a track with time window + source reference.
- **Source range**: for video/audio clips, the in/out times within the source asset.
- **Rendered duration**: for a clip, includes any clip-level intro (e.g. freeze-first-frame seconds).

## Staging (Preview-Only Publishing)
Add a **Staging** space that is only visible to the owner, so creators can verify a production before publishing.
- Staging is a choice in the publish checklist (not forced).
- Editing should not mutate the previously produced/published production; use **clone/re-produce** flows.

## Phases

### Phase 1 — Timeline Base Track (MVP)
User value: trim and assemble a single timeline from video clips.
- New route: `/create-video` (project-based, not upload-based)
- Base video track:
  - Add Video Clip (at start/end/playhead)
  - Split, delete (ripple), undo
  - Trim handles (source in/out)
- Produce:
  - Render with ffmpeg into a single master MP4
  - Send master to MediaConvert for HLS
- Persistence:
  - One active project draft per user (mirrors draft patterns)

### Phase 2 — Assets: Image Overlays (Overlay A)
User value: add full-frame image overlays (screenshots, documents) at specific times.
- “Add Asset” modal supports: Image overlays
- Overlay clips on a dedicated track
- Properties (MVP): start/end, fit=contain/cover (start with cover), opacity later
- Render: ffmpeg overlays composited into video master

### Phase 3 — Audio Track (Music / SFX)
User value: add a music bed or intro audio to the timeline.
- Audio track A:
  - Add audio clip(s) at start/end/playhead
  - Properties: start/end, gain, mode=mix/replace
  - Optional: ducking modes (rolling / cutoff)
- Render: ffmpeg audio graph + normalization (env-controlled)

### Phase 4 — Build Overlays as Tracks (Logo / Lower Third / Screen Title)
User value: unify “build production” overlays with the timeline mental model.
- Add a “Build Overlays” track (locked) that reflects:
  - logo + logoConfig
  - lower third image + config
  - screen title preset + text
- Make timing rules visible on the timeline so users can avoid overlaps.

### Phase 5 — Video-in-Video (PiP) + Multi-Track Expansion
User value: add a second video clip above the base video.
- Overlay video track (PiP) with simple preset positions/sizes first
- Preview may be simplified initially; ffmpeg output is the source of truth

## Open Questions (to resolve per plan)
- Project storage: keep `projects` table vs reuse `production_drafts` with a new `kind` (draft type).
- Preview strategy for multi-clip playback (smoothness vs complexity):
  - single `<video>` with source switching, or
  - dual preloaded `<video>` elements
- Track limits for MVP (how many tracks, max clips per track).

