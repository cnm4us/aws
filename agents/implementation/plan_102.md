# Plan 102: Normalize Upload Playback to /api Redirects (CloudFront Signed)

## Goal
Ensure **all runtime/preview media playback** uses `/api/uploads/...` endpoints so signatures are always fresh while CloudFront still serves the payload via server redirects. This eliminates mixed strategies (direct signed CDN URLs vs `/api` redirects) and should reduce preview glitches.

## Scope
- Frontend playback/preview URLs (Create Video, Edit Video, Produce, Exports, Assets/Library previews).
- Central CDN helper usage in `frontend/src/ui/uploadsCdn.ts`.
- **Not** changing upload POST (presigned S3) or backend signing logic.

## Comprehensive Search (commands)
Run these in repo root:

1) Direct CDN/signed URL usage
```
rg -n "uploads\\.bawebtech\\.com|cloudfront|signedUrl|signed_url|cdn-url|getUploadCdnUrl|uploadsCdn" frontend src
```

2) Any `/api/uploads` usage for playback
```
rg -n "api/uploads" frontend src
```

3) Any `edit-proxy`, `thumb`, or `file` playback references
```
rg -n "edit-proxy|thumb|/file" frontend/src/app
```

## Findings (from current search)
- **Central CDN helper:** `frontend/src/ui/uploadsCdn.ts` fetches `/api/uploads/:id/cdn-url` which returns a signed CloudFront URL.
- **CreateVideo uses direct CDN URLs** via `getUploadCdnUrl` in multiple places:
  - file/preview URLs, thumb URLs, edit-proxy URLs, and a prefetch batch for images.
- **EditVideo uses direct CDN URLs** via `getUploadCdnUrl` for `edit-proxy`.
- **Produce uses direct CDN URLs** via `getUploadCdnUrl` for `edit-proxy`.
- **Exports uses /api/uploads/:id/cdn-url** to fetch direct CDN URLs.
- **Backend already supports `/api/uploads/:id/file|thumb|edit-proxy` redirecting to signed CloudFront** (see `src/routes/uploads.ts`), so using `/api/` **still offloads bandwidth to CloudFront**.
- No hard-coded `uploads.bawebtech.com` strings found in repo (so direct usage is likely only via `getUploadCdnUrl`).

## Plan (with adjustments based on findings)

### Phase A — Centralize policy: prefer `/api` everywhere
- **Update** `frontend/src/ui/uploadsCdn.ts` to short-circuit and return `null` (or a sentinel) when we’re forcing `/api` usage.
  - This ensures any legacy callers fall back to `/api/uploads/:id/...` without removing all call sites.
  - Add a single toggle constant (e.g., `FORCE_API_UPLOADS = true`) in that file so we can re-enable later if desired.

### Phase B — Remove direct CDN fetches in high-traffic previews
- **CreateVideo**: replace all `getUploadCdnUrl(...) || /api/uploads/...` with direct `/api/uploads/...` URLs (skip the CDN call entirely). Key areas:
  - thumb URLs
  - edit-proxy URLs
  - file URLs (graphics/logos/stills/lower thirds)
  - prefetch batch (remove CDN lookups; prefetch with `/api/uploads/:id/file`)
- **EditVideo**: use `/api/uploads/:id/edit-proxy` directly.
- **Produce**: use `/api/uploads/:id/edit-proxy` directly.
- **Exports**: stop calling `/api/uploads/:id/cdn-url` and instead use `/api/uploads/:id/file` for previews.

### Phase C — Validation
- Confirm via browser devtools that media requests show `/api/uploads/...` and the response is **302 → CloudFront**.
- Verify preview still loads and no increased auth errors.
- Check that refresh no longer “fixes” glitches (expected improvement).

### Phase D — Cleanup (optional)
- If all callers are updated, consider leaving `getUploadCdnUrl` in place for future use but unused. Or add a deprecation note.

## Implementation Notes
- Backend `/api/uploads/:id/file|thumb|edit-proxy` already redirects to CloudFront with signed URL; this meets the requirement to keep signatures fresh **and** let CloudFront serve the bytes.
- We will avoid any direct `uploads.bawebtech.com` usage in frontend, so all playback should be consistent.

---

If this plan looks good, I’ll proceed with Phase A + B together (minimal behavior change, just consistent URL choice), then verify in Phase C.

## Scope Clarification (CDNs)
- This plan **only targets** the *uploads* CDN (`uploads.bawebtech.com` → `bacs-mc-uploads`) used for **pre‑HLS editing/preview assets**.
- It **does not change** the public HLS CDN (`videos.bawebtech.com` → `bacs-mc-public-stream`). If we want a similar `/api` redirect or signing strategy for HLS playback, that should be a **separate plan**.
