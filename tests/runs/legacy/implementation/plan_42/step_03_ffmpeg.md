Step 03 (FFmpeg)

- Mix mode: applies `highpass` to `[0:a]` (video/original audio) only; does not touch `[1:a]` (music/opener).
- Abrupt ducking analysis (`silencedetect`) also applies the same highpass when enabled.

