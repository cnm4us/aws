# Step 04 — SPA viewers (Home/Page/Rule)

Date: 2025-12-23

This step adds SPA components + route branches. Full end-to-end navigation will be validated after Step 5 (server serves SPA shell for `/`, `/pages/*`, `/rules/*`).

## Build check

Command:
```bash
npm run web:build:scoped
```

Result:
- Succeeded (vite build completed; new chunks emitted for `HomePage`, `PageView`, `RuleView`).
