# Plan 102 - Audio Visualizer (MVP)

## Recommendation: Start With Narration
Narration is the cleanest first surface:
- Audio-only, no competing video layer.
- Single source per object, minimal layering conflicts.
- Fastest to wire from object property → render → export.

Music/Audio is a close second. Video/video-overlay visualizers add complexity (muting video frames, dual-layer preview, and performance implications). Starting with narration lets us validate UI/UX + ffmpeg pipeline quickly, then expand.

---

## Phase A — MVP Data + Rendering Pipeline (Narration only)

### A1) Data model (frontend + backend)
- Add `visualizer` settings to narration objects in timeline payload.
- Proposed structure (minimal):
  - `enabled: boolean`
  - `style: 'wave_line' | 'wave_fill' | 'spectrum_bars' | 'spectrum_line' | 'cqt' | 'vectorscope'` (start with 3)
  - `fgColor: string` (hex)
  - `bgColor: string | 'transparent'`
  - `opacity: number` (0..1)
  - `scale: 'linear' | 'log'`
  - `heightPct: number` (if we want a band instead of full frame)
- Default `enabled: false` so existing timelines remain unchanged.

### A2) FFmpeg filtergraph (render-time)
- Build a small render helper that generates a visualizer stream from audio:
  - Example: `showspectrum` or `showwaves` → RGBA (alpha if bg transparent).
  - Output size: 1080x1920 (match timeline).
- Composite visualizer on top of background (or full-frame if bg defined).
- Wire into export pipeline for narration objects when `visualizer.enabled`.

### A3) API mapping
- Update timeline serializer/deserializer to persist `visualizer` settings.
- Add validation defaults (missing fields → disabled).

### A4) Basic UI (Narration object)
- Add “Visualizer” toggle in narration object properties.
- When enabled, expose:
  - Style select
  - Foreground color
  - Background color (transparent / color)
  - Scale (linear/log) if supported
- Keep it minimal and non-blocking for v1.

### A5) Preview behavior (create-video)
- For MVP, use a lightweight preview strategy:
  - Option 1: simple Canvas/WebAudio visualizer for live preview only.
  - Option 2: static placeholder + “Render Preview” button (generates small preview via backend).
- Recommendation: start with Canvas preview so users see immediate response without waiting.

---

## Phase B — Visual Style Presets + UX Polish

### B1) Preset library
- Curate 5-6 named styles (mapped 1:1 to ffmpeg filters), e.g.:
  - Wave Line
  - Wave Fill
  - Spectrum Bars
  - Spectrum Glow
  - CQT Musical
  - Stereo Vectorscope

### B2) Style tokens
- Add global palette defaults (gold/white) to keep on-brand.
- Save last-used style for quick reuse.

### B3) Small preview card
- Add a compact preview window inside narration properties (3–4 lines tall).
- Include “Generate” button if not using live Canvas preview.

---

## Phase C — Expand to Music/Audio

### C1) Reuse same UI + settings
- Add the same “Visualizer” panel to Music/Audio objects.
- Confirm audio-segment timeline mapping (multiple segments supported).

### C2) Render pipeline
- When visualizer enabled on music segments, generate visualizer for that segment’s time window.

---

## Phase D — Video & Video Overlay (Optional, Later)

### D1) “Audio-only with Visualizer” mode
- Add per video object option: “Hide Video (Show Visualizer)”.
- For preview: freeze-frame + visualizer overlay.
- For render: omit video frames, use visualizer over background.

---

## Questions to confirm before implementation
1. MVP visualizer styles: which 3 do you want first? (recommended: `wave_line`, `wave_fill`, `spectrum_bars`)
2. Default colors: gold on transparent background OK?
3. Preview: live Canvas preview OK for v1, or do you prefer a “Render Preview” button?
4. Should visualizer be full-frame or a bottom band by default? (recommend full-frame for v1)

---

## Deliverables (Phase A)
- Schema updates + timeline persistence.
- Narration visualizer UI toggle + settings.
- Render-time ffmpeg filter integration for narration.
- Preview support (Canvas or render button).
