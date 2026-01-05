# Plan 40 – Step 2: API + resolve (lower thirds)

Date: 2026-01-05

## Login

```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super login
```

## List templates (expected empty until Step 3/4)

```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /api/lower-third-templates
```

## List configs (expected empty)

```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /api/lower-third-configs
```

## Resolve (expected template_not_found until a template exists)

```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super post /api/lower-third-templates/resolve \
  -H 'Content-Type: application/json' \
  --data '{"templateKey":"lt_modern_gradient_01","templateVersion":1,"params":{"primaryText":"Jane"}}'
```

### 2026-01-05T06:28:34+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/lower-third-templates`
- Status: `200`
```
{"items":[]}
```

### 2026-01-05T06:28:39+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/lower-third-configs`
- Status: `200`
```
{"items":[]}
```

### 2026-01-05T06:28:45+00:00
- Profile: `super`
- Request: `POST http://localhost:3300/api/lower-third-templates/resolve`
- Status: `404`
```
{"error":"not_found","detail":"template_not_found"}
```
