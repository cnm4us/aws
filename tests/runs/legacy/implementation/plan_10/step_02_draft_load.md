# Step 02 — Draft load helper + `/admin/rules/:id/edit`

Date: 2025-12-24

BASE_URL: `http://localhost:3300`

## Pick a rule id

Command:
```bash
node - <<'NODE'
const { getPool } = require('./dist/db');
(async () => {
  const db = getPool();
  const [rows] = await db.query('SELECT id FROM rules ORDER BY id LIMIT 1');
  const id = rows?.[0]?.id ? Number(rows[0].id) : null;
  console.log(id && Number.isFinite(id) ? id : '');
  await db.end();
})().catch(()=>process.exit(1));
NODE
```

Actual:
```text
7
```

## Load draft edit page (creates draft if missing)

Command:
```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get "/admin/rules/7/edit" | rg -n "Edit Draft:|name=\\\"action\\\" value=\\\"save\\\"|name=\\\"action\\\" value=\\\"publish\\\""
```

Actual:
```text
54:<h1>Edit Draft: personal-attacks</h1><div class="toolbar"><div><a href="/admin/rules">← Back to rules</a></div></div><form method="post" action="/admin/rules/7/edit"><input type="hidden" name="csrf" value="acbbedab801cf9881e6229796836a231" /><label>Title
286:</textarea><div class="field-hint">Guidance is intended for moderators and automated agents; do not expose it to regular users.</div><div class="actions"><button type="submit" name="action" value="save">Save</button><button type="submit" name="action" value="publish">Publish Version</button></div></form><div class="field-hint" style="margin-top: 10px">Note: Save/Publish actions will be implemented in later steps of plan_10.</div>
```

## Verify a `rule_drafts` row exists

Command:
```bash
RULE_ID="7" node - <<'NODE'
const { getPool } = require('./dist/db');
(async () => {
  const db = getPool();
  const ruleId = Number(process.env.RULE_ID);
  const [rows] = await db.query('SELECT COUNT(*) AS c FROM rule_drafts WHERE rule_id = ?', [ruleId]);
  console.log('draft_count=' + rows[0].c);
  await db.end();
})().catch((e)=>{console.error(e);process.exit(1)});
NODE
```

Actual:
```text
draft_count=1
```

