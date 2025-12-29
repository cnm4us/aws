### 2025-12-29T00:40:29+00:00

BASE_URL: http://localhost:3300

```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super login >/dev/null
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /api/me
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile space_admin login >/dev/null
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile space_admin get /api/me
```

HTTP 200
{"userId":1,"email":"michael@bayareacreativeservices.com","displayName":"Admin","roles":["site_admin","site_member"],"isSiteAdmin":true,"hasAnySpaceAdmin":true,"hasAnySpaceModerator":true,"spaceRoles":{"3":["space_admin"],"16":["space_admin","space_member"],"17":["space_admin","space_member","space_poster"],"18":["space_admin","space_member"],"19":["space_admin","space_member","space_poster"],"21":["space_admin","space_member"],"28":["space_member"]},"personalSpace":{"id":1,"slug":"admin"}}
HTTP 200
{"userId":6,"email":"tester_02@cnm4us.com","displayName":"Tester 02","roles":["site_member"],"isSiteAdmin":false,"hasAnySpaceAdmin":true,"hasAnySpaceModerator":true,"spaceRoles":{"19":["space_admin","space_member","space_poster"],"21":["space_admin","space_member","space_poster"]},"personalSpace":{"id":20,"slug":"tester-02"}}