# Plan 61 — Step 2 — API

Date: 2026-01-14 02:05:22 UTC


Command:
```bash
BASE_URL='http://localhost:3310' COOKIE_JAR='/tmp/tmp.sWSwtn8Ops/cookies.txt' ./scripts/auth_curl.sh --profile super login
```

Output:
```text
Logging in to http://localhost:3310/api/login as michael@bayareacreativeservices.com...
HTTP 200
{"ok":true,"userId":1}
```

Command:
```bash
printf '%s\n' "HTTP 200
{"created":false,"draft":{"id":1,"uploadId":73,"status":"active","config":{},"renderedProductionId":null,"createdAt":"2026-01-14 02:04:23","updatedAt":"2026-01-14 02:04:23","archivedAt":null}}"
```

Output:
```text
HTTP 200
{created:false,draft:{id:1,uploadId:73,status:active,config:{},renderedProductionId:null,createdAt:2026-01-14
02:04:23,updatedAt:2026-01-14
02:04:23,archivedAt:null}}
```

Command:
```bash
BASE_URL='http://localhost:3310' COOKIE_JAR='/tmp/tmp.sWSwtn8Ops/cookies.txt' ./scripts/auth_curl.sh --profile super get '/api/production-drafts?uploadId=73'
```

Output:
```text
HTTP 200
{"draft":{"id":1,"uploadId":73,"status":"active","config":{},"renderedProductionId":null,"createdAt":"2026-01-14 02:04:23","updatedAt":"2026-01-14 02:04:23","archivedAt":null}}```

Command:
```bash
BASE_URL='http://localhost:3310' COOKIE_JAR='/tmp/tmp.sWSwtn8Ops/cookies.txt' ./scripts/auth_curl.sh --profile super patch /api/production-drafts/ -H 'Content-Type: application/json' --data '{"config":{"foo":"bar"}}'
```

Output:
```text
HTTP 404
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot PATCH /api/production-drafts/</pre>
</body>
</html>
```

Command:
```bash
BASE_URL='http://localhost:3310' COOKIE_JAR='/tmp/tmp.sWSwtn8Ops/cookies.txt' ./scripts/auth_curl.sh --profile super post /api/production-drafts//archive -H 'Content-Type: application/json' --data '{}'
```

Output:
```text
HTTP 404
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot POST /api/production-drafts//archive</pre>
</body>
</html>
```

Command:
```bash
BASE_URL='http://localhost:3310' COOKIE_JAR='/tmp/tmp.sWSwtn8Ops/cookies.txt' ./scripts/auth_curl.sh --profile super post /api/production-drafts -H 'Content-Type: application/json' --data '{"uploadId":73}'
```

Output:
```text
HTTP 200
{"created":false,"draft":{"id":1,"uploadId":73,"status":"active","config":{},"renderedProductionId":null,"createdAt":"2026-01-14 02:04:23","updatedAt":"2026-01-14 02:04:23","archivedAt":null}}```

## server log tail
```text
Uploader server listening on http://localhost:3310
Media jobs worker started (ip-172-31-10-226:474804) poll=2000ms
```
