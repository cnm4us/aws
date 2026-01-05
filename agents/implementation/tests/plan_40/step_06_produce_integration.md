## Plan 40 — Step 6: `/produce` integration

### What changed
- Added Lower Third selection to `/produce`:
  - URL param: `lowerThirdConfigId`
  - Picker: `/produce?...&pick=lowerThird`
  - Manage link: `/lower-thirds`
  - Preview uses backend `/api/lower-third-templates/resolve` with `{ presetId }`.
- Production creation now accepts `lowerThirdConfigId` and stores a snapshot in `productions.config`:
  - `lowerThirdConfigId`
  - `lowerThirdConfigSnapshot` `{ id, name, templateKey, templateVersion, params }`

### Files
- `frontend/src/app/Produce.tsx`
- `src/routes/productions.ts`
- `src/features/productions/service.ts`

### Build

```bash
npm run build
npm run web:build:scoped
```

### Manual test checklist
1) Go to `/lower-thirds` and create at least one preset.
2) Go to `/produce?upload=<id>` and use the new “Lower Third” card:
   - Choose → pick a preset → returns to `/produce` and shows the preset name + preview.
   - Clear → removes selection and `lowerThirdConfigId` from the URL.
3) Click `Produce`, then open that production detail page and confirm `Production Settings` includes:
   - `lowerThirdConfigId`
   - `lowerThirdConfigSnapshot` with template + params.

