# Plan 85: Screen Titles “Customize Style” Overrides

## Goal
Enable per–screen-title object customization (override) while keeping global style editing in `/assets/screen-titles`. Replace “Edit Style” on the timeline with “Customize Style” that edits a reduced, object‑scoped subset of fields.

## Scope
- **Manage styles (global)** stays in `/assets/screen-titles`.
- **Customize style (per object)** is launched from the screen‑title object on the timeline.
- Customizations persist **per object** and are inherited by splits.
- Default styles (non‑editable) are a future phase (not in this plan).

## Decisions
- **Field name:** use `customStyle` on the screen title object.
- **Reset button:** “Reset to Base Style” clears `customStyle` for that object.
- **Customize modal includes:**
  - Manage Styles link
  - Select Base Style (drop‑down)
  - Text field
- **If user selects a new base style:** reset all customizations for that object to the new base defaults.
- **If base style is edited in Assets:** objects reference the **latest** base style; overrides still apply on top.

## Non‑editable in Customize
- Name
- Description
- Text Gradient
- Shadow Color/Offset/Blur/Opacity
- Outline Color/Width/Opacity
- Background
- Fade

## Editable in Customize
- Position
- Alignment
- Horizontal Margin
- Vertical Margin
- Font Family
- Variant
- Text Size
- Font Color

## Data Model
1. **Timeline schema extension** for `screenTitles[]`:
   - Add optional `customStyle` object:
     ```ts
     type ScreenTitleCustomStyle = {
       position?: string
       alignment?: 'left' | 'center' | 'right'
       marginXPx?: number
       marginYPx?: number
       fontKey?: string
       fontVariant?: string
       fontSizePct?: number
       fontColor?: string
     }
     ```
   - Stored under `screenTitles[i].customStyle`, leaving `presetSnapshot` intact.
2. **Back‑compat:** If no `customStyle` → use `presetSnapshot` only.

## UI/UX Changes
### A) Timeline → Screen Title → Context Menu
- Replace **“Edit Style”** with **“Customize Style”**.
- Keep **“Manage Styles”** linking to `/assets/screen-titles` (same as now).

### B) Customize Style Modal
- Reuse modal styling (`agents/styles/modal-properties.md`).
- Sections:
  1) **Base style selector** (drop‑down) + Manage Styles link.
  2) **Text** editor (moved from Properties).
  3) **Editable group**:
     - Position (3×3 grid)
     - Alignment
     - Horizontal Margin (px)
     - Vertical Margin (px)
     - Font Family
     - Variant
     - Text Size
     - Font Color
  4) **Read‑only group** for locked fields (gradient, shadow, outline, background, fade)
  5) **Reset to Base Style** action (clears `customStyle`).
- Buttons: **Save**, **Cancel**.
- Validation: no blocking except required values (if dropdowns are empty).

### C) Split Behavior
- When splitting a screen title object, **copy `customStyle`** to the new object.

## Rendering & Preview
1. **Preview render**
   - For each screen title, derive `effectiveStyle = base style (latest) + customStyle`.
   - Use effective style for preview (text render in timeline/preview).
2. **Export render (Pango)**
   - Pass effective style when generating screen title PNGs.

## Server/API Changes
- No new endpoints required if existing update is via timeline save.
- Ensure timeline serializer persists `screenTitles[].customStyle`.

## Implementation Steps
1. **Types & schema**
   - Update timeline types for `screenTitles` to include `customStyle`.
   - Update validation schema to allow it.
2. **UI: context menu**
   - Replace “Edit Style” → “Customize Style”.
   - Launch modal with object + base style + customStyle.
3. **UI: customize modal**
   - Add base style selector, text editor, editable + read‑only sections.
   - Save writes `customStyle` + base style selection to the object.
   - Reset clears `customStyle`.
4. **Split logic**
   - Ensure `customStyle` copied to split clone.
5. **Preview render**
   - Use `effectiveStyle` for preview text.
6. **Export render**
   - Use `effectiveStyle` when creating PNGs.
7. **Back‑compat**
   - If `customStyle` is missing or partial, fallback to base style values.
8. **QA**
   - Create a screen title, customize, split, confirm both parts keep overrides.
   - Change base style in Assets, confirm objects reflect new base + overrides.
   - Refresh and confirm overrides persist.
   - Export and confirm override is reflected in render.
