# Step 06 — Static menu entries (Info context)

Date: 2025-12-23

BASE_URL: `http://localhost:3300` (local dev)

## Build check

Command:
```bash
npm run web:build:scoped
```

Expected:
- Build succeeds.

Result:
- Succeeded (`vite build` completed).

## Artifact sanity (optional)

Command:
```bash
rg -n "/pages/docs|/rules/community-guidelines|Info \\(Pages & Rules\\)" public/app/assets/index-*.js
```

Expected:
- At least one match, indicating the menu strings/URLs are present in the bundle.

Result (example):
- Match found in `public/app/assets/index-r-HMsV3X.js` for `/pages/docs` and `/rules/community-guidelines`.
