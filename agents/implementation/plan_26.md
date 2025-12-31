# Implementation Plan 26: Compact Custom Audio Player (Per Row)

## 1. Overview

Goal: Replace bulky native `<audio controls>` UI on:
- `/produce?upload=:id` (Build Production page)
- `/produce?upload=:id&pick=audio` (Audio picker modal)

…with a compact, dark-themed custom player that supports:
- Play / Pause
- Scrubbing (seek) via progress bar
- Time display `mm:ss / mm:ss`

Constraints:
- Avoid bundle bloat (no third-party player library).
- iOS Safari: playback must be user-initiated; we’re fine (tap-to-play).

Decisions (confirmed):
1) Starting playback on one row pauses any other row automatically.
2) Time display uses `mm:ss / mm:ss`.

Out of scope:
- Applying this same player elsewhere (Uploads listing, etc).
- Waveforms, playback rate controls, download controls.

## 2. Implementation Steps

### Step 1 — Add `CompactAudioPlayer` component
Files:
- `frontend/src/components/CompactAudioPlayer.tsx` (new)

Behavior:
- Renders a hidden `<audio>` element (no `controls`) and custom UI.
- Subscribes to `loadedmetadata`, `timeupdate`, `play`, `pause`, `ended`, `error`.
- Implements scrubbing with `<input type="range">`:
  - `onInput` updates `audio.currentTime` (continuous seek).
- Displays `currentTime / duration` formatted as `mm:ss / mm:ss`.

Single-player-at-a-time rule:
- Use a tiny module-level singleton:
  - When a player begins playing, it pauses the previously playing element.
  - On unmount, if it owns the singleton, it clears it.

### Step 2 — Integrate in `/produce`
File:
- `frontend/src/app/Produce.tsx`

Changes:
- Replace native `<audio controls>` in:
  - Main Audio selection summary (only shows when selected).
  - Audio picker list (per row).

### Step 3 — Styling + density pass
Goals:
- Keep each audio row compact (controls on one line when possible).
- Maintain touch-friendly tap targets (>= ~40px).

### Step 4 — Manual test checklist
- On `/produce`:
  - Choose audio → preview play/pause, scrub works, time display updates.
  - Clear selection removes player.
- On `?pick=audio`:
  - Play audio in one row, then play another row → first pauses.
  - Scrub works while playing and paused.
  - Back closes picker; ensure audio stops (optional, but recommended).

