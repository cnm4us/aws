# Step 03 — Edit Draft links in admin

Date: 2025-12-24

BASE_URL: `http://localhost:3300`

## `/admin/rules` includes “Edit Draft” links

Command:
```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /admin/rules | rg -n "/admin/rules/[0-9]+/edit" | head
```

Actual:
```text
54:<h1>Rules</h1><div class="toolbar"><div><span class="pill">Rules</span></div><div><a href="/admin/rules/new">New rule</a></div></div><table><thead><tr><th>Slug</th><th>Category</th><th>Title</th><th>Visibility</th><th>Current Version</th><th>Updated</th><th></th></tr></thead><tbody><tr><td><a href="/admin/rules/7">personal-attacks</a></td><td>Civility &amp; Tone</td><td>Personal Attacks</td><td>public</td><td>1</td><td>2025-12-24 07:13:16</td><td style="text-align: right; white-space: nowrap"><a href="/admin/rules/7/edit" style="margin-right: 10px">Edit Draft</a><form method="post" action="/admin/rules/7/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule 'personal-attacks'? This cannot be undone.');"><input type="hidden" name="csrf" value="acbbedab801cf9881e6229796836a231" /><button type="submit" class="danger">Delete</button></form></td></tr></tbody></table>
```

## `/admin/rules/:id` includes “Edit Draft”

Command:
```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /admin/rules/7 | rg -n "Edit Draft" | head
```

Actual:
```text
54:<h1>Rule: personal-attacks</h1><div class="toolbar"><div><a href="/admin/rules">← Back to rules</a></div><div><a href="/admin/rules/7/edit">Edit Draft</a> &nbsp; <a href="/admin/rules/7/versions/new">New version</a></div></div><p><span class="pill">Visibility: public</span></p><table><thead><tr><th>Version</th><th>Created</th><th>Summary</th><th>View</th></tr></thead><tbody><tr><td>1 (current)</td><td>2025-12-24 07:13:16</td><td>Initial Entry</td><td><a href="/rules/personal-attacks/v:1">View</a></td></tr></tbody></table>
```

