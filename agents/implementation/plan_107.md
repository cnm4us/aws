# Plan 107: Visualizer Preset Instances + Preset/Object Responsibility Cleanup

## Goal
Refactor visualizer presets so a preset can contain **multiple style instances** (stacked passes), while keeping timeline object controls responsible for **placement/clip box**.  
This removes the current ambiguity around preset vs object properties and enables richer multi-band/multi-color visualizers.

## Accepted Decisions
- Visualizer preset editor (`/assets/visualizers/new|:id/edit`) will show:
  - Preview first (under description, already done).
  - Then an `Instances` list:
    - Start with `Instance #1`
    - `+` adds new instance by cloning the previous one.
    - `-` deletes an instance (min 1 instance).
- Instance fields are the current visual style knobs:
  - `Style`, `Scale`, `Spectrum`, `Bars`, `Opacity`, `Foreground`, `Gradient`.
- Remove `Clip` (`none/rect`, inset, height) from preset UI.
- Clip/placement/size remain in visualizer **timeline object** properties.

## Scope
- In scope:
  - Preset data model changes.
  - Preset editor UI for instances.
  - Create-video preview consumption of multi-instance presets.
  - Backward compatibility for existing single-instance presets.
- Out of scope for this plan:
  - Advanced per-instance frequency range controls (future plan).
  - New render-engine architecture (headless/canvas-frame pipeline).

## Data Model / API
### New DTO shape (visualizer preset)
- Add `instances: VisualizerPresetInstance[]`
- `VisualizerPresetInstance`:
  - `id: string` (stable UI key)
  - `style: 'wave_line' | 'wave_fill' | 'spectrum_bars' | 'radial_bars'`
  - `scale: 'linear' | 'log'`
  - `spectrumMode: 'full' | 'voice'`
  - `barCount: number`
  - `opacity: number`
  - `fgColor: string`
  - `gradientEnabled: boolean`
  - `gradientStart: string`
  - `gradientEnd: string`
  - `gradientMode: 'vertical' | 'horizontal'`

### Persistence strategy
- Add JSON column on `visualizer_presets`:
  - `instances_json JSON NULL`
- Read path:
  - If `instances_json` exists and valid, use it.
  - Else synthesize one instance from legacy top-level fields.
- Write path:
  - New/updated presets write `instances_json`.
  - Keep legacy columns written during transition for rollback safety.

## Phase A — Backend Schema + Service + Routes
1. DB migration in `src/db.ts`:
   - Add `instances_json` column if missing.
2. Types:
   - `src/features/visualizer-presets/types.ts`
3. Service normalization:
   - `src/features/visualizer-presets/service.ts`
   - Validate/clamp each instance field.
   - Enforce at least 1 instance and max instance count (recommend 8).
4. Routes:
   - `src/routes/visualizer-presets.ts`
   - Accept/return `instances`.

## Phase B — Preset Editor UI (`/assets/visualizers`)
1. Update `frontend/src/app/VisualizerPresets.tsx`:
   - Add `instances` editor section under Preview.
   - Instance card header: `Instance #N` + `-` button.
   - Global `+ Add Instance` button.
   - Clone-on-add behavior from previous instance.
2. Move style controls from single draft fields to per-instance fields.
3. Remove clip controls from preset UI.
4. Keep selected system-audio play/pause preview working.

## Phase C — Create Video Preview Consumption
1. Extend snapshot types:
   - `frontend/src/app/createVideo/timelineTypes.ts`
   - `frontend/src/app/CreateVideo.tsx`
2. Snapshot normalize:
   - If old snapshot has no `instances`, synthesize one.
3. Render loop:
   - Draw each instance as a separate pass in order.
   - Respect each instance’s colors/opacity/style settings.

## Phase D — Export Pipeline Alignment
1. Extend export payload and normalization:
   - `src/features/create-video/types.ts`
   - `src/features/create-video/validate.ts`
2. Update FFmpeg visualizer path:
   - `src/media/jobs/createVideoExportV1.ts`
   - Compose per-instance passes from same source audio.
3. Fallback safety:
   - If instance rendering fails, fallback to instance[0] only and surface warning in logs.

## Phase E — Cleanup + Compatibility Guardrails
1. Keep legacy single-field support in read path for old presets.
2. Remove clip references from preset UI text/help.
3. Add unit/validation tests for:
   - legacy -> instances synthesis
   - invalid instances payload rejection
   - min/max instance count

## QA Checklist
- Existing presets load without data loss (as 1 instance).
- New presets can add/delete/reorder? (order fixed by list position; no reorder UI in v1).
- Instance clone works correctly.
- Preview audio + visual behavior remains stable.
- `/create-video` renders multi-instance preset correctly.
- Export result matches preview at basic parity.
- No regression in object-level placement/clip controls.

## Risks
- FFmpeg composition complexity increases with instance count.
- Need strict cap on instance count to avoid mobile preview CPU spikes.
- Must keep legacy compatibility until all active timelines carry updated snapshots.

## Recommended limits (v1)
- `instances`: max 6–8
- `barCount`: keep existing 12–128 clamp
- Keep reorder out of v1 (append/delete only) to reduce UI complexity.
