# Plan 35: Add “Abrupt Ducking” (Gate) option to Audio Configs

## Goal
Add a second ducking behavior suitable for openers/stings:
- **None**
- **Rolling Ducking** (current behavior; dynamic sidechain compression)
- **Abrupt Ducking** (new behavior; sidechain gate that rapidly attenuates the added track when original audio crosses a threshold)

Also add a shared **Ducking Sensitivity** preset that applies to both ducking types:
- **Sensitive**, **Normal (default)**, **Strict**

## UX / Product Decisions (confirmed)
- Ducking is a single select: `None | Rolling | Abrupt`
- A single `Ducking Sensitivity` dropdown applies to either ducking type; default `Normal`
- Ducking applies only in **Mix** mode (keep copy and behavior consistent with current UI)

## Implementation Outline

### 1) Data model + migration
- Add columns to `audio_configurations`:
  - `ducking_mode` (string): `'none' | 'rolling' | 'abrupt'` (default `'none'`)
  - `ducking_gate` (string): `'sensitive' | 'normal' | 'strict'` (default `'normal'`)
- Backfill existing rows:
  - If `ducking_enabled=1` → `ducking_mode='rolling'`
  - Else → `ducking_mode='none'`
  - Set `ducking_gate='normal'` for all existing rows
- Keep existing columns (`ducking_enabled`, `ducking_amount_db`) for now for backwards compatibility and low-risk rollout; code will prefer the new columns.

### 2) Server types + service logic
- Update `src/features/audio-configs/types.ts` and `src/features/audio-configs/service.ts`:
  - Expose `duckingMode` and `duckingGate` on DTOs.
  - Validation:
    - If `mode !== 'mix'`, force `duckingMode='none'` (ducking UI can still render but will not apply).
    - Default `duckingGate='normal'`.
  - Map DB rows:
    - Prefer `ducking_mode`/`ducking_gate` when present.
    - Fallback: if missing, infer from legacy `ducking_enabled`.
- Update default preset seeding (`ensureDefaultsIfNoneActive`) to set:
  - “Mix (Medium) + Ducking” → `ducking_mode='rolling'`, `ducking_gate='normal'`.

### 3) Admin UI (server-rendered)
- Update the Audio Config editor form (`/admin/audio-configs/new` and `/admin/audio-configs/:id`):
  - Replace the “Ducking” checkbox with:
    - `Ducking Mode` select: `None | Rolling | Abrupt`
    - `Ducking Sensitivity` select: `Sensitive | Normal | Strict`
  - Keep existing explanation text and add a short hint:
    - Rolling = “smoothly lowers music under original audio”
    - Abrupt = “rapidly fades music toward silence when original audio is loud”

### 4) Production snapshot + runtime behavior
- Update `src/features/productions/service.ts` to snapshot:
  - `duckingMode`, `duckingGate` (and keep `duckingAmountDb` for rolling strength)
- Update `src/services/productionRunner.ts` to:
  - Parse `duckingMode`/`duckingGate`, with backward-compatible fallback:
    - If `duckingEnabled=true` and `duckingMode` missing → treat as `rolling`
  - Pass `duckingMode`/`duckingGate` into ffmpeg mux step.

### 5) ffmpeg pipeline changes (Mix mode)
- Update `src/services/ffmpeg/audioPipeline.ts`:
  - Replace the fixed compressor threshold with a preset-derived threshold:
    - Sensitive: `0.06`
    - Normal: `0.10`
    - Strict: `0.14`
  - Rolling Ducking:
    - Continue using `sidechaincompress` with:
      - `threshold` from preset
      - `ratio` derived from `duckingAmountDb` (current behavior)
      - `attack=20ms`, `release=250ms` (current defaults)
  - Abrupt Ducking:
    - Use `sidechaingate`:
      - `threshold` from preset
      - `attack` small (e.g. `5–10ms`)
      - `release` moderate (e.g. `300–500ms`) to reduce chatter
      - `range` near silent (e.g. `0.001` ≈ -60 dB) to “drop to ~0”
  - Keep `amix normalize=0` + `alimiter` after mixing (required for audibility/predictable gain).

### 6) Creator-facing summary (Produce UI)
- Update `frontend/src/app/Produce.tsx` summary to display:
  - `Ducking: Rolling (Normal)` or `Ducking: Abrupt (Strict)` (only when duckingMode != none)

### 7) Validation / Testing
- Build checks:
  - `npm run web:build:scoped`
- Manual test matrix:
  - Mix + Rolling + Sensitive/Normal/Strict: verify earlier/later trigger behavior.
  - Mix + Abrupt + Sensitive/Normal/Strict: verify fast cutoff; ensure no oscillation/chatter.
  - Replace mode: ducking should not apply (confirm no breakage).

## Open Questions (none required to start)
- Whether to add a “Hold” parameter later to prevent rapid on/off on short pauses (can be deferred).
