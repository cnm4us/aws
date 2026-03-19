# Plan 61 — Step 3 — Validation

Date: 2026-01-14 02:12:53 UTC


Command:
```bash
BASE_URL='http://localhost:3311' COOKIE_JAR='/tmp/tmp.SvzjA7fQpM/cookies.txt' ./scripts/auth_curl.sh --profile super login
```

Output:
```text
Logging in to http://localhost:3311/api/login as michael@bayareacreativeservices.com...
HTTP 200
{"ok":true,"userId":1}
```

Command:
```bash
BASE_URL='http://localhost:3311' COOKIE_JAR='/tmp/tmp.SvzjA7fQpM/cookies.txt' ./scripts/auth_curl.sh --profile super patch /api/production-drafts/ -H 'Content-Type: application/json' --data '{"config":{"config":{"intro":{"kind":"title_image"}}}}'
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
BASE_URL='http://localhost:3311' COOKIE_JAR='/tmp/tmp.SvzjA7fQpM/cookies.txt' ./scripts/auth_curl.sh --profile super patch /api/production-drafts/ -H 'Content-Type: application/json' --data '{"config":{"config":{"timeline":{"overlays":[{"kind":"image","track":"A","uploadId":82,"startSeconds":5,"endSeconds":5}]}}}}'
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

## server log tail
```text
Uploader server listening on http://localhost:3311
Media jobs worker started (ip-172-31-10-226:475656) poll=2000ms
```
