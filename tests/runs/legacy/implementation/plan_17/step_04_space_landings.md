### 2025-12-29T00:26:50+00:00

BASE_URL: http://localhost:3300

```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile space_admin login >/dev/null
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile space_admin get /space/admin | head -n 20
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile space_admin get /space/moderation | head -n 20
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile space_admin get /space/review/groups | head -n 20
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile space_admin get /spaces/16/admin | head -n 20
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
    <script type="module" crossorigin src="/space-app/assets/index-DiFK-DmC.js"></script>
    <link rel="stylesheet" crossorigin href="/space-app/assets/index-yqf2Afwu.css">
  </head>
  <body>
    <div id="root"></div>
  </body>

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
    <script type="module" crossorigin src="/space-app/assets/index-DiFK-DmC.js"></script>
    <link rel="stylesheet" crossorigin href="/space-app/assets/index-yqf2Afwu.css">
  </head>
  <body>
    <div id="root"></div>
  </body>

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
    <script type="module" crossorigin src="/space-app/assets/index-DiFK-DmC.js"></script>
    <link rel="stylesheet" crossorigin href="/space-app/assets/index-yqf2Afwu.css">
  </head>
  <body>
    <div id="root"></div>
  </body>

HTTP 302
Found. Redirecting to /forbidden?from=%2Fspaces%2F16%2Fadmin
```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile space_admin get /api/me
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile space_admin get /spaces/21/admin | head -n 20
```

HTTP 200
{"userId":6,"email":"tester_02@cnm4us.com","displayName":"Tester 02","roles":["site_member"],"isSiteAdmin":false,"spaceRoles":{"19":["space_admin","space_member","space_poster"],"21":["space_admin","space_member","space_poster"]},"personalSpace":{"id":20,"slug":"tester-02"}}
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
    <script type="module" crossorigin src="/space-app/assets/index-DiFK-DmC.js"></script>
    <link rel="stylesheet" crossorigin href="/space-app/assets/index-yqf2Afwu.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
