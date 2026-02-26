# Plan 97 — Screen Titles: Mini-Panel Style + Placement Tabs

## 1. Goal
Extend the floating Screen Title mini-panel so users can perform most common visual edits and placement edits in one place, with fast preview feedback and minimal context switching.

Target result:
1. `Style` tab for common visual controls.
2. `Placement` tab for current position/size controls.
3. Keep advanced authoring tasks in `Customize Style` modal (instance creation, textarea, reset to base).

## 2. Confirmed Product Direction
1. Add two tab buttons after `Instance` selector:
   - `Style`
   - `Placement`
2. Header label reflects active tab:
   - `Style ::`
   - `Placement ::`
3. `Style` tab controls:
   - `Select Style`
   - `Text Align` (Left/Center/Right icon toggles)
   - `Font Family`
   - `Variant`
   - `Text Size`
   - `Font Color`
   - `Text Gradient`
4. Keep these in context menu `Customize Style` only:
   - instance creation
   - textarea text entry
   - reset to base
5. `Style` tab may be larger than `Placement` tab.

## 3. UX Model

### Mini-panel structure
1. `Instance` selector (top, shared across tabs).
2. Tab row: `Style` and `Placement`.
3. Tab content area:
   - `Style`: visual controls.
   - `Placement`: existing placement model + nudges.
4. Shared footer actions:
   - `Done`
   - `Render`

### Interaction behavior
1. Changing any style or placement control marks panel state as dirty.
2. `Render` is enabled only when dirty.
3. `Render` rerenders selected Screen Title and keeps panel open.
4. `Done` closes panel; if dirty, keep existing confirm flow (`Render + Close` or `Close without render`).
5. Existing auto-render on direct placement drag-release remains unchanged.

## 4. Data/State Strategy
1. Reuse existing `screenTitlePlacementEditor` state as single source for per-instance style/placement edits while panel is open.
2. Add mini-panel local tab state:
   - `screenTitleMiniTab: 'placement' | 'style'`
3. Reuse existing dirty/render-busy flow:
   - `screenTitlePlacementDirty`
   - `screenTitleRenderBusy`
4. No schema/API changes required:
   - all style overrides already saved through current Screen Title render path.

## 5. Phased Implementation

### Phase A — Tab Shell + Header Split
Scope:
1. Add mini-panel tab state and tab buttons under `Instance`.
2. Switch header title text between `Style ::` and `Placement ::`.
3. Keep current `Placement` content as-is under `Placement` tab.
4. Add placeholder `Style` panel skeleton (no functional controls yet).

Checkpoint:
1. Tabs switch correctly.
2. Header updates correctly.
3. Existing placement behavior unchanged.

---

### Phase B — Functional Style Controls
Scope:
1. Implement `Style` controls in mini-panel:
   - style preset select
   - text align icon toggle group
   - font family select
   - variant select
   - text size control
   - font color picker
   - text gradient select
2. Bind controls to active instance style override in panel editor state.
3. Mark dirty on change.

Checkpoint:
1. Controls reflect current active instance values.
2. Changing controls updates preview overlays immediately where applicable.
3. Dirty state and `Render` enablement work.

---

### Phase C — Render/Done Flow Integration
Scope:
1. Ensure style changes render through existing `/api/create-video/screen-titles/render` path.
2. Confirm `Render` behavior:
   - rerender and stay in panel.
3. Confirm `Done` behavior:
   - closes panel with dirty confirm.
4. Keep placement auto-render-on-drag-release unchanged.

Checkpoint:
1. Style tab edits render correctly in preview/export.
2. No regressions in placement render behavior.

---

### Phase D — Layout Polish
Scope:
1. Tune style-tab layout for readability (can be taller/wider than placement tab).
2. Keep button/spacing consistency with existing mini-panel visual system.
3. Verify mobile tap targets and overflow handling.

Checkpoint:
1. Style panel remains usable on phone-width screens.
2. No clipping/cropping in panel controls.

## 6. QA Matrix
1. Tab switching:
   - switch tabs repeatedly while editing one instance.
2. Multi-instance:
   - change style on `Instance 1`, switch to `Instance 2`, styles remain isolated.
3. Dirty behavior:
   - style change enables `Render`.
   - no-change does not enable `Render`.
4. Render behavior:
   - style changes render correctly and panel remains open.
5. Close behavior:
   - dirty close confirm path works for style-only edits and mixed edits.
6. Regression checks:
   - placement nudges and drag handles still work.
   - export output matches preview for style overrides.

## 7. Technical Touchpoints
1. `frontend/src/app/CreateVideo.tsx` (primary mini-panel + state wiring)
2. Existing Screen Title style helper functions already used in this file:
   - style normalization/apply helpers
   - render request payload builder
3. No expected backend/schema changes for this plan.

## 8. Risks and Guardrails
1. Risk: style-tab adds too many controls in small panel.
   - Mitigation: allow larger style panel size and compact control rows.
2. Risk: style control state divergence from modal editor.
   - Mitigation: use same per-instance editor state source and save path.
3. Risk: excessive rerenders from rapid changes.
   - Mitigation: keep manual `Render` trigger for style controls.
