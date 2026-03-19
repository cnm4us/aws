# Plan 133 — Phase E Asset Naming Cleanup

Date: `2026-03-18T23:35:57+00:00`  
Base URL: `http://localhost:3311`

Note:
- A temporary server was started on port `3311` from the current worktree so Phase E runtime changes could be validated without touching the main process.

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

## Runtime Grep Check

Command:
```bash
rg -n "prompt_bg|prompt-bg|getUploadPublicPrompt|IMAGE_VARIANTS_PROMPT|QUALITY_PROMPT_BG|uploads\\.prompt_poster\\.get" src frontend scripts -S
```

Result:
```text
src/db.ts:325:      try { await db.query(`UPDATE upload_image_variants SET variant_usage = 'message_bg' WHERE variant_usage = 'prompt_bg'`) } catch {}
src/db.ts:326:      try { await db.query(`UPDATE upload_image_variants SET profile_key = 'message_bg_p_1x' WHERE profile_key = 'prompt_bg_p_1x'`) } catch {}
src/db.ts:327:      try { await db.query(`UPDATE upload_image_variants SET profile_key = 'message_bg_p_2x' WHERE profile_key = 'prompt_bg_p_2x'`) } catch {}
src/db.ts:328:      try { await db.query(`UPDATE upload_image_variants SET profile_key = 'message_bg_l_1x' WHERE profile_key = 'prompt_bg_l_1x'`) } catch {}
src/db.ts:329:      try { await db.query(`UPDATE upload_image_variants SET profile_key = 'message_bg_l_2x' WHERE profile_key = 'prompt_bg_l_2x'`) } catch {}
```

Observed:
- active runtime callers are message-first
- remaining `prompt_bg` strings are migration-only in `src/db.ts`

## Feed Fetch Response

Command:
```bash
curl -sS 'http://localhost:3311/api/feed/messages/4?orientation=portrait&dpr=3'
```

Result excerpt:
```json
{
  "message": {
    "id": 4,
    "media": {
      "master": "https://uploads.bawebtech.com/images/2026-03/12/67599c31-8311-46d8-b3c7-fa3dce1bc2d6/image.jpg?...",
      "poster_portrait": "https://uploads.bawebtech.com/images/2026-03/12/67599c31-8311-46d8-b3c7-fa3dce1bc2d6/image.jpg?...",
      "poster_landscape": "https://uploads.bawebtech.com/images/2026-03/12/67599c31-8311-46d8-b3c7-fa3dce1bc2d6/image.jpg?..."
    }
  }
}
```

Observed:
- top-level response remains message-first
- no `prompt_bg` URL is returned
- after startup migration, legacy background derivatives were bypassed and the route fell back to the source image until new `message_bg` derivatives are used

## Message Background Image Route

Setup:
```bash
BASE_URL=http://localhost:3311 ./scripts/auth_curl.sh --profile super login
```

Result:
```text
HTTP 200
{"ok":true,"userId":1}
```

### New `message_bg` usage via `/api/uploads/:id/image`

Command:
```bash
BASE_URL=http://localhost:3311 INCLUDE_HEADERS=1 ./scripts/auth_curl.sh --profile super get '/api/uploads/1342/image?mode=image&usage=message_bg&orientation=portrait&dpr=1'
```

Result excerpt:
```text
HTTP 302
Location: https://uploads.bawebtech.com/derived/uploads/1342/message_bg_p_1x.webp?...
```

Observed:
- image route accepts `usage=message_bg`
- returned derivative URL uses `message_bg_p_1x.webp`

### Legacy `prompt_bg` usage rejected

Command:
```bash
BASE_URL=http://localhost:3311 INCLUDE_HEADERS=1 ./scripts/auth_curl.sh --profile super get '/api/uploads/1342/image?mode=image&usage=prompt_bg&orientation=portrait&dpr=1'
```

Result excerpt:
```text
HTTP 400
bad_usage
```

### New `/api/uploads/:id/message-bg` route

Command:
```bash
BASE_URL=http://localhost:3311 INCLUDE_HEADERS=1 ./scripts/auth_curl.sh --profile super get '/api/uploads/1342/message-bg?mode=image&usage=message_bg&orientation=portrait&dpr=1'
```

Result excerpt:
```text
HTTP 302
Location: https://uploads.bawebtech.com/derived/uploads/1342/message_bg_p_1x.webp?...
```

### Legacy `/api/uploads/:id/prompt-bg` route removed

Command:
```bash
BASE_URL=http://localhost:3311 INCLUDE_HEADERS=1 ./scripts/auth_curl.sh --profile super get '/api/uploads/1342/prompt-bg?mode=image&usage=message_bg&orientation=portrait&dpr=1'
```

Result excerpt:
```text
HTTP 404
Cannot GET /api/uploads/1342/prompt-bg
```

## Outcome

Phase E checks passed:
- `message_bg` is the active asset usage name
- message background derivative keys are message-first
- legacy `prompt_bg` query usage is rejected
- legacy `/prompt-bg` route is removed
- feed/admin asset callers are on message-first naming
