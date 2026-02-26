# Plan 37 — Production Intro: Freeze First Frame (Title Page Foundation)

## Goal
Add an **optional production “intro”** that **freezes the first frame for N seconds** and **pushes the original video+audio out by N seconds**, without changing the existing output resolution/orientation pipeline.

This is the foundation for an “extended video title page” (future), where we can later add intro-only text/graphics/branding over the frozen section.

## Non-Goals (this plan)
- No actual title text/graphics overlay UI (name/episode/date) yet.
- No intro-only lower thirds / animated graphics yet.
- No changes to publication rules/feeds.
- No MediaConvert template rework beyond using the mastered input when needed.

## Key Requirements / Expected Behavior
- Extend is **optional**; default is “no intro”.
- Intro kind for now: **freeze_first_frame** only.
- If a logo watermark is configured, it must appear on the frozen section too (works naturally because watermark is applied during MediaConvert packaging to the whole timeline).
- Audio pipeline behavior remains:
  - If music is selected and Audio Config is Mix/Replace, we still use ffmpeg mastering first.
  - Opener Cutoff time `t` should shift by the intro length (because the underlying audio timeline is shifted).
- Preserve original orientation handling; do not change “portrait vs 16:9 rotate UI” semantics.

## Proposed Config Shape
Store under `productions.config` (JSON):

```json
{
  "intro": {
    "kind": "freeze_first_frame",
    "seconds": 4
  }
}
```

Future additions (not in this plan):
- `intro.title: {...}`
- `intro.graphics: {...}`
- `intro.kind: "title_card" | "slideshow" ...`

## Implementation Steps

### Step 1 — Config plumbing and validation
- Add `intro` to the production config snapshot created during production creation.
- Validate `intro.seconds`:
  - Allowed values initially: `null | 0 | 2 | 3 | 4 | 5` (or a small set we choose).
  - Clamp / reject invalid values with clear 4xx errors.
- Ensure `intro` is always either `null` or `{ kind: 'freeze_first_frame', seconds: number }` (no partial objects).

### Step 2 — UI: add “Freeze first frame” control on Build Production page
- On `frontend` Build Production page (`/produce?upload=...`), add a compact selector:
  - `Freeze first frame: None | 2s | 3s | 4s | 5s`
- Persist selection in URL (like audio/logo pickers):
  - e.g. `introSeconds=4` or `intro=freeze_first_frame:4` (pick one).
- When creating a production, send the selected intro config in the create payload.

### Step 3 — ffmpeg mastering: generate “intro-extended MP4”
We need a deterministic mastered input MP4 that includes the extended intro frames and shifted audio, then the rest of the pipeline continues.

Add a new ffmpeg stage function, e.g.:
- `createMp4WithFrozenFirstFrame(...) -> { bucket, key, s3Url }`

Behavior:
- Input: original upload MP4 from uploads bucket.
- Output: a new MP4 stored under a prefix like:
  - `intro-freeze/<date>/<productionUlid>/<uuid>/<originalLeaf>`
- Mechanism:
  - Extract first frame and create a short video segment of duration N seconds.
  - Concatenate that segment in front of the original video.
  - Delay original audio by N seconds (so original audio begins after the freeze).
  - If the original video has no audio stream, produce silent audio for the intro segment and keep A/V sync.
- Prefer reusing the existing “media_jobs” queue (DB) to run this as part of the mastering job when needed.

### Step 4 — Orchestrate intro + audio in one mastering job
Update `audio_master_v1` job to support optional intro:
- If `introSeconds > 0`:
  1) Build the intro-extended MP4 first.
  2) Run the existing audio pipeline against that intro-extended MP4 as the “video input”.
- If no music selected (but intro is selected):
  - We still need the intro-extended MP4, then MediaConvert packaging runs using that as input.
  - This likely requires a new job type (e.g. `video_master_v1`) OR expanding `audio_master_v1` to accept “no music, just master video”.
  - Recommended: add a `video_master_v1` to avoid overloading semantics.

### Step 5 — MediaConvert handoff
Ensure the MediaConvert packaging job uses:
- The mastered MP4 s3Url when an intro master exists (with or without music),
- And keeps watermark behavior unchanged.

### Step 6 — Admin visibility / debugging
- Extend `/admin/media-jobs/:id` view to show intro config (seconds, kind) when present.
- Store ffmpeg stdout/stderr pointers as we do now for debugging.

## Manual Test Plan (minimal)
1) No intro, no music, logo on → baseline unchanged.
2) Intro=4s, no music, logo on → frozen first frame for 4s, then video starts; audio starts after 4s; watermark visible throughout.
3) Intro=4s, music mix + Rolling ducking → opener plays during freeze and continues; speech begins later; behavior matches existing.
4) Intro=4s, music mix + Opener Cutoff → cutoff trigger time shifts later by ~4s; fade settings still apply around `t`.

## Open Questions / Defaults
1) Allowed intro durations set: `2/3/4/5` seconds OK?
2) Should intro be available only when music is selected, or always? (This plan assumes always.)
3) If the upload has no audio stream: do we inject silent stereo AAC so downstream normalization behaves consistently? (Recommended yes.)

