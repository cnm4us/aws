# Plan 80 — Video Overlay Plate (Frame/Band) Presets

## Goal
Add a simple “plate” (colored background) behind **Video Overlay** clips to create thin/medium/thick frames or full-width bands. This should be configurable per overlay via Properties, render in ffmpeg, and (optionally) previewed in the Create Video UI.

## Scope (MVP)
- **Video Overlay only** (not graphics or base video).
- **Preset-based** plate styles (no freeform sizing yet).
- **Color + Opacity** controls.
- Rendered in **ffmpeg export**. Preview in UI if feasible with minimal complexity.

## UX / Controls
Add to **Video Overlay → Properties**:
- **Plate Style** (select):
  - None
  - Thin Frame
  - Medium Frame
  - Thick Frame
  - Full-Width Band
- **Plate Color** (color picker, default `#000000`)
- **Plate Opacity** (0–100%, default `85`)

## Data model updates
