# Admin `/admin/rules` — sortable headers + category jump filter

Date: 2025-12-25

BASE_URL: `http://localhost:3300`

## Category filter (jump menu, no submit)

Command:
```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super login >/dev/null

TMP1=$(mktemp)
BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super get "/admin/rules" > "$TMP1"
CID=$(TMP1="$TMP1" node - <<'NODE'
const fs=require('fs');
const s=fs.readFileSync(process.env.TMP1,'utf8').replace(/^HTTP \\d+\\r?\\n/,'');
const m=s.match(/<option value=\"(\\d+)\">/);
process.stdout.write(m?m[1]:'');
NODE
)

TMP2=$(mktemp)
BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super get "/admin/rules?categoryId=$CID" > "$TMP2"
rg -n -m 1 "<option value=\\\"$CID\\\" selected" "$TMP2"
```

Actual:
```text
54:<h1>Rules</h1><div class="toolbar"><div><span class="pill">Rules</span></div><div><a href="/admin/rules/new">New rule</a></div></div><div class="toolbar" style="margin-top: 10px"><div><label style="display:flex; gap:10px; align-items:center; margin:0"><span style="opacity:0.85">Category</span><select name="categoryId" onchange="(function(sel){const qs=new URLSearchParams(window.location.search); if(sel.value){qs.set('categoryId', sel.value)} else {qs.delete('categoryId')} window.location.search=qs.toString()})(this)"><option value="">All</option><option value="1" selected>Civility &amp; Tone</option><option value="2">Privacy &amp; Identity Abuse</option><option value="3">Safety &amp; Severe Harm</option></select></label></div></div><table><thead><tr>
```

## Sortable headers (example: Title)

Command:
```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get "/admin/rules?sort=title&dir=asc" > /tmp/admin_rules_sort_title.html
rg -n -m 1 "sort=title" /tmp/admin_rules_sort_title.html
```

Actual:
```text
57:      <th><a href="/admin/rules?sort=title&amp;dir=desc">Title ▲</a></th>
```

