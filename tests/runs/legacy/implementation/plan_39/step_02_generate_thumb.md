# Plan 39 – Step 2: Generate upload thumbnail (ffmpeg)

Date: 2026-01-04

## Generate
Command:

```bash
npx --yes ts-node --transpile-only scripts/generate-upload-thumb.ts 63
```

Output:

```json
{
  "bucket": "bacs-mc-uploads",
  "key": "thumbs/uploads/63/thumb.jpg",
  "s3Url": "s3://bacs-mc-uploads/thumbs/uploads/63/thumb.jpg"
}
```

## Verify endpoint
Command:

```bash
curl -sS -I -b .tmp/auth_cookies.super.txt http://localhost:3300/api/uploads/63/thumb
```

Output:

```text
HTTP/1.1 200 OK
Content-Type: image/jpeg
Content-Length: 23537
```
