# Step 06b — Rules index (TOC)

Date: 2025-12-23

BASE_URL: `http://localhost:3300` (local dev)

## Verify API lists rules

Command:
```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh get /api/rules
```

Expected:
- `HTTP 200`
- JSON includes `items[]` and includes `community-guidelines` if it exists.

Actual:
```text
HTTP 200
{"items":[{"slug":"community-guidelines","title":"Community Guidelines","visibility":"public","url":"/rules/community-guidelines","currentVersion":{"version":2,"url":"/rules/community-guidelines/v:2","createdAt":"2025-12-22T22:18:48.000Z","changeSummary":"Added fist detail"}},{"slug":"rules/no-ad-hominem-attacks","title":"No Ad Hominem Attacks","visibility":"public","url":"/rules/rules/no-ad-hominem-attacks","currentVersion":{"version":1,"url":"/rules/rules/no-ad-hominem-attacks/v:1","createdAt":"2025-12-23T19:52:21.000Z"}}]}
```

## Verify `/rules` serves SPA shell

Command:
```bash
curl -sS http://localhost:3300/rules | rg -n 'id="root"'
```

Expected:
- Match (SPA shell).

Actual:
```text
24:    <div id="root"></div>
```

## Verify multi-segment rule slugs serve SPA shell

Command:
```bash
curl -sS http://localhost:3300/rules/rules/no-ad-hominem-attacks | rg -n 'id="root"'
```

Expected:
- Match (SPA shell).

Actual:
```text
24:    <div id="root"></div>
```

## Verify rule version permalinks still server-render (and allow trailing slash)

Command:
```bash
curl -i -sS http://localhost:3300/rules/community-guidelines/v:2/ | head -n 20
```

Expected:
- `HTTP/1.1 200`
- `Content-Type: text/html`

Actual:
```text
HTTP/1.1 200 OK
X-Powered-By: Express
Vary: Origin
Access-Control-Allow-Credentials: true
Content-Type: text/html; charset=utf-8
Cache-Control: no-store
Content-Length: 1714
ETag: W/"6b2-BUU9nOCfgxEpoyWgIyaPW4zLcls"
Date: Tue, 23 Dec 2025 20:07:05 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```
