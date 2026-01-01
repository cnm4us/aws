### 2026-01-01

- Implemented ducking via ffmpeg `sidechaincompress` when `audioConfigSnapshot.mode === 'mix'` and `duckingEnabled === true`.
- Verified filtergraph syntax locally by generating a synthetic MP4 + M4A and running the equivalent filtergraph successfully.

Notes:
- This ffmpeg build does not appear to accept intermediate labels as inputs to `sidechaincompress` (works with direct `[1:a][0:a]...`).
- `sidechaincompress.threshold` is linear (0..1), not dB.
