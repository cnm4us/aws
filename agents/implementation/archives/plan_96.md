# Plan 96 — Screen Titles: Preview Placement + Precision Panel

## 1. Goal
Move Screen Title placement into the main preview workflow while preserving low-friction editing:

1. Casual users: drag/resize directly on preview and save.
2. Power users: use a floating precision mini-panel for mode selection and nudges.

This plan extends `plan_95.md` (Phase 3) without removing the current placement modal until rollout is stable.

## 2. Confirmed Product Direction
1. `Customize Placement` should target preview-based editing.
2. Multi-instance Screen Titles require explicit instance selection.
3. Keep direct on-canvas drag/handles active.
4. Add optional precision controls in a floating, draggable mini-panel.
5. Mini-panel model:
   - Square with 4 selectable edges + center point.
   - Selecting center = move whole box.
   - Selecting an edge = resize that edge.
   - Arrow controls adapt to selection (move arrows vs in/out arrows).
6. Save/update should not reload the page:
   - Re-render only that Screen Title asset via `/api/create-video/screen-titles/render`.

## 3. UX Model
### Placement activation
- From Screen Title context menu:
  - `Placement`
    - `Instance 1`
    - `Instance 2`
    - `Instance N`
- Selecting an instance enters placement mode on preview.

### On-preview overlays
- Active instance:
  - visible placement rect + handles
  - draggable body, resizable edges
- Non-active instances:
  - faint outlines only (non-draggable), for overlap awareness.

### Floating mini-panel
- Draggable panel, auto-placed away from active box on open.
- Contains:
  - instance selector
  - square mode selector (top/right/bottom/left/center)
  - context-sensitive arrow controls
  - step size toggle (`1px` / `5px`)
  - `Done` / `Cancel`

### Layering rule
- Instance array order remains render order.
- Last instance renders on top.

## 4. Phased Implementation

### Phase A — Preview Placement Mode (Direct Manipulation)
Scope:
1. Add placement mode state for selected Screen Title + active instance.
2. Render placement overlays on preview only when placement mode is active.
3. Support drag/resize interactions with existing safe-area and min-size constraints.
4. Add `Done`/`Cancel` controls (simple temporary controls acceptable in this phase).

Checkpoint:
1. User can place one instance directly on preview.
2. Save applies only to that Screen Title object and refreshes preview/export data.
3. No full-page reload.

---

### Phase B — Multi-instance Selection Flyout
Scope:
1. Replace single `Customize Placement` action with a flyout list of instances.
2. Opening an instance enters preview placement mode for that instance.
3. Show non-active instance outlines while editing.

Checkpoint:
1. Overlapping instances are still selectable via explicit list.
2. Active instance switching is deterministic and persists while editing.

---

### Phase C — Floating Precision Mini-panel
Scope:
1. Add draggable mini-panel anchored over preview.
2. Implement square mode selector (4 edges + center).
3. Implement context-sensitive arrow nudges:
   - center selected: move rect
   - edge selected: resize in/out for that edge
4. Implement step size toggle (`1px`, `5px`).

Checkpoint:
1. Small placement boxes remain editable without relying on tiny handles.
2. Users can complete placement with panel-only controls.

---

### Phase D — Polish + Guardrails
Scope:
1. Auto-position mini-panel to avoid overlap with active box.
2. Allow manual panel drag reposition.
3. Add subtle visual states:
   - active instance
   - active edge/move mode
   - disabled controls at constraints
4. Keep existing placement modal as fallback toggle until stable; remove later if desired.

Checkpoint:
1. Mobile and desktop interactions are reliable.
2. No gesture conflicts with timeline scrubbing or playback controls.

## 5. Data / API Behavior
1. Continue using `placementRect` per instance as source of truth.
2. Maintain existing safe-area and min-size constraints from `plan_95`.
3. On `Done`, call `/api/create-video/screen-titles/render` with updated instance overrides.
4. Update only the selected Screen Title segment (`renderUploadId` refresh), no global reload.

## 6. QA Matrix
1. Single instance:
   - drag, resize, save, reopen, export parity.
2. Multi-instance:
   - switch instance from flyout, overlap behavior, stacking order consistency.
3. Precision panel:
   - edge selection, center move mode, 1px and 5px step behavior.
4. Cancellation:
   - `Cancel` restores pre-edit placement.
5. Constraints:
   - safe-area clamping and min-size at every interaction path.
6. Mobile:
   - touch drag + panel drag + handle drag without page scroll/zoom side effects.

## 7. Confirmed Defaults
1. Placement mode auto-pauses preview playback.
2. `Done` auto-closes placement mode.
3. Placement modal remains accessible behind `Advanced...` during transition (temporary).
