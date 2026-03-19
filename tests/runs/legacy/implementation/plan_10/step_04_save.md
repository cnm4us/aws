# Step 04 — Save draft (no new version)

Date: 2025-12-24

BASE_URL: `http://localhost:3300`

## Create a fresh rule (published v1)

Command:
```bash
SLUG="tmp-draft-save-$(date +%s)"
echo "$SLUG" > /tmp/plan10_slug.txt

BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super post /admin/rules \
  --data "slug=${SLUG}&title=Draft%20Save%20Test&categoryId=&visibility=public&shortDescription=Short%20v1&markdown=%23%20Long%20v1%0A%0AInitial%20long%20content.&allowedExamples=-%20Allowed%20v1&disallowedExamples=-%20Disallowed%20v1&guidance=Guidance%20v1&changeSummary=initial" \
  | head -n 3
```

Actual:
```text
HTTP 302
Found. Redirecting to /admin/rules
```

## Capture published “latest” before saving a draft

Command:
```bash
SLUG=$(cat /tmp/plan10_slug.txt)
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh get "/api/rules/${SLUG}" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
  s=s.replace(/^HTTP \\d+\\n/,"");
  const j=JSON.parse(s);
  console.log("before_title="+j.title);
  console.log("before_html_prefix="+(j.html||"").slice(0,60).replace(/\\n/g,"\\\\n"));
});'
```

Actual:
```text
before_title=Draft Save Test
before_html_prefix=<h1 id="long-v1">Long v1</h1>\n<p>Initial long content.</p>
```

## Save draft changes (title updates immediately; published content does not)

Command:
```bash
SLUG=$(cat /tmp/plan10_slug.txt)
RULE_ID=$(SLUG=$SLUG node - <<'NODE'
const { getPool } = require('./dist/db');
(async () => {
  const db = getPool();
  const [rows] = await db.query('SELECT id FROM rules WHERE slug = ? LIMIT 1', [process.env.SLUG]);
  console.log(rows?.[0]?.id ? Number(rows[0].id) : '');
  await db.end();
})().catch(()=>process.exit(1));
NODE
)
echo "$RULE_ID" > /tmp/plan10_rule_id.txt

BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super post "/admin/rules/${RULE_ID}/edit" \
  --data "action=save&title=Draft%20Save%20Test%20(UPDATED)&categoryId=&shortDescription=Short%20DRAFT&markdown=%23%20Long%20DRAFT%0A%0ADraft%20long%20content%20(not%20published).&allowedExamples=-%20Allowed%20DRAFT&disallowedExamples=-%20Disallowed%20DRAFT&guidance=Guidance%20DRAFT" \
  | head -n 3
```

Actual:
```text
HTTP 302
Found. Redirecting to /admin/rules/8/edit?notice=Draft%20saved.
```

## Verify latest API: title changed, but `html` remains from v1

Command:
```bash
SLUG=$(cat /tmp/plan10_slug.txt)
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh get "/api/rules/${SLUG}" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
  s=s.replace(/^HTTP \\d+\\n/,"");
  const j=JSON.parse(s);
  console.log("api_title="+j.title);
  console.log("api_current_version="+j.currentVersion?.version);
  console.log("api_html_prefix="+(j.html||"").slice(0,60).replace(/\\n/g,"\\\\n"));
});'
```

Actual:
```text
api_title=Draft Save Test (UPDATED)
api_current_version=1
api_html_prefix=<h1 id="long-v1">Long v1</h1>\n<p>Initial long content.</p>
```

## Verify DB: draft updated, published version unchanged

Command:
```bash
RULE_ID=$(cat /tmp/plan10_rule_id.txt)
RULE_ID="$RULE_ID" node - <<'NODE'
const { getPool } = require('./dist/db');
(async () => {
  const db = getPool();
  const ruleId = Number(process.env.RULE_ID);
  const [rows] = await db.query('SELECT markdown, short_description FROM rule_drafts WHERE rule_id = ? LIMIT 1', [ruleId]);
  const d = rows?.[0];
  console.log('draft_short=' + (d?.short_description ?? ''));
  console.log('draft_md_prefix=' + String(d?.markdown ?? '').slice(0,80).replace(/\\n/g,'\\\\n'));
  await db.end();
})().catch((e)=>{console.error(e);process.exit(1)});
NODE

SLUG=$(cat /tmp/plan10_slug.txt)
SLUG="$SLUG" node - <<'NODE'
const { getPool } = require('./dist/db');
(async () => {
  const db = getPool();
  const slug = String(process.env.SLUG);
  const [rows] = await db.query(
    "SELECT r.slug, rv.version, rv.markdown FROM rules r JOIN rule_versions rv ON rv.id = r.current_version_id WHERE r.slug = ? LIMIT 1",
    [slug]
  );
  const v = rows?.[0];
  console.log('published_version=' + (v?.version ?? ''));
  console.log('published_md_prefix=' + String(v?.markdown ?? '').slice(0,80).replace(/\\n/g,'\\\\n'));
  await db.end();
})().catch((e)=>{console.error(e);process.exit(1)});
NODE
```

Actual:
```text
draft_short=Short DRAFT
draft_md_prefix=# Long DRAFT\n\nDraft long content (not published).
published_version=1
published_md_prefix=# Long v1\n\nInitial long content.
```

