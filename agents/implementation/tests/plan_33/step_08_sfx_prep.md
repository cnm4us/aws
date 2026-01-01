# Plan 33 - Step 08: SFX prep (schema only)

## What changed

- New productions now store `audioConfigSnapshot.overlays: []` in `productions.config` (unused at runtime).

## Expected behavior

- No functional change to rendering behavior; the runtime reads only the existing audio config fields.
