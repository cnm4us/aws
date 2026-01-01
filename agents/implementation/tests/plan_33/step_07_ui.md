# Plan 33 - Step 07: /produce Audio Config picker

## What changed

- `/produce?upload=<id>` now supports `audioConfigId=<id>` and a full-screen picker via `pick=audioConfig`.
- UI shows an “Audio Config” card with Choose/Clear actions and a short summary (mix/replace + dB + ducking).
- `POST /api/productions` includes `audioConfigId` (or `null`).

## Manual test checklist

1. Open `/produce?upload=<id>` as a logged-in user.
2. Pick a system audio track (Audio → Choose).
3. Pick an audio preset (Audio Config → Choose) and select “Mix (Medium)” or “… + Ducking”.
4. Refresh the page and confirm selections persist via URL params.
5. Click Produce and confirm production config contains `audioConfigId` + `audioConfigSnapshot`.
6. Clear Audio and confirm `musicUploadId` and `audioConfigId` are removed from the URL and UI resets.

## Notes

- If `musicUploadId` is set but no `audioConfigId` is provided, backend defaults to “Mix (Medium)” (or a hardcoded fallback if none exist).
