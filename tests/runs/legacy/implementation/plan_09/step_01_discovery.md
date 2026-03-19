# Step 01 — SPA discovery notes

Date: 2025-12-23

This step is primarily code inspection (no runnable tests beyond the smoke checks in `step_00_smoke.md`).

## Key integration points

- Route switching: `frontend/src/main.tsx` uses `window.location.pathname` + an `if/else` ladder.
- Layout shell: `frontend/src/ui/Layout.tsx` wraps non-Feed pages with `SharedNav`.
- Shared nav/drawer: `frontend/src/ui/SharedNav.tsx` renders a context-based menu drawer.
- Menu contexts:
  - Context selector: `frontend/src/menu/ContextPicker.tsx`
  - Per-context item lists:
    - `frontend/src/menu/contexts/HelpMenu.tsx`
    - `frontend/src/menu/contexts/ProfileMenu.tsx`
    - `frontend/src/menu/contexts/MyAssets.tsx`
    - `frontend/src/menu/contexts/AdminMenu.tsx`

## Notes for later steps

- `/` currently renders the Feed directly; moving `/` to CMS “home” will require an explicit route change in `frontend/src/main.tsx`.
- Only `HelpMenu` currently uses SPA-style navigation (`pushState` + `popstate`). For pages/rules menu entries we can either:
  - allow full navigation (OK if server serves SPA shell for those routes), or
  - implement SPA-style navigation similarly for a smoother UX.

