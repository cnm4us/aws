### 2025-12-29T00:38:00+00:00

BASE_URL: http://localhost:3300

```bash
npm run -s web:build
```

Output (tail):
```
✓ 75 modules transformed.
../public/app/assets/index-C6xBFoIf.js           226.13 kB │ gzip:  70.78 kB
../public/app/assets/Feed-BX-Muwmi.js            579.50 kB │ gzip: 178.22 kB
✓ built in 5.72s
```

```bash
rg -n --fixed-strings \"SpaceMembers\" public/app/assets -S || true
rg -n --fixed-strings \"SpaceReview\" public/app/assets -S || true
rg -n --fixed-strings \"/api/space/review\" public/app/assets -S || true
rg -n --fixed-strings \"/space/review/groups\" public/app/assets -S || true
```

Result: no matches (space console code no longer ships in `public/app/assets/*`).
