# Plan 86 — Multi‑Instance Screen Titles (Single Timeline Object)

## Goal
Allow **multiple text instances** within a single Screen Title timeline object, without adding new lanes. Each instance has its own position/size/style overrides, while sharing the same timeline segment.

## UX Summary
- **Instances list** at top of Customize Screen Title modal.
- Up to **5 instances**.
- **Add Instance** copies the last instance.
- Selecting an instance loads its settings into the existing controls.
- Active instance clearly highlighted.
- **Optional micro‑nudges** for precise placement.

---

## Phase 0 — Data Model + Backward Compatibility
**Files**
- `frontend/src/app/createVideo/timelineTypes.ts`
- `src/features/create-video/validate.ts`
- `src/routes/create-video.ts`

**Data structure (proposal)**
```ts
type ScreenTitleInstance = {
  id: string
  text: string
  customStyle?: ScreenTitleCustomStyle | null
}

type ScreenTitle = {
  id: string
  startSeconds: number
  endSeconds: number
  presetId: number | null
  presetSnapshot: ScreenTitlePresetSnapshot | null
  // single-text legacy fields retained for migration:
  text?: string
  customStyle?: ScreenTitleCustomStyle | null
  // new:
  instances?: ScreenTitleInstance[]
  renderUploadId: number | null
}
```

**Migration behavior**
- If `instances` missing:
  - Create `instances=[{id: <generated>, text: st.text, customStyle: st.customStyle}]`
  - Preserve old fields for backward compat (or drop after transform).
- If `instances` present, ignore legacy `text/customStyle`.

**Validator updates**
- Validate `instances` (max 5, each text length <= 1000, lines <= 30).
- `ScreenTitleCustomStyle` stays same.

---

## Phase 1 — UI: Instances in Customize Modal
**Files**
- `frontend/src/app/CreateVideo.tsx`

**UI changes**
- Add **Instances section** under “Customize Screen Title” header.
- Buttons:
  - `+ Add Instance`
  - Row of instance pills: `Instance 1`, `Instance 2`, ...
  - Each instance has a small delete icon except when only one remains.
- Active instance pill highlighted with blue accent.

**Behavior**
- Add: clone last instance (text + customStyle).
- Select: load that instance into editor fields.
- Delete: remove and select nearest remaining instance.

**Editor state**
```ts
screenTitleCustomizeEditor: {
  id: screenTitleId
  presetId
  instances: ScreenTitleInstance[]
  activeInstanceId
}
```

**Text + style updates**
- Changes apply **only to active instance**.
- Save writes instances array to timeline.
- Generate uses **all instances** when rendering.

---

## Phase 2 — Rendering Changes
**Files**
- `src/routes/create-video.ts` (render endpoint)
- `src/services/screenTitles/*` (Pango render)

**Render request**
```
POST /api/create-video/screen-titles/render
{
  presetId,
  frameW, frameH,
  instances: [
    { text, presetOverride }
  ]
}
```

**Server**
- For each instance:
  - Merge base preset + override.
  - Render with Pango into intermediate (or composite directly if supported).
- Composite all instances into a single PNG.
- Return one `renderUploadId`.

---

## Phase 3 — Micro‑Nudge Controls (Optional)
Add to Customize modal:
- `Nudge X` and `Nudge Y` controls (±1px, ±5px).
- This adjusts per‑instance margin/padding or explicit offset fields.
- If using margins only, apply to `marginXPx`, `marginYPx`.

---

## Confirmed Decisions
1. **Per‑instance font family/size overrides**: Yes.
2. **Per‑instance gradient/color overrides**: Yes.
3. **Per‑instance alignment**: Yes (via position grid; sets both position + alignment).

---

## Risks / Complexity
- Rendering performance: composite multiple instances.
- UI complexity: must be crystal clear which instance is active.
- Migration: must handle legacy single‑text objects.

---

## Exit Criteria
- Can add up to 5 instances.
- Each instance renders correctly.
- Export renders composite text.
- Legacy objects load into instance #1.
