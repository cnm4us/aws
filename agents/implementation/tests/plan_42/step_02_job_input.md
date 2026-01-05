Step 02 (Job Input)

- Added optional `videoHighpassEnabled` / `videoHighpassHz` to `AudioMasterV1Input`.
- `startProductionRender()` populates these into `audio_master_v1` jobs from env.
- Worker passes through to ffmpeg pipeline (backward compatible if missing).

