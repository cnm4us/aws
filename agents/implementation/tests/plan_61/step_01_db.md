# Plan 61 — Step 1 — DB

Date: 2026-01-14

## ensureSchema

Command:
```bash
npm run build
node -e "const db=require('./dist/db'); db.ensureSchema(db.getPool()).then(()=>{console.log('ensureSchema ok'); process.exit(0);}).catch(e=>{console.error(e); process.exit(1);})"
```

Output:
```text
ensureSchema ok
```

## Verify table exists

Command:
```bash
node - <<'NODE'
const db = require('./dist/db');
(async () => {
  const pool = db.getPool();
  const [tables] = await pool.query("SHOW TABLES LIKE 'production_drafts'");
  console.log('SHOW TABLES LIKE production_drafts ->', tables);
  const [rows] = await pool.query('SHOW CREATE TABLE production_drafts');
  const create = rows?.[0]?.['Create Table'] || rows?.[0];
  console.log('SHOW CREATE TABLE production_drafts ->');
  console.log(create);
  await pool.end();
})();
NODE
```

Output (abridged):
```text
SHOW TABLES LIKE production_drafts -> [ { 'Tables_in_aws (production_drafts)': 'production_drafts' } ]
SHOW CREATE TABLE production_drafts ->
CREATE TABLE `production_drafts` (
  ...
  UNIQUE KEY `uniq_production_drafts_active` (`user_id`,`upload_id`,`active_key`),
  ...
)
```

