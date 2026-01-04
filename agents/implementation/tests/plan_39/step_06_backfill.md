# Plan 39 – Step 6: Backfill upload thumbnails

Date: 2026-01-04

## Typecheck

```bash
npm run build
```

Result: success.

## Backfill (small batch)

```bash
npx --yes ts-node --transpile-only scripts/backfill-upload-thumbs.ts --limit 3 --cursor 0
```

## Verify thumbs

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -b .tmp/auth_cookies.super.txt http://localhost:3300/api/uploads/1/thumb
curl -sS -o /dev/null -w '%{http_code}\n' -b .tmp/auth_cookies.super.txt http://localhost:3300/api/uploads/2/thumb
curl -sS -o /dev/null -w '%{http_code}\n' -b .tmp/auth_cookies.super.txt http://localhost:3300/api/uploads/3/thumb
```

Expected/observed: `200` for each.

{
  "cursor": 0,
  "limit": 3,
  "count": 3,
  "nextCursor": 3,
  "results": [
    {
      "uploadId": 1,
      "action": "enqueued",
      "jobId": 32,
      "outKey": "thumbs/uploads/1/thumb.jpg"
    },
    {
      "uploadId": 2,
      "action": "enqueued",
      "jobId": 33,
      "outKey": "thumbs/uploads/2/thumb.jpg"
    },
    {
      "uploadId": 3,
      "action": "enqueued",
      "jobId": 34,
      "outKey": "thumbs/uploads/3/thumb.jpg"
    }
  ]
}
1 200
2 200
3 200
HTTP/1.1 200 OK
X-Powered-By: Express
Vary: Origin
Access-Control-Allow-Credentials: true
Cache-Control: no-store
Content-Type: image/jpeg
Content-Length: 24110
Date: Sun, 04 Jan 2026 18:43:57 GMT
Connection: keep-alive
Keep-Alive: timeout=5
