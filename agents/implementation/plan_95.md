# Plan 95 — Screen Titles: Split Style vs Placement

## 1. Goal
Reduce cognitive load in Screen Title editing by separating:

- `Customize Style` (how text looks)
- `Customize Placement` (where/within what region text renders)

This replaces the current mixed model where placement, alignment, and inset nudges are blended in one editor.

## 2. UX Intent
Keep user decisions simple and sequential:

1. Pick/create instance(s) and style text.
2. Place each instance in a visual region on screen.
3. Save and see immediate timeline preview update.

Key outcomes:
- Clear mental model: appearance vs layout.
- Better support for multi-instance titles.
- More predictable mobile interactions.

## 3. Confirmed Direction
1. Placement preview should be scaled down.
2. Default placement background should be neutral dark (not pure black), not timeline screenshot.
3. Safe-area guides are system-defined and non-configurable.
4. Current-frame screenshot mode can be a later optional enhancement.
5. Safe-area insets should be defined in percentages, not fixed pixels.
6. Initial safe-area defaults:
   - `top: 6%`
   - `right: 5%`
   - `bottom: 8%`
   - `left: 5%`
7. Minimum placement rect size: `wPct >= 12`, `hPct >= 8`.
8. Rect clipping behavior for v1: hard clip.
9. New instance default placement: full safe-area box (do not inherit prior instance).

## 4. Data Model & Compatibility

### New/primary placement model (per Screen Title instance)
- `placementRect` (normalized, canvas-relative):
  - `xPct`, `yPct`, `wPct`, `hPct` (0-100 scale)
- `textAlign` remains style-level (`left|center|right`) and no longer doubles as placement selection.

### Backward compatibility
- Existing fields (`position`, inset presets/pixels, 3x3 semantics) remain readable for legacy projects.
- On load:
  - If `placementRect` missing, derive from legacy fields.
  - Persist derived `placementRect` on next save.
- Renderer preference order:
  - `placementRect` first, legacy fallback second.

## 5. Phased Implementation

### Phase 1 — Model + Renderer Foundation
Scope:
- Add `placementRect` support to Screen Title instance model.
- Add normalization/migration logic from legacy placement fields.
- Update preview and export renderers to use `placementRect`.
- Keep current UI unchanged during this phase.

Checkpoint:
1. Existing projects render unchanged.
2. New instances can carry `placementRect`.
3. Preview/export parity with `placementRect`.

---

### Phase 2 — Split Menus + Style Editor Simplification
Scope:
- Context menu additions:
  - `Customize Style`
  - `Customize Placement`
- In `Customize Style`:
  - Remove 3x3 placement grid.
  - Remove X/Y inset nudge controls.
  - Keep text alignment control.
  - Keep all visual typography controls.

Checkpoint:
1. Style editor updates text appearance only.
2. Style save triggers immediate rerender.
3. No regressions in multi-instance style editing.

---

### Phase 3 — Placement Editor v1 (Drag/Resize)
Scope:
- New `Customize Placement` editor with:
  - Scaled stage preview (neutral dark background).
  - Visible safe-area guides.
  - Instance selector (same instances as style editor).
  - Active instance rectangle overlay.
  - Drag to move.
  - 4 side handles to resize.
- Constraints:
  - Clamp within safe-area bounds.
  - Minimum width/height.
  - Prevent inverted rect.

Checkpoint:
1. User can reposition and resize per instance by touch/mouse.
2. Save updates timeline preview immediately.
3. Placement persists on reload and survives export.

---

### Phase 4 — Micro-Nudge Controls (Precision)
Scope:
- Add fine control under placement stage:
  - Select active edge/handle.
  - `in` / `out` nudge buttons for that edge.
  - Optional move nudges (up/down/left/right) for whole rect.
- Keep drag/resize as primary method.

Checkpoint:
1. Fine placement adjustments work on mobile reliably.
2. Nudge behavior is deterministic and bounded by safe-area.

---

### Phase 5 — Cleanup & Legacy De-emphasis
Scope:
- Remove unused placement UI/state from style paths.
- Keep legacy read support in model validation/migration only.
- Add telemetry/logging hooks (optional) for placement editor usage.

Checkpoint:
1. No dead UI for legacy placement controls.
2. Existing projects still load and save safely.

## 6. Rendering Rules
1. Text layout region is `placementRect` within 1080x1920 normalized space.
2. Text wraps/clips according to existing Screen Title text rules, but bounded to the region.
3. `textAlign` applies inside that region only.
4. Safe-area is an editor guide; render behavior still uses actual stored `placementRect`.

## 7. Technical Touchpoints (Expected)
- `frontend/src/app/CreateVideo.tsx`
- `frontend/src/app/createVideo/timelineTypes.ts`
- Screen title rendering utilities/components used by preview
- Export path handling Screen Title compositing in:
  - `src/media/jobs/createVideoExportV1.ts`
- Validation/types if screen-title schema is enforced server-side:
  - `src/features/create-video/types.ts`
  - `src/features/create-video/validate.ts`

## 8. QA Matrix
1. Multi-instance title:
   - Different style + different placement per instance.
2. Split title object:
   - Style and placement persistence before/after split.
3. Undo/redo:
   - Placement changes tracked correctly.
4. Mobile:
   - Handles usable without accidental page scroll/zoom.
5. Export parity:
   - Placement and alignment match preview.

## 9. Build Defaults
1. Safe-area uses percentage insets (`top 6%`, `right 5%`, `bottom 8%`, `left 5%`).
2. Minimum rect size is enforced as `wPct >= 12`, `hPct >= 8`.
3. Placement region uses hard clipping in v1.
4. Each new instance starts at full safe-area bounds.
