
Step 8 verifies removal of legacy, non-admin “moderation” aliases in favor of canonical “review” routes for space_admin workflows.


### 2025-12-28T19:35:32+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3300/api/me`
- Status: `200`
```
{"userId":6,"email":"tester_02@cnm4us.com","displayName":"Tester 02","roles":["site_member"],"isSiteAdmin":false,"spaceRoles":{"19":["space_admin","space_member","space_poster"],"21":["space_admin","space_member","space_poster"]},"personalSpace":{"id":20,"slug":"tester-02"}}
```

### 2025-12-28T19:35:34+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3300/api/spaces/19/review/queue`
- Status: `200`
```
{"items":[]}
```

### 2025-12-28T19:35:35+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3300/api/spaces/19/moderation/queue`
- Status: `404`
```
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/spaces/19/moderation/queue</pre>
</body>
</html>

```

### 2025-12-28T19:35:37+00:00
- Request: `GET http://localhost:3300/spaces/19/moderation`
- Status: `404`

### 2025-12-28T19:36:57+00:00
- Command: `npm run web:build`
- Result: success

### 2025-12-28T19:37:06+00:00
- Command: `rg -n -F "replace(/\\/moderation" public/app/assets -S`
- Expected: no matches
- Result: no matches
