# Implementation Plan 33: Music Mix + Optional Ducking (Admin Audio Config Presets + ffmpeg pre-mux)

## 1. Overview

Goal: Extend the production pipeline to support **mixing** background music with the video’s original audio (instead of replace-only), with **optional ducking** (music reduces when the original audio is loud), using **ffmpeg as a pre-step** before MediaConvert.

Admin-created presets: Users should not “dial knobs” directly. Site admins create a small set of **Audio Config** presets (similar to Logo Configs), and creators select one when producing.

In scope:
- Add **Audio Config presets** (site_admin-managed) for music behavior:
  - `replace` (existing behavior)
  - `mix` (new default for new productions)
  - optional ducking for `mix`
  - simple level controls (dB gains)
- Add production-level selection:
  - `musicUploadId` (system audio upload id, already used)
  - `audioConfigId` + `audioConfigSnapshot` stored in `productions.config`
- Implement ffmpeg filter-graph generation for:
  - `replace` (existing, but refactored into the new pipeline)
  - `mix` without ducking
  - `mix` with ducking
- Keep MediaConvert responsibilities: encode/package + `MEDIA_CONVERT_NORMALIZE_AUDIO` (overall loudness).
- Wire `/produce` UI to select the audio config preset (route-based picker, like audio/logo/logo-config pickers).

Out of scope (but design for it now):
- “Within-video” leveling / dynamic range compression beyond ducking.
- Voice isolation / speech enhancement.
- Multi-SFX overlays (but we’ll structure the config + pipeline so adding SFX overlays is straightforward in the next plan).

## 2. Design Notes (key constraints)

- “Video audio” is the original embedded audio track; we are not separating voice from ambient sound.
- MediaConvert doesn’t provide a robust “overlay mix external audio with embedded audio” feature for our use case; we will produce a single muxed MP4 input using ffmpeg, then run MediaConvert normally.
- Ducking is feasible via ffmpeg `sidechaincompress` (music is the compressed signal, original audio is the sidechain).
- Audio normalization remains env-gated:
  - `MEDIA_CONVERT_NORMALIZE_AUDIO=1` (default) normalizes the final output’s integrated loudness.

## 3. Proposed Data Model + Production Config Shape

### 3.1 Audio Config Presets (DB)

Add a new table (name can change, but keep semantics):

- `audio_configurations`
  - `id`
  - `user_id` (owner; for now the creating site_admin, similar to logo configs; later we can make it truly system-owned)
  - `name`
  - `mode` enum: `replace|mix`
  - `video_gain_db` (default `0`)
  - `music_gain_db` (default `-18`)
  - `ducking_enabled` (default `0`)
  - `ducking_amount_db` (default `12`) (not exposed in UI initially)
  - `archived_at` nullable (to hide old presets)
  - timestamps

Expose:
- site_admin CRUD under `/admin/audio-configs`
- read-only list endpoint for creators (logged-in) so they can choose a preset.

### 3.2 Production config (`productions.config`)

Add selection fields, keeping backward compatibility with current `musicUploadId`:

```json
{
  "musicUploadId": 57,
  "audioConfigId": 123,
  "audioConfigSnapshot": {
    "id": 123,
    "name": "Mix (Medium) + Ducking",
    "mode": "mix",
    "videoGainDb": 0,
    "musicGainDb": -18,
    "duckingEnabled": true,
    "duckingAmountDb": 12
  }
}
```

Rules:
- Back-compat: if `musicUploadId` is set but `audioConfigId`/`audioConfigSnapshot` are missing, treat as **replace-mode** (preserves existing already-produced semantics).
- New default: when creators newly select music, default to the “Mix (Medium)” preset (admin-provided).
- Ducking only applies when `mode=mix`.

## 4. Step-by-Step Plan

1. Add DB table + backend types for Audio Config presets  
   Status: Completed  
   Implementation:
   - Add `audio_configurations` table in `src/db.ts`.
   - Add repo/service layer to list non-archived presets.
   - Add read-only API for creators (logged-in): `GET /api/audio-configs` (exclude archived).
   Testing:
   - Canonical (expected): `GET /api/audio-configs` as a normal logged-in user → `200` and `items[]`.
   - Record actual output: `agents/implementation/tests/plan_33/step_01_audio_configs_api.md`  
   Checkpoint: Wait for developer approval before proceeding.

