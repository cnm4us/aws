# Plan 99 — Unified Card List Theming (Timelines + Assets/Graphic First Pass)

## 1. Goal
Create a configurable, reusable card-list styling system so card UIs can share one visual language while still allowing per-list and per-card-type variation (especially background image + dim overlay).

Primary outcomes:
1. One shared card style contract (layout + typography + button tokens).
2. Per-page theme overrides (`timelines`, `assets/graphic` first).
3. Per-card-type background/dim variation support.

## 2. Scope

### In scope (Phase A)
1. `timelines` card list
2. `assets/graphic` card list
3. Shared card CSS variables/classes
4. Theme token structure (base + per-page + optional per-card-type overrides)

### Out of scope (Phase A)
1. Migrating all other `assets/*` pages
2. Reworking page layouts unrelated to card UI
3. Replacing all inline styles globally in one pass

## 3. Proposed Architecture

### 3.1 Shared style contract
Create shared CSS file with variables + classes:
1. File: `frontend/src/app/styles/card-list.css`
2. Base variables (examples):
   - `--card-bg-image`
   - `--card-overlay-start`, `--card-overlay-end`
   - `--card-border`, `--card-radius`
   - `--card-title-color`, `--card-meta-color`
   - `--card-padding`, `--card-gap`
   - `--btn-open-border/bg`, `--btn-edit-border/bg`, `--btn-delete-border/bg`
3. Shared classes:
   - `.card-list`, `.card-item`, `.card-title`, `.card-meta`, `.card-actions`
   - `.card-btn-open`, `.card-btn-edit`, `.card-btn-delete`

### 3.2 Theme token registry
Create typed theme map:
1. File: `frontend/src/app/styles/cardThemes.ts`
2. Expose:
   - base theme tokens
   - page themes (`timelines`, `assetsGraphic`)
   - optional card-type overrides (`timeline`, `graphic`, etc.)
3. React helper to apply theme tokens as inline CSS custom properties on container.

### 3.3 Per-card-type variation
Support card-specific variation without layout forks:
1. Add `data-card-type` on card root.
2. Allow background/dim override by type via CSS vars.

## 4. Phase A — First Pass (Timelines + Assets/Graphic)

## 4.1 Implement shared foundation
1. Add `card-list.css` with base variables/classes.
2. Add `cardThemes.ts` token objects + small helper util for CSS var mapping.

## 4.2 Migrate `/timelines`
1. Update card markup to shared classes.
2. Apply `timelines` theme at list/container level.
3. Map `Open/Edit/Delete` to shared button classes/tokens.
4. Keep existing behavior unchanged (only visual refactor).

## 4.3 Migrate `/assets/graphic`
1. Update graphic cards to shared classes.
2. Apply `assetsGraphic` theme.
3. Preserve existing interaction behavior (pick/manage/favorite/edit/delete).

## 4.4 Add per-card-type hook points
1. Add `data-card-type` attributes to Phase A cards.
2. Demonstrate at least one type-specific bg/dim override in each page.

## 4.5 Phase A acceptance
1. Card structures on both pages use shared classes.
2. Background + dim can be changed from theme tokens without touching component markup.
3. Buttons are consistently styled and configurable.
4. No behavior regressions in edit/delete/open/pick flows.

## 5. Phase B — Post-Phase-A Iteration + Rollout
Phase B starts only after review of Phase A visuals/usability.

## 5.1 Iteration loop
1. Capture feedback on:
   - readability
   - dim strength
   - button prominence
   - spacing/density
2. Refine only token values first (no structural churn unless needed).

## 5.2 Expand to additional lists
Suggested order:
1. `assets/video`
2. `assets/logo`
3. `assets/audio` / `assets/narration`
4. Other list-card surfaces

## 5.3 Optional enhancements
1. Theme presets (e.g., “high contrast”, “soft”, “editorial”).
2. Runtime toggle/dev debug panel for rapid style experimentation.
3. Central card motion tokens (hover/press transitions) where appropriate.

## 6. QA Matrix
1. `/timelines`:
   - list rendering, open, edit modal, delete
2. `/assets/graphic` manage mode:
   - card rendering, preview, edit metadata, delete/favorite
3. `/assets/graphic` pick mode:
   - select item and return flow
4. Responsive checks:
   - iPhone width
   - desktop width
5. Visual checks:
   - text contrast over varied backgrounds
   - button clarity and consistency

## 7. Risks and Mitigations
1. Risk: CSS variable sprawl.
   - Mitigation: keep token names narrow, grouped by card/container/button.
2. Risk: Partial migration creates inconsistency.
   - Mitigation: apply shared classes completely on each migrated page.
3. Risk: readability loss when dim is reduced.
   - Mitigation: enforce min contrast by default token values.

## 8. Definition of Done (Phase A)
1. Shared card theming system exists and is documented in code.
2. `timelines` and `assets/graphic` are migrated to shared contract.
3. Theme and dim can be adjusted centrally.
4. Behavior and build remain stable.
