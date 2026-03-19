# Plan 133 — Phase B Runtime Cleanup

Date: `2026-03-18T23:11:14+00:00`  
Base URL: `http://localhost:3300`

## Build

Command:
```bash
npm run build
```

Result:
- Exit code `0`

Command:
```bash
npm run web:build
```

Result:
- Exit code `0`

## Runtime Type Cleanup

Command:
```bash
rg -n "\bPromptRow\b|\bPromptDto\b|\bPromptDecision[A-Za-z]+\b|\bPromptAnalytics[A-Za-z]+\b" src/features src/routes -S
```

Result:
```text
no matches
```

## Feed Fetch Contract

Command:
```bash
curl -sS 'http://localhost:3300/api/feed/messages/4?orientation=portrait&dpr=3'
```

Result excerpt:
```json
{
  "message": {
    "id": 4,
    "type": "register_login",
    "campaign_key": "1"
  }
}
```

Observed:
- top-level key is `message`
- response no longer returns top-level `prompt`

## Admin Message Detail Contract

Command:
```bash
BASE_URL=http://localhost:3300 ./scripts/auth_curl.sh --profile super get /api/admin/messages/4
```

Result excerpt:
```json
{
  "message": {
    "id": 4,
    "name": "Appeal by Penguin",
    "type": "register_login",
    "campaignKey": "1"
  }
}
```

Observed:
- admin JSON response uses `{ "message": ... }`

## Notes

- Media derivative URLs in the feed fetch response still use `prompt_bg` paths. That is expected before Phase E.
