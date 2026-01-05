# Plan 40 – Step 1: DB tables (lower thirds)

Date: 2026-01-05

## Typecheck

```bash
npm run build
```

Result: success.

## Apply ensureSchema + verify tables

```bash
node -e "const {getPool,ensureSchema}=require('./dist/db'); (async()=>{const db=getPool(); await ensureSchema(db); const [rows]=await db.query('SHOW TABLES LIKE \\\'lower_third_%\\\''); console.log(rows); process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});"
```

Output:

```text
[
  { 'Tables_in_aws (lower_third_%)': 'lower_third_configurations' },
  { 'Tables_in_aws (lower_third_%)': 'lower_third_templates' }
]
```
