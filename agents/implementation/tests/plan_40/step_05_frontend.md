## Plan 40 — Step 5: Frontend Lower Thirds presets editor

### What changed
- Added SPA route `/lower-thirds` with:
  - Presets list (create/edit/archive).
  - Template selector (from `/api/lower-third-templates`).
  - Schema-driven inputs (text + color).
  - Live preview driven by backend `/api/lower-third-templates/resolve` (debounced).

### Files
- `frontend/src/app/LowerThirds.tsx`
- `frontend/src/main.tsx`
- `frontend/src/ui/routes.ts`

### Build

```bash
npm run web:build:scoped
```

### Manual test checklist
1) Visit `/lower-thirds` while logged in.
2) Click `New preset`, enter a Name, edit text/colors; confirm Preview updates within ~250ms.
3) Click `Save`; confirm it appears in “Your presets”.
4) Select an existing preset; confirm inputs + preview match the saved values.
5) Refresh the page; confirm presets list reloads and selecting a preset shows correct values.

