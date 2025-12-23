# Step 00 — smoke + RBAC preflight

Date: 2025-12-23

BASE_URL: `https://aws.bawebtech.com`

## 1) Server reachable

Command:
```bash
BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh get /version
```

Output:
```text
HTTP 200
{"buildTag":"6728d35-2025-12-22T210016+0000","commit":"6728d35","commitDate":"2025-12-22T21:00:16+00:00","now":"2025-12-23T17:00:53.942Z"}
```

## 2) Identity (unauthenticated)

Command:
```bash
BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh me
```

Output:
```text
HTTP 200
{"userId":null,"email":null,"displayName":null,"roles":[],"isSiteAdmin":false,"spaceRoles":{},"personalSpace":null}
```

## 3) RBAC guard example (unauthenticated)

Command:
```bash
BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh get /api/admin/moderation/actions
```

Output:
```text
HTTP 401
{"error":"unauthorized"}
```

## 4) Login + identity (super)

Commands:
```bash
BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super login
BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super me
BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile super get /api/admin/moderation/actions
```

Output (trimmed):
```text
Logging in to https://aws.bawebtech.com/api/login as michael@bayareacreativeservices.com...
HTTP 200
{"ok":true,"userId":1}

HTTP 200
{"userId":1,"email":"michael@bayareacreativeservices.com","displayName":"Admin","roles":["site_admin","site_member"],"isSiteAdmin":true,...}

HTTP 200
{"actions":[]}
```

## 5) Login + identity (space_admin)

Commands:
```bash
BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile space_admin login
BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile space_admin me
BASE_URL="https://aws.bawebtech.com" ./scripts/auth_curl.sh --profile space_admin get /api/admin/moderation/actions
```

Output (trimmed):
```text
Logging in to https://aws.bawebtech.com/api/login as tester_02@cnm4us.com...
HTTP 200
{"ok":true,"userId":6}

HTTP 200
{"userId":6,"email":"tester_02@cnm4us.com","displayName":"Tester 02","roles":["site_member"],"isSiteAdmin":false,...}

HTTP 403
{"error":"forbidden"}
```
