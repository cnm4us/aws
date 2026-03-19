# Step 05 — Routing: SPA shell ownership

Date: 2025-12-23

BASE_URL: `http://localhost:3300` (local dev)

## SPA shell routes (latest views)

Commands:
```bash
curl -sS http://localhost:3300/ | rg -n 'id="root"'
curl -sS http://localhost:3300/pages/docs | rg -n 'id="root"'
curl -sS http://localhost:3300/rules/community-guidelines | rg -n 'id="root"'
```

Result:
```text
24:    <div id="root"></div>
24:    <div id="root"></div>
24:    <div id="root"></div>
```

Non-canonical home URL:
- `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3300/pages/home` → `302 http://localhost:3300/`

## Historical rule permalink (server-rendered)

Commands:
```bash
curl -sS http://localhost:3300/rules/community-guidelines/v:1 | rg -n 'id="root"' || echo "no-root (expected)"
```

Result:
```text
no-root (expected)
```
