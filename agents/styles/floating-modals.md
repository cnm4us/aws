# Floating Modal Style Guide

These floating panels should match the look and feel of the floating mini control panel (smokey, semi-transparent, no drop shadow). Use these tokens across:

- Floating mini control panel
- Floating action control panel
- Timeline object context menu
- Timeline zoom selection menu

## Core Container
- Border radius: `14px`
- Border: `1px solid rgba(255,255,255,0.18)`
- Background: `rgba(0,0,0,0.55)`
- Backdrop blur: `blur(6px)` (WebKit + standard)
- Shadow: **none** (avoid additional drop shadow).

## Header / Drag Handle
- Provide a top drag region with `cursor: grab` and `touch-action: none`.
- Prefer the minimal drag bar used in the floating mini control panel:
  - Height: `18px`
  - Center bar: `width: 44px`, `height: 4px`, `border-radius: 999px`, `background: rgba(255,255,255,0.22)`
- If a header row exists, keep text white and bold; avoid blue gradients or heavy borders.

## Buttons
- Default button border: `1px solid rgba(255,255,255,0.18)`
- Default button background: `#0c0c0c` or `rgba(255,255,255,0.08)` depending on the control group.
- Button text: `#fff`, `font-weight: 900`
- Rounded corners: `10px`

## Menu Items
- Use consistent padding and 10px radius.
- Active state can use a blue border + subtle blue tint, but keep the overall container smokey/transparent.

## Z‑Index / Layering
- Keep above headers and timeline elements (z-index higher than timeline overlays).
- Do not allow the panel to fall behind the global header or the preview frame.
