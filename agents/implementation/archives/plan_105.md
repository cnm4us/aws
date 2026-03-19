# Plan 105: Visualizer Layer + Preset Library

## Goal
Create a dedicated **Visualizer** layer (top of the stack, above graphics) driven by selectable **presets** from `/assets/visualizers`. Each visualizer segment binds to an audio source (Video, Video Overlay, Narration, Music) and stays aligned with its source over time.

## Non-Goals
- Remove narration-embedded visualizer immediately.
- Implement high‑fidelity (canvas → frames) export pipeline.
- Add circular/shape clipping to export (preview-only for now).

## Decisions (Confirmed)
- Start with `/assets/visualizers` so presets exist before timeline work.
- Visualizer layer is **top-most** (above graphics).
- Visualizer segments bind to **specific source segments** to avoid drift.
- Add a **Split Linked Segments** action to keep aligned edits consistent.

## Data Model
- `visualizer_preset` (new asset type):
  - `name`, `description`
  - `style` (wave_line, wave_fill, spectrum_bars, radial_bars)
  - `fgColor`, `bgColor`, `opacity`
  - `gradientEnabled`, `gradientStart`, `gradientEnd`, `gradientMode`
  - `clipMode`, `clipInsetPct`, `clipHeightPct`
  - `scale`
  - optional future: `barCount`, `lineWidth`, `glow`
- `visualizer_segment` (timeline item):
  - `id`, `presetId`
  - `startSeconds`, `endSeconds`
  - `audioSourceKind` (video | video_overlay | narration | music)
  - `audioSourceSegmentId`
  - `audioSourceStartSeconds` (for drift guard)
  - optional per‑segment overrides (same fields as preset, but nullable)

## Phase A — Preset Asset Type + UI
1. Backend
   - Add model + CRUD endpoints for visualizer presets.
   - Add validation for all visualizer fields.
2. UI list
   - `/assets/visualizers` list page with Nebula card style.
   - New/Edit preset form:
     - All current visualizer knobs (style, colors, gradient, clip, opacity, scale).
     - Live canvas preview (same renderer as narration modal).
3. Hook into `/assets` index
   - Add Visualizers card to assets landing page.

## Phase B — Visualizer Timeline Layer
1. Add a **Visualizer** lane (topmost) in the timeline.
2. Add “+ Add Asset” option for Visualizer.
3. Visualizer segment properties:
   - Select preset
   - Select audio source (Video / Overlay / Narration / Music)
   - Optional per‑segment overrides
4. Segment display:
   - Pill label with preset name + source label (e.g., “VIZ: Gold Bars → Narration #2”).

## Phase C — Audio Binding + Drift Guard
1. When binding to a source segment:
   - Store `audioSourceSegmentId`
   - Store `audioSourceStartSeconds` at bind time
2. Playback math:
   - `audioTime = sourceStartSeconds + (playhead - visualizer.startSeconds)`
3. If the source segment is trimmed or moved:
   - Keep visualizer aligned (update sourceStartSeconds)
   - Provide a **Rebind** action in the visualizer properties

## Phase D — Split Linked Segments
1. New action: **Split Linked Segments** at playhead.
2. Splits:
   - Visualizer segment
   - Bound audio segment (narration/music)
   - Optional matching graphic segment
   - Optional video/overlay segment
3. Preserve alignment by copying `audioSourceStartSeconds` into new segments.

## Phase E — Preview Rendering
1. Reuse existing visualizer canvas renderer.
2. Drive from the selected audio source element:
   - Narration/Music: audio preview element
   - Video/Overlay: corresponding video element audio
3. Respect preview mute/solo rules.

## Phase F — Export Rendering
1. Use existing ffmpeg visualizer overlay (showwaves/showspectrum).
2. For unsupported styles (radial, gradients, clip):
   - Fallback to closest supported style
   - Preserve `fgColor` (use gradient start as fallback)
3. Place visualizer overlay above graphics in filtergraph order.

## Phase G — Migration (Optional)
- Offer one‑time migration:
  - Narration segment visualizers → create visualizer segments bound to narration.
  - Keep narration visualizer fields for backward compatibility.

## QA Checklist
1. Presets list/create/edit/delete.
2. Visualizer layer visible and top‑most.
3. Binding to each audio source works.
4. Split linked segments keeps alignment.
5. Preview matches audio timing.
6. Export renders for supported styles; unsupported styles gracefully fall back.

## Notes
- This plan coexists with `plan_102.md` (narration‑embedded visualizer).
- We can retire narration‑embedded visualizer once Visualizer Layer is stable.
