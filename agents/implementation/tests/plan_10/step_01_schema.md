# Step 01 — Schema: `rule_drafts`

Date: 2025-12-24

BASE_URL: `http://localhost:3300`

## Apply schema (ensureSchema)

Command:
```bash
npm run build
node - <<'NODE'
const { getPool, ensureSchema } = require('./dist/db');
(async () => {
  const db = getPool();
  await ensureSchema(db);
  try { await db.end(); } catch {}
  console.log('schema_ok');
})().catch((e) => {
  console.error('schema_failed', e);
  process.exit(1);
});
NODE
```

Actual:
```text
schema_ok
```

## Admin rules list still loads

Command:
```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super login
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /admin/rules | head -n 3
```

Actual:
```text
HTTP 200
<!doctype html>
<html lang="en">
```