2. Add site_admin UI for Audio Config presets (`/admin/audio-configs`)  
   Status: Completed  
   Implementation:
   - Add server-rendered pages:
     - `GET /admin/audio-configs` list + “New”
     - `GET /admin/audio-configs/new` create form
     - `POST /admin/audio-configs` create
     - `GET /admin/audio-configs/:id` edit form
     - `POST /admin/audio-configs/:id` update
     - `POST /admin/audio-configs/:id/archive` (hide from creators)
   - Seed a minimal default set (one-time) if none exist:
     - “Mix (Quiet)” `musicGainDb=-24`, ducking off
     - “Mix (Medium)” `musicGainDb=-18`, ducking off (default)
     - “Mix (Loud)” `musicGainDb=-12`, ducking off
     - “Mix (Medium) + Ducking” `musicGainDb=-18`, ducking on
   Testing:
   - Canonical (expected): site_admin can create/edit/archive presets; normal user gets 403/forbidden on `/admin/audio-configs`.
   - Record actual notes: `agents/implementation/tests/plan_33/step_02_admin_ui.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Snapshot Audio Config into `productions.config` when producing  
   Status: Completed  
   Implementation:
   - Extend `POST /api/productions` to accept `audioConfigId`.
   - In production creation, load the chosen preset and store:
      - `audioConfigId`
       - `audioConfigSnapshot` (copy of the preset at time of produce)
   - Back-compat: existing productions without snapshot continue to behave as replace-mode.
   Testing:
   - Canonical (expected): `POST /api/productions` with `audioConfigId` stores `audioConfigSnapshot` in the production config.
   - Record actual notes: `agents/implementation/tests/plan_33/step_03_snapshot.md`  
   Checkpoint: Wait for developer approval before proceeding.

4. Refactor ffmpeg logic into a shared audio pipeline module (no behavior change)  
   Status: Completed  
   Implementation:
   - Extract ffmpeg runner + S3 download/upload helpers into a small module (e.g. `src/services/ffmpeg/audioPipeline.ts`) so we can add mix/ducking cleanly.
   - Keep current replace behavior identical when `audioConfigSnapshot.mode=replace`:
     - loop music to cover video duration
     - mux video stream + new audio into MP4
     - upload to `UPLOAD_BUCKET` and point `settings.Inputs[0].FileInput` at the muxed object
   Testing:
   - Canonical (expected): `npm run build` succeeds; no functional changes to replace-mode logic.
   - Record actual notes: `agents/implementation/tests/plan_33/step_04_refactor.md`  
   Checkpoint: Wait for developer approval before proceeding.

5. Implement `mode=mix` (no ducking): original audio + music at configured gains  
   Status: Completed  
   Implementation:
   - ffmpeg `-filter_complex` to:
     - apply `volume` to original audio (`videoGainDb`) and music (`musicGainDb`)
      - loop music with `-stream_loop -1`
     - mix with `amix=inputs=2` (keep video duration; pad original audio if needed)
   - Output MP4 with `-map 0:v:0` and `-map [mixed]`.
   Testing:
   - Canonical (expected): with `mode=mix`, you hear both original audio and background music.
   - Record actual notes: `agents/implementation/tests/plan_33/step_05_mix.md`  
   Checkpoint: Wait for developer approval before proceeding.

6. Implement optional ducking for `mode=mix`  
   Status: Completed  
   Implementation:
   - Add ffmpeg filter graph variant:
     - Apply `volume` to music baseline
     - Duck music using `sidechaincompress` with the original audio as the sidechain
     - Then `amix` original audio + ducked music
   - Start with conservative defaults (no UI tuning initially), derived from `ducking.amountDb`:
     - map `amountDb` into `sidechaincompress` parameters (threshold/ratio/makeup) with a simple heuristic.
   Testing:
   - Canonical (expected): with ducking enabled, music audibly reduces during speech/loud segments and returns during quiet segments.
   - Record actual notes: `agents/implementation/tests/plan_33/step_06_ducking.md`  
   Checkpoint: Wait for developer approval before proceeding.

7. Wire `/produce` UI to select an Audio Config preset (route-based picker)  
   Status: Completed  
   Implementation:
   - Add a compact “Music” section to `/produce`:
     - “Audio Config” indicator + “Choose” link → `/produce/audio-configs?...` (new route picker)
     - Default to “Mix (Medium)” when the user has selected music but not yet chosen a config.
     - Keep “Clear” behavior intact (clears `audioConfigId` and snapshot)
   - Persist selection in URL params (consistent with existing pickers) and ensure the server receives/stores config in `productions.config`.
   Testing:
   - Canonical (expected): UI changes persist in URL and survive refresh; producing uses the chosen mode.
   - Record actual notes: `agents/implementation/tests/plan_33/step_07_ui.md`  
   Checkpoint: Wait for developer approval before proceeding.

8. Prep for “SFX sting” (no functional change yet)  
   Status: Completed  
   Implementation:
   - Extend `audioConfigSnapshot` schema to allow future overlays, e.g. `overlays: []` (but do not use yet), or add a placeholder `sfx` object.
   - Keep it unused in runtime until the next plan.
   Testing:
   - Canonical (expected): build passes; no behavior changes.
   - Record actual output: `agents/implementation/tests/plan_33/step_08_sfx_prep.md`  
   Checkpoint: Wait for developer approval before proceeding.

9. Build, smoke test, and commit  
   Status: Pending  
   Testing:
   - `npm run build`
   - `npm run web:build:scoped`
   - Manual: produce 3 productions from the same upload:
     - replace + normalize on
     - mix + ducking off
     - mix + ducking on
   Checkpoint: Wait for developer approval before proceeding.

## 5. Confirmed Decisions

- New default for newly-produced items: `mix` mode via preset.
- Music gain presets: Quiet `-24`, Medium `-18`, Loud `-12`.
- Ducking: preset-driven, with fixed internal defaults (no tuning UI yet).
- Ownership: Audio Config presets are user-owned (created by site_admin), same as Logo Configs (not system-owned).
