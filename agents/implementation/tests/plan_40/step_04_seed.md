## Plan 40 — Step 4: Seed first template

### What changed
- Seeded initial template `lt_modern_gradient_01` v1 during `ensureSchema()` (idempotent insert).

### Verification

1) Build

```bash
npm run build
```

2) Apply schema + confirm template exists

```bash
node - <<'NODE'
require('dotenv').config();
const { ensureSchema, getPool } = require('./dist/db');
(async () => {
  const db = getPool();
  await ensureSchema(db);
  const [rows] = await db.query("SELECT template_key, version, label, category FROM lower_third_templates WHERE template_key='lt_modern_gradient_01' AND version=1");
  console.log(rows);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
NODE
```

Observed (example):

```json
[{"template_key":"lt_modern_gradient_01","version":1,"label":"Modern Gradient","category":"clean"}]
```

3) Resolve the template via backend service (preview == render)

```bash
node - <<'NODE'
require('dotenv').config();
const { getPool, ensureSchema } = require('./dist/db');
const svc = require('./dist/features/lower-thirds/service');
(async () => {
  const db = getPool();
  await ensureSchema(db);
  const result = await svc.resolveLowerThirdSvgForUser(
    {
      templateKey: 'lt_modern_gradient_01',
      templateVersion: 1,
      params: {
        primaryText: 'Hello World',
        secondaryText: 'Lower third preview',
        baseBg: '#111827',
        accentColor: '#F59E0B',
      },
    },
    1
  );
  console.log({ templateKey: result.templateKey, templateVersion: result.templateVersion, svgStart: result.svg.slice(0, 120) });
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
NODE
```

Observed (example):

```json
{"templateKey":"lt_modern_gradient_01","templateVersion":1,"svgStart":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1920 200\" width=\"1920\" height=\"200\">\\n  <defs>\\n    <linearGradient i"}
```

