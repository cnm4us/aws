### 2025-12-29T00:21:53+00:00

BASE_URL: http://localhost:3300

```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super login >/dev/null
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /spaces/16/admin | head -n 40
curl -sS -D - -o /dev/null http://localhost:3300/spaces/16/admin | head -n 10
```


HTTP 200
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="theme-color" content="#000000" />
    <title>Space Console</title>
    <style>
      html, body, #root { height: 100%; background: #000; }
      body { margin: 0; }
    </style>
    <script type="module" crossorigin src="/space-app/assets/index-DjpEy0zC.js"></script>
    <link rel="stylesheet" crossorigin href="/space-app/assets/index-CoJNjw9G.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
  </html>


HTTP/1.1 302 Found
X-Powered-By: Express
Vary: Origin, Accept
Access-Control-Allow-Credentials: true
Location: /forbidden?from=%2Fspaces%2F16%2Fadmin
Content-Type: text/plain; charset=utf-8
Content-Length: 60
Date: Mon, 29 Dec 2025 00:21:53 GMT
Connection: keep-alive
Keep-Alive: timeout=5

```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /space/review/groups | head -n 25
curl -sS -D - -o /dev/null http://localhost:3300/space/review/groups | head -n 10
```

HTTP 200
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="theme-color" content="#000000" />
    <title>Space Console</title>
    <style>
      html, body, #root { height: 100%; background: #000; }
      body { margin: 0; }
    </style>
    <script type="module" crossorigin src="/space-app/assets/index-DjpEy0zC.js"></script>
    <link rel="stylesheet" crossorigin href="/space-app/assets/index-CoJNjw9G.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
  </html>


HTTP/1.1 302 Found
X-Powered-By: Express
Vary: Origin, Accept
Access-Control-Allow-Credentials: true
Location: /forbidden?from=%2Fspace%2Freview%2Fgroups
Content-Type: text/plain; charset=utf-8
Content-Length: 64
Date: Mon, 29 Dec 2025 00:22:05 GMT
Connection: keep-alive
Keep-Alive: timeout=5
