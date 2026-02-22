# Nebula Style Guide

This guide standardizes the **Nebula** background treatment and glassmorphism card styling used across pages like `/assets`, `/assets/*`, `/library`, and `/timelines`.

## Goals

- Provide a consistent “nebula” visual identity across list pages.
- Ensure **iOS Safari** renders glass cards correctly on first paint.
- Keep cards readable on top of a high-contrast background image.

## Background Layer (Nebula)

Use a **fixed background layer** (not `background-attachment: fixed`) to avoid iOS Safari paint glitches.

**Pattern:**

- Outer container:
  - `minHeight: '100vh'`
  - `color: '#fff'`
  - `fontFamily: 'system-ui, sans-serif'`
  - `position: 'relative'`
  - `background: '#050508'` (fallback)
- Background layer (fixed):
  - `position: 'fixed'`
  - `inset: 0`
  - `backgroundImage: url(nebula_bg.jpg)`
  - `backgroundPosition: 'center'`
  - `backgroundRepeat: 'no-repeat'`
  - `backgroundSize: 'cover'`
  - `zIndex: 0`
  - `pointerEvents: 'none'`
- Content wrapper:
  - `position: 'relative'`
  - `zIndex: 1`

This ensures the background stays fixed while cards scroll over it and prevents the “black until touch” issue on iOS.

## Card Style (Glass)

Use the shared card system (`card-list.css` + `cardThemes.ts`) with the **assetsGlass** tokens.

Recommended token set:

- `cardThemeTokens.assetsGlass`
- Override `--card-bg-image: 'none'` (avoid per-card image on nebula pages)

Key visual parameters:

- Background: `rgba(6,8,12,0.5)` (glass)
- Border: gradient + subtle highlight
- Blur: `blur(10px)`
- Shadow: soft dark drop + subtle inner highlight

## Buttons (Glass)

Use shared button classes from `card-list.css`:

- Primary: `card-btn card-btn-open` (blue glass)
- Secondary: `card-btn card-btn-edit` (neutral glass)
- Destructive: `card-btn card-btn-delete` (red glass)

Use this for:
- “New” / “Upload” actions
- “View” / “Edit” / “Select”

## Title Color

Standard title color on nebula pages:
- `#ffd60a` (bright gold)

## Usage Notes

- For iOS Safari, **do not** rely on `background-attachment: fixed`.
- Always keep the fixed nebula background layer below content (`zIndex: 0`).
- Ensure card text has sufficient contrast; avoid light gray titles on nebula.

