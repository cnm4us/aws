# Modal Properties Style Guide

This document standardizes the look and layout for **object modal properties** dialogs (Logo, Graphics, Video Overlay, Screen Title, Audio/Music, Narration, etc.).

## Goals

- Mobile-first: no horizontal overflow, no accidental overlap, easy touch targets.
- Consistency: same structure and styling patterns across all “Properties” modals.
- Clarity: primary actions visually distinct, destructive actions obvious.

## Structure

### Backdrop (overlay behind modal)

- `position: fixed; inset: 0; zIndex: 1100;`
- Background: `rgba(0,0,0,0.86)` (semi-opaque so the user sees context).
- Scrolling: `overflowY: auto; WebkitOverflowScrolling: 'touch'`.
- Padding: `padding: '64px 16px 80px'` (keeps away from top bar + bottom UI).

### Container (the modal “card”)

- Centered: `maxWidth: 560; margin: '0 auto'`
- `borderRadius: 14`
- `padding: 16`
- `boxSizing: 'border-box'`
- Border + accent should match the “active selection” color for the modal (see **Colors**).
- Background should be opaque-ish so fields read well:
  - Preferred: subtle gradient with **charcoal gray/blue** tone:
    - `linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)`

### Header row

- Left: `{Object} Properties` title (font `18`, weight `900`)
- Right: `Close` button (not duplicated elsewhere)
- Header should be `display: flex; justifyContent: space-between; gap: 12; alignItems: baseline;`

## Colors

### “Primary accent blue” (standard for selection + outlines)

- Border/outline: `rgba(96,165,250,0.95)`
- Highlight background: `rgba(96,165,250,0.18)`

Use this for:
- Modal container outline
- Selected state borders (e.g., 3×3 position grid)
- Primary action button outline (Save)
- Secondary outline buttons where helpful (Adjust ±0.1s)

### Inputs

- Input background: `#0b0b0b`
- Input border: `1px solid rgba(255,255,255,0.18)`
- Input text: `#fff`
- Input rounding: `borderRadius: 10`
- Padding: `10px 12px`
- Font: size `14`, weight `900`

### Buttons

- **Primary (Save)**:
  - Border: `1px solid rgba(96,165,250,0.95)`
  - Background: `rgba(96,165,250,0.14)`
  - Text: `#fff`, weight `900`
- **Secondary (Cancel/Close)**:
  - Border: `1px solid rgba(255,255,255,0.18)`
  - Background: `rgba(255,255,255,0.06)`
  - Text: `#fff`, weight `800`
- **Destructive (Delete)** (when present in a modal):
  - Background: burgundy/red (match global delete styling)
  - Text: white
  - Should not be adjacent to primary without separation.

## Layout patterns

### Info row: Start / Duration / End

- 3 columns:
  - `display: grid; gridTemplateColumns: '1fr 1fr 1fr'; gap: 10`
- Each cell:
  - `padding: 10; borderRadius: 12`
  - `border: 1px solid rgba(255,255,255,0.14)`
  - `background: rgba(255,255,255,0.03)`
- Label: `#bbb`, font `12`, weight `800`
- Value: font `20`, weight `900`

### Adjust Start / Adjust End row

- Two blocks, left/right:
  - Outer: `display: flex; justifyContent: space-between; gap: 12; flexWrap: 'wrap'`
- Each block:
  - Label: `#bbb`, size `13`, weight `900`
  - Buttons row: `display: flex; gap: 8`
- Buttons:
  - Outline should use primary accent blue.
  - Keep touch targets large enough (`padding: 8px 10px`, `borderRadius: 10`).

### Two fields side-by-side (common overflow fix)

Use this pattern whenever two inputs share a row:

- Row container:
  - `display: grid`
  - `gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)'`
  - `gap: 10`
  - `alignItems: 'start'`
- Each label wrapper:
  - `display: grid; gap: 6; minWidth: 0`
- Each input/select:
  - Must include `boxSizing: 'border-box'`

This prevents:
- Right-side overflow
- Left field sliding “under” right field
- Long option text forcing overflow

### 3×3 position grid

- Grid:
  - `display: grid; gridTemplateColumns: 'repeat(3, 1fr)'; gap: 8; maxWidth: 240`
- Buttons:
  - `height: 44; borderRadius: 12; fontSize: 18; fontWeight: 900`
  - Selected:
    - Border: `2px solid rgba(96,165,250,0.95)`
    - Background: `rgba(96,165,250,0.18)`
  - Unselected:
    - Border: `1px solid rgba(255,255,255,0.18)`
    - Background: `rgba(255,255,255,0.04)`

## Error messages

- Inline, near the bottom of the modal:
  - Color: `#ff9b9b`
  - Size: `13px`

## Footer actions

- Right aligned:
  - `display: flex; justifyContent: flex-end; gap: 10`
- Only one **primary** action per modal.
- Avoid duplicating `Close` in multiple places.

## Accessibility / UX notes

- Clicking outside modal closes it (unless the modal contains destructive actions; consider requiring explicit Close for delete-confirm flows).
- `touchAction: 'none'` should **not** be used on the modal container; allow scrolling on mobile.
- Always use `aria-modal="true"` and `role="dialog"`.
