# Implementation Plan 34: Intro “Newsroom SFX” Overlay (Fade + Optional Ducking)

## 1. Goal

Add an optional **intro SFX sting** (e.g. newsroom “breaking news”) that plays at the **start of the production** while the creator intentionally pauses ~3 seconds. If the creator speaks early, the SFX should still mix with the original video audio and optionally **duck** under loud speech.

In scope:
- Intro SFX overlay at `t=0` for a configurable duration (default `3s`)
- Optional fade in/out (simple on/off)
- Optional ducking (simple on/off; fixed defaults)
- Admin-managed presets (like Audio Configs) so creators just pick a preset

Out of scope (but align for later):
- Multiple overlays across the timeline
- Per-overlay tuning UI (attack/release, threshold, etc)
- Automatic speech detection

## 2. Proposed UX + Ownership

- Site admin creates/edits presets in `/admin/audio-configs`:
  - “Mix (Medium)”
  - “Mix (Medium) + Ducking”
  - “Mix (Medium) + Newsroom Intro”
  - “Mix (Medium) + Newsroom Intro + Ducking”
- Creators select **system audio** in `/produce` (already) and pick an **Audio Config** preset (already).
- Intro SFX is part of the **Audio Config preset** (so creators don’t need another picker yet).

## 3. Data Model Changes

### 3.1 `audio_configurations` table (extend)

Add columns (all optional):
- `intro_sfx_upload_id BIGINT UNSIGNED NULL`
- `intro_sfx_seconds INT UNSIGNED NULL` (default `3`)
- `intro_sfx_gain_db SMALLINT NOT NULL DEFAULT 0` (start at `0`, can later expand)
- `intro_sfx_fade_enabled TINYINT(1) NOT NULL DEFAULT 1`
- `intro_sfx_ducking_enabled TINYINT(1) NOT NULL DEFAULT 0`
- `intro_sfx_ducking_amount_db SMALLINT NOT NULL DEFAULT 12`

### 3.2 Production config snapshot

Continue snapshotting presets at produce-time. Extend `audioConfigSnapshot`:

```json
{
  "audioConfigSnapshot": {
    "id": 123,
    "name": "Mix (Medium) + Newsroom Intro",
    "mode": "mix",
    "videoGainDb": 0,
    "musicGainDb": -18,
    "duckingEnabled": false,
    "duckingAmountDb": 12,
    "introSfx": {
      "uploadId": 56,
      "seconds": 3,
      "gainDb": 0,
      "fadeEnabled": true,
      "duckingEnabled": true,
      "duckingAmountDb": 12
    },
    "overlays": []
  }
}
```

Notes:
- Keep `overlays: []` for future generalized overlays. Intro SFX can later be migrated into that array.

## 4. Backend Changes

1. **DB migration**: add the new columns to `audio_configurations` (idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`).
2. **Audio Config repo/service**:
   - Validate `intro_sfx_seconds` bounds (e.g. `0..30`, with `3` default).
   - Validate referenced `intro_sfx_upload_id` exists, is `kind='audio'`, `is_system=1`, and `status in ('uploaded','completed')`.
3. **Admin UI** (`/admin/audio-configs/new` + `/admin/audio-configs/:id`):
   - Add an “Intro SFX” section:
     - Select: None | (list of system audio uploads by name)
     - Duration: dropdown (e.g. `2s, 3s, 4s, 5s`) or numeric input
     - Fade: checkbox
     - Ducking: checkbox
   - Seed defaults (one-time) should include at least one preset with intro enabled.
4. **Create production snapshot**:
   - When an audio config has intro enabled, store `audioConfigSnapshot.introSfx`.

## 5. ffmpeg / Pipeline Changes

Extend `src/services/ffmpeg/audioPipeline.ts` to support an optional **third input** (intro SFX) and generate a filter graph that:

- Uses video’s embedded audio as the **base** stream `[0:a]` (apply `videoGainDb`)
- Uses background music input `[1:a]` (apply `musicGainDb`, loop as today)
- Uses intro SFX input `[2:a]`:
  - `atrim=0:<introSeconds>` to cap duration
  - optional fades (fixed duration, e.g. `0.35s`):
    - `afade=t=in:st=0:d=0.35`
    - `afade=t=out:st=<introSeconds-0.35>:d=0.35` (clamp if introSeconds < fade*2)
  - optional ducking:
    - duck the **SFX** using `sidechaincompress` with `[0:a]` (video audio) as sidechain
    - fixed conservative parameters derived from `duckingAmountDb` (same heuristic as music ducking)

Finally:
- `amix=inputs=3:duration=first` to mix `[video] + [music] + [sfx]`.

Edge cases:
- If the source video has **no audio stream**, mixing may fail; keep the existing fallback behavior:
  - either fall back to replace-mode (existing), or generate a silent base (`anullsrc`) as a follow-up improvement.

## 6. `/produce` UX (Optional in this plan)

No new picker required if intro SFX is only preset-driven.
- The Audio Config summary should reflect intro SFX when present, e.g.:
  - `Mix • Music -18 dB • Intro SFX (3s) • Ducking`

## 7. Testing / Validation

- Add a small plan doc entry under `agents/implementation/tests/plan_34/`:
  - Create a production with:
    - music + intro SFX + fade on + ducking on
  - Confirm:
    - SFX plays at the start only
    - Fade is audible (not abrupt)
    - If speech starts early, SFX ducks (or at least does not overpower)

## 8. Open Questions (to confirm before implementation)

Confirmed:

1. **Intro SFX choice**: one system-uploaded file (not uploaded yet).
2. **Fade duration**: hardcode `0.35s` in/out for now.
3. **Intro duration**: allow `2–5s` choices (default `3s`).
4. **Ducking sidechain**: duck against **video audio**.
5. **Interaction with music ducking**: if enabled for both, duck music and intro SFX independently against video audio.
